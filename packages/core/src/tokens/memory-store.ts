import { PdpaError } from '../errors.js'
import type { TokenRecord, TokenStore } from '../types.js'

export interface MemoryTokenStoreOptions {
  /** Live tokens held at once. D6 default: 10,000. */
  readonly maxTokens?: number
}

const DEFAULT_MAX_TOKENS = 10_000

/**
 * The store a guard uses when none is given. One process, nothing on disk. D6.
 *
 * When full it refuses new tokens rather than evicting old ones: a token that
 * has not expired belongs to a flow that is still running — an OTP someone is
 * waiting for — and dropping it breaks that flow silently. The refusal reaches
 * the guard as an action that could not be applied, and D4 level 2 blocks the
 * message. Expired tokens are swept on every write, so there is no timer
 * holding the process open.
 *
 * Real values are held as strings, and JavaScript cannot wipe a string from
 * memory: after delete it lingers until the garbage collector runs. Keep TTLs as
 * short as the flow allows, and use an external store if that is not enough.
 *
 * Single process only. Behind more than one process or pod, a token issued by
 * one will be not_found in the other — pass a `tokenStore` that is shared.
 */
export function createMemoryTokenStore(options: MemoryTokenStoreOptions = {}): TokenStore {
  const max = options.maxTokens ?? DEFAULT_MAX_TOKENS
  const records = new Map<string, TokenRecord>()

  function sweep(now: number): void {
    for (const [id, rec] of records) {
      if (rec.expiresAt <= now) records.delete(id)
    }
  }

  return {
    sync: true,

    set(id, rec) {
      sweep(Date.now())
      if (records.size >= max) {
        throw new PdpaError('ERR_PDPA_TOKEN_STORE_FULL', `token store is full (${max} live tokens)`)
      }
      records.set(id, rec)
    },

    get(id) {
      return records.get(id)
    },

    delete(id) {
      records.delete(id)
    },

    clearSession(sessionId) {
      for (const [id, rec] of records) {
        if (rec.sessionId === sessionId) records.delete(id)
      }
    },
  }
}
