import { SHA256_BLOCK_BYTES, SHA256_DIGEST_BYTES, sha256 } from './sha256.js'

export type Hmac = (message: Uint8Array) => Uint8Array

/**
 * HMAC-SHA256, RFC 2104: H((K ⊕ opad) ‖ H((K ⊕ ipad) ‖ m)).
 *
 * The padded keys are prepared once and kept in the closure; the caller's key
 * array is not retained, so zeroing it afterwards does not change this
 * function — and nothing this function returns can carry the key out.
 *
 * Proved against all seven RFC 4231 test cases and against node:crypto. See
 * `test/hmac.test.ts`.
 */
export function createHmac(key: Uint8Array): Hmac {
  // Keys longer than one block are hashed first; shorter ones are zero-padded.
  const k = key.length > SHA256_BLOCK_BYTES ? sha256(key) : key

  const ipad = new Uint8Array(SHA256_BLOCK_BYTES)
  const opad = new Uint8Array(SHA256_BLOCK_BYTES)
  for (let i = 0; i < SHA256_BLOCK_BYTES; i++) {
    const b = k[i] ?? 0
    ipad[i] = b ^ 0x36
    opad[i] = b ^ 0x5c
  }

  return (message) => {
    const inner = new Uint8Array(SHA256_BLOCK_BYTES + message.length)
    inner.set(ipad)
    inner.set(message, SHA256_BLOCK_BYTES)

    const outer = new Uint8Array(SHA256_BLOCK_BYTES + SHA256_DIGEST_BYTES)
    outer.set(opad)
    outer.set(sha256(inner), SHA256_BLOCK_BYTES)

    return sha256(outer)
  }
}
