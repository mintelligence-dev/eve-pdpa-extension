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
 * that route and its follow-up, the wrapper masks the JSON request body before
 * eve reads it — and, so that a token is issued under the session it belongs
 * to, creates the session first and sends the masked message as its first
 * follow-up.
 */
import type { CompiledPolicy } from '@eve-pdpa-extension/core'
import type { UserContent } from 'ai'
import type {
  ChannelReceiveContext,
  RouteDefinition,
  RouteHandlerArgs,
  Session,
} from 'eve/channels'
import {
  checkFiles,
  checkGuard,
  type Delivery,
  type DeliveryResult,
  type EveGuardOptions,
  scanDelivery,
} from './content.js'
import { PdpaBlockedError } from './errors.js'
import type { Language } from './reason.js'
import {
  addressConversation,
  checkSessionKey,
  derivePdpaSessionId,
  sessionConversation,
} from './session.js'

export interface WithPdpaGuardOptions extends EveGuardOptions {
  /**
   * The channel's file stem: `slack` for `agent/channels/slack.ts`. Part of
   * the session id, and must match what eve calls the channel, so a tool can
   * resolve a token the channel issued. Required for every channel but eve's
   * HTTP channel, whose sessions have no address.
   */
  readonly channelName?: string
  /**
   * The policy the guard was built with. core's guard does not expose it, and
   * the wrapper needs it to refuse, when it is built, a tokenising policy on a
   * channel that cannot rewrite replies.
   */
  readonly policy?: CompiledPolicy
  /**
   * eve's HTTP channel streams the model's reply as written, so a token the
   * model repeats — `[tok:…]` — reaches the person as is. A tokenising policy
   * on that channel is refused unless this is true. Set it for local use only:
   * `eve dev`, the terminal UI, tests.
   */
  readonly allowRawTokensInOutput?: boolean
}

/** The parts of an eve channel value the wrapper touches. Everything else is copied as is. */
export interface GuardableChannel {
  readonly routes: readonly RouteDefinition<any>[]
  readonly receive?: ((input: any, ctx: ChannelReceiveContext<any>) => Promise<Session>) | undefined
}

type Passed = Extract<DeliveryResult, { blocked: false }>
type Scan = (input: Delivery, conversation: string) => Promise<DeliveryResult>

interface Sendable {
  send(message: UserContent, options: any): Promise<unknown>
}

const TOKENS_IN_OUTPUT =
  "withPdpaGuard: this policy tokenises, and eve's HTTP channel streams the model's reply as written — " +
  'a token the model repeats, such as [tok:…], would be shown to the person as is. ' +
  'Pass allowRawTokensInOutput: true only for local use (eve dev, the terminal UI, tests), ' +
  'or reach people through a channel whose replies are rewritten (Slack with pdpaSlackRenderer).'

