import { createHmac, type Hmac } from '../crypto/hmac.js'
import { PdpaError } from '../errors.js'
import { encodeLetters } from '../random.js'
import type { EntityType } from '../types.js'

/**
 * RFC 2104 §3: a key shorter than the digest length is "strongly discouraged".
 * SHA-256 produces 32 bytes.
 */
const MIN_KEY_BYTES = 32

/** 64 bits — the same as a token id. Enough to join records, short enough for a prompt. */
const OUTPUT_BYTES = 8

const encoder = new TextEncoder()

/**
 * Turns the caller's key into a ready HMAC, or refuses at construction.
 *
 * Failing in createGuard rather than on the first message is the same rule the
 * random source follows (D7): a guard that cannot apply its policy must not
 * exist. Messages name the problem and never echo the key.
 */
export function resolveHmac(key: string | Uint8Array | undefined): Hmac {
  if (key === undefined) {
    throw new PdpaError(
      'ERR_PDPA_HMAC_KEY',
      'the policy uses "hash" but no hmacKey was given to createGuard',
    )
  }

  let bytes: Uint8Array
  if (typeof key === 'string') {
    bytes = encoder.encode(key)
  } else if (key instanceof Uint8Array) {
    bytes = key
  } else {
    throw new PdpaError('ERR_PDPA_HMAC_KEY', 'hmacKey must be a string or a Uint8Array')
  }

  if (bytes.length < MIN_KEY_BYTES) {
    throw new PdpaError(
      'ERR_PDPA_HMAC_KEY',
      `hmacKey must be at least ${MIN_KEY_BYTES} bytes, got ${bytes.length}. ` +
        'Generate one with: openssl rand -hex 32',
    )
  }

  return createHmac(bytes)
}

/**
 * `[PHONE:fkqnbtcgmvhrkpdb]` — D8.3.
 *
 * `canonical` is the value with its formatting removed (`actions/canonical.ts`),
 * so 091-888-7777 and ๐๙๑๘๘๘๗๗๗๗ hash to the same thing. The entity name goes
 * into the MAC ahead of it, separated by a NUL no canonical value can contain,
 * so the same digits as a phone number and as an account give different hashes.
 *
 * The output is spelled in the same digit-free letters as a token id, so a
 * hashed message can pass through the guard again without a detector finding a
 * number inside its own placeholder — item 6.
 *
 * The entity name is always English: the value exists to be joined by a
 * machine, and must not change with placeholderLanguage.
 */
export function hashValue(hmac: Hmac, entity: EntityType, canonical: string): string {
  const mac = hmac(encoder.encode(`${entity}\u0000${canonical}`))
  return `[${entity}:${encodeLetters(mac.subarray(0, OUTPUT_BYTES))}]`
}
