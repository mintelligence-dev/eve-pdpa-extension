// How does processing time grow with one long run of digits (no value found in it)?
//   bench/user/run examples/probe-digit-runs.mjs
import { createGuard, definePolicy, ENTITY_TYPES } from '@thai-pdpa-guard/core'

const guard = createGuard({
  policy: definePolicy({
    entitySet: '0.1',
    entities: Object.fromEntries(ENTITY_TYPES.map((e) => [e, { action: 'redact' }])),
  }),
  onAudit: () => {},
})
const time = (text) => {
  const t0 = performance.now()
  const r = guard.processSync(text)
  return [performance.now() - t0, r.findings.length]
}
for (const [label, make] of [
  ['"1" × n', (n) => '1'.repeat(n)],
  ['"1 " × n/2', (n) => '1 '.repeat(n / 2)],
  ['"12-" × n/3', (n) => '12-'.repeat(Math.floor(n / 3))],
  ['random digits', (n) => Array.from({ length: n }, (_, i) => String((i * 7919) % 10)).join('')],
]) {
  const row = []
  for (const n of [2_500, 5_000, 10_000, 20_000]) {
    const [ms, found] = time(make(n))
    row.push(`${n}: ${ms.toFixed(0)} ms (${found} found)`)
  }
  console.log(label.padEnd(16), row.join(' · '))
}
