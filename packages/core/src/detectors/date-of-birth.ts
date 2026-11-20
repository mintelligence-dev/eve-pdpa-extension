import type { Candidate, DetectContext, Detector, NormalisedText } from '../types.js'
import { isAsciiDigit, isAsciiLetter } from './boundary.js'
import { type CueAt, continuesList, cueDistance, isAnswer } from './context.js'

/**
 * A date of birth: 12/05/2530, 12 พ.ค. 30, 12 พฤษภาคม พ.ศ. 2530, May 12, 1987,
 * 1987-05-12.
 *
 * A date is personal data only when it is someone's birthday, and chat is full
 * of dates that are not: the day a parcel ships, an appointment, a transfer, a
 * card's expiry. The shape cannot tell them apart. So, as for plates, every
 * real date is kept as a candidate and what stands round it decides how far it
 * is believed — a birth cue, the other side asking for one, an age-old year and
 * a name or an id nearby for; a shipping, payment or expiry word in front, a
 * time after it, a date range against. The score is the confidence, so the
 * policy's `minConfidence` is the dial: at the default 0.95 a date is hidden
 * only with a cue.
 *
 * Day and month are read in that order, as Thai writes them. A two-digit year,
 * or a day and month with no year, is taken only with a cue pressed against it:
 * alone it is too often a price, a score or a version. A year on its own
 * ("เกิดปี 2530") is not taken at all (decision-date-of-birth, 5 Nov).
 *
 * No clock is read. A detector that answers differently next year would make
 * tests and audit logs drift, so "an old year" is a fixed line, not an age.
 */

/** Thai months in every spelling a customer types, longest first so มีนาคม is read whole. */
const MONTHS_TH: readonly (readonly [string, number])[] = (
  [
    ['มกราคม', 1],
    ['กุมภาพันธ์', 2],
    ['มีนาคม', 3],
    ['เมษายน', 4],
    ['พฤษภาคม', 5],
    ['มิถุนายน', 6],
    ['กรกฎาคม', 7],
    ['สิงหาคม', 8],
    ['กันยายน', 9],
    ['ตุลาคม', 10],
    ['พฤศจิกายน', 11],
    ['ธันวาคม', 12],
    ['มกรา', 1],
    ['กุมภา', 2],
    ['มีนา', 3],
    ['เมษา', 4],
    ['พฤษภา', 5],
    ['มิถุนา', 6],
    ['กรกฎา', 7],
    ['สิงหา', 8],
    ['กันยา', 9],
    ['ตุลา', 10],
    ['พฤศจิกา', 11],
    ['ธันวา', 12],
    ['ม.ค.', 1],
    ['ก.พ.', 2],
    ['มี.ค.', 3],
    ['เม.ย.', 4],
    ['พ.ค.', 5],
    ['มิ.ย.', 6],
    ['ก.ค.', 7],
    ['ส.ค.', 8],
    ['ก.ย.', 9],
    ['ต.ค.', 10],
    ['พ.ย.', 11],
    ['ธ.ค.', 12],
    ['มีค', 3],
    ['เมย', 4],
    ['มิย', 6],
    ['พฤศ', 11],
    ['มค', 1],
    ['กพ', 2],
    ['พค', 5],
    ['กค', 7],
    ['สค', 8],
    ['กย', 9],
    ['ตค', 10],
    ['พย', 11],
    ['ธค', 12],
  ] as const
)
  .slice()
  .sort((a, b) => b[0].length - a[0].length)

const MONTHS_EN: readonly (readonly [string, number])[] = (
  [
    ['january', 1],
    ['february', 2],
    ['march', 3],
    ['april', 4],
    ['may', 5],
    ['june', 6],
    ['july', 7],
    ['august', 8],
    ['september', 9],
    ['october', 10],
    ['november', 11],
    ['december', 12],
    ['sept', 9],
    ['jan', 1],
    ['feb', 2],
    ['mar', 3],
    ['apr', 4],
    ['jun', 6],
    ['jul', 7],
    ['aug', 8],
    ['sep', 9],
    ['oct', 10],
    ['nov', 11],
    ['dec', 12],
  ] as const
)
  .slice()
  .sort((a, b) => b[0].length - a[0].length)

const escape = (s: string): string => s.replace(/[.]/g, '\\.')
const TH_ALT = MONTHS_TH.map(([m]) => escape(m)).join('|')
const EN_ALT = MONTHS_EN.map(([m]) => m).join('|')

