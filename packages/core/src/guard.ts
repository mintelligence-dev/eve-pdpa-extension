import { canonicalValue } from './actions/canonical.js'
import { hashValue, resolveHmac } from './actions/hash.js'
import { maskValue } from './actions/mask.js'
import {
  createTokeniser,
  DEFAULT_TTL_SEC,
  judge,
  parseTokenId,
  type StoreStep,
} from './actions/tokenise.js'
import { allowlistDigestForm, compileAllowlist } from './allowlist.js'
import type { Hmac } from './crypto/hmac.js'
import { sha256 } from './crypto/sha256.js'
import { BUILTIN_DETECTORS } from './detectors/index.js'
import { createEngine, type EngineResult } from './engine.js'
import { PdpaError } from './errors.js'
import { normalise, toOriginalSpan } from './normalise.js'
import { actionFor, definePolicy } from './policy.js'
import { resolveRandomSource, tokenId } from './random.js'
import { createMemoryTokenStore } from './tokens/memory-store.js'
import type {
  AuditEvent,
  AuditFinding,
  AuditRecord,
  Boundary,
  DetectContext,
  Guard,
  GuardErrorContext,
  GuardOptions,
  GuardStats,
  NormalisedText,
  PolicyLoadedEvent,
  ProcessOptions,
  ProcessResult,
  RandomSource,
  RenderedItem,
  ResolveOptions,
  ResolveReason,
  ResolveResult,
  TokenRecord,
  TokenResolveEvent,
  TokenStore,
} from './types.js'
import { ENTITY_TYPES, type EntityType } from './types.js'
import { VERSION } from './version.js'

const PLACEHOLDER_TH: Readonly<Record<EntityType, string>> = {
  TH_NATIONAL_ID: '[เลขบัตรประชาชน]',
  PHONE: '[เบอร์โทร]',
  EMAIL: '[อีเมล]',
  BANK_ACCOUNT: '[เลขบัญชี]',
  CREDIT_CARD: '[บัตรเครดิต]',
  LINE_USER_ID: '[LINE ID]',
}

const PLACEHOLDER_EN: Readonly<Record<EntityType, string>> = {
  TH_NATIONAL_ID: '[thai-national-id]',
  PHONE: '[phone]',
  EMAIL: '[email]',
  BANK_ACCOUNT: '[bank-account]',
  CREDIT_CARD: '[credit-card]',
  LINE_USER_ID: '[line-id]',
}

/** For a token the guard cannot vouch for: not issued here, or not to this session. */
const PLACEHOLDER_UNKNOWN_TH = '[ข้อมูลที่ปิดไว้]'
const PLACEHOLDER_UNKNOWN_EN = '[redacted]'

/**
 * A token as a model may echo it in a reply: bracketed as issued, or with the
 * brackets dropped. The letter guards keep it from matching inside a longer word.
 */
const TOKEN_IN_REPLY = /\[?(?<![A-Za-z])tok:([bcdfghjkmnpqrstv]{16})(?![A-Za-z])\]?/g

/** A hash placeholder, which is only ever written bracketed and with a known entity. */
const HASH_IN_REPLY = new RegExp(`\\[(${ENTITY_TYPES.join('|')}):[bcdfghjkmnpqrstv]{16}\\]`, 'g')

/** Both of the above, in one pass: group 1 is a token id, group 2 a hashed entity. */
const OUTBOUND_REWRITE = new RegExp(`${TOKEN_IN_REPLY.source}|${HASH_IN_REPLY.source}`, 'g')

const utf8 = new TextEncoder()

function sha256Hex(value: string): string {
  let hex = ''
  for (const b of sha256(utf8.encode(value))) hex += b.toString(16).padStart(2, '0')
  return `sha256:${hex}`
}

/** Everything scan() asks its driver to do: run the detectors, or call the token store. */
type Step =
  | { readonly op: 'detect'; readonly input: NormalisedText; readonly ctx: DetectContext }
  | StoreStep

