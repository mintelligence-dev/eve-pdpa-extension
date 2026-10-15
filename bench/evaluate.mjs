// Runs the built guard over bench/out/dataset.jsonl and scores it the way D5
// defines, then writes bench/out/report.md.
//
//   pnpm build && node bench/generate.mjs && node bench/evaluate.mjs
//
// D5, in short:
//   TP  the right entity type, and the span found covers the whole value
//   FP  something found where no value of that type is
//   FN  a value not found, or not found in full — partial counts as missed
// Overreach (found more than the value) is a TP, reported on its own.
import { readFileSync, writeFileSync } from 'node:fs'
import * as core from '../packages/core/dist/index.js'

const here = (p) => new URL(p, import.meta.url)

/** The six entities 0.1 detects. NAME, ADDRESS and the rest are in the data for 0.2. */
const MEASURED = ['TH_NATIONAL_ID', 'PHONE', 'EMAIL', 'BANK_ACCOUNT', 'CREDIT_CARD', 'LINE_USER_ID']
const THRESHOLD = 0.95

const policy = core.definePolicy({
  entitySet: '0.1',
  onUnmapped: 'redact',
  entities: Object.fromEntries(
    MEASURED.map((e) => [e, { action: 'redact', minConfidence: THRESHOLD }]),
  ),
})
const guard = core.createGuard({ policy, onAudit: () => {} })

const HOLDOUT = process.argv.includes('--holdout')
// --context passes each message's preceding message from the other side, as an
// app following the README would (D10.11).
const WITH_CONTEXT = process.argv.includes('--context')
const REPORT = `report${HOLDOUT ? '-holdout' : ''}${WITH_CONTEXT ? '-context' : ''}.md`
const rows = readFileSync(
  here(HOLDOUT ? './out/dataset-holdout.jsonl' : './out/dataset.jsonl'),
  'utf8',
)
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l))

const blank = () => ({ gold: 0, tp: 0, fp: 0, fn: 0, partial: 0, crossType: 0, overreach: 0 })
const byEntity = Object.fromEntries(MEASURED.map((e) => [e, blank()]))
const byTransform = {}
const byBoundary = { inbound: blank(), outbound: blank() }
const bySet = {}
const valueOnly = blank()
/** PHONE by how it was written: `known` shapes the detector was built for, `added` ones from D17. */
const byStyle = {}
/** Values that are not personal data. Anything found on one is an FP (D17). */
const decoys = {}
const decoyExamples = []
const fpExamples = Object.fromEntries(MEASURED.map((e) => [e, []]))
const fnExamples = Object.fromEntries(MEASURED.map((e) => [e, []]))

const covers = (p, g) => p.start <= g.start && p.end >= g.end
const overlaps = (p, g) => p.start < g.end && g.start < p.end
const bump = (bucket, key) => {
  bucket[key]++
}

