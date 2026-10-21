/**
 * withPdpaGuard: wraps an eve channel so every message it hands to eve is
 * masked first — before eve records it, before a hook sees it, before the model.
 *
 * Built-in channels (Slack, Teams, Telegram, the Chat SDK bridge) and custom
 * ones pass each inbound message to `from(address).send()`, a fixed session's
 * `send()`, or `to(channel, target).send()`. The wrapper replaces those three
 * on the arguments every route handler receives, and on the context of the
 * channel's `receive` hook, which handles hand-offs from other channels.
 *
 * eve's own HTTP channel is the exception: `POST /eve/v1/session` creates a
 * session through an internal path none of the three reaches (eve 0.80.1). For
 * that route and its follow-up, the wrapper masks the JSON request body —
 * the channel's documented HTTP contract — before eve reads it.
 */

import type { UserContent } from 'ai'
import type {
  ChannelReceiveContext,
  RouteDefinition,
  RouteHandlerArgs,
  Session,
} from 'eve/channels'
import {
  type ContentGuard,
  createContentGuard,
  type Delivery,
  type DeliveryResult,
  type GuardOptions,
} from './content.js'
import { PdpaBlockedError } from './errors.js'

export interface BlockInfo {
  /** As `GuardAuditContext.address`: often personal data itself. Absent on eve's HTTP routes. */
  readonly address?: string
  /** Kinds of data only. Safe to show the person who sent the message. */
  readonly reason: string
}

export interface WithPdpaGuardOptions extends GuardOptions {
  /**
   * Called once for each message the policy stops, before the error is thrown
   * or the HTTP answer is sent. Use it to tell the person why nothing happened.
   * A throw from here becomes the `cause` of the `PdpaBlockedError`.
   */
  readonly onBlock?: (info: BlockInfo) => void | Promise<void>
}

/** The parts of an eve channel value the wrapper touches. Everything else is copied as is. */
export interface GuardableChannel {
  readonly routes: readonly RouteDefinition<any>[]
  readonly receive?: ((input: any, ctx: ChannelReceiveContext<any>) => Promise<Session>) | undefined
}

type Passed = Extract<DeliveryResult, { blocked: false }>
type Deliver = (input: Delivery, address?: string) => Promise<Passed>

/** What every send handle — channel source, fixed session, cross-channel target — shares. */
interface Sendable {
  send(message: UserContent, options: any): Promise<unknown>
}

function makeDeliver(guard: ContentGuard, onBlock: WithPdpaGuardOptions['onBlock']): Deliver {
  return async (input, address) => {
    const out = guard.deliver(input, address)
    if (!out.blocked) return out
    let cause: { readonly cause: unknown } | undefined
    if (onBlock !== undefined) {
      try {
        await onBlock(
          address === undefined ? { reason: out.reason } : { address, reason: out.reason },
        )
      } catch (error) {
        cause = { cause: error }
      }
    }
    throw new PdpaBlockedError(out.reason, cause)
  }
}

function field(options: unknown, name: 'context' | 'title'): any {
  return typeof options === 'object' && options !== null
    ? (options as Record<string, unknown>)[name]
    : undefined
}

/** The caller's options, with `context` and `title` swapped for their masked copies. */
function withMasked<O>(options: O, out: Passed): O {
  if (typeof options !== 'object' || options === null) return options
  return {
    ...options,
    ...(out.context === undefined ? {} : { context: out.context }),
    ...(out.title === undefined ? {} : { title: out.title }),
  }
}

function guardSend<H extends Sendable>(handle: H, deliver: Deliver, address?: string): H {
  return {
    ...handle,
    // A blocked message never reaches the original send: nothing is recorded.
    send: async (message: UserContent, options: unknown) => {
      const out = await deliver(
        { message, context: field(options, 'context'), title: field(options, 'title') },
        address,
      )
      return handle.send(out.message, withMasked(options, out))
    },
  }
}

function guardArgs<A extends RouteHandlerArgs<any>>(args: A, deliver: Deliver): A {
  return {
    ...args,
    from: (address: string) => guardSend(args.from(address), deliver, address),
    attachSession: (sessionId: string) => guardSend(args.attachSession(sessionId), deliver),
    to: ((channel: any, target: any) =>
      guardSend(args.to(channel, target), deliver)) as RouteHandlerArgs<any>['to'],
  }
}

// ---- eve's HTTP channel ----------------------------------------------------

const EVE_MESSAGE_ROUTES: ReadonlySet<string> = new Set([
  'POST /eve/v1/session',
  'POST /eve/v1/session/:sessionId',
])

function isEveMessageRoute(route: RouteDefinition<any>): boolean {
  return EVE_MESSAGE_ROUTES.has(`${route.method} ${route.path}`)
}

/**
 * `clientContext` as eve accepts it: a string, a list of strings, or a JSON
 * object eve serialises. Every string in it is collected, so an object's
 * values are masked where they sit.
 */
