/**
 * Core's guard applied to what eve accepts as a user message: a string, or an
 * AI SDK `UserContent` array of text, image and file parts.
 *
 * The caller owns the guard — policy, hmacKey, token store and audit sink all
 * live in core's `createGuard` — and this package only decides which strings
 * to hand it, under which session id and boundary.
 */
import type { AuditFinding, Boundary, EntityType, Guard } from '@eve-pdpa-extension/core'
import type { UserContent } from 'ai'
import { blockedReason, filesReason, type Language, storeReason } from './reason.js'

export interface EveGuardOptions {
  /** From core's `createGuard`. It holds the policy, `hmacKey`, token store and `onAudit`. */
  readonly guard: Guard
  /**
   * Secret, at least 32 bytes, that turns a conversation into the session id
   * core writes to audit and keeps tokens apart by. Same value everywhere in
   * one deployment: the channel wrapper, the tool wrapper, the model
   * middleware, the Slack renderer and the hook.
   */
  readonly sessionKey: string
  /**
   * Image and file parts are passed on untouched (`pass`, the default) — their
   * contents are not scanned — or stop the whole message (`block`).
   */
  readonly files?: 'pass' | 'block'
  /**
   * Called once for each message the policy stops. `reason` is safe to show
   * the person who sent it; `blockedBy` lists the entity types.
   */
  readonly onBlock?: (info: BlockInfo) => void | Promise<void>
  /** Language of the block reason. Default `th`. */
  readonly language?: Language
}

export interface BlockInfo {
  /** Kinds of data only. Safe to show the person who sent the message. */
  readonly reason: string
  /** Entity types that stopped it, in reading order. Empty for a file. */
  readonly blockedBy: readonly string[]
}

/** What one delivery carries that eve may record or show the model. */
export interface Delivery {
  readonly message: UserContent
  /** Appended to session history as user messages. */
  readonly context?: readonly string[] | undefined
  /** The session's display title. Slack sets it from the message text. */
  readonly title?: string | undefined
}

export type DeliveryResult =
  | {
      readonly blocked: false
      readonly message: UserContent
      readonly context?: readonly string[]
      readonly title?: string
      /** Some value became a token. A channel that cannot rewrite replies would show it. */
      readonly tokenised: boolean
    }
  | ({ readonly blocked: true } & BlockInfo)

export interface ScanOptions {
  readonly guard: Guard
  readonly sessionId: string
  readonly boundary: Boundary
  readonly files: 'pass' | 'block'
  readonly language: Language
}

/** True when core blocked because the token store failed, not because the policy said so. */
function storeFailed(findings: readonly AuditFinding[]): boolean {
  return findings.some((f) => f.failed === 'token_store')
}

/**
 * Every string of one delivery through `guard.process`, in order. Async: a
 * token store such as Redis needs `process`, never `processSync`.
 *
 * Any one string the policy blocks stops the whole delivery. Core already
 * returns `text: ''` for a blocked string; nothing of it is kept here either.
 */