/**
 * A token store call that threw or rejected, as the drivers hand it back into
 * scan. Lets scan tell a store failure — reported as `token_store` (D15) — from
 * anything else that can fail while issuing a token, such as the random source.
 */
class StoreFailure extends Error {
  readonly original: unknown
  constructor(original: unknown) {
    super('token store failed')
    this.original = original
  }
}

/** Long enough for any id an app would use; short enough that nobody pastes a message in. */
const MAX_REF_LENGTH = 256

/**
 * A ref is the app's pointer into its own records. Checked, not trusted: a
 * wrong type is a bug in the caller, and failing loudly beats an audit event
 * that silently lost the one field that would have found the message.
 */
function checkRef(ref: unknown): string | undefined {
  if (ref === undefined) return undefined
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > MAX_REF_LENGTH) {
    throw new TypeError(`ref must be a string of 1 to ${MAX_REF_LENGTH} characters`)
  }
  return ref
}

/** Cue words sit near the end of a question; the tail is all a detector needs. */
const MAX_CONTEXT_LENGTH = 500

/**
 * Lowercased once here so detectors compare English cues without folding it
 * again. A wrong type is a caller bug and fails loudly, as `ref` does.
 */
function checkContext(context: unknown): string | undefined {
  if (context === undefined || context === null) return undefined
  if (typeof context !== 'string') throw new TypeError('context must be a string')
  return context.slice(-MAX_CONTEXT_LENGTH).toLowerCase()
}

function nowIso(): string {
  return new Date().toISOString()
}

// Once per process, not per guard: a service builds guards in a loop, and a
// warning repeated on every one is a warning everyone learns to filter out.
let warnedNoAuditSink = false

