import type { Candidate, DetectContext, Detector, NormalisedText } from '../types.js'
import { isAsciiDigit, isIsolated } from './boundary.js'
import {
  type CueAt,
  containsAny,
  containsWord,
  contextWindow,
  continuesList,
  cueDistance,
  cuesIn,
  isAnswer,
  keyedAsTime,
} from './context.js'
import { startsIssuedCard } from './credit-card.js'
import {
  DIGIT_RUN,
  digitsIn,
  type Group,
  isBareDash,
  opensValue,
  readingEnd,
  sizesOf,
  splitRun,
} from './digit-run.js'

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
 *
 * Read from the separators every digit detector reads (`digit-run.ts`), split
 * into groups the way the id and card detectors are. It was one regex of ten
 * to twelve digits with a space or hyphen anywhere, which took whatever number
 * stood in front: "ยอด 500 1234567890" became twelve digits glued to the next,
 * failed, and the account was never tried on its own (edge cases, 13 Oct).
 */
const MIN_DIGITS = 10
const MAX_DIGITS = 12

/**
 * The grouping a passbook prints for a ten-digit account, 3-1-5-1. A reading
 * with a dot or a line break in it must follow it, where the id and card
 * detectors ask the same of a space too.
 *
 * A transfer is the sentence that carries an account cue, and it is also the
 * sentence that carries a date and a time, written with dots: "โอนเงินแล้ว
 * 13.10.69 14.30" is ten digits under a cue. Amounts under one are listed a line
 * each, and "500\n1200\n3000" is eleven (edge cases, 13 Oct). Nothing but the
 * cue stands between this detector and either, so a dotted or wrapped account
 * in another grouping is left as a miss. A space is left as loose as it was.
 */
const STRICT_GROUPING = '3-1-5-1'

/**
 * Words that name an account. The phone detector reads these too, and a
 * phone-shaped run under one of them yields to BANK_ACCOUNT (D19).
 */
export const ACCOUNT_NAMES: readonly string[] = [
  'บัญชี',
  'เลขที่บช',
  'เลขบช',
  'บช.',
  // The abbreviation with its letters split, "บ/ช 123-4-56789-0", "บ.ช." —
  // missed where บช. was caught (user question, 14 Oct, D20). Nothing else
  // in Thai is spelled with a slash or a dot between these two letters.
  'บ/ช',
  'บ.ช',
  'account',
  'acct',
]

/**
 * The abbreviation on its own, "บช 123-4-56789-0", "เลข บช …". Not a plain
 * substring: บ ends a syllable and ช starts the next one in common words, and
 * the synthetic templates hold three of them — ตอบช้า, รีบช่วย, ระงับชั่วคราว
 * (checked 14 Oct, D20). So บช counts only when no Thai consonant stands
 * before it (ครบชุด, รบชนะ) and no vowel or tone mark after it (รับชำระ,
 * ระงับชั่วคราว: a mark before the บ is not a consonant, so the side after is
 * what rules these out). "เลขบช" is left to its own entry above, which the
 * consonant rule would refuse.
 */
const ACCOUNT_ABBREVIATION = 'บช'

/** ก to ฮ. */
function isThaiConsonant(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '\u0e01' && ch <= '\u0e2e'
}

/** A vowel written after or above or below a consonant, or a tone mark: ะ to ฺ, ๅ, ็ to ๎. */
function isThaiMark(ch: string | undefined): boolean {
  if (ch === undefined) return false
  return (ch >= '\u0e30' && ch <= '\u0e3a') || ch === '\u0e45' || (ch >= '\u0e47' && ch <= '\u0e4e')
}

function abbreviationsIn(window: string): CueAt[] {
  const found: CueAt[] = []
  const w = ACCOUNT_ABBREVIATION
  for (let at = window.indexOf(w); at !== -1; at = window.indexOf(w, at + 1)) {
    if (!isThaiConsonant(window[at - 1]) && !isThaiMark(window[at + w.length])) {
      found.push([at, at + w.length])
    }
  }
  return found
}

/** True when the window holds บช standing as the abbreviation, not inside a word. */
export function writesAccountShort(window: string): boolean {
  return abbreviationsIn(window).length > 0
}

