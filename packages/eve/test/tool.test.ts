import {
  type AuditRecord,
  createMemoryTokenStore,
  definePolicy,
  type TokenStore,
} from '@eve-pdpa-extension/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

const slots = new Map<string, unknown>()
vi.mock('eve/context', () => ({
  defineState: (name: string, initial: () => unknown) => ({
    get: () => (slots.has(name) ? slots.get(name) : initial()),
    update: (fn: (v: unknown) => unknown) => {
      slots.set(name, fn(slots.has(name) ? slots.get(name) : initial()))
    },
  }),
}))

const { defineTool } = await import('eve/tools')
const { pdpaHook, withPdpaGuard, withTokenResolution } = await import('../extension/lib/guard.js')
const { fakeArgs, post } = await import('./fakes.js')
const { expectNoLeak, makeGuard, PHONE, SESSION_KEY, thaiDigits, TOKEN, TOKENISE } = await import(
  './helpers.js'
)

const REAL = '0918887777'
const SLACK = { channelName: 'slack', address: 'C1:1800.1' }

afterEach(() => {
  vi.useRealTimers()
})

/** A tool that would send an OTP: records what it was given, sends nothing. */
function otpSend() {
  const received: unknown[] = []
  const tool = defineTool({
    description: 'Send a one-time password to the customer’s phone.',
    inputSchema: {
      type: 'object',
      properties: { phone: { type: 'string' }, note: { type: 'string' } },
      required: ['phone'],
    },
    label: { start: () => 'Sending OTP' },
    async execute(input: { phone: string; note?: string }) {
      received.push(input)
      return { sent: true, to: input.phone, message: `ส่ง OTP ไปที่ ${input.phone} แล้ว` }
    },
  })
  return { tool, received }
}

/**
 * One conversation, as far as the package sees it: a message comes in through
 * a wrapped channel, eve records it and runs pdpaHook, and the model — here,
 * the test — calls the tool with what it read.
 */
async function conversation(text: string, guard = makeGuard(TOKENISE), address = SLACK.address) {
  const { args, calls } = fakeArgs()
  const channel = withPdpaGuard(
    {
      routes: [
        {
          method: 'POST' as const,
          path: '/m',
          handler: async (request: Request, a: typeof args) => {
            const { message } = (await request.json()) as { message: string }
            await a.from(address).send(message, { auth: null })
            return new Response('ok')
          },
        },
      ],
    },
    { guard: guard.guard, sessionKey: SESSION_KEY, channelName: SLACK.channelName },
  )
  await (channel.routes[0]?.handler as never as Function)(post({ message: text }), args)
  const recorded = calls[0]?.message as string
  // eve runs the agent's hooks on the recorded message, in the session.
  await (
    pdpaHook({ guard: guard.guard, sessionKey: SESSION_KEY }).events?.[
      'message.received'
    ] as Function
  )(
    { type: 'message.received', data: { message: recorded, sequence: 1, turnId: 't' } },
    {
      cancel: vi.fn(),
      channel: { kind: 'http', continuationToken: `${SLACK.channelName}:${address}` },
      session: { id: 'wrun_C1' },
    },
  )
  return { ...guard, recorded, token: recorded?.match(TOKEN)?.[0] ?? '' }
}

const ctx = {
  session: { id: 'wrun_C1' },
  callId: 'call_1',
  toolName: 'otp_send',
  messages: [],
} as never
const resolveEvents = (audit: AuditRecord[]) => audit.filter((e) => e.type === 'token.resolve')

