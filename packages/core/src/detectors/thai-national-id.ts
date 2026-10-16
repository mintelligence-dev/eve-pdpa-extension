import { isValidThaiNationalId } from '../normalise.js'
import type { Candidate, DetectContext, Detector, NormalisedText } from '../types.js'
import { isAsciiDigit, isIsolated } from './boundary.js'
import {
  containsAny,
  contextWindow,
  continuesList,
  keyedAsTime,
  previousHasCue,
} from './context.js'
import { DIGIT_RUN, type Group, isBareDash, opensValue, sizesOf, splitRun } from './digit-run.js'

// Digit groups joined by the separators every digit detector reads
// (`digit-run.ts`).
//
// Deliberately loose: shape alone says almost nothing, so everything that could
// be an id is offered to the checksum, which is what actually separates a
// national id from an order number.
//
// Not a run of exactly thirteen, as it was. A regex that takes the first
// thirteen digits it can reach also takes them from a number in front: in
// "ยอด 500 1101700203450" (a made-up id) it took "500 1101700203", turned it
// down for its spacing, and moved on past the id (edge cases, 13 Oct). The run
// is split into groups and every reading of thirteen is tried.

/**
 * The grouping printed on the card, 1-4-5-2-1. A reading with anything but a
 * bare dash in it must follow it: a space or a line break is also what
 * separates two unrelated numbers, and "0812345678 123" is thirteen digits that
 * pass the checksum one time in ten; a dot is what amounts, dates and versions
 * are written with. Spaces were found by the benchmark, 6 Oct; dots by the edge
 * cases, 13 Oct.
 */
const CARD_GROUPING = '1-4-5-2-1'

/**
 * Words that say a number is a national id, so any spacing will do.
 *
 * Customers retype an id from memory, not off the card: 3-3-3-4 after เลขบัตร,
 * or 5-5-3 — the card's grouping alone missed them, and an id typed 5-5-3
 * came out as a phone number with its first five digits in the clear (user
 * benchmark, 13 Oct, D19). With one of these words near and the check digit
 * right, the "0812345678 123" coincidence needs both at once.
 */
const ID_CUES = ['บัตรประชาชน', 'ประชาชน', 'ปชช', 'เลขบัตร', 'id card', 'citizen', 'national id']

/**
 * One line break somewhere inside the thirteen digits, from a PDF, an email or
 * a form that wrapped the id where it ran out of room — not where the card
 * groups it, and with no cue word to go on. Taken when neither line could be a
 * value of its own: a phone number then a quantity on the next line is the
 * likelier reading of "0812345678⏎123" (D19, 13 Oct).
 */
const LINE_BREAK = /^ ?\r?\n ?$/
const COMPLETE_PHONE = /^(0[689]\d{8}|0[2-7]\d{7}|[689]\d{8})$/

function wrapped(reading: readonly Group[]): boolean {
  if (reading.length !== 2 || !LINE_BREAK.test((reading[1] as Group).before)) return false
  return !reading.some((g) => g.digits.length >= 10 || COMPLETE_PHONE.test(g.digits))
}

/** Digits only. Glued letters do not end the run — see phone.ts for why. */
function belongsToRun(ch: string): boolean {
  return isAsciiDigit(ch)
}

/** Passes the mod-11 check digit. */
const CONFIDENCE_CHECKSUM = 0.99
/** Passes it, spaced in a way the card is not: beside a cue word, or wrapped onto two lines. */
const CONFIDENCE_LOOSE = 0.97
/**
 * Right shape, wrong check digit — or right check digit under a key that names
 * a time (`keyedAsTime`): a LINE webhook's `"timestamp"` is
 * thirteen digits in milliseconds and passes the checksum one time in eleven
 * (user benchmark, 14 Oct, D20). Kept so a policy can ask to see near misses.
 */
const CONFIDENCE_SHAPE_ONLY = 0.2

export const thaiNationalIdDetector: Detector = {
  id: 'th-national-id',
  entities: ['TH_NATIONAL_ID'],

  detect(input: NormalisedText, ctx?: DetectContext): Candidate[] {
    const found: Candidate[] = []
    const asked = previousHasCue(input.text, ctx?.previous, ID_CUES)
    // Where the last id that passed its checksum ends: the next line of a
    // list may be spaced loosely too (`continuesList`).
    let listed = -1

    for (const m of input.text.matchAll(DIGIT_RUN)) {
      const groups = splitRun(m[0], m.index)

      for (let from = 0; from < groups.length; from++) {
        if (!opensValue((groups[from] as Group).before)) continue

        let digits = 0
        let to = from
        while (to < groups.length && digits < 13) digits += (groups[to++] as Group).digits.length
        if (digits !== 13) continue

        const start = (groups[from] as Group).start
        const end = (groups[to - 1] as Group).end
        const raw = input.text.slice(start, end)
        if (!isIsolated(input.text, start, end, belongsToRun)) continue
        const reading = groups.slice(from, to)
        const valid =
          isValidThaiNationalId(raw.replace(/\D/g, '')) && !keyedAsTime(input.text, start)
        const loose = reading.some((g, i) => i > 0 && !isBareDash(g.before))
        const asCard = !loose || sizesOf(reading) === CARD_GROUPING
        const loosely =
          !asCard &&
          valid &&
          (asked ||
            wrapped(reading) ||
            containsAny(contextWindow(input.text, start, end), ID_CUES) ||
            continuesList(input.text, start, listed))
        if (!asCard && !loosely) continue
        if (valid) listed = end

        found.push({
          entity: 'TH_NATIONAL_ID',
          start,
          end,
          confidence: loosely
            ? CONFIDENCE_LOOSE
            : valid
              ? CONFIDENCE_CHECKSUM
              : CONFIDENCE_SHAPE_ONLY,
          detector: 'th-national-id',
        })
        from = to - 1
      }
    }

    return found
  },
}
