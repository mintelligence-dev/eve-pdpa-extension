import type { Candidate, DetectContext, Detector, NormalisedText } from '../types.js'
import { isAnswer, previousHasCue } from './context.js'
import { squeezing } from './squeeze.js'

/**
 * A person's name, found from what stands in front of it.
 *
 * No list of Thai names ships with core: one would have to be licensed for
 * commercial use (data/LICENCES.md), would be out of date the day it was
 * built, and could never hold every surname. So no name is recognised by being
 * a name. A name is claimed when the sentence introduces it:
 *
 *   a title      นาย, นาง, นางสาว, น.ส., เด็กชาย, ดร., นพ., Mr., Dr. …
 *   คุณ          the polite "you", and so beside nearly any name in a chat
 *   an intro     ผมชื่อ, ดิฉันชื่อ, my name is
 *   a label      ชื่อ, ชื่อ-นามสกุล, ชื่อผู้รับ, name:
 *   a question   the other side's last message asked for it, and this one is the answer
 *
 * Thai has no spaces between words and core has no word segmenter, so where a
 * name ends is a guess, and the guess is made to err on the side of hiding too
 * much. A name is a first name and, after one space, a surname. With no space
 * it runs until a word that cannot belong to a name (ค่ะ, ครับ, เบอร์, เลขที่ …)
 * or 30 characters. A surname that begins like one of the stop words in
 * TOKEN_STOPS is the one place the other way can happen, and is listed in the
 * README's known limitations.
 *
 * A name with no introduction ("สมชาย ใจดี โทรมาแล้ว") is not found. That is
 * what the optional NER package is for.
 */

/** Thai consonants, vowels and marks. The digits ๐-๙ are folded to ASCII before a detector reads. */
const THAI = '\\u0E01-\\u0E4E'

const isThai = (ch: string | undefined): boolean => ch !== undefined && /[ก-๎]/.test(ch)

/** A name begins on a consonant or a vowel written before one (เ แ โ ใ ไ). */
const isNameStart = (ch: string | undefined): boolean => ch !== undefined && /[ก-ฮเ-ไ]/.test(ch)

/** Marks that sit on the letter before them: never the place to stop. */
const isMark = (ch: string | undefined): boolean => ch !== undefined && /[ัิ-ฺ็-๎]/.test(ch)

/** The longest a first name or surname is read to be when nothing ends it sooner. */
const MAX_TOKEN = 30

/**
 * Words that end a name even when written right against it. Short and plain on
 * purpose: each is something no one is called. "คะ" and "นะ" are left out,
 * since คะนึง and นะรา are names; "นะคะ" and "นะครับ" are not.
 */
const GLUED_STOPS: readonly string[] = [
  'ค่ะ',
  'ครับ',
  'นะคะ',
  'นะครับ',
  'เบอร์',
  'โทร',
  'เลขบัตร',
  'เลขที่',
  'ที่อยู่',
  'อยากจะ',
  'ขอให้',
  'ขอเปลี่ยน',
  'ขอสอบถาม',
]

/**
 * Words that cannot be the start of a name written after a space: what a customer
 * says next. Not applied to the first name after a title, which is whatever
 * follows it.
 */
const TOKEN_STOPS: readonly string[] = [
  ...GLUED_STOPS,
  'เลข',
  'ขอ',
  'อยาก',
  'อยู่',
  'ใน',
  'โปรด',
  'กรุณา',
  'จัดส่ง',
  'กำลัง',
  'ต้อง',
  'ยัง',
  'เป็น',
  'ต้องการ',
  'และ',
  'แล้ว',
  'ที่',
  'ให้',
  'จะ',
  'ได้',
  'คะ',
  'นะ',
  'จ้า',
  'ค่า',
  'เพื่อ',
  'เนื่องจาก',
  'ซึ่ง',
  'หรือ',
  'แต่',
  'ด้วย',
  'ช่วย',
  'โอน',
  'สั่ง',
  'ซื้อ',
  'รบกวน',
  'สอบถาม',
  'เปลี่ยน',
  'ยกเลิก',
  'แจ้ง',
  'ตรวจ',
  'เช็ค',
  'ติดต่อ',
  'มือถือ',
  'อีเมล',
  'บัญชี',
  'พร้อมเพย์',
  'วันเกิด',
  'พาสปอร์ต',
  'ทะเบียน',
  'อายุ',
  'เพศ',
  'ลูกค้า',
  'ผู้',
]

function startsWithAny(text: string, at: number, words: readonly string[]): boolean {
  return words.some((w) => text.startsWith(w, at))
}

interface Read {
  readonly end: number
  readonly tokens: number
}

/**
 * Reads up to `max` name tokens from `from`: a first name, then after one
 * space a surname. Returns null when not even the first is there.
 */
