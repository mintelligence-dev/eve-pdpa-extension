export type PdpaErrorCode =
  | 'ERR_PDPA_NO_CSPRNG'
  | 'ERR_PDPA_INVALID_POLICY'
  | 'ERR_PDPA_ASYNC_STORE'
  | 'ERR_PDPA_HMAC_KEY'
  | 'ERR_PDPA_TOKEN_STORE_FULL'
  | 'ERR_PDPA_NO_SESSION'

export class PdpaError extends Error {
  readonly code: PdpaErrorCode

  constructor(code: PdpaErrorCode, message: string) {
    super(message)
    this.name = 'PdpaError'
    this.code = code
  }
}
