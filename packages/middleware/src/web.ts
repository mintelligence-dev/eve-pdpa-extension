import type { EntityType } from '@eve-pdpa-extension/core'
import { type AdapterOptions, BLOCKED_STATUS, blockedBody } from './options.js'
import { protectBody } from './protect.js'

export interface WebOptions extends AdapterOptions<Request> {
  /** The answer when the policy blocks a message. Default 422 with `blockedBy`. */
  readonly onBlocked?: (blockedBy: readonly EntityType[], request: Request) => Response
}

export type ProtectRequestResult =
  | { readonly ok: true; readonly request: Request }
  | { readonly ok: false; readonly response: Response }

function isJson(headers: Headers): boolean {
  return /\bjson\b/i.test(headers.get('content-type') ?? '')
}

/** The headers of a message whose body is about to be replaced. */
function withoutLength(headers: Headers): Headers {
  const copy = new Headers(headers)
  copy.delete('content-length')
  return copy
}

function blocked(
  blockedBy: readonly EntityType[],
  request: Request,
  options: WebOptions,
): Response {
  return options.onBlocked !== undefined
    ? options.onBlocked(blockedBy, request)
    : Response.json(blockedBody(blockedBy), { status: BLOCKED_STATUS })
}

/**
 * Protects a web-standard Request: Hono, Next.js route handlers, Deno, Bun,
 * Cloudflare Workers, Remix, SvelteKit, Astro. Returns a new Request with the
 * text protected, or the Response to answer with when the policy blocks it.
 *
 * A body that is not JSON is passed through untouched. JSON that does not parse
 * is answered 400: the handler would fail on it anyway, and nothing in it can
 * be checked.
 */
export async function protectRequest(
  request: Request,
  options: WebOptions,
): Promise<ProtectRequestResult> {
  if (!isJson(request.headers) || request.body === null) return { ok: true, request }
  let body: unknown
  try {
    body = await request.clone().json()
  } catch {
    return {
      ok: false,
      response: Response.json({ error: 'invalid_json' }, { status: 400 }),
    }
  }
  const sessionId = options.sessionId?.(request)
  const ref = options.ref?.(request)
  const r = await protectBody(body, {
    guard: options.guard,
    ...(options.fields === undefined ? {} : { fields: options.fields }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(ref === undefined ? {} : { ref }),
  })
  if (!r.ok) return { ok: false, response: blocked(r.blockedBy, request, options) }
  return {
    ok: true,
    request: new Request(request.url, {
      method: request.method,
      headers: withoutLength(request.headers),
      body: JSON.stringify(r.body),
      signal: request.signal,
    }),
  }
}

/**
 * Checks a JSON reply on its way out, at the `responseFields` paths. Any other
 * reply, and every reply when `responseFields` is not set, is returned as it
 * came. `request` is the one the reply answers: it gives the session.
 */
export async function protectResponse(
  response: Response,
  request: Request,
  options: WebOptions,
): Promise<Response> {
  if (options.responseFields === undefined || !isJson(response.headers)) return response
  let body: unknown
  try {
    body = await response.clone().json()
  } catch {
    return response
  }
  const sessionId = options.sessionId?.(request)
  const ref = options.ref?.(request)
  const r = await protectBody(body, {
    guard: options.guard,
    fields: options.responseFields,
    boundary: 'outbound',
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(ref === undefined ? {} : { ref }),
  })
  if (!r.ok) return blocked(r.blockedBy, request, options)
  return new Response(JSON.stringify(r.body), {
    status: response.status,
    statusText: response.statusText,
    headers: withoutLength(response.headers),
  })
}

/**
 * Wraps a Next.js route handler (or any `(request, ...rest) => Response`):
 *
 *   export const POST = withPdpa(handler, { guard, sessionId: (r) => r.headers.get('x-chat-id') ?? undefined })
 */
export function withPdpa<Rest extends unknown[]>(
  handler: (request: Request, ...rest: Rest) => Response | Promise<Response>,
  options: WebOptions,
): (request: Request, ...rest: Rest) => Promise<Response> {
  return async (request, ...rest) => {
    const r = await protectRequest(request, options)
    if (!r.ok) return r.response
    const response = await handler(r.request, ...rest)
    return protectResponse(response, r.request, options)
  }
}
