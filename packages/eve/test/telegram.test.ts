import { describe, expect, it, vi } from 'vitest'

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
const {
  derivePdpaSessionId,
  guardContent,
  pdpaHook,
  pdpaTelegramEvents,
  withPdpaGuard,
  withTokenResolution,
} = await import('../extension/lib/guard.js')
const { fakeArgs, post } = await import('./fakes.js')
const { expectNoLeak, makeGuard, PHONE, SESSION_KEY, thaiDigits, TOKEN, TOKENISE } = await import(
  './helpers.js'
)

const ctx = { session: { id: 'wrun_T1' } }

/** The message.completed handler, called as eve's Telegram channel does; returns what it posted. */
async function deliver(
  events: ReturnType<typeof pdpaTelegramEvents>,
  data: Record<string, unknown>,
): Promise<unknown[]> {
  const posted: unknown[] = []
  const handler = events['message.completed'] as Function
  await handler(
    { sequence: 1, stepIndex: 0, turnId: 't', ...data },
    { state: {}, telegram: { post: async (m: unknown) => void posted.push(m) } },
    ctx,
  )
  return posted
}

describe('tokenise end to end: Telegram in, tool, Telegram out', () => {
  it('the model reads a token, the tool the number, the customer the masked display', async () => {
    slots.clear()
    const { guard, audit } = makeGuard(TOKENISE)
    const opts = { guard, sessionKey: SESSION_KEY }

    // 1. Inbound through a wrapped Telegram-shaped channel.
    const { args, calls } = fakeArgs()
    const telegram = withPdpaGuard(
      {
        routes: [
          {
            method: 'POST' as const,
            path: '/eve/v1/telegram',
            handler: async (request: Request, a: typeof args) => {
              const { text } = (await request.json()) as { text: string }
              await a.from('12345').send(text, { auth: null })
              return new Response('ok')
            },
          },
        ],
      },
      { ...opts, channelName: 'telegram' },
    )
    await (telegram.routes[0]?.handler as never as Function)(
      post({ text: `ขอ OTP ที่เบอร์ ${thaiDigits(PHONE)} ค่ะ` }, '/eve/v1/telegram'),
      args,
    )
    const recorded = calls[0]?.message as string
    const token = recorded.match(TOKEN)?.[0] ?? ''
    expect(token).not.toBe('')

    // 2. eve records it and runs the agent's hook in the session.
    await (pdpaHook(opts).events?.['message.received'] as Function)(
      { type: 'message.received', data: { message: recorded, sequence: 1, turnId: 't' } },
      {
        cancel: vi.fn(),
        channel: { kind: 'http', continuationToken: 'telegram:12345' },
        session: ctx.session,
      },
    )

    // 3. The model calls otp_send with the token.
    const seenByTool: string[] = []
    const otp = withTokenResolution(
      defineTool({
        description: 'Send an OTP',
        inputSchema: { type: 'object', properties: { phone: { type: 'string' } } },
        async execute(input: { phone: string }) {
          seenByTool.push(input.phone)
          return { sent: true, to: input.phone }
        },
      }),
      { ...opts, purpose: 'otp_send' },
    )
    const result = await otp.execute({ phone: token }, {
      ...ctx,
      callId: 'c',
      toolName: 'otp_send',
      messages: [],
    } as never)
    expect(seenByTool).toEqual(['0918887777'])

    // 4. The model answers with the token; the Telegram handler posts it masked.
    const posted = await deliver(pdpaTelegramEvents(opts), {
      message: `ส่ง OTP ไปที่ ${token} แล้วค่ะ`,
      finishReason: 'stop',
    })
    expect(posted).toEqual(['ส่ง OTP ไปที่ xxx-xxx-๗๗๗๗ แล้วค่ะ'])

    expectNoLeak([recorded, result, posted, audit], [PHONE, SESSION_KEY])
    expect(
      audit.filter((e) => e.type === 'scan').map((e) => (e as { boundary: string }).boundary),
    ).toEqual(['inbound', 'inbound', 'tool_output', 'outbound'])
  })
})

describe('pdpaTelegramEvents', () => {
  it('turns a token from another chat into the placeholder', async () => {
    slots.clear()
    const { guard } = makeGuard(TOKENISE)
    const other = await derivePdpaSessionId(SESSION_KEY, 'telegram:67890')
    const out = await guardContent(`เบอร์ ${PHONE}`, { guard, sessionId: other })
    const token = (out.blocked ? '' : out.content).match(TOKEN)?.[0]
    const posted = await deliver(pdpaTelegramEvents({ guard, sessionKey: SESSION_KEY }), {
      message: `เบอร์คือ ${token}`,
      finishReason: 'stop',
    })
    expect(posted).toEqual(['เบอร์คือ [ข้อมูลที่ปิดไว้]'])
  })

  it('replaces a blocked reply with the notice', async () => {
    slots.clear()
    const { guard } = makeGuard(TOKENISE)
    const posted = await deliver(pdpaTelegramEvents({ guard, sessionKey: SESSION_KEY }), {
      message: 'บัตร 4111 1111 1111 1111',
      finishReason: 'stop',
    })
    expect(posted).toEqual([expect.stringContaining('ส่งในแชตไม่ได้')])
    expectNoLeak(posted, ['4111 1111 1111 1111'])
  })

  it('posts nothing for the narration before a tool call, or an event with no message, as eve does', async () => {
    const { guard, audit } = makeGuard(TOKENISE)
    const events = pdpaTelegramEvents({ guard, sessionKey: SESSION_KEY })
    expect(
      await deliver(events, { message: `โทรหา ${PHONE} ก่อน`, finishReason: 'tool-calls' }),
    ).toEqual([])
    expect(await deliver(events, { finishReason: 'stop' })).toEqual([])
    expect(audit.filter((e) => e.type === 'scan')).toEqual([])
  })

  it('refuses a missing guard or a short session key when created', () => {
    const { guard } = makeGuard(TOKENISE)
    expect(() =>
      pdpaTelegramEvents({ guard: undefined as never, sessionKey: SESSION_KEY }),
    ).toThrow()
    expect(() => pdpaTelegramEvents({ guard, sessionKey: 'short' })).toThrow(/sessionKey/)
  })
})
