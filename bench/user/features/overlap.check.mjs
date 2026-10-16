// OV — overlapping matches, settled after the policy has judged each one (CHANGELOG, Detection):
// "a match under its threshold never hides another, matches the policy acts on are hidden together
// as one span, and one that is only flagged never leaves another in the clear. A partly covered
// value is never partly protected."
//   bench/user/run features/overlap.check.mjs
import assert from 'node:assert/strict'
import { BUILTIN_DETECTORS, createEngine, normalise } from '@eve-pdpa-extension/core'
import { check, makeGuard } from '../lib/kit.mjs'

const SAME = 'โอนเข้าพร้อมเพย์ 0918887777 ค่ะ' // PHONE and BANK_ACCOUNT claim the same 10 digits
const NESTED = 'เมล 0918887777@gmail.example นะคะ' // PHONE inside EMAIL
const IN_LINE = 'userId U0918887777abcdef0123456789abcdef' // PHONE inside LINE_USER_ID
const CUED = 'เลขบัญชี 091-888-7777 (พร้อมเพย์)' // a mobile number after the account cue
const ctx = { sessionId: 's', boundary: 'inbound' }
const raw = (t) =>
  createEngine(BUILTIN_DETECTORS)
    .runSync(normalise(t), ctx)
    .raw.map((c) => c.entity)
    .sort()
const run = (entities, text) =>
  makeGuard({ entities }).guard.processSync(text, { sessionId: 's' }).text
const digitsLeft = (text) => /[0-9๐-๙]/.test(text)

check('OV0 (setup) these texts really give overlapping matches of two entities', () => {
  assert.deepEqual(raw(SAME), ['BANK_ACCOUNT', 'PHONE'])
  assert.deepEqual(raw(NESTED), ['EMAIL', 'PHONE'])
  assert.deepEqual(raw(IN_LINE), ['LINE_USER_ID', 'PHONE'])
})

check('OV1 a match under its threshold never hides another', () => {
  assert.equal(
    run(
      { PHONE: { action: 'redact', minConfidence: 1 }, BANK_ACCOUNT: { action: 'redact' } },
      SAME,
    ),
    'โอนเข้าพร้อมเพย์ [เลขบัญชี] ค่ะ',
  )
  assert.equal(
    run(
      { PHONE: { action: 'redact' }, BANK_ACCOUNT: { action: 'redact', minConfidence: 1 } },
      SAME,
    ),
    'โอนเข้าพร้อมเพย์ [เบอร์โทร] ค่ะ',
  )
  assert.equal(
    run({ PHONE: { action: 'redact' }, EMAIL: { action: 'redact', minConfidence: 1 } }, NESTED),
    'เมล [เบอร์โทร]@gmail.example นะคะ',
  )
})

check(
  'OV1b … also when the account cue is what made the digits an account ("เลขบัญชี" + a mobile number)',
  (t) => {
    const out = run(
      { PHONE: { action: 'redact' }, BANK_ACCOUNT: { action: 'redact', minConfidence: 1 } },
      CUED,
    )
    t.diagnostic(
      `PHONE redact, BANK_ACCOUNT under threshold: ${JSON.stringify(out)} — raw matches ${JSON.stringify(raw(CUED))}`,
    )
    assert.ok(
      !digitsLeft(out),
      `a phone number left in the clear under a policy that redacts phones: ${out}`,
    )
  },
)

check('OV2 matches the policy acts on are hidden together as one span', (t) => {
  const a = makeGuard({
    entities: { PHONE: { action: 'redact' }, BANK_ACCOUNT: { action: 'mask' } },
  }).guard.processSync(SAME)
  t.diagnostic(
    `redact + mask on the same digits: ${JSON.stringify(a.text)} findings ${JSON.stringify(a.findings.map((f) => [f.entity, f.start, f.end, f.action]))}`,
  )
  assert.ok(!digitsLeft(a.text))
  assert.equal(
    run({ EMAIL: { action: 'redact' }, PHONE: { action: 'mask' } }, NESTED),
    'เมล [อีเมล] นะคะ',
  )
  assert.equal(
    run({ LINE_USER_ID: { action: 'redact' }, PHONE: { action: 'redact' } }, IN_LINE),
    'userId [LINE ID]',
  )
})

check('OV3 a match that is only flagged never leaves another in the clear', () => {
  for (const entities of [
    { PHONE: { action: 'flag' }, BANK_ACCOUNT: { action: 'redact' } },
    { PHONE: { action: 'redact' }, BANK_ACCOUNT: { action: 'flag' } },
  ]) {
    const out = run(entities, SAME)
    assert.ok(!digitsLeft(out), `${JSON.stringify(entities)} → ${out}`)
  }
  assert.ok(!digitsLeft(run({ EMAIL: { action: 'flag' }, PHONE: { action: 'redact' } }, NESTED)))
  const inLine = run({ LINE_USER_ID: { action: 'flag' }, PHONE: { action: 'redact' } }, IN_LINE)
  assert.ok(!inLine.includes('0918887777'), inLine)
})

check(
  'OV3b … also when the account cue is what made the digits an account (PromptPay = a phone number)',
  (t) => {
    const outs = [CUED, 'เลขบัญชี 0918887777 ค่ะ', 'บัญชีพร้อมเพย์ 0918887777'].map((text) => [
      text,
      run(
        {
          PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'] },
          BANK_ACCOUNT: { action: 'flag' },
        },
        text,
      ),
    ])
    for (const [i, o] of outs)
      t.diagnostic(
        `PHONE tokenise + BANK_ACCOUNT flag: ${JSON.stringify(i)} → ${JSON.stringify(o)}`,
      )
    assert.deepEqual(
      outs.filter(([, o]) => digitsLeft(o)).map(([i]) => i),
      [],
      'phone numbers that reach the model as typed',
    )
  },
)

check('OV4 a partly covered value is never partly protected', (t) => {
  for (const entities of [
    { EMAIL: { action: 'redact' }, PHONE: { action: 'mask' } },
    { EMAIL: { action: 'mask', keep: 'last4' }, PHONE: { action: 'redact' } },
  ]) {
    const out = run(entities, NESTED)
    t.diagnostic(`${JSON.stringify(entities)} → ${JSON.stringify(out)}`)
    assert.ok(!digitsLeft(out) && !out.includes('gmail'), out)
  }
  const flagged = run({ EMAIL: { action: 'flag' }, PHONE: { action: 'redact' } }, NESTED)
  t.diagnostic(
    `EMAIL flag + PHONE redact → ${JSON.stringify(flagged)} (the flagged email ends up partly hidden; the docs do not say which way this goes)`,
  )
})