function readName(text: string, from: number, max: number): Read | null {
  let at = from
  let end = from
  let tokens = 0
  while (tokens < max) {
    if (!isNameStart(text[at])) break
    if (tokens > 0 && startsWithAny(text, at, TOKEN_STOPS)) break
    let j = at
    let cut = false
    while (j < text.length && j - at < MAX_TOKEN && isThai(text[j])) {
      if (j > at && startsWithAny(text, j, GLUED_STOPS)) {
        cut = true
        break
      }
      j++
    }
    // The cap can land before a mark that belongs to the letter it follows.
    while (!cut && isMark(text[j])) j++
    if (j - at < 2) break
    end = j
    tokens++
    if (cut || text[j] !== ' ') break
    at = j + 1
  }
  return tokens === 0 ? null : { end, tokens }
}

/** A Latin name: up to three words, each a letter and then letters, a hyphen or an apostrophe. */
const LATIN_FIRST = "[A-Za-z][A-Za-z'’\\-]+"
/**
 * A second or third word is taken only when it is capitalised: "my name is
 * Somchai and I want" must end at Somchai.
 */
const LATIN_NEXT = "[A-Z][A-Za-z'’\\-]+"
const LATIN_NAME = `(${LATIN_FIRST}(?: ${LATIN_NEXT}){0,2})`
/** After a title the name is capitalised from its first word: "Mr. Somchai called". */
const LATIN_TITLED = `(${LATIN_NEXT}(?: ${LATIN_NEXT}){0,2})`

/**
 * Titles that name a person and nothing else: นาย and นาง, the doctors and the
 * ranks of the army, navy, air force and police (พันตำรวจโท, พ.ต.ท.). The longest first, so นางสาว is
 * read before นาง. A written-out title, not an abbreviation, is also the start
 * of other words (นายก, นางฟ้า), which `NOT_A_NAME` takes back.
 */
const TITLES =
  'ร้อยตำรวจเอก|ร้อยตำรวจตรี|หม่อมราชวงศ์|พันตำรวจเอก|พันตำรวจตรี|ร้อยตำรวจโท|จ่าสิบตำรวจ|สิบตำรวจเอก|สิบตำรวจตรี|พลอากาศเอก|พลอากาศตรี|พลตำรวจเอก|พลตำรวจตรี|พันตำรวจโท|สิบตำรวจโท|แพทย์หญิง|พลเรือเอก|พลเรือตรี|พลอากาศโท|พลตำรวจโท|จ่าสิบเอก|จ่าสิบตรี|หม่อมหลวง|หม่อมเจ้า|นายแพทย์|เด็กหญิง|พลเรือโท|ดาบตำรวจ|จ่าสิบโท|เด็กชาย|ร้อยเอก|ร้อยตรี|คุณหญิง|นางสาว|พันเอก|พันตรี|ร้อยโท|สิบเอก|สิบตรี|พลเอก|พลตรี|พันโท|สิบโท|พลโท|นาย|นาง|(?<![ก-๛A-Za-z])(?:พล\\.ร\\.อ\\.|พล\\.ร\\.ท\\.|พล\\.ร\\.ต\\.|พล\\.อ\\.อ\\.|พล\\.อ\\.ท\\.|พล\\.อ\\.ต\\.|พล\\.ต\\.อ\\.|พล\\.ต\\.ท\\.|พล\\.ต\\.ต\\.|พ\\.ต\\.อ\\.|พ\\.ต\\.ท\\.|พ\\.ต\\.ต\\.|ร\\.ต\\.อ\\.|ร\\.ต\\.ท\\.|ร\\.ต\\.ต\\.|จ\\.ส\\.อ\\.|จ\\.ส\\.ต\\.|จ\\.ส\\.ท\\.|ส\\.ต\\.อ\\.|ส\\.ต\\.ท\\.|ส\\.ต\\.ต\\.|ม\\.ร\\.ว\\.|พล\\.อ\\.|พล\\.ท\\.|พล\\.ต\\.|น\\.ส\\.|ด\\.ช\\.|ด\\.ญ\\.|พ\\.อ\\.|พ\\.ท\\.|พ\\.ต\\.|ร\\.อ\\.|ร\\.ท\\.|ร\\.ต\\.|ด\\.ต\\.|ส\\.อ\\.|ส\\.ท\\.|ส\\.ต\\.|ม\\.ล\\.|ม\\.จ\\.|นส\\.|ดช\\.|ดญ\\.|ดร\\.|นพ\\.|พญ\\.|ทพ\\.|ภก\\.|ภญ\\.|ผศ\\.|รศ\\.)'

const TITLE = new RegExp(`(${TITLES}(?:หญิง)?)[ ]?`, 'gu')