describe('withTokenResolution — the happy path', () => {
  it('gives the tool the real value, and the model only tokens and masked results', async () => {
    slots.clear()
    const c = await conversation(`ขอ OTP ที่เบอร์ ${thaiDigits(PHONE)} ค่ะ`)
    expect(c.recorded).toMatch(TOKEN)
    expectNoLeak(c.recorded, [PHONE])

    const { tool, received } = otpSend()
    const guarded = withTokenResolution(tool, {
      guard: c.guard,
      sessionKey: SESSION_KEY,
      purpose: 'otp_send',
    })
    const result = await guarded.execute({ phone: c.token, note: 'ปกติ' }, ctx)

    // Inside the tool, and only there, the real value.
    expect(received).toEqual([{ phone: REAL, note: 'ปกติ' }])
    expect(result).toMatchObject({ sent: true })
    expectNoLeak(result, [PHONE])
    expect(JSON.stringify(result)).toMatch(TOKEN)
    expect(resolveEvents(c.audit)).toMatchObject([{ outcome: 'allowed', purpose: 'otp_send' }])
    expect(c.audit.at(-1)).toMatchObject({ type: 'scan', boundary: 'tool_output' })
    expectNoLeak(c.audit, [PHONE, SESSION_KEY])
  })

  it('keeps the description, schema and label, and resolves only the fields named', async () => {
    slots.clear()
    const c = await conversation(`เบอร์ ${PHONE}`)
    const { tool, received } = otpSend()
    const guarded = withTokenResolution(tool, {
      guard: c.guard,
      sessionKey: SESSION_KEY,
      purpose: 'otp_send',
      fields: ['phone'],
    })
    expect(guarded.description).toBe(tool.description)
    expect(guarded.inputSchema).toBe(tool.inputSchema)
    expect(guarded.label).toBe(tool.label)
    await guarded.execute({ phone: c.token, note: c.token }, ctx)
    expect(received).toEqual([{ phone: REAL, note: c.token }])
  })

  it('resolves a token written inside a sentence, and never changes the input', async () => {
    slots.clear()
    const c = await conversation(`เบอร์ ${PHONE}`)
    const { tool, received } = otpSend()
    const input = Object.freeze({ phone: `โทรหา ${c.token} นะ` })
    await withTokenResolution(tool, {
      guard: c.guard,
      sessionKey: SESSION_KEY,
      purpose: 'otp_send',
    }).execute(input, ctx)
    expect(received).toEqual([{ phone: `โทรหา ${REAL} นะ` }])
    expect(input.phone).toContain('[tok:')
  })

  it('masks every snapshot of a generator tool', async () => {
    slots.clear()
    const c = await conversation(`เบอร์ ${PHONE}`)
    const tool = defineTool({
      description: 'streams',
      inputSchema: { type: 'object', properties: { phone: { type: 'string' } } },
      async *execute(input: { phone: string }) {
        yield { step: 'start', to: input.phone }
        yield { step: 'done', to: input.phone }
      },
    })
    const out = withTokenResolution(tool, {
      guard: c.guard,
      sessionKey: SESSION_KEY,
      purpose: 'otp_send',
    }).execute({ phone: c.token }, ctx) as AsyncIterable<unknown>
    const items: unknown[] = []
    for await (const item of out) items.push(item)
    expect(items).toHaveLength(2)
    expectNoLeak(items, [PHONE])
  })

  it('turns a tool result that holds blocked data into a refusal', async () => {
    slots.clear()
    const c = await conversation('สวัสดี')
    const tool = defineTool({
      description: 'leaks',
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        return { card: '4111 1111 1111 1111' }
      },
    })
    const out = await withTokenResolution(tool, {
      guard: c.guard,
      sessionKey: SESSION_KEY,
      purpose: 'otp_send',
    }).execute({}, ctx)
    expect(out).toMatchObject({ ok: false, reason: 'blocked' })
    expectNoLeak(out, ['4111 1111 1111 1111'])
  })
})

describe('withTokenResolution — when the token cannot be used', () => {
  async function refused(c: Awaited<ReturnType<typeof conversation>>, purpose = 'otp_send') {
    const { tool, received } = otpSend()
    const out = await withTokenResolution(tool, {
      guard: c.guard,
      sessionKey: SESSION_KEY,
      purpose,
    }).execute({ phone: c.token }, ctx)
    expect(received).toEqual([])
    expectNoLeak([out, c.audit], [PHONE])
    expect(resolveEvents(c.audit)).toMatchObject([{ outcome: 'denied' }])
    return out
  }

  it('expired', async () => {
    slots.clear()
    vi.useFakeTimers({ toFake: ['Date'] })
    const short = definePolicy({
      entitySet: '0.1',
      entities: { PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'], ttlSec: 1 } },
    })
    const c = await conversation(`เบอร์ ${PHONE}`, makeGuard(short))
    vi.setSystemTime(Date.now() + 5_000)
    expect(await refused(c)).toEqual({
      ok: false,
      reason: 'expired',
      ask: expect.stringContaining('again'),
    })
  })

  it('a purpose the policy does not allow', async () => {
    slots.clear()
    const c = await conversation(`เบอร์ ${PHONE}`)
    expect(await refused(c, 'marketing')).toMatchObject({ ok: false, reason: 'not_allowed' })
  })

  it('a token from another chat', async () => {
    slots.clear()
    const g = makeGuard(TOKENISE)
    const other = await conversation(`เบอร์ ${PHONE}`, g, 'C2:1800.9')
    slots.clear()
    // This session's hook stores this chat's id; the token belongs to the other chat.
    const mine = await conversation('สวัสดี', g)
    expect(await refused({ ...mine, token: other.token })).toMatchObject({
      ok: false,
      reason: 'unknown',
    })
  })

  it('the token store is down', async () => {
    slots.clear()
    const memory = createMemoryTokenStore()
    let down = false
    const flaky: TokenStore = {
      sync: false,
      set: (id, rec) => memory.set(id, rec),
      get: (id) => (down ? Promise.reject(new Error('store down')) : memory.get(id)),
      delete: (id) => memory.delete(id),
      clearSession: (id) => memory.clearSession(id),
    }
    const c = await conversation(`เบอร์ ${PHONE}`, makeGuard(TOKENISE, flaky))
    down = true
    expect(await refused(c)).toMatchObject({ ok: false, reason: 'unavailable' })
  })
})