/**
 * The same, as short Latin forms read only as whole words (`containsWord`):
 * "refund to my acc 4535567048", "a/c 453-5-56704-8" were missed, and "acc"
 * is in "accept" and "access" (user benchmark, 14 Oct, D20).
 */
export const ACCOUNT_NAME_WORDS: readonly string[] = ['acc', 'a/c']

const ACCOUNT_CUES = [
  ...ACCOUNT_NAMES,
  'ธนาคาร',
  'โอนเงิน',
  // Any direction of a transfer. Listed on 6 Oct, before the benchmark ran, from
  // phrasings that were missed in hand-written examples.
  'โอนมา',
  'โอนเข้า',
  'โอนไป',
  // A refund paid back by transfer, "โอนคืนเข้า 086-1-59417-2" — the word
  // between โอน and เข้า hid it from โอนเข้า (user benchmark, 14 Oct, D20).
  'โอนคืน',
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
  'k-bank',
  'ktb',
  'ttb',
  'gsb',
  'bbl',
  'kasikorn',
  'krungthai',
  'krungsri',
]

/**
 * Whole words only. "bank" is ธนาคาร, which has been a cue from the start; it
 * also names the bank a customer writes in English, "bangkok bank", where the
 * Thai กรุงเทพ could not be used (user benchmark, 14 Oct, D20). As a word, so
 * "kbank" stays its own cue and "banking" is not one.
 */
const ACCOUNT_CUE_WORDS = [...ACCOUNT_NAME_WORDS, 'bank']

/** True when the window holds any account cue: a name, a transfer, a bank. */
export function hasAccountCue(window: string): boolean {
  return (
    containsAny(window, ACCOUNT_CUES) ||
    containsWord(window, ACCOUNT_CUE_WORDS) ||
    writesAccountShort(window)
  )
}

function accountCuesIn(window: string): CueAt[] {
  return [...cuesIn(window, ACCOUNT_CUES, ACCOUNT_CUE_WORDS), ...abbreviationsIn(window)]
}

/** True when `text` reads as the answer to a question that carried an account cue. D10.11. */
export function answersAccountCue(text: string, previous: string | undefined): boolean {
  return isAnswer(text, previous) && hasAccountCue(previous)
}

/**
 * Words that name a run as an order, a case or a transaction's reference: the
 * phone detector's list for a number with no leading 0 and the card
 * detector's for a slip's reference, read together, since a ten-digit run can
 * be any of them.
 *
 * Read only against an account cue, never alone — a reference word does not
 * stop a run being an account, a nearer one does. "คืนเงินออเดอร์ 2510120045"
 * answering "ขอเลขบัญชีค่ะ" was claimed on the question's cue, and so was the
 * same order number with บัญชี a clause back (user benchmark, 14 Oct, D20
 * item 25). The cue nearer the run is the one that names it; a cue borrowed
 * from the question (D10.11) or a list's first line is not in the message and
 * loses to one that is. On a tie the account is kept: overreach is a true
 * positive under D5, a leak is not.
 *
 * The card detector keeps an order out of its list, because a card pays for
 * an order. A bank account is not written beside an order number to pay for
 * it — it is written to be paid into, under its own word, which is nearer. The
 * id detector takes no reference cue at all (a bill's Ref1 is the payer's id).
 */
const REFERENCE_CUES = [
  'ออเดอร์',
  'order',
  'คำสั่งซื้อ',
  'อ้างอิง',
  'reference',
  'เลขที่รายการ',
  'เคส',
  'พัสดุ',
  'tracking',
]
/** "ref" is in "refund" and "prefer": read as a whole word only. */
const REFERENCE_CUE_WORDS = ['ref']

/** True when a reference cue names the run at `start`..`end` and no nearer account cue does. */
function namedAsReference(text: string, start: number, end: number): boolean {
  const reference = cueDistance(text, start, end, (w) =>
    cuesIn(w, REFERENCE_CUES, REFERENCE_CUE_WORDS),
  )
  if (reference === Number.POSITIVE_INFINITY) return false
  return reference < cueDistance(text, start, end, accountCuesIn)
}

