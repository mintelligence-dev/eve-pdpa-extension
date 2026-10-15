// Makes and checks the numbers used in the benchmark data. Sentences are written by hand;
// this file only makes sure every number in them is a real-looking, valid value.
//
// Nothing here comes from the package: these are the public rules (mod-11, Luhn, Thai
// numbering plan), written from scratch.

/** Small seeded PRNG (mulberry32), so the value pool is the same on every run. */
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (r, list) => list[Math.floor(r() * list.length)]
const digits = (r, n) => Array.from({ length: n }, () => Math.floor(r() * 10)).join('')

// ---------- digits in every script a Thai customer may paste ----------

const THAI_ZERO = 0x0e50
const FULL_ZERO = 0xff10
/** Thai (๐-๙) and full-width (０-９) digits → ASCII. Everything else unchanged. */
export function asciiDigits(s) {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)
    if (c >= THAI_ZERO && c <= THAI_ZERO + 9) out += String(c - THAI_ZERO)
    else if (c >= FULL_ZERO && c <= FULL_ZERO + 9) out += String(c - FULL_ZERO)
    else out += ch
  }
  return out
}
export const onlyDigits = (s) => asciiDigits(s).replace(/\D/g, '')
export const toThaiDigits = (s) =>
  s.replace(/[0-9]/g, (d) => String.fromCodePoint(THAI_ZERO + Number(d)))
export const toFullWidth = (s) =>
  s.replace(/[0-9]/g, (d) => String.fromCodePoint(FULL_ZERO + Number(d)))

// ---------- Thai national id: d13 = (11 − Σ dᵢ·(14−i) mod 11) mod 10 ----------

export function nationalIdCheckDigit(first12) {
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (13 - i)
  return (11 - (sum % 11)) % 10
}
export function isNationalId(value) {
  const d = onlyDigits(value)
  return d.length === 13 && d[0] !== '0' && nationalIdCheckDigit(d) === Number(d[12])
}
/** Citizen ids start 1-8 (the first digit is the registration category). */
export function makeNationalId(r) {
  const first12 = String(1 + Math.floor(r() * 8)) + digits(r, 11)
  return first12 + nationalIdCheckDigit(first12)
}
/** 1-2345-67890-12-3, the way it is printed on the card. */
export const dashId = (d) =>
  `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}`
export const spaceId = (d) => dashId(d).replaceAll('-', ' ')

// ---------- payment cards: Luhn + real issuer prefix ----------

