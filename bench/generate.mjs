// Fills the benchmark templates with synthetic values and writes a labelled
// dataset: one line per chat message, with the exact span of every value.
//
//   node bench/generate.mjs [--holdout] [--seed 20261006] [--rounds 5]
//   → bench/out/dataset.jsonl          from bench/templates/
//   → bench/out/dataset-holdout.jsonl  from bench/holdout/ — never used to tune detectors
//
// Every value is made up here. ID numbers get a correct check digit, cards are
// the issuers' published test numbers, emails use reserved example domains.
// Phone numbers and account numbers are random digits: some will belong to
// someone. That is why the generated file is not committed — publish the
// templates and this script, and let anyone regenerate the same file from the
// seed.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

const here = (p) => new URL(p, import.meta.url)
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i < 0 ? fallback : Number(process.argv[i + 1])
}
const SEED = arg('seed', 20261006)
const ROUNDS = arg('rounds', 5)
const HOLDOUT = process.argv.includes('--holdout')

// ---------------------------------------------------------------- randomness

/** mulberry32: small, fast, and the same sequence on every machine for a seed. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
let rand = rng(SEED)
const pick = (xs) => xs[Math.floor(rand() * xs.length)]
const chance = (p) => rand() < p
const digits = (n) => Array.from({ length: n }, () => Math.floor(rand() * 10)).join('')

// ---------------------------------------------------------------- values

function thaiIdCheckDigit(body12) {
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(body12[i]) * (13 - i)
  return (11 - (sum % 11)) % 10
}

// Published test numbers. Luhn-valid, never issued to a cardholder.
const TEST_CARDS = [
  '4111111111111111',
  '4012888888881881',
  '4242424242424242',
  '5555555555554444',
  '5105105105105100',
  '2223003122003222',
  '378282246310005',
  '371449635398431',
  '6011111111111117',
  '3530111333300000',
]

const EMAIL_LOCALS = [
  'somchai',
  'nida.k',
  'ploy_2539',
  'tanawat.s',
  'kanya88',
  'pim',
  'user.th',
  'b.jirayu',
  'mookie',
  'arthit.w',
]
const EMAIL_DOMAINS = [
  'example.com',
  'example.co.th',
  'mail.example',
  'shop.example.net',
  'test.example',
]
const FIRST = [
  'สมชาย',
  'สุดา',
  'วิภาวรรณ',
  'ธนวัฒน์',
  'ปิยะนุช',
  'อรรถพล',
  'กัญญา',
  'ณัฐพล',
  'พิมพ์ชนก',
  'ประยูร',
]
const LAST = ['ใจดี', 'รักไทย', 'ศรีสุข', 'บุญมา', 'แก้วประเสริฐ', 'ทองดี', 'สายสุวรรณ', 'วงศ์ใหญ่']
const TITLE = ['นาย', 'นาง', 'นางสาว', 'คุณ']
const PROVINCE = ['กรุงเทพฯ', 'เชียงใหม่', 'ขอนแก่น', 'ชลบุรี', 'สงขลา', 'นนทบุรี']
const PLATE_CHARS = 'กขคงจฉชซฒณดตถทธนบปผพภมยรลวศษสหฬอฮ'
const MONTHS = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
]

/** A canonical value for one slot. The same {X:n} in a conversation reuses it. */
function makeValue(entity) {
  switch (entity) {
    case 'PHONE':
      return chance(0.85) ? `0${pick(['6', '8', '9'])}${digits(8)}` : `02${digits(7)}`
    case 'TH_NATIONAL_ID': {
      const body = `${1 + Math.floor(rand() * 8)}${digits(11)}`
      return body + thaiIdCheckDigit(body)
    }
    case 'BANK_ACCOUNT':
      return digits(chance(0.85) ? 10 : 12)
    case 'CREDIT_CARD':
      return pick(TEST_CARDS)
    case 'EMAIL':
      return `${pick(EMAIL_LOCALS)}${chance(0.4) ? digits(2) : ''}@${pick(EMAIL_DOMAINS)}`
    case 'LINE_USER_ID':
      return `U${Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(rand() * 16)]).join('')}`
    case 'NAME':
      return `${chance(0.4) ? pick(TITLE) : ''}${pick(FIRST)} ${pick(LAST)}`
    case 'ADDRESS':
      return `${1 + Math.floor(rand() * 300)}/${1 + Math.floor(rand() * 99)} หมู่ ${1 + Math.floor(rand() * 12)} ต.บางรัก อ.เมือง จ.${pick(PROVINCE)}${chance(0.5) ? ` ${digits(5)}` : ''}`
    case 'LICENSE_PLATE':
      return `${chance(0.3) ? 1 + Math.floor(rand() * 9) : ''}${pick([...PLATE_CHARS])}${pick([...PLATE_CHARS])} ${1 + Math.floor(rand() * 9999)}${chance(0.5) ? ` ${pick(PROVINCE)}` : ''}`
    case 'DATE_OF_BIRTH':
      return chance(0.5)
        ? `${1 + Math.floor(rand() * 28)} ${pick(MONTHS)} ${2500 + Math.floor(rand() * 50)}`
        : `${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}/${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}/${1960 + Math.floor(rand() * 45)}`
    default:
      throw new Error(`unknown slot ${entity}`)
  }
}

