// ST — guard.stats and onError when the audit sink fails, and the missing-onAudit warning.
//   bench/user/run features/stats-onerror.check.mjs
import assert from 'node:assert/strict'
import { createGuard, definePolicy } from '@eve-pdpa-extension/core'
import { allRules, check, sleep } from '../lib/kit.mjs'

const policy = definePolicy({ entitySet: '0.1', entities: allRules({ action: 'redact' }) })

check('ST1 guard.stats starts at zero', () => {
  const g = createGuard({ policy, onAudit: () => {} })
  assert.deepEqual({ ...g.stats }, { auditSinkErrors: 0, tokenStoreErrors: 0 })
})

check(
  'ST2 onAudit throws → the message still goes through, auditSinkErrors +1, onError(err, {source: "audit_sink", eventType})',
  () => {
    const errors = []
    const boom = new Error('log store down')
    const g = createGuard({
      policy,
      onAudit: (e) => {
        if (e.type === 'scan') throw boom
      },
      onError: (error, ctx) => errors.push({ error, ctx }),
    })
    const r = g.processSync('เบอร์ 0918887777')
    assert.equal(r.text, 'เบอร์ [เบอร์โทร]')
    assert.equal(g.stats.auditSinkErrors, 1)
    assert.equal(errors.length, 1)
    assert.equal(errors[0].error, boom)
    assert.deepEqual({ ...errors[0].ctx }, { source: 'audit_sink', eventType: 'scan' })
  },
)

check('ST3 onAudit returning a rejected Promise is counted when it rejects', async () => {
  const errors = []
  const g = createGuard({
    policy,
    onAudit: async (e) => {
      if (e.type === 'scan') throw new Error('async sink down')
    },
    onError: (error, ctx) => errors.push(ctx),
  })
  const r = g.processSync('เบอร์ 0918887777')
  assert.equal(r.text, 'เบอร์ [เบอร์โทร]')
  await sleep(10)
  assert.equal(g.stats.auditSinkErrors, 1)
  assert.deepEqual(
    errors.map((c) => ({ ...c })),
    [{ source: 'audit_sink', eventType: 'scan' }],
  )
})

check('ST4 an onError that throws is ignored', async () => {
  const g = createGuard({
    policy,
    onAudit: () => {
      throw new Error('a')
    },
    onError: () => {
      throw new Error('b')
    },
  })
  assert.equal(g.processSync('เบอร์ 0918887777').text, 'เบอร์ [เบอร์โทร]')
  assert.equal((await g.process('hi')).text, 'hi')
})

/** Captures console.warn / console.error / process.emitWarning while fn runs. */
function captureWarnings(fn) {
  const seen = []
  const saved = { warn: console.warn, error: console.error, emit: process.emitWarning }
  console.warn = (...a) => seen.push(`console.warn: ${a.join(' ')}`)
  console.error = (...a) => seen.push(`console.error: ${a.join(' ')}`)
  process.emitWarning = (w, ...rest) =>
    seen.push(`emitWarning: ${w?.message ?? w} ${JSON.stringify(rest)}`)
  try {
    fn()
  } finally {
    console.warn = saved.warn
    console.error = saved.error
    process.emitWarning = saved.emit
  }
  return seen
}

check('ST5 no onAudit → events are discarded with one warning, once', (t) => {
  const seen = captureWarnings(() => {
    const g = createGuard({ policy })
    g.processSync('เบอร์ 0918887777')
    g.processSync('เบอร์ 0811111111')
    const g2 = createGuard({ policy })
    g2.processSync('hi')
  })
  t.diagnostic(seen.join(' || '))
  assert.equal(seen.length, 1, 'exactly one warning')
  assert.ok(!seen[0].includes('0918887777'))
})

check('ST6 onAudit: () => {} discards on purpose, without the warning', () => {
  const seen = captureWarnings(() => {
    const g = createGuard({ policy, onAudit: () => {} })
    g.processSync('เบอร์ 0918887777')
  })
  assert.deepEqual(seen, [])
})

check('ST7 onAudit throwing on policy.loaded does not stop createGuard; it is counted', () => {
  const errors = []
  const g = createGuard({
    policy,
    onAudit: () => {
      throw new Error('sink not ready')
    },
    onError: (e, ctx) => errors.push(ctx),
  })
  assert.equal(g.stats.auditSinkErrors, 1)
  assert.deepEqual({ ...errors[0] }, { source: 'audit_sink', eventType: 'policy.loaded' })
  assert.equal(g.processSync('เบอร์ 0918887777').text, 'เบอร์ [เบอร์โทร]')
  assert.equal(g.stats.auditSinkErrors, 2)
})
