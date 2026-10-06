// erasableSyntaxOnly is on, so no enums: const arrays + derived unions instead.

export const ENTITY_TYPES = [
  'TH_NATIONAL_ID',
  'PHONE',
  'EMAIL',
  'BANK_ACCOUNT',
  'CREDIT_CARD',
  'LINE_USER_ID',
] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

export const ACTIONS = ['redact', 'mask', 'tokenise', 'hash', 'flag', 'block'] as const
export type Action = (typeof ACTIONS)[number]

export const BOUNDARIES = ['inbound', 'prompt', 'tool_input', 'tool_output', 'outbound'] as const
export type Boundary = (typeof BOUNDARIES)[number]

/** Bytes from a cryptographically secure source. See D7. */
export type RandomSource = (byteLength: number) => Uint8Array

/**
 * One point where the normalised text and the original stopped lining up.
 *
 * Stored sparsely rather than as one entry per character: almost every real
 * message drops nothing at all, so `shifts` is usually null and translating an
 * offset costs nothing.
 */
export interface OffsetShift {
  /** First normalised index at which `dropped` applies. */
  readonly at: number
  /** Total original characters removed before that point. */
  readonly dropped: number
}

export interface NormalisedText {
  /** Text the detectors see. Never returned to the caller. */
  readonly text: string
  /** Original input, kept so redaction can rewrite it rather than the folded copy. */
  readonly original: string
  /** null means the two line up 1:1 and no translation is needed. */
  readonly shifts: readonly OffsetShift[] | null
}

export interface Candidate {
  readonly entity: EntityType
  readonly start: number
  readonly end: number
  readonly confidence: number
  readonly detector: string
}

export interface DetectContext {
  readonly sessionId: string
  readonly boundary: Boundary
  /**
   * The other side's last message, lowercased, when the caller passed one as
   * `context`. Read for cue words only. D10.11.
   */
  readonly previous?: string
}

export interface Detector {
  readonly id: string
  readonly entities: readonly EntityType[]
  detect(input: NormalisedText, ctx: DetectContext): Candidate[] | Promise<Candidate[]>
}

export interface EntityRule {
  readonly action: Action
  readonly minConfidence?: number
  readonly keep?: 'last4'
  readonly ttlSec?: number
  readonly allowedPurposes?: readonly string[]
  /**
   * `tokenise` only: what the customer sees when a token comes back out in an
   * outbound reply. `mask` (default) shows the value as typed with all but the
   * last four characters hidden; `redact` shows the placeholder. D10.1.
   */
  readonly display?: 'mask' | 'redact'
}

export interface PolicyInput {
  /** For editors: the path or URL of policy.schema.json. Ignored by the guard. */
  readonly $schema?: string
  readonly entitySet: string
  readonly onUnmapped?: 'redact' | 'flag' | 'ignore'
  readonly entities: Readonly<Partial<Record<EntityType, EntityRule>>>
  readonly allowlist?: { readonly exact?: readonly string[]; readonly pattern?: readonly string[] }
  readonly placeholderLanguage?: 'th' | 'en'
}

declare const compiled: unique symbol

/** Only definePolicy/parsePolicy can produce this. createGuard accepts nothing else. */
export interface CompiledPolicy {
  readonly [compiled]: true
  readonly entitySet: string
  readonly onUnmapped: 'redact' | 'flag' | 'ignore'
  readonly entities: Readonly<Partial<Record<EntityType, EntityRule>>>
  readonly placeholderLanguage: 'th' | 'en'
  /** As written in the policy. Validated at load; guard compiles it once. */
  readonly allowlist: { readonly exact: readonly string[]; readonly pattern: readonly string[] }
  /** Goes into every audit event so a scan can be reproduced. D2. */
  readonly hash: string
}

