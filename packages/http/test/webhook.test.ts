import {
  type AuditRecord,
  createMemoryTokenStore,
  definePolicy,
  type TokenStore,
} from '@eve-pdpa-extension/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PdpaHttpError } from '../src/errors.js'
import { verifyRequest } from '../src/signature.js'
import { createWebhook, type WebhookOptions } from '../src/webhook.js'
import {
  FORWARD_TO,
  REPLY_TO,
  RESOLVE_SECRET,
  recorder,
  SECRET,
  type Sent,
  signed,
} from './helpers.js'

// Synthetic values. The card is a network test number.
const PHONE = '091-888-7777'
const PHONE_DIGITS = '0918887777'
const CARD = '4111 1111 1111 1111'
const LINE_ID = 'U4af4980629a1b2c3d4e5f60718293a4b'

const DEFAULT = definePolicy({
  entitySet: '0.1',
  entities: {
    PHONE: { action: 'mask' },
    BANK_ACCOUNT: { action: 'mask', keep: 'last4' },
    CREDIT_CARD: { action: 'block' },
  },
})
const OTP = definePolicy({
  entitySet: '0.1',
  entities: {
    PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'], ttlSec: 300, display: 'mask' },
    CREDIT_CARD: { action: 'block' },
  },
})

const TOKEN = /\[tok:[bcdfghjkmnpqrstv]{16}\]/

function setup(extra: Partial<WebhookOptions> & { status?: number | 'throw' } = {}) {
  const { status, ...rest } = extra
  const net = recorder(status)
  const events: AuditRecord[] = []
  const tokenStore: TokenStore = createMemoryTokenStore()
  const webhook = createWebhook({
    policies: { default: DEFAULT, otp: OTP },
    secret: SECRET,
    resolveSecret: RESOLVE_SECRET,
    tokenStore,
    forwardTo: FORWARD_TO,
    replyTo: REPLY_TO,
    onAudit: (e) => {
      events.push(e)
    },
    fetch: net.fetch,
    ...rest,
  })
  return { webhook, sent: net.sent, events }
}

const bodyOf = (s: Sent): Record<string, unknown> => JSON.parse(s.body)
const answer = async (res: Response): Promise<Record<string, unknown>> => res.json()

