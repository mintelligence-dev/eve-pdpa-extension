import { vi } from 'vitest'

interface Call {
  readonly via: 'from' | 'attachSession' | 'to'
  readonly message: unknown
  readonly options: unknown
}

/** Route args as eve builds them, with every operation recording what reached it. */
export function fakeArgs() {
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
    params: {} as Record<string, string>,
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

export type AnyArgs = ReturnType<typeof fakeArgs>['args']
export type Handler = (request: Request, args: AnyArgs) => Promise<Response>

export function post(body: unknown, path = '/m'): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/**
 * Stand-ins for eve's own create, follow-up and reset handlers, at the same
 * methods and paths: they record the requests they get.
 */
export function eveLike(opts: { readyAfter?: number } = {}) {
  const seen: { path: string; body: unknown; args: unknown }[] = []
  let notReady = opts.readyAfter ?? 0
  const route = (path: string, handler: Handler) => ({ method: 'POST' as const, path, handler })
  const channel = {
    routes: [
      route('/eve/v1/session', async (request, args) => {
        const body = await request.json()
        seen.push({ path: new URL(request.url).pathname, body, args })
        return Response.json(
          { ok: true, sessionId: 'wrun_T1', status: 'accepted' },
          { status: 202 },
        )
      }),
      route('/eve/v1/session/:sessionId', async (request, args) => {
        if (notReady-- > 0) {
          return Response.json({ ok: false, code: 'session_not_ready' }, { status: 409 })
        }
        seen.push({ path: new URL(request.url).pathname, body: await request.json(), args })
        return Response.json(
          { ok: true, sessionId: args.params.sessionId, status: 'accepted' },
          { status: 202 },
        )
      }),
      route('/eve/v1/session/:sessionId/reset', async (request, args) => {
        seen.push({ path: new URL(request.url).pathname, body: await request.json(), args })
        return Response.json({ ok: true, status: 'reset' })
      }),
    ],
  }
  return { channel, seen }
}
