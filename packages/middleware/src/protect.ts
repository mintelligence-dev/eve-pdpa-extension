import type { Boundary, EntityType, Guard } from '@eve-pdpa-extension/core'
import { eachString, type FieldPath, type Preset, pathsOf } from './fields.js'

export interface ProtectOptions {
  /** A guard from createGuard. Its policy decides what is hidden and how. */
  readonly guard: Guard
  /** Where the text is: a preset or paths. Default `chat`, every common shape. */
  readonly fields?: Preset | readonly FieldPath[]
  /** The conversation. Required when the policy tokenises. */
  readonly sessionId?: string
  /** Your id for this request, copied into each audit event so it can be traced back. */
  readonly ref?: string
  /** `inbound` (default) for what a customer sent; `outbound` for a reply. */
  readonly boundary?: Boundary
}

export type ProtectResult =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly blockedBy: readonly EntityType[] }

/**
 * Runs every string the fields reach through the guard and returns a copy of
 * the body with each one protected. The body passed in is not changed.
 *
 * When the policy blocks any of them, nothing is returned but the types that
 * stopped it: a body with one message blocked is not sent on with the rest.
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

  const blockedBy: EntityType[] = []
  // One at a time, in order: a tokenising policy gives one value one token per
  // session, and the order is what makes the audit trail read like the chat.
  for (const { value, set } of found) {
    const r = await options.guard.process(value, {
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...(options.ref === undefined ? {} : { ref: options.ref }),
      boundary: options.boundary ?? 'inbound',
    })
    if (r.outcome === 'blocked') {
      for (const e of r.blockedBy ?? []) if (!blockedBy.includes(e)) blockedBy.push(e)
    } else {
      set(r.text)
    }
  }

  return blockedBy.length > 0 ? { ok: false, blockedBy } : { ok: true, body: copy }
}
