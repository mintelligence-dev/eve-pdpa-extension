import type { Candidate, DetectContext, Detector, NormalisedText } from '../types.js'
import { isAsciiDigit, isAsciiLetter } from './boundary.js'
import { containsAny, containsWord, ownWindow, previousHasCue } from './context.js'

/**
 * A Thai plate: an optional series digit, one to three consonants, then one to
 * four digits. กข 1234, 1กข 2345, นข-5678, ฒค 9.
 *
 * The shape alone proves nothing. Thai is written without spaces and a consonant
 * followed by a number is ordinary text: "ขอ 2 ชุด", "ครบ 5 ปี", "รวม 3500 บาท",
 * "จอง 2 เชียงใหม่". So every run that has the shape is kept as a candidate, and
 * what stands round it decides how far it is believed — a cue word, the other
 * side's question, a province after it for; a count word, an amount, a room or a
 * table in front, an everyday word for the letters against. This is the scoring
 * the other weak entities will need, written out once here: D-plate.
 *
 * The score is read as a confidence, so the policy's `minConfidence` is the dial.
 * At the default 0.95 a plate is acted on only when a cue says so and nothing
 * argues against it; at 0.7 it is also found by its province and its four digits,
 * and the negative signals are what keep "จอง 2 เชียงใหม่" out.
 *
 * The province printed under the number is part of the plate, and is taken into
 * the span when it follows: "กข 1234 ชลบุรี" is one value. Leaving it would be a
 * partial find, which D5 counts as a miss.
 */
const PLATE = /[1-9]?(?:[ก-ฮ]{1,3}|[ก-ฮ]\s[ก-ฮ])[\s\p{Cf}\-‐-―−－]{0,2}[0-9]{1,4}/uy

/**
 * 76 of the 77 provinces, as a plate prints them, and the spellings a customer
 * types for Bangkok and Ayutthaya. Names of places, not a dictionary of people: there
 * is nothing here to license (data/LICENCES.md).
 *
 * "เลย" is left out. It is a province and also "at all" and "already", and a
 * customer who writes "กข 1234 เลยค่ะ" means the second. A Loei plate keeps its
 * province showing; the number is still hidden.
 */
const PROVINCES: readonly string[] = [
  'กระบี่',
  'กรุงเทพมหานคร',
  'กรุงเทพฯ',
  'กรุงเทพ',
  'กทม.',
  'กทม',
  'กาญจนบุรี',
  'กาฬสินธุ์',
  'กำแพงเพชร',
  'ขอนแก่น',
  'จันทบุรี',
  'ฉะเชิงเทรา',
  'ชลบุรี',
  'ชัยนาท',
  'ชัยภูมิ',
  'ชุมพร',
  'เชียงราย',
  'เชียงใหม่',
  'ตรัง',
  'ตราด',
  'ตาก',
  'นครนายก',
  'นครปฐม',
  'นครพนม',
  'นครราชสีมา',
  'นครศรีธรรมราช',
  'นครสวรรค์',
  'นนทบุรี',
  'นราธิวาส',
  'น่าน',
  'บึงกาฬ',
  'บุรีรัมย์',
  'ปทุมธานี',
  'ประจวบคีรีขันธ์',
  'ปราจีนบุรี',
  'ปัตตานี',
  'พระนครศรีอยุธยา',
  'อยุธยา',
  'พะเยา',
  'พังงา',
  'พัทลุง',
  'พิจิตร',
  'พิษณุโลก',
  'เพชรบุรี',
  'เพชรบูรณ์',
  'แพร่',
  'ภูเก็ต',
  'มหาสารคาม',
  'มุกดาหาร',
  'แม่ฮ่องสอน',
  'ยโสธร',
  'ยะลา',
  'ร้อยเอ็ด',
  'ระนอง',
  'ระยอง',
  'ราชบุรี',
  'ลพบุรี',
  'ลำปาง',
  'ลำพูน',
  'ศรีสะเกษ',
  'สกลนคร',
  'สงขลา',
  'สตูล',
  'สมุทรปราการ',
  'สมุทรสงคราม',
  'สมุทรสาคร',
  'สระแก้ว',
  'สระบุรี',
  'สิงห์บุรี',
  'สุโขทัย',
  'สุพรรณบุรี',
  'สุราษฎร์ธานี',
  'สุรินทร์',
  'หนองคาย',
  'หนองบัวลำภู',
  'อ่างทอง',
  'อำนาจเจริญ',
  'อุดรธานี',
  'อุตรดิตถ์',
  'อุทัยธานี',
  'อุบลราชธานี',
].sort((a, b) => b.length - a.length)

