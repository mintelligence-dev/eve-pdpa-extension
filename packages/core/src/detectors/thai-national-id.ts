import { isValidThaiNationalId } from '../normalise.js'
import type { Candidate, Detector, NormalisedText } from '../types.js'
import { isAsciiDigit, isIsolated } from './boundary.js'

/**
 * Thirteen digits, each optionally separated from the next by one dash or space.
 *
 * Deliberately loose on dashes: shape alone says almost nothing, so everything
 * that could be an id is offered to the checksum, which is what actually
 * separates a national id from an order number.
 *
 * Read with matchAll rather than exec, so the shared lastIndex of a module-level
 * /g regex can never leak between two calls.
 */
const TH_ID_RUN = /\d(?:[ -]?\d){12}/g

/**
 * The grouping printed on the card, 1-4-5-2-1. A run with spaces in it must
 * follow it: a space is also what separates two unrelated numbers, and
 * "0812345678 123" is thirteen digits that pass the checksum one time in ten.
 * Found by the benchmark, 6 Oct — spaced ids were missed outright.
 */
const CARD_GROUPING = /^\d[ -]\d{4}[ -]\d{5}[ -]\d{2}[ -]\d$/

/** Digits only. Glued letters do not end the run — see phone.ts for why. */
function belongsToRun(ch: string): boolean {
  return isAsciiDigit(ch)
}

/** Passes the mod-11 check digit. */
const CONFIDENCE_CHECKSUM = 0.99
/** Right shape, wrong check digit. Kept so a policy can ask to see near misses. */
const CONFIDENCE_SHAPE_ONLY = 0.2

export const thaiNationalIdDetector: Detector = {
  id: 'th-national-id',
  entities: ['TH_NATIONAL_ID'],

  detect(input: NormalisedText): Candidate[] {
    const found: Candidate[] = []

    for (const m of input.text.matchAll(TH_ID_RUN)) {
      const raw = m[0]
      if (!isIsolated(input.text, m.index, m.index + raw.length, belongsToRun)) continue
      if (raw.includes(' ') && !CARD_GROUPING.test(raw)) continue
      const digits = raw.replace(/[ -]/g, '')

      found.push({
        entity: 'TH_NATIONAL_ID',
        start: m.index,
        end: m.index + raw.length,
        confidence: isValidThaiNationalId(digits) ? CONFIDENCE_CHECKSUM : CONFIDENCE_SHAPE_ONLY,
        detector: 'th-national-id',
      })
    }

    return found
  },
}
