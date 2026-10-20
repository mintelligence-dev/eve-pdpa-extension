/**
 * A gateway that sits between a chat app and the system that answers it.
 *
 *   /inbound      the customer's message → guard → forwardTo
 *   /outbound     the answer             → guard → replyTo
 *
 * The caller names forwardTo and replyTo in each request, or the gateway falls
 * back to the ones it was built with. Every forward is reported to onForward,
 * so where a message went is on record (D11, 16 Oct).
 *   /resolve      a token → its real value, for an allowed purpose
 *   /end-session  forget every token of a chat
 *
 * Each handler takes a web Request and returns a Response, so it mounts on
 * anything that speaks them: a Vercel function, a Next.js route, Hono, Deno.
 * D11.
 */
import {
  type AuditRecord,
  BUILTIN_DETECTORS,
  type CompiledPolicy,
  createEngine,
  createGuard,
  type Guard,
  type GuardOptions,
  normalise,
  type ProcessResult,
  type TokenStore,
} from '@eve-pdpa-extension/core'
import { type AllowedPrefix, checkDestination, describe, parseAllowed } from './destination.js'
import { PdpaHttpError } from './errors.js'
import {
  createSigner,
  DEFAULT_TOLERANCE_SEC,
  type Scope,
  type Secret,
  type Signer,
} from './signature.js'

export interface GatewayOptions {
  /**
   * The rule sets a request may name, by name. A request without `policy`
   * gets `default`. Each is a file someone reviewed: a request chooses among
   * them and can never write its own rules, so a leaked secret cannot turn the
   * protection off. D11.
   */
  readonly policies: Readonly<Record<string, CompiledPolicy>>
  /** Signs and checks /inbound, /outbound and /end-session, and what is forwarded. ≥ 32 bytes. */
  readonly secret: Secret
  /**
   * Where /inbound sends the protected message when the request names no
   * `forwardTo`: the system that answers. Optional — without it, every
   * /inbound request must name one.
   */
  readonly forwardTo?: string
  /**
   * Where /outbound sends the checked answer when the request names no
   * `replyTo`: the chat app. Optional, as forwardTo.
   */
  readonly replyTo?: string
  /**
   * Limits the destinations a request may name: each must share the origin of
   * one of these URLs and start with its path. Leave it out to accept any
   * public https URL. The defaults above are not limited by it.
   */
  readonly allowedDestinations?: readonly string[]
  /**
   * Told about every forward, delivered or not: where it went, for which chat.
   * Waited for before the handler answers, as onAudit.
   */
  readonly onForward?: (record: ForwardRecord) => void | Promise<void>
  /**
   * Receives every audit event. Required: pass `() => {}` to discard audit on
   * purpose. When it returns a Promise, the gateway waits for it before it
   * answers — a serverless platform may stop the function the moment the
   * response is sent, and a log line still on its way would be lost.
   */
  readonly onAudit: (event: AuditRecord) => void | Promise<void>
  /**
   * Checks /resolve. Required when a policy tokenises, and must differ from
   * `secret`: an app that may send messages in should not be able to take real
   * values out. ≥ 32 bytes.
   */
  readonly resolveSecret?: Secret
  /**
   * Required when a policy tokenises. Shared by every machine the gateway runs
   * on — createUpstashTokenStore, or your own. Core's in-memory store keeps
   * each token on the machine that issued it, and on a serverless platform the
   * next request rarely lands there.
   */
  readonly tokenStore?: TokenStore
  /** For a policy that uses `hash`. As createGuard. */
  readonly hmacKey?: string | Uint8Array
  /** As createGuard: failures core caught instead of throwing. */
  readonly onError?: GuardOptions['onError']
  /** How old or new a signed timestamp may be. Default 300 seconds. */
  readonly toleranceSec?: number
  /** Larger request bodies are refused with 413. Default 64 KiB. */
  readonly maxBodyBytes?: number
  /** A forward that takes longer is abandoned and answered with 502. Default 10 000 ms. */
  readonly forwardTimeoutMs?: number
  /**
   * The longest a handler waits for onAudit and onForward Promises before it
   * answers. Default 5 000 ms. Past it the writes carry on, but nothing waits
   * for them again (D22).
   */
  readonly auditWaitMs?: number
  /** For tests. */
  readonly fetch?: typeof fetch
}