/** What a refusal may never contain: anything the request carried. */
function expectNoValues(text: string): void {
  for (const v of [PHONE, PHONE_DIGITS, CARD, LINE_ID, 'secret-field-name']) {
    expect(text).not.toContain(v)
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('/inbound', () => {
  it('forwards only the protected text, signed so the receiver can check it', async () => {
    const { webhook, sent } = setup()
    const res = await webhook.inbound(
      await signed({ sessionId: 'conv_8f2a', ref: 'msg_10293', text: `เบอร์ ${PHONE} ค่ะ` }),
    )
    expect(res.status).toBe(200)
    expect(await answer(res)).toEqual({ outcome: 'processed' })
    expect(sent).toHaveLength(1)
    const [out] = sent as [Sent]
    expect(out.url).toBe(FORWARD_TO)
    expect(bodyOf(out)).toEqual({
      policy: 'default',
      sessionId: 'conv_8f2a',
      ref: 'msg_10293',
      text: 'เบอร์ xxx-xxx-xxxx ค่ะ',
    })
    expect(await verifyRequest(SECRET, out.headers, out.body)).toBe(true)
  })

  it('reads context for cue words and does not send it on', async () => {
    const { webhook, sent } = setup()
    await webhook.inbound(
      await signed({
        sessionId: 'conv_8f2a',
        text: '123-4-56789-0',
        context: 'รบกวนขอเลขบัญชีด้วยค่ะ',
      }),
    )
    const out = bodyOf(sent[0] as Sent)
    expect(out.text).toBe('xxx-x-xx789-0')
    expect(out).not.toHaveProperty('context')
  })

  it('a blocked message is not sent on, and the answer says which type stopped it', async () => {
    const { webhook, sent } = setup()
    const res = await webhook.inbound(
      await signed({ sessionId: 'conv_8f2a', text: `บัตร ${CARD} ค่ะ` }),
    )
    expect(res.status).toBe(200)
    expect(await answer(res)).toEqual({ outcome: 'blocked', blockedBy: ['CREDIT_CARD'] })
    expect(sent).toHaveLength(0)
  })

  it('a forward that fails or answers non-2xx is a 502, so the sender sends again', async () => {
    for (const status of [500, 'throw'] as const) {
      const { webhook } = setup({ status })
      const res = await webhook.inbound(await signed({ sessionId: 'conv_8f2a', text: 'สวัสดีค่ะ' }))
      expect(res.status).toBe(502)
      expect(await answer(res)).toMatchObject({ outcome: 'forward_failed' })
    }
  })

  it('uses the policy the request names, and says so to the receiver', async () => {
    const { webhook, sent } = setup()
    await webhook.inbound(
      await signed({ policy: 'otp', sessionId: 'conv_8f2a', text: `เบอร์ ${PHONE}` }),
    )
    const out = bodyOf(sent[0] as Sent)
    expect(out.policy).toBe('otp')
    expect(out.text).toMatch(TOKEN)
  })

  it('a policy name it does not have is a 400 that lists the names it has', async () => {
    const { webhook, sent } = setup()
    const res = await webhook.inbound(await signed({ policy: 'nope', sessionId: 's1', text: 'x' }))
    expect(res.status).toBe(400)
    expect(await answer(res)).toMatchObject({
      field: 'policy',
      message: 'policy must be one of: default, otp',
    })
    expect(sent).toHaveLength(0)
  })

  it('without a default policy, a request must name one', async () => {
    const { webhook } = setup({ policies: { otp: OTP } })
    const res = await webhook.inbound(await signed({ sessionId: 's1', text: 'x' }))
    expect(res.status).toBe(400)
    expect(await answer(res)).toMatchObject({ field: 'policy' })
  })
})

describe('/outbound', () => {
  it('sends the checked answer to replyTo, a token of this chat shown masked', async () => {
    const { webhook, sent } = setup()
    await webhook.inbound(
      await signed({ policy: 'otp', sessionId: 'conv_8f2a', text: `เบอร์ ${PHONE}` }),
    )
    const token = (bodyOf(sent[0] as Sent).text as string).match(TOKEN)?.[0] as string
    const res = await webhook.outbound(
      await signed({ policy: 'otp', sessionId: 'conv_8f2a', text: `ส่ง OTP ไปที่ ${token} แล้วค่ะ` }),
    )
    expect(res.status).toBe(200)
    const out = sent[1] as Sent
    expect(out.url).toBe(REPLY_TO)
    expect(bodyOf(out).text).toBe('ส่ง OTP ไปที่ xxx-xxx-7777 แล้วค่ะ')
  })

  it('catches a value the model wrote itself', async () => {
    const { webhook, sent } = setup()
    await webhook.outbound(await signed({ sessionId: 'conv_8f2a', text: `โทรหาคุณที่ ${PHONE} นะคะ` }))
    expect(bodyOf(sent[0] as Sent).text).not.toContain(PHONE)
  })
})

describe('refusals send nothing on and echo nothing back', () => {
  const cases: [string, () => Promise<Request>, number][] = [
    [
      'no signature',
      async () =>
        new Request('https://hook.example/', {
          method: 'POST',
          body: JSON.stringify({ sessionId: 's1', text: PHONE }),
        }),
      401,
    ],
    [
      'the wrong secret',
      () => signed({ sessionId: 's1', text: PHONE }, { secret: RESOLVE_SECRET }),
      401,
    ],
    [
      'signed more than 5 minutes ago',
      () => signed({ sessionId: 's1', text: PHONE }, { now: Date.now() - 301_000 }),
      401,
    ],
    ['not JSON', () => signed(`{"sessionId":"s1","text":"${PHONE}"`), 400],
    ['a JSON array', () => signed([PHONE]), 400],
    [
      'a field it does not read',
      () => signed({ sessionId: 's1', text: 'x', 'secret-field-name': PHONE }),
      400,
    ],
    ['no sessionId', () => signed({ text: PHONE }), 400],
    ['a number for text', () => signed({ sessionId: 's1', text: 918887777 }), 400],
    ['a LINE userId as sessionId', () => signed({ sessionId: LINE_ID, text: 'x' }), 400],
    ['a phone number as ref', () => signed({ sessionId: 's1', ref: PHONE_DIGITS, text: 'x' }), 400],
    ['a body over the limit', () => signed({ sessionId: 's1', text: 'ก'.repeat(70_000) }), 413],
  ]

  for (const [name, make, status] of cases) {
    it(name, async () => {
      const { webhook, sent } = setup()
      const res = await webhook.inbound(await make())
      expect(res.status).toBe(status)
      expectNoValues(await res.text())
      expect(sent).toHaveLength(0)
    })
  }

  it('GET is a 405 that says to POST', async () => {
    const { webhook } = setup()
    const res = await webhook.inbound(new Request('https://hook.example/'))
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
  })

  it('a body that cannot be read is a 400, not a throw', async () => {
    const { webhook, sent } = setup()
    // The sender's connection drops halfway through the body.
    const dropped = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"sessionId":"s1","text":"'))
        controller.error(new Error('connection reset'))
      },
    })
    const cut = new Request('https://hook.example/', {
      method: 'POST',
      body: dropped,
      duplex: 'half',
    } as RequestInit)
    // Read once already, by middleware in front of the handler.
    const used = await signed({ sessionId: 's1', text: 'x' })
    await used.text()

    for (const request of [cut, used]) {
      const res = await webhook.inbound(request)
      expect(res.status).toBe(400)
      expect(await answer(res)).toMatchObject({ error: 'invalid_request', field: 'body' })
    }
    expect(sent).toHaveLength(0)
  })

  it('a token store that is down blocks the message, as core does (D15)', async () => {
    const failing: TokenStore = {
      sync: false,
      set: () => Promise.reject(new Error('down')),
      get: () => Promise.reject(new Error('down')),
      delete: () => Promise.resolve(),
      clearSession: () => Promise.resolve(),
    }
    const { webhook, sent } = setup({ tokenStore: failing })
    const res = await webhook.inbound(
      await signed({ policy: 'otp', sessionId: 's1', text: `เบอร์ ${PHONE}` }),
    )
    expect(res.status).toBe(200)
    expect(await answer(res)).toMatchObject({ outcome: 'blocked', blockedBy: ['PHONE'] })
    expect(sent).toHaveLength(0)
  })
})