/** The era written before a year: พ.ศ. 2530, ค.ศ.1987, พศ 2530. */
const ERA = String.raw`(?:(?<era>พ\.?\s?ศ\.?|ค\.?\s?ศ\.?)\s*)?`

/**
 * The shapes, each sticky so it is tried at one start index. Groups are named
 * so one reader serves them all. `sep` is captured and repeated, so 12/05-2530
 * is not a date.
 */
const SHAPES: readonly RegExp[] = [
  // 12/05/2530 · 1-5-30 · 12.05.2530 · 12 / 05 / 2530
  /(?<d>\d{1,2}) ?(?<sep>[/.\-]) ?(?<m>\d{1,2}) ?\k<sep> ?(?<y>\d{4}|\d{2})/y,
  // 12/5 with no year: only ever taken with a cue pressed against it
  /(?<d>\d{1,2})\/(?<m>\d{1,2})(?![/.\-]?\d)/y,
  // 12 เดือน 5 ปี 2530, as a form reads aloud
  new RegExp(
    String.raw`(?<d>\d{1,2})\s*เดือน\s*(?<m>\d{1,2})\s*ปี\s*${ERA}(?<y>\d{4}|\d{2})(?!\d)`,
    'y',
  ),
  // 1987-05-12 · 2530/05/12
  /(?<y>\d{4})(?<sep>[/.\-])(?<m>\d{1,2})\k<sep>(?<d>\d{1,2})/y,
  // 12 พ.ค. 2530 · 12 เดือนพฤษภาคม พ.ศ. 2530 · 12 พค 30 · 12 มีนา
  new RegExp(
    String.raw`(?<d>\d{1,2})\s*(?:เดือน\s*)?(?<mth>${TH_ALT})(?:\s*${ERA}(?<y>\d{4}|\d{2})(?!\d))?`,
    'y',
  ),
  // 12 May 1987 · 12th Jan 87 · 4-Jul-1991 · 12 May
  new RegExp(
    String.raw`(?<d>\d{1,2})(?:st|nd|rd|th)?[\s/\-]*(?<men>${EN_ALT})\.?(?![a-z])(?:[,\s/\-]*(?<y>\d{4}|\d{2})(?!\d))?`,
    'iy',
  ),
  // May 12, 1987 · May 12
  new RegExp(
    String.raw`(?<men>${EN_ALT})\.?\s+(?<d>\d{1,2})(?:st|nd|rd|th)?(?![\d])(?:,?\s*(?<y>\d{4}))?`,
    'iy',
  ),
]

/** A date read off the text: CE year (or null when none was written), month, day. */
export interface DateParts {
  readonly year: number | null
  readonly month: number
  readonly day: number
  /** The year was written with two digits, or not at all: taken only with a cue. */
  readonly weak: boolean
}

function monthOf(name: string, list: readonly (readonly [string, number])[]): number {
  const lower = name.toLowerCase()
  for (const [m, n] of list) if (m === lower) return n
  return 0
}

/**
 * A written year as a Gregorian one, or null when it cannot be a birth year.
 * Four digits: 2400–2600 is Buddhist era (−543), 1850–2100 Gregorian. Two digits:
 * Buddhist era 25xx, which is what a Thai customer means by "30", unless the era
 * is written as ค.ศ. or the month is English — then 19xx from 30, 20xx below.
 */
function yearOf(y: string, era: string | undefined, english: boolean): number | null {
  const n = Number(y)
  if (y.length === 4) {
    if (n >= 2400 && n <= 2600) return n - 543
    if (n >= 1850 && n <= 2100) return n
    return null
  }
  const gregorian = english || (era !== undefined && era.startsWith('ค'))
  if (gregorian) return n >= 30 ? 1900 + n : 2000 + n
  return 2500 + n - 543
}

