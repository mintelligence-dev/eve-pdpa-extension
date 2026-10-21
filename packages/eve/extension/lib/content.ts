/**
 * core's guard applied to what eve accepts as a user message: a string, or an
 * AI SDK `UserContent` array of text, image and file parts.
 *
 * Every wrapper in this package goes through `createContentGuard`, so there is
 * one place that decides what a message becomes.
 */
import {
  type AuditEvent,
  type AuditRecord,
  type CompiledPolicy,
  type GuardOptions as CoreGuardOptions,
  createGuard,
  type Detector,
  type EntityType,
  type Guard,
} from '@eve-pdpa-extension/core'
import type { UserContent } from 'ai'
import { DEFAULT_POLICY, refuseTokenise } from './policy.js'
import { blockedReason, filesReason, type Language } from './reason.js'

/** Which wrapper ran the scan. `direct` is a call to `guardContent` itself. */
export type GuardSource = 'channel' | 'chat-sdk' | 'hook' | 'direct'

export interface GuardAuditContext {
  readonly source: GuardSource
  /**
   * The platform's address for the conversation, as eve's channel saw it: a
   * Slack `channel:thread`, a LINE thread id, a phone number on Twilio. Often
   * personal data itself — hash it before it goes anywhere audit goes.
   */
  readonly address?: string
}

export interface GuardOptions {
  /** From core's `definePolicy` or `parsePolicy`. Defaults to `DEFAULT_POLICY`. */
  readonly policy?: CompiledPolicy
  /** For a policy that uses `hash`. At least 32 bytes, as core's `createGuard`. */
  readonly hmacKey?: string | Uint8Array
  /** Replaces core's built-in detectors, as core's `createGuard`. */
  readonly detectors?: readonly Detector[]
  /** Told about failures core caught instead of throwing, such as an `onAudit` that threw. */
  readonly onError?: CoreGuardOptions['onError']
  /**
   * Image and file parts are passed on untouched (`pass`, the default) — their
   * contents are not scanned — or stop the whole message (`block`).
   */
  readonly files?: 'pass' | 'block'
  /**
   * Every audit event from core: one `policy.loaded` when the guard is built,
   * then one `scan` per string scanned. Events carry positions and types, never
   * a value. Leave it out and audit is discarded, with one warning per process.
   */
  readonly onAudit?: (event: AuditRecord, ctx: GuardAuditContext) => void
}

export type GuardResult<T> =
  | { readonly blocked: false; readonly content: T; readonly events: readonly AuditEvent[] }
  | {
      readonly blocked: true
      /** Kinds of data only. Safe to show the person who sent the message. */
      readonly reason: string
      readonly events: readonly AuditEvent[]
    }

/** What one send carries that eve may record or show the model. */
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
      readonly events: readonly AuditEvent[]
    }
  | { readonly blocked: true; readonly reason: string; readonly events: readonly AuditEvent[] }

export interface ContentGuard {
  readonly files: 'pass' | 'block'
  readonly language: Language
  deliver(input: Delivery, address?: string): DeliveryResult
}

// Once per process, as core does: a warning repeated per guard gets filtered out.
let warnedNoAudit = false

/**
 * Builds core's guard once, up front: a bad policy or a missing key fails when
 * the wrapper is created, not on the first customer's message.
 */
