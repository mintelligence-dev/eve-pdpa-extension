// Prints a pool of valid values to write the benchmark sentences from.
// Open and holdout use different seeds, so no value is shared between them.
//
//   bench/user/run tools/make-values.mjs open      → out/values-open.txt
//   bench/user/run tools/make-values.mjs holdout   → out/values-holdout.txt
import { writeFileSync } from 'node:fs'
import {
  AREA_CODES,
  cardIssuer,
  dashAccount10,
  dashAccount12,
  dashId,
  dashLandline,
  dashMobile,
  groupCard,
  makeAccount10,
  makeAccount12,
  makeCard,
  makeLandline,
  makeLineUserId,
  makeMobile,
  makeNationalId,
  rng,
} from '../lib/values.mjs'

const set = process.argv[2] ?? 'open'
const r = rng(set === 'open' ? 20251013 : 99887766)
const lines = []
const add = (s) => lines.push(s)

add(`# value pool — ${set}`)
add('\n## TH_NATIONAL_ID')
for (let i = 0; i < 36; i++) {
  const d = makeNationalId(r)
  add(`${d}  ${dashId(d)}`)
}
add('\n## CREDIT_CARD')
const issuers = [
  ...Array(14).fill('visa'),
  ...Array(10).fill('mastercard'),
  ...Array(4).fill('jcb'),
  ...Array(4).fill('amex'),
  ...Array(3).fill('unionpay'),
  'diners',
]
for (const issuer of issuers) {
  const d = makeCard(r, issuer)
  add(`${issuer.padEnd(10)} ${d}  ${groupCard(d)}  (${cardIssuer(d)})`)
}
add('\n## PHONE mobile')
for (let i = 0; i < 40; i++) {
  const d = makeMobile(r)
  add(`${d}  ${dashMobile(d)}`)
}
add('\n## PHONE landline')
for (const area of Object.keys(AREA_CODES)) {
  const d = makeLandline(r, area)
  add(`${d}  ${dashLandline(d)}  ${AREA_CODES[area]}`)
}
add('\n## BANK_ACCOUNT')
for (let i = 0; i < 32; i++) {
  const d = makeAccount10(r)
  add(`${d}  ${dashAccount10(d)}`)
}
for (let i = 0; i < 8; i++) {
  const d = makeAccount12(r)
  add(`${d}  ${dashAccount12(d)}`)
}
add('\n## LINE_USER_ID')
for (let i = 0; i < 36; i++) add(makeLineUserId(r))

writeFileSync(`out/values-${set}.txt`, lines.join('\n') + '\n')
console.log(lines.join('\n'))