/** Where the province ends, when one follows the number (with at most one space between). */
function provinceEnd(text: string, from: number): number {
  const at = text[from] !== undefined && /\s/.test(text[from] as string) ? from + 1 : from
  for (const name of PROVINCES) if (text.startsWith(name, at)) return at + name.length
  return from
}

/**
 * Evidence, in points out of 100 and kept as integers so no sum depends on how a
 * float rounds. The weights are reasoned, not tuned on real chats, like every
 * other confidence in core.
 */
const BASE = 30

/** A cue word beside it, the other side asking for one, or a list the cue already opened. */
const CUE_NEAR = 67

/** A cue earlier in the same message: it is about a plate, this may be that plate. */
const CUE_FAR = 55

const PROVINCE_AFTER = 30
const SERIES_DIGIT = 15
const FOUR_DIGITS = 10

const FEW_DIGITS = -15
const SINGLE_LETTER = -20
const YEAR_WITH_MONTH = -60
const WORD_LETTERS = -60
const AMOUNT = -30
const COUNT_AFTER = -30
const PLACE_BEFORE = -60

/** The cue is found at or above this much evidence; below it the run is not reported. */
const REPORT_FROM = 50

/** How far back a cue is still "earlier in the same message". */
const FAR = 150

/**
 * Words that name a plate. Thai cues are substrings: there is no space to find a
 * word edge in. "plate" is a word of its own, so "template" does not count.
 */
const CUES_TH: readonly string[] = ['ทะเบียน', 'ทบ.']
const CUES_LATIN: readonly string[] = ['plate']

/** "ทะเบียน" that is not about a vehicle. Taken out before the cue is looked for. */
const NOT_A_PLATE = /ทะเบียน(?:บ้าน|สมรส|การค้า|พาณิชย์|ราษฎร|นักเรียน|ประวัติ)|ลงทะเบียน|ไม่ใช่(?:ป้าย)?ทะเบียน/g

/**
 * The cue as it can stand pressed against the plate with nothing between, "ทะเบียนกข1234":
 * the left edge is then a Thai letter and the isolation test would refuse it. Longest
 * first, so "ทะเบียนรถ" is read whole and not as "ทะเบียน" followed by a word.
 */
const GLUED_CUE = new RegExp(
  `(?<!ลง|ไม่ใช่|ไม่ใช่ป้าย)(?:ทะเบียนรถยนต์|ทะเบียนรถจักรยานยนต์|ทะเบียนรถ|ทะเบียน|ทบ\\.|(?<![a-z])plate)[\\s:：=-]*(?:(?:คือ|เป็น|ว่า)[\\s:：=-]*)?$`,
)

/** What may stand between two plates that share one cue: "กข 1234 กับ ขค 5678". */
const LIST_GAP = /^(?:[\s,/&|;、]|และ|กับ|หรือ|แล้วก็)+$/

/**
 * Letter groups that are everyday words. Pure consonants and a number follow
 * them all the time: "ขอ 2 ชุด", "รวม 3500", "ครบ 5 ปี", "จอง 2 คืน", "ลด 50".
 */
