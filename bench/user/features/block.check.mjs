// BL — block: no text at all, blockedBy, and what audit says.
//   bench/user/run features/block.check.mjs
import assert from 'node:assert/strict'
import { check, makeGuard } from '../lib/kit.mjs'

const rules = {
  CREDIT_CARD: { action: 'block' },
  TH_NATIONAL_ID: { action: 'block' },
  PHONE: { action: 'redact' },
  EMAIL: { action: 'mask' },
}

check('BL1 a blocked message returns text "", outcome blocked and blockedBy', () => {
  const { guard } = makeGuard({ entities: rules })
  const r = guard.processSync('จ่ายด้วยบัตร 4111 1111 1111 1111 ได้ไหมคะ')
  assert.deepEqual([r.text, r.outcome, r.blockedBy], ['', 'blocked', ['CREDIT_CARD']])
})

check('BL2 blockedBy lists types in reading order, each once', () => {
  const { guard } = makeGuard({ entities: rules })
  const r = guard.processSync(
    'เลขบัตร 1-1037-02071-81-1 บัตร 4111 1111 1111 1111 อีกใบ 5555 5555 5555 4444 และบัตรประชาชนแม่ 3-1005-00123-45-8?',
  )
  assert.deepEqual(r.blockedBy, ['TH_NATIONAL_ID', 'CREDIT_CARD'])
})

check('BL3 blockedBy is absent unless blocked', () => {
  const { guard } = makeGuard({ entities: rules })
  const r = guard.processSync('เบอร์ 0918887777')
  assert.equal(r.outcome, 'processed')
  assert.equal('blockedBy' in r, false)
})

check('BL4 findings are still listed and the audit event says outcome blocked', () => {
  const { guard, scans } = makeGuard({ entities: rules })
  const r = guard.processSync('บัตร 4111 1111 1111 1111 เบอร์ 0918887777')
  assert.deepEqual(
    r.findings.map((f) => [f.entity, f.action]),
    [
      ['CREDIT_CARD', 'block'],
      ['PHONE', 'redact'],
    ],
  )
  assert.equal(scans()[0].outcome, 'blocked')
  assert.equal(scans()[0].findings.length, 2)
})

check('BL5 one blocked value stops the whole message, whatever the other actions', () => {
  const { guard } = makeGuard({ entities: rules })
  const r = guard.processSync('สวัสดีค่ะ เมล a@b.co โทร 0918887777 บัตร 4111111111111111 ขอบคุณค่ะ')
  assert.equal(r.text, '')
})
