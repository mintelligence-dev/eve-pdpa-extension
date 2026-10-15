// Detection benchmark.
//
//   bench/user/run bench.mjs                 → out/report-open.md (+ .json)
//   bench/user/run bench.mjs --set holdout   → out/report-holdout.md (+ .json)
//
// Every message goes through a guard whose policy redacts all six entities at the default
// threshold. Customers → boundary inbound, shop replies → outbound, tool output → tool_output.
// Each set runs twice: without context, and with context = the other side's previous message.
//
// Scoring is strict, per labelled value:
//   TP          found as that entity, and the found span(s) cover every letter/digit of the value
//   FN          not found, or only partly (partial is a miss, never half a point)
//   wrong type  hidden under another entity — counted as an FN for the true entity, and as an
//               FP for the entity it was found as
//   FP          a finding where no value of that entity is
//   decoy hit   an FP that lands on a labelled look-alike (order no., tracking, amount…)
//   overreach   a TP whose span takes in non-space characters outside the value
import { writeFileSync } from 'node:fs'
import { createGuard, definePolicy, ENTITY_TYPES } from '@eve-pdpa-extension/core'
import { ENTITIES, loadSet } from './lib/data.mjs'
import { onlyDigits } from './lib/values.mjs'

const argv = process.argv.slice(2)
const set = argv.includes('--set') ? argv[argv.indexOf('--set') + 1] : 'open'
if (!['open', 'holdout'].includes(set)) throw new Error('--set open|holdout')

const README = {
  // Accuracy table, core README (holdout of 3,435 messages): precision, recall, recall with context
  TH_NATIONAL_ID: [100, 100, 100],
  PHONE: [99.4, 96.4, 100],
  EMAIL: [100, 100, 100],
  BANK_ACCOUNT: [100, 80, 100],
  CREDIT_CARD: [100, 100, 100],
  LINE_USER_ID: [100, 100, 100],
}

const policy = definePolicy({
  entitySet: '0.1',
  entities: Object.fromEntries(ENTITY_TYPES.map((e) => [e, { action: 'redact' }])),
})
const events = []
const guard = createGuard({ policy, onAudit: (e) => events.push(e) })

const conversations = loadSet(set)
const ALNUM = /[\p{L}\p{N}]/u
const overlaps = (a, b) => a.start < b.end && b.start < a.end

function blank() {
  return {
    values: 0,
    tp: 0,
    missed: 0,
    partial: 0,
    wrongType: 0,
    fp: 0,
    decoyHits: 0,
    overreach: 0,
    leakedAfterTp: 0,
  }
}

