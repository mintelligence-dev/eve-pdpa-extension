import { definePolicy } from '@eve-pdpa-extension/core'
import { describe, expect, it } from 'vitest'
import { PdpaHttpError } from '../src/errors.js'
import { createWebhook, type ForwardRecord, type WebhookOptions } from '../src/webhook.js'
import { FORWARD_TO, REPLY_TO, recorder, SECRET, type Sent, signed } from './helpers.js'

const POLICY = definePolicy({ entitySet: '0.1', entities: { PHONE: { action: 'mask' } } })
const AI = 'https://ai.shop-b.example/inbound'
const APP = 'https://chat.shop-b.example/reply'

function setup(extra: Partial<WebhookOptions> & { status?: number | 'throw' } = {}) {
  const { status, ...rest } = extra
  const net = recorder(status)
  const forwards: ForwardRecord[] = []
  const webhook = createWebhook({
    policies: { default: POLICY },
    secret: SECRET,
    onAudit: () => {},
    onForward: (r) => {
      forwards.push(r)
    },
    fetch: net.fetch,
    ...rest,
  })
  return { webhook, sent: net.sent, forwards }
}

const bodyOf = (s: Sent): Record<string, unknown> => JSON.parse(s.body)

describe('destinations named in the request', () => {
  it('/inbound goes where the request says, and passes replyTo on to the answering system', async () => {
    const { webhook, sent } = setup()
    const res = await webhook.inbound(
      await signed({ sessionId: 'conv_8f2a', text: 'สวัสดีค่ะ', forwardTo: AI, replyTo: APP }),
    )
    expect(res.status).toBe(200)
    expect(sent[0]?.url).toBe(AI)
    expect(bodyOf(sent[0] as Sent)).toEqual({
      policy: 'default',
      sessionId: 'conv_8f2a',
      text: 'สวัสดีค่ะ',
      replyTo: APP,
    })
  })

  it('/outbound goes to the replyTo the answering system sends back', async () => {
    const { webhook, sent } = setup()
    await webhook.outbound(
      await signed(
        { sessionId: 'conv_8f2a', text: 'ได้เลยค่ะ', replyTo: APP },
        { scope: 'outbound' },
      ),
    )
    expect(sent[0]?.url).toBe(APP)
    expect(bodyOf(sent[0] as Sent)).not.toHaveProperty('replyTo')
  })

  it('without one in the request, the webhook falls back to its own', async () => {
    const { webhook, sent } = setup({ forwardTo: FORWARD_TO, replyTo: REPLY_TO })
    await webhook.inbound(await signed({ sessionId: 's1', text: 'x' }))
    await webhook.outbound(await signed({ sessionId: 's1', text: 'x' }, { scope: 'outbound' }))
    expect(sent.map((s) => s.url)).toEqual([FORWARD_TO, REPLY_TO])
  })

  it('without either, it is a 400 that says which is missing', async () => {
    const { webhook, sent } = setup()
    const inbound = await webhook.inbound(await signed({ sessionId: 's1', text: 'x' }))
    const outbound = await webhook.outbound(
      await signed({ sessionId: 's1', text: 'x' }, { scope: 'outbound' }),
    )
    expect(inbound.status).toBe(400)
    expect(await inbound.json()).toMatchObject({ field: 'forwardTo' })
    expect(await outbound.json()).toMatchObject({ field: 'replyTo' })
    expect(sent).toHaveLength(0)
  })

  it('/outbound does not take a forwardTo', async () => {
    const { webhook } = setup()
    const res = await webhook.outbound(
      await signed(
        { sessionId: 's1', text: 'x', replyTo: APP, forwardTo: AI },
        { scope: 'outbound' },
      ),
    )
    expect(res.status).toBe(400)
  })
})