export function createGuard(options: GuardOptions): Guard {
  const policy = options.policy
  if (policy === undefined || typeof policy.hash !== 'string') {
    throw new TypeError('createGuard requires a policy built by definePolicy() or parsePolicy()')
  }

  // Resolve the CSPRNG eagerly, but only when the policy actually needs one.
  // Failing at construction beats failing on the first message that matters.
  const needsRandom = Object.values(policy.entities).some((r) => r?.action === 'tokenise')
  let random: RandomSource | null = null
  if (needsRandom) random = resolveRandomSource(options.randomSource)

  // D6: the bundled memory store unless the host plugs in its own.
  const store: TokenStore | null = needsRandom
    ? (options.tokenStore ?? createMemoryTokenStore())
    : null
  const tokeniser = store !== null && random !== null ? createTokeniser(random) : null

  // Same rule for the HMAC key: refuse to build a guard that could not apply
  // its own policy. A key the policy never uses is never touched.
  const needsHmac = Object.values(policy.entities).some((r) => r?.action === 'hash')
  let hmac: Hmac | null = null
  if (needsHmac) hmac = resolveHmac(options.hmacKey)

  const onAudit = options.onAudit
  const onError = options.onError
  let auditSinkErrors = 0
  let tokenStoreErrors = 0

  /**
   * A failure core handled instead of throwing: counted, so a health check can
   * see it, and passed to onError. onError throwing in turn is ignored, so a
   * broken error handler cannot fail the message.
   */
  function report(
    error: unknown,
    source: GuardErrorContext['source'],
    eventType: AuditRecord['type'],
  ): void {
    if (source === 'audit_sink') auditSinkErrors++
    else tokenStoreErrors++
    if (onError === undefined) return
    try {
      onError(error, { source, eventType })
    } catch {}
  }

  // D3: running without a sink is allowed — a first try should not hit a wall —
  // but never silently, because audit nobody kept is a compliance gap.
  if (onAudit === undefined && !warnedNoAuditSink) {
    warnedNoAuditSink = true
    console.warn(
      '[thai-pdpa-guard] createGuard was given no onAudit: audit events are being discarded. ' +
        'Pass onAudit to keep them, or onAudit: () => {} to discard them on purpose.',
    )
  }

  /**
   * The only way an audit event leaves core. A sink that throws does not take
   * the message down with it (D3) — losing the guard over a logging failure
   * would be worse than losing the log line — but it is counted and reported,
   * never swallowed. onError throwing in turn is ignored, so a broken error
   * handler cannot fail the message either.
   *
   * An async sink is not waited for — the sink is sync by contract (D3) — but
   * a Promise it returns is not dropped either: a rejection counts the same as
   * a throw, just later, and never surfaces as an unhandled rejection.
   */
  function emit(event: AuditRecord): void {
    if (onAudit === undefined) return
    const sinkFailed = (error: unknown): void => report(error, 'audit_sink', event.type)
    let returned: unknown
    try {
      returned = onAudit(event)
    } catch (error) {
      sinkFailed(error)
      return
    }
    if (
      typeof returned === 'object' &&
      returned !== null &&
      typeof (returned as PromiseLike<unknown>).then === 'function'
    ) {
      try {
        ;(returned as PromiseLike<unknown>).then(undefined, sinkFailed)
      } catch (error) {
        sinkFailed(error)
      }
    }
  }

  // The engine owns detector failure, overlap and async; guard keeps policy.
  // Its detectorIds and entitiesSupported describe the detectors really loaded,
  // so the audit event cannot claim cover this build does not have.
  const engine = createEngine(options.detectors ?? BUILTIN_DETECTORS)

  // Compiled once per guard, not per message.
  const allowlist = compileAllowlist(policy.allowlist)

  /**
   * D10.4: a policy that tokenises needs to know whose conversation this is.
   * Defaulting every caller to one shared 'anonymous' session would let one
   * customer's chat resolve another's token, and give the same number from two
   * customers the same token — with nothing to say it was happening. A policy
   * without tokenise has nothing to keep apart, so it still defaults.
   */
  function sessionFor(sessionId: string | undefined, call: string): string {
    if (store !== null && (sessionId === undefined || sessionId === '')) {
      throw new PdpaError(
        'ERR_PDPA_NO_SESSION',
        `${call} needs a sessionId: this policy tokenises, and tokens are kept apart by session. ` +
          'Pass the conversation id, e.g. { sessionId: chat.id }',
      )
    }
    return sessionId ?? 'anonymous'
  }

  function newEventId(startedAt: number): string {
    // An event id only has to be unique enough to tell events apart. If the
    // random source has broken, the message has already been blocked by the
    // action that needed it; recording that must not fail as well.
    if (random !== null) {
      try {
        return tokenId(random)
      } catch {}
    }
    return `t${startedAt.toString(36)}`
  }

  // D10.7: one event that says what this guard's policy hash means, so the log
  // explains itself. Emitted last, once nothing above can still refuse to build.
  if (onAudit !== undefined) {
    const loaded: PolicyLoadedEvent = {
      schemaVersion: '1.0',
      eventId: newEventId(Date.now()),
      type: 'policy.loaded',
      at: nowIso(),
      policy: {
        hash: policy.hash,
        entitySet: policy.entitySet,
        onUnmapped: policy.onUnmapped,
        placeholderLanguage: policy.placeholderLanguage,
        entities: policy.entities,
        allowlist: {
          exact: policy.allowlist.exact.map((e) => sha256Hex(allowlistDigestForm(e))),
          pattern: [...policy.allowlist.pattern],
        },
      },
      engine: {
        version: VERSION,
        detectors: engine.detectorIds,
        entitiesSupported: engine.entitiesSupported,
        nerAvailable: false,
      },
      prevHash: null,
    }
    emit(loaded)
  }

  /**
   * Shared by resolve and resolveSync once the record is in hand. Writes the
   * audit event for every attempt — allowed or refused — and only ever names a
   * token id that parsed, never the string the caller passed.
   */
  function settle(
    id: string | null,
    rec: TokenRecord | undefined,
    storeFailed: boolean,
    sessionId: string,
    opts: ResolveOptions,
  ): { result: ResolveResult; expired: boolean } {
    const ref = checkRef(opts.ref)
    // A store that could not be asked says nothing about the token: the
    // attempt is refused and recorded like any other, never thrown (D15).
    const reason: ResolveReason | null = storeFailed
      ? 'store_unavailable'
      : id === null
        ? 'not_found'
        : judge(rec, sessionId, opts.purpose, Date.now())

    if (onAudit !== undefined) {
      const event: TokenResolveEvent = {
        schemaVersion: '1.0',
        eventId: newEventId(Date.now()),
        type: 'token.resolve',
        at: nowIso(),
        sessionId,
        ...(ref === undefined ? {} : { ref }),
        policy: { hash: policy.hash, entitySet: policy.entitySet },
        tokenId: id,
        // Only for a record in this session: naming the entity of someone
        // else's token would tell a mismatched caller what it nearly got.
        entity: rec !== undefined && reason !== 'session_mismatch' ? rec.entity : null,
        purpose: opts.purpose,
        caller: opts.caller ?? null,
        outcome: reason === null ? 'allowed' : 'denied',
        ...(reason === null ? {} : { reason }),
        prevHash: null,
      }
      emit(event)
    }

    if (reason !== null) return { result: { ok: false, reason }, expired: reason === 'expired' }
    return { result: { ok: true, value: (rec as TokenRecord).value }, expired: false }
  }

  /**
   * The whole of processing one message, written once. It yields wherever it
   * needs the outside world — the detectors, the token store — and the driver
   * that runs it decides whether that happens synchronously (processSync) or
   * with await (process). Nothing in here knows which.
   */
  function* scan(
    text: string,
    opts: ProcessOptions | undefined,
  ): Generator<Step, ProcessResult, unknown> {
    const startedAt = Date.now()
    const sessionId = sessionFor(opts?.sessionId, 'process')
    const boundary: Boundary = opts?.boundary ?? 'inbound'
    const ref = checkRef(opts?.ref)
    const previous = checkContext(opts?.context)

    const norm = normalise(text)

    // Detectors read the folded text; everything after this point works on the
    // ORIGINAL. Rewriting the folded copy would hand the customer back a
    // message with their Thai numerals silently turned into ASCII.
    const ctx: DetectContext =
      previous === undefined ? { sessionId, boundary } : { sessionId, boundary, previous }
    const detected = (yield { op: 'detect', input: norm, ctx }) as EngineResult

    // Translating after the merge is safe: the map only ever moves offsets
    // forward, so two spans that did not overlap in the folded text cannot
    // start overlapping in the original.
    // The folded slice is kept alongside: comparing values (allowlist, and
    // later hash and token reuse) must see ๐๙๑ and 091 as the same digits.
    const candidates = detected.candidates.map((c) => {
      const [start, end] = toOriginalSpan(norm, c.start, c.end)
      return { ...c, start, end, folded: norm.text.slice(c.start, c.end) }
    })

    const findings: AuditFinding[] = []
    let outcome: 'processed' | 'blocked' = 'processed'
    // Collected right to left like everything else in this loop; put back in
    // reading order when the result is built.
    const blockers: EntityType[] = []

    // Walked right to left: the pieces below are collected from the end.
    const ordered = [...candidates].sort((a, b) => b.start - a.start)
    // Built from pieces and joined once. Splicing each replacement into the
    // whole string copied the message once per value: seconds for a tool
    // output listing thousands of customers.
    const original = norm.original
    const pieces: string[] = []
    let cursor = original.length

    for (const c of ordered) {
      const rule = policy.entities[c.entity]
      const minConfidence = rule?.minConfidence ?? 0.95
      if (c.confidence < minConfidence) continue

      const action = actionFor(policy, c.entity)
      if (action === null) continue

      let finding: AuditFinding = {
        entity: c.entity,
        start: c.start,
        end: c.end,
        confidence: c.confidence,
        detector: c.detector,
        action,
        ...(rule === undefined ? { unmapped: true as const } : {}),
      }

      // D1: found, and allowed through. Reported so the audit shows the value
      // was seen and deliberately let pass, rather than never found at all.
      // Checked after the threshold on purpose — a candidate too weak to act on
      // is not a finding, allowlisted or not.
      if (!allowlist.isEmpty && allowlist.allows(c.entity, canonicalValue(c.entity, c.folded))) {
        findings.push({ ...finding, allowlisted: true })
        continue
      }

      const placeholder =
        policy.placeholderLanguage === 'en' ? PLACEHOLDER_EN[c.entity] : PLACEHOLDER_TH[c.entity]

      let replacement: string | null = null
      if (action === 'redact') {
        replacement = placeholder
      } else if (action === 'mask') {
        replacement = maskValue(original.slice(c.start, c.end), rule?.keep)
      } else if (action === 'tokenise') {
        // onUnmapped cannot be tokenise, so a tokenise finding always has a rule.
        if (tokeniser === null || rule === undefined) {
          throw new TypeError('unreachable: tokenise without a tokeniser or rule')
        }
        try {
          // Taken from the span as typed, before it is replaced, so an
          // outbound reply can show ๐๙๑-๘๘๘-๗๗๗๗ as xxx-xxx-๗๗๗๗ (D10.1).
          const display =
            rule.display === 'redact'
              ? undefined
              : maskValue(original.slice(c.start, c.end), 'last4')
          const id = yield* tokeniser.issue(
            sessionId,
            c.entity,
            canonicalValue(c.entity, c.folded),
            rule,
            display,
          )
          replacement = `[tok:${id}]`
          finding = {
            ...finding,
            tokenId: id,
            ttlSec: rule.ttlSec ?? DEFAULT_TTL_SEC,
            allowedPurposes: [...(rule.allowedPurposes ?? [])],
          }
        } catch (error) {
          // D4 level 2: the store refused (full, or broken), or the random
          // source did. The value was found and cannot be hidden the way the
          // policy asked, so the message stops rather than going out with the
          // raw value in it. A store failure is also reported and marked on the
          // finding: otherwise a store that is down blocks every message with
          // a phone number in it and nothing says why (D15).
          if (error instanceof StoreFailure) {
            report(error.original, 'token_store', 'scan')
            finding = { ...finding, failed: 'token_store' }
          }
          outcome = 'blocked'
          blockers.push(c.entity)
        }
      } else if (action === 'block') {
        outcome = 'blocked'
        blockers.push(c.entity)
      } else if (action === 'flag') {
        // Correct as written, not unfinished: flag means the value reaches the
        // model and only the finding records that it did.
        replacement = null
      } else {
        // hash — the only action left. Reads the canonical value, not the
        // span as typed, so every way of writing one number gives one hash.
        if (hmac === null) throw new TypeError('unreachable: hash without an HMAC key')
        replacement = hashValue(hmac, c.entity, canonicalValue(c.entity, c.folded))
      }

      if (replacement !== null) {
        pieces.push(original.slice(c.end, cursor), replacement)
        cursor = c.start
      }

      findings.push(finding)
    }

    findings.reverse()
    pieces.push(original.slice(0, cursor))
    let out = pieces.reverse().join('')

    // D10.1: a reply on its way to the customer must not carry a token or a
    // hash they cannot read. Tokens issued to this session come back masked;
    // anything else — another session's token, an unknown one, a hash —
    // becomes a placeholder. The full value is never written back.
    // Each rewrite is recorded, not just counted (D10.8): a token from another
    // chat in this reply is the one finding here that someone must look at.
    const rendered: RenderedItem[] = []
    if (boundary === 'outbound' && outcome === 'processed') {
      const th = policy.placeholderLanguage !== 'en'
      const unknownText = th ? PLACEHOLDER_UNKNOWN_TH : PLACEHOLDER_UNKNOWN_EN
      // One pass over both shapes, so the list comes out in reading order.
      // Matches are collected first and the store is asked about each token
      // in turn, because a store call cannot be made from inside replace().
      let rewritten = ''
      let at = 0
      for (const m of out.matchAll(OUTBOUND_REWRITE)) {
        const [whole, id, hashed] = m as unknown as [
          string,
          string | undefined,
          EntityType | undefined,
        ]
        rewritten += out.slice(at, m.index)
        at = (m.index ?? 0) + whole.length
        if (hashed !== undefined) {
          rendered.push({ kind: 'hash', entity: hashed, as: 'placeholder' })
          rewritten += th ? PLACEHOLDER_TH[hashed] : PLACEHOLDER_EN[hashed]
          continue
        }
        const tokenId = id as string
        let rec: TokenRecord | undefined
        let unavailable = false
        if (store !== null) {
          try {
            rec = (yield { op: 'get', id: tokenId }) as TokenRecord | undefined
          } catch (error) {
            // A store that cannot answer cannot vouch for the token either.
            // The customer gets the placeholder, never the token text, and the
            // event says the store failed rather than the token being unknown.
            report(error instanceof StoreFailure ? error.original : error, 'token_store', 'scan')
            unavailable = true
          }
        }
        if (unavailable) {
          rendered.push({ kind: 'token', tokenId, entity: null, as: 'unavailable' })
          rewritten += unknownText
        } else if (rec === undefined) {
          rendered.push({ kind: 'token', tokenId, entity: null, as: 'unknown' })
          rewritten += unknownText
        } else if (rec.sessionId !== sessionId) {
          rendered.push({ kind: 'token', tokenId, entity: null, as: 'foreign' })
          rewritten += unknownText
        } else if (rec.display !== undefined) {
          rendered.push({ kind: 'token', tokenId, entity: rec.entity, as: 'masked' })
          rewritten += rec.display
        } else {
          rendered.push({ kind: 'token', tokenId, entity: rec.entity, as: 'placeholder' })
          rewritten += th ? PLACEHOLDER_TH[rec.entity] : PLACEHOLDER_EN[rec.entity]
        }
      }
      out = rewritten + out.slice(at)
    }

    if (onAudit !== undefined) {
      // Built only when someone will receive it.
      const event: AuditEvent = {
        schemaVersion: '1.0',
        eventId: newEventId(startedAt),
        type: 'scan',
        at: nowIso(),
        sessionId,
        ...(ref === undefined ? {} : { ref }),
        boundary,
        ...(previous === undefined ? {} : { contextUsed: true as const }),
        policy: { hash: policy.hash, entitySet: policy.entitySet },
        engine: {
          version: VERSION,
          detectors: engine.detectorIds,
          entitiesSupported: engine.entitiesSupported,
          nerAvailable: false,
        },
        input: { chars: text.length },
        findings,
        skippedDetectors: detected.skippedDetectors,
        degradedDetectors: detected.degradedDetectors,
        outcome,
        ...(rendered.length === 0 ? {} : { rendered }),
        durationMs: Date.now() - startedAt,
        prevHash: null,
      }
      emit(event)
    }

    if (outcome === 'blocked') {
      // D8.2: a blocked message returns no text at all, not the redacted text.
      // Protection that depends on every caller remembering to check `outcome`
      // is protection that disappears the day someone is in a hurry. What the
      // caller gets instead is the reason — entity types only, never a value.
      return {
        text: '',
        findings,
        outcome,
        blockedBy: [...new Set(blockers.reverse())],
        skippedDetectors: detected.skippedDetectors,
      }
    }

    return { text: out, findings, outcome, skippedDetectors: detected.skippedDetectors }
  }

  /** Runs scan to completion, performing each step synchronously. */
  function driveSync<T>(gen: Generator<Step, T, unknown>): T {
    let next = gen.next()
    while (!next.done) {
      let value: unknown
      try {
        value = stepSync(next.value)
      } catch (error) {
        next = gen.throw(error)
        continue
      }
      next = gen.next(value)
    }
    return next.value
  }

  function stepSync(step: Step): unknown {
    if (step.op === 'detect') return engine.runSync(step.input, step.ctx)
    // processSync refused an async store up front, so these return plain values.
    if (store === null) throw new TypeError('unreachable: store step without a store')
    try {
      if (step.op === 'get') return store.get(step.id)
      return store.set(step.id, step.rec)
    } catch (error) {
      throw new StoreFailure(error)
    }
  }

  /** Runs scan to completion, awaiting each step. */
  async function driveAsync<T>(gen: Generator<Step, T, unknown>): Promise<T> {
    let next = gen.next()
    while (!next.done) {
      let value: unknown
      try {
        value = await stepAsync(next.value)
      } catch (error) {
        next = gen.throw(error)
        continue
      }
      next = gen.next(value)
    }
    return next.value
  }

  async function stepAsync(step: Step): Promise<unknown> {
    if (step.op === 'detect') return engine.run(step.input, step.ctx)
    if (store === null) throw new TypeError('unreachable: store step without a store')
    try {
      if (step.op === 'get') return await store.get(step.id)
      return await store.set(step.id, step.rec)
    } catch (error) {
      throw new StoreFailure(error)
    }
  }

  return {
    get stats(): GuardStats {
      return { auditSinkErrors, tokenStoreErrors }
    },

    async resolve(token, opts): Promise<ResolveResult> {
      const sessionId = sessionFor(opts.sessionId, 'resolve')
      const id = parseTokenId(token)
      let rec: TokenRecord | undefined
      let storeFailed = false
      if (id !== null && store !== null) {
        try {
          rec = await store.get(id)
        } catch (error) {
          report(error, 'token_store', 'token.resolve')
          storeFailed = true
        }
      }
      const { result, expired } = settle(id, rec, storeFailed, sessionId, opts)
      // D6: an expired token is deleted the moment it is asked for. It has
      // already been refused, so a store that fails here only gets reported.
      if (expired && id !== null && store !== null) {
        try {
          await store.delete(id)
        } catch (error) {
          report(error, 'token_store', 'token.resolve')
        }
      }
      return result
    },

    resolveSync(token, opts): ResolveResult {
      if (store !== null && !store.sync) {
        throw new PdpaError(
          'ERR_PDPA_ASYNC_STORE',
          'resolveSync needs a sync token store; this guard has an async one — use resolve',
        )
      }
      const sessionId = sessionFor(opts.sessionId, 'resolveSync')
      const id = parseTokenId(token)
      let rec: TokenRecord | undefined
      let storeFailed = false
      if (id !== null && store !== null) {
        try {
          rec = store.get(id) as TokenRecord | undefined
        } catch (error) {
          report(error, 'token_store', 'token.resolve')
          storeFailed = true
        }
      }
      const { result, expired } = settle(id, rec, storeFailed, sessionId, opts)
      if (expired && id !== null && store !== null) {
        try {
          store.delete(id)
        } catch (error) {
          report(error, 'token_store', 'token.resolve')
        }
      }
      return result
    },

    endSession(sessionId) {
      tokeniser?.forgetSession(sessionId)
      return store?.clearSession(sessionId)
    },

    processSync(text, opts): ProcessResult {
      // D6: never skip tokenise and carry on — that would let the value through
      // under a policy that said to hide it.
      if (store !== null && !store.sync) {
        throw new PdpaError(
          'ERR_PDPA_ASYNC_STORE',
          'this policy tokenises and the token store is async; processSync cannot wait for it — use process',
        )
      }
      return driveSync(scan(text, opts))
    },

    // Same rules as processSync. Also runs async detectors, which processSync
    // can only report as skipped, and waits on an async token store.
    process(text, opts): Promise<ProcessResult> {
      return driveAsync(scan(text, opts))
    },
  }
}

export { definePolicy, ENTITY_TYPES }