export function luhnValid(value) {
  const d = onlyDigits(value)
  let sum = 0
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i])
    if (i % 2 === 1) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
  }
  return d.length >= 12 && sum % 10 === 0
}
function luhnComplete(partial) {
  for (let c = 0; c < 10; c++) if (luhnValid(partial + c)) return partial + c
  throw new Error('unreachable')
}
/** Issuer by prefix and length — the public IIN ranges. null when no known issuer. */
export function cardIssuer(value) {
  const d = onlyDigits(value)
  const p2 = Number(d.slice(0, 2))
  const p4 = Number(d.slice(0, 4))
  if (d[0] === '4' && (d.length === 16 || d.length === 13 || d.length === 19)) return 'visa'
  if (((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) && d.length === 16) return 'mastercard'
  if ((p2 === 34 || p2 === 37) && d.length === 15) return 'amex'
  if (p4 >= 3528 && p4 <= 3589 && d.length === 16) return 'jcb'
  if (p2 === 62 && d.length >= 16 && d.length <= 19) return 'unionpay'
  if (
    (p2 === 36 || (Number(d.slice(0, 3)) >= 300 && Number(d.slice(0, 3)) <= 305)) &&
    d.length === 14
  )
    return 'diners'
  return null
}
export function makeCard(r, issuer) {
  const prefix = {
    visa: () => '4' + digits(r, 5),
    mastercard: () =>
      r() < 0.75
        ? String(51 + Math.floor(r() * 5)) + digits(r, 4)
        : String(2221 + Math.floor(r() * 500)) + digits(r, 2),
    amex: () => pick(r, ['34', '37']) + digits(r, 4),
    jcb: () => String(3528 + Math.floor(r() * 62)) + digits(r, 2),
    unionpay: () => '62' + digits(r, 4),
    diners: () => '36' + digits(r, 4),
  }[issuer]()
  const len = { amex: 15, diners: 14 }[issuer] ?? 16
  return luhnComplete(prefix + digits(r, len - prefix.length - 1))
}
/** 4111 1111 1111 1111 · amex 3782 822463 10005 · diners 3056 930902 5904 */
export function groupCard(d, sep = ' ') {
  if (d.length === 15) return [d.slice(0, 4), d.slice(4, 10), d.slice(10)].join(sep)
  if (d.length === 14) return [d.slice(0, 4), d.slice(4, 10), d.slice(10)].join(sep)
  return d.match(/.{1,4}/g).join(sep)
}

// ---------- phones: mobiles 06/08/09, landlines with real area codes ----------

const MOBILE_PREFIX = [
  '061',
  '062',
  '063',
  '064',
  '065',
  '066',
  '080',
  '081',
  '082',
  '083',
  '084',
  '085',
  '086',
  '087',
  '088',
  '089',
  '090',
  '091',
  '092',
  '093',
  '094',
  '095',
  '096',
  '097',
  '098',
  '099',
]
// Bangkok 02 (+7 digits), provincial 0XX (+6 digits)
export const AREA_CODES = {
  '02': 'กรุงเทพฯ',
  '032': 'ราชบุรี/เพชรบุรี',
  '034': 'นครปฐม/กาญจนบุรี',
  '035': 'อยุธยา',
  '036': 'ลพบุรี/สระบุรี',
  '038': 'ชลบุรี/ระยอง',
  '039': 'จันทบุรี',
  '042': 'อุดรธานี',
  '043': 'ขอนแก่น',
  '044': 'นครราชสีมา',
  '045': 'อุบลราชธานี',
  '053': 'เชียงใหม่',
  '054': 'ลำปาง',
  '055': 'พิษณุโลก',
  '056': 'นครสวรรค์',
  '073': 'ปัตตานี/ยะลา',
  '074': 'สงขลา/หาดใหญ่',
  '075': 'นครศรีธรรมราช/ตรัง/กระบี่',
  '076': 'ภูเก็ต',
  '077': 'สุราษฎร์ธานี',
}
export function makeMobile(r) {
  return pick(r, MOBILE_PREFIX) + digits(r, 7)
}
export function makeLandline(r, area = pick(r, Object.keys(AREA_CODES))) {
  return area === '02'
    ? '02' + String(2 + Math.floor(r() * 8)) + digits(r, 6)
    : area + String(2 + Math.floor(r() * 8)) + digits(r, 5)
}
/** National-form digits (leading 0). Accepts +66 / 66 / no-zero forms. */
export function phoneNational(value) {
  let d = onlyDigits(value)
  if (d.startsWith('66') && (d.length === 11 || d.length === 10)) d = '0' + d.slice(2)
  else if (!d.startsWith('0') && (d.length === 9 || d.length === 8)) d = '0' + d
  return d
}
export function isMobile(value) {
  const d = phoneNational(value)
  return d.length === 10 && MOBILE_PREFIX.includes(d.slice(0, 3))
}
export function isLandline(value) {
  const d = phoneNational(value)
  if (d.length !== 9) return false
  if (d.startsWith('02')) return true
  return Object.hasOwn(AREA_CODES, d.slice(0, 3))
}
export const isPhone = (v) => isMobile(v) || isLandline(v)
export const dashMobile = (d) => `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
export const dashLandline = (d) =>
  d.startsWith('02')
    ? `02-${d.slice(2, 5)}-${d.slice(5)}`
    : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
export const plus66 = (d, sep = ' ') =>
  d.length === 10
    ? `+66${sep}${d.slice(1, 3)}${sep}${d.slice(3, 6)}${sep}${d.slice(6)}`
    : `+66${sep}${d.slice(1, 2)}${sep}${d.slice(2, 5)}${sep}${d.slice(5)}`

// ---------- bank accounts: 10 digits (most banks) or 12 (GSB, BAAC) ----------

export function makeAccount10(r) {
  // branch (3) · type (1) · serial (5) · check (1). Branch codes avoid 06x/08x/09x here so the
  // ordinary pool is not also a mobile number; the ambiguous ones are written by hand.
  return (
    String(1 + Math.floor(r() * 5)) + digits(r, 2) + String(1 + Math.floor(r() * 7)) + digits(r, 6)
  )
}
export function makeAccount12(r) {
  return '0' + String(1 + Math.floor(r() * 9)) + digits(r, 10)
}
export const dashAccount10 = (d) => `${d.slice(0, 3)}-${d.slice(3, 4)}-${d.slice(4, 9)}-${d[9]}`
export const dashAccount12 = (d) => `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}`
export function isAccount(value) {
  const d = onlyDigits(value)
  return /^\d+$/.test(d) && (d.length === 10 || d.length === 12)
}

// ---------- LINE user id: U + 32 lowercase hex ----------

export function makeLineUserId(r) {
  return 'U' + Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join('')
}
export const isLineUserId = (v) => /^U[0-9a-f]{32}$/.test(v)

// ---------- email: written by hand, only shape-checked ----------

export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(v)

/** Validates a labelled value for its entity. Returns null when valid, else the reason. */
export function invalidReason(entity, value) {
  switch (entity) {
    case 'TH_NATIONAL_ID':
      return isNationalId(value) ? null : 'national id checksum or length'
    case 'CREDIT_CARD':
      if (!luhnValid(value)) return 'card fails Luhn'
      return cardIssuer(value) ? null : 'card has no known issuer prefix'
    case 'PHONE':
      return isPhone(value)
        ? null
        : 'not a Thai mobile (06/08/09) or landline with a real area code'
    case 'BANK_ACCOUNT':
      return isAccount(value) ? null : 'account is not 10 or 12 digits'
    case 'LINE_USER_ID':
      return isLineUserId(value) ? null : 'not U + 32 lowercase hex'
    case 'EMAIL':
      return isEmail(value) ? null : 'not an email'
    default:
      return `unknown entity ${entity}`
  }
}
