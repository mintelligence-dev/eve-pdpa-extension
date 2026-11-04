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

export type PdpaConfigErrorCode =
  /** Production, and no PDPA_HMAC_KEY (or one too short). */
  | 'ERR_PDPA_EVE_HMAC_KEY'
  /** Production, and no PDPA_SESSION_KEY (or one too short). */
  | 'ERR_PDPA_EVE_SESSION_KEY'
  /** Production, and no token store every instance of the agent shares. */
  | 'ERR_PDPA_EVE_STORE'
  /** A channel whose adapter posts through events this package does not know: another eve. */
  | 'ERR_PDPA_EVE_ADAPTER'
  /** pdpa.tool() with a purpose no entity of the policy allows. */
  | 'ERR_PDPA_EVE_PURPOSE'

/**
 * Thrown while the agent starts, by createPdpa() and the wrappers, for a setup
 * that would leak or fail later. The message names the environment variable
 * or option to fix, never its value.
 */
export class PdpaConfigError extends Error {
  readonly code: PdpaConfigErrorCode

  constructor(code: PdpaConfigErrorCode, message: string) {
    super(message)
    this.name = 'PdpaConfigError'
    this.code = code
  }
}