export function createContentGuard(options: GuardOptions, source: GuardSource): ContentGuard {
  const files = options.files ?? 'pass'
  if (files !== 'pass' && files !== 'block') {
    throw new TypeError('files: expected "pass" or "block"')
  }
  const policy = options.policy ?? DEFAULT_POLICY
  refuseTokenise(policy)

  const onAudit = options.onAudit
  if (onAudit === undefined && !warnedNoAudit) {
    warnedNoAudit = true
    console.warn(
      '[@eve-pdpa-extension/eve] no onAudit was given: audit events are being discarded. ' +
        'Pass onAudit to keep them, or onAudit: () => {} to discard them on purpose.',
    )
  }

  // Set for the length of one synchronous deliver(), read by the sink below.
  let collecting: AuditEvent[] | null = null
  let auditContext: GuardAuditContext = { source }

  const guard: Guard = createGuard({
    policy,
    onAudit(event) {
      if (event.type === 'scan') collecting?.push(event)
      // A Promise the caller's sink returns goes back to core, which counts a
      // rejection the same as a throw.
      return onAudit?.(event, auditContext)
    },
    ...(options.hmacKey === undefined ? {} : { hmacKey: options.hmacKey }),
    ...(options.detectors === undefined ? {} : { detectors: options.detectors }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  })

  const language: Language = policy.placeholderLanguage === 'en' ? 'en' : 'th'

  function deliver(input: Delivery, address?: string): DeliveryResult {
    const events: AuditEvent[] = []
    const outer = { collecting, auditContext }
    collecting = events
    auditContext = address === undefined ? { source } : { source, address }
    try {
      return run(input, events)
    } finally {
      collecting = outer.collecting
      auditContext = outer.auditContext
    }
  }

  function run(input: Delivery, events: AuditEvent[]): DeliveryResult {
    const message = input.message
    if (typeof message !== 'string' && !Array.isArray(message)) {
      // Fail closed: a shape this guard cannot read is not passed on unread.
      throw new TypeError('message: expected a string or an array of message parts')
    }
    if (files === 'block' && Array.isArray(message) && message.some((p) => p?.type !== 'text')) {
      return { blocked: true, reason: filesReason(language), events }
    }

    // An object, not a let: the closure below writes it, and TypeScript does not
    // see writes made inside a function when it narrows a variable.
    const stop: { by: readonly EntityType[] | null } = { by: null }
    const protect = (text: string): string => {
      const out = guard.processSync(text, { boundary: 'inbound' })
      if (out.outcome === 'blocked') stop.by = out.blockedBy ?? []
      return out.text
    }
    const blocked = (by: readonly EntityType[]): DeliveryResult => ({
      blocked: true,
      reason: blockedReason(by, language),
      events,
    })

    let guarded: UserContent
    if (typeof message === 'string') {
      guarded = protect(message)
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
        const text = protect(part.text)
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
    if (stop.by !== null) return blocked(stop.by)

    let context: readonly string[] | undefined
    if (input.context !== undefined) {
      if (!Array.isArray(input.context))
        throw new TypeError('context: expected an array of strings')
      const out: string[] = []
      for (const [i, entry] of input.context.entries()) {
        if (typeof entry !== 'string') throw new TypeError(`context[${i}]: expected a string`)
        out.push(protect(entry))
        if (stop.by !== null) return blocked(stop.by)
      }
      context = out
    }

    let title: string | undefined
    if (input.title !== undefined) {
      if (typeof input.title !== 'string') throw new TypeError('title: expected a string')
      title = protect(input.title)
      if (stop.by !== null) return blocked(stop.by)
    }

    return {
      blocked: false,
      message: guarded,
      ...(context === undefined ? {} : { context }),
      ...(title === undefined ? {} : { title }),
      events,
    }
  }

  return { files, language, deliver }
}

const guards = new WeakMap<GuardOptions, ContentGuard>()
let defaultGuard: ContentGuard | undefined

function guardFor(options: GuardOptions | undefined): ContentGuard {
  if (options === undefined) {
    defaultGuard ??= createContentGuard({}, 'direct')
    return defaultGuard
  }
  let guard = guards.get(options)
  if (guard === undefined) {
    guard = createContentGuard(options, 'direct')
    guards.set(options, guard)
  }
  return guard
}

/**
 * Masks a message with core before anything else sees it. Synchronous, and
 * never changes `content`: a string comes back as a new string, an array as a
 * new array whose text parts are rewritten and whose other parts are the same
 * objects — or as `content` itself when there was nothing to hide.
 *
 * Any text part the policy blocks stops the whole message.
 *
 * The guard behind it is built once per `options` object and kept, so pass the
 * same object each time rather than a fresh literal per call.
 */
export function guardContent<T extends string | UserContent>(
  content: T,
  options?: GuardOptions,
): GuardResult<T> {
  const out = guardFor(options).deliver({ message: content })
  return out.blocked
    ? { blocked: true, reason: out.reason, events: out.events }
    : { blocked: false, content: out.message as T, events: out.events }
}
