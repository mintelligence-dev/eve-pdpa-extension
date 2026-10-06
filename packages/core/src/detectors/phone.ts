import type { Candidate, DetectContext, Detector, NormalisedText } from '../types.js'
import { isAsciiDigit, isIsolated } from './boundary.js'
import { containsAny, contextWindow, previousHasCue } from './context.js'

/**
 * A Thai number in national form, or in +66 international form.
 *
 * Separators are single spaces or hyphens, which is how the number is written
 * everywhere it is written by hand. No checksum exists, so the prefix and the
 * length carry the whole decision.
 */
const PHONE_RUN = /(?:\+66[ -]?|0)\d(?:[ -]?\d){6,9}/g

/** Words that make a run of digits a phone number rather than a reference. */
const PHONE_CUES = ['เบอร์', 'โทร', 'มือถือ', 'ติดต่อ', 'tel', 'phone', 'mobile', 'sms', 'otp']

/**
 * Words that make the same run an account number instead.
 *
 * A ten-digit run under the word บัญชี is claimed by the bank-account detector,
 * and both cannot act on one span. The merge resolves an exact tie by entity
 * priority, where PHONE sits above BANK_ACCOUNT — so the only way to let the
 * sentence decide is for this detector to stand down. The span is protected
 * either way; what changes is which entity the audit event names.
 */
const ACCOUNT_CUES = ['บัญชี', 'ธนาคาร', 'โอนเงิน', 'account']

/** Mobile: 0 + 6/8/9 + 8 digits. */
const CONFIDENCE_MOBILE = 0.97
/** Landline: 0 + area code starting 2-7 + subscriber, nine digits in all. */
const CONFIDENCE_LANDLINE = 0.95
/** Either shape, with a cue word beside it. */
const CONFIDENCE_WITH_CUE = 0.99

/**
 * Turns +66 form into the national form the prefix rules are written for.
 *
 * Also the canonical form of a phone number (`actions/canonical.ts`), so the
 * detector and the actions agree on when two numbers are the same number.
 */
export function toNationalForm(raw: string): string {
  const digits = raw.replace(/[ -]/g, '')
  if (digits.startsWith('+66')) return `0${digits.slice(3)}`
  return digits
}

function baseConfidence(national: string): number | null {
  if (!national.startsWith('0')) return null
  const second = national.charCodeAt(1) - 48

  if (national.length === 10) {
    // 06, 08, 09 are the mobile ranges the NBTC has allocated. 07 is a
    // landline area code, so a ten-digit run starting 07 is not a phone number
    // at all.
    return second === 6 || second === 8 || second === 9 ? CONFIDENCE_MOBILE : null
  }

  if (national.length === 9) {
    return second >= 2 && second <= 7 ? CONFIDENCE_LANDLINE : null
  }

  return null
}

// Letters do not count, on purpose. "TH0956318274" is a tracking number and is
// caught as a phone number (benchmark, 6 Oct) — but if glued letters ended the
// run, anyone could hide a real number by typing "x0918887777". A false
// positive costs readability; a false negative costs the number.
function belongsToRun(ch: string): boolean {
  return isAsciiDigit(ch) || ch === '+'
}

export const phoneDetector: Detector = {
  id: 'phone',
  entities: ['PHONE'],

  detect(input: NormalisedText, ctx?: DetectContext): Candidate[] {
    const found: Candidate[] = []
    // The question decides between the two ten-digit readings when the answer
    // is only the number (D10.11): asked for an account, stand down; asked for
    // a phone, count the question as the cue.
    const askedPhone = previousHasCue(input.text, ctx?.previous, PHONE_CUES)
    const askedAccount = !askedPhone && previousHasCue(input.text, ctx?.previous, ACCOUNT_CUES)

    for (const m of input.text.matchAll(PHONE_RUN)) {
      const raw = m[0]
      const start = m.index
      const end = start + raw.length

      if (!isIsolated(input.text, start, end, belongsToRun)) continue

      const confidence = baseConfidence(toNationalForm(raw))
      if (confidence === null) continue

      const window = contextWindow(input.text, start, end)
      const phoneCue = containsAny(window, PHONE_CUES) || askedPhone
      if (!phoneCue && (askedAccount || containsAny(window, ACCOUNT_CUES))) continue

      found.push({
        entity: 'PHONE',
        start,
        end,
        confidence: phoneCue ? CONFIDENCE_WITH_CUE : confidence,
        detector: 'phone',
      })
    }

    return found
  },
}
