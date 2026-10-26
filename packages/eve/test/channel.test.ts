import type { UserContent } from 'ai'
import { defineChannel, POST, type RouteDefinition, WS } from 'eve/channels'
import { describe, expect, it, vi } from 'vitest'
import {
  type BlockInfo,
  derivePdpaSessionId,
  PdpaBlockedError,
  withPdpaGuard,
} from '../extension/lib/guard.js'
import { type AnyArgs, eveLike, fakeArgs, type Handler, post } from './fakes.js'
import {
  dashed,
  EMAIL,
  expectNoLeak,
  MASK,
  makeGuard,
  PHONE,
  SESSION_KEY,
  syntheticId,
} from './helpers.js'

const ID = syntheticId(5)
const CARD = '4111 1111 1111 1111'

/** A channel shaped like eve's built-ins: one route that hands the body to from().send(). */
function fakeChannel() {
  const adapter = { kind: 'fake' }
  const events = { 'message.completed': vi.fn() }
  const route = {
    transport: 'http' as const,
    method: 'POST' as const,
    path: '/m',
    handler: async (request: Request, args: AnyArgs) => {
      const body = (await request.json()) as { message: UserContent; context?: string[] }
      await args
        .from('C1:1800.1')
        .send(body.message, { auth: null, state: { x: 1 }, context: body.context, title: 'ช่วยด้วย' })
      return new Response('ok')
    },
  }
  return { __kind: 'channel', adapter, events, turnPolicy: 'queue', routes: [route] }
}

const handlerOf = (channel: { routes: readonly unknown[] }, i = 0): Handler =>
  (channel.routes[i] as { handler: Handler }).handler

function options(extra: Record<string, unknown> = {}) {
  const t = makeGuard(MASK)
  return { t, opts: { guard: t.guard, sessionKey: SESSION_KEY, channelName: 'fake', ...extra } }
}

describe('withPdpaGuard — from(address).send()', () => {
  it('sends the masked message, context and title, and never the original', async () => {
    const { args, calls } = fakeArgs()
    const { t, opts } = options()
    const res = await handlerOf(withPdpaGuard(fakeChannel(), opts))(
      post({ message: `เลขบัตร ${dashed(ID)} โทร ${PHONE}`, context: [`อีเมลลูกค้า ${EMAIL}`] }),
      args,
    )
    expect(res.status).toBe(200)
    expect(calls).toEqual([
      {
        via: 'from',
        message: 'เลขบัตร [เลขบัตรประชาชน] โทร xxx-xxx-7777',
        options: { auth: null, state: { x: 1 }, context: ['อีเมลลูกค้า [อีเมล]'], title: 'ช่วยด้วย' },
      },
    ])
    // The session id core sees is derived from "<channel>:<address>", never the address.
    const expected = await derivePdpaSessionId(SESSION_KEY, 'fake:C1:1800.1')
    const scans = t.audit.filter((e) => e.type === 'scan')
    expect(new Set(scans.map((e) => e.sessionId))).toEqual(new Set([expected]))
    expectNoLeak([calls, t.audit], [ID, PHONE, EMAIL])
  })

  it('stops a blocked message: no send, onBlock once, PdpaBlockedError', async () => {
    const { args, calls } = fakeArgs()
    const blocks: BlockInfo[] = []
    const { opts } = options({ onBlock: (info: BlockInfo) => void blocks.push(info) })
    const sent = handlerOf(withPdpaGuard(fakeChannel(), opts))(
      post({ message: `บัตร ${CARD} ครับ` }),
      args,
    )
    await expect(sent).rejects.toBeInstanceOf(PdpaBlockedError)
    await expect(sent).rejects.toMatchObject({ code: 'PDPA_BLOCKED' })
    expect(calls).toEqual([])
    expect(blocks).toEqual([
      { reason: expect.stringContaining('เลขบัตรเครดิต'), blockedBy: ['CREDIT_CARD'] },
    ])
    await sent.catch((error: unknown) => expectNoLeak([error, blocks], [CARD]))
  })

  it('puts a failing onBlock behind the PdpaBlockedError as its cause', async () => {
    const broken = new Error('notice failed')
    const { opts } = options({
      onBlock: async () => {
        throw broken
      },
    })
    await expect(
      handlerOf(withPdpaGuard(fakeChannel(), opts))(
        post({ message: `บัตร ${CARD}` }),
        fakeArgs().args,
      ),
    ).rejects.toMatchObject({ name: 'PdpaBlockedError', cause: broken })
  })
})

