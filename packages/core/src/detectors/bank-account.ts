import type { Candidate, Detector, NormalisedText } from '../types.js'
import { isAsciiDigit, isIsolated } from './boundary.js'
import { containsAny, contextWindow } from './context.js'

/**
 * The weakest claim in the set, and the only one that will not be made on the
 * strength of the digits alone.
 *
 * A Thai bank account is ten to twelve digits with no check digit, no reserved
 * prefix and no length nothing else uses. Against an order number, an invoice
 * reference or a tracking code it is indistinguishable. So this detector does
 * not look at a run of digits and ask whether it could be an account — it reads
 * the sentence and acts only when the sentence says so.
 *
 * The cost is recall on a message that gives a number with no introduction, and
 * D5 requires that to be reported as a miss rather than papered over. The
 * alternative — claiming every ten-digit run — would put a finding on most
 * order confirmations and teach customers to ignore the guard.
 */
const ACCOUNT_RUN = /\d(?:[ -]?\d){9,11}/g

const ACCOUNT_CUES = [
  'บัญชี',
  'ธนาคาร',
  'เลขที่บช',
  'โอนเงิน',
  'โอนมาที่',
  'account',
  'acct',
  'transfer',
  // Bank names customers use in place of the word บัญชี. Only the ones that are
  // not also ordinary words: กรุงเทพ is left out because it is the city.
  'กสิกร',
  'ไทยพาณิชย์',
  'กรุงไทย',
  'กรุงศรี',
  'ออมสิน',
  'ทหารไทย',
  'scb',
  'kbank',
  'ktb',
  'ttb',
  'gsb',
  'bbl',
]

/** Shape plus a cue word. There is no stronger evidence available. */
const CONFIDENCE_WITH_CUE = 0.96

function belongsToRun(ch: string): boolean {
  return isAsciiDigit(ch)
}

export const bankAccountDetector: Detector = {
  id: 'bank-account',
  entities: ['BANK_ACCOUNT'],

  detect(input: NormalisedText): Candidate[] {
    const found: Candidate[] = []

    for (const m of input.text.matchAll(ACCOUNT_RUN)) {
      const raw = m[0]
      const start = m.index
      const end = start + raw.length

      if (!isIsolated(input.text, start, end, belongsToRun)) continue

      const digits = raw.replace(/[ -]/g, '')
      if (digits.length < 10 || digits.length > 12) continue

      if (!containsAny(contextWindow(input.text, start, end), ACCOUNT_CUES)) continue

      found.push({
        entity: 'BANK_ACCOUNT',
        start,
        end,
        confidence: CONFIDENCE_WITH_CUE,
        detector: 'bank-account',
      })
    }

    return found
  },
}
