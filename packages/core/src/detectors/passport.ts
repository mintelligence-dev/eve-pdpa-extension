import type { Candidate, DetectContext, Detector, NormalisedText } from '../types.js'
import { isAsciiDigit, isAsciiLetter } from './boundary.js'
import { type CueAt, continuesList, cueDistance, isAnswer, ownWindow } from './context.js'

/**
 * A passport number: AA1234567, AA 1234567, AA-1234567.
 *
 * Two Latin letters and seven digits is the one Thai format there is evidence
 * for — the specimen in a Department of Employment PDF reads AA4417685. Older
 * and emergency passports exist (the EU's PRADO register lists them) but nothing
 * says how their numbers are written, so no other Thai shape is guessed at
 * (docs: thai-passport-extraction-proof, decision-passport, 13 Nov).
 *
 * There is no check digit in the number itself, only in the MRZ, and the same
 * shape is a parcel code, a SKU, a booking reference. So, as for plates and
 * dates of birth, every run of the shape is a candidate and what stands round it
 * decides: a passport cue for it; a parcel, order, document or staff word
 * against. With no cue the number is still reported, at 0.6 — the "review"
 * band, under the default 0.95, where a policy can reach it on purpose, as it
 * can an unknown card issuer.
 *
 * A foreign passport (a hotel, a tour, a visa form) has no one shape. Six to
 * nine letters and digits, with at least five digits and either a letter or
 * eight digits, is taken — but only with a cue pressed against it, since that
 * shape is everything else in a chat too.
 *
 * Look-alike characters are never corrected: O for 0, B for 8, S for 5. The
 * Ministry of Foreign Affairs warns that people confuse them, which is the
 * reason not to guess which one was meant.
 */
/**
 * Up to two separators between letters and digits — a space, a dash of any
 * width, a dot, an invisible character — and the seven digits whole or as
 * three and four: AA 1234567, AA–1234567, AA.1234567, AA 123 4567.
 */
const THAI = /([A-Za-z]{2})[\s\p{Cf}.\-‐-―−－]{0,2}(\d{3} ?\d{4})/uy

/** "No.1234567" is a label and a number, not a passport. */
const LABEL_LETTERS = new Set(['no'])

/**
 * Characters a digit is mistaken for. One of them alone among the digits is a
 * mistyped Thai number (AB12O4567), which is never corrected and so is no
 * passport; a foreign number mixes letters and digits more freely (C4J9R7TX2).
 */
const LOOK_ALIKE = new Set(['O', 'I', 'S', 'B', 'Z', 'L', 'Q', 'D', 'G'])

const FOREIGN = /[A-Za-z0-9]{6,9}/y

/** Evidence, in points out of 100, kept as integers like the plate's. */
const THAI_BASE = 60
const FOREIGN_BASE = 40

/** A cue beside it, the other side asking for one, or a list a cue opened. */
const CUE_NEAR = 60

/** A cue earlier in the same message. */
const CUE_FAR = 45

/** Travel or identity words earlier in the message: a visa, a flight, a nationality. */
const TRAVEL = 15

/** A parcel, an order, a document or a staff number named beside it. */
const NOT_A_PASSPORT = -60

/** A bill, a product, a device or a Wi-Fi password: not reported at all. */
const NEVER_A_PASSPORT = -100

const REPORT_FROM = 50
const FAR = 150

/**
 * Passport cues. Bare "พาส" is also "pass" (พาสแล้ว) and the front of
 * "พาสเวิร์ด", so it counts only pressed against the number (`GLUED_CUE`) or as
 * "เลขพาส".
 */
const CUES_TH: readonly string[] = [
  'พาสปอร์ต',
  'พาสปอต',
  'พาสปอท',
  'พาสปอด',
  'พาสสปอร์ต',
  'พาสปอร์ท',
  'พาสสปอร์ท',
  'หนังสือเดินทาง',
  'เลขพาส',
  'เล่มพาส',
  '护照',
]
const CUES_LATIN: readonly string[] = [
  'passport',
  'pasport',
  'pass port',
  'pp no',
  'pp number',
  'pp#',
]

/** A password is not a passport: blanked before a cue is looked for. */
const PASSWORD = /พาสเวิร์ด|พาสเวิด|password/g

function blankPassword(text: string): string {
  return text.replace(PASSWORD, (s) => ' '.repeat(s.length))
}

