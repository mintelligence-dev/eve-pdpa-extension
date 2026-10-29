import type { Candidate, Detector, NormalisedText } from '../types.js'
import { isAsciiDigit, isIsolated } from './boundary.js'
import { containsAny, containsWord, contextWindow, keyedAsTime, ownWindow } from './context.js'
import { DIGIT_RUN, type Group, isBareDash, opensValue, splitRun } from './digit-run.js'

/**
 * Luhn check digit, the standard on every payment card.
 *
 * Catches every single-digit error and almost every transposition, but it is
 * only one digit of redundancy: one random run in ten passes. Length and the
 * issuer prefix carry the rest of the weight.
 */
export function isValidLuhn(digits: string): boolean {
  if (digits.length < 2) return false
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    const code = digits.charCodeAt(i) - 48
    if (code < 0 || code > 9) return false
    let value = code
    if (double) {
      value *= 2
      if (value > 9) value -= 9
    }
    sum += value
    double = !double
  }
  return sum % 10 === 0
}

/**
 * Issuer prefixes actually in use in Thailand, plus the international schemes
 * a Thai customer service line still sees.
 *
 * Per-scheme lengths are deliberately not enforced. They drift (Visa alone
 * issues 13, 16 and 19 digits), and a number that passes Luhn and carries a
 * real prefix is worth protecting whether or not our length table is current.
 */
function hasKnownIssuer(d: string): boolean {
  const two = Number(d.slice(0, 2))
  const three = Number(d.slice(0, 3))
  const four = Number(d.slice(0, 4))

  if (d.startsWith('4')) return true // Visa
  if (two >= 51 && two <= 55) return true // Mastercard
  if (four >= 2221 && four <= 2720) return true // Mastercard, 2017 range
  if (two === 34 || two === 37) return true // American Express
  if (four >= 3528 && four <= 3589) return true // JCB
  if (two === 62) return true // UnionPay
  if (two === 36 || two === 38 || two === 39) return true // Diners
  if (three >= 300 && three <= 305) return true // Diners
  if (four === 6011 || two === 65) return true // Discover
  if (three >= 644 && three <= 649) return true // Discover

  return false
}

// Digit groups joined by the separators every digit detector reads
// (`digit-run.ts`): a line break among them, because a card pasted from a note
// or a narrow chat bubble arrives split across two lines.
//
// Deliberately not capped at 19 digits. A cap lets the regex decide where the
// card ends, and it decides wrong: "4012 8888 8888 1881 11/27" became an
// 18-digit run that failed Luhn, and the card in front of the expiry was never
// tried on its own (edge cases, 13 Oct). The run is split into groups and read
// below instead, the way the phone detector does it (D17).

/** The shortest and longest card in issue. */
const MIN_DIGITS = 13
const MAX_DIGITS = 19

/** Luhn plus a real issuer prefix. */
const CONFIDENCE_ISSUER_KNOWN = 0.98
/**
 * Luhn alone. Below the 0.95 default on purpose: one random run in ten passes
 * Luhn, and an order or invoice number of the right length is exactly the kind
 * of run that does. Reported so a policy that would rather over-redact can
 * lower its threshold and pick these up, and so the benchmark can show how many
 * there were.
 */
const CONFIDENCE_LUHN_ONLY = 0.6
/**
 * A run written after a key that names a time (`ts:`, `timestamp=`). Shape
 * only, as the national id detector scores it: far below Luhn alone, because a
 * policy that lowers the card threshold to 0.6 to take in Luhn-only runs still
 * must not read a time as a card. Slack's `message_ts: 1761500013.000100` is
 * sixteen digits with a dot in them, and one in ten passes Luhn: with the
 * threshold at 0.6 it blocked the whole message (Slack, 27 Oct).
 */
const CONFIDENCE_TIME_KEY = 0.2

function belongsToRun(ch: string): boolean {
  return isAsciiDigit(ch)
}

/**
 * Words that make a run a transfer's reference number. A bank slip prints a
 * reference of sixteen digits or more, and "เลขอ้างอิงธนาคาร 4780…" passed
 * Luhn under a Visa prefix and was read at 0.98 (user benchmark, 14 Oct,
 * D20). Beside one of these, and with no word for a card, an issuer reading
 * is scored as Luhn alone: still reported, below the default threshold.
 *
 * Only words for a reference. An order number is not on the list: a customer
 * pays for an order with a card, and "order 1234 จ่ายด้วย 4012…" must still
 * hide the card. The id detector takes no such cue on purpose — a Thai bill
 * payment's Ref1 is the payer's national id more often than not.
 */
const REFERENCE_CUES = ['อ้างอิง', 'reference', 'เลขที่รายการ']
/** "ref" is in "refund" and "prefer": read as a whole word only. */
const REFERENCE_CUE_WORDS = ['ref']
/** Words for a card, which outweigh a reference cue in the same window. */
const CARD_CUES = ['บัตร', 'card', 'visa', 'master', 'credit', 'debit', 'เครดิต', 'เดบิต']

/**
 * True when the sentence says the run is a reference. The reference cue must
 * name this run: no other digit stands between the two. In "อ้างอิง 1006 4012
 * 8888 8888 1881" the word belongs to 1006, and the Visa after it is still a
 * card.
 */
function asReference(text: string, start: number, end: number): boolean {
  if (containsAny(contextWindow(text, start, end), CARD_CUES)) return false
  const window = ownWindow(text, start, end)
  return containsAny(window, REFERENCE_CUES) || containsWord(window, REFERENCE_CUE_WORDS)
}