/** One forward, as onForward is told about it. No message text: only where it went. */
export interface ForwardRecord {
  readonly at: string
  readonly boundary: 'inbound' | 'outbound'
  readonly policy: string
  readonly sessionId: string
  readonly ref?: string
  /** Origin and path. The query and fragment are left out: they can carry tokens. */
  readonly destination: string
  /** Where the destination came from: the request, or the gateway's own default. */
  readonly destinationFrom: 'request' | 'default'
  readonly delivered: boolean
  /** The destination's HTTP status, or null when no answer came. */
  readonly status: number | null
}

export interface Gateway {
  inbound(request: Request): Promise<Response>
  outbound(request: Request): Promise<Response>
  resolve(request: Request): Promise<Response>
  endSession(request: Request): Promise<Response>
}

const POLICY_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const DEFAULT_POLICY = 'default'
const DEFAULT_MAX_BODY = 64 * 1024
const DEFAULT_FORWARD_TIMEOUT_MS = 10_000
const DEFAULT_AUDIT_WAIT_MS = 5_000
/** A destination or a purpose that reads as personal data at this confidence is refused. */
const ID_CONFIDENCE = 0.95

function configError(message: string): PdpaHttpError {
  return new PdpaHttpError('ERR_PDPA_HTTP_CONFIG', message)
}

function checkUrl(url: unknown, name: string): string | null {
  if (url === undefined) return null
  if (typeof url === 'string') {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.href
    } catch {}
  }
  throw configError(`${name} must be an http or https URL`)
}

function positiveInt(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value <= 0)
    throw configError(`${name} must be a positive integer`)
  return value
}

function sameBytes(a: Secret, b: Secret): boolean {
  const enc = new TextEncoder()
  const x = typeof a === 'string' ? enc.encode(a) : a
  const y = typeof b === 'string' ? enc.encode(b) : b
  return x.byteLength === y.byteLength && x.every((v, i) => v === y[i])
}

const tokenises = (policy: CompiledPolicy): boolean =>
  Object.values(policy.entities).some((rule) => rule?.action === 'tokenise')

// ---- responses ---------------------------------------------------------------

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Every answer may name a session, and /resolve answers with a real value.
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

/** A 400 that names the field and the rule, never the value it was given. */
const invalid = (field: string, message: string): Response =>
  json(400, { error: 'invalid_request', field, message })

/** One answer for a missing, wrong or stale signature: telling them apart only helps a forger. */
const unauthorized = (): Response =>
  json(401, { error: 'unauthorized', message: 'missing, invalid or expired signature' })

// ---- the request body -----------------------------------------------------------

type Field =
  | 'policy'
  | 'sessionId'
  | 'ref'
  | 'text'
  | 'context'
  | 'forwardTo'
  | 'replyTo'
  | 'token'
  | 'purpose'
  | 'caller'

interface FieldRule {
  readonly required: boolean
  /** Longest allowed. Text fields are bounded by maxBodyBytes instead. */
  readonly max?: number
}

const MESSAGE: Partial<Record<Field, FieldRule>> = {
  policy: { required: false, max: 64 },
  sessionId: { required: true, max: 256 },
  ref: { required: false, max: 256 },
  text: { required: true },
  context: { required: false },
}

/** /inbound names where to send the message, and where the answer should go after. */
const INBOUND: Partial<Record<Field, FieldRule>> = {
  ...MESSAGE,
  forwardTo: { required: false, max: 2048 },
  replyTo: { required: false, max: 2048 },
}

const OUTBOUND: Partial<Record<Field, FieldRule>> = {
  ...MESSAGE,
  replyTo: { required: false, max: 2048 },
}

const RESOLVE: Partial<Record<Field, FieldRule>> = {
  policy: { required: false, max: 64 },
  token: { required: true, max: 256 },
  sessionId: { required: true, max: 256 },
  purpose: { required: true, max: 128 },
  caller: { required: false, max: 128 },
  ref: { required: false, max: 256 },
}