/** The other side said the number is not needed: "ไม่ต้องส่งเลขมาล่วงหน้า". */
const NOT_NEEDED = /ไม่ต้อง\S{0,8}เลข|no need|not need|don't need/

/**
 * The cue pressed against the number: "พาส AA1234567", "passport no. AA1234567",
 * "หนังสือเดินทางเลขที่ AA1234567".
 */
const GLUED_CUE =
  /(?:พาส(?:ส?ปอ(?:ร์)?[ตทด])?|หนังสือเดินทาง|护照(?:号码|号)?|(?<![a-z])pass ?port|(?<![a-z])pasport|(?<![a-z])pp)(?:[\s.]*(?:no\.?|number|num|#|เลขที่|เลข|หมายเลข|คือ|ของ\S{0,12}))?[\s:：=#\-]*$/

function locateCue(window: string): CueAt[] {
  const w = blankPassword(window)
  const found: CueAt[] = []
  for (const c of CUES_TH) {
    for (let at = w.indexOf(c); at !== -1; at = w.indexOf(c, at + 1))
      found.push([at, at + c.length])
  }
  for (const c of CUES_LATIN) {
    for (let at = w.indexOf(c); at !== -1; at = w.indexOf(c, at + 1)) {
      if (!isAsciiLetter(w[at - 1] ?? '') && !isAsciiLetter(w[at + c.length] ?? '')) {
        found.push([at, at + c.length])
      }
    }
  }
  return found
}

function hasCue(window: string): boolean {
  return locateCue(window.toLowerCase()).length > 0
}

/** How far after the number a cue still names it: "AR1234567 คือเลขหนังสือเดินทางของลูก". */
const AFTER = 30

/** A cue after the number, before any other number: the sentence goes on to say what it was. */
function cueAfter(text: string, end: number): boolean {
  let to = end
  while (to < text.length && to - end < AFTER && !isAsciiDigit(text[to] as string)) to++
  return hasCue(text.slice(end, to))
}

/**
 * A number word pressed against the number, with a cue earlier in the same
 * stretch: "พาสปอร์ตสามีเป็นอเมริกันค่ะ เลข 493018275". The cue names the
 * document, the number word hands over to its number.
 */
const NUMBER_WORD = /(?:เลข(?:ที่)?|หมายเลข|number|no\.?|#|号码)[\s:：=#\-]*$/
const CLAUSE = 60

/**
 * Words that name what else the shape is, read in the number's own window on
 * either side: "เลขพัสดุ AB1234567", "AB1234567 (booking ref)". A passport cue
 * pressed against the number outweighs them — a hotel asks for the passport
 * and the booking in one breath.
 */
const NOT_A_PASSPORT_WORDS: readonly string[] = [
  'เลขจอง',
  'รหัสจอง',
  'พัสดุ',
  'tracking',
  'แทรค',
  'แทร็ก',
  'ออเดอร์',
  'order',
  'คำสั่งซื้อ',
  'รหัสสินค้า',
  'สินค้า',
  'sku',
  'booking',
  'บุ๊คกิ้ง',
  'การจอง',
  'ref',
  'อ้างอิง',
  'เลขที่เอกสาร',
  'รหัสพนักงาน',
  'employee',
  'รหัสสมาชิก',
  'member',
  'model',
  'เที่ยวบิน',
  'flight',
  'กรุ๊ป',
  'group',
]

/**
 * Words that say the number belongs to something else even with a passport
 * word right before it: the bill for making a passport, a passport cover's
 * product code, the scanner's serial, the Wi-Fi password the hotel calls "พาส".
 * Read up to `CLAUSE` characters back and in the number's own window after it.
 */
const NEVER_A_PASSPORT_WORDS: readonly string[] = [
  'invoice',
  'ใบแจ้งหนี้',
  'ใบเสร็จ',
  'ใบกำกับ',
  'receipt',
  'ค่าธรรมเนียม',
  'ค่าบริการ',
  'fee',
  'ไวไฟ',
  'wifi',
  'wi-fi',
  's/n',
  'serial',
  'ซีเรียล',
  'รหัส',
  'ปกพาส',
  'ปกหนังสือเดินทาง',
  'cover',
  'เครื่องสแกน',
  'เครื่องอ่าน',
  'scanner',
  'reader',
]

/** Words that put the number among someone's travel or identity details. */
const TRAVEL_WORDS: readonly string[] = [
  'วีซ่า',
  'visa',
  'ตั๋ว',
  'บินไป',
  'เดินทาง',
  'เช็คอิน',
  'เช็กอิน',
  'check-in',
  'check in',
  'สัญชาติ',
  'nationality',
  'ต่างชาติ',
  'ชื่อ',
  'name',
]

/** Money after it: "ค่าทำพาสปอร์ต 150000 บาท" is a price, not a number. */
const AMOUNT_AFTER = /^\s*(?:บาท|baht|฿|thb|usd)/i

function digitCount(s: string): number {
  let n = 0
  for (const ch of s) if (isAsciiDigit(ch)) n++
  return n
}

export const passportDetector: Detector = {
  id: 'passport',
  entities: ['PASSPORT'],

  detect(input: NormalisedText, ctx?: DetectContext): Candidate[] {
    const { text } = input
    const found: Candidate[] = []
    let lastCuedEnd = -1
    const previous = ctx?.previous
    const asked = previous === undefined ? '' : blankPassword(previous.toLowerCase())
    const previousNames = hasCue(asked) && !NOT_NEEDED.test(asked)
    // A short reply answers whatever was asked; a longer one — a list of
    // travellers with names and phone numbers — still answers it with every
    // Thai-shaped number in it.
    const previousAsks = isAnswer(text, previous) && previousNames

    for (let at = 0; at < text.length; at++) {
      const before = at > 0 ? (text[at - 1] as string) : ''
      // Inside a longer code: the second half of EX123456789TH, KEX1234567.
      if (isAsciiDigit(before) || isAsciiLetter(before)) continue

      THAI.lastIndex = at
      const thai = THAI.exec(text)
      let end = -1
      let thaiShape = false
      if (thai !== null) {
        end = at + thai[0].length
        thaiShape = !isAsciiDigit(text[end] ?? '') && !isAsciiLetter(text[end] ?? '')
      }
      if (!thaiShape) {
        FOREIGN.lastIndex = at
        const foreign = FOREIGN.exec(text)
        if (foreign === null) continue
        end = at + foreign[0].length
        if (isAsciiDigit(text[end] ?? '') || isAsciiLetter(text[end] ?? '')) continue
        const digits = digitCount(foreign[0])
        const letters = foreign[0].length - digits
        if (digits < 5 || (letters === 0 && digits < 8)) continue
        const firstDigit = foreign[0].search(/\d/)
        const lettersAmongDigits = foreign[0].slice(firstDigit).replace(/\d/g, '').toUpperCase()
        if (lettersAmongDigits.length === 1 && LOOK_ALIKE.has(lettersAmongDigits)) continue
      } else if (LABEL_LETTERS.has((thai?.[1] ?? '').toLowerCase())) {
        continue
      }
      const start = at

      const lead = blankPassword(text.slice(Math.max(0, start - 40), start).toLowerCase())
      const glued = GLUED_CUE.test(lead)
      const clause = blankPassword(text.slice(Math.max(0, start - CLAUSE), start).toLowerCase())
      const near =
        glued ||
        Number.isFinite(cueDistance(text, start, end, locateCue)) ||
        cueAfter(text, end) ||
        (NUMBER_WORD.test(clause) && hasCue(clause)) ||
        previousAsks ||
        (previousNames && thaiShape) ||
        continuesList(text, start, lastCuedEnd)

      // A foreign shape is anything at all without a cue right there.
      if (!thaiShape && !near) continue

      let points = thaiShape ? THAI_BASE : FOREIGN_BASE
      if (near) points += CUE_NEAR
      else if (hasCue(text.slice(Math.max(0, start - FAR), start))) points += CUE_FAR

      const earlier = text.slice(Math.max(0, start - FAR), start).toLowerCase()
      if (TRAVEL_WORDS.some((w) => earlier.includes(w))) points += TRAVEL

      const own = blankPassword(ownWindow(text, start, end))
      if (!glued && NOT_A_PASSPORT_WORDS.some((w) => own.includes(w))) points += NOT_A_PASSPORT
      const around = `${clause} ${own}`
      if (NEVER_A_PASSPORT_WORDS.some((w) => around.includes(w))) points += NEVER_A_PASSPORT
      if (AMOUNT_AFTER.test(text.slice(end, end + 8))) points += NOT_A_PASSPORT

      if (points < REPORT_FROM) continue

      found.push({
        entity: 'PASSPORT',
        start,
        end,
        confidence: Math.min(100, points) / 100,
        detector: 'passport',
      })
      if (near) lastCuedEnd = end
      at = end - 1
    }

    return found
  },
}
