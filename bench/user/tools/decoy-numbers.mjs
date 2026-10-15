// Look-alike numbers for decoys, and whether each one happens to pass a checksum.
// A decoy that passes is still not personal data — a timestamp is a timestamp — and the
// benchmark should show what the guard does with it.
//
//   bench/user/run tools/decoy-numbers.mjs
import { cardIssuer, isNationalId, luhnValid, rng } from '../lib/values.mjs'

const r = rng(4242)
console.log('epoch-ms timestamps (13 digits) around Oct 2025:')
for (let i = 0; i < 12; i++) {
  const t = String(1760000000000 + Math.floor(r() * 900000000))
  console.log(' ', t, isNationalId(t) ? 'PASSES mod-11' : '')
}
console.log('16-digit member / gift card numbers:')
for (let i = 0; i < 10; i++) {
  const d = '7' + Array.from({ length: 15 }, () => Math.floor(r() * 10)).join('')
  console.log(' ', d, luhnValid(d) ? `PASSES Luhn issuer=${cardIssuer(d)}` : '')
}
console.log('15-digit Lazada-like order numbers:')
for (let i = 0; i < 8; i++) {
  const d =
    String(4 + Math.floor(r() * 3)) +
    Array.from({ length: 14 }, () => Math.floor(r() * 10)).join('')
  console.log(' ', d, luhnValid(d) ? `PASSES Luhn issuer=${cardIssuer(d)}` : '')
}
console.log('16-digit numbers starting 4 (bank refs):')
for (let i = 0; i < 8; i++) {
  const d = '4' + Array.from({ length: 15 }, () => Math.floor(r() * 10)).join('')
  console.log(' ', d, luhnValid(d) ? `PASSES Luhn issuer=${cardIssuer(d)}` : '')
}
console.log('18-digit LINE message ids:')
for (let i = 0; i < 4; i++)
  console.log(' ', '5' + Array.from({ length: 17 }, () => Math.floor(r() * 10)).join(''))
console.log('32-hex reply tokens:')
for (let i = 0; i < 4; i++)
  console.log(
    ' ',
    Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join(''),
  )
