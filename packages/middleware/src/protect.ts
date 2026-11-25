import type { Boundary, EntityType, Guard } from '@eve-pdpa-extension/core'
import { eachString, type FieldPath, type Preset, pathsOf } from './fields.js'

export interface ProtectOptions {
  /** A guard from createGuard. Its policy decides what is hidden and how. */
  readonly guard: Guard
  /** Where the text is: a preset or paths. Default `chat`, every common chat shape. */
  readonly fields?: Preset | readonly FieldPath[]
  /** The conversation. Required when the policy tokenises. */
  readonly sessionId?: string
  /** Your id for this request, copied into each audit event so it can be traced back. */
  readonly ref?: string
  /** `inbound` (default) for what a customer sent; `outbound` for a reply. */
  readonly boundary?: Boundary
  /**
   * The other side's last message: for a customer's message, what the shop or
   * the bot last asked ("ขอเลขบัญชีค่ะ"). Detectors read its cue words, so a
   * reply that is only "123-4-56789-0" is still found. Given to every string
   * the fields reach; never checked, changed or written to the audit log.
   */
  readonly context?: string
}

export type ProtectResult =
  | {
      readonly ok: true
      readonly body: unknown
      /** False when no text was rewritten: `body` is then the one passed in, untouched. */
      readonly changed: boolean
      /**
       * How many strings the fields reached. 0 means nothing was checked — the
       * fields may not fit the body's shape; the body is then returned untouched.
       */
      readonly matched: number
    }
  | { readonly ok: false; readonly blockedBy: readonly EntityType[] }

/**
 * Runs every string the fields reach through the guard and returns a copy of
 * the body with each one protected. The body passed in is not changed, and is
 * returned as it is when nothing in it needed protecting.
 *
 * When the policy blocks any of them, nothing is returned but the types that
 * stopped it: a body with one message blocked is not sent on with the rest.
 *
 * `matched` is how many strings the fields reached; 0 tells the caller the
 * fields found nothing to check in this body.
 *
 * Framework-free: every adapter in this package calls it, and any framework
 * that hands you the parsed JSON can call it directly.
 */
export async function protectBody(body: unknown, options: ProtectOptions): Promise<ProtectResult> {
  const copy: unknown = structuredClone(body)
  const found: { value: string; set: (next: string) => void }[] = []
  eachString(copy, pathsOf(options.fields), (value, set) => {
    found.push({ value, set })
  })

  // Whether anything was blocked is decided by the outcome, never by the list
  // of types: a guard that blocks and names nothing must still stop the body.
  let blocked = false
  let changed = false
  const blockedBy: EntityType[] = []
  // One at a time, in order: a tokenising policy gives one value one token per
  // session, and the order is what makes the audit trail read like the chat.
  for (const { value, set } of found) {
    const r = await options.guard.process(value, {
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...(options.ref === undefined ? {} : { ref: options.ref }),
      ...(options.context === undefined ? {} : { context: options.context }),
      boundary: options.boundary ?? 'inbound',
    })
    if (r.outcome === 'blocked') {
      blocked = true
      for (const e of r.blockedBy ?? []) if (!blockedBy.includes(e)) blockedBy.push(e)
    } else if (r.text !== value) {
      set(r.text)
      changed = true
    }
  }

  if (blocked) return { ok: false, blockedBy }
  const matched = found.length
  return changed ? { ok: true, body: copy, changed, matched } : { ok: true, body, changed, matched }
}
