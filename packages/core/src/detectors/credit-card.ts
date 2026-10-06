import type { Candidate, Detector, NormalisedText } from '../types.js'
import { isAsciiDigit, isIsolated } from './boundary.js'

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

/** 13 to 19 digits, optionally grouped with single spaces or hyphens. */
const CARD_RUN = /\d(?:[ -]?\d){12,18}/g

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

function belongsToRun(ch: string): boolean {
  return isAsciiDigit(ch)
}

export const creditCardDetector: Detector = {
  id: 'credit-card',
  entities: ['CREDIT_CARD'],

  detect(input: NormalisedText): Candidate[] {
    const found: Candidate[] = []

    for (const m of input.text.matchAll(CARD_RUN)) {
      const raw = m[0]
      const start = m.index
      const end = start + raw.length

      // A 16-digit tail of a 20-digit reference passes Luhn as readily as a
      // card does, so the run has to stand alone.
      if (!isIsolated(input.text, start, end, belongsToRun)) continue

      const digits = raw.replace(/[ -]/g, '')
      if (digits.length < 13 || digits.length > 19) continue
      if (!isValidLuhn(digits)) continue

      found.push({
        entity: 'CREDIT_CARD',
        start,
        end,
        confidence: hasKnownIssuer(digits) ? CONFIDENCE_ISSUER_KNOWN : CONFIDENCE_LUHN_ONLY,
        detector: 'credit-card',
      })
    }

    return found
  },
}