/**
 * Every way to read the groups from `from` onwards as a card, narrowest first,
 * with the confidence each one earns before its place in the text is looked
 * at.
 *
 * A space, a dot or a line break is also what separates two unrelated
 * numbers, so a reading with one in it has to keep the card's own gaps — the
 * rule the national id detector follows. Without it "0812345678 123456", or
 * an id with a quantity after it, passes Luhn one time in ten, and the longer
 * span then wins the merge over the id it swallowed (edge cases, 13 Oct). The
 * card's gaps fall after each fourth digit (4-4-4-4, and the 13- and 19-digit
 * cards), or after the fourth and tenth (Amex 4-6-5, Diners 4-6-4).
 *
 * Except a single space under a real issuer: "4012 888 8888 81881" and a card
 * typed a digit at a time were found before 13 Oct and missed after (code
 * review, 13 Oct). A phone or a young id has no issuer, and an id that starts
 * like one is covered at 0.98, not dropped as a 0.6 reading would drop it. A
 * dot, a line break or spaces round a dash were never read in a card before
 * 13 Oct, and join amounts, dates and lists. Bare dashes stay loose.
 */
function cardsFrom(
  groups: readonly Group[],
  from: number,
  visit: (to: number, confidence: number, printed: boolean, digits: number) => void,
): void {
  let digits = ''
  let strict = false
  let loose = false
  let byFour = true
  let byAmex = true
  for (let to = from + 1; to <= groups.length; to++) {
    const g = groups[to - 1] as Group
    if (to > from + 1) {
      if (digits.length % 4 !== 0) byFour = false
      if (digits.length !== 4 && digits.length !== 10) byAmex = false
      if (!isBareDash(g.before)) {
        loose = true
        if (g.before !== ' ') strict = true
      }
    }
    digits += g.digits
    if (digits.length > MAX_DIGITS) return
    if (digits.length < MIN_DIGITS) continue

    const issuer = hasKnownIssuer(digits)
    const printed = byFour || byAmex
    // Neither can come back further on: a gap out of place stays out of place.
    if (!printed && (strict || (loose && !issuer))) return
    if (isValidLuhn(digits)) {
      visit(to, issuer ? CONFIDENCE_ISSUER_KNOWN : CONFIDENCE_LUHN_ONLY, printed, digits.length)
    }
  }
}

/**
 * True when a card this detector acts on by default starts at group `at`.
 * Asked by the bank-account detector.
 */
export function startsIssuedCard(groups: readonly Group[], at: number): boolean {
  if (!opensValue((groups[at] as Group).before)) return false
  let found = false
  cardsFrom(groups, at, (_to, confidence) => {
    if (confidence === CONFIDENCE_ISSUER_KNOWN) found = true
  })
  return found
}

/** One way to read part of a run as a card, and what makes it likely. */
interface Reading {
  readonly candidate: Candidate
  readonly from: number
  readonly to: number
  /** Every gap where a card prints one. */
  readonly printed: boolean
  readonly digits: number
}

/**
 * Which of two overlapping readings is the card: a real issuer, then the
 * card's own gaps, then the wider, then the earlier. Widest-first from the
 * left took the 0.6 "1006 4012 8888 8888" and never tried the Visa after 1006
 * (code review, 13 Oct).
 */
function stronger(a: Reading, b: Reading): number {
  const byIssuer = b.candidate.confidence - a.candidate.confidence
  if (byIssuer !== 0) return byIssuer
  if (a.printed !== b.printed) return a.printed ? -1 : 1
  if (a.digits !== b.digits) return b.digits - a.digits
  return a.from - b.from
}

export const creditCardDetector: Detector = {
  id: 'credit-card',
  entities: ['CREDIT_CARD'],

  detect(input: NormalisedText): Candidate[] {
    const found: Candidate[] = []

    for (const m of input.text.matchAll(DIGIT_RUN)) {
      const groups = splitRun(m[0], m.index)
      // An expiry or a CVV typed after the card, or an amount before it, joins
      // the run at a space. Every reading that starts after a separator other
      // than a bare dash is tried, at most 19 digits wide.
      const readings: Reading[] = []
      for (let from = 0; from < groups.length; from++) {
        if (!opensValue((groups[from] as Group).before)) continue
        cardsFrom(groups, from, (to, confidence, printed, digits) => {
          const start = (groups[from] as Group).start
          const end = (groups[to - 1] as Group).end
          // A 16-digit tail of a 20-digit reference passes Luhn as readily as
          // a card does, so the reading has to stand alone.
          if (!isIsolated(input.text, start, end, belongsToRun)) return
          readings.push({
            candidate: { entity: 'CREDIT_CARD', start, end, confidence, detector: 'credit-card' },
            from,
            to,
            printed,
            digits,
          })
        })
      }

      const taken = new Uint8Array(groups.length)
      for (const r of readings.sort(stronger)) {
        if (taken.subarray(r.from, r.to).includes(1)) continue
        taken.fill(1, r.from, r.to)
        // After the choice, not before: the sentence says what the run is, not
        // which of its digits make the card.
        const { start, end, confidence } = r.candidate
        if (keyedAsTime(input.text, start)) {
          found.push({ ...r.candidate, confidence: CONFIDENCE_TIME_KEY })
        } else if (confidence === CONFIDENCE_ISSUER_KNOWN && asReference(input.text, start, end)) {
          found.push({ ...r.candidate, confidence: CONFIDENCE_LUHN_ONLY })
        } else {
          found.push(r.candidate)
        }
      }
    }

    return found.sort((a, b) => a.start - b.start)
  },
}
