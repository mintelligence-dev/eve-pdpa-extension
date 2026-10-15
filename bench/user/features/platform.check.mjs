// PL — performance claim from the CHANGELOG: "a message with 40,000 phone numbers takes about 60 ms",
// "linear in the number of values found".
//   bench/user/run features/platform.check.mjs
import assert from 'node:assert/strict'
import { allRules, check, makeGuard } from '../lib/kit.mjs'

const phones = (n) =>
  Array.from({ length: n }, (_, i) => `08${String(i).padStart(8, '0')}`).join(' ')
function time(guard, text) {
  guard.processSync(text) // warm up
  const runs = []
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now()
    guard.processSync(text)
    runs.push(performance.now() - t0)
  }
  return Math.min(...runs)
}

check(
  'PL1 a message with 40,000 phone numbers takes about 60 ms (allowed: up to 5× that on this machine)',
  (t) => {
    const { guard } = makeGuard({ entities: allRules({ action: 'redact' }) })
    const ms = time(guard, phones(40_000))
    t.diagnostic(`40,000 phones: ${ms.toFixed(1)} ms (redact)`)
    assert.ok(ms < 300, `${ms.toFixed(1)} ms`)
  },
)

check('PL2 time grows linearly with the number of values found', (t) => {
  const { guard } = makeGuard({ entities: allRules({ action: 'redact' }) })
  const a = time(guard, phones(10_000))
  const b = time(guard, phones(40_000))
  t.diagnostic(
    `10,000: ${a.toFixed(1)} ms · 40,000: ${b.toFixed(1)} ms · ratio ${(b / a).toFixed(2)} (linear ≈ 4)`,
  )
  assert.ok(b / a < 8, `ratio ${(b / a).toFixed(2)}`)
})

check(
  'PL3 time also grows linearly with the length of a message that holds long digit runs',
  (t) => {
    // Not a documented claim for this case; the CHANGELOG states linearity for values found. A tool output or a
    // pasted export can hold long digit runs; quadratic growth here blocks the event loop (200,000 digits ≈ 19 s).
    const { guard } = makeGuard({ entities: allRules({ action: 'redact' }) })
    const out = {}
    for (const [k, make] of Object.entries({
      digits: (n) => '1'.repeat(n),
      'digits+dashes': (n) => '12-'.repeat(n / 3),
      'Thai text': (n) => 'ก'.repeat(n),
      '@ signs': (n) => 'a@'.repeat(n / 2),
    })) {
      const a = time(guard, make(6_000))
      const b = time(guard, make(24_000))
      out[k] = b / a
      t.diagnostic(
        `${k}: 6,000 chars ${a.toFixed(1)} ms · 24,000 chars ${b.toFixed(1)} ms · ratio ${(b / a).toFixed(1)} (linear ≈ 4, quadratic ≈ 16)`,
      )
    }
    const bad = Object.entries(out)
      .filter(([, r]) => r > 8)
      .map(([k, r]) => `${k} ×${r.toFixed(1)}`)
    assert.deepEqual(bad, [], 'super-linear growth')
  },
)