/**
 * Where a reading taken under a cue ends: past the groups that follow it
 * joined the way its own are. Cut at twelve digits, "บัญชี 1234 5678 9012 3456"
 * left 3456 in the clear (code review, 13 Oct); decided 13 Oct to cover the
 * run whole — overreach is a true positive under D5, a leak is not.
 *
 * Only through the single spaces or bare dashes the reading itself has, so a
 * one-group account keeps "500 บาท" out, and a dot or a line break ends it.
 * Not over a card the card detector acts on, so the card keeps its name; not
 * over a group a bare dash glues to the next value, or the span would cut
 * that value in two and could win the merge over it.
 */
function extend(groups: readonly Group[], from: number, to: number): number {
  const joins = new Set(groups.slice(from + 1, to).map((g) => g.before))
  if (joins.size === 0) return to
  for (const sep of joins) if (sep !== ' ' && !isBareDash(sep)) return to
  for (let at = from; at < to; at++) if (startsIssuedCard(groups, at)) return to

  const joined = (at: number) => at < groups.length && joins.has((groups[at] as Group).before)
  const glued = (at: number) => {
    const next = groups[at + 1]
    return next !== undefined && isBareDash(next.before) && !joins.has(next.before)
  }
  let end = to
  while (joined(end) && !glued(end) && !startsIssuedCard(groups, end)) end++
  return end
}

/** Shape plus a cue word. There is no stronger evidence available. */
const CONFIDENCE_WITH_CUE = 0.96

function belongsToRun(ch: string): boolean {
  return isAsciiDigit(ch)
}

export const bankAccountDetector: Detector = {
  id: 'bank-account',
  entities: ['BANK_ACCOUNT'],

  detect(input: NormalisedText, ctx?: DetectContext): Candidate[] {
    const found: Candidate[] = []
    // "your account number?" then "123-4-56789-0 ชื่อ สมชาย" — the cue is in
    // the question. Benchmark, 6 Oct: most remaining misses were this. D10.11.
    const answered = answersAccountCue(input.text, ctx?.previous)
    // Where the last account found ends: the next line of a list is one too.
    let listed = -1

    const read = (groups: readonly Group[], from: number, to: number): Candidate | null => {
      const slice = groups.slice(from, to)
      const digits = slice.reduce((n, g) => n + g.digits.length, 0)
      if (digits < MIN_DIGITS || digits > MAX_DIGITS) return null
      const strict = slice.some((g, i) => i > 0 && /[.\n]/.test(g.before))
      if (strict && sizesOf(slice) !== STRICT_GROUPING) return null

      const start = (slice[0] as Group).start
      const end = (slice[slice.length - 1] as Group).end
      if (!isIsolated(input.text, start, end, belongsToRun)) return null
      // "transfer_time": 1760259091 is ten digits under a cue.
      if (keyedAsTime(input.text, start)) return null
      const cued =
        answered ||
        hasAccountCue(contextWindow(input.text, start, end)) ||
        continuesList(input.text, start, listed)
      if (!cued) return null
      if (namedAsReference(input.text, start, end)) return null
      return {
        entity: 'BANK_ACCOUNT',
        start,
        end,
        confidence: CONFIDENCE_WITH_CUE,
        detector: 'bank-account',
      }
    }

    for (const m of input.text.matchAll(DIGIT_RUN)) {
      const groups = splitRun(m[0], m.index)
      // Widest reading first, as the regex this replaced was greedy; a new one
      // starts only after a separator that is not a bare dash.
      let from = 0
      while (from < groups.length) {
        let taken: Candidate | null = null
        let to = readingEnd(groups, from, MAX_DIGITS)
        let digits = digitsIn(groups, from, to)
        while (to > from && digits >= MIN_DIGITS) {
          taken = read(groups, from, to)
          if (taken !== null) break
          to--
          digits -= (groups[to] as Group).digits.length
        }
        if (taken !== null) {
          const end = extend(groups, from, to)
          found.push({ ...taken, end: (groups[end - 1] as Group).end })
          listed = (groups[end - 1] as Group).end
          from = end
        } else {
          from++
        }
        while (from < groups.length && !opensValue((groups[from] as Group).before)) from++
      }
    }

    return found
  },
}