describe('destinations a request may not name', () => {
  const refused = [
    'http://ai.shop-b.example/inbound',
    'https://user:pass@ai.shop-b.example/inbound',
    'https://localhost/inbound',
    'https://admin.localhost/',
    'https://printer.local/',
    'https://metadata.google.internal/',
    'https://127.0.0.1/',
    'https://0x7f.1/',
    'https://2130706433/',
    'https://10.1.2.3/',
    'https://172.16.0.1/',
    'https://172.31.255.255/',
    'https://192.168.1.1/',
    'https://169.254.169.254/latest/meta-data/',
    'https://100.64.0.1/',
    'https://0.0.0.0/',
    'https://[::1]/',
    'https://[::]/',
    'https://[fd00::1]/',
    'https://[fe80::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:192.168.1.1]/',
    // D22: a trailing dot is the same name, and more ranges that are not public.
    'https://localhost./',
    'https://localhost%2e/',
    'https://metadata.google.internal./',
    'https://printer.local./',
    'https://198.18.0.1/',
    'https://192.0.0.1/',
    'https://224.0.0.1/',
    'https://255.255.255.255/',
    'https://[::7f00:1]/',
    'https://[64:ff9b::a9fe:a9fe]/',
    'https://[64:ff9b:1::1]/',
    'https://[::ffff:0:a9fe:a9fe]/',
    'https://[2002:7f00:1::]/',
    'https://[fec0::1]/',
    'https://[ff02::1]/',
    'not a url',
    '/relative/path',
  ]

  for (const url of refused) {
    it(url, async () => {
      const { webhook, sent } = setup()
      const res = await webhook.inbound(
        await signed({ sessionId: 's1', text: 'x', forwardTo: url }),
      )
      expect(res.status).toBe(400)
      const text = await res.text()
      expect(JSON.parse(text)).toMatchObject({ field: 'forwardTo' })
      expect(text).not.toContain(url)
      expect(sent).toHaveLength(0)
    })
  }

  it('public addresses next to the private ranges are allowed', async () => {
    const { webhook, sent } = setup()
    for (const url of [
      'https://172.32.0.1/',
      'https://192.169.1.1/',
      'https://100.128.0.1/',
      'https://[2001:db8::1]/',
    ]) {
      const res = await webhook.inbound(
        await signed({ sessionId: 's1', text: 'x', forwardTo: url }),
      )
      expect(res.status).toBe(200)
    }
    expect(sent).toHaveLength(4)
  })

  it('a bad replyTo on /inbound is refused before anything is sent', async () => {
    const { webhook, sent } = setup()
    const res = await webhook.inbound(
      await signed({ sessionId: 's1', text: 'x', forwardTo: AI, replyTo: 'https://10.0.0.1/' }),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ field: 'replyTo' })
    expect(sent).toHaveLength(0)
  })

  it('the webhook’s own defaults may be anything its deployer chose', async () => {
    const { webhook, sent } = setup({ forwardTo: 'http://10.0.0.5:8080/ai' })
    expect((await webhook.inbound(await signed({ sessionId: 's1', text: 'x' }))).status).toBe(200)
    expect(sent[0]?.url).toBe('http://10.0.0.5:8080/ai')
  })
})

describe('allowedDestinations', () => {
  const options = {
    allowedDestinations: ['https://ai.shop-b.example/', 'https://chat.shop-b.example/reply'],
  }

  it('lets through a destination under one of them', async () => {
    const { webhook, sent } = setup(options)
    const res = await webhook.inbound(
      await signed({ sessionId: 's1', text: 'x', forwardTo: AI, replyTo: `${APP}/line` }),
    )
    expect(res.status).toBe(200)
    expect(sent).toHaveLength(1)
  })

  it('refuses one outside them, a look-alike host, and another path', async () => {
    const { webhook, sent } = setup(options)
    for (const url of [
      'https://ai.shop-a.example/inbound',
      'https://ai.shop-b.example.attacker.example/inbound',
      'https://chat.shop-b.example/admin',
      // D22: the path must match, or continue past a /, not just start the same way.
      'https://chat.shop-b.example/reply-admin',
      'https://chat.shop-b.example/replyall',
    ]) {
      const res = await webhook.inbound(
        await signed({ sessionId: 's1', text: 'x', forwardTo: url }),
      )
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ field: 'forwardTo' })
    }
    expect(sent).toHaveLength(0)
  })

  it('lets through the path itself, as well as one below it', async () => {
    const { webhook, sent } = setup(options)
    const res = await webhook.inbound(
      await signed({ sessionId: 's1', text: 'x', forwardTo: AI, replyTo: APP }),
    )
    expect(res.status).toBe(200)
    expect(sent).toHaveLength(1)
  })

  it('refuses entries that are not https URLs without a query', () => {
    for (const bad of [['http://ai.example/'], ['ai.example'], ['https://ai.example/?k=1']]) {
      expect(() =>
        createWebhook({
          policies: { default: POLICY },
          secret: SECRET,
          onAudit: () => {},
          allowedDestinations: bad,
        }),
      ).toThrow(PdpaHttpError)
    }
  })
})

