import type { Candidate, DetectContext, Detector, NormalisedText } from '../types.js'
import { containsAny, previousHasCue } from './context.js'
import { PROVINCES } from './license-plate.js'

/**
 * A Thai postal address: "99/9 หมู่ 5 ซอยสุขุมวิท 101 ต.บางจาก อ.พระโขนง
 * จ.กรุงเทพมหานคร 10260".
 *
 * No checksum and no dictionary of streets exists, so the sentence is the whole
 * decision, as it is for a plate. An address is read as a list of parts, each a
 * label the post office uses and the word after it:
 *
 *   HOUSE     บ้านเลขที่ 99/9
 *   MOO       หมู่ 5, ม.5
 *   BUILDING  หมู่บ้าน / คอนโด / อาคาร + name, ห้อง / ชั้น + number
 *   SOI       ซอย / ซ.
 *   ROAD      ถนน / ถ.
 *   TAMBON    ตำบล / แขวง / ต.
 *   AMPHOE    อำเภอ / เขต / อ.
 *   PROVINCE  จังหวัด / จ. + a province, or a province name beside another part
 *   POSTCODE  five digits, only straight after a part above or a postcode word
 *
 * Parts that stand close together are one address, and what is claimed is the
 * stretch from the first part to the last. How many *different* kinds of part
 * it holds is the confidence: one label is a word ("ซอย" is also "to chop",
 * "เขต" is also "zone"), three are an address. Two kinds are reported under the
 * default threshold, where a policy can reach them on purpose, unless the
 * sentence says it is an address ("ที่อยู่", "จัดส่งที่").
 *
 * Thai is written without spaces, so a name ends at the next label, at a space
 * or comma, or after 24 characters. There is no word segmenter here and none
 * is needed: the labels are the boundaries.
 *
 * Only Thai-written addresses are read. A romanised address ("Soi 5, Sukhumvit
 * Rd.") is not (README, known limitations).
 */

type Kind =
  | 'HOUSE'
  | 'MOO'
  | 'BUILDING'
  | 'SOI'
  | 'ROAD'
  | 'TAMBON'
  | 'AMPHOE'
  | 'PROVINCE'
  | 'POSTCODE'

interface Part {
  readonly kind: Kind
  readonly start: number
  readonly end: number
  /** The part itself says this is an address: "บ้านเลขที่", "ที่อยู่ 12". */
  readonly says: boolean
}

/** Every label a name must stop at. */
const LABELS =
  'บ้านเลขที่|เลขที่|หมู่บ้าน|หมู่ที่|หมู่|ม\\.|ซอย|ซ\\.|ถนน|ถ\\.|ตำบล|ต\\.|แขวง|อำเภอ|อ\\.|เขต|จังหวัด|จ\\.|รหัสไปรษณีย์|ไปรษณีย์|คอนโด|อาคาร|ตึก|ห้อง|ชั้น|ที่อยู่'

/** A name: Thai letters, Latin letters, digits and the joiners of a house number; at most 24 long. */
const NAME = `(?:(?!${LABELS}|\\d{5}(?!\\d))[ก-๛A-Za-z0-9/\\-]){1,24}`

/** A label written as an abbreviation must not be the tail of a longer word. */
const NOT_AFTER_LETTER = '(?<![ก-๛A-Za-z])'

const HOUSE_LABELLED = /(บ้านเลขที่|เลขที่|ที่อยู่)[\s:：]*(\d{1,4}(?:\/\d{1,4}){0,2}(?:-\d{1,4})?)(?!\d)/dg
/** A house number with no label, taken only when a label of the next part follows it. */
const HOUSE_BARE =
  /(?<![\d/.\-])(\d{1,4}(?:\/\d{1,4})?)(?=[\s,]*(?:หมู่|ม\.|ซอย|ซ\.|ถนน|ถ\.|ตำบล|ต\.|แขวง))/dg
