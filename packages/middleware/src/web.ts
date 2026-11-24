import type { Boundary, EntityType } from '@eve-pdpa-extension/core'
import { type AdapterOptions, blockedBody, blockedStatus, mayBeJson, namesJson } from './options.js'
import { protectBody } from './protect.js'

export interface WebOptions extends AdapterOptions<Request> {
  /**
   * The longest request body read, in bytes. A longer one is answered 413 and
   * the handler never runs. Default 1 MB. Express is not affected: its body
   * parser has its own `limit`.
   */
  readonly maxBytes?: number
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

/** Default cap on a request body: far more than a chat message, far less than memory. */
const DEFAULT_MAX_BYTES = 1_048_576

/** The body as text, or null when it is longer than `max` bytes: read no further than that. */
async function readText(
  message: Request | Response,
  max: number | undefined,
): Promise<string | null> {
  const copy = message.clone()
  if (max === undefined || copy.body === null) return copy.text()
  const declared = Number(message.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) return null
  const reader = copy.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      // Not awaited: cancelling one side of a clone waits for the other side, which nobody reads.
      reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    all.set(chunk, at)
    at += chunk.byteLength
  }
  return new TextDecoder().decode(all)
}

/**
 * What the body says, read as JSON: `undefined` when there is none, `null` when
 * it is not JSON, `'large'` when it is longer than `max` bytes.
 */
async function readJson(
  message: Request | Response,
  max?: number,
): Promise<{ json: unknown } | null | undefined | 'large'> {
  if (message.body === null || !mayBeJson(message.headers.get('content-type'))) return undefined
  const text = await readText(message, max)
  if (text === null) return 'large'
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
  // A body read before us cannot be cloned, and passing it on would pass it on
  // unchecked: fail closed, and say why.
  if (request.bodyUsed) {
    throw new TypeError(
      'pdpa: the request body was read before the middleware ran — put it before anything that reads the body',
    )
  }
  const read = await readJson(request, options.maxBytes ?? DEFAULT_MAX_BYTES)
  if (read === undefined) return { ok: true, request }
  if (read === 'large') {
    return { ok: false, response: Response.json({ error: 'payload_too_large' }, { status: 413 }) }
  }
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
  if (r.matched === 0) options.onNoMatch?.(request, 'inbound')
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
  if (response.bodyUsed) {
    throw new TypeError(
      'pdpa: the reply body was read before the middleware could check it — do not read the reply in a handler or middleware that runs after it',
    )
  }
  const read = await readJson(response)
  if (read === undefined || read === 'large') return response
  if (read === null) {
    // A reply that says it is JSON and is not cannot be checked, and goes out
    // as it is only if it was never going to hold a value: answer 502 instead.
    if (!namesJson(response.headers.get('content-type'))) return response
    return Response.json({ error: 'invalid_json', boundary: 'outbound' }, { status: 502 })
  }
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
  if (r.matched === 0) options.onNoMatch?.(request, 'outbound')
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