for (const row of rows) {
  const found = guard
    .processSync(row.text, {
      boundary: row.boundary,
      ...(WITH_CONTEXT && row.prevOther ? { context: row.prevOther } : {}),
    })
    .findings.map((f) => ({ entity: f.entity, start: f.start, end: f.end }))
  const gold = row.spans.filter((s) => MEASURED.includes(s.entity))
  bySet[row.set] ??= blank()

  for (const g of gold) {
    const buckets = [byEntity[g.entity], byBoundary[row.boundary], bySet[row.set]]
    if (row.valueOnly) buckets.push(valueOnly)
    for (const t of g.transforms.length ? g.transforms : ['none']) {
      byTransform[t] ??= blank()
      buckets.push(byTransform[t])
    }
    if (g.style !== undefined) {
      byStyle[g.style] ??= { ...blank(), group: g.group }
      buckets.push(byStyle[g.style])
    }
    for (const b of buckets) bump(b, 'gold')

    const same = found.filter((p) => p.entity === g.entity && overlaps(p, g))
    const hit = same.find((p) => covers(p, g))
    if (hit) {
      for (const b of buckets) bump(b, 'tp')
      if (hit.start < g.start || hit.end > g.end) bump(byEntity[g.entity], 'overreach')
      continue
    }
    for (const b of buckets) bump(b, 'fn')
    if (same.length > 0) bump(byEntity[g.entity], 'partial')
    // Hidden, but under the wrong type: protected in practice, wrong in the audit.
    else if (found.some((p) => p.entity !== g.entity && covers(p, g)))
      bump(byEntity[g.entity], 'crossType')
    const why = same.length > 0 ? 'partial' : 'missed'
    if (fnExamples[g.entity].length < 8) {
      fnExamples[g.entity].push(`${why} · ${row.text.slice(Math.max(0, g.start - 30), g.end + 15)}`)
    }
  }

  for (const d of row.spans.filter((s) => s.entity === 'DECOY')) {
    decoys[d.kind] ??= { count: 0, flagged: 0, as: {} }
    const bucket = decoys[d.kind]
    bucket.count++
    const hit = found.find((p) => MEASURED.includes(p.entity) && overlaps(p, d))
    if (!hit) continue
    bucket.flagged++
    bucket.as[hit.entity] = (bucket.as[hit.entity] ?? 0) + 1
    if (decoyExamples.length < 8) {
      decoyExamples.push(
        `${d.kind} → ${hit.entity} · ${row.text.slice(Math.max(0, d.start - 30), d.end + 15)}`,
      )
    }
  }

  for (const p of found) {
    if (!MEASURED.includes(p.entity)) continue
    if (gold.some((g) => g.entity === p.entity && overlaps(p, g))) continue
    bump(byEntity[p.entity], 'fp')
    bump(byBoundary[row.boundary], 'fp')
    bump(bySet[row.set], 'fp')
    if (fpExamples[p.entity].length < 8) {
      fpExamples[p.entity].push(
        `${row.text.slice(p.start, p.end)} · ${row.text.slice(Math.max(0, p.start - 30), p.end + 15)}`,
      )
    }
  }
}

// ---------------------------------------------------------------- report