// ---------------------------------------------------------------- formats

const groups = (s, sizes, sep) => {
  const out = []
  let at = 0
  for (const n of sizes) {
    out.push(s.slice(at, at + n))
    at += n
  }
  return out.join(sep)
}

/** How a person might type this value. Each occurrence picks again. */
function format(entity, v) {
  switch (entity) {
    case 'PHONE':
      if (v.startsWith('02')) return pick([v, groups(v, [2, 3, 4], '-'), groups(v, [2, 3, 4], ' ')])
      return pick([
        v,
        groups(v, [3, 3, 4], '-'),
        groups(v, [3, 3, 4], ' '),
        groups(v, [3, 7], '-'),
        `+66 ${groups(v.slice(1), [2, 3, 4], ' ')}`,
        `+66${v.slice(1)}`,
      ])
    case 'TH_NATIONAL_ID':
      return pick([v, groups(v, [1, 4, 5, 2, 1], '-'), groups(v, [1, 4, 5, 2, 1], ' ')])
    case 'BANK_ACCOUNT':
      return v.length === 10
        ? pick([
            v,
            groups(v, [3, 1, 5, 1], '-'),
            groups(v, [3, 3, 4], '-'),
            groups(v, [3, 1, 5, 1], ' '),
          ])
        : pick([v, groups(v, [3, 3, 6], '-')])
    case 'CREDIT_CARD':
      return v.length === 15
        ? pick([v, groups(v, [4, 6, 5], ' '), groups(v, [4, 6, 5], '-')])
        : pick([v, groups(v, [4, 4, 4, 4], ' '), groups(v, [4, 4, 4, 4], '-')])
    case 'EMAIL':
      return chance(0.1) ? v.toUpperCase() : v
    default:
      return v
  }
}

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙'
const FULLWIDTH_DIGITS = '０１２３４５６７８９'
const ZWSP = '​'
const NUMERIC = new Set(['PHONE', 'TH_NATIONAL_ID', 'BANK_ACCOUNT', 'CREDIT_CARD'])

/**
 * The tricks normalise() exists for, applied at random so the report can say
 * how each one fares. Only to numeric values: an email in Thai digits is not
 * something people type.
 */