function daysIn(month: number, year: number | null): number {
  if (month === 2) {
    if (year === null) return 29
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

interface Read {
  readonly parts: DateParts
  readonly length: number
}

/** The longest date that starts at `at`, or null. */
function readDate(text: string, at: number): Read | null {
  let best: Read | null = null
  for (const shape of SHAPES) {
    shape.lastIndex = at
    const m = shape.exec(text)
    if (m === null || m.groups === undefined) continue
    const g = m.groups
    const english = g.men !== undefined
    let month =
      g.m !== undefined
        ? Number(g.m)
        : english
          ? monthOf(g.men as string, MONTHS_EN)
          : monthOf(g.mth as string, MONTHS_TH)
    let day = Number(g.d)
    // Day first, as Thai writes it — unless the second number cannot be a
    // month and the first can: 12/31/1988 is only readable the American way.
    if (g.m !== undefined && month > 12 && day <= 12) [day, month] = [month, day]
    const year = g.y === undefined ? null : yearOf(g.y, g.era, english)
    if (g.y !== undefined && year === null) continue
    if (month < 1 || month > 12 || day < 1 || day > daysIn(month, year)) continue
    const weak = g.y === undefined || g.y.length === 2
    if (best === null || m[0].length > best.length) {
      best = { parts: { year, month, day, weak }, length: m[0].length }
    }
  }
  return best
}

/**
 * The one form every way of writing a date collapses to: ISO, Gregorian,
 * `1987-05-12`, or `--05-12` when no year was written. Null when `folded` is
 * not a whole date. For `canonicalValue` and the allowlist.
 */
export function dateOfBirthCanonical(folded: string): string | null {
  const text = folded.trim()
  const read = readDate(text, 0)
  if (read === null || read.length !== text.length) return null
  const { year, month, day } = read.parts
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return year === null ? `--${mm}-${dd}` : `${String(year).padStart(4, '0')}-${mm}-${dd}`
}

/** Evidence, in points out of 100, kept as integers like the plate's. */
const BASE = 30

/** A birth cue beside it, the other side asking for one, or a list a cue opened. */
const CUE_NEAR = 67

/** A birth cue earlier in the same message. */
const CUE_FAR = 55

/** A year no one books, ships or pays in: Gregorian 2008 or before. A fixed line, not an age. */
const OLD_YEAR = 20
const OLD_YEAR_LAST = 2008

/** A name, an age or an id earlier in the message: the date sits among who someone is. */
const IDENTITY_NEAR = 20

const TRANSACTION_BEFORE = -60
const TIME_AFTER = -40
const RANGE = -40

const REPORT_FROM = 50
const FAR = 150

/**
 * Birth cues. "เกิด" alone is also "happen" — เกิดเหตุ, เกิดปัญหา, อุบัติเหตุเกิดวันที่ —
 * so it counts only pressed against the date (`GLUED_CUE`) or in one of these
 * phrases that can only mean a birth.
 */
const CUES_TH: readonly string[] = [
  'วันเกิด',
  'ปีเกิด',
  'เดือนเกิด',
  'วันที่เกิด',
  'วดป.เกิด',
  'วดปเกิด',
  'ว/ด/ป เกิด',
  'ว/ด/ปเกิด',
  'ว.ด.ป.เกิด',
  'เกิดวัน',
  'เกิดปี',
  'เกิดเมื่อ',
]
const CUES_LATIN: readonly string[] = [
  'dob',
  'd.o.b',
  'date of birth',
  'birth date',
  'birthdate',
  'birthday',
  'born',
  'hbd',
]

/**
 * "เกิด" and "วันเกิด" that are not a person's birth, blanked before a cue is
 * looked for:
 *   - something that happened: "อุบัติเหตุเกิดเมื่อ", "รายการนี้เกิดเมื่อ",
 *     "วันที่เกิดรายการ", "เกิดเหตุ"
 *   - a hometown: "บ้านเกิด"
 *   - an animal: "ลูกหมาเกิด", "น้องแมวเกิด". Bare "แมว" or "นก" is left alone:
 *     both are nicknames, and a missed birthday costs more than a hidden kitten's.
 *   - a day being celebrated, not a date of birth: "งานวันเกิด", "ปาร์ตี้วันเกิด",
 *     "สิทธิ์วันเกิด", "วันเกิดบริษัท"
 *   - said not to be one: "ไม่ใช่วันเกิด"
 */
const NOT_A_BIRTH =
  /(?:เหตุ|อุบัติ|ปัญหา|เรื่อง|ความเสียหาย|ข้อผิดพลาด|อาการ|ไฟไหม้|รายการ|ธุรกรรม|สุนัข|สัตว์เลี้ยง|น้องหมา|น้องแมว|ลูกหมา|ลูกแมว)\S{0,6}เกิด|เกิด(?:รายการ|ธุรกรรม|ขึ้น|เหตุ|ปัญหา|การ|ความ|ข้อ|อุบัติ|ไฟ|อาการ)|บ้านเกิด|ไม่ใช่(?:วัน)?เกิด|(?:งาน|ปาร์ตี้|ฉลอง|จัด|เลี้ยง|สิทธิ์|สิทธิ|โปร|ของขวัญ)วันเกิด|วันเกิด(?:บริษัท|ร้าน|เพจ|แบรนด์|สาขา|ห้าง|โรงเรียน)/g

/** The text with every `NOT_A_BIRTH` blanked, so offsets stay where they were. */
function blankNotBirth(text: string): string {
  return text.replace(NOT_A_BIRTH, (s) => ' '.repeat(s.length))
}

/**
 * The cue pressed against the date: "เกิด 12/05/2530", "DOB: 12 May 1987",
 * "วันเกิด 12 พ.ค. 30". Here bare "เกิด" is enough — nothing happens on a date
 * typed straight after the verb with no "วันที่" — unless what came before it
 * was an event.
 */
const GLUED_CUE = new RegExp(
  String.raw`(?<!เหตุ|อุบัติ|ปัญหา|ขึ้น)(?:เกิด|dob|d\.o\.b\.?|date of birth|birth ?date|birthday|born(?: on)?)(?:วันที่|เมื่อ|วัน|ปี)?[\s:：=\-]*(?:(?:คือ|เป็น|ว่า|วันที่|ที่|on)[\s:：=\-]*)?$`,
)

/** A field name such as birth_date reads as its words. */
function locateCue(window: string): CueAt[] {
  const w = blankNotBirth(window).replace(/_/g, ' ')
  const found: CueAt[] = []
  for (const c of CUES_TH)
    for (let at = w.indexOf(c); at !== -1; at = w.indexOf(c, at + 1))
      found.push([at, at + c.length])
  for (const c of CUES_LATIN) {
    for (let at = w.indexOf(c); at !== -1; at = w.indexOf(c, at + 1)) {
      if (!isAsciiLetter(w[at - 1] ?? '') && !isAsciiLetter(w[at + c.length] ?? ''))
        found.push([at, at + c.length])
    }
  }
  return found
}

function hasCue(window: string): boolean {
  return locateCue(window.toLowerCase()).length > 0
}

/**
 * Words that put a date on a transaction, an appointment or a document, in
 * front of it within the same clause: "ส่งของวันที่", "นัดวันที่", "หมดอายุ".
 * Substrings, so จัดส่ง and ส่งของ are both ส่ง.
 */
const TRANSACTION_WORDS: readonly string[] = [
  'ส่ง',
  'นัด',
  'โอน',
  'ชำระ',
  'จ่าย',
  'ภายใน',
  'กำหนด',
  'หมดอายุ',
  'หมดเขต',
  'ออกบัตร',
  'วันออก',
  'วันที่ออก',
  'ออกให้',
  'เข้าพัก',
  'เช็คอิน',
  'เช็กอิน',
  'เช็คเอาท์',
  'จอง',
  'ยกเลิก',
  'สั่งซื้อ',
  'สั่ง',
  'ซื้อ',
  'เริ่ม',
  'สิ้นสุด',
  'ทำรายการ',
  'อัปเดต',
  'อัพเดท',
  'เหตุ',
  'อุบัติ',
  'เคลม',
  'ซ่อม',
  'เปิดบัญชี',
  'สมัคร',
  'คุ้มครอง',
  'ถึง',
  'ใช้ได้',
  'exp',
  'due',
  'ship',
  'deliver',
  'order',
  'paid',
  'issue',
  'valid',
  'check-in',
  'check in',
]

/** How far back a transaction word still governs the date: a short clause. */
const CLAUSE = 20

/** A time after the date: "12/05/2569 14:30", "12 พ.ค. เวลา 9.00 น.". */
const TIME = /^\s*(?:เวลา\s*)?\d{1,2}[:.]\d{2}|^\s*(?:เวลา\s*)?\d{1,2}\s*น\./

/** A range, before or after: "1–5 พ.ค.", "12/05 ถึง 15/05", "from … to …". */
const RANGE_AFTER = /^\s*(?:[-–—~]|ถึง|to|until|จนถึง)\s*\d/i
const RANGE_BEFORE = /\d\s*(?:[-–—~]|ถึง|to|until|จนถึง)\s*$/i

/** Who someone is: the date is among their particulars. */
const IDENTITY_WORDS: readonly string[] = [
  'ชื่อ',
  'นามสกุล',
  'อายุ',
  'บัตรประชาชน',
  'เลขบัตร',
  'ผู้เอาประกัน',
  'ผู้ป่วย',
  'คนไข้',
  'สมาชิก',
  'name',
  'age',
  'patient',
]

function clauseBefore(text: string, start: number): string {
  let from = start
  while (from > 0 && start - from < CLAUSE && !/[\n.!?]/.test(text[from - 1] as string)) from--
  return text.slice(from, start).toLowerCase()
}

/** The most a label may take between two dates on one line: "แม่ ", " น้องคนเล็ก ". */
const INLINE_GAP = 20

/**
 * True when the date at `start` follows, on the same line, one found with a cue,
 * and only a short label stands between: "วันเกิด พ่อ 3/7/2501 แม่ 15/1/2504
 * น้อง 22/9/2555". The cue opened the list; each label is a person, not a new
 * subject — unless it is a transaction word.
 */
function continuesLine(text: string, start: number, previousEnd: number): boolean {
  if (previousEnd < 0 || start - previousEnd > INLINE_GAP) return false
  const gap = text.slice(previousEnd, start)
  if (/[\d\n]/.test(gap)) return false
  const lower = gap.toLowerCase()
  return !TRANSACTION_WORDS.some((w) => lower.includes(w))
}

export const dateOfBirthDetector: Detector = {
  id: 'date-of-birth',
  entities: ['DATE_OF_BIRTH'],

  detect(input: NormalisedText, ctx?: DetectContext): Candidate[] {
    const { text } = input
    const found: Candidate[] = []
    let lastCuedEnd = -1
    const previousAsks = isAnswer(text, ctx?.previous) && hasCue(ctx.previous as string)

    for (let at = 0; at < text.length; at++) {
      const before = at > 0 ? (text[at - 1] as string) : ''
      // Inside a longer number or word: the 2 of 12/05, the y of "Today".
      if (isAsciiDigit(before) || isAsciiLetter(before)) continue
      if (/[/.\-:]/.test(before) && isAsciiDigit(text[at - 2] ?? '')) continue
      const read = readDate(text, at)
      if (read === null) continue
      const start = at
      const end = at + read.length
      const after = text[end] ?? ''
      if (isAsciiDigit(after)) continue
      if (/[/.\-:]/.test(after) && isAsciiDigit(text[end + 1] ?? '')) continue
      if (isAsciiLetter(after) && isAsciiLetter(text[end - 1] ?? '')) continue

      const lead = text
        .slice(Math.max(0, start - 30), start)
        .toLowerCase()
        .replace(/_/g, ' ')
      const glued = GLUED_CUE.test(blankNotBirth(lead))
      const near =
        glued ||
        Number.isFinite(cueDistance(text, start, end, locateCue)) ||
        previousAsks ||
        continuesList(text, start, lastCuedEnd) ||
        continuesLine(text, start, lastCuedEnd)

      // A two-digit year or no year: a price, a score, "12 มีนา" for a meeting.
      // Only a cue right there makes it a birthday.
      if (read.parts.weak && !near) continue

      let points = BASE
      if (near) points += CUE_NEAR
      else if (hasCue(text.slice(Math.max(0, start - FAR), start))) points += CUE_FAR

      const { year } = read.parts
      if (year !== null && year <= OLD_YEAR_LAST) points += OLD_YEAR
      const earlier = text.slice(Math.max(0, start - FAR), start).toLowerCase()
      if (IDENTITY_WORDS.some((w) => earlier.includes(w))) points += IDENTITY_NEAR

      const clause = clauseBefore(text, start)
      if (TRANSACTION_WORDS.some((w) => clause.includes(w))) points += TRANSACTION_BEFORE
      // A birth time is written after a birth date ("เกิด 9 ม.ค. 2566 เวลา 08.45 น."),
      // so a time argues against the date only when no cue argues for it.
      if (!near && TIME.test(text.slice(end, end + 16))) points += TIME_AFTER
      if (
        RANGE_AFTER.test(text.slice(end, end + 10)) ||
        RANGE_BEFORE.test(text.slice(Math.max(0, start - 10), start))
      ) {
        points += RANGE
      }

      if (points < REPORT_FROM) continue

      found.push({
        entity: 'DATE_OF_BIRTH',
        start,
        end,
        confidence: Math.min(100, points) / 100,
        detector: 'date-of-birth',
      })
      if (near) lastCuedEnd = end
      at = end - 1
    }

    return found
  },
}