/** Scores one message into `tally` and `examples`. Returns the outcome of each labelled value. */
function score(turn, findings, outText, tally, examples, where) {
  const ents = turn.labels.filter((l) => !l.decoy)
  const decoys = turn.labels.filter((l) => l.decoy)
  const show = (label, extra = '') => ({
    where,
    from: turn.from,
    text: turn.plain,
    value: label?.value,
    type: label?.type,
    findings: findings.map(
      (f) => `${f.entity}[${f.start},${f.end}]=${JSON.stringify(turn.plain.slice(f.start, f.end))}`,
    ),
    extra,
  })
  const outcome = []

  for (const v of ents) {
    const t = tally[v.type]
    t.values++
    const idx = []
    for (let i = v.start; i < v.end; i++) if (ALNUM.test(turn.plain[i])) idx.push(i)
    const same = findings.filter((f) => f.entity === v.type && overlaps(f, v))
    const covered = idx.every((i) => same.some((f) => f.start <= i && i < f.end))
    if (same.length && covered) {
      t.tp++
      // overreach: characters outside the value, not part of another labelled value, not space
      let extra = ''
      for (const f of same) {
        for (let i = f.start; i < f.end; i++) {
          if (i >= v.start && i < v.end) continue
          if (ents.some((o) => o !== v && i >= o.start && i < o.end)) continue
          extra += turn.plain[i]
        }
      }
      if (extra.trim()) {
        t.overreach++
        examples.overreach.push(show(v, `extra: ${JSON.stringify(extra)}`))
      }
      // the value written once in the message must not survive in the returned text
      if (turn.plain.split(v.value).length === 2 && outText.includes(v.value)) {
        t.leakedAfterTp++
        examples.leak.push(show(v, 'counted as found, but the value is still in the returned text'))
      }
      outcome.push({ label: v, status: 'tp' })
      continue
    }
    const other = findings.filter((f) => f.entity !== v.type && overlaps(f, v))
    if (other.length) {
      t.wrongType++
      examples.wrongType.push(
        show(v, `found as ${[...new Set(other.map((f) => f.entity))].join('+')}`),
      )
      outcome.push({ label: v, status: 'wrongType' })
    } else if (same.length) {
      t.partial++
      examples.partial.push(show(v, 'only part of the value is covered'))
      outcome.push({ label: v, status: 'partial' })
    } else {
      t.missed++
      examples.missed.push(show(v))
      outcome.push({ label: v, status: 'missed' })
    }
  }

  for (const f of findings) {
    if (ents.some((v) => v.type === f.entity && overlaps(f, v))) continue
    const t = tally[f.entity]
    t.fp++
    const decoy = decoys.find((d) => overlaps(f, d))
    const wrong = ents.find((v) => overlaps(f, v))
    if (decoy) {
      t.decoyHits++
      examples.decoy.push({
        ...show(
          decoy,
          `${decoy.type} flagged as ${f.entity}: ${JSON.stringify(turn.plain.slice(f.start, f.end))}`,
        ),
      })
    } else if (!wrong) {
      examples.fp.push({
        ...show(null, `${f.entity}: ${JSON.stringify(turn.plain.slice(f.start, f.end))}`),
      })
    }
  }
  return outcome
}

/** Audit check: no labelled value, in any of its written forms, in any string of a scan event. */
function auditLeaks(event, turn, context) {
  const strings = []
  const walk = (x) => {
    if (typeof x === 'string') strings.push(x)
    else if (Array.isArray(x)) x.forEach(walk)
    else if (x && typeof x === 'object') Object.values(x).forEach(walk)
  }
  walk(event)
  const hay = strings.join('\n')
  const hayLower = hay.toLowerCase()
  const leaks = []
  for (const v of turn.labels.filter((l) => !l.decoy)) {
    const forms = new Set([v.value, v.value.toLowerCase()])
    const d = onlyDigits(v.value)
    if (d.length >= 8) forms.add(d)
    for (const form of forms)
      if (form && (hay.includes(form) || hayLower.includes(form)))
        leaks.push(`${v.type} ${JSON.stringify(form)}`)
  }
  if (turn.plain.length > 12 && hay.includes(turn.plain)) leaks.push('the whole message')
  if (context && context.length > 12 && hay.includes(context)) leaks.push('the context text')
  return leaks
}

const results = {}
for (const mode of ['without', 'with']) {
  const tally = Object.fromEntries(ENTITIES.map((e) => [e, blank()]))
  const examples = {
    missed: [],
    partial: [],
    wrongType: [],
    fp: [],
    decoy: [],
    overreach: [],
    leak: [],
  }
  const byBoundary = {}
  let emptyMessages = 0
  let emptyWithFinding = 0
  let auditProblems = []
  for (const conv of conversations) {
    for (const turn of conv.turns) {
      const where = `${conv.id}#${turn.index}`
      const ref = `${set}:${where}:${mode}`
      const context = mode === 'with' ? turn.context : undefined
      const before = events.length
      const r = await guard.process(turn.plain, {
        sessionId: conv.id,
        boundary: turn.boundary,
        ref,
        ...(context ? { context } : {}),
      })
      const outcome = score(turn, r.findings, r.text, tally, examples, where)
      const b = (byBoundary[turn.boundary] ??= { values: 0, tp: 0 })
      for (const o of outcome) {
        b.values++
        if (o.status === 'tp') b.tp++
      }
      if (!turn.labels.some((l) => !l.decoy)) {
        emptyMessages++
        if (r.findings.length) emptyWithFinding++
      }
      const scans = events.slice(before).filter((e) => e.type === 'scan')
      if (scans.length !== 1)
        auditProblems.push(`${where}: ${scans.length} scan events for one call`)
      for (const e of scans) {
        if (e.ref !== ref) auditProblems.push(`${where}: ref not copied`)
        for (const leak of auditLeaks(e, turn, context))
          auditProblems.push(`${where}: audit event holds ${leak}`)
      }
    }
  }
  results[mode] = { tally, examples, byBoundary, emptyMessages, emptyWithFinding, auditProblems }
}