describe('a destination that carries personal data (D22)', () => {
  it('is refused, by field, without repeating the value', async () => {
    const { webhook, sent } = setup()
    for (const [field, url] of [
      ['forwardTo', 'https://ai.shop-b.example/reply/0918887777'],
      ['forwardTo', 'https://ai.shop-b.example/in?user=somchai%40example.com'],
      ['replyTo', 'https://chat.shop-b.example/reply?to=U4af4980629a1b2c3d4e5f60718293a4b'],
    ] as const) {
      const res = await webhook.inbound(
        await signed({ sessionId: 's1', text: 'x', forwardTo: AI, [field]: url }),
      )
      expect(res.status, url).toBe(400)
      const text = await res.text()
      expect(JSON.parse(text)).toMatchObject({ field })
      expect(text).not.toContain('0918887777')
    }
    expect(sent).toHaveLength(0)
  })

  it('lets through the ids a system puts in its own URLs', async () => {
    const { webhook, sent } = setup()
    const res = await webhook.inbound(
      await signed({ sessionId: 's1', text: 'x', forwardTo: `${AI}/conv/8f2a?ref=12345` }),
    )
    expect(res.status).toBe(200)
    expect(sent).toHaveLength(1)
  })
})

describe('a destination that redirects', () => {
  // D22: following it would send the signed POST past every check above.
  it('is not followed: the forward counts as failed, and is recorded with its status', async () => {
    const asked: RequestInit[] = []
    const fetch = (async (_url: string, init?: RequestInit) => {
      asked.push(init ?? {})
      return new Response(null, { status: 307, headers: { location: 'http://169.254.169.254/' } })
    }) as typeof globalThis.fetch
    const { webhook, forwards } = setup({ fetch })
    const res = await webhook.inbound(await signed({ sessionId: 's1', text: 'x', forwardTo: AI }))
    expect(asked[0]?.redirect).toBe('manual')
    expect(res.status).toBe(502)
    expect(forwards[0]).toMatchObject({ delivered: false, status: 307 })
  })
})

describe('onForward', () => {
  it('records where each message went, without the query, and where the address came from', async () => {
    const { webhook, forwards } = setup({ forwardTo: FORWARD_TO })
    await webhook.inbound(
      await signed({
        sessionId: 'conv_8f2a',
        ref: 'msg_1',
        text: 'x',
        forwardTo: `${AI}?key=t0ken#x`,
      }),
    )
    await webhook.inbound(await signed({ sessionId: 'conv_8f2a', text: 'x' }))
    expect(forwards).toEqual([
      {
        at: expect.any(String),
        boundary: 'inbound',
        policy: 'default',
        sessionId: 'conv_8f2a',
        ref: 'msg_1',
        destination: AI,
        destinationFrom: 'request',
        delivered: true,
        status: 200,
      },
      expect.objectContaining({ destination: FORWARD_TO, destinationFrom: 'default' }),
    ])
    expect(JSON.stringify(forwards)).not.toContain('t0ken')
  })

  it('records a forward that failed, with its status or none', async () => {
    for (const [status, expected] of [
      [503, 503],
      ['throw', null],
    ] as const) {
      const { webhook, forwards } = setup({ status })
      const res = await webhook.inbound(await signed({ sessionId: 's1', text: 'x', forwardTo: AI }))
      expect(res.status).toBe(502)
      expect(forwards[0]).toMatchObject({ delivered: false, status: expected })
    }
  })

  it('is not called for a message that was blocked or refused', async () => {
    const { webhook, forwards } = setup({
      policies: {
        default: definePolicy({ entitySet: '0.1', entities: { PHONE: { action: 'block' } } }),
      },
    })
    await webhook.inbound(await signed({ sessionId: 's1', text: 'เบอร์ 0918887777', forwardTo: AI }))
    await webhook.inbound(
      await signed({ sessionId: 's1', text: 'x', forwardTo: 'https://10.0.0.1/' }),
    )
    expect(forwards).toHaveLength(0)
  })

  it('is waited for when it returns a Promise, and cannot fail the message when it throws', async () => {
    let written = false
    const slow = setup({
      onForward: () =>
        new Promise<void>((done) =>
          setTimeout(() => {
            written = true
            done()
          }, 20),
        ),
    })
    await slow.webhook.inbound(await signed({ sessionId: 's1', text: 'x', forwardTo: AI }))
    expect(written).toBe(true)

    const broken = setup({
      onForward: () => {
        throw new Error('log store down')
      },
    })
    const res = await broken.webhook.inbound(
      await signed({ sessionId: 's1', text: 'x', forwardTo: AI }),
    )
    expect(res.status).toBe(200)
  })
})
