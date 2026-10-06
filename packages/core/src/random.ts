import { PdpaError } from './errors.js'
import type { RandomSource } from './types.js'

/**
 * Sixteen letters, one per 4-bit nibble — the same 64 bits as hex, spelled
 * without a single digit.
 *
 * Every detector in core matches digits (ids, cards, phones, accounts) or a
 * fixed shape (`@`, `U` + hex). An id spelled in these letters can sit inside
 * text that goes through the guard a second time — inbound, then again at the
 * prompt boundary — and no detector will ever see a number in it. Hex could
 * not promise that: one id in a few thousand contains a phone-shaped run.
 *
 * Making the id undetectable beats teaching the guard to skip its own output.
 * Skipping by shape would also skip a real number a customer typed inside
 * brackets that merely look like ours. D8.3 / item 6.
 *
 * No vowels, so an id never spells a word; no l, o or i, so nothing reads as
 * 1 or 0 when a person copies one by hand.
 */
const ALPHABET = 'bcdfghjkmnpqrstv'

/**
 * Resolution order, per D7:
 *   1. globalThis.crypto.getRandomValues  (Node 20+, Deno, Bun, workerd, browsers)
 *   2. options.randomSource               (stock Node 18 supplies node:crypto itself)
 *   3. throw ERR_PDPA_NO_CSPRNG
 *
 * There is deliberately no Math.random() fallback: a guessable token id lets
 * anyone resolve someone else's real value, and D4 says a failed action must
 * stop, never pass through.
 */
export function resolveRandomSource(provided?: RandomSource): RandomSource {
  if (provided !== undefined) {
    const probe = provided(8)
    if (!(probe instanceof Uint8Array) || probe.length !== 8) {
      throw new PdpaError(
        'ERR_PDPA_NO_CSPRNG',
        'randomSource must return a Uint8Array of exactly the requested length',
      )
    }
    return provided
  }

  const host = globalThis.crypto
  if (host !== undefined && typeof host.getRandomValues === 'function') {
    return (n: number): Uint8Array => host.getRandomValues(new Uint8Array(n))
  }

  throw new PdpaError(
    'ERR_PDPA_NO_CSPRNG',
    'no cryptographically secure random source: globalThis.crypto is unavailable ' +
      '(stock Node 18 keeps it behind --experimental-global-webcrypto). ' +
      'Pass randomSource to createGuard, or run on Node 20+.',
  )
}

const ID_BYTES = 8

/**
 * 64 bits of unguessable id, 16 characters, no digits.
 *
 * Checks the source on EVERY call, not just the probe in resolveRandomSource.
 * A host source that passes once and later returns short arrays would otherwise
 * produce ids like `bbbb` — guessable, and identical for every value, so each new
 * token would overwrite the last one's real value in the store. Throwing here
 * reaches the guard as an action that could not be applied, and D4 level 2
 * blocks the message.
 */
export function tokenId(random: RandomSource): string {
  const bytes = random(ID_BYTES)
  if (!(bytes instanceof Uint8Array) || bytes.length !== ID_BYTES) {
    throw new PdpaError(
      'ERR_PDPA_NO_CSPRNG',
      'randomSource must return a Uint8Array of exactly the requested length',
    )
  }
  return encodeLetters(bytes)
}

/**
 * Renders bytes in ALPHABET, two characters per byte. Shared with the hash
 * action so both kinds of placeholder share the same guarantee.
 */
export function encodeLetters(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0
    out += ALPHABET[(b >> 4) & 0xf]
    out += ALPHABET[b & 0xf]
  }
  return out
}