/** What follows นาย, นาง or คุณ when it is a word of its own and not a name. */
const NOT_A_NAME: readonly RegExp[] = [
  // นายก (and นายกรัฐมนตรี), นายจ้าง, นายหน้า, นายทุน, นายแบบ, นายท้าย, นายอำเภอ …
  /^(?:ก(?:ฯ|รัฐมนตรี|เทศมนตรี|อบต|อบจ|สมาคม|(?![ก-๛]))|จ้าง|หน้า|ทุน|แบบ|ท้าย|อำเภอ|ตำรวจ|ทหาร|สถานี|ช่าง)/,
  // เด็กชาย อายุ 3 ขวบ: an age, not a name
  /^(?:อายุ|ขวบ)/,
  // นางฟ้า, นางงาม, นางแบบ, นางเอก, นางรำ, นางใน, นางพยาบาล …
  /^(?:ฟ้า|งาม|แบบ|เอก|รำ|ใน|พยาบาล|พญา|ร้าย|นวล|ละคร|สงกรานต์|ไม้)/,
]

/**
 * What follows คุณ when it is a word of its own: a quality, or a way of
 * addressing, not a name. Kept apart from the list above on purpose: สมบัติ and
 * ธรรม* are ordinary given names after นาย or นาง ("นายสมบัติ รุ่งเรือง").
 */
const NOT_A_NAME_AFTER_KHUN =
  /^(?:ภาพ|สมบัติ|ค่า|ลักษณะ|ประโยชน์|ธรรม|วุฒิ|งาม|ไสย|พระ|ย่า|ปู่|พิเศษ|เชิง|ศัพท์|ครู|แม่|พ่อ|หมอ|พี่|น้อง|ลูกค้า|ผู้|ตา|ยาย|ป้า|ลุง|อา(?![ก-๛])|ท่าน|ทุกท่าน|ที่|ใด|ไหน|สามารถ|ต้อง|ช่วย|จะ|ได้|ไม่|ก็|เอง|ทำ|ยา|ลูก)/

/** The same list is read for all three words; "นาย" and "นาง" differ only in which entries can apply. */
function isNotAName(text: string, at: number): boolean {
  const rest = text.slice(at, at + 16)
  return NOT_A_NAME.some((re) => re.test(rest))
}

function isNotAKhunName(text: string, at: number): boolean {
  return isNotAName(text, at) || NOT_A_NAME_AFTER_KHUN.test(text.slice(at, at + 16))
}

/**
 * ชื่อ, "my name is" and the like. `strong` is an intro that can only be followed
 * by a name ("ผมชื่อ"); the plain label also heads a product, a shop or a file.
 */
const INTRO = /(?:(?:ผม|ดิฉัน|ฉัน|หนู|เรา)\s?ชื่อ(?:เล่น)?|my name is|name is)[\s:：]*(?:คือ\s?)?/giu
const LABEL =
  /(?:ชื่อ(?:\s?[-–]?\s?(?:นามสกุล|สกุล)(?:จริง)?|ผู้รับ|ผู้สั่ง|ผู้ซื้อ|ผู้ส่ง|ลูกค้า|ผู้โอน|ผู้ติดต่อ|บัญชี|จริง|เล่น)?|นามสกุล|name|full name|ผู้รับ)(?:\s?[:：]\s?|\s)/giu

/** What follows plain ชื่อ when it names something else. */
const NOT_A_PERSON_LABEL =
  /^(?:สินค้า|ร้าน|ไฟล์|เรื่อง|โปร|เสียง|เรียก|แบรนด์|รุ่น|บริษัท|หน่วยงาน|เว็บ|ผลิตภัณฑ์|ผู้ใช้|แอป|โรงเรียน|ธนาคาร|ถนน|ซอย|จังหวัด)/

const CONFIDENCE_TITLE = 0.97
const CONFIDENCE_TITLE_TWO = 0.98
const CONFIDENCE_KHUN = 0.96
/**
 * คุณ written right against one word is the weaker reading: "คุณสมชาย" is a name,
 * and so is the pronoun "you" in "คุณส่งสติกเกอร์" ("you sent a sticker"), and
 * nothing on the page tells them apart. Followed by a second word, as a first
 * name and a surname are, it is read as a name (`CONFIDENCE_KHUN`).
 */
const CONFIDENCE_KHUN_GLUED = 0.9
/**
 * A greeting right before คุณ: "สวัสดีค่ะคุณสมชาย" is a name, where "you" does not
 * follow a greeting and go straight on to a verb.
 */
const GREETING_BEFORE = /(?:สวัสดี|เรียน|ถึง)(?:ค่ะ|ครับ|คะ|ครับผม)?\s?$/u
const CONFIDENCE_INTRO = 0.96
const CONFIDENCE_LABEL_TWO = 0.96
const CONFIDENCE_LABEL_ONE = 0.85
const CONFIDENCE_ANSWER = 0.96

