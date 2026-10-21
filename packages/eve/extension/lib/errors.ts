/**
 * Thrown in place of a delivery the policy stopped. Nothing was sent to eve.
 *
 * `reason` and `message` are the same text: which kinds of data stopped the
 * message, never the data itself, so it is safe to log and to show the person
 * who sent it.
 */
export class PdpaBlockedError extends Error {
  readonly code: 'PDPA_BLOCKED' = 'PDPA_BLOCKED'
  readonly reason: string

  constructor(reason: string, options?: { readonly cause?: unknown }) {
    super(reason, options)
    this.name = 'PdpaBlockedError'
    this.reason = reason
  }
}