describe('/resolve', () => {
  async function issue(webhookSetup = setup()) {
    const { webhook, sent } = webhookSetup
    await webhook.inbound(
      await signed({ policy: 'otp', sessionId: 'conv_8f2a', text: `เบอร์ ${PHONE}` }),
    )
    const token = (bodyOf(sent[0] as Sent).text as string).match(TOKEN)?.[0] as string
    return { ...webhookSetup, token }
  }

  const resolveBody = (token: string, extra: Record<string, string> = {}) => ({
    policy: 'otp',
    token,
    sessionId: 'conv_8f2a',
    purpose: 'otp_send',
    caller: 'otp-service',
    ...extra,
  })

  it('gives the real value for an allowed purpose, marked not to be cached', async () => {
    const { webhook, token } = await issue()
    const res = await webhook.resolve(await signed(resolveBody(token), { secret: RESOLVE_SECRET }))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await answer(res)).toEqual({ ok: true, value: PHONE_DIGITS })
  })

  it('takes the token however the model copied it into the tool call (D21)', async () => {
    const { webhook, token } = await issue()
    const id = token.slice(5, -1)
    for (const spelt of [`tok:${id}`, `"[tok:${id}]"`, `[ tok:${id} ]`]) {
      const res = await webhook.resolve(
        await signed(resolveBody(spelt), { secret: RESOLVE_SECRET }),
      )
      expect(await answer(res), spelt).toEqual({ ok: true, value: PHONE_DIGITS })
    }
  })

  it('refuses a purpose that is itself personal data, before it reaches audit (D22)', async () => {
    const { webhook, token, events } = await issue()
    const res = await webhook.resolve(
      await signed(resolveBody(token, { purpose: '0918887777' }), { secret: RESOLVE_SECRET }),
    )
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(JSON.parse(text)).toMatchObject({ field: 'purpose' })
    expect(text).not.toContain('0918887777')
    expect(JSON.stringify(events)).not.toContain('0918887777')
  })

  it('refuses another purpose, another chat, and an expired token', async () => {
    const { webhook, token } = await issue()
    const ask = async (extra: Record<string, string>) =>
      answer(
        await webhook.resolve(await signed(resolveBody(token, extra), { secret: RESOLVE_SECRET })),
      )
    expect(await ask({ purpose: 'marketing' })).toEqual({
      ok: false,
      reason: 'purpose_not_allowed',
    })
    expect(await ask({ sessionId: 'conv_other' })).toEqual({
      ok: false,
      reason: 'session_mismatch',
    })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 301_000)
    expect(await ask({})).toEqual({ ok: false, reason: 'expired' })
  })

  it('the inbound secret cannot resolve', async () => {
    const { webhook, token } = await issue()
    const res = await webhook.resolve(await signed(resolveBody(token)))
    expect(res.status).toBe(401)
  })

  it('a policy that does not tokenise is a 400', async () => {
    const { webhook, token } = await issue()
    const res = await webhook.resolve(
      await signed(resolveBody(token, { policy: 'default' }), { secret: RESOLVE_SECRET }),
    )
    expect(res.status).toBe(400)
    expect(await answer(res)).toMatchObject({ field: 'policy' })
  })

  it('every attempt is audited, and the real value is in no audit event', async () => {
    const { webhook, token, events } = await issue()
    await webhook.resolve(await signed(resolveBody(token), { secret: RESOLVE_SECRET }))
    await webhook.resolve(
      await signed(resolveBody(token, { purpose: 'marketing' }), { secret: RESOLVE_SECRET }),
    )
    const resolves = events.filter((e) => e.type === 'token.resolve')
    expect(resolves.map((e) => e.type === 'token.resolve' && e.outcome)).toEqual([
      'allowed',
      'denied',
    ])
    expect(resolves.every((e) => e.type === 'token.resolve' && e.caller === 'otp-service')).toBe(
      true,
    )
    const log = JSON.stringify(events)
    expect(log).not.toContain(PHONE_DIGITS)
    expect(log).not.toContain(PHONE)
  })

  it('after /end-session the token is gone', async () => {
    const { webhook, token } = await issue()
    const ended = await webhook.endSession(await signed({ sessionId: 'conv_8f2a' }))
    expect(ended.status).toBe(200)
    expect(await answer(ended)).toEqual({ ok: true })
    const res = await webhook.resolve(await signed(resolveBody(token), { secret: RESOLVE_SECRET }))
    expect(await answer(res)).toEqual({ ok: false, reason: 'not_found' })
  })

  it('with no policy that tokenises, /resolve and /end-session are 404', async () => {
    const { webhook } = setup({ policies: { default: DEFAULT } })
    expect((await webhook.resolve(await signed({}, { secret: RESOLVE_SECRET }))).status).toBe(404)
    expect((await webhook.endSession(await signed({ sessionId: 's1' }))).status).toBe(404)
  })
})