const WORDS: ReadonlySet<string> = new Set([
  'รถ',
  'ของ',
  'คน',
  'ขอ',
  'รวม',
  'ครบ',
  'จด',
  'จอง',
  'ลด',
  'ยก',
  'จบ',
  'งด',
  'ออก',
])

/**
 * Month abbreviations as Thai writes them in a date, "12 สค 2568": two consonants
 * that are a month and a year after them. Only read as a month when the number is
 * a year, so a plate that happens to share the letters is still a plate.
 */
const MONTHS: ReadonlySet<string> = new Set(['มค', 'กพ', 'พค', 'กค', 'สค', 'กย', 'ตค', 'พย', 'ธค'])

/** A Buddhist-era (24xx to 26xx) or Gregorian (19xx, 20xx) year. */
function looksLikeYear(digits: string): boolean {
  if (digits.length !== 4) return false
  const n = Number(digits)
  return (n >= 2400 && n <= 2699) || (n >= 1900 && n <= 2099)
}

/** Money words: no plate is followed by one. */
const MONEY_AFTER: readonly string[] = ['บาท', 'baht', 'บ.']

/**
 * A count word right after a one- or two-digit number: "2 ชุด", "5 ปี", "3 คืน".
 * Not checked after four digits, where "กข 1234 ปี 2563" is a plate and its year.
 */
const COUNT_AFTER_WORDS: readonly string[] = [
  'ชุด',
  'คืน',
  'ใบ',
  'ชิ้น',
  'วัน',
  'เดือน',
  'ครั้ง',
  'เล่ม',
  'อัน',
  'ปี',
  'คัน',
  'คน',
  'ท่าน',
  'ราย',
  'ที่',
  'ห้อง',
  'โต๊ะ',
]

/** Words that name a place or a position, in front of the letters: "ห้อง ก 12", "แถว ข 3". */
const PLACE_BEFORE_WORDS: readonly string[] = [
  'ห้อง',
  'ชั้น',
  'โต๊ะ',
  'ออเดอร์',
  'order',
  'เลขที่',
  'แถว',
  'ตู้',
  'ที่นั่ง',
  'คิว',
  'ลำดับ',
  'ล็อก',
  'ยูนิต',
  'บูธ',
  'ช่อง',
]

/** U+0E00 to U+0E7F: a Thai letter, vowel, tone mark or digit. */
function isThai(ch: string): boolean {
  return ch >= '฀' && ch <= '๿'
}

function belongsBefore(ch: string): boolean {
  return isThai(ch) || isAsciiDigit(ch) || isAsciiLetter(ch)
}

function belongsAfter(ch: string): boolean {
  return isAsciiDigit(ch) || isAsciiLetter(ch)
}

function lettersOf(match: string): string {
  let out = ''
  for (const ch of match) if (ch >= 'ก' && ch <= 'ฮ') out += ch
  return out
}

function digitsOf(match: string): number {
  let n = 0
  for (const ch of match) if (isAsciiDigit(ch)) n++
  return n
}

/** True when `text` opens with one of `words`, after at most one space. */
function opensWith(text: string, from: number, words: readonly string[]): boolean {
  const at = text[from] !== undefined && /\s/.test(text[from] as string) ? from + 1 : from
  const rest = text.slice(at, at + 8).toLowerCase()
  return words.some((w) => rest.startsWith(w))
}

/** True when `text` ends, before `to`, with one of `words`, after at most one space. */
function endsWithWord(text: string, to: number, words: readonly string[]): boolean {
  const before = text
    .slice(Math.max(0, to - 12), to)
    .replace(/\s$/, '')
    .toLowerCase()
  return words.some((w) => before.endsWith(w))
}

function hasCue(window: string): boolean {
  const w = window.replace(NOT_A_PLATE, '')
  return containsAny(w, CUES_TH) || containsWord(w, CUES_LATIN)
}

