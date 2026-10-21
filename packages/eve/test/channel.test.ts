import { definePolicy } from '@eve-pdpa-extension/core'
import type { UserContent } from 'ai'
import { defineChannel, POST, type RouteDefinition, WS } from 'eve/channels'
import { describe, expect, it, vi } from 'vitest'
import { type BlockInfo, PdpaBlockedError, withPdpaGuard } from '../extension/lib/guard.js'
import { dashed, EMAIL, expectNoLeak, PHONE, syntheticId } from './helpers.js'

const ID = syntheticId(5)
const CARD = '4111 1111 1111 1111'
const quiet = { onAudit: () => {} }

interface Call {
  readonly via: 'from' | 'attachSession' | 'to' | 'receive'
  readonly message: unknown
  readonly options: unknown
}

/** Route args as eve builds them, with every operation recording what reached it. */
function fakeArgs() {
  const calls: Call[] = []
  const respond = vi.fn(async (_responses: unknown, _options: unknown) => ({ id: 'wrun_1' }))
  const cancel = vi.fn(async () => ({ status: 'no-active' }))
  const handle = (via: Call['via']) => ({
    async send(message: unknown, options: unknown) {
      calls.push({ via, message, options })
      return { id: 'wrun_1' }
    },
    respond,
    cancel,
  })
  const args = {
    from: vi.fn((_address: string) => handle('from')),
    attachSession: vi.fn((_id: string) => ({ id: 'wrun_1', ...handle('attachSession') })),
    to: vi.fn((_channel: unknown, _target: unknown) => handle('to')),
    resolveSession: vi.fn(async () => undefined),
    params: { threadId: 'T1' },
    waitUntil: vi.fn(),
    requestIp: null,
    describe: vi.fn(),
    listSkillFiles: vi.fn(),
    readSkill: vi.fn(),
    invokeTool: vi.fn(),
    // eve keeps internals on the args object; a wrapper must carry them along.
    __eveRouteSessionCreator: vi.fn(),
  }
  return { args, calls, respond, cancel }
}

type AnyArgs = ReturnType<typeof fakeArgs>['args']
type Handler = (request: Request, args: AnyArgs) => Promise<Response>

function post(body: unknown, path = '/m'): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

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

function handlerOf(channel: { routes: readonly unknown[] }, i = 0): Handler {
  return (channel.routes[i] as { handler: Handler }).handler
}

