// BD — boundaries: inbound by default, all five recorded, detection the same everywhere.
//   bench/user/run features/boundaries.check.mjs
import assert from 'node:assert/strict'
import { BOUNDARIES } from '@eve-pdpa-extension/core'
import { allRules, check, makeGuard, schemaErrors } from '../lib/kit.mjs'

check('BD1 the default boundary is inbound', () => {
  const { guard, scans } = makeGuard({ entities: allRules({ action: 'redact' }) })
  guard.processSync('hi')
  assert.equal(scans()[0].boundary, 'inbound')
})

check('BD2 all five boundaries are accepted and recorded', () => {
  const { guard, scans } = makeGuard({ entities: allRules({ action: 'redact' }) })
  for (const boundary of BOUNDARIES) guard.processSync('hi', { boundary })
  assert.deepEqual(
    scans().map((e) => e.boundary),
    [...BOUNDARIES],
  )
})

check(
  'BD3 a boundary that is not one of the five is refused, or at least never written to audit (not documented)',
  (t) => {
    const { guard, scans } = makeGuard({ entities: allRules({ action: 'redact' }) })
    let outcome
    try {
      const r = guard.processSync('เบอร์ 0918887777', { boundary: 'Outbound' })
      outcome = `accepted → ${JSON.stringify(r.text)}, audit boundary ${JSON.stringify(scans().at(-1)?.boundary)}`
    } catch (e) {
      outcome = `throws ${e.constructor.name} ${e.code ?? ''}: ${e.message}`
    }
    t.diagnostic(outcome)
    const tok = makeGuard({ entities: { PHONE: { action: 'tokenise', allowedPurposes: ['p'] } } })
    const token = tok.guard.processSync('เบอร์ 0918887777', { sessionId: 's' }).text.slice(6)
    try {
      t.diagnostic(
        `a reply sent with boundary "Outbound" (typo): ${JSON.stringify(tok.guard.processSync(`ส่ง OTP ไปที่ ${token}`, { sessionId: 's', boundary: 'Outbound' }).text)}`,
      )
    } catch (e) {
      t.diagnostic(`a reply with boundary "Outbound" throws ${e.code ?? e.name}`)
    }
    for (const e of scans()) assert.deepEqual(schemaErrors(e), [])
  },
)

check('BD4 detection and actions are the same at every boundary', () => {
  const { guard } = makeGuard({ entities: allRules({ action: 'redact' }) })
  for (const boundary of BOUNDARIES) {
    assert.equal(
      guard.processSync('เบอร์ 091-888-7777 เมล a.b@gmail.example', { boundary }).text,
      'เบอร์ [เบอร์โทร] เมล [อีเมล]',
      boundary,
    )
  }
})
