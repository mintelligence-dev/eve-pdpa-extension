import type { Boundary, EntityType, Guard } from '@eve-pdpa-extension/core'
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
   * a chat id, not a phone number. `body` is the request body read as JSON,
   * before anything in it is protected, so a chat id sent in the body can be
   * read on every framework; it is `undefined` when the body is not JSON.
   * When a reply is checked it is called again, with the same request body.
   */
  readonly sessionId?: (input: In, body: any) => string | undefined
  /**
   * Your id for this request, copied into each audit event so it can be traced
   * back. Given `body` as `sessionId` is.
   */
  readonly ref?: (input: In, body: any) => string | undefined
  /**
   * The other side's last message — for a customer's message, what your bot or
   * staff last asked ("ขอเลขบัญชีค่ะ") — so a bare reply such as
   * "123-4-56789-0" is still found. `body` is the request body already read as
   * JSON (a LINE webhook's events, say), so the request need not be read again.
   * May be async, to look it up in your own store. Read for cue words only:
   * never changed, never written to audit. Used for the request; a reply is
   * checked without it.
   */
  readonly context?: (input: In, body: any) => string | undefined | Promise<string | undefined>
  /**
   * Called when `fields` (or, for a reply, `responseFields`) reach no string at
   * all in a body that was read as JSON — so a shop that forgot to set `fields`
   * for its body shape finds out, instead of believing it is protected. The
   * request goes on as it is: this does not block or change anything. A body
   * with no text in it (a button press) is normal, so use this to log, not to
   * block. Not called for a body that is not JSON, nor for one that was blocked.
   * If it throws, the request fails: a rejected promise for the web adapters,
   * `next(error)` for Express.
   */
  readonly onNoMatch?: (input: In, boundary: Boundary) => void
}

/**
 * The body answered when the policy blocks a message: which way it was going
 * and the types, never a value.
 */
export function blockedBody(
  blockedBy: readonly EntityType[],
  boundary: Boundary,
): { error: 'pdpa_blocked'; boundary: Boundary; blockedBy: readonly EntityType[] } {
  return { error: 'pdpa_blocked', boundary, blockedBy }
}

/**
 * The status answered unless `onBlocked` says otherwise. A request the customer
 * sent is theirs to change: 422. A reply the handler wrote is not: 502, the
 * upstream answer could not be passed on.
 */
export function blockedStatus(boundary: Boundary): number {
  return boundary === 'outbound' ? 502 : 422
}

/** Whether a content type names JSON: application/json, …+json, with or without parameters. */
export function namesJson(contentType: string | null | undefined): boolean {
  return /\bjson\b/i.test(contentType ?? '')
}

/**
 * Whether a body with this content type may still be JSON. the Fetch API sends a
 * string body as text/plain unless told otherwise, and a handler that calls
 * request.json() reads it all the same: such a body is tried as JSON.
 */
export function mayBeJson(contentType: string | null | undefined): boolean {
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  return type === '' || type === 'text/plain' || namesJson(type)
}
