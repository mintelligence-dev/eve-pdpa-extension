// MC — minConfidence: default 0.95, per entity, the unknown-issuer card at 0.6.
//   bench/user/run features/min-confidence.check.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parsePolicy } from '@thai-pdpa-guard/core'
import { check, makeGuard } from '../lib/kit.mjs'

const REF = 'เลขอ้างอิง 9000123456789016 ค่ะ' // Luhn-valid, no known issuer (CLI README example m5)
const PHONE = 'เบอร์ 091-888-7777 ค่ะ' // confidence 0.99 in the README audit example

check(
  'MC1 default threshold 0.95: an unknown-issuer card (0.6) is left alone and not reported',
  () => {
    const { guard, scans } = makeGuard({ entities: { CREDIT_CARD: { action: 'redact' } } })
    const r = guard.processSync(REF)
    assert.equal(r.text, REF)
    assert.deepEqual(r.findings, [])
    assert.deepEqual(scans()[0].findings, [])
  },
)

check('MC2 minConfidence 0.6 acts on it', () => {
  const { guard } = makeGuard({
    entities: { CREDIT_CARD: { action: 'redact', minConfidence: 0.6 } },
  })
  const r = guard.processSync(REF)
  assert.equal(r.text, 'เลขอ้างอิง [บัตรเครดิต] ค่ะ')
  assert.equal(r.findings[0].confidence, 0.6)
})

check(
  'MC3 the threshold is per entity: lowering it for PHONE does not lower it for CREDIT_CARD',
  () => {
    const { guard } = makeGuard({
      entities: {
        CREDIT_CARD: { action: 'redact' },
        PHONE: { action: 'redact', minConfidence: 0.6 },
      },
    })
    assert.equal(guard.processSync(REF).text, REF)
  },
)

check('MC4 minConfidence 1 leaves a 0.99 finding alone; 0 acts on everything found', () => {
  const strict = makeGuard({ entities: { PHONE: { action: 'redact', minConfidence: 1 } } }).guard
  assert.equal(strict.processSync(PHONE).text, PHONE)
  const lax = makeGuard({ entities: { CREDIT_CARD: { action: 'redact', minConfidence: 0 } } }).guard
  assert.equal(lax.processSync(REF).text, 'เลขอ้างอิง [บัตรเครดิต] ค่ะ')
})

check(
  'MC5 README policy: CREDIT_CARD block + 0.6 blocks the reference number 9000123456789016',
  () => {
    const { guard } = makeGuard(parsePolicy(readFileSync('policies/readme-example.json', 'utf8')))
    const r = guard.processSync(REF, { sessionId: 's' })
    assert.equal(r.outcome, 'blocked')
    assert.deepEqual(r.blockedBy, ['CREDIT_CARD'])
    assert.equal(r.text, '')
  },
)
