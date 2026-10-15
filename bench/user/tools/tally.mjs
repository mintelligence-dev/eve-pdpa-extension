// Pass/fail counts from the last feature run (out/features-all.json), and the failing test ids.
//   bench/user/run tools/tally.mjs
import { readFileSync } from 'node:fs'

const results = JSON.parse(readFileSync('out/features-all.json', 'utf8'))
const entries = Object.entries(results)
const failed = entries.filter(([, v]) => v !== 'pass')
console.log(
  `feature checks: ${entries.length} · pass ${entries.length - failed.length} · fail ${failed.length}`,
)
for (const [k, v] of failed) console.log(`  ${k.split(' ')[0].padEnd(6)} ${v.slice(0, 110)}`)
