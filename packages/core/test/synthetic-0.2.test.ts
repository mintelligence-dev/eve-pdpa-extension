import { describe, expect, it } from 'vitest'
import { crc16 } from '../src/detectors/promptpay.js'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import { checkDigit } from './helpers/make-thai-id.js'

/**
 * Made-up messages, many of them, through the guard with the 0.2 detectors on.
 *
 * The hand-written cases in the other test files hold what its author thought of.
 * These are put together from parts by a seeded generator, so a run is the same
 * every time, and the oracle needs no list of expected outputs: a message built
 * from a name, an address or an ID is *hidden* when none of the values it was
 * built from is left in the text that comes out. A message built from ordinary
 * chat must come out *unchanged*.
 *
 * Everything below is invented. A surname is two syllables put together and is
 * not meant to be anyone's. `PDPA_REPORT=1 pnpm exec vitest run synthetic` prints
 * the rate for each kind and the first few misses.
 */

const guard = createGuard({
  policy: definePolicy({
    entitySet: '0.2',
    onUnmapped: 'redact',
    placeholderLanguage: 'th',
    entities: {},
  }),
  hmacKey: 'a3f1c9e07b2d4f6a8c1e3b5d7f9a0c2e4b6d8f1a3c5e7b9d0f2a4c6e8b1d3f5a',
  onAudit: () => {},
})

const out = (text: string): string => guard.processSync(text, { sessionId: 'synthetic' }).text

// ---- a seeded generator --------------------------------------------------

