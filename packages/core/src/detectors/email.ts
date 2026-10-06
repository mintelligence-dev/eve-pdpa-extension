import type { Candidate, Detector, NormalisedText } from '../types.js'
import { isAsciiDigit, isAsciiLetter, isIsolated } from './boundary.js'

/**
 * A deliberate subset of RFC 5322, not the whole grammar.
 *
 * The full grammar accepts things no customer ever types and that a redactor
 * cannot safely span — quoted local parts with embedded spaces, nested
 * comments, folding whitespace, address lists. Matching them would widen every
 * span far past the address itself. What is left out, and why it is safe to
 * leave out here:
 *
 *   quoted local part   "john doe"@example.com   — contains spaces; a greedy
 *                                                  span would swallow the
 *                                                  surrounding sentence
 *   IP-literal domain   user@[192.0.2.1]         — an address, not a mailbox
 *                                                  anyone types in chat
 *   comments            user(note)@example.com   — legal, never seen in the wild
 *   raw IDN             ผู้ใช้@ตัวอย่าง.ไทย          — see the note below
 *
 * A miss here is an FN, and the benchmark must report it rather than hide it
 * (D5). Written down so the number has a cause on record.
 *
 * Thai IDN is the one worth revisiting: .ไทย domains exist, and this pattern
 * sees only the punycode form. Left out of 0.1 because folding Unicode labels
 * belongs with the NFC work that normalise also deferred.
 */
const LOCAL = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*"
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?'
const EMAIL = new RegExp(`${LOCAL}@(?:${LABEL}\\.)+[A-Za-z]{2,63}`, 'g')

/** Anything that could be part of the same address, on either side. */
function belongsToAddress(ch: string): boolean {
  return isAsciiLetter(ch) || isAsciiDigit(ch) || "!#$%&'*+/=?^_`{|}~-.@".includes(ch)
}

export const emailDetector: Detector = {
  id: 'email',
  entities: ['EMAIL'],

  detect(input: NormalisedText): Candidate[] {
    const found: Candidate[] = []

    for (const m of input.text.matchAll(EMAIL)) {
      const start = m.index
      const end = start + m[0].length

      // The TLD is greedy over letters, so only a digit, a hyphen or a further
      // dotted label can follow — each of which means the run was cut short and
      // this is not the whole address.
      if (!isIsolated(input.text, start, end, belongsToAddress)) continue

      found.push({
        entity: 'EMAIL',
        start,
        end,
        // Nothing else in Thai customer text takes this shape, but an address
        // can still belong to the shop rather than the customer. That is a
        // policy allowlist question, not a detection one.
        confidence: 0.97,
        detector: 'email',
      })
    }

    return found
  },
}
