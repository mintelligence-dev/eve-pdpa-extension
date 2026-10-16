import type { Candidate, DetectContext, Detector, NormalisedText } from '../types.js'
import {
  ACCOUNT_NAME_WORDS,
  ACCOUNT_NAMES,
  answersAccountCue,
  hasAccountCue,
  writesAccountShort,
} from './bank-account.js'
import { isAsciiDigit, isAsciiLetter, isIsolated } from './boundary.js'
import {
  containsAny,
  containsWord,
  contextWindow,
  continuesList,
  isAnswer,
  keyedAsTime,
  previousHasCue,
} from './context.js'
import { digitsIn, isBareDash, opensValue, readingEnd, SEPARATOR_SOURCE } from './digit-run.js'

/**
 * Finding a phone number takes two passes (D17).
 *
 * The first is loose: groups of digits joined by anything people put between
 * them — the separators every digit detector reads (`digit-run.ts`), and the
 * bracket closing an area code, which only a phone has. The second is
 * strict: drop the separators, read the digits against the Thai numbering plan,
 * and score what is left. A loose first pass on its own would take every dotted
 * date; a strict one on its own misses every number not typed the way its
 * author types them. No checksum exists, so the prefix, the length and the
 * sentence carry the whole decision.
 */
const RUN = new RegExp(`[+(]?\\d+(?:(?:\\)[ -]?|${SEPARATOR_SOURCE})\\d+)*`, 'g')

/** What sits between two digit groups of a run. */
const SEPARATOR = new RegExp(`\\)[ -]?|${SEPARATOR_SOURCE}`, 'g')

/** Words that make a run of digits a phone number rather than a reference. */
const PHONE_CUES = [
  'เบอร์',
  'โทร',
  'มือถือ',
  'ติดต่อ',
  'tel',
  'phone',
  'mobile',
  'sms',
  'otp',
  // The field a telco's tools name the number with, "topup(msisdn=66616699461)":
  // tool output carries no other word for it (user benchmark, 14 Oct, D20).
  'msisdn',
]

/**
 * Words that make the same run an account number instead.
 *
 * A ten-digit run under the word บัญชี is claimed by the bank-account detector
 * too. This detector used to stand down so the audit event would name the
 * account, which left the number in the clear under a policy that redacts
 * phones and only flags accounts — and a PromptPay account is a phone number.
 * It now claims the run and yields to BANK_ACCOUNT: the account names it when
 * the policy treats both alike, the stricter action wins when it does not (D19).
 */
const ACCOUNT_CUES = [...ACCOUNT_NAMES, 'ธนาคาร', 'โอนเงิน']
const ACCOUNT_CUE_WORDS = [...ACCOUNT_NAME_WORDS, 'bank']

/** The words above, and บช standing alone as the bank detector reads it (D20). */
function namesAccount(window: string): boolean {
  return (
    containsAny(window, ACCOUNT_CUES) ||
    containsWord(window, ACCOUNT_CUE_WORDS) ||
    writesAccountShort(window)
  )
}

/**
 * The grouping a passbook prints, 3-1-5-1, which no Thai phone number is
 * written in. "โอนคืนเข้า 086-1-59417-2" was read as a mobile because 086 is a
 * mobile prefix (user benchmark, 14 Oct, D20). In this grouping any account
 * cue the bank-account detector reads — a transfer, a bank's name — makes the
 * run an account, and the reading yields to it even beside a phone cue. In any
 * other grouping only the words above do: a PromptPay transfer goes to a phone
 * number, so "โอนเข้า 0812345678" stays a phone.
 */
const PASSBOOK_GROUPING = '3-1-5-1'

/**
 * Words that make a number with no leading 0 an order or case number.
 *
 * Only read for the shapes that need a cue to be a phone at all. "ไม่ต้องให้
 * เบอร์ค่ะ แจ้งเลขออเดอร์ 918887777" has a phone cue and is not a phone.
 */
const REFERENCE_CUES = ['ออเดอร์', 'order', 'คำสั่งซื้อ', 'อ้างอิง', 'เคส', 'พัสดุ', 'tracking']

/** Mobile: 0 + 6/8/9 + 8 digits. */
const CONFIDENCE_MOBILE = 0.97
/** Landline: 0 + area code starting 2-7 + subscriber, nine digits in all. */
const CONFIDENCE_LANDLINE = 0.95
/** Either shape, with a cue word beside it. */
const CONFIDENCE_WITH_CUE = 0.99
/**
 * No leading 0, or 66 without the plus — only ever with a cue. Above the
 * default threshold, below every other shape, so a policy can drop just these.
 */