export function policyTokenises(policy: CompiledPolicy | undefined): boolean {
  return Object.values(policy?.entities ?? {}).some((rule) => rule?.action === 'tokenise')
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

async function notify(onBlock: EveGuardOptions['onBlock'], out: DeliveryResult): Promise<unknown> {
  if (!out.blocked || onBlock === undefined) return undefined
  try {
    await onBlock({ reason: out.reason, blockedBy: out.blockedBy })
    return undefined
  } catch (error) {
    return error
  }
}

function guardSend<H extends Sendable>(
  handle: H,
  scan: Scan,
  onBlock: EveGuardOptions['onBlock'],
  conversation: string,
): H {
  return {
    ...handle,
    // A blocked message never reaches the original send: nothing is recorded.
    send: async (message: UserContent, options: unknown) => {
      const out = await scan(
        { message, context: field(options, 'context'), title: field(options, 'title') },
        conversation,
      )
      if (out.blocked) {
        const failure = await notify(onBlock, out)
        throw new PdpaBlockedError(
          out.reason,
          failure === undefined ? undefined : { cause: failure },
        )
      }
      return handle.send(out.message, withMasked(options, out))
    },
  }
}

// ---- eve's HTTP channel ----------------------------------------------------

const CREATE = 'POST /eve/v1/session'
const FOLLOW_UP = 'POST /eve/v1/session/:sessionId'
const RESET = 'POST /eve/v1/session/:sessionId/reset'

const key = (route: RouteDefinition<any>): string => `${route.method} ${route.path}`

/** `clientContext` as eve accepts it: a string, a list of strings, or a JSON object it serialises. */
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

function answer(status: number, body: Record<string, unknown>): Response {
  return Response.json({ ok: false, ...body }, { status })
}

function jsonRequest(from: Request, path: string, body: unknown): Request {
  const headers = new Headers(from.headers)
  headers.delete('content-length')
  return new Request(new URL(path, from.url), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: from.signal,
  })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface HttpGuard {
  readonly scan: Scan
  readonly onBlock: EveGuardOptions['onBlock']
  readonly allowRawTokens: boolean
}

let warnedTokens = false

/** Reads `message` and `clientContext`, masks them for eve session `sessionId`, and says what to send. */
async function maskBody(
  fields: Record<string, unknown>,
  sessionId: string,
  http: HttpGuard,
): Promise<{ body: Record<string, unknown> } | { response: Response }> {
  const message = fields.message
  if (message !== undefined && typeof message !== 'string' && !Array.isArray(message)) {
    return {
      response: answer(400, {
        error: "Expected 'message' to be a string or an array of text/file parts.",
      }),
    }
  }
  const contextStrings: string[] = []
  stringsIn(fields.clientContext, contextStrings)

  let out: DeliveryResult
  try {
    out = await http.scan(
      { message: (message ?? []) as UserContent, context: contextStrings },
      sessionConversation(sessionId),
    )
  } catch (error) {
    // A part this guard cannot read is refused here, never passed on unread.
    if (error instanceof TypeError)
      return { response: answer(400, { error: 'Malformed message part.' }) }
    throw error
  }
  if (out.blocked) {
    await notify(http.onBlock, out)
    return { response: answer(422, { code: 'pdpa_blocked', error: out.reason }) }
  }
  if (out.tokenised && !http.allowRawTokens) {
    if (!warnedTokens) {
      warnedTokens = true
      console.error(`[@eve-pdpa-extension/eve] ${TOKENS_IN_OUTPUT}`)
    }
    return {
      response: answer(500, {
        code: 'pdpa_config',
        error: 'This channel is not set up to protect replies.',
      }),
    }
  }
  const masked = out.context ?? []
  let i = 0
  const body: Record<string, unknown> = { ...fields }
  if (message !== undefined) body.message = out.message
  if (fields.clientContext !== undefined) {
    body.clientContext = replaceStrings(fields.clientContext, () => masked[i++] ?? '')
  }
  return { body }
}

async function readObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = JSON.parse(await request.clone().text())
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

// Fields that belong to a turn, not to the session: they go with the message.
const TURN_FIELDS = ['message', 'clientContext', 'outputSchema', 'turnPolicy'] as const

type Handler = (request: Request, args: RouteHandlerArgs<any>) => Promise<Response>

/**
 * `POST /eve/v1/session` with a message: the session is created empty, then
 * the message — masked under that session's id — is sent as its first
 * follow-up. eve documents both steps; the message is still turn 0.
 */
function guardedCreate(
  create: Handler,
  followUp: Handler,
  reset: Handler | undefined,
  http: HttpGuard,
): Handler {
  return async (request, args) => {
    const fields = await readObject(request)
    // Not a JSON object: eve answers it with its own 400 and dispatches nothing.
    // No message: nothing to mask. eve refuses turn fields such as
    // clientContext on a message-free create, so they cannot slip through.
    if (fields === null || fields.message === undefined) return create(request, args)
    if (fields.callback !== undefined || fields.operationId !== undefined) {
      return answer(400, {
        code: 'pdpa_unsupported',
        error: 'With the PDPA guard, create the session first, then send the message to it.',
      })
    }

    const sessionFields = Object.fromEntries(
      Object.entries(fields).filter(([k]) => !(TURN_FIELDS as readonly string[]).includes(k)),
    )
    const created = await create(jsonRequest(request, '/eve/v1/session', sessionFields), args)
    if (created.status !== 202) return created
    const createdBody = (await created.clone().json()) as { sessionId?: unknown }
    const sessionId = createdBody.sessionId
    if (typeof sessionId !== 'string') return created

    const masked = await maskBody(fields, sessionId, http)
    const path = `/eve/v1/session/${encodeURIComponent(sessionId)}`
    if ('response' in masked) {
      // Retire the empty session rather than leave it waiting for a message.
      await reset?.(jsonRequest(request, `${path}/reset`, {}), {
        ...args,
        params: { ...args.params, sessionId },
      }).catch(() => undefined)
      return masked.response
    }
    const turn = Object.fromEntries(
      Object.entries(masked.body).filter(([k]) => (TURN_FIELDS as readonly string[]).includes(k)),
    )
    // A new session's inbox can lag its creation: eve answers 409
    // session_not_ready meanwhile. Its own client retries for 20 s; so does this.
    const deadline = Date.now() + 20_000
    let wait = 50
    for (;;) {
      const sent = await followUp(jsonRequest(request, path, turn), {
        ...args,
        params: { ...args.params, sessionId },
      })
      if (sent.status === 409 && Date.now() < deadline) {
        const code = (
          (await sent
            .clone()
            .json()
            .catch(() => ({}))) as { code?: unknown }
        ).code
        if (code === 'session_not_ready') {
          await sleep(wait)
          wait = Math.min(wait * 2, 1_000)
          continue
        }
      }
      if (sent.status >= 400) return sent
      return new Response(JSON.stringify(createdBody), {
        status: created.status,
        headers: created.headers,
      })
    }
  }
}

function guardedFollowUp(followUp: Handler, http: HttpGuard): Handler {
  return async (request, args) => {
    const fields = await readObject(request)
    if (fields === null || (fields.message === undefined && fields.clientContext === undefined)) {
      return followUp(request, args)
    }
    const sessionId =
      args.params?.sessionId ??
      decodeURIComponent(new URL(request.url).pathname.split('/').pop() ?? '')
    const masked = await maskBody(fields, sessionId, http)
    if ('response' in masked) return masked.response
    // The original args, not guarded ones: the body is already masked, and a
    // second scan in attachSession().send() would only add a second audit event.
    return followUp(jsonRequest(request, new URL(request.url).pathname, masked.body), args)
  }
}

// ---- the wrapper -------------------------------------------------------------

/**
 * Returns a copy of `channel` whose every inbound message is masked by the
 * caller's guard before eve sees it, or stopped when the policy blocks it.
 * Route methods, paths and transports, and every other field of the channel —
 * adapter, events, renderers, build metadata — are kept as they are.
 *
 * A stopped message is never sent: `onBlock` is called, then the send throws
 * `PdpaBlockedError` (eve's built-in channels catch and log it). On eve's HTTP
 * routes the request is answered `422 { ok: false, code: "pdpa_blocked" }`.
 *
 * `respond()` — answers to approval and question prompts — passes unscanned.
 */
export function withPdpaGuard<C extends GuardableChannel>(
  channel: C,
  options: WithPdpaGuardOptions,
): C {
  checkGuard(options?.guard)
  checkSessionKey(options.sessionKey)
  const files = checkFiles(options.files)
  const language: Language = options.language ?? 'th'
  const { guard, sessionKey, onBlock } = options

  const routes = new Map(channel.routes.map((route) => [key(route), route]))
  const isEveHttp = routes.has(CREATE) && routes.has(FOLLOW_UP)
  const channelName = options.channelName
  if (!isEveHttp && (typeof channelName !== 'string' || channelName.length === 0)) {
    throw new TypeError(
      'withPdpaGuard: channelName is required — the file stem of the channel, such as "slack" for agent/channels/slack.ts',
    )
  }
  if (isEveHttp && policyTokenises(options.policy) && options.allowRawTokensInOutput !== true) {
    throw new TypeError(TOKENS_IN_OUTPUT)
  }

  const scan: Scan = async (input, conversation) =>
    scanDelivery(input, {
      guard,
      sessionId: await derivePdpaSessionId(sessionKey, conversation),
      boundary: 'inbound',
      files,
      language,
    })
  const http: HttpGuard = { scan, onBlock, allowRawTokens: options.allowRawTokensInOutput === true }
  const name = channelName ?? 'eve'

  const guardArgs = <A extends RouteHandlerArgs<any>>(args: A): A => ({
    ...args,
    from: (address: string) =>
      guardSend(args.from(address), scan, onBlock, addressConversation(name, address)),
    attachSession: (sessionId: string) =>
      guardSend(args.attachSession(sessionId), scan, onBlock, sessionConversation(sessionId)),
    // The receiving channel names the session; tokens issued here cannot be
    // resolved there. README: Known limitations.
    to: ((target: any, address: any) =>
      guardSend(
        args.to(target, address),
        scan,
        onBlock,
        `handoff:${name}`,
      )) as RouteHandlerArgs<any>['to'],
  })

  const followUp = routes.get(FOLLOW_UP)?.handler as Handler | undefined
  const reset = routes.get(RESET)?.handler as Handler | undefined

  const wrapped = channel.routes.map((route): RouteDefinition<any> => {
    if (route.transport === 'websocket') {
      const handler = route.handler
      // The hooks a WS handler returns close over the args it was given.
      return { ...route, handler: (request, args) => handler(request, guardArgs(args)) }
    }
    const handler = route.handler as Handler
    if (isEveHttp && followUp !== undefined && key(route) === CREATE) {
      return { ...route, handler: guardedCreate(handler, followUp, reset, http) }
    }
    if (isEveHttp && key(route) === FOLLOW_UP) {
      return { ...route, handler: guardedFollowUp(handler, http) }
    }
    return { ...route, handler: (request, args) => handler(request, guardArgs(args)) }
  })

  const receive = channel.receive
  return {
    ...channel,
    routes: wrapped,
    ...(receive === undefined
      ? {}
      : {
          receive: (input: unknown, ctx: ChannelReceiveContext<any>) =>
            receive.call(channel, input, {
              ...ctx,
              from: (address: string) =>
                guardSend(ctx.from(address), scan, onBlock, addressConversation(name, address)),
            }),
        }),
  }
}