function disguise(entity, s) {
  const applied = []
  if (!NUMERIC.has(entity)) return { text: s, applied }
  if (chance(0.2)) {
    s = s.replace(/[0-9]/g, (d) => THAI_DIGITS[d])
    applied.push('thai-digits')
  } else if (chance(0.05)) {
    s = s.replace(/[0-9]/g, (d) => FULLWIDTH_DIGITS[d])
    applied.push('fullwidth-digits')
  }
  if (chance(0.08) && s.length > 4) {
    const at = 2 + Math.floor(rand() * (s.length - 3))
    s = s.slice(0, at) + ZWSP + s.slice(at)
    applied.push('zero-width-space')
  }
  return { text: s, applied }
}

// ---------------------------------------------------------------- fill

const SLOT = /\{([A-Z_]+)(?::(\d+))?\}/g
const KNOWN = new Set([
  'PHONE',
  'TH_NATIONAL_ID',
  'BANK_ACCOUNT',
  'CREDIT_CARD',
  'EMAIL',
  'LINE_USER_ID',
  'NAME',
  'ADDRESS',
  'LICENSE_PLATE',
  'DATE_OF_BIRTH',
])

/** Text written before a slot that means only part of the value is meant. */
const PARTIAL_CUE = /ลงท้าย(ด้วย)?\s*$/

function fill(text, values) {
  let out = ''
  let at = 0
  const spans = []
  for (const m of text.matchAll(SLOT)) {
    out += text.slice(at, m.index)
    at = m.index + m[0].length
    const [, entity, n] = m
    // A slot name the writer invented is left as written, with no label.
    if (!KNOWN.has(entity)) {
      out += m[0]
      continue
    }
    const key = n === undefined ? `${entity}#${m.index}` : `${entity}:${n}`
    if (!values.has(key)) values.set(key, makeValue(entity))
    const value = values.get(key)

    // "the card ending in {CREDIT_CARD}" asks for four digits, not the number.
    if (PARTIAL_CUE.test(out)) {
      out += value.replace(/\D/g, '').slice(-4)
      continue
    }

    const { text: typed, applied } = disguise(entity, format(entity, value))
    spans.push({ entity, start: out.length, end: out.length + typed.length, transforms: applied })
    out += typed
  }
  out += text.slice(at)
  return { text: out, spans }
}

// ---------------------------------------------------------------- run

const dir = here(HOLDOUT ? './holdout/' : './templates/')
const sets = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
const lines = []

for (let round = 0; round < ROUNDS; round++) {
  for (const file of sets) {
    const set = file.replace(/\.json$/, '')
    // Seeded per round and set, so adding a set does not reshuffle the others.
    rand = rng(SEED + round * 1_000_003 + [...set].reduce((h, c) => h * 31 + c.charCodeAt(0), 7))
    const { conversations } = JSON.parse(readFileSync(new URL(file, dir), 'utf8'))
    for (const conv of conversations) {
      const values = new Map()
      let prev = null
      const lastFrom = { customer: null, shop: null }
      conv.turns.forEach((turn, i) => {
        const { text, spans } = fill(turn.text, values)
        const valueOnly =
          spans.length === 1 && text.trim() === text.slice(spans[0].start, spans[0].end)
        lines.push(
          JSON.stringify({
            id: `${set}/${conv.id}/r${round}/t${i}`,
            set,
            round,
            boundary: turn.from === 'customer' ? 'inbound' : 'outbound',
            text,
            spans,
            valueOnly,
            prev,
            // What an app would pass as \`context\`: the other side's last message.
            prevOther: lastFrom[turn.from === 'customer' ? 'shop' : 'customer'],
          }),
        )
        prev = text
        lastFrom[turn.from] = text
      })
    }
  }
}

mkdirSync(here('./out/'), { recursive: true })
const outName = HOLDOUT ? 'dataset-holdout.jsonl' : 'dataset.jsonl'
writeFileSync(here(`./out/${outName}`), `${lines.join('\n')}\n`)
console.log(
  `bench/out/${outName} · ${lines.length} messages · seed ${SEED} · ${ROUNDS} rounds · ${sets.length} template sets`,
)