const END_SESSION: Partial<Record<Field, FieldRule>> = {
  sessionId: { required: true, max: 256 },
}

type Fields = Partial<Record<Field, string>>

/**
 * The body as an object of the listed string fields, or the 400 to answer
 * with. An unlisted field is refused rather than ignored (D8.7): an app that
 * puts a phone number in a field this endpoint does not read would otherwise
 * believe it had been checked. The refusal does not name the field — the name
 * came from the request too.
 */
function parseFields(text: string, rules: Partial<Record<Field, FieldRule>>): Fields | Response {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return invalid('body', 'the body must be a JSON object')
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return invalid('body', 'the body must be a JSON object')
  }
  const allowed = Object.keys(rules)
  const record = body as Record<string, unknown>
  if (Object.keys(record).some((k) => !allowed.includes(k))) {
    return invalid(
      'body',
      `the body has a field this endpoint does not accept · accepted: ${allowed.join(', ')}`,
    )
  }
  const out: Fields = {}
  for (const [field, rule] of Object.entries(rules) as [Field, FieldRule][]) {
    const value = record[field]
    if (value === undefined) {
      if (rule.required) return invalid(field, `${field} is required`)
      continue
    }
    if (typeof value !== 'string') return invalid(field, `${field} must be a string`)
    if (rule.max !== undefined && (value.length === 0 || value.length > rule.max)) {
      return invalid(field, `${field} must be 1–${rule.max} characters`)
    }
    out[field] = value
  }
  return out
}

// ---- createGateway ------------------------------------------------------------

/**
 * The body, read until it passes `limit` and no further. A content-length that
 * is missing or not a number is not trusted: arrayBuffer() would hold every
 * byte a sender streams before the size could be checked (D22).
 */
