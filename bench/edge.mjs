// Runs hand-written edge cases against the built guard and says, case by case,
// what went wrong. The synthetic benchmark (generate.mjs + evaluate.mjs) answers
// "how good is it on average"; this answers "which exact sentences break it".
//
//   pnpm --filter @thai-pdpa-guard/core build
//   node bench/edge.mjs [--set open|sealed] [--detail]
//
// Cases live in bench/edge/<set>/*.json, written by a tester that has never read
// the detector source. The `open` set is handed to whoever fixes the detectors;
// the `sealed` set is not, and exists to show whether a fix generalised or only
// learned the open cases. For the same reason --set sealed prints counts and ids
// only, unless --detail is passed by someone allowed to see the text.
//
// A case file is { "cases": [ … ] }, each case:
//
//   {
//     "id": "id-after-amount",
//     "text": "ยอด 500 [[TH_NATIONAL_ID:1234567890121]]",
//     "context": "ขอเลขบัตรประชาชนด้วยค่ะ",   // optional: the other side's last message
//     "boundary": "inbound",                  // optional, default inbound
//     "note": "a short number before an id"   // optional: why the case exists
//   }
//
//   [[ENTITY:value]]   personal data that must be found, whole, as ENTITY
//   [[~KIND:value]]    a decoy: looks like personal data, is not; must not be found
//   anything else      must not be found either — any finding there is an FP
//
// Scoring follows D5: a value found only in part is a miss.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as core from '../packages/core/dist/index.js'

const here = (p) => new URL(p, import.meta.url)
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i < 0 ? fallback : process.argv[i + 1]
}

const SET = arg('set', 'open')
const DETAIL = SET !== 'sealed' || process.argv.includes('--detail')
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

const MARK = /\[\[(~?)([A-Z_]+):(.*?)\]\]/gs

/** Strips the markers and returns the plain text with the spans they marked. */
function parse(marked) {
  let text = ''
  let at = 0
  const gold = []
  const decoys = []
  for (const m of marked.matchAll(MARK)) {
    text += marked.slice(at, m.index)
    const span = { kind: m[2], start: text.length, end: text.length + m[3].length }
    text += m[3]
    at = m.index + m[0].length
    if (m[1] === '~') decoys.push(span)
    else if (MEASURED.includes(m[2])) gold.push(span)
    else throw new Error(`unknown entity "${m[2]}" — use one of ${MEASURED.join(', ')}`)
  }
  return { text: text + marked.slice(at), gold, decoys }
}

const covers = (p, g) => p.start <= g.start && p.end >= g.end
const overlaps = (p, g) => p.start < g.end && g.start < p.end

function judge(c) {
  const { text, gold, decoys } = parse(c.text)
  const found = guard
    .processSync(text, {
      boundary: c.boundary ?? 'inbound',
      ...(c.context ? { context: c.context } : {}),
    })
    .findings.map((f) => ({ entity: f.entity, start: f.start, end: f.end }))
    .filter((f) => MEASURED.includes(f.entity))

  const problems = []
  for (const g of gold) {
    const value = text.slice(g.start, g.end)
    const same = found.filter((p) => p.entity === g.kind && overlaps(p, g))
    if (same.some((p) => covers(p, g))) continue
    if (same.length > 0) {
      const got = same.map((p) => text.slice(p.start, p.end)).join(' | ')
      problems.push({ type: 'partial', entity: g.kind, value, got })
      continue
    }
    const other = found.find((p) => p.entity !== g.kind && covers(p, g))
    if (other) problems.push({ type: 'wrong-type', entity: g.kind, value, got: other.entity })
    else problems.push({ type: 'missed', entity: g.kind, value })
  }
  for (const d of decoys) {
    const hit = found.find((p) => overlaps(p, d))
    if (hit) {
      problems.push({
        type: 'decoy-flagged',
        entity: hit.entity,
        value: text.slice(d.start, d.end),
        decoy: d.kind,
      })
    }
  }
  for (const p of found) {
    if (gold.some((g) => overlaps(p, g)) || decoys.some((d) => overlaps(p, d))) continue
    problems.push({ type: 'false-positive', entity: p.entity, value: text.slice(p.start, p.end) })
  }
  return { text, problems }
}

const dir = here(`./edge/${SET}/`)
if (!existsSync(dir)) {
  console.error(`no cases: bench/edge/${SET}/ does not exist`)
  process.exit(1)
}

const results = []
const ids = new Set()
for (const file of readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()) {
  const { cases } = JSON.parse(readFileSync(new URL(file, dir), 'utf8'))
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`duplicate case id "${c.id}" in ${file}`)
    ids.add(c.id)
    let outcome
    try {
      outcome = judge(c)
    } catch (err) {
      outcome = { text: c.text, problems: [{ type: 'bad-case', value: String(err.message) }] }
    }
    results.push({ file, id: c.id, note: c.note, context: c.context, ...outcome })
  }
}

const failed = results.filter((r) => r.problems.length > 0)
const byType = {}
for (const r of failed) for (const p of r.problems) byType[p.type] = (byType[p.type] ?? 0) + 1

const lines = [
  `# Edge cases — ${SET}`,
  '',
  `${results.length} cases · ${results.length - failed.length} pass · ${failed.length} fail · threshold ${THRESHOLD} · core ${core.VERSION}`,
  '',
  ...Object.entries(byType).map(([t, n]) => `- ${t}: ${n}`),
  '',
]
for (const r of failed) {
  lines.push(`## ${r.id} (${r.file})`)
  if (!DETAIL) {
    lines.push(`- ${r.problems.map((p) => `${p.type} ${p.entity ?? ''}`.trim()).join(', ')}`, '')
    continue
  }
  lines.push('', '```', r.text, '```')
  if (r.context) lines.push(`context: ${r.context}`)
  if (r.note) lines.push(`note: ${r.note}`)
  for (const p of r.problems) {
    const extra = p.got ? ` → got ${JSON.stringify(p.got)}` : p.decoy ? ` (decoy ${p.decoy})` : ''
    lines.push(`- **${p.type}** ${p.entity ?? ''} ${JSON.stringify(p.value)}${extra}`)
  }
  lines.push('')
}

mkdirSync(here('./out/'), { recursive: true })
writeFileSync(here(`./out/edge-${SET}.md`), lines.join('\n'))
if (DETAIL) {
  writeFileSync(here(`./out/edge-${SET}.json`), JSON.stringify(failed, null, 2))
}
console.log(lines.slice(0, 4 + Object.keys(byType).length).join('\n'))
console.log(`report: bench/out/edge-${SET}.md`)