export interface AuditFinding {
  readonly entity: EntityType
  readonly start: number
  readonly end: number
  readonly confidence: number
  readonly detector: string
  /** The action the policy names. Not applied when `allowlisted` is set. */
  readonly action: Action
  readonly unmapped?: true
  /** Found, but the policy allows this value through. The text was left as is. D1. */
  readonly allowlisted?: true
  /** `tokenise` only: the id written into the text, so a later resolve can be traced back. D2. */
  readonly tokenId?: string
  /** `tokenise` only: the lifetime the policy gave the token. D2. */
  readonly ttlSec?: number
  /**
   * `tokenise` only: the purposes the policy allowed this token to be resolved
   * for, as they stood when it was issued. Lets a reader of the log compare a
   * later `token.resolve` against what was permitted at collection, without
   * finding the policy file the hash points to. Purpose names, never values. D10.6.
   */
  readonly allowedPurposes?: readonly string[]
}

/** Carries positions and types. Never a real value. D2. */
export interface AuditEvent {
  readonly schemaVersion: '1.0'
  readonly eventId: string
  readonly type: 'scan'
  readonly at: string
  readonly sessionId: string
  /**
   * The caller's own id for what this event is about — a message id, a tool-call
   * id — copied into the audit event as is, so an investigator can go from the
   * log to the record in the app's own system. Must not itself be personal data.
   * D10.9.
   */
  readonly ref?: string
  readonly boundary: Boundary
  /** The caller passed `context`. Its text is not recorded. D10.11. */
  readonly contextUsed?: true
  readonly policy: { readonly hash: string; readonly entitySet: string }
  readonly engine: {
    readonly version: string
    readonly detectors: readonly string[]
    readonly entitiesSupported: readonly EntityType[]
    readonly nerAvailable: false
  }
  readonly input: { readonly chars: number }
  readonly findings: readonly AuditFinding[]
  readonly skippedDetectors: readonly string[]
  readonly degradedDetectors: readonly string[]
  readonly outcome: 'processed' | 'blocked' | 'error'
  /**
   * `outbound` only, and only when something was rewritten: each token or hash
   * the model wrote into its reply, in reading order, and what the customer was
   * shown instead. D10.1, D10.8.
   */
  readonly rendered?: readonly RenderedItem[]
  readonly durationMs: number
  readonly prevHash: string | null
}

/**
 * One token or hash rewritten in an outbound reply. Never the value, and never
 * the masked form either — only enough to tell normal from suspicious. D10.8.
 *
 *   masked       a token issued to this session, shown as xxx-xxx-7777
 *   placeholder  a token under display: 'redact', or a hash — shown as [เบอร์โทร]
 *   foreign      a token issued to ANOTHER session. Data crossing between chats.
 *   unknown      a token this guard does not hold: forged, expired, or ended
 */
export interface RenderedItem {
  readonly kind: 'token' | 'hash'
  /** The id the model wrote, for a token. Absent for a hash. */
  readonly tokenId?: string
  /** null for foreign and unknown: whose data it is not, is not this event's to say. */
  readonly entity: EntityType | null
  readonly as: 'masked' | 'placeholder' | 'foreign' | 'unknown'
}

export type ResolveReason = 'not_found' | 'session_mismatch' | 'expired' | 'purpose_not_allowed'

/**
 * One per resolve attempt, allowed or refused. D2, D6.
 *
 * A refusal is the more valuable record: it shows something asking for a real
 * value outside the purpose it was collected for. Never carries the value, and
 * never echoes the string the caller passed in — only a token id that matched
 * the token format, so a raw number passed by mistake cannot reach the log.
 */
