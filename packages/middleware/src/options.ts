import type { EntityType, Guard } from '@eve-pdpa-extension/core'
import type { FieldPath, Preset } from './fields.js'

/** What every adapter takes. `In` is what the framework hands a handler. */
export interface AdapterOptions<In> {
  /** A guard from createGuard. Its policy decides what is hidden and how. */
  readonly guard: Guard
  /** Where the text is in the request body: a preset or paths. Default `chat`. */
  readonly fields?: Preset | readonly FieldPath[]
  /**
   * Where the text is in a JSON reply, to check it on the way out. Leave it out
   * and replies are not checked. A reply streamed as it is written is never
   * checked here.
   */
  readonly responseFields?: Preset | readonly FieldPath[]
  /**
   * The conversation, read from the request. Required when the policy
   * tokenises: tokens are kept apart by it. Must not itself be personal data —
   * a chat id, not a phone number.
   */
  readonly sessionId?: (input: In) => string | undefined
  /** Your id for this request, copied into each audit event so it can be traced back. */
  readonly ref?: (input: In) => string | undefined
}

/** The body answered when the policy blocks a message: types only, never a value. */
export function blockedBody(blockedBy: readonly EntityType[]): {
  error: 'pdpa_blocked'
  blockedBy: readonly EntityType[]
} {
  return { error: 'pdpa_blocked', blockedBy }
}

/** Answered with this status unless `onBlocked` says otherwise. */
export const BLOCKED_STATUS = 422
