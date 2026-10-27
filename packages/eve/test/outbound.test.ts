// The outbound side: withPdpaGuard masks what a channel posts. The channels here
// are real defineChannel values whose handlers record what they were given, the
// way a built-in channel's handlers post it.
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
const { slackChannel } = await import('eve/channels/slack')
const { telegramChannel } = await import('eve/channels/telegram')
const { teamsChannel } = await import('eve/channels/teams')
const { discordChannel } = await import('eve/channels/discord')
const { githubChannel } = await import('eve/channels/github')
const { linearChannel } = await import('eve/channels/linear')
const { derivePdpaSessionId, guardContent, pdpaHook, withPdpaGuard, withTokenResolution } =
  await import('../extension/lib/guard.js')
const { fakeArgs, post } = await import('./fakes.js')
const { expectNoLeak, makeGuard, PHONE, SESSION_KEY, thaiDigits, TOKEN, TOKENISE } = await import(
  './helpers.js'
)

const ctx = { session: { id: 'wrun_S1' } }
const CARD = '4111 1111 1111 1111'

type Posted = Record<string, unknown>[]

/**
 * A channel that posts like eve's built-ins: one handler per event type on its
 * adapter. A plain object: handlers built by defineChannel need eve's runtime
 * (outbound-eve.test.ts runs those).
 */
function channelThatPosts() {
  const posted: Record<string, Posted> = {}
  const record =
    (type: string) =>
    (data: Record<string, unknown>): void => {
      ;(posted[type] ??= []).push(data)
    }
  const channel = {
    routes: [
      {
        method: 'POST' as const,
        path: '/in',
        handler: async (request: Request, a: ReturnType<typeof fakeArgs>['args']) => {
          const { text } = (await request.json()) as { text: string }
          await a.from('C1:1800.1').send(text, { auth: null })
          return new Response('ok')
        },
      },
    ],
    adapter: {
      kind: 'fake',
      'message.completed': record('message.completed'),
      'input.requested': record('input.requested'),
      'input.resolved': record('input.resolved'),
      'actions.requested': record('actions.requested'),
      'action.result': record('action.result'),
      'reasoning.completed': record('reasoning.completed'),
      'turn.failed': record('turn.failed'),
    },
  }
  return { channel, posted }
}

/** The wrapped channel's handler for one event type, called as eve calls it. */
function handler(channel: { adapter?: object }, type: string) {
  const fn = (channel.adapter as Record<string, unknown> | undefined)?.[type]
  if (typeof fn !== 'function') throw new Error(`no handler for ${type}`)
  return (data: Record<string, unknown>) =>
    fn({ sequence: 1, stepIndex: 0, turnId: 't', ...data }, ctx) as Promise<void>
}

const fresh = (extra: Record<string, unknown> = {}) => {
  slots.clear()
  const t = makeGuard(TOKENISE)
  const { channel, posted } = channelThatPosts()
  const wrapped = withPdpaGuard(channel, {
    guard: t.guard,
    sessionKey: SESSION_KEY,
    channelName: 'slack',
    ...extra,
  })
  return { ...t, wrapped, posted }
}

/** A token issued in `conversation`, by the guard the test channel was wrapped with. */
async function tokenIn(guard: Parameters<typeof guardContent>[1]['guard'], conversation: string) {
  const sessionId = await derivePdpaSessionId(SESSION_KEY, conversation)
  const out = await guardContent(`เบอร์ ${PHONE}`, { guard, sessionId })
  return (out.blocked ? '' : out.content).match(TOKEN)?.[0] ?? ''
}