export interface TokenResolveEvent {
  readonly schemaVersion: '1.0'
  readonly eventId: string
  readonly type: 'token.resolve'
  readonly at: string
  readonly sessionId: string
  /**
   * The caller's own id for what this event is about — a message id, a tool-call
   * id — copied into the audit event as is, so an investigator can go from the
   * log to the record in the app's own system. Must not itself be personal data.
   * D10.9.
   */
  readonly ref?: string
  readonly policy: { readonly hash: string; readonly entitySet: string }
  readonly tokenId: string | null
  readonly entity: EntityType | null
  readonly purpose: string
  readonly caller: string | null
  readonly outcome: 'allowed' | 'denied'
  readonly reason?: ResolveReason
  readonly prevHash: string | null
}

/**
 * Once per guard, when it is created: the rules every later event's
 * `policy.hash` stands for. Without it, a hash in the log points at a policy
 * nobody may have kept. D10.7.
 *
 * `allowlist.exact` is written as SHA-256 digests, not the values: the shop's
 * own contact details are often a staff member's, and logs travel further than
 * policy files. A digest still proves which value was listed, given the value.
 * It does not hide a phone number from someone willing to try all of them.
 */
export interface PolicyLoadedEvent {
  readonly schemaVersion: '1.0'
  readonly eventId: string
  readonly type: 'policy.loaded'
  readonly at: string
  readonly policy: {
    readonly hash: string
    readonly entitySet: string
    readonly onUnmapped: 'redact' | 'flag' | 'ignore'
    readonly placeholderLanguage: 'th' | 'en'
    readonly entities: Readonly<Partial<Record<EntityType, EntityRule>>>
    readonly allowlist: {
      /** `sha256:<hex>` of each value exactly as written in the policy. */
      readonly exact: readonly string[]
      readonly pattern: readonly string[]
    }
  }
  readonly engine: {
    readonly version: string
    readonly detectors: readonly string[]
    readonly entitiesSupported: readonly EntityType[]
    readonly nerAvailable: false
  }
  readonly prevHash: string | null
}

/** Everything that leaves core through `onAudit`. Switch on `type`. */
export type AuditRecord = AuditEvent | TokenResolveEvent | PolicyLoadedEvent

export type AuditSink = (event: AuditRecord) => void

export interface TokenRecord {
  readonly value: string
  readonly entity: EntityType
  readonly sessionId: string
  readonly purposes: readonly string[]
  readonly expiresAt: number
  /**
   * What an outbound reply shows in place of this token: the value as the
   * customer typed it, masked to the last four. Absent when the rule says
   * `display: 'redact'`. Never the full value. D10.1.
   */
  readonly display?: string
}

export interface TokenStore {
  /** true means processSync may use it. The bundled memory store is sync. */
  readonly sync: boolean
  set(id: string, rec: TokenRecord): void | Promise<void>
  get(id: string): TokenRecord | undefined | Promise<TokenRecord | undefined>
  delete(id: string): void | Promise<void>
  clearSession(sessionId: string): void | Promise<void>
}

/** Where a failure that core caught, rather than threw, came from. */
export interface GuardErrorContext {
  readonly source: 'audit_sink'
  readonly eventType: AuditRecord['type']
}

export interface GuardStats {
  /** onAudit calls that threw. Each one is an audit event that never arrived. D3. */
  readonly auditSinkErrors: number
}