describe('createWebhook refuses options it cannot run with', () => {
  const base: WebhookOptions = {
    policies: { default: DEFAULT, otp: OTP },
    secret: SECRET,
    resolveSecret: RESOLVE_SECRET,
    tokenStore: createMemoryTokenStore(),
    forwardTo: FORWARD_TO,
    replyTo: REPLY_TO,
    onAudit: () => {},
  }
  const refuses = (change: Partial<WebhookOptions>, message: RegExp) => {
    let thrown: unknown
    try {
      createWebhook({ ...base, ...change } as WebhookOptions)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(PdpaHttpError)
    expect((thrown as PdpaHttpError).code).toBe('ERR_PDPA_HTTP_CONFIG')
    expect((thrown as PdpaHttpError).message).toMatch(message)
  }

  it('a policy that tokenises without a shared store or a resolve secret', () => {
    const { tokenStore: _store, ...noStore } = base
    const { resolveSecret: _secret, ...noSecret } = base
    expect(() => createWebhook(noStore)).toThrow(/'otp' tokenises: pass a tokenStore/)
    expect(() => createWebhook(noSecret)).toThrow(/'otp' tokenises: pass a resolveSecret/)
  })

  it('a resolve secret that is the inbound secret', () => {
    refuses({ resolveSecret: SECRET }, /must differ/)
  })

  it('short secrets, no onAudit, bad names and bad URLs', () => {
    refuses({ secret: 'short' }, /secret must be at least 32 bytes/)
    refuses({ resolveSecret: 'short' }, /resolveSecret must be at least 32 bytes/)
    refuses({ onAudit: undefined as never }, /onAudit is required/)
    refuses({ policies: {} }, /at least one policy/)
    refuses({ policies: { 'has space': DEFAULT } }, /policy names/)
    refuses({ forwardTo: 'not a url' }, /forwardTo must be an http or https URL/)
    refuses({ replyTo: 'ftp://chat-app.example' }, /replyTo/)
    refuses({ maxBodyBytes: 0 }, /maxBodyBytes must be a positive integer/)
  })

  it('without tokenise, no store and no resolve secret are needed', () => {
    expect(() =>
      createWebhook({
        ...base,
        policies: { default: DEFAULT },
        tokenStore: undefined as never,
        resolveSecret: undefined as never,
      }),
    ).not.toThrow()
  })
})

describe('audit', () => {
  it('an onAudit that returns a Promise is waited for before the answer goes out', async () => {
    let written = 0
    const { webhook } = setup({
      onAudit: () =>
        new Promise<void>((done) => {
          setTimeout(() => {
            written++
            done()
          }, 20)
        }),
    })
    await webhook.inbound(await signed({ sessionId: 'conv_8f2a', text: `เบอร์ ${PHONE}` }))
    expect(written).toBeGreaterThan(0)
  })
})