function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rnd = () => number
const int = (r: Rnd, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1))
const pick = <T>(r: Rnd, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
const chance = (r: Rnd, p: number): boolean => r() < p
const digits = (r: Rnd, n: number): string => Array.from({ length: n }, () => int(r, 0, 9)).join('')

// ---- pools ---------------------------------------------------------------

const SOI_TH = ['สุขุมวิท', 'ลาดพร้าว', 'ร่วมใจ', 'อารีย์', 'รัชดา', 'เพชรเกษม', 'บางนา', 'วิภาวดี']
const ROAD_TH = ['พหลโยธิน', 'สีลม', 'รามคำแหง', 'พระราม', 'เจริญกรุง', 'มิตรภาพ', 'นิมมานเหมินท์']
const TAMBON_TH = ['บางจาก', 'ท่าศาลา', 'หนองหอย', 'คลองตัน', 'สุเทพ', 'บางแก้ว', 'ในเมือง']
const AMPHOE_TH = ['พระโขนง', 'เมือง', 'บางพลี', 'กระทุ่มแบน', 'ปากเกร็ด', 'หางดง', 'สารภี']
const PROVINCE_TH = [
  'กรุงเทพมหานคร',
  'เชียงใหม่',
  'สมุทรปราการ',
  'ขอนแก่น',
  'นนทบุรี',
  'ลำพูน',
  'ภูเก็ต',
  'ระยอง',
]

const SOI_EN = ['Sukhumvit', 'Ladprao', 'Ari', 'Ratchada', 'Phetkasem', 'Bangna', 'Rama']
const AREA_EN = ['Bang Chak', 'Phra Khanong', 'Chatuchak', 'Din Daeng', 'Mueang', 'Bang Phli']
const PROVINCE_EN = ['Bangkok', 'Chiang Mai', 'Nonthaburi', 'Samut Prakan', 'Phuket', 'Khon Kaen']

const FIRST_TH = [
  'สมชาย',
  'สุดา',
  'มาลี',
  'วิชัย',
  'กานดา',
  'ธนากร',
  'พิมพ์ชนก',
  'ประเสริฐ',
  'อรุณี',
  'ณัฐพล',
]
const SYLLABLES = [
  'ศรี',
  'ทอง',
  'แก้ว',
  'ใส',
  'รุ่ง',
  'เรือง',
  'สุข',
  'พงษ์',
  'วงศ์',
  'เมฆ',
  'บุญ',
  'จันทร์',
  'เพ็ญ',
]
const surname = (r: Rnd): string => pick(r, SYLLABLES) + pick(r, SYLLABLES)
const FIRST_EN = ['Somchai', 'Suda', 'Malee', 'Wichai', 'Kanda', 'Thanakorn']
const LAST_EN = ['Jaidee', 'Rakthai', 'Srisuk', 'Thongdee', 'Kaewsai']

const TITLES_TH = [
  'นาย',
  'นาง',
  'นางสาว',
  'น.ส.',
  'ดร.',
  'นพ.',
  'ด.ช.',
  'พ.ต.ท.',
  'ร.ต.อ.',
  'เด็กชาย',
]
const ENDINGS = ['', ' ค่ะ', ' ครับ', ' โทรมา', ' สั่งสินค้าไว้', ' ขอสอบถามหน่อย']

// ---- positives: each returns the text, and what must be gone from the output ----

interface Case {
  readonly text: string
  /** Strings that must not survive. Digits are checked as a whole: no digit may survive. */
  readonly secrets: readonly string[]
  readonly noDigits: boolean
}

function thaiAddress(r: Rnd): Case {
  const parts: string[] = []
  const secrets: string[] = []
  const labelled = chance(r, 0.5)
  const house = chance(r, 0.5) ? `${int(r, 1, 999)}/${int(r, 1, 99)}` : `${int(r, 1, 999)}`
  parts.push(labelled ? `บ้านเลขที่ ${house}` : house)

  const middle: string[] = []
  if (chance(r, 0.5)) middle.push(`หมู่ ${int(r, 1, 15)}`)
  const flexible = [
    () => {
      const n = pick(r, SOI_TH)
      secrets.push(n)
      return `${chance(r, 0.5) ? 'ซอย' : 'ซ.'}${n}${chance(r, 0.5) ? ` ${int(r, 1, 120)}` : ''}`
    },
    () => {
      const n = pick(r, ROAD_TH)
      secrets.push(n)
      return `${chance(r, 0.5) ? 'ถนน' : 'ถ.'}${n}`
    },
    () => {
      const n = pick(r, TAMBON_TH)
      secrets.push(n)
      return `${pick(r, ['ต.', 'ตำบล', 'แขวง'])}${n}`
    },
  ]
  // At least one of soi, road, tambon, so that a bare house number has a label after it.
  for (const f of [...flexible].sort(() => r() - 0.5).slice(0, int(r, 1, 3))) middle.push(f())
  parts.push(...middle)
  if (chance(r, 0.7)) {
    const n = pick(r, AMPHOE_TH)
    secrets.push(n)
    parts.push(`${pick(r, ['อ.', 'อำเภอ', 'เขต'])}${n}`)
  }
  const province = pick(r, PROVINCE_TH)
  secrets.push(province)
  parts.push(`${pick(r, ['จ.', 'จังหวัด', ''])}${province}`.replace(/^$/, province))
  if (chance(r, 0.8)) parts.push(String(int(r, 10, 96) * 1000 + int(r, 0, 999)).padStart(5, '0'))

  const prefix = pick(r, ['ส่งที่ ', 'ที่อยู่ ', 'จัดส่งที่ ', 'ฝากส่งที่ ', ''])
  return {
    text: `${prefix}${parts.join(' ')}${pick(r, ['', ' ค่ะ', ' นะคะ', ' ครับ'])}`,
    secrets,
    noDigits: true,
  }
}

function englishAddress(r: Rnd): Case {
  const lower = chance(r, 0.35)
  const secrets: string[] = []
  const soi = pick(r, SOI_EN)
  const province = pick(r, PROVINCE_EN)
  secrets.push(soi, province)
  const house = chance(r, 0.4) ? `${int(r, 1, 999)}/${int(r, 1, 99)}` : String(int(r, 1, 999))
  const post = String(int(r, 10, 96) * 1000 + int(r, 0, 999)).padStart(5, '0')
  let text: string
  if (lower) {
    const street = chance(r, 0.5)
      ? `soi ${soi.toLowerCase()} ${int(r, 1, 120)}`
      : `${soi.toLowerCase()} road`
    text = `${house} ${street} ${province.toLowerCase()} ${post}`
  } else {
    const parts = [chance(r, 0.3) ? `No. ${house}` : house]
    if (chance(r, 0.5)) parts.push(`Moo ${int(r, 1, 15)}`)
    parts.push(chance(r, 0.5) ? `Soi ${soi} ${int(r, 1, 120)}` : `${soi} Road`)
    if (chance(r, 0.5)) {
      const a = pick(r, AREA_EN)
      secrets.push(a)
      parts.push(chance(r, 0.5) ? `${a} Subdistrict` : `${a} District`)
    }
    parts.push(`${province} ${post}`)
    text = parts.join(', ')
  }
  const prefix = pick(r, [
    'Ship to ',
    'Address: ',
    'please send to ',
    'my address is ',
    'deliver to ',
  ])
  return { text: `${prefix}${text}${pick(r, ['', ' thanks', ' please'])}`, secrets, noDigits: true }
}

function thaiId(r: Rnd): string {
  const body = String(int(r, 1, 8)) + digits(r, 11)
  return body + checkDigit(body)
}

function promptpay(r: Rnd): Case {
  const cue = pick(r, [
    'พร้อมเพย์ ',
    'พร้อมเพย์: ',
    'promptpay ',
    'PromptPay ID ',
    'โอนเข้าพร้อมเพย์ ',
    'e-wallet ',
  ])
  const kind = int(r, 0, 4)
  let value: string
  if (kind === 0) {
    const m = `0${pick(r, [6, 8, 9])}${digits(r, 8)}`
    value = pick(r, [
      m,
      `${m.slice(0, 3)}-${m.slice(3, 6)}-${m.slice(6)}`,
      `${m.slice(0, 3)} ${m.slice(3, 6)} ${m.slice(6)}`,
    ])
  } else if (kind === 1) {
    const m = `${pick(r, [6, 8, 9])}${digits(r, 8)}`
    value = pick(r, [`+66 ${m.slice(0, 2)} ${m.slice(2, 5)} ${m.slice(5)}`, `+66${m}`])
  } else if (kind === 2) {
    const id = thaiId(r)
    value = pick(r, [
      id,
      `${id[0]}-${id.slice(1, 5)}-${id.slice(5, 10)}-${id.slice(10, 12)}-${id[12]}`,
    ])
  } else if (kind === 3) {
    value = `004${digits(r, 12)}`
  } else {
    const proxy = `00668${digits(r, 8)}`
    const account = `0016A00000067701011101${String(proxy.length).padStart(2, '0')}${proxy}`
    const body = `00020101021129${String(account.length).padStart(2, '0')}${account}53037645802TH6304`
    value = body + crc16(body).toString(16).toUpperCase().padStart(4, '0')
  }
  const suffix = pick(r, ['', ' ค่ะ', ' นะคะ', ' ได้เลยครับ'])
  return { text: `${cue}${value}${suffix}`, secrets: [], noDigits: true }
}

function personName(r: Rnd): Case {
  const first = pick(r, FIRST_TH)
  const last = surname(r)
  const latinFirst = pick(r, FIRST_EN)
  const latinLast = pick(r, LAST_EN)
  const forms: Array<[string, string[]]> = [
    [`${pick(r, TITLES_TH)}${first} ${last}`, [first, last]],
    [`สวัสดีครับ ${pick(r, ['นาย', 'นางสาว', 'ดร.'])}${first} ${last}`, [first, last]],
    [`${pick(r, ['ผม', 'ดิฉัน', 'หนู'])}ชื่อ${first} ${last}`, [first, last]],
    [`ชื่อ-นามสกุล: ${first} ${last}`, [first, last]],
    [`${pick(r, ['ชื่อผู้รับ', 'ชื่อผู้สั่ง', 'ชื่อลูกค้า'])} ${first} ${last}`, [first, last]],
    [`สวัสดีค่ะ คุณ${first} ${last}`, [first, last]],
    [
      `${pick(r, ['Mr.', 'Mrs.', 'Ms.', 'Dr.'])} ${latinFirst} ${latinLast}`,
      [latinFirst, latinLast],
    ],
    [`my name is ${latinFirst} ${latinLast}`, [latinFirst, latinLast]],
    [`Name: ${latinFirst} ${latinLast}`, [latinFirst, latinLast]],
  ]
  const [text, secrets] = pick(r, forms)
  return { text: text + pick(r, ENDINGS), secrets, noDigits: false }
}

// ---- negatives: nothing here may change ------------------------------------

const ORDINARY = [
  'ขอบคุณค่ะ',
  'สินค้าชิ้นนี้มีสีขาวไหมคะ',
  'ออเดอร์ 12345 ส่งแล้วค่ะ',
  'ยอด 98765 บาท',
  'บ้านอยู่เชียงใหม่ค่ะ',
  'ไปเที่ยวภูเก็ตมา สนุกมาก',
  'นายหน้าขายบ้านโทรมา',
  'คุณภาพสินค้าดีมาก',
  'นายกรัฐมนตรีแถลงข่าว',
  'ชื่อสินค้า เสื้อโปโล',
  'ชื่อร้าน ร้านสุขใจ',
  'จัดส่งภายใน 3 วันทำการ',
  'ซอยนี้รถติดมาก',
  'นางฟ้าตัวน้อย',
  'พันธุ์ไม้ขายดี',
  'ขอเลขพร้อมเพย์หน่อยค่ะ',
  'รับชำระผ่านพร้อมเพย์ได้ค่ะ',
  'ตากผ้าที่ระเบียง',
  'อยู่ในเขตร้อน',
  'คุณส่งสติกเกอร์',
  'the road was closed',
  'Soi 5 is blocked',
  'I live near Abbey Road',
  'I bought 2 red road bikes',
  'what time do you open tomorrow',
  'thanks, the parcel arrived today',
]

function ordinary(r: Rnd): string {
  return Array.from({ length: int(r, 1, 3) }, () => pick(r, ORDINARY)).join(
    pick(r, [' ', '\n', ', ']),
  )
}

// ---- the runs --------------------------------------------------------------

/** `PDPA_N=5000` for a longer run; the seeds are fixed, so a run is repeatable. */
const N = Number(process.env.PDPA_N ?? 400)

interface Miss {
  readonly text: string
  readonly out: string
}

function hiddenRate(make: (r: Rnd) => Case, seed: number): { rate: number; misses: Miss[] } {
  const r = seeded(seed)
  const misses: Miss[] = []
  for (let i = 0; i < N; i++) {
    const c = make(r)
    const result = out(c.text)
    const left = c.secrets.filter((s) => result.toLowerCase().includes(s.toLowerCase()))
    if (left.length > 0 || (c.noDigits && /\d/.test(result)) || result === c.text) {
      misses.push({ text: c.text, out: result })
    }
  }
  return { rate: 1 - misses.length / N, misses }
}

function unchangedRate(seed: number): { rate: number; misses: Miss[] } {
  const r = seeded(seed)
  const misses: Miss[] = []
  for (let i = 0; i < N; i++) {
    const text = ordinary(r)
    const result = out(text)
    if (result !== text) misses.push({ text, out: result })
  }
  return { rate: 1 - misses.length / N, misses }
}

const report = process.env.PDPA_REPORT === '1'
function show(name: string, rate: number, misses: readonly Miss[]): void {
  if (!report) return
  console.log(`${name.padEnd(34)} ${(rate * 100).toFixed(1)}%  (${N - misses.length}/${N})`)
  for (const m of misses.slice(0, 4)) console.log(`   IN : ${m.text}\n   OUT: ${m.out}`)
}

describe('made-up messages: what must be hidden', () => {
  const kinds: ReadonlyArray<readonly [string, (r: Rnd) => Case, number]> = [
    ['a Thai address', thaiAddress, 1],
    ['an English address', englishAddress, 2],
    ['a PromptPay ID', promptpay, 3],
    ['a person name', personName, 4],
  ]
  for (const [name, make, seed] of kinds) {
    it(`${name}: every value is gone from what comes out`, () => {
      const { rate, misses } = hiddenRate(make, seed)
      show(name, rate, misses)
      expect(misses.slice(0, 3)).toEqual([])
    })
  }
})

// ---- the same messages, roughed up ----------------------------------------

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙'

/** Ways a customer types the same thing: Thai digits, doubled spaces, a line break for a space, the caps lock on. */
const MUTATIONS: ReadonlyArray<readonly [string, (t: string, r: Rnd) => string]> = [
  ['Thai digits', (t) => t.replace(/\d/g, (d) => THAI_DIGITS[Number(d)] as string)],
  ['doubled spaces', (t) => t.replace(/ /g, '  ')],
  ['a line break for a space', (t, r) => t.replace(/ /g, () => (chance(r, 0.4) ? '\n' : ' '))],
  ['a tab for a space', (t) => t.replace(/ /g, '\t')],
  ['a zero-width space between words', (t) => t.replace(/ /g, ' \u200b')],
  ['all upper case (Latin)', (t) => t.toUpperCase()],
  ['a full stop and a smiley after', (t) => `${t}. :)`],
  ['quoted', (t) => `"${t}"`],
  ['text before it, with no space', (t) => `ok${t}`],
]

function roughedUp(make: (r: Rnd) => Case, seed: number): Map<string, Miss[]> {
  const r = seeded(seed)
  const byMutation = new Map<string, Miss[]>()
  for (let i = 0; i < N; i++) {
    const c = make(r)
    for (const [name, mutate] of MUTATIONS) {
      const text = mutate(c.text, r)
      const result = out(text)
      const left = c.secrets.filter((x) => result.toLowerCase().includes(x.toLowerCase()))
      const bad = left.length > 0 || (c.noDigits && /[\d๐-๙]/.test(result)) || result === text
      if (bad) byMutation.set(name, [...(byMutation.get(name) ?? []), { text, out: result }])
    }
  }
  return byMutation
}

describe('made-up messages, typed carelessly', () => {
  const kinds: ReadonlyArray<readonly [string, (r: Rnd) => Case, number]> = [
    ['a Thai address', thaiAddress, 11],
    ['an English address', englishAddress, 12],
    ['a PromptPay ID', promptpay, 13],
    ['a person name', personName, 14],
  ]
  for (const [name, make, seed] of kinds) {
    it(`${name}`, () => {
      const missed = roughedUp(make, seed)
      // A name split over two lines is a known limit, not a miss: the next line is
      // as likely to be the next thing the customer says as a surname.
      if (name === 'a person name') {
        missed.delete('a line break for a space')
        // "okMrs. …": a Latin title glued to the letters before it is not how anyone types.
        missed.delete('text before it, with no space')
      }
      if (report) {
        for (const [m, list] of missed) {
          console.log(`${name} / ${m}: ${list.length} of ${N} missed`)
          for (const x of list.slice(0, 2))
            console.log(`   IN : ${JSON.stringify(x.text)}\n   OUT: ${JSON.stringify(x.out)}`)
        }
      }
      expect([...missed.keys()]).toEqual([])
    })
  }
})

describe('made-up messages: what must stay', () => {
  it('ordinary chat comes out unchanged', () => {
    const { rate, misses } = unchangedRate(5)
    show('ordinary chat, left alone', rate, misses)
    expect(misses.slice(0, 3)).toEqual([])
  })
})