describe('withPdpaGuard — from(address).send()', () => {
  it('sends the masked message, context and title, and never the original', async () => {
    const { args, calls } = fakeArgs()
    const channel = withPdpaGuard(fakeChannel(), quiet)
    const res = await handlerOf(channel)(
      post({ message: `เลขบัตร ${dashed(ID)} โทร ${PHONE}`, context: [`อีเมลลูกค้า ${EMAIL}`] }),
      args,
    )
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.message).toBe('เลขบัตร [เลขบัตรประชาชน] โทร xxx-xxx-7777')
    expect(calls[0]?.options).toEqual({
      auth: null,
      state: { x: 1 },
      context: ['อีเมลลูกค้า [อีเมล]'],
      title: 'ช่วยด้วย',
    })
    expect(args.from).toHaveBeenCalledWith('C1:1800.1')
    expectNoLeak(calls, [ID, PHONE, EMAIL])
  })

  it('masks every text part of a UserContent message and keeps the file part', async () => {
    const { args, calls } = fakeArgs()
    const file = {
      type: 'file',
      mediaType: 'image/png',
      data: 'data:image/png;base64,iVBORw0KGgo=',
    }
    await handlerOf(withPdpaGuard(fakeChannel(), quiet))(
      post({ message: [{ type: 'text', text: `โทร ${PHONE}` }, file] }),
      args,
    )
    expect(calls[0]?.message).toEqual([{ type: 'text', text: 'โทร xxx-xxx-7777' }, file])
  })

  it('stops a blocked message: no send, onBlock once, PdpaBlockedError', async () => {
    const { args, calls } = fakeArgs()
    const blocks: BlockInfo[] = []
    const channel = withPdpaGuard(fakeChannel(), {
      ...quiet,
      onBlock: (info) => {
        blocks.push(info)
      },
    })
    const sent = handlerOf(channel)(post({ message: `บัตร ${CARD} ครับ` }), args)
    await expect(sent).rejects.toBeInstanceOf(PdpaBlockedError)
    await expect(sent).rejects.toMatchObject({ code: 'PDPA_BLOCKED' })
    expect(calls).toEqual([])
    expect(blocks).toEqual([
      { address: 'C1:1800.1', reason: expect.stringContaining('เลขบัตรเครดิต') },
    ])
    expectNoLeak(blocks, [CARD])
    await sent.catch((error: unknown) => expectNoLeak(error, [CARD]))
  })

  it('blocks on what the context carries, not only the message', async () => {
    const { args, calls } = fakeArgs()
    const channel = withPdpaGuard(fakeChannel(), quiet)
    await expect(
      handlerOf(channel)(post({ message: 'สวัสดี', context: [`บัตร ${CARD}`] }), args),
    ).rejects.toBeInstanceOf(PdpaBlockedError)
    expect(calls).toEqual([])
  })

  it('puts a failing onBlock behind the PdpaBlockedError as its cause', async () => {
    const { args } = fakeArgs()
    const broken = new Error('notice failed')
    const channel = withPdpaGuard(fakeChannel(), {
      ...quiet,
      onBlock: async () => {
        throw broken
      },
    })
    await expect(handlerOf(channel)(post({ message: `บัตร ${CARD}` }), args)).rejects.toMatchObject({
      name: 'PdpaBlockedError',
      cause: broken,
    })
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

  it('guards attachSession(id).send()', async () => {
    const { args, calls } = fakeArgs()
    const channel = withPdpaGuard(
      channelUsing((a, m) => a.attachSession('wrun_9').send(m, { auth: null })),
      quiet,
    )
    await handlerOf(channel)(post({ message: `โทร ${PHONE}` }), args)
    expect(calls).toEqual([
      { via: 'attachSession', message: 'โทร xxx-xxx-7777', options: { auth: null } },
    ])
    expect(args.attachSession).toHaveBeenCalledWith('wrun_9')
  })

  it('guards to(channel, target).send()', async () => {
    const { args, calls } = fakeArgs()
    const target = { channelId: 'C9' }
    const channel = withPdpaGuard(
      channelUsing((a, m) => a.to('slack', target).send(m, { auth: null })),
      quiet,
    )
    await handlerOf(channel)(post({ message: `เมล ${EMAIL}` }), args)
    expect(calls).toEqual([{ via: 'to', message: 'เมล [อีเมล]', options: { auth: null } }])
    expect(args.to).toHaveBeenCalledWith('slack', target)
  })

  it('passes respond() and the other operations through untouched', async () => {
    const { args, respond, cancel } = fakeArgs()
    const responses = [{ requestId: 'req_1', optionId: 'approve' }]
    const options = { auth: null }
    const channel = withPdpaGuard(
      channelUsing(async (a) => {
        await a.from('C1').respond(responses, options)
        await a.from('C1').cancel()
      }),
      quiet,
    )
    await handlerOf(channel)(post({ message: 'x' }), args)
    expect(respond).toHaveBeenCalledWith(responses, options)
    expect(respond.mock.calls[0]?.[0]).toBe(responses)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('keeps every other route argument, eve internals included', async () => {
    const { args } = fakeArgs()
    let seen: AnyArgs | undefined
    const channel = withPdpaGuard(
      channelUsing(async (a) => {
        seen = a
      }),
      quiet,
    )
    await handlerOf(channel)(post({ message: 'x' }), args)
    expect(seen).not.toBe(args)
    for (const key of [
      'resolveSession',
      'params',
      'waitUntil',
      'requestIp',
      'describe',
      'invokeTool',
      '__eveRouteSessionCreator',
    ] as const) {
      expect(seen?.[key]).toBe(args[key])
    }
  })
})

describe('withPdpaGuard — the channel value', () => {
  it('keeps method, path, transport and every non-route field', () => {
    const original = fakeChannel()
    const marker = Symbol('build-metadata')
    const withSymbol = Object.assign(original, { [marker]: { manifest: true } })
    const wrapped = withPdpaGuard(withSymbol, quiet)
    expect(wrapped).not.toBe(withSymbol)
    expect(wrapped.adapter).toBe(original.adapter)
    expect(wrapped.events).toBe(original.events)
    expect(wrapped.turnPolicy).toBe('queue')
    expect(wrapped.__kind).toBe('channel')
    expect(wrapped[marker]).toEqual({ manifest: true })
    expect(
      wrapped.routes.map(({ transport, method, path }) => ({ transport, method, path })),
    ).toEqual(original.routes.map(({ transport, method, path }) => ({ transport, method, path })))
    // The original channel is left as it was.
    expect(original.routes[0]?.handler).not.toBe(wrapped.routes[0]?.handler)
  })

  it('wraps a real defineChannel value and keeps its route metadata', async () => {
    const channel = defineChannel({
      routes: [
        POST('/threads/:threadId/messages', async (request, { from, params }) => {
          const body = (await request.json()) as { message: string }
          await from(params.threadId ?? '').send(body.message, { auth: null })
          return new Response('ok')
        }),
      ],
    })
    const wrapped = withPdpaGuard(channel, quiet)
    expect(Object.keys(wrapped).sort()).toEqual(Object.keys(channel).sort())
    expect(wrapped.routes.map((r) => [r.method, r.path, r.transport])).toEqual(
      channel.routes.map((r) => [r.method, r.path, r.transport]),
    )
    const { args, calls } = fakeArgs()
    const route = wrapped.routes[0] as RouteDefinition & { transport?: 'http' }
    await (route.handler as unknown as Handler)(post({ message: `โทร ${PHONE}` }), args)
    expect(calls[0]?.message).toBe('โทร xxx-xxx-7777')
  })

  it('guards a WebSocket route: the hooks it returns send through the guard', async () => {
    const channel = defineChannel({
      routes: [
        WS('/voice/ws', async (_req, { from }) => ({
          async message(_peer, message) {
            await from('voice-1').send(message.text(), { auth: null })
          },
        })),
      ],
    })
    const wrapped = withPdpaGuard(channel, quiet)
    const route = wrapped.routes[0]
    expect(route).toMatchObject({ transport: 'websocket', method: 'WEBSOCKET', path: '/voice/ws' })
    const { args, calls } = fakeArgs()
    const hooks = await (route?.handler as unknown as (r: Request, a: AnyArgs) => Promise<any>)(
      new Request('http://127.0.0.1/voice/ws'),
      args,
    )
    await hooks.message({}, { text: () => `เลขบัตร ${dashed(ID)}` })
    expect(calls).toEqual([
      { via: 'from', message: 'เลขบัตร [เลขบัตรประชาชน]', options: { auth: null } },
    ])
  })

  it('guards hand-offs from other channels, which arrive through receive()', async () => {
    const { args, calls } = fakeArgs()
    const channel = {
      routes: [],
      receive: async (input: { message: string }, ctx: { from: AnyArgs['from'] }) =>
        ctx.from('C7').send(input.message, { auth: null }) as never,
    }
    const wrapped = withPdpaGuard(channel, quiet)
    await wrapped.receive?.(
      { message: `โทร ${PHONE}` },
      { from: args.from, resolveSession: args.resolveSession },
    )
    expect(calls).toEqual([{ via: 'from', message: 'โทร xxx-xxx-7777', options: { auth: null } }])
  })

  it('fails at wrap time on a policy it cannot run', () => {
    const policy = definePolicy({
      entitySet: '0.1',
      entities: { PHONE: { action: 'tokenise', allowedPurposes: ['otp'] } },
    })
    expect(() => withPdpaGuard(fakeChannel(), { ...quiet, policy })).toThrow(/tokenise/)
  })
})

describe('withPdpaGuard — eve HTTP message routes', () => {
  /** A stand-in for eve's own POST /eve/v1/session handler: records the request it gets. */
  function eveLike(path = '/eve/v1/session') {
    const seen: { request: Request; body: unknown; args: unknown }[] = []
    const channel = {
      routes: [
        {
          method: 'POST' as const,
          path,
          handler: async (request: Request, args: AnyArgs) => {
            seen.push({ request, body: await request.json(), args })
            return Response.json(
              { ok: true, sessionId: 'wrun_1', status: 'accepted' },
              { status: 202 },
            )
          },
        },
      ],
    }
    return { channel, seen }
  }

  it('masks message and clientContext in the body before eve reads it', async () => {
    const { channel, seen } = eveLike()
    const { args } = fakeArgs()
    const res = await handlerOf(withPdpaGuard(channel, quiet))(
      post(
        {
          message: `เลขบัตร ${dashed(ID)}`,
          clientContext: { customer: { email: EMAIL, phone: PHONE }, plan: 'gold' },
          outputSchema: { type: 'object' },
        },
        '/eve/v1/session',
      ),
      args,
    )
    expect(res.status).toBe(202)
    expect(seen[0]?.body).toEqual({
      message: 'เลขบัตร [เลขบัตรประชาชน]',
      clientContext: { customer: { email: '[อีเมล]', phone: 'xxx-xxx-7777' }, plan: 'gold' },
      outputSchema: { type: 'object' },
    })
    expect(seen[0]?.request.headers.get('content-type')).toBe('application/json')
    expect(seen[0]?.request.headers.has('content-length')).toBe(false)
    expectNoLeak(
      seen.map((s) => s.body),
      [ID, EMAIL, PHONE],
    )
  })

  it('masks text parts and a clientContext list on the follow-up route', async () => {
    const { channel, seen } = eveLike('/eve/v1/session/:sessionId')
    const { args, calls } = fakeArgs()
    const file = { type: 'file', mediaType: 'application/pdf', data: 'JVBERi0=' }
    await handlerOf(withPdpaGuard(channel, quiet))(
      post(
        { message: [{ type: 'text', text: `โทร ${PHONE}` }, file], clientContext: [EMAIL, 'ok'] },
        '/eve/v1/session/wrun_1',
      ),
      args,
    )
    expect(seen[0]?.body).toEqual({
      message: [{ type: 'text', text: 'โทร xxx-xxx-7777' }, file],
      clientContext: ['[อีเมล]', 'ok'],
    })
    // The body is already masked: eve gets its own args, so the follow-up's
    // attachSession().send() does not scan the message a second time.
    expect(seen[0]?.args).toBe(args)
    expect(calls).toEqual([])
  })

  it('answers 422 to a blocked message and never calls eve', async () => {
    const { channel, seen } = eveLike()
    const onBlock = vi.fn()
    const res = await handlerOf(withPdpaGuard(channel, { ...quiet, onBlock }))(
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
    expect(seen).toEqual([])
    expect(onBlock).toHaveBeenCalledOnce()
    expectNoLeak([body, onBlock.mock.calls], [CARD])
  })

  it('hands eve the very same request when there is nothing to change', async () => {
    const { channel, seen } = eveLike()
    const request = post({ message: 'สวัสดีค่ะ' }, '/eve/v1/session')
    await handlerOf(withPdpaGuard(channel, quiet))(request, fakeArgs().args)
    expect(seen[0]?.request).toBe(request)
  })

  it('leaves a body that is not a JSON object for eve to refuse', async () => {
    const { seen } = eveLike()
    const passthrough = {
      routes: [
        {
          method: 'POST' as const,
          path: '/eve/v1/session',
          handler: async (request: Request) => {
            seen.push({ request, body: await request.text(), args: undefined })
            return new Response('bad', { status: 400 })
          },
        },
      ],
    }
    const request = post('not json', '/eve/v1/session')
    await handlerOf(withPdpaGuard(passthrough, quiet))(request, fakeArgs().args)
    expect(seen[0]?.request).toBe(request)
  })

  it('refuses a message part it cannot read rather than pass it on', async () => {
    const { channel, seen } = eveLike()
    const res = await handlerOf(withPdpaGuard(channel, quiet))(
      post({ message: [{ type: 'text', text: 42 }] }, '/eve/v1/session'),
      fakeArgs().args,
    )
    expect(res.status).toBe(400)
    expect(seen).toEqual([])
  })
})