function stringsIn(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) stringsIn(v, out)
  else if (typeof value === 'object' && value !== null)
    for (const v of Object.values(value)) stringsIn(v, out)
}

function replaceStrings(value: unknown, next: () => string): unknown {
  if (typeof value === 'string') return next()
  if (Array.isArray(value)) return value.map((v) => replaceStrings(v, next))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, replaceStrings(v, next)] as const),
    )
  }
  return value
}

function badRequest(error: string): Response {
  return Response.json({ ok: false, error }, { status: 400 })
}

/**
 * Masks `message` and `clientContext` — the two fields of an eve HTTP message
 * request that reach the model — and hands eve a new Request with the masked
 * body. A body that is not a JSON object goes through untouched: eve answers
 * it with its own 400 and dispatches nothing.
 */
async function guardEveRequest(
  request: Request,
  guard: ContentGuard,
  onBlock: WithPdpaGuardOptions['onBlock'],
): Promise<Request | Response> {
  let body: unknown
  try {
    body = JSON.parse(await request.clone().text())
  } catch {
    return request
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return request
  const fields = body as Record<string, unknown>

  const message = fields.message
  if (message !== undefined && typeof message !== 'string' && !Array.isArray(message)) {
    return badRequest("Expected 'message' to be a string or an array of text/file parts.")
  }
  const contextStrings: string[] = []
  stringsIn(fields.clientContext, contextStrings)
  if (message === undefined && contextStrings.length === 0) return request

  const original = (message ?? []) as UserContent
  let out: DeliveryResult
  try {
    out = guard.deliver({ message: original, context: contextStrings })
  } catch (error) {
    // A part this guard cannot read is refused here, never passed on unread.
    if (error instanceof TypeError) return badRequest('Malformed message part.')
    throw error
  }

  if (out.blocked) {
    await onBlock?.({ reason: out.reason })
    return Response.json({ ok: false, code: 'pdpa_blocked', error: out.reason }, { status: 422 })
  }

  const masked = out.context ?? []
  const contextChanged = masked.some((s, i) => s !== contextStrings[i])
  if (out.message === original && !contextChanged) return request

  let i = 0
  const next: Record<string, unknown> = { ...fields }
  if (message !== undefined) next.message = out.message
  if (contextChanged)
    next.clientContext = replaceStrings(fields.clientContext, () => masked[i++] ?? '')

  const headers = new Headers(request.headers)
  // The body is a different length now.
  headers.delete('content-length')
  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(next),
    signal: request.signal,
  })
}

// ---- the wrapper -------------------------------------------------------------

function wrapRoute(
  route: RouteDefinition<any>,
  guard: ContentGuard,
  deliver: Deliver,
  onBlock: WithPdpaGuardOptions['onBlock'],
): RouteDefinition<any> {
  if (route.transport === 'websocket') {
    const handler = route.handler
    // The hooks a WS handler returns close over the args it was given, so
    // their `message()` sends through the guarded operations too.
    return { ...route, handler: (request, args) => handler(request, guardArgs(args, deliver)) }
  }
  const handler = route.handler
  if (isEveMessageRoute(route)) {
    return {
      ...route,
      // The original args, not guarded ones: the body is already masked, and a
      // second scan of the follow-up's attachSession().send() would only add a
      // second audit event for the same message.
      handler: async (request, args) => {
        const guarded = await guardEveRequest(request, guard, onBlock)
        return guarded instanceof Response ? guarded : handler(guarded, args)
      },
    }
  }
  return { ...route, handler: (request, args) => handler(request, guardArgs(args, deliver)) }
}

/**
 * Returns a copy of `channel` whose every inbound message is masked by core
 * before eve sees it, or stopped when the policy blocks it. Route methods,
 * paths and transports, and every other field of the channel — adapter,
 * events, build metadata — are kept as they are.
 *
 * A stopped message is never sent: `onBlock` is called, then the send throws
 * `PdpaBlockedError` (eve's built-in channels catch and log it). On eve's own
 * HTTP routes the request is answered `422` with `{ ok: false, code:
 * "pdpa_blocked", error: <reason> }` instead.
 *
 * `respond()` — answers to approval and question prompts — is passed through
 * unscanned.
 */
export function withPdpaGuard<C extends GuardableChannel>(
  channel: C,
  options: WithPdpaGuardOptions = {},
): C {
  const guard = createContentGuard(options, 'channel')
  const deliver = makeDeliver(guard, options.onBlock)
  const routes = channel.routes.map((route) => wrapRoute(route, guard, deliver, options.onBlock))
  const receive = channel.receive
  return {
    ...channel,
    routes,
    ...(receive === undefined
      ? {}
      : {
          receive: (input: unknown, ctx: ChannelReceiveContext<any>) =>
            receive.call(channel, input, {
              ...ctx,
              from: (address: string) => guardSend(ctx.from(address), deliver, address),
            }),
        }),
  }
}
