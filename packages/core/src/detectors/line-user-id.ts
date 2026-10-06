import type { Candidate, Detector, NormalisedText } from '../types.js'
import { isAsciiDigit, isAsciiLetter, isIsolated } from './boundary.js'

/**
 * `U` followed by 32 lowercase hex characters.
 *
 * The narrowest pattern in the set: 128 bits of hex behind a fixed prefix is
 * not a shape anything else in a Thai conversation takes, so no checksum or
 * context word is needed to trust it.
 *
 * Only the user id. LINE issues group ids on `C` and room ids on `R` in the
 * same shape, and those identify a conversation rather than a person — a
 * different entity, and not one 0.1 claims to cover. Adding them here would
 * quietly file a group id under LINE_USER_ID in the audit event.
 */
const LINE_USER_ID = /U[0-9a-f]{32}/g

function belongsToId(ch: string): boolean {
  return isAsciiLetter(ch) || isAsciiDigit(ch)
}

export const lineUserIdDetector: Detector = {
  id: 'line-user-id',
  entities: ['LINE_USER_ID'],

  detect(input: NormalisedText): Candidate[] {
    const found: Candidate[] = []

    for (const m of input.text.matchAll(LINE_USER_ID)) {
      const start = m.index
      const end = start + m[0].length
      if (!isIsolated(input.text, start, end, belongsToId)) continue

      found.push({
        entity: 'LINE_USER_ID',
        start,
        end,
        confidence: 0.99,
        detector: 'line-user-id',
      })
    }

    return found
  },
}
