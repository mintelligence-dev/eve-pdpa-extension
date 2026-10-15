// DT — detection of the six entities and the documented limits (README "Known limitations",
// CHANGELOG "Detection", policy.schema.json entity descriptions).
//   bench/user/run features/detection.check.mjs
import assert from 'node:assert/strict'
import { ENTITY_TYPES } from '@thai-pdpa-guard/core'
import { allRules, check, found, makeGuard } from '../lib/kit.mjs'
import {
  dashId,
  groupCard,
  makeCard,
  makeNationalId,
  rng,
  spaceId,
  toThaiDigits,
} from '../lib/values.mjs'

const r = rng(31337)
const { guard } = makeGuard({ entities: allRules({ action: 'redact' }) })
const scan = (text, opts) => found(text, guard.processSync(text, opts))
/** The value is found, as this entity, and the finding covers all of it. */
function assertFound(text, value, entity) {
  const f = scan(text)
  const hit = f.find((x) => x.entity === entity && x.value.includes(value))
  assert.ok(
    hit,
    `${entity} ${JSON.stringify(value)} not found in ${JSON.stringify(text)} — findings: ${JSON.stringify(f)}`,
  )
}
function assertNotFound(text, entity) {
  const f = scan(text).filter((x) => !entity || x.entity === entity)
  assert.deepEqual(
    f,
    [],
    `${entity ?? 'anything'} found in ${JSON.stringify(text)}: ${JSON.stringify(f)}`,
  )
}

const ID = makeNationalId(r)

check(
  'DT1 TH_NATIONAL_ID with a valid check digit — plain, dashed, spaced as on the card, Thai digits',
  () => {
    assertFound(`เลขบัตร ${ID} ค่ะ`, ID, 'TH_NATIONAL_ID')
    assertFound(`เลขบัตร ${dashId(ID)} ค่ะ`, dashId(ID), 'TH_NATIONAL_ID')
    assertFound(`เลขบัตร ${spaceId(ID)} ค่ะ`, spaceId(ID), 'TH_NATIONAL_ID')
    assertFound(`เลขบัตร ${toThaiDigits(dashId(ID))} ค่ะ`, toThaiDigits(dashId(ID)), 'TH_NATIONAL_ID')
  },
)

check(
  'DT1b TH_NATIONAL_ID typed in the groupings customers retype it in (3-3-3-4, 4-4-5, 5-5-3)',
  (t) => {
    // The docs say 13 digits + mod-11, and that the space family is normalised; no grouping is excluded.
    const g = (d, sizes, sep) => {
      let i = 0
      return sizes.map((n) => d.slice(i, (i += n))).join(sep)
    }
    const misses = []
    for (const sep of [' ', '-']) {
      for (const sizes of [
        [3, 3, 3, 4],
        [4, 4, 5],
        [5, 5, 3],
        [4, 4, 4, 1],
      ]) {
        const v = g(ID, sizes, sep)
        const f = scan(`เลขบัตรประชาชน ${v} ค่ะ`)
        const ok = f.some((x) => x.entity === 'TH_NATIONAL_ID' && x.value.includes(v))
        t.diagnostic(`${JSON.stringify(v)} → ${ok ? 'found' : `NOT found ${JSON.stringify(f)}`}`)
        if (!ok) misses.push(`${v} → ${JSON.stringify(f)}`)
      }
    }
    assert.deepEqual(misses, [], 'valid ids with a cue word, not found')
  },
)

check('DT2 TH_NATIONAL_ID with a wrong check digit is not found', () => {
  const bad = ID.slice(0, 12) + String((Number(ID[12]) + 1) % 10)
  assertNotFound(`เลขบัตร ${bad} ค่ะ`, 'TH_NATIONAL_ID')
})

check('DT3 PHONE mobile, national form: 0918887777 · 091-888-7777 · 091 888 7777', () => {
  for (const v of ['0918887777', '091-888-7777', '091 888 7777', '062-559-2791', '080 750 2709'])
    assertFound(`เบอร์ ${v} ค่ะ`, v, 'PHONE')
})

check('DT4 PHONE in +66 form', () => {
  for (const v of ['+66918887777', '+66 91 888 7777', '+66-91-888-7777', '+66 2 123 4567'])
    assertFound(`call ${v} pls`, v, 'PHONE')
})

check('DT5 PHONE landline — Bangkok, provincial, brackets round the area code', () => {
  for (const v of [
    '02-123-4567',
    '021234567',
    '053-123-456',
    '(02) 123-4567',
    '(053) 123-456',
    '076 417 005',
  ])
    assertFound(`ติดต่อ ${v} ค่ะ`, v, 'PHONE')
})