describe('tokenise end to end: a channel in, a tool, the same channel out', () => {
  it('the model reads a token, the tool the number, the customer the masked display', async () => {
    slots.clear()
    const { guard, audit } = makeGuard(TOKENISE)
    const opts = { guard, sessionKey: SESSION_KEY }

    // 1. Inbound through a wrapped channel that also posts.
    const { channel, posted } = channelThatPosts()
    const { args, calls } = fakeArgs()
    const slack = withPdpaGuard(channel, { ...opts, channelName: 'slack' })
    await (slack.routes[0]?.handler as never as Function)(
      post({ text: `ขอ OTP ที่เบอร์ ${thaiDigits(PHONE)} ค่ะ` }, '/in'),
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

    // 4. The model answers with the token; the channel posts the masked display.
    await handler(
      slack,
      'message.completed',
    )({
      message: `ส่ง OTP ไปที่ ${token} แล้วค่ะ`,
      finishReason: 'stop',
    })
    expect(posted['message.completed']).toEqual([
      expect.objectContaining({ message: 'ส่ง OTP ไปที่ xxx-xxx-๗๗๗๗ แล้วค่ะ' }),
    ])

    expectNoLeak([recorded, result, posted, audit], [PHONE, SESSION_KEY])
    expect(
      audit.filter((e) => e.type === 'scan').map((e) => (e as { boundary: string }).boundary),
    ).toEqual(['inbound', 'inbound', 'tool_output', 'outbound'])
  })
})

describe('withPdpaGuard — the reply', () => {
  it('turns a token from another chat into the placeholder', async () => {
    const t = fresh()
    const token = await tokenIn(t.guard, 'slack:C2:1800.2')
    await handler(
      t.wrapped,
      'message.completed',
    )({
      message: `เบอร์คือ ${token}`,
      finishReason: 'stop',
    })
    expect(t.posted['message.completed']).toEqual([
      expect.objectContaining({ message: 'เบอร์คือ [ข้อมูลที่ปิดไว้]' }),
    ])
  })

  it('rewrites the narration before a tool call too, and replaces a blocked reply', async () => {
    const t = fresh()
    await handler(
      t.wrapped,
      'message.completed',
    )({
      message: `โทรหา ${PHONE} ก่อน`,
      finishReason: 'tool-calls',
    })
    await handler(
      t.wrapped,
      'message.completed',
    )({
      message: `บัตร ${CARD}`,
      finishReason: 'stop',
    })
    const [narration, blocked] = t.posted['message.completed'] ?? []
    expectNoLeak([narration, blocked], [PHONE, CARD])
    expect(blocked).toMatchObject({ message: expect.stringContaining('ส่งในแชตไม่ได้') })
  })

  it('leaves an event with no message as it is, and keeps the rest of the event', async () => {
    const t = fresh()
    await handler(t.wrapped, 'message.completed')({ finishReason: 'stop' })
    expect(t.posted['message.completed']).toEqual([
      { sequence: 1, stepIndex: 0, turnId: 't', finishReason: 'stop' },
    ])
    expect(t.audit.filter((e) => e.type === 'scan')).toEqual([])
  })

  it('masks under the session id the channel issued its tokens with', async () => {
    const t = fresh()
    const token = await tokenIn(t.guard, 'session:wrun_S1')
    await handler(
      t.wrapped,
      'message.completed',
    )({ message: `เบอร์ ${token}`, finishReason: 'stop' })
    expect(t.posted['message.completed']).toEqual([
      expect.objectContaining({ message: expect.stringContaining('xxx-xxx-7777') }),
    ])
  })
})

describe('withPdpaGuard — questions, approvals and tool labels', () => {
  it('masks the prompt, the choices and the input of the call an approval gates', async () => {
    const t = fresh()
    const token = await tokenIn(t.guard, 'session:wrun_S1')
    await handler(
      t.wrapped,
      'input.requested',
    )({
      requests: [
        {
          requestId: 'req_1',
          kind: 'tool-approval',
          prompt: `ส่ง OTP ไปที่ ${token}?`,
          options: [
            { id: 'approve', label: 'อนุมัติ' },
            { id: 'other', label: `ส่งไป ${token}`, description: `ใช้ ${token}` },
          ],
          action: {
            callId: 'c1',
            kind: 'tool-call',
            toolName: 'otp_send',
            input: { phone: token, nested: [{ to: token }] },
          },
        },
      ],
    })
    const [event] = t.posted['input.requested'] ?? []
    const [request] = (event?.requests ?? []) as Record<string, any>[]
    expect(request?.prompt).toBe('ส่ง OTP ไปที่ xxx-xxx-7777?')
    expect(request?.options[0]).toEqual({ id: 'approve', label: 'อนุมัติ' })
    expect(request?.options[1]).toEqual({
      id: 'other',
      label: 'ส่งไป xxx-xxx-7777',
      description: 'ใช้ xxx-xxx-7777',
    })
    expect(request?.action.input).toEqual({
      phone: 'xxx-xxx-7777',
      nested: [{ to: 'xxx-xxx-7777' }],
    })
    expect(request?.requestId).toBe('req_1')
    expectNoLeak(event, [token])
  })

  it('masks the label a tool shows while it runs, and a typed answer shown back', async () => {
    const t = fresh()
    const token = await tokenIn(t.guard, 'session:wrun_S1')
    await handler(
      t.wrapped,
      'actions.requested',
    )({
      actions: [],
      presentation: { c1: { label: `ส่ง OTP ไป ${token}` }, c2: {} },
    })
    await handler(
      t.wrapped,
      'action.result',
    )({
      result: { callId: 'c1' },
      presentation: { c1: { label: `ส่งแล้ว ${token}` } },
    })
    await handler(
      t.wrapped,
      'input.resolved',
    )({
      resolutions: [
        {
          requestId: 'r',
          kind: 'question',
          outcome: 'answered',
          response: { requestId: 'r', text: token },
        },
        {
          requestId: 's',
          kind: 'tool-approval',
          outcome: 'approved',
          response: { requestId: 's', optionId: 'approve' },
        },
      ],
    })
    expect(t.posted['actions.requested']?.[0]?.presentation).toEqual({
      c1: { label: 'ส่ง OTP ไป xxx-xxx-7777' },
      c2: {},
    })
    expect(t.posted['action.result']?.[0]?.presentation).toEqual({
      c1: { label: 'ส่งแล้ว xxx-xxx-7777' },
    })
    expect(t.posted['input.resolved']?.[0]?.resolutions).toEqual([
      expect.objectContaining({ response: { requestId: 'r', text: 'xxx-xxx-7777' } }),
      expect.objectContaining({ response: { requestId: 's', optionId: 'approve' } }),
    ])
    expectNoLeak(t.posted, [token])
  })

  it('masks a finished reasoning block', async () => {
    const t = fresh()
    await handler(t.wrapped, 'reasoning.completed')({ reasoning: `ลูกค้าให้ ${PHONE} มา` })
    expectNoLeak(t.posted, [PHONE])
  })
})

describe("withPdpaGuard — eve's built-in channels", () => {
  // The handlers are built by eve and need its runtime to run: outbound-eve.test.ts
  // runs one. Here: each channel has the handlers that carry text, and they are replaced.
  it.each([
    ['slack', () => slackChannel()],
    ['telegram', () => telegramChannel()],
    ['teams', () => teamsChannel()],
    ['discord', () => discordChannel()],
    ['github', () => githubChannel()],
    ['linear', () => linearChannel()],
  ])('%s: its reply and its questions are masked before it posts them', (name, build) => {
    const channel = build() as { adapter: Record<string, unknown>; routes: never[] }
    const wrapped = withPdpaGuard(channel as never, {
      guard: makeGuard(TOKENISE).guard,
      sessionKey: SESSION_KEY,
      channelName: name,
    }) as unknown as { adapter: Record<string, unknown> }
    for (const type of ['message.completed', 'input.requested']) {
      expect(typeof channel.adapter[type]).toBe('function')
      expect(wrapped.adapter[type]).not.toBe(channel.adapter[type])
    }
    expect(wrapped.adapter['turn.failed']).toBe(channel.adapter['turn.failed'])
    expect(Object.keys(wrapped.adapter).sort()).toEqual(Object.keys(channel.adapter).sort())
  })
})

describe('withPdpaGuard — what it leaves alone', () => {
  it('keeps handlers for events that carry no personal text, and adds none the channel lacks', () => {
    const { channel } = channelThatPosts()
    const wrapped = withPdpaGuard(channel, {
      guard: makeGuard(TOKENISE).guard,
      sessionKey: SESSION_KEY,
      channelName: 'slack',
    })
    const before = channel.adapter as Record<string, unknown>
    const after = wrapped.adapter as Record<string, unknown>
    expect(after['turn.failed']).toBe(before['turn.failed'])
    expect(after['message.completed']).not.toBe(before['message.completed'])
    expect(after.kind).toBe('fake')
    expect(after['reasoning.appended']).toBeUndefined()
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
  })

  it('hands back the adapter itself when nothing in it posts text', () => {
    const channel = { routes: [], adapter: { kind: 'fake', 'turn.failed': () => {} } }
    const wrapped = withPdpaGuard(channel, {
      guard: makeGuard(TOKENISE).guard,
      sessionKey: SESSION_KEY,
      channelName: 'slack',
    })
    expect(wrapped.adapter).toBe(channel.adapter)
  })

  it('leaves the channel as it is under outbound: false', () => {
    const { channel } = channelThatPosts()
    const wrapped = withPdpaGuard(channel, {
      guard: makeGuard(TOKENISE).guard,
      sessionKey: SESSION_KEY,
      channelName: 'slack',
      outbound: false,
    })
    expect(wrapped.adapter).toBe(channel.adapter)
  })

  it('posts nothing when the guard cannot answer', async () => {
    slots.clear()
    const { channel, posted } = channelThatPosts()
    const broken = {
      ...makeGuard(TOKENISE).guard,
      process: async () => {
        throw new Error('token store is down')
      },
    }
    const wrapped = withPdpaGuard(channel, {
      guard: broken as never,
      sessionKey: SESSION_KEY,
      channelName: 'slack',
    })
    await expect(
      handler(wrapped, 'message.completed')({ message: `เบอร์ ${PHONE}`, finishReason: 'stop' }),
    ).rejects.toThrow('token store is down')
    expect(posted['message.completed']).toBeUndefined()
  })
})