describe('withPdpaGuard — the other operations', () => {
  function channelUsing(use: (args: AnyArgs, message: string) => Promise<unknown>) {
    return {
      routes: [
        {
          method: 'POST' as const,
          path: '/op',
          handler: async (request: Request, args: AnyArgs) => {
            await use(args, ((await request.json()) as { message: string }).message)
            return new Response('ok')
          },
        },
      ],
    }
  }

  it('guards attachSession(id).send() under the id of that eve session', async () => {
    const { args, calls } = fakeArgs()
    const { t, opts } = options()
    await handlerOf(
      withPdpaGuard(
        channelUsing((a, m) => a.attachSession('wrun_9').send(m, { auth: null })),
        opts,
      ),
    )(post({ message: `โทร ${PHONE}` }), args)
    expect(calls).toEqual([
      { via: 'attachSession', message: 'โทร xxx-xxx-7777', options: { auth: null } },
    ])
    const expected = await derivePdpaSessionId(SESSION_KEY, 'session:wrun_9')
    expect(t.audit.at(-1)).toMatchObject({ type: 'scan', sessionId: expected })
  })

  it('guards to(channel, target).send()', async () => {
    const { args, calls } = fakeArgs()
    const { opts } = options()
    await handlerOf(
      withPdpaGuard(
        channelUsing((a, m) => a.to('slack', { channelId: 'C9' }).send(m, { auth: null })),
        opts,
      ),
    )(post({ message: `เมล ${EMAIL}` }), args)
    expect(calls).toEqual([{ via: 'to', message: 'เมล [อีเมล]', options: { auth: null } }])
  })

  it('passes a respond() of ids only, and the other operations, through untouched', async () => {
    const { args, respond, cancel } = fakeArgs()
    const responses = [{ requestId: 'req_1', optionId: 'approve' }]
    const { opts } = options()
    await handlerOf(
      withPdpaGuard(
        channelUsing(async (a) => {
          await a.from('C1').respond(responses, { auth: null })
          await a.from('C1').cancel()
        }),
        opts,
      ),
    )(post({ message: 'x' }), args)
    expect(respond.mock.calls[0]?.[0]).toBe(responses)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('masks the free text of respond() and its context; ids pass as they are', async () => {
    const { args, respond } = fakeArgs()
    const { t, opts } = options()
    const responses = [
      { requestId: 'req_1', optionId: 'approve' },
      { requestId: 'req_2', text: `โทรกลับที่ ${PHONE}` },
      { requestId: 'req_3', optionId: 'cancel', text: `ส่งไปที่ ${EMAIL} แทน` },
    ]
    const before = structuredClone(responses)
    await handlerOf(
      withPdpaGuard(
        channelUsing((a) =>
          a.from('C1:1800.1').respond(responses, { auth: null, context: [`เลขบัตร ${dashed(ID)}`] }),
        ),
        opts,
      ),
    )(post({ message: 'x' }), args)
    expect(respond.mock.calls).toEqual([
      [
        [
          { requestId: 'req_1', optionId: 'approve' },
          { requestId: 'req_2', text: 'โทรกลับที่ xxx-xxx-7777' },
          { requestId: 'req_3', optionId: 'cancel', text: 'ส่งไปที่ [อีเมล] แทน' },
        ],
        { auth: null, context: ['เลขบัตร [เลขบัตรประชาชน]'] },
      ],
    ])
    expect(responses).toEqual(before)
    const expected = await derivePdpaSessionId(SESSION_KEY, 'fake:C1:1800.1')
    expect(t.audit.filter((e) => e.type === 'scan').every((e) => e.sessionId === expected)).toBe(
      true,
    )
    expectNoLeak([respond.mock.calls, t.audit], [ID, PHONE, EMAIL])
  })

  it('stops a blocked answer: respond() never called, onBlock once, PdpaBlockedError', async () => {
    const { args, respond } = fakeArgs()
    const onBlock = vi.fn()
    const { opts } = options({ onBlock })
    const answered = handlerOf(
      withPdpaGuard(
        channelUsing((a) =>
          a
            .attachSession('wrun_1')
            .respond([{ requestId: 'req_1', optionId: 'cancel', text: `ใช้บัตร ${CARD}` }], {
              auth: null,
            }),
        ),
        opts,
      ),
    )(post({ message: 'x' }), args)
    await expect(answered).rejects.toBeInstanceOf(PdpaBlockedError)
    expect(respond).not.toHaveBeenCalled()
    expect(onBlock).toHaveBeenCalledOnce()
    await answered.catch((error: unknown) => expectNoLeak([error, onBlock.mock.calls], [CARD]))
  })

  it('keeps every other route argument, eve internals included', async () => {
    const { args } = fakeArgs()
    let seen: AnyArgs | undefined
    const { opts } = options()
    await handlerOf(
      withPdpaGuard(
        channelUsing(async (a) => void (seen = a)),
        opts,
      ),
    )(post({ message: 'x' }), args)
    for (const k of [
      'resolveSession',
      'params',
      'waitUntil',
      'describe',
      'invokeTool',
      '__eveRouteSessionCreator',
    ] as const) {
      expect(seen?.[k]).toBe(args[k])
    }
  })
})

describe('withPdpaGuard — the channel value', () => {
  it('keeps method, path, transport and every non-route field', () => {
    const original = fakeChannel()
    const marker = Symbol('build-metadata')
    const withSymbol = Object.assign(original, { [marker]: { manifest: true } })
    const wrapped = withPdpaGuard(withSymbol, options().opts)
    expect(wrapped.adapter).toBe(original.adapter)
    expect(wrapped.events).toBe(original.events)
    expect(wrapped.turnPolicy).toBe('queue')
    expect(wrapped[marker]).toEqual({ manifest: true })
    expect(wrapped.routes.map(({ transport, method, path }) => [transport, method, path])).toEqual(
      original.routes.map(({ transport, method, path }) => [transport, method, path]),
    )
  })

  it('wraps a real defineChannel value and a WebSocket route', async () => {
    const channel = defineChannel({
      routes: [
        POST('/threads/:threadId/messages', async (request, { from, params }) => {
          const body = (await request.json()) as { message: string }
          await from(params.threadId ?? '').send(body.message, { auth: null })
          return new Response('ok')
        }),
        WS('/voice/ws', async (_req, { from }) => ({
          async message(_peer, message) {
            await from('voice-1').send(message.text(), { auth: null })
          },
        })),
      ],
    })
    const wrapped = withPdpaGuard(channel, options().opts)
    expect(Object.keys(wrapped).sort()).toEqual(Object.keys(channel).sort())
    expect(wrapped.routes.map((r) => [r.method, r.path, r.transport])).toEqual(
      channel.routes.map((r) => [r.method, r.path, r.transport]),
    )
    const { args, calls } = fakeArgs()
    await ((wrapped.routes[0] as RouteDefinition).handler as unknown as Handler)(
      post({ message: `โทร ${PHONE}` }),
      args,
    )
    const hooks = await (
      wrapped.routes[1]?.handler as unknown as (r: Request, a: AnyArgs) => Promise<any>
    )(new Request('http://127.0.0.1/voice/ws'), args)
    await hooks.message({}, { text: () => `เลขบัตร ${dashed(ID)}` })
    expect(calls.map((c) => c.message)).toEqual(['โทร xxx-xxx-7777', 'เลขบัตร [เลขบัตรประชาชน]'])
  })

  it('guards hand-offs from other channels, which arrive through receive()', async () => {
    const { args, calls } = fakeArgs()
    const channel = {
      routes: [],
      receive: async (input: { message: string }, ctx: { from: AnyArgs['from'] }) =>
        ctx.from('C7').send(input.message, { auth: null }) as never,
    }
    const wrapped = withPdpaGuard(channel, options().opts)
    await wrapped.receive?.(
      { message: `โทร ${PHONE}` },
      { from: args.from, resolveSession: args.resolveSession },
    )
    expect(calls).toEqual([{ via: 'from', message: 'โทร xxx-xxx-7777', options: { auth: null } }])
  })

  it('refuses options it cannot run with, at wrap time and without echoing secrets', () => {
    const { guard } = makeGuard(MASK)
    expect(() => withPdpaGuard(fakeChannel(), { guard, sessionKey: SESSION_KEY })).toThrow(
      /channelName is required/,
    )
    expect(() =>
      withPdpaGuard(fakeChannel(), { guard, sessionKey: 'short', channelName: 'x' }),
    ).toThrow(/32 bytes/)
    expect(() =>
      withPdpaGuard(fakeChannel(), {
        guard: {} as never,
        sessionKey: SESSION_KEY,
        channelName: 'x',
      }),
    ).toThrow(/createGuard/)
  })
})

describe('withPdpaGuard — eve HTTP message routes', () => {
  it('creates the session first, then sends the masked message to it', async () => {
    const { channel, seen } = eveLike({ readyAfter: 2 })
    const { t, opts } = options({ channelName: undefined })
    const res = await handlerOf(withPdpaGuard(channel, opts))(
      post(
        {
          message: `เลขบัตร ${dashed(ID)}`,
          clientContext: { customer: { email: EMAIL, phone: PHONE }, plan: 'gold' },
          outputSchema: { type: 'object' },
        },
        '/eve/v1/session',
      ),
      fakeArgs().args,
    )
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ ok: true, sessionId: 'wrun_T1', status: 'accepted' })
    expect(seen.map((s) => [s.path, s.body])).toEqual([
      ['/eve/v1/session', {}],
      [
        '/eve/v1/session/wrun_T1',
        {
          message: 'เลขบัตร [เลขบัตรประชาชน]',
          clientContext: { customer: { email: '[อีเมล]', phone: 'xxx-xxx-7777' }, plan: 'gold' },
          outputSchema: { type: 'object' },
        },
      ],
    ])
    const expected = await derivePdpaSessionId(SESSION_KEY, 'session:wrun_T1')
    expect(t.audit.filter((e) => e.type === 'scan').every((e) => e.sessionId === expected)).toBe(
      true,
    )
    expectNoLeak([seen, t.audit], [ID, EMAIL, PHONE])
  })

  it('masks a follow-up under the session in its path, and leaves eve its own args', async () => {
    const { channel, seen } = eveLike()
    const { args, calls } = fakeArgs()
    args.params = { sessionId: 'wrun_T7' }
    const { t, opts } = options({ channelName: undefined })
    const file = { type: 'file', mediaType: 'application/pdf', data: 'JVBERi0=' }
    await handlerOf(withPdpaGuard(channel, opts), 1)(
      post(
        { message: [{ type: 'text', text: `โทร ${PHONE}` }, file], clientContext: [EMAIL, 'ok'] },
        '/eve/v1/session/wrun_T7',
      ),
      args,
    )
    expect(seen[0]?.body).toEqual({
      message: [{ type: 'text', text: 'โทร xxx-xxx-7777' }, file],
      clientContext: ['[อีเมล]', 'ok'],
    })
    expect(seen[0]?.args).toBe(args)
    expect(calls).toEqual([])
    expect(t.audit.at(-1)).toMatchObject({
      sessionId: await derivePdpaSessionId(SESSION_KEY, 'session:wrun_T7'),
    })
  })

  it('masks the free text of inputResponses on a follow-up, and refuses a blocked one', async () => {
    const { channel, seen } = eveLike()
    const { args } = fakeArgs()
    args.params = { sessionId: 'wrun_T7' }
    const onBlock = vi.fn()
    const { t, opts } = options({ channelName: undefined, onBlock })
    const follow = handlerOf(withPdpaGuard(channel, opts), 1)
    await follow(
      post(
        {
          inputResponses: [
            { requestId: 'req_1', optionId: 'approve' },
            { requestId: 'req_2', text: `เบอร์ ${PHONE}` },
          ],
          clientContext: EMAIL,
        },
        '/eve/v1/session/wrun_T7',
      ),
      args,
    )
    expect(seen[0]?.body).toEqual({
      inputResponses: [
        { requestId: 'req_1', optionId: 'approve' },
        { requestId: 'req_2', text: 'เบอร์ xxx-xxx-7777' },
      ],
      clientContext: '[อีเมล]',
    })
    expect(t.audit.at(-1)).toMatchObject({
      sessionId: await derivePdpaSessionId(SESSION_KEY, 'session:wrun_T7'),
    })

    const res = await follow(
      post(
        { inputResponses: [{ requestId: 'req_3', text: `บัตร ${CARD}` }] },
        '/eve/v1/session/wrun_T7',
      ),
      args,
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, code: 'pdpa_blocked' })
    expect(seen).toHaveLength(1)
    expect(onBlock).toHaveBeenCalledOnce()
    expectNoLeak([seen, body, t.audit], [PHONE, EMAIL, CARD])
  })

  it('hands eve the very same follow-up when the answers carry ids only', async () => {
    const { channel, seen } = eveLike()
    const { args } = fakeArgs()
    args.params = { sessionId: 'wrun_T7' }
    const { t, opts } = options({ channelName: undefined })
    const ids = { inputResponses: [{ requestId: 'req_1', optionId: 'approve' }] }
    await handlerOf(withPdpaGuard(channel, opts), 1)(post(ids, '/eve/v1/session/wrun_T7'), args)
    expect(seen[0]?.body).toEqual(ids)
    expect(t.audit.filter((e) => e.type === 'scan')).toEqual([])
  })

  it('answers 422 to a blocked message and retires the session it had just created', async () => {
    const { channel, seen } = eveLike()
    const onBlock = vi.fn()
    const { opts } = options({ channelName: undefined, onBlock })
    const res = await handlerOf(withPdpaGuard(channel, opts))(
      post({ message: `บัตร ${CARD}` }, '/eve/v1/session'),
      fakeArgs().args,
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body).toEqual({
      ok: false,
      code: 'pdpa_blocked',
      error: expect.stringContaining('เลขบัตรเครดิต'),
    })
    expect(seen.map((s) => s.path)).toEqual(['/eve/v1/session', '/eve/v1/session/wrun_T1/reset'])
    expect(onBlock).toHaveBeenCalledOnce()
    expectNoLeak([body, onBlock.mock.calls, seen], [CARD])
  })

  it('hands eve the very same request when there is no message', async () => {
    const { channel, seen } = eveLike()
    const request = post({}, '/eve/v1/session')
    const res = await handlerOf(withPdpaGuard(channel, options({ channelName: undefined }).opts))(
      request,
      fakeArgs().args,
    )
    expect(res.status).toBe(202)
    expect(seen).toHaveLength(1)
  })

  it('refuses what it cannot split or read', async () => {
    const { channel, seen } = eveLike()
    const wrapped = withPdpaGuard(channel, options({ channelName: undefined }).opts)
    const delegated = await handlerOf(wrapped)(
      post({ message: 'x', callback: { url: 'https://parent.example/cb' } }, '/eve/v1/session'),
      fakeArgs().args,
    )
    expect(delegated.status).toBe(400)
    const args = fakeArgs().args
    args.params = { sessionId: 'wrun_T1' }
    const malformed = await handlerOf(wrapped, 1)(
      post({ message: [{ type: 'text', text: 42 }] }, '/eve/v1/session/wrun_T1'),
      args,
    )
    expect(malformed.status).toBe(400)
    expect(seen).toEqual([])
  })
})