// ---------- report ----------

const pct = (n, d) => (d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`)
const precision = (t) => pct(t.tp, t.tp + t.fp)
const recall = (t) => pct(t.tp, t.values)
const msgs = conversations.reduce((n, c) => n + c.turns.length, 0)
const from = { customer: 0, shop: 0, tool: 0 }
for (const c of conversations) for (const t of c.turns) from[t.from]++
const decoyCount = conversations.reduce(
  (n, c) => n + c.turns.reduce((m, t) => m + t.labels.filter((l) => l.decoy).length, 0),
  0,
)

const L = []
L.push(`# Detection benchmark — ${set} set`)
L.push('')
L.push(
  `Package: @eve-pdpa-extension/core, engine version reported in audit: \`${events.find((e) => e.engine)?.engine.version}\` · run ${new Date().toISOString()}`,
)
L.push('')
L.push(
  `Data: ${conversations.length} conversations · ${msgs} messages (customer ${from.customer} · shop ${from.shop} · tool ${from.tool}) · ${decoyCount} decoys · ${results.without.emptyMessages} messages with no personal data`,
)
L.push('')
L.push(
  "Policy: `redact` for all six entities at the default threshold (0.95). Boundary: customer → `inbound`, shop → `outbound`, tool → `tool_output`. Context run: `context` = the other side's previous message (customer ↔ shop; a tool output gets the last message that is not a tool output).",
)
L.push('')
L.push(
  'Strict scoring: a value counts as found only if every letter and digit of it lies inside a finding of the right entity. Partial = miss. A value hidden under another entity is a miss (wrong type) for its own entity and an FP for the other one.',
)
L.push('')
for (const mode of ['without', 'with']) {
  const { tally } = results[mode]
  L.push(`## Results ${mode} context`)
  L.push('')
  L.push(
    '| Entity | Values | TP | Missed | Partial | Wrong type | FP | of which decoys | Overreach | Precision | Recall |',
  )
  L.push('|---|---|---|---|---|---|---|---|---|---|---|')
  const sum = blank()
  for (const e of ENTITIES) {
    const t = tally[e]
    for (const k of Object.keys(sum)) sum[k] += t[k]
    L.push(
      `| ${e} | ${t.values} | ${t.tp} | ${t.missed} | ${t.partial} | ${t.wrongType} | ${t.fp} | ${t.decoyHits} | ${t.overreach} | ${precision(t)} | ${recall(t)} |`,
    )
  }
  L.push(
    `| **all** | ${sum.values} | ${sum.tp} | ${sum.missed} | ${sum.partial} | ${sum.wrongType} | ${sum.fp} | ${sum.decoyHits} | ${sum.overreach} | ${precision(sum)} | ${recall(sum)} |`,
  )
  L.push('')
  const bb = results[mode].byBoundary
  L.push(
    `Recall by boundary: ${Object.entries(bb)
      .map(([k, v]) => `${k} ${pct(v.tp, v.values)} (${v.tp}/${v.values})`)
      .join(' · ')}`,
  )
  L.push('')
  L.push(
    `Messages with no personal data that still got a finding: ${results[mode].emptyWithFinding} of ${results[mode].emptyMessages}`,
  )
  L.push('')
  const ap = results[mode].auditProblems
  L.push(
    `Audit events: ${ap.length === 0 ? 'one scan event per call, `ref` copied, and no labelled value (as typed, lower-cased, or as its digits) in any string of any event — 0 problems' : `${ap.length} problem(s)`}`,
  )
  for (const p of ap.slice(0, 10)) L.push(`- ${p}`)
  L.push('')
}

L.push('## Compared with the README accuracy table')
L.push('')
L.push(
  'The README measured its own synthetic holdout (3,435 messages) and calls every figure an upper bound. Ours is a different, smaller, hand-written set.',
)
L.push('')
L.push(
  '| Entity | README precision | ours | README recall | ours | README recall with context | ours |',
)
L.push('|---|---|---|---|---|---|---|')
for (const e of ENTITIES) {
  const [p, r, rc] = README[e]
  L.push(
    `| ${e} | ${p}% | ${precision(results.without.tally[e])} | ${r}% | ${recall(results.without.tally[e])} | ${rc}% | ${recall(results.with.tally[e])} |`,
  )
}
L.push('')

const KINDS = [
  ['missed', 'Missed (not found at all)'],
  ['partial', 'Partly covered'],
  ['wrongType', 'Wrong type'],
  ['fp', 'False positives (not on a decoy)'],
  ['decoy', 'Decoys flagged'],
  ['overreach', 'Overreach (span wider than the value)'],
  ['leak', 'Found, but the value is still in the returned text'],
]
for (const mode of ['without', 'with']) {
  L.push(`## Failure examples ${mode} context (up to 10 each)`)
  L.push('')
  for (const [k, title] of KINDS) {
    const list = results[mode].examples[k]
    L.push(`### ${title} — ${list.length}`)
    L.push('')
    for (const x of list.slice(0, 10)) {
      L.push(
        `- \`${x.where}\` (${x.from})${x.type ? ` ${x.type} \`${x.value}\`` : ''}${x.extra ? ` — ${x.extra}` : ''}`,
      )
      L.push(
        `  - text: ${JSON.stringify(x.text.length > 220 ? x.text.slice(0, 220) + '…' : x.text)}`,
      )
      L.push(`  - findings: ${x.findings.length ? x.findings.join(' · ') : '(none)'}`)
    }
    if (!list.length) L.push('(none)')
    L.push('')
  }
}

writeFileSync(`out/report-${set}.md`, L.join('\n'))
const summary = Object.fromEntries(
  ['without', 'with'].map((m) => [
    m,
    Object.fromEntries(
      ENTITIES.map((e) => [
        e,
        {
          ...results[m].tally[e],
          precision: precision(results[m].tally[e]),
          recall: recall(results[m].tally[e]),
        },
      ]),
    ),
  ]),
)
writeFileSync(
  `out/report-${set}.json`,
  JSON.stringify(
    {
      set,
      conversations: conversations.length,
      messages: msgs,
      decoys: decoyCount,
      summary,
      auditProblems: {
        without: results.without.auditProblems.length,
        with: results.with.auditProblems.length,
      },
    },
    null,
    2,
  ),
)

console.log(`${set}: ${conversations.length} conversations, ${msgs} messages`)
console.log(
  'entity           values   P(no ctx)  R(no ctx)   P(ctx)   R(ctx)   decoy hits  overreach',
)
for (const e of ENTITIES) {
  const a = results.without.tally[e]
  const b = results.with.tally[e]
  console.log(
    `${e.padEnd(16)} ${String(a.values).padStart(6)}   ${precision(a).padStart(8)}  ${recall(a).padStart(8)}  ${precision(b).padStart(7)}  ${recall(b).padStart(7)}   ${String(a.decoyHits).padStart(4)}/${String(b.decoyHits).padEnd(4)}  ${String(a.overreach).padStart(4)}/${b.overreach}`,
  )
}
console.log(
  `audit problems: ${results.without.auditProblems.length} / ${results.with.auditProblems.length}`,
)
console.log(`report: out/report-${set}.md`)