check('DT6 PHONE separated by any dash or by dots', () => {
  for (const sep of ['–', '—', '−', '‑', '‐', '－', '.']) {
    const v = ['091', '888', '7777'].join(sep)
    assertFound(`เบอร์ ${v}`, v, 'PHONE')
  }
})

check('DT7 PHONE with no leading 0, or 66 without +, only beside a cue word', () => {
  assertNotFound('918887777', 'PHONE')
  assertNotFound('66918887777', 'PHONE')
  assertFound('เบอร์ 918887777', '918887777', 'PHONE')
  assertFound('โทร 66918887777', '66918887777', 'PHONE')
})

check('DT8 a landline written with dots needs a cue', () => {
  assertNotFound('02.123.4567', 'PHONE')
  assertFound('โทร 02.123.4567', '02.123.4567', 'PHONE')
})

check('DT9 short public numbers are not found', () => {
  for (const v of ['191', '1669', '1112', '199', '1155']) assertNotFound(`โทร ${v} ได้เลย`, 'PHONE')
})

check('DT10 a phone inside a tracking number, or right after a letter, is found', () => {
  assertFound('เลขพัสดุ TH0956318274', '0956318274', 'PHONE')
  assertFound('x0918887777', '0918887777', 'PHONE')
})

check('DT11 EMAIL — plain, capitals, plus-addressing, sub-domain, Thai text around it', () => {
  for (const v of [
    'somchai.k@gmail.com',
    'SOMCHAI.K@GMAIL.COM',
    'pim+shop@hotmail.co.th',
    'a.b-c_d@mail.cmu.ac.th',
  ]) {
    assertFound(`ส่งไปที่ ${v} นะคะ`, v, 'EMAIL')
    assertFound(`อีเมล${v}ค่ะ`, v, 'EMAIL')
  }
})

check('DT12 BANK_ACCOUNT with a cue word is found; a bare run of digits is not', () => {
  for (const cue of ['เลขบัญชี', 'โอนเข้า'])
    assertFound(`${cue} 123-4-56789-0 ค่ะ`, '123-4-56789-0', 'BANK_ACCOUNT')
  assertNotFound('123-4-56789-0', 'BANK_ACCOUNT')
  assertNotFound('1234567890')
})

check(
  'DT13 CREDIT_CARD with a known issuer prefix (Visa, Mastercard 5x and 2x, Amex, JCB) is found',
  () => {
    for (const issuer of ['visa', 'mastercard', 'mastercard', 'amex', 'jcb']) {
      const d = makeCard(r, issuer)
      assertFound(`บัตร ${groupCard(d)} ค่ะ`, groupCard(d), 'CREDIT_CARD')
      assertFound(`บัตร ${d} ค่ะ`, d, 'CREDIT_CARD')
    }
  },
)

check('DT14 a card number failing Luhn is not found', () => {
  assertNotFound('บัตร 4111 1111 1111 1112', 'CREDIT_CARD')
})

check('DT15 a Luhn-valid card from an unknown issuer gets confidence 0.6', () => {
  const g = makeGuard({ entities: { CREDIT_CARD: { action: 'redact', minConfidence: 0 } } }).guard
  const f = found('เลขอ้างอิง 9000123456789016 ค่ะ', g.processSync('เลขอ้างอิง 9000123456789016 ค่ะ'))
  assert.equal(f.length, 1)
  assert.equal(f[0].entity, 'CREDIT_CARD')
  assert.equal(f[0].confidence, 0.6)
})

check('DT16 LINE_USER_ID: U + 32 hex is found; group (C…) and room (R…) ids are not', () => {
  const hex = '4af4980629f1ae0b2b5c2f7a7b2e9c3d'
  assertFound(`userId U${hex}`, `U${hex}`, 'LINE_USER_ID')
  assertNotFound(`groupId C${hex}`)
  assertNotFound(`roomId R${hex}`)
})

check('DT17 names and addresses are not detected; entitiesSupported lists exactly the six', () => {
  const { guard: g, scans } = makeGuard({ entities: allRules({ action: 'redact' }) })
  const r1 = g.processSync('ส่งคุณสมชาย ใจดี บ้านเลขที่ 99/1 ซ.สุขุมวิท 21 แขวงคลองเตยเหนือ')
  assert.deepEqual(r1.findings, [])
  assert.deepEqual([...scans()[0].engine.entitiesSupported].sort(), [...ENTITY_TYPES].sort())
})