export interface GuardOptions {
  readonly policy: CompiledPolicy
  /**
   * Receives every audit event. Sync: buffer inside it if the destination is
   * async. If it throws, the message is still processed — losing the guard over
   * a logging failure would be worse — but the failure is counted in
   * `guard.stats` and passed to `onError`, never swallowed. D3.
   *
   * Leave it out and the guard warns once that audit is being discarded. Pass
   * `() => {}` to discard on purpose without the warning.
   */
  readonly onAudit?: AuditSink
  /**
   * Told about failures core caught instead of throwing — today, a throwing
   * onAudit. Informational: the message has already been handled. An error
   * thrown from here is ignored, so it cannot turn into a loop.
   */
  readonly onError?: (error: unknown, context: GuardErrorContext) => void
  /**
   * Required only where globalThis.crypto is absent — notably stock Node 18.
   *
   * MUST be cryptographically secure. Passing anything derived from
   * Math.random() makes every token guessable and silently defeats the
   * purpose of the `tokenise` action. core can check the returned length,
   * never the entropy.
   */
  readonly randomSource?: RandomSource
  /**
   * Secret for the `hash` action. Required — and checked at construction —
   * only when the policy uses `hash`. At least 32 bytes; a string counts as its
   * UTF-8 bytes. Generate one with `openssl rand -hex 32`.
   *
   * MUST be random and MUST stay secret. A Thai mobile number has about 10^8
   * possible values, so anyone holding this key can hash every one of them in
   * minutes and reverse every hash this guard has ever produced. A hashed value
   * is pseudonymised, not anonymised, for as long as the key exists. core can
   * check the length, never the randomness.
   */
  readonly hmacKey?: string | Uint8Array
  readonly tokenStore?: TokenStore
  /**
   * Replaces the built-in set entirely rather than adding to it.
   *
   * Passing [] is a guard that detects nothing, which the audit event states
   * plainly in entitiesSupported: a report of "nothing found" must never be
   * readable as "nothing was there".
   */
  readonly detectors?: readonly Detector[]
}

export interface ProcessResult {
  /** Empty when `outcome` is `blocked`. D8.2. */
  readonly text: string
  readonly findings: readonly AuditFinding[]
  readonly outcome: 'processed' | 'blocked'
  /**
   * Entity types that stopped the message, in reading order, each once. Absent
   * unless blocked. Types only — safe to branch on when choosing a reply.
   */
  readonly blockedBy?: readonly EntityType[]
  readonly skippedDetectors: readonly string[]
}

export interface ResolveOptions {
  /** Why the real value is needed. Must be one of the rule's `allowedPurposes`. */
  readonly purpose: string
  /** Who is asking, for the audit trail. Not checked — it is a label, not a credential. */
  readonly caller?: string
  /** The session the token was issued in. Defaults to 'anonymous', as processSync does. */
  readonly sessionId?: string
  /** Copied into the token.resolve event, e.g. the tool-call id. D10.9. */
  readonly ref?: string
}

export type ResolveResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: ResolveReason }

export interface ProcessOptions {
  /** The conversation. Defaults to 'anonymous'. */
  readonly sessionId?: string
  readonly boundary?: Boundary
  /** Copied into the scan event, e.g. the app's message id. D10.9. */
  readonly ref?: string
  /**
   * The other side's last message — for a customer's message, what the shop or
   * the model last said. Detectors that rely on cue words read it, so a reply
   * that is only "123-4-56789-0" after "your account number?" is still found.
   * Never scanned for values, never rewritten, never written to the audit log.
   * The guarded copy is enough: cue words are not personal data. D10.11.
   */
  readonly context?: string
}

export interface Guard {
  processSync(text: string, opts?: ProcessOptions): ProcessResult
  /**
   * processSync, awaited. Runs async detectors too, and works with an async
   * token store (Redis, KV). Use this one in an async handler. D10.2.
   */
  process(text: string, opts?: ProcessOptions): Promise<ProcessResult>
  /**
   * Exchanges a token for its real value, if the purpose is allowed. D6.
   *
   * Access control is holding this guard object — the model only ever sees the
   * token. `purpose` is purpose limitation (PDPA) enforced against the policy
   * and recorded, not a secret: code that holds the guard can name any purpose.
   */
  resolve(token: string, opts: ResolveOptions): Promise<ResolveResult>
  /** As resolve, for a sync token store. Throws ERR_PDPA_ASYNC_STORE otherwise. */
  resolveSync(token: string, opts: ResolveOptions): ResolveResult
  /** Deletes every token issued in the session. Call it when the conversation ends. */
  endSession(sessionId: string): void | Promise<void>
  /** Read it from a health check: a rising auditSinkErrors means audit is being lost. */
  readonly stats: GuardStats
}