export async function scanDelivery(input: Delivery, options: ScanOptions): Promise<DeliveryResult> {
  const { guard, sessionId, boundary, files, language } = options
  const message = input.message
  if (typeof message !== 'string' && !Array.isArray(message)) {
    // Fail closed: a shape this guard cannot read is not passed on unread.
    throw new TypeError('message: expected a string or an array of message parts')
  }
  if (files === 'block' && Array.isArray(message) && message.some((p) => p?.type !== 'text')) {
    return { blocked: true, reason: filesReason(language), blockedBy: [] }
  }

  // An object, not a let: TypeScript does not see writes made inside a closure.
  const stop: { by: readonly EntityType[] | null; store: boolean; tokenised: boolean } = {
    by: null,
    store: false,
    tokenised: false,
  }
  const protect = async (text: string): Promise<string> => {
    const out = await guard.process(text, { sessionId, boundary })
    if (out.findings.some((f) => f.tokenId !== undefined && f.allowlisted !== true)) {
      stop.tokenised = true
    }
    if (out.outcome === 'blocked') {
      stop.by = out.blockedBy ?? []
      stop.store = storeFailed(out.findings)
    }
    return out.text
  }
  const blocked = (): DeliveryResult => {
    const by = stop.by ?? []
    return {
      blocked: true,
      reason: stop.store ? storeReason(language) : blockedReason(by, language),
      blockedBy: [...by],
    }
  }

  let guarded: UserContent
  if (typeof message === 'string') {
    guarded = await protect(message)
  } else {
    let changed = false
    const parts: Exclude<UserContent, string> = []
    for (const [i, part] of message.entries()) {
      if (part?.type !== 'text') {
        parts.push(part)
        continue
      }
      if (typeof part.text !== 'string') {
        throw new TypeError(`message[${i}].text: expected a string`)
      }
      const text = await protect(part.text)
      if (stop.by !== null) break
      if (text === part.text) {
        parts.push(part)
      } else {
        changed = true
        parts.push({ ...part, text })
      }
    }
    // Nothing to hide: hand back the caller's own array, not a copy.
    guarded = changed ? parts : message
  }
  if (stop.by !== null) return blocked()

  let context: readonly string[] | undefined
  if (input.context !== undefined) {
    if (!Array.isArray(input.context)) throw new TypeError('context: expected an array of strings')
    const out: string[] = []
    for (const [i, entry] of input.context.entries()) {
      if (typeof entry !== 'string') throw new TypeError(`context[${i}]: expected a string`)
      out.push(await protect(entry))
      if (stop.by !== null) return blocked()
    }
    context = out
  }

  let title: string | undefined
  if (input.title !== undefined) {
    if (typeof input.title !== 'string') throw new TypeError('title: expected a string')
    title = await protect(input.title)
    if (stop.by !== null) return blocked()
  }

  return {
    blocked: false,
    message: guarded,
    ...(context === undefined ? {} : { context }),
    ...(title === undefined ? {} : { title }),
    tokenised: stop.tokenised,
  }
}

/** Fails at wrap time, not on the first customer's message. */
export function checkGuard(guard: unknown): asserts guard is Guard {
  const g = guard as Partial<Guard> | null
  if (
    typeof g !== 'object' ||
    g === null ||
    typeof g.process !== 'function' ||
    typeof g.resolve !== 'function' ||
    typeof g.endSession !== 'function'
  ) {
    throw new TypeError("guard: expected a guard from @eve-pdpa-extension/core's createGuard()")
  }
}

export function checkFiles(files: unknown): 'pass' | 'block' {
  if (files === undefined) return 'pass'
  if (files !== 'pass' && files !== 'block')
    throw new TypeError('files: expected "pass" or "block"')
  return files
}

export type GuardResult<T> =
  | { readonly blocked: false; readonly content: T }
  | ({ readonly blocked: true } & BlockInfo)

export interface GuardContentOptions {
  readonly guard: Guard
  /** A pdpa session id — from `derivePdpaSessionId`, never a platform id. */
  readonly sessionId: string
  /** Where the text sits. Default `inbound`. */
  readonly boundary?: Boundary
  readonly files?: 'pass' | 'block'
  readonly language?: Language
}

/**
 * Masks one message with the caller's guard. Never changes `content`: a
 * string comes back as a new string, an array as a new array whose text parts
 * are rewritten and whose other parts are the same objects — or as `content`
 * itself when there was nothing to hide. Any text part the policy blocks
 * stops the whole message.
 */
export async function guardContent<T extends string | UserContent>(
  content: T,
  options: GuardContentOptions,
): Promise<GuardResult<T>> {
  checkGuard(options.guard)
  const out = await scanDelivery(
    { message: content },
    {
      guard: options.guard,
      sessionId: options.sessionId,
      boundary: options.boundary ?? 'inbound',
      files: checkFiles(options.files),
      language: options.language ?? 'th',
    },
  )
  return out.blocked
    ? { blocked: true, reason: out.reason, blockedBy: out.blockedBy }
    : { blocked: false, content: out.message as T }
}
