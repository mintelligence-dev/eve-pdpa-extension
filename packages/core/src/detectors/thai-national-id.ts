import { isValidThaiNationalId } from '../normalise.js'
import type { Candidate, Detector, NormalisedText } from '../types.js'

/**
 * A digit run long enough to hold 13 digits plus separators.
 *
 * Deliberately loose: shape alone says almost nothing, so everything that looks
 * like it could be an id is offered to the checksum, which is what actually
 * separates a national id from an order number.
 *
 * Read with matchAll rather than exec, so the shared lastIndex of a module-level
 * /g regex can never leak between two calls.
 */
const TH_ID_RUN = /\d[\d-]{11,20}\d/g

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
      const digits = raw.replace(/-/g, '')
      if (digits.length !== 13) continue

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