const MOO = new RegExp(`(?:หมู่ที่|หมู่|${NOT_AFTER_LETTER}ม\\.)\\s*(\\d{1,2})(?!\\d)`, 'gd')
const BUILDING = new RegExp(`(?:หมู่บ้าน|คอนโดมิเนียม|คอนโด|อาคาร|ตึก)\\s*(${NAME})`, 'gd')
const ROOM = /(?:ห้อง|ชั้น)\s*(\d{1,4}[A-Za-z]?)(?![\dก-๛])/dg
const NAMED: ReadonlyArray<readonly [Kind, RegExp]> = [
  ['SOI', new RegExp(`(?:ซอย|${NOT_AFTER_LETTER}ซ\\.)\\s*(${NAME}(?: \\d{1,3}(?!\\d))?)`, 'gd')],
  ['ROAD', new RegExp(`(?:ถนน|${NOT_AFTER_LETTER}ถ\\.)\\s*(${NAME}(?: \\d{1,3}(?!\\d))?)`, 'gd')],
  ['TAMBON', new RegExp(`(?:ตำบล|แขวง|${NOT_AFTER_LETTER}ต\\.)\\s*(${NAME})`, 'gd')],
  ['AMPHOE', new RegExp(`(?:อำเภอ|เขต|${NOT_AFTER_LETTER}อ\\.)\\s*(${NAME})`, 'gd')],
]
const PROVINCE_LABEL = new RegExp(`(?:จังหวัด|${NOT_AFTER_LETTER}จ\\.)\\s*`, 'gd')
const POSTCODE = /(?<!\d)([1-9]\d{4})(?!\d)/g

/** "เลย" is also "at all": a province only after its label, never bare. */
const PROVINCE_AFTER_LABEL: readonly string[] = [...PROVINCES, 'เลย'].sort(
  (a, b) => b.length - a.length,
)

/** Words that say the sentence is about where something is, or is sent. */
const ADDRESS_CUES = [
  'ที่อยู่',
  'ส่งที่',
  'ส่งไปที่',
  'ส่งมาที่',
  'จัดส่ง',
  'ที่พัก',
  'บ้านอยู่',
  'address',
  'ship to',
  'deliver',
]

const POSTCODE_WORDS = /(?:รหัสไปรษณีย์|ไปรษณีย์|zip ?code|zip|postcode)[\s:.,]*$/i

/** Characters of text between two parts of one address. */
const GAP = 24

/** How far before the address a cue word still names it. */
const CUE_BEFORE = 30

const CONFIDENCE_ADDRESS = 0.97
/** Two kinds of part and nothing else saying it is an address: under the default 0.95. */
const CONFIDENCE_TWO_PARTS = 0.8
/** One part, said to be an address: a house number after "ที่อยู่". */
const CONFIDENCE_ONE_PART = 0.6

const isThai = (ch: string | undefined): boolean => ch !== undefined && /[ก-๎]/.test(ch)

/** What may follow a province written without its label: a space, a digit, punctuation, or a polite particle. */
const PARTICLES = ['ค่ะ', 'ครับ', 'คะ', 'นะ', 'จ้า', 'ค่า', 'จ้ะ']

function endsWord(text: string, at: number): boolean {
  if (!isThai(text[at])) return true
  return PARTICLES.some((p) => text.startsWith(p, at))
}

function overlaps(parts: readonly Part[], start: number, end: number): boolean {
  return parts.some((p) => start < p.end && end > p.start)
}

/** The part nearest before `at` that is not itself a postcode, when the text between is `gap`. */
function partBefore(parts: readonly Part[], text: string, at: number, gap: RegExp): Part | null {
  let best: Part | null = null
  for (const p of parts) {
    if (p.end <= at && (best === null || p.end > best.end)) best = p
  }
  if (best === null) return null
  return gap.test(text.slice(best.end, at)) ? best : null
}

/**
 * A name stops after 24 characters, which can land inside a run of digits: the
 * last digit of a house number or a postcode would then be left outside the
 * span, in the clear. A part never ends in the middle of a number.
 */
function pastDigits(text: string, end: number): number {
  let at = end
  while (at < text.length && /\d/.test(text[at] as string)) at++
  return at
}

function labelled(text: string): Part[] {
  const parts: Part[] = []

  for (const m of text.matchAll(HOUSE_LABELLED)) {
    const label = m[1] as string
    const value = (m.indices as RegExpIndicesArray)[2] as [number, number]
    // "ที่อยู่ 12" keeps the label readable: only the number is claimed.
    const says = label !== 'เลขที่'
    parts.push({
      kind: 'HOUSE',
      start: label === 'ที่อยู่' ? value[0] : m.index,
      end: value[1],
      says,
    })
  }
  for (const m of text.matchAll(HOUSE_BARE)) {
    const value = (m.indices as RegExpIndicesArray)[1] as [number, number]
    parts.push({ kind: 'HOUSE', start: value[0], end: value[1], says: false })
  }
  for (const m of text.matchAll(MOO)) {
    parts.push({ kind: 'MOO', start: m.index, end: m.index + m[0].length, says: false })
  }
  for (const re of [BUILDING, ROOM]) {
    for (const m of text.matchAll(re)) {
      const end = pastDigits(text, m.index + m[0].length)
      parts.push({ kind: 'BUILDING', start: m.index, end, says: false })
    }
  }
  for (const [kind, re] of NAMED) {
    for (const m of text.matchAll(re)) {
      const end = pastDigits(text, m.index + m[0].length)
      parts.push({ kind, start: m.index, end, says: false })
    }
  }
  for (const m of text.matchAll(PROVINCE_LABEL)) {
    const from = m.index + m[0].length
    const name = PROVINCE_AFTER_LABEL.find((p) => text.startsWith(p, from))
    if (name !== undefined) {
      parts.push({ kind: 'PROVINCE', start: m.index, end: from + name.length, says: false })
    }
  }
  return parts
}

