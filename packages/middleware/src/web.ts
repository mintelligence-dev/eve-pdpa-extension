import type { Boundary, EntityType } from '@eve-pdpa-extension/core'
import { type AdapterOptions, blockedBody, blockedStatus, mayBeJson, namesJson } from './options.js'
import { protectBody } from './protect.js'

export interface WebOptions extends AdapterOptions<Request> {
  /**
   * The answer when the policy blocks a message. `boundary` says which way it
   * was going: `inbound`, what the customer sent, or `outbound`, the handler's
   * reply. Default 422 for a request and 502 for a reply, with `blockedBy`.
   */
  readonly onBlocked?: (
    blockedBy: readonly EntityType[],
    request: Request,
    boundary: Boundary,
  ) => Response
}

export type ProtectRequestResult<R extends Request = Request> =
  | { readonly ok: true; readonly request: R }
  | { readonly ok: false; readonly response: Response }

/** The headers of a message whose body is about to be replaced. */
function withoutLength(headers: Headers): Headers {
  const copy = new Headers(headers)
  copy.delete('content-length')
  return copy
}

function blocked(
  blockedBy: readonly EntityType[],
  request: Request,
  boundary: Boundary,
  options: WebOptions,
): Response {
  return options.onBlocked !== undefined
    ? options.onBlocked(blockedBy, request, boundary)
    : Response.json(blockedBody(blockedBy, boundary), { status: blockedStatus(boundary) })
}

/** What the body says, read as JSON: `undefined` when there is none, `null` when it is not JSON. */
async function readJson(
  message: Request | Response,
): Promise<{ json: unknown } | null | undefined> {
  if (message.body === null || !mayBeJson(message.headers.get('content-type'))) return undefined
  const text = await message.clone().text()
  if (text.trim() === '') return undefined
  try {
    return { json: JSON.parse(text) }
  } catch {
    return null
  }
}

/**
 * Protects a web-standard Request: Hono, Next.js route handlers, Deno, Bun,
 * Cloudflare Workers, Remix, SvelteKit, Astro. Returns the Request with the
 * text protected, or the Response to answer with when the policy blocks it.
 *
 * A JSON body is read whatever its content type says, as long as it does not
 * say something else: the Fetch API sends a string as text/plain unless told
 * otherwise, and the handler's request.json() reads it all the same. A form or
 * a file is passed through untouched. A body labelled JSON that does not parse
 * is answered 400: the handler would fail on it, and nothing in it can be
 * checked.
 *
 * When nothing needed protecting, the same Request comes back, byte for byte —
 * a signature over the body (LINE's x-line-signature) still checks. When
 * something did, the new Request is built with the same constructor, so a
 * Next.js NextRequest stays a NextRequest.
 */
export async function protectRequest<R extends Request>(
  request: R,
  options: WebOptions,
): Promise<ProtectRequestResult<R>> {
  const read = await readJson(request)
  if (read === undefined) return { ok: true, request }
  if (read === null) {
    if (!namesJson(request.headers.get('content-type'))) return { ok: true, request }
    return { ok: false, response: Response.json({ error: 'invalid_json' }, { status: 400 }) }
  }
  const sessionId = options.sessionId?.(request)
  const ref = options.ref?.(request)
  const context = await options.context?.(request, read.json)
  const r = await protectBody(read.json, {
    guard: options.guard,
    ...(options.fields === undefined ? {} : { fields: options.fields }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(ref === undefined ? {} : { ref }),
    ...(context === undefined ? {} : { context }),
  })
  if (!r.ok) return { ok: false, response: blocked(r.blockedBy, request, 'inbound', options) }
  if (!r.changed) return { ok: true, request }
  const Rebuilt = request.constructor as new (input: string, init: RequestInit) => R
  return {
    ok: true,
    request: new Rebuilt(request.url, {
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
 * came — and so is a reply with nothing to protect. `request` is the one the
 * reply answers: it gives the session.
 */
export async function protectResponse(
  response: Response,
  request: Request,
  options: WebOptions,
): Promise<Response> {
  if (options.responseFields === undefined) return response
  const read = await readJson(response)
  if (read === undefined || read === null) return response
  const sessionId = options.sessionId?.(request)
  const ref = options.ref?.(request)
  const r = await protectBody(read.json, {
    guard: options.guard,
    fields: options.responseFields,
    boundary: 'outbound',
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(ref === undefined ? {} : { ref }),
  })
  if (!r.ok) return blocked(r.blockedBy, request, 'outbound', options)
  if (!r.changed) return response
  return new Response(JSON.stringify(r.body), {
    status: response.status,
    statusText: response.statusText,
    headers: withoutLength(response.headers),
  })
}

/**
 * Wraps a Next.js route handler (or any `(request, ...rest) => Response`). The
 * handler gets the same kind of request it was written for — a NextRequest
 * stays a NextRequest:
 *
 *   export const POST = withPdpa(handler, { guard, sessionId: (r) => r.headers.get('x-chat-id') ?? undefined })
 */
export function withPdpa<R extends Request, Rest extends unknown[]>(
  handler: (request: R, ...rest: Rest) => Response | Promise<Response>,
  options: WebOptions,
): (request: R, ...rest: Rest) => Promise<Response> {
  return async (request, ...rest) => {
    const r = await protectRequest(request, options)
    if (!r.ok) return r.response
    const response = await handler(r.request, ...rest)
    return protectResponse(response, r.request, options)
  }
}