const CONFIDENCE_BARE = 0.96
/**
 * Grouped in a way nobody writes a Thai number, with dots. Spaces and hyphens
 * are not charged: the 0.1 detector took any grouping of them and nothing in
 * the benchmark says it should not have.
 */
const PENALTY_ODD_GROUPING = 0.03
/**
 * Dots, with no cue: dates and amounts use them too. Brackets cost nothing —
 * nothing else puts an area code in brackets.
 */
const PENALTY_DOT = 0.02

/** Group sizes in national form, the way Thai numbers are written. */
const MOBILE_GROUPINGS = ['10', '3-3-4', '3-7', '2-4-4']
const LANDLINE_GROUPINGS = ['9', '2-3-4', '3-3-3', '2-7', '3-6']

/**
 * Turns any way of writing a number into the national form the prefix rules
 * are written for: +66 or 66 becomes 0, a missing 0 is put back.
 *
 * Also the canonical form of a phone number (`actions/canonical.ts`), so the
 * detector and the actions agree on when two numbers are the same number. Only
 * ever called on a span this detector accepted, which is why a run without a
 * leading 0 can be taken to have lost it — a letter O typed in its place is
 * not a digit, and goes with the other punctuation.
 */
export function toNationalForm(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  // The span can open with the bracket round an area code, "(+662) 123 4567".
  if (/^\(?\+66/.test(raw)) return `0${digits.slice(2)}`
  if (digits.startsWith('66') && digits.length === 11) return `0${digits.slice(2)}`
  if (!digits.startsWith('0')) return `0${digits}`
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

/** How the number was written, once it is known to be one. */
type Prefix = 'zero' | 'plus66' | 'bare66' | 'none'

function prefixOf(text: string, digits: string): Prefix {
  if (text.startsWith('+')) return digits.startsWith('66') ? 'plus66' : 'none'
  if (digits.startsWith('0')) return 'zero'
  if (digits.startsWith('66') && digits.length === 11) return 'bare66'
  return 'none'
}

/** Group sizes as if the number had been written in national form. */
function nationalGrouping(groups: readonly string[], prefix: Prefix): string {
  const sizes = groups.map((g) => g.length)
  if (prefix === 'plus66' || prefix === 'bare66') {
    // "+66 91 888 7777": the country code is its own group, and 91 is 091.
    if (groups[0] === '66') sizes.shift()
    else sizes[0] = (sizes[0] ?? 0) - 2
    sizes[0] = (sizes[0] ?? 0) + 1
  } else if (prefix === 'none') {
    sizes[0] = (sizes[0] ?? 0) + 1
  }
  return sizes.join('-')
}

// Letters do not count, on purpose. "TH0812345678" is a tracking number and is
// caught as a phone number (benchmark, 6 Oct) — but if glued letters ended the
// run, anyone could hide a real number by typing "x0918887777". A false
// positive costs readability; a false negative costs the number.
function belongsToRun(ch: string): boolean {
  return isAsciiDigit(ch) || ch === '+'
}

/** One run split at its separators, with where each group starts in the text. */
interface Group {
  readonly digits: string
  readonly start: number
  readonly end: number
  /**
   * A new number may start here. Not after a bare dash (`digit-run.ts`), and
   * not after the bracket closing an area code: the subscriber number follows.
   * A bracket the run did not open is the number of a list item, "1) 081…",
   * and a number starts after it (user benchmark, 14 Oct, D20).
   */
  readonly opens: boolean
  /** The separator before this group: '' for the first. */
  readonly before: string
}

function splitRun(raw: string, offset: number): Group[] {
  const groups: Group[] = []
  let at = 0
  let opens = true
  let before = ''
  // "(02) 123 4567", and "(+662) 123 4567", whose run starts at the plus.
  let areaCode = raw.startsWith('(') || raw.startsWith('+')
  for (const sep of raw.matchAll(SEPARATOR)) {
    pushGroup(groups, raw, offset, at, sep.index, opens, before)
    at = sep.index + sep[0].length
    if (sep[0].startsWith(')')) {
      opens = !areaCode
      areaCode = false
    } else {
      opens = opensValue(sep[0])
    }
    before = sep[0]
  }
  pushGroup(groups, raw, offset, at, raw.length, opens, before)
  return groups
}

function pushGroup(
  groups: Group[],
  raw: string,
  offset: number,
  from: number,
  to: number,
  opens: boolean,
  before: string,
): void {
  // A bracket or plus opening the first group is not one of its digits.
  let start = from
  while (start < to && !isAsciiDigit(raw[start] as string)) start++
  groups.push({
    digits: raw.slice(start, to),
    start: offset + start,
    end: offset + to,
    opens,
    before,
  })
}

/**
 * The most digits a number can be written with, 66 and a nine-digit national
 * number; and the fewest, a landline that lost its 0. Readings outside them
 * are not scored.
 */
const MAX_DIGITS = 11
const MIN_DIGITS = 8

/** How a date joins its parts: one dot, or one dash with nothing round it. */
function dateJoin(separator: string): string | null {
  if (separator === '.') return '.'
  return isBareDash(separator) ? '-' : null
}

function inRange(digits: string, min: number, max: number): boolean {
  const n = Number(digits)
  return n >= min && n <= max
}

/** Day, month, year (2 or 4 digits); or year, month, day. */
function isDate(a: string, b: string, c: string): boolean {
  if (b.length > 2 || !inRange(b, 1, 12)) return false
  if (a.length <= 2) return inRange(a, 1, 31) && (c.length === 2 || c.length === 4)
  return a.length === 4 && c.length <= 2 && inRange(c, 1, 31)
}

/** Hours and minutes, the way a Thai message writes a time: "10.00". */
function isTime(a: string, b: string): boolean {
  return a.length <= 2 && inRange(a, 0, 23) && b.length === 2 && inRange(b, 0, 59)
}

/**
 * Marks the groups of a run that are a date or a time, which no reading may
 * take part of. "15.08.2569 10.00" read as the phone 08.2569 10.00 at 0.99
 * with a cue, "09-08-2569 10.00" at 0.97 without (code review, 13 Oct). No
 * Thai number is grouped as either, so the shape decides; each must stand
 * alone, or "081.234.12.34" would hold a time.
 */
function datesAndTimes(groups: readonly Group[]): Uint8Array {
  const marked = new Uint8Array(groups.length)
  const digitsAt = (i: number) => (groups[i] as Group).digits
  const joinAt = (i: number) => (i < groups.length ? dateJoin((groups[i] as Group).before) : null)

  for (let i = 0; i < groups.length; i++) {
    const join = joinAt(i + 1)
    if (join === null || joinAt(i) === join) continue
    if (
      joinAt(i + 2) === join &&
      joinAt(i + 3) !== join &&
      isDate(digitsAt(i), digitsAt(i + 1), digitsAt(i + 2))
    ) {
      marked.fill(1, i, i + 3)
    } else if (join === '.' && joinAt(i + 2) !== '.' && isTime(digitsAt(i), digitsAt(i + 1))) {
      marked.fill(1, i, i + 2)
    }
  }
  return marked
}

function isLetterO(ch: string | undefined): boolean {
  return ch === 'O' || ch === 'o'
}

/**
 * Where the span of a number already found starts, once what was typed round
 * its digits is taken in. Never decides whether there is a number.
 *
 * A letter O typed for the leading 0: "O91-888-7777" was redacted as
 * "O" + token, leaving a stray letter that says what the number started with
 * (edge cases, 13 Oct). Taken only when the number was found without its 0 —
 * so a cue already made it a phone — and when the O starts a word. No run
 * becomes a phone because of an O: reading O as 0 would turn every "PO" and
 * "No" before an order number into a candidate, a product decision of 13 Oct.
 *
 * The bracket opening an area code, when the one closing it is in the span:
 * "(053) 123-456" was redacted as "(" + token. A bracket round the whole
 * number, "(0812345678)", closes after the span and stays out, like any
 * bracket round a value (decision, 13 Oct).
 *
 * A leading + is in the span already: it is part of how the number is dialled.
 */
function widen(text: string, start: number, end: number, prefix: Prefix): number {
  let at = start
  if (prefix === 'none' && text[at] !== '+' && isLetterO(text[at - 1])) {
    const before = text[at - 2]
    if (before === undefined || !(isAsciiLetter(before) || isAsciiDigit(before))) at--
  }
  if (text[at - 1] === '(' && text.slice(at, end).includes(')')) at--
  return at
}

interface Reading {
  readonly cued: boolean
  readonly asAccount: boolean
  /** Any account cue at all, read only for a run in the passbook's grouping. */
  readonly nearAccount: boolean
  readonly asReference: boolean
}

/** A number found, and whether a cue made it one: the next line of a list may borrow it. */
interface Scored {
  readonly candidate: Candidate
  readonly cued: boolean
}

/**
 * Scores groups `from` to `to` of one run as a single number, or returns null.
 *
 * The digits alone decide whether there is a number and how sure to be of it.
 * Only then is the span widened, by `widen`, to what was typed round them.
 */
function score(
  text: string,
  groups: readonly Group[],
  from: number,
  to: number,
  reading: (start: number, end: number) => Reading,
): Scored | null {
  const first = groups[from] as Group
  const last = groups[to - 1] as Group
  const plus = text[first.start - 1] === '+'
  const start = plus ? first.start - 1 : first.start
  const end = last.end
  if (!isIsolated(text, start, end, belongsToRun)) return null

  const slice = groups.slice(from, to)
  const digits = slice.map((g) => g.digits).join('')
  const prefix = prefixOf(plus ? '+' : '', digits)
  const national = toNationalForm(plus ? `+${digits}` : digits)
  const base = baseConfidence(national)
  if (base === null) return null

  const { cued, asAccount, nearAccount, asReference } = reading(start, end)
  const bare = prefix === 'none' || prefix === 'bare66'
  if (bare && (!cued || asReference)) return null

  let confidence: number
  if (bare) confidence = CONFIDENCE_BARE
  else if (cued) confidence = CONFIDENCE_WITH_CUE
  else {
    confidence = base
    if (text.slice(start, end).includes('.')) {
      const grouping = nationalGrouping(
        slice.map((g) => g.digits),
        prefix,
      )
      const shapes = national.length === 10 ? MOBILE_GROUPINGS : LANDLINE_GROUPINGS
      confidence -= PENALTY_DOT
      if (!shapes.includes(grouping)) confidence -= PENALTY_ODD_GROUPING
    }
  }

  const passbook = slice.map((g) => g.digits.length).join('-') === PASSBOOK_GROUPING
  const yields = (!cued && asAccount) || (passbook && nearAccount)

  // Rounded, so 0.95 - 0.02 reads 0.93 in an audit event and not 0.9299999999999999.
  return {
    candidate: {
      entity: 'PHONE',
      start: widen(text, start, end, prefix),
      end,
      confidence: Math.round(confidence * 100) / 100,
      detector: 'phone',
      ...(yields ? { yieldsTo: 'BANK_ACCOUNT' as const } : {}),
    },
    cued,
  }
}

export const phoneDetector: Detector = {
  id: 'phone',
  entities: ['PHONE'],

  detect(input: NormalisedText, ctx?: DetectContext): Candidate[] {
    const found: Candidate[] = []
    const text = input.text
    // The question decides between the two ten-digit readings when the answer
    // is only the number (D10.11): asked for an account, yield to it; asked for
    // a phone, count the question as the cue.
    const askedPhone = previousHasCue(text, ctx?.previous, PHONE_CUES)
    const askedAccount = !askedPhone && isAnswer(text, ctx?.previous) && namesAccount(ctx.previous)
    const askedReference = previousHasCue(text, ctx?.previous, REFERENCE_CUES)
    const askedNearAccount = answersAccountCue(text, ctx?.previous)
    // Where the last number found with a cue ends: the next line of a list
    // borrows the cue (`continuesList`).
    let listed = -1

    const reading = (start: number, end: number): Reading => {
      const window = contextWindow(text, start, end)
      return {
        cued: containsAny(window, PHONE_CUES) || askedPhone || continuesList(text, start, listed),
        asAccount: askedAccount || namesAccount(window),
        nearAccount: askedNearAccount || hasAccountCue(window),
        // A key that names a time, "ts=1760259091": a value, never a number to call.
        asReference:
          askedReference || containsAny(window, REFERENCE_CUES) || keyedAsTime(text, start),
      }
    }

    for (const m of text.matchAll(RUN)) {
      const groups = splitRun(m[0], m.index)
      const dated = datesAndTimes(groups)
      // Two numbers can share one run ("091 888 7777 089 123 4567"), and a run
      // can carry a stray group either side. Try the widest reading first, and
      // start a new number only where a separator allows one.
      let from = 0
      while (from < groups.length) {
        let taken: Scored | null = null
        let to = readingEnd(groups, from, MAX_DIGITS)
        let digits = digitsIn(groups, from, to)
        while (to > from && digits >= MIN_DIGITS) {
          if (!dated.subarray(from, to).includes(1)) {
            taken = score(text, groups, from, to, reading)
            if (taken !== null) break
          }
          to--
          digits -= (groups[to] as Group).digits.length
        }
        if (taken !== null) {
          found.push(taken.candidate)
          if (taken.cued) listed = taken.candidate.end
          from = to
        } else {
          from++
        }
        while (from < groups.length && !(groups[from] as Group).opens) from++
      }
    }

    return found
  },
}