async function readBody(request: Request, limit: number): Promise<Uint8Array | 'too_large'> {
  if (request.body === null) return new Uint8Array(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => {})
      return 'too_large'
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

export function createGateway(options: GatewayOptions): Gateway {
  const names = Object.keys(options.policies ?? {})
  if (names.length === 0) throw configError('policies must name at least one policy')
  for (const name of names) {
    if (!POLICY_NAME.test(name)) {
      throw configError(
        'policy names are letters, digits, _ and -, starting with a letter or digit',
      )
    }
  }
  if (typeof options.onAudit !== 'function') {
    throw configError('onAudit is required — pass () => {} to discard audit on purpose')
  }
  const signer = createSigner(options.secret, 'secret')
  const defaultForwardTo = checkUrl(options.forwardTo, 'forwardTo')
  const defaultReplyTo = checkUrl(options.replyTo, 'replyTo')
  let allowed: AllowedPrefix[] | null = null
  if (options.allowedDestinations !== undefined) {
    try {
      allowed = parseAllowed(options.allowedDestinations)
    } catch (error) {
      throw configError((error as Error).message)
    }
  }
  if (options.onForward !== undefined && typeof options.onForward !== 'function') {
    throw configError('onForward must be a function')
  }
  const toleranceSec = positiveInt(options.toleranceSec, DEFAULT_TOLERANCE_SEC, 'toleranceSec')
  const maxBodyBytes = positiveInt(options.maxBodyBytes, DEFAULT_MAX_BODY, 'maxBodyBytes')
  const forwardTimeoutMs = positiveInt(
    options.forwardTimeoutMs,
    DEFAULT_FORWARD_TIMEOUT_MS,
    'forwardTimeoutMs',
  )
  const auditWaitMs = positiveInt(options.auditWaitMs, DEFAULT_AUDIT_WAIT_MS, 'auditWaitMs')
  const doFetch = options.fetch ?? globalThis.fetch

  // Tokenise is optional. Where a policy uses it, both the shared store and a
  // separate secret for /resolve must be there before anything starts: found
  // missing on the first message, it would be a token nobody can resolve.
  const tokenising = names.filter((name) => tokenises(options.policies[name] as CompiledPolicy))
  let resolveSigner: Signer | null = null
  if (tokenising.length > 0) {
    const which = `policy '${tokenising[0]}' tokenises`
    if (options.tokenStore === undefined) {
      throw configError(
        `${which}: pass a tokenStore every machine shares, such as createUpstashTokenStore — ` +
          'an in-memory store loses tokens between serverless invocations',
      )
    }
    if (options.resolveSecret === undefined) {
      throw configError(`${which}: pass a resolveSecret for /resolve`)
    }
    resolveSigner = createSigner(options.resolveSecret, 'resolveSecret')
    if (sameBytes(options.resolveSecret, options.secret)) {
      throw configError('resolveSecret must differ from secret')
    }
  }

  // Audit and forward records still being written when the response would go out.
  const pending = new Set<Promise<void>>()
  function track(result: unknown): void {
    if (result === undefined || typeof (result as Promise<void>)?.then !== 'function') return
    const settled = Promise.resolve(result).then(
      () => {},
      () => {},
    )
    pending.add(settled)
    void settled.then(() => pending.delete(settled))
  }
  const onAudit = (event: AuditRecord): void | Promise<void> => {
    const result = options.onAudit(event)
    track(result)
    // Returned as is: core counts a rejected Promise as a lost audit event. D3.
    return result
  }
  /** A record that cannot be written does not fail the message: it was already sent. */
  function recordForward(record: ForwardRecord): void {
    if (options.onForward === undefined) return
    try {
      track(options.onForward(record))
    } catch {}
  }
  /**
   * Waits for what is still being written, up to auditWaitMs. The set is shared
   * by every request on this instance, so a write that never ends would hold up
   * each one after it: past the wait, those writes carry on but are no longer
   * waited for (D22).
   */
  async function flush(): Promise<void> {
    if (pending.size === 0) return
    const waiting = [...pending]
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = await Promise.race([
      Promise.all(waiting).then(() => false),
      new Promise<boolean>((done) => {
        timer = setTimeout(() => done(true), auditWaitMs)
      }),
    ])
    clearTimeout(timer)
    if (late) for (const p of waiting) pending.delete(p)
  }

  const guards = new Map<string, Guard>()
  for (const name of names) {
    guards.set(
      name,
      createGuard({
        policy: options.policies[name] as CompiledPolicy,
        onAudit,
        ...(options.onError === undefined ? {} : { onError: options.onError }),
        ...(options.hmacKey === undefined ? {} : { hmacKey: options.hmacKey }),
        ...(options.tokenStore === undefined ? {} : { tokenStore: options.tokenStore }),
      }),
    )
  }

  const engine = createEngine(BUILTIN_DETECTORS)
  function looksPersonal(value: string): boolean {
    const found = engine.runSync(normalise(value), { sessionId: 'anonymous', boundary: 'inbound' })
    return found.raw.some((c) => c.confidence >= ID_CONFIDENCE)
  }

  /**
   * purpose goes into audit as written and only ever names a purpose a policy
   * allows, so one that is personal data is refused (D22). sessionId, ref and
   * caller are taken as sent: they are the caller's own ids, the caller answers
   * for what is in them, and checking them refused about 1 in 100 random UUIDs
   * (D25).
   */
  function checkPurpose(fields: Fields): Response | null {
    if (fields.purpose !== undefined && looksPersonal(fields.purpose)) {
      return invalid(
        'purpose',
        'purpose looks like personal data — use a purpose your policy names',
      )
    }
    return null
  }

  /**
   * A destination from the request, read the way an id is: /inbound passes
   * replyTo on to the answering system as written, and onForward records the
   * path. A LINE userId or a phone number in it would skip the guard (D22).
   */
  function carriesPersonalData(url: URL): boolean {
    let readable = `${url.hostname}${url.pathname}${url.search}`
    try {
      readable = decodeURIComponent(readable)
    } catch {}
    return looksPersonal(readable)
  }

  function pick(name: string | undefined): { name: string; guard: Guard } | Response {
    const chosen = name ?? DEFAULT_POLICY
    const guard = guards.get(chosen)
    if (guard === undefined) {
      return invalid(
        'policy',
        name === undefined
          ? 'this gateway has no default policy — name one in policy'
          : `policy must be one of: ${names.join(', ')}`,
      )
    }
    return { name: chosen, guard }
  }

  /**
   * Method, size and signature, in that order. The body's bytes and text, or the
   * answer. The signature must be for this route's scope.
   */
  async function receive(
    request: Request,
    check: Signer,
    scope: Scope,
  ): Promise<{ bytes: Uint8Array; text: string } | Response> {
    if (request.method !== 'POST') {
      return json(405, { error: 'method_not_allowed', message: 'use POST' }, { allow: 'POST' })
    }
    const declared = request.headers.get('content-length')
    if (declared !== null && Number(declared) > maxBodyBytes) {
      return json(413, { error: 'too_large', message: `the body is over ${maxBodyBytes} bytes` })
    }
    let bytes: Uint8Array | 'too_large'
    try {
      bytes = await readBody(request, maxBodyBytes)
    } catch {
      // The sender's connection dropped mid-body, or the body was already read.
      // Answered like any other bad request, so no handler ever throws.
      return invalid('body', 'the body could not be read; send it again')
    }
    if (bytes === 'too_large') {
      return json(413, { error: 'too_large', message: `the body is over ${maxBodyBytes} bytes` })
    }
    let valid: boolean
    try {
      valid = await check.check(scope, request.headers, bytes, { toleranceSec })
    } catch {
      // Web Crypto failed underneath: the request may be fine, so not a 401.
      return json(500, {
        error: 'error',
        message: 'the signature could not be checked; send it again',
      })
    }
    if (!valid) return unauthorized()
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return invalid('body', 'the body must be UTF-8')
    }
    return { bytes, text }
  }

  /** POSTs a signed body on. Delivered means a 2xx in time; status is null when no answer came. */
  async function forward(
    url: string,
    body: string,
    scope: 'forward' | 'reply',
  ): Promise<{ delivered: boolean; status: number | null }> {
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await signer.sign(scope, body)) },
        body,
        // A redirect is not followed: fetch would resend the signed POST to
        // wherever it points, past every check on the destination (D22). A 3xx
        // is an answer that is not a 2xx, so the forward failed.
        redirect: 'manual',
        signal: AbortSignal.timeout(forwardTimeoutMs),
      })
      await res.body?.cancel().catch(() => {})
      return { delivered: res.ok, status: res.status }
    } catch {
      return { delivered: false, status: null }
    }
  }

  interface Destination {
    readonly url: URL
    readonly from: 'request' | 'default'
  }

  /**
   * The URL the request names in `field`, checked, or the gateway's default.
   * The 400 to answer with when it names one that is refused, or names none and
   * there is no default.
   */
  function destinationFor(
    named: string | undefined,
    fallback: string | null,
    field: 'forwardTo' | 'replyTo',
  ): Destination | Response {
    if (named !== undefined) {
      const checked = checkDestination(named, allowed)
      if (typeof checked === 'string') return invalid(field, `${field} ${checked}`)
      if (carriesPersonalData(checked)) {
        return invalid(
          field,
          `${field} looks like it carries personal data — address the system, not the person`,
        )
      }
      return { url: checked, from: 'request' }
    }
    if (fallback !== null) return { url: new URL(fallback), from: 'default' }
    return invalid(field, `${field} is required: this gateway has no default ${field}`)
  }

  async function protect(request: Request, boundary: 'inbound' | 'outbound'): Promise<Response> {
    const received = await receive(request, signer, boundary)
    if (received instanceof Response) return received
    const fields = parseFields(received.text, boundary === 'inbound' ? INBOUND : OUTBOUND)
    if (fields instanceof Response) return fields
    const chosen = pick(fields.policy)
    if (chosen instanceof Response) return chosen
    const sessionId = fields.sessionId as string

    // Where it goes, settled before anything is checked: a message that could
    // not be delivered is not worth protecting first.
    const to =
      boundary === 'inbound'
        ? destinationFor(fields.forwardTo, defaultForwardTo, 'forwardTo')
        : destinationFor(fields.replyTo, defaultReplyTo, 'replyTo')
    if (to instanceof Response) return to
    // /inbound passes the chat app's address on, so the system that answers can
    // send its reply back through /outbound without knowing it in advance.
    let replyOn: URL | undefined
    if (boundary === 'inbound' && fields.replyTo !== undefined) {
      const reply = destinationFor(fields.replyTo, null, 'replyTo')
      if (reply instanceof Response) return reply
      replyOn = reply.url
    }

    let result: ProcessResult
    try {
      result = await chosen.guard.process(fields.text as string, {
        sessionId,
        boundary,
        ...(fields.ref === undefined ? {} : { ref: fields.ref }),
        ...(fields.context === undefined ? {} : { context: fields.context }),
      })
    } catch {
      // D4: nothing goes on when the guard could not run.
      await flush()
      return json(500, {
        outcome: 'error',
        message: 'the message could not be checked; it was not sent on',
      })
    }

    if (result.outcome === 'blocked') {
      await flush()
      return json(200, { outcome: 'blocked', blockedBy: result.blockedBy ?? [] })
    }

    // context stops here: the system that answers keeps its own history.
    const onward = JSON.stringify({
      policy: chosen.name,
      sessionId,
      ...(fields.ref === undefined ? {} : { ref: fields.ref }),
      text: result.text,
      ...(replyOn === undefined ? {} : { replyTo: replyOn.href }),
    })
    const { delivered, status } = await forward(
      to.url.href,
      onward,
      boundary === 'inbound' ? 'forward' : 'reply',
    )
    recordForward({
      at: new Date().toISOString(),
      boundary,
      policy: chosen.name,
      sessionId,
      ...(fields.ref === undefined ? {} : { ref: fields.ref }),
      destination: describe(to.url),
      destinationFrom: to.from,
      delivered,
      status,
    })
    await flush()
    return delivered
      ? json(200, { outcome: 'processed' })
      : json(502, {
          outcome: 'forward_failed',
          message: 'the protected message could not be delivered; send it again',
        })
  }

  const noTokens = (): Response =>
    json(404, { error: 'not_found', message: 'no policy on this gateway tokenises' })

  return {
    inbound: (request) => protect(request, 'inbound'),
    outbound: (request) => protect(request, 'outbound'),

    async resolve(request) {
      if (resolveSigner === null) return noTokens()
      const received = await receive(request, resolveSigner, 'resolve')
      if (received instanceof Response) return received
      const fields = parseFields(received.text, RESOLVE)
      if (fields instanceof Response) return fields
      const refused = checkPurpose(fields)
      if (refused !== null) return refused
      const chosen = pick(fields.policy)
      if (chosen instanceof Response) return chosen
      if (!tokenising.includes(chosen.name)) {
        return invalid('policy', `policy '${chosen.name}' does not tokenise`)
      }
      try {
        const r = await chosen.guard.resolve(fields.token as string, {
          purpose: fields.purpose as string,
          sessionId: fields.sessionId as string,
          ...(fields.caller === undefined ? {} : { caller: fields.caller }),
          ...(fields.ref === undefined ? {} : { ref: fields.ref }),
        })
        await flush()
        return json(200, r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason })
      } catch {
        await flush()
        return json(500, { error: 'error', message: 'the token could not be resolved' })
      }
    },

    async endSession(request) {
      if (resolveSigner === null) return noTokens()
      const received = await receive(request, signer, 'end-session')
      if (received instanceof Response) return received
      const fields = parseFields(received.text, END_SESSION)
      if (fields instanceof Response) return fields
      try {
        // Every tokenising guard: each also remembers, per session, which
        // token it gave which value, and that has to go too.
        await Promise.all(
          tokenising.map((name) =>
            (guards.get(name) as Guard).endSession(fields.sessionId as string),
          ),
        )
      } catch {
        return json(500, { error: 'error', message: 'the session could not be ended; try again' })
      }
      return json(200, { ok: true })
    },
  }
}
