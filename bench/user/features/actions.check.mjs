// AC — the six actions, on the README's own sentence, then on every entity.
//   bench/user/run features/actions.check.mjs
import assert from 'node:assert/strict'
import { ACTIONS } from '@eve-pdpa-extension/core'
import { check, makeGuard } from '../lib/kit.mjs'

const TEXT = 'เบอร์ 091-888-7777 ค่ะ'
const phone = (rule) => makeGuard({ entities: { PHONE: rule } }).guard

check('AC1 redact → "เบอร์ [เบอร์โทร] ค่ะ"', () => {
  assert.equal(phone({ action: 'redact' }).processSync(TEXT).text, 'เบอร์ [เบอร์โทร] ค่ะ')
})
check('AC2 mask → "เบอร์ xxx-xxx-xxxx ค่ะ"', () => {
  assert.equal(phone({ action: 'mask' }).processSync(TEXT).text, 'เบอร์ xxx-xxx-xxxx ค่ะ')
})
check('AC3 mask + keep last4 → "เบอร์ xxx-xxx-7777 ค่ะ"', () => {
  assert.equal(
    phone({ action: 'mask', keep: 'last4' }).processSync(TEXT).text,
    'เบอร์ xxx-xxx-7777 ค่ะ',
  )
})
check('AC4 tokenise → "เบอร์ [tok:<16 letters>] ค่ะ"', () => {
  const r = phone({ action: 'tokenise', allowedPurposes: ['otp_send'] }).processSync(TEXT, {
    sessionId: 's',
  })
  assert.match(r.text, /^เบอร์ \[tok:[bcdfghjkmnpqrstv]{16}\] ค่ะ$/)
})
check('AC5 hash → "เบอร์ [PHONE:<16 letters>] ค่ะ"', () => {
  assert.match(phone({ action: 'hash' }).processSync(TEXT).text, /^เบอร์ \[PHONE:[a-z]{16}\] ค่ะ$/)
})
check('AC6 flag → the text as typed, the finding recorded with action flag', () => {
  const { guard, scans } = makeGuard({ entities: { PHONE: { action: 'flag' } } })
  const r = guard.processSync(TEXT)
  assert.equal(r.text, TEXT)
  assert.equal(r.outcome, 'processed')
  assert.equal(r.findings[0].action, 'flag')
  assert.equal(scans()[0].findings[0].action, 'flag')
})
check('AC7 block → text "", outcome blocked, blockedBy ["PHONE"]', () => {
  const r = phone({ action: 'block' }).processSync(TEXT)
  assert.equal(r.text, '')
  assert.equal(r.outcome, 'blocked')
  assert.deepEqual(r.blockedBy, ['PHONE'])
})

// One sample per entity, with separators where the value has them.
const SAMPLES = {
  TH_NATIONAL_ID: '1-1037-02071-81-1',
  PHONE: '091-888-7777',
  BANK_ACCOUNT: '123-4-56789-0',
  CREDIT_CARD: '4111 1111 1111 1111',
  EMAIL: 'somchai.k@gmail.com',
  LINE_USER_ID: 'U4af4980629f1ae0b2b5c2f7a7b2e9c3d',
}
const CUE = {
  TH_NATIONAL_ID: 'เลขบัตร',
  PHONE: 'เบอร์',
  BANK_ACCOUNT: 'เลขบัญชี',
  CREDIT_CARD: 'บัตร',
  EMAIL: 'เมล',
  LINE_USER_ID: 'userId',
}
const masked = (entity, rule) => {
  const g = makeGuard({ entities: { [entity]: rule } }).guard
  const out = g.processSync(`${CUE[entity]} ${SAMPLES[entity]} ค่ะ`).text
  return out.slice(CUE[entity].length + 1, out.length - ' ค่ะ'.length)
}

check('AC8 mask without keep hides everything except separators (digit entities)', () => {
  for (const e of ['TH_NATIONAL_ID', 'PHONE', 'BANK_ACCOUNT', 'CREDIT_CARD']) {
    assert.equal(masked(e, { action: 'mask' }), SAMPLES[e].replace(/[0-9]/g, 'x'), e)
  }
})

check('AC8b mask on EMAIL and LINE_USER_ID — "everything except separators"', (t) => {
  // The schema does not say what the separators of an email are; '@' and '.' would be the obvious ones.
  const email = masked('EMAIL', { action: 'mask' })
  const line = masked('LINE_USER_ID', { action: 'mask' })
  t.diagnostic(`EMAIL ${SAMPLES.EMAIL} → ${email} · LINE_USER_ID → ${line}`)
  assert.ok(
    !/[a-wyz0-9]/.test(email) && !/[a-wyz0-9]/.test(line),
    'no character of the value survives',
  )
  assert.equal(
    email,
    'xxxxxxx.x@xxxxx.xxx',
    'separators (@ and .) are kept as they are for phone dashes',
  )
})

check('AC9 mask + keep last4 leaves the last four characters visible — every entity', () => {
  const expected = {
    TH_NATIONAL_ID: 'x-xxxx-xxxx1-81-1',
    PHONE: 'xxx-xxx-7777',
    BANK_ACCOUNT: 'xxx-x-xx789-0',
    CREDIT_CARD: 'xxxx xxxx xxxx 1111',
    EMAIL: 'xxxxxxxxxxxxxxx.com',
    LINE_USER_ID: `${'x'.repeat(29)}9c3d`,
  }
  for (const e of Object.keys(SAMPLES))
    assert.equal(masked(e, { action: 'mask', keep: 'last4' }), expected[e], e)
})

check('AC10 each finding carries the action its rule names', () => {
  for (const action of ACTIONS) {
    const rule = action === 'tokenise' ? { action, allowedPurposes: ['p'] } : { action }
    const r = phone(rule).processSync(TEXT, { sessionId: 's' })
    assert.equal(r.findings[0].action, action)
  }
})