const pct = (n, d) => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`)
const precision = (b) => pct(b.tp, b.tp + b.fp)
const recall = (b) => pct(b.tp, b.tp + b.fn)

const total = Object.values(byEntity).reduce((a, b) => {
  for (const k of Object.keys(a)) a[k] += b[k]
  return a
}, blank())

const L = []
L.push(
  HOLDOUT
    ? '# eve-pdpa-extension benchmark — holdout set'
    : '# eve-pdpa-extension benchmark — development set',
)
L.push('')
L.push(
  WITH_CONTEXT ? 'Run with `context` = the other side’s last message.' : 'Run without `context`.',
)
L.push('')
L.push(
  `engine ${core.VERSION} · policy ${policy.hash} · threshold ${THRESHOLD} · detectors ${core.BUILTIN_DETECTORS.map((d) => d.id).join(', ')}`,
)
L.push(
  `${rows.length} messages (${rows.filter((r) => r.boundary === 'inbound').length} inbound, ${rows.filter((r) => r.boundary === 'outbound').length} outbound) · ${total.gold} values of the six 0.1 entities`,
)
L.push('')
L.push(
  '> The data is synthetic. It measures only the patterns its authors thought of, and real chats always hold patterns nobody thought of. Every number here is an **upper bound** on real-world performance, not what production will see. (D5)',
)
L.push('')
L.push('## By entity')
L.push('')
L.push('| entity | values | TP | FP | FN | precision | recall | partial | wrong type | overreach |')
L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
for (const e of MEASURED) {
  const b = byEntity[e]
  L.push(
    `| ${e} | ${b.gold} | ${b.tp} | ${b.fp} | ${b.fn} | ${precision(b)} | ${recall(b)} | ${b.partial} | ${b.crossType} | ${b.overreach} |`,
  )
}
L.push(
  `| **all** | ${total.gold} | ${total.tp} | ${total.fp} | ${total.fn} | ${precision(total)} | ${recall(total)} | ${total.partial} | ${total.crossType} | ${total.overreach} |`,
)
L.push('')
L.push(
  '`partial` and `wrong type` are FNs, broken out. Wrong type means the value was hidden but labelled as another entity.',
)
L.push('')
L.push('## Recall by disguise')
L.push('')
L.push('| applied to the value | values | recall |')
L.push('|---|---:|---:|')
for (const [t, b] of Object.entries(byTransform).sort())
  L.push(`| ${t} | ${b.gold} | ${recall(b)} |`)
L.push('')
L.push('## PHONE recall by format')
L.push('')
L.push(
  '`known`: shapes the 0.1 detector was written for. `added`: other ways people write a number (D17). The share of each group in the data is invented — compare rows, not the total.',
)
L.push('')
L.push('| format | group | values | recall |')
L.push('|---|---|---:|---:|')
for (const [k, b] of Object.entries(byStyle).sort(
  ([a, x], [c, y]) => x.group.localeCompare(y.group) || a.localeCompare(c),
))
  L.push(`| ${k} | ${b.group} | ${b.gold} | ${recall(b)} |`)
L.push('')
L.push('## Decoys')
L.push('')
L.push(
  'Values that look like personal data and are not. Each one flagged is also counted as an FP above.',
)
L.push('')
L.push('| decoy | values | flagged | flagged as |')
L.push('|---|---:|---:|---|')
for (const [k, b] of Object.entries(decoys).sort())
  L.push(
    `| ${k} | ${b.count} | ${b.flagged} | ${
      Object.entries(b.as)
        .map(([e, n]) => `${e} ${n}`)
        .join(', ') || '—'
    } |`,
  )
for (const x of decoyExamples) L.push(`- ${x.replace(/\n/g, ' ')}`)
L.push('')
L.push('## Recall when the message is only the value')
L.push('')
L.push(
  'The question was in the message before — "your account number?" — and the reply is the number alone. The guard sees one message at a time.',
)
L.push('')
L.push(`${valueOnly.gold} values · recall ${recall(valueOnly)}`)
L.push('')
L.push('## By direction')
L.push('')
L.push('| boundary | values | precision | recall |')
L.push('|---|---:|---:|---:|')
for (const [k, b] of Object.entries(byBoundary))
  L.push(`| ${k} | ${b.gold} | ${precision(b)} | ${recall(b)} |`)
L.push('')
L.push('## By template set')
L.push('')
L.push('| set | values | precision | recall |')
L.push('|---|---:|---:|---:|')
for (const [k, b] of Object.entries(bySet).sort())
  L.push(`| ${k} | ${b.gold} | ${precision(b)} | ${recall(b)} |`)
L.push('')
L.push('## Examples')
L.push('')
for (const e of MEASURED) {
  if (fnExamples[e].length === 0 && fpExamples[e].length === 0) continue
  L.push(`### ${e}`)
  for (const x of fnExamples[e]) L.push(`- FN ${x.replace(/\n/g, ' ')}`)
  for (const x of fpExamples[e]) L.push(`- FP ${x.replace(/\n/g, ' ')}`)
  L.push('')
}

writeFileSync(here(`./out/${REPORT}`), `${L.join('\n')}\n`)

console.log('entity            values  precision  recall   partial  wrong-type')
for (const e of MEASURED) {
  const b = byEntity[e]
  console.log(
    `${e.padEnd(17)} ${String(b.gold).padStart(6)}  ${precision(b).padStart(9)}  ${recall(b).padStart(6)}   ${String(b.partial).padStart(7)}  ${String(b.crossType).padStart(10)}`,
  )
}
console.log(`value-only replies: ${valueOnly.gold} · recall ${recall(valueOnly)}`)
const group = (name) =>
  Object.values(byStyle)
    .filter((b) => b.group === name)
    .reduce((a, b) => ({ tp: a.tp + b.tp, fn: a.fn + b.fn, gold: a.gold + b.gold }), {
      tp: 0,
      fn: 0,
      gold: 0,
    })
for (const name of ['known', 'added']) {
  const b = group(name)
  console.log(`PHONE ${name} formats: ${b.gold} · recall ${recall(b)}`)
}
const d = Object.values(decoys).reduce(
  (a, b) => ({ count: a.count + b.count, flagged: a.flagged + b.flagged }),
  { count: 0, flagged: 0 },
)
console.log(`decoys: ${d.count} · flagged ${d.flagged}`)
console.log(`→ bench/out/${REPORT}`)