/**
 * A province written without "จ.": "ตำบลบางพลี สมุทรปราการ". Taken only when it
 * stands right after another part, since ตาก, ตรัง and น่าน are ordinary words
 * and "ตากผ้า" is not an address.
 */
function bareProvinces(text: string, parts: readonly Part[]): Part[] {
  const found: Part[] = []
  for (const name of PROVINCES) {
    for (let at = text.indexOf(name); at !== -1; at = text.indexOf(name, at + 1)) {
      const end = at + name.length
      if (overlaps(parts, at, end) || overlaps(found, at, end)) continue
      if (!endsWord(text, end)) continue
      if (partBefore(parts, text, at, /^[\s,]{0,3}$/) === null) continue
      found.push({ kind: 'PROVINCE', start: at, end, says: false })
    }
  }
  return found
}

/** Five digits, 10000 to 96999, straight after a part or a postcode word. */
function postcodes(text: string, parts: readonly Part[]): Part[] {
  const found: Part[] = []
  for (const m of text.matchAll(POSTCODE)) {
    const lead = Number((m[1] as string).slice(0, 2))
    if (lead < 10 || lead > 96) continue
    const end = m.index + 5
    if (overlaps(parts, m.index, end)) continue
    const near = partBefore(parts, text, m.index, /^[\s,.:]*(?:(?:รหัสไปรษณีย์|ไปรษณีย์)[\s:]*)?$/)
    const worded = POSTCODE_WORDS.test(text.slice(Math.max(0, m.index - 24), m.index))
    if ((near !== null && near.kind !== 'HOUSE' && near.kind !== 'MOO') || worded) {
      found.push({ kind: 'POSTCODE', start: m.index, end, says: false })
    }
  }
  return found
}

function cluster(parts: readonly Part[], text: string): Part[][] {
  const sorted = [...parts].sort((a, b) => a.start - b.start || a.end - b.end)
  const groups: Part[][] = []
  let reach = -1
  for (const p of sorted) {
    const current = groups[groups.length - 1]
    if (
      current !== undefined &&
      p.start - reach <= GAP &&
      !text.slice(reach, p.start).includes('\n\n')
    ) {
      current.push(p)
      reach = Math.max(reach, p.end)
    } else {
      groups.push([p])
      reach = p.end
    }
  }
  return groups
}

export const addressDetector: Detector = {
  id: 'address',
  entities: ['ADDRESS'],

  detect(input: NormalisedText, ctx?: DetectContext): Candidate[] {
    const text = input.text
    const parts = labelled(text)
    if (parts.length === 0) return []
    parts.push(...bareProvinces(text, parts))
    parts.push(...postcodes(text, parts))

    const asked = previousHasCue(text, ctx?.previous, ADDRESS_CUES)
    const found: Candidate[] = []

    for (const group of cluster(parts, text)) {
      const start = Math.min(...group.map((p) => p.start))
      const end = Math.max(...group.map((p) => p.end))
      const kinds = new Set(group.map((p) => p.kind))
      const cued =
        asked ||
        group.some((p) => p.says) ||
        containsAny(text.slice(Math.max(0, start - CUE_BEFORE), start).toLowerCase(), ADDRESS_CUES)

      let confidence = 0
      if (kinds.size >= 3) confidence = CONFIDENCE_ADDRESS
      else if (kinds.size === 2) confidence = cued ? CONFIDENCE_ADDRESS : CONFIDENCE_TWO_PARTS
      else if (cued && !kinds.has('POSTCODE')) confidence = CONFIDENCE_ONE_PART
      if (confidence === 0) continue

      found.push({ entity: 'ADDRESS', start, end, confidence, detector: 'address' })
    }
    return found
  },
}
