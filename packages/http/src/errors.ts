export type PdpaHttpErrorCode =
  /** createWebhook or createUpstashTokenStore was given options it cannot run with. */
  | 'ERR_PDPA_HTTP_CONFIG'
  /** The runtime has no crypto.subtle to sign with — Node before 20. */
  | 'ERR_PDPA_HTTP_NO_WEBCRYPTO'
  /** The token store could not be reached or answered with an error. */
  | 'ERR_PDPA_HTTP_STORE'

/** Never carries a value from a request or a token record: only what went wrong. */
export class PdpaHttpError extends Error {
  readonly code: PdpaHttpErrorCode

  constructor(code: PdpaHttpErrorCode, message: string) {
    super(message)
    this.name = 'PdpaHttpError'
    this.code = code
  }
}