export const licensePlateDetector: Detector = {
  id: 'license-plate',
  entities: ['LICENSE_PLATE'],

  detect(input: NormalisedText, ctx?: DetectContext): Candidate[] {
    const { text } = input
    const found: Candidate[] = []
    /** End of the last plate found with a cue beside it, for "กข 1234 กับ ขค 5678". */
    let lastCuedEnd = -1

    // Every start is tried, not only the ones after the last match. Thai has no
    // space to begin at, so the last letter of a word is a consonant that can
    // open a match on its own — the น of ทะเบียน in "ทะเบียน 1กข 2345" reads "น 1"
    // — and a match that is refused must not use up the characters of the one
    // behind it.
    for (let at = 0; at < text.length; at++) {
      PLATE.lastIndex = at
      const m = PLATE.exec(text)
      if (m === null) continue
      const start = at
      const numberEnd = start + m[0].length

      // A number run the match stopped inside: the fifth digit of กข 12345.
      const after = numberEnd < text.length ? text[numberEnd] : undefined
      if (after !== undefined && belongsAfter(after)) continue
      // Or inside a number written with a group or a decimal point: the 1 of 1,500.
      if ((after === ',' || after === '.') && isAsciiDigit(text[numberEnd + 1] ?? '')) continue
      // Or the number of a grade or a rate: ป 2+, 5%.
      if (after === '+' || after === '%') continue

      const before = start > 0 ? text[start - 1] : undefined
      const glued = GLUED_CUE.test(text.slice(Math.max(0, start - 30), start).toLowerCase())
      if (before !== undefined && belongsBefore(before) && !glued) continue

      const end = provinceEnd(text, numberEnd)
      const series = /^[1-9]/.test(m[0])
      const digits = digitsOf(series ? m[0].slice(1) : m[0])
      const letters = lettersOf(m[0])

      let points = BASE

      // A short message that is the answer to "ทะเบียนรถอะไรคะ" carries no cue of
      // its own; the other side's last message does (D10.11).
      const near =
        glued ||
        hasCue(ownWindow(text, start, end)) ||
        previousHasCue(text, ctx?.previous, CUES_TH, CUES_LATIN) ||
        (lastCuedEnd >= 0 &&
          start - lastCuedEnd <= 10 &&
          LIST_GAP.test(text.slice(lastCuedEnd, start)))
      if (near) points += CUE_NEAR
      else if (hasCue(text.slice(Math.max(0, start - FAR), start).toLowerCase())) points += CUE_FAR

      // One or two digits are a plate only when something says so: with a cue
      // beside them they are (กจ 82, สส 5 are bought at auction), without one
      // they are far more often a quantity.
      if (digits <= 2 && !near) points += FEW_DIGITS
      if (end > numberEnd) points += PROVINCE_AFTER
      if (series) points += SERIES_DIGIT
      if (digits === 4) points += FOUR_DIGITS
      if (WORDS.has(letters) && !series) points += WORD_LETTERS
      if (letters.length === 1 && !series && !near) points += SINGLE_LETTER
      if (MONTHS.has(letters) && looksLikeYear(m[0].replace(/\D/g, ''))) points += YEAR_WITH_MONTH
      if (opensWith(text, numberEnd, MONEY_AFTER)) points += AMOUNT
      if (digits <= 2 && opensWith(text, numberEnd, COUNT_AFTER_WORDS)) points += COUNT_AFTER
      if (endsWithWord(text, start, PLACE_BEFORE_WORDS)) points += PLACE_BEFORE

      // Two letters set apart (ก ข 3092) are read only with a cue beside them: a
      // list of options, "ข้อ ก ข 3", has the same shape.
      if (/[ก-ฮ]\s[ก-ฮ]/.test(m[0]) && !near) continue

      if (points < REPORT_FROM) continue

      found.push({
        entity: 'LICENSE_PLATE',
        start,
        end,
        confidence: Math.min(100, points) / 100,
        detector: 'license-plate',
      })
      if (near) lastCuedEnd = end
      at = end - 1
    }

    return found
  },
}
