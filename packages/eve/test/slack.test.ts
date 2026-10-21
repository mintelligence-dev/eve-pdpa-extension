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
  pdpaSlackRenderer,
  withPdpaGuard,
  withTokenResolution,
} = await import('../extension/lib/guard.js')
const { fakeArgs, post } = await import('./fakes.js')
const { expectNoLeak, makeGuard, PHONE, SESSION_KEY, thaiDigits, TOKEN, TOKENISE } = await import(
  './helpers.js'
)

const ctx = { session: { id: 'wrun_S1' } }
type Next = ReturnType<typeof vi.fn>

/** The renderer's message.completed handler, called as eve's Slack channel does. */
async function render(
  renderer: ReturnType<typeof pdpaSlackRenderer>,
  data: Record<string, unknown>,
): Promise<Next> {
  const next = vi.fn(async () => {})
  const handler = renderer.events?.['message.completed'] as Function
  await handler(
    { sequence: 1, stepIndex: 0, turnId: 't', ...data },
    { thread: {}, slack: {} },
    ctx,
    next,
  )
  return next
}

describe('tokenise end to end: Slack in, tool, Slack out', () => {
  it('the model reads a token, the tool the number, the customer the masked display', async () => {
    slots.clear()
    const { guard, audit } = makeGuard(TOKENISE)
    const opts = { guard, sessionKey: SESSION_KEY }

    // 1. Inbound through a wrapped Slack-shaped channel.
    const { args, calls } = fakeArgs()
    const slack = withPdpaGuard(
      {
        routes: [
          {
            method: 'POST' as const,
            path: '/slack/events',
            handler: async (request: Request, a: typeof args) => {
              const { text } = (await request.json()) as { text: string }
              await a.from('C1:1800.1').send(text, { auth: null })
              return new Response('ok')
            },
          },
        ],
      },
      { ...opts, channelName: 'slack' },
    )
    await (slack.routes[0]?.handler as never as Function)(
      post({ text: `ขอ OTP ที่เบอร์ ${thaiDigits(PHONE)} ค่ะ` }, '/slack/events'),
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
        channel: { kind: 'http', continuationToken: 'slack:C1:1800.1' },
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

    // 4. The model answers with the token; the Slack renderer rewrites it.
    const next = await render(pdpaSlackRenderer(opts), {
      message: `ส่ง OTP ไปที่ ${token} แล้วค่ะ`,
      finishReason: 'stop',
    })
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'ส่ง OTP ไปที่ xxx-xxx-๗๗๗๗ แล้วค่ะ' }),
    )

    expectNoLeak([recorded, result, next.mock.calls, audit], [PHONE, SESSION_KEY])
    expect(
      audit.filter((e) => e.type === 'scan').map((e) => (e as { boundary: string }).boundary),
    ).toEqual(['inbound', 'inbound', 'tool_output', 'outbound'])
  })
})

describe('pdpaSlackRenderer', () => {
  it('turns a token from another chat into the placeholder', async () => {
    slots.clear()
    const { guard } = makeGuard(TOKENISE)
    const other = await derivePdpaSessionId(SESSION_KEY, 'slack:C2:1800.2')
    const out = await guardContent(`เบอร์ ${PHONE}`, { guard, sessionId: other })
    const token = (out.blocked ? '' : out.content).match(TOKEN)?.[0]
    const next = await render(pdpaSlackRenderer({ guard, sessionKey: SESSION_KEY }), {
      message: `เบอร์คือ ${token}`,
      finishReason: 'stop',
    })
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'เบอร์คือ [ข้อมูลที่ปิดไว้]' }))
  })

  it('rewrites the narration before a tool call too, and replaces a blocked reply', async () => {
    slots.clear()
    const { guard } = makeGuard(TOKENISE)
    const renderer = pdpaSlackRenderer({ guard, sessionKey: SESSION_KEY })
    const narration = await render(renderer, {
      message: `โทรหา ${PHONE} ก่อน`,
      finishReason: 'tool-calls',
    })
    expectNoLeak(narration.mock.calls, [PHONE])
    const blocked = await render(renderer, {
      message: 'บัตร 4111 1111 1111 1111',
      finishReason: 'stop',
    })
    expect(blocked).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('ส่งในแชตไม่ได้') }),
    )
    expectNoLeak(blocked.mock.calls, ['4111 1111 1111 1111'])
  })

  it('leaves an event with no message to eve’s default', async () => {
    const { guard } = makeGuard(TOKENISE)
    const next = await render(pdpaSlackRenderer({ guard, sessionKey: SESSION_KEY }), {
      finishReason: 'stop',
    })
    expect(next).toHaveBeenCalledWith()
  })
})