/** Cues the other side's question carries when it asks for a name. */
const ASKED_NAME = ['ชื่อ', 'นามสกุล', 'name', 'ผู้รับ']

/** A message that is only a name, or a title and a name. */
const ONLY_A_NAME = new RegExp(`^(?:${TITLES})?[${THAI}]{2,}(?: [${THAI}]{2,}){0,2}$`, 'u')

const personNameDetectorImpl: Detector = {
  id: 'person-name',
  entities: ['PERSON_NAME'],

  detect(input: NormalisedText, ctx?: DetectContext): Candidate[] {
    const text = input.text
    const found: Candidate[] = []
    const taken: Array<readonly [number, number]> = []
    const add = (start: number, end: number, confidence: number): void => {
      if (taken.some(([s, e]) => start < e && end > s)) return
      taken.push([start, end])
      found.push({ entity: 'PERSON_NAME', start, end, confidence, detector: 'person-name' })
    }

    // A title, and the name it introduces: the title goes with it, as a title
    // alone says who the person is as much as a first name does.
    for (const m of text.matchAll(TITLE)) {
      const from = m.index + m[0].length
      if (isNotAName(text, from)) continue
      const name = readName(text, from, 2)
      if (name === null) continue
      add(m.index, name.end, name.tokens === 2 ? CONFIDENCE_TITLE_TWO : CONFIDENCE_TITLE)
    }

    // Mr. Smith, Dr. Jane Doe.
    for (const m of text.matchAll(
      new RegExp(`\\b(?:Mr|MR|Mrs|MRS|Ms|MS|Miss|MISS|Dr|DR)\\.?[ ]${LATIN_TITLED}`, 'g'),
    )) {
      add(m.index, m.index + m[0].length, CONFIDENCE_TITLE)
    }

    // คุณ, then a name. After a space it is a name nearly always; glued it can be
    // the front of คุณภาพ, คุณสมบัติ, คุณครู.
    for (const m of text.matchAll(/(?:(?<![ก-๛])|(?<=สวัสดี|ค่ะ|ครับ|คะ|นะ|เรียน|ถึง))คุณ( ?)/gu)) {
      const from = m.index + m[0].length
      if (isNotAKhunName(text, from)) continue
      const name = readName(text, from, 2)
      if (name === null) continue
      // A given name is short; "ส่งสติกเกอร์" (sent a sticker) is not, and a second
      // word after it is just the next thing the customer says.
      const firstShort = (/^\S*/u.exec(text.slice(from)) as RegExpExecArray)[0].length <= 9
      const greeted = GREETING_BEFORE.test(text.slice(Math.max(0, m.index - 14), m.index))
      add(
        m.index,
        name.end,
        m[1] === ' ' || (name.tokens === 2 && firstShort) || greeted
          ? CONFIDENCE_KHUN
          : CONFIDENCE_KHUN_GLUED,
      )
    }

    // ผมชื่อ, my name is: the label stays readable, the name does not.
    for (const m of text.matchAll(INTRO)) {
      const from = m.index + m[0].length
      const latin = new RegExp(`^${LATIN_NAME}`).exec(text.slice(from))
      if (latin !== null) {
        add(from, from + latin[0].length, CONFIDENCE_INTRO)
        continue
      }
      const name = readName(text, from, 2)
      if (name !== null) add(from, name.end, CONFIDENCE_INTRO)
    }

    // ชื่อ, ชื่อ-นามสกุล, name: — a label, which also heads a product or a shop, so
    // a first name and a surname are what make it sure.
    for (const m of text.matchAll(LABEL)) {
      const from = m.index + m[0].length
      if (NOT_A_PERSON_LABEL.test(text.slice(from, from + 8))) continue
      const latin = new RegExp(`^${LATIN_NAME}`).exec(text.slice(from))
      if (latin !== null) {
        const words = latin[0].split(' ').length
        add(from, from + latin[0].length, words >= 2 ? CONFIDENCE_LABEL_TWO : CONFIDENCE_LABEL_ONE)
        continue
      }
      const name = readName(text, from, 2)
      if (name !== null) {
        add(from, name.end, name.tokens === 2 ? CONFIDENCE_LABEL_TWO : CONFIDENCE_LABEL_ONE)
      }
    }

    // The other side asked for a name and this message is the answer to it.
    const trimmed = text.trim()
    if (
      found.length === 0 &&
      trimmed !== '' &&
      isAnswer(text, ctx?.previous) &&
      previousHasCue(text, ctx?.previous, ASKED_NAME) &&
      ONLY_A_NAME.test(trimmed)
    ) {
      const start = text.indexOf(trimmed)
      add(start, start + trimmed.length, CONFIDENCE_ANSWER)
    }

    return found
  },
}

export const personNameDetector: Detector = squeezing(personNameDetectorImpl)
