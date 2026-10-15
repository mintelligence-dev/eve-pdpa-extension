// Checks the benchmark data before it is used:
//  - every labelled value is valid for its entity (checksum, Luhn + issuer, numbering plan…)
//  - the minimums: 40+ conversations, 250+ messages, 30+ values per entity, 50+ decoys,
//    a fifth of messages with nothing to find, shop and tool messages present
//  - nothing from holdout appears in open (by conversation id, by value, by sentence)
//
//   bench/user/run tools/check-data.mjs
import { ENTITIES, loadSet } from '../lib/data.mjs'
import { invalidReason, onlyDigits } from '../lib/values.mjs'

const problems = []
const stats = {}
const canon = (type, v) =>
  type === 'EMAIL' || type === 'LINE_USER_ID' ? v.toLowerCase() : onlyDigits(v)

for (const set of ['open', 'holdout']) {
  const convs = loadSet(set)
  const s = {
    conversations: convs.length,
    messages: 0,
    empty: 0,
    from: { customer: 0, shop: 0, tool: 0 },
    values: {},
    decoys: 0,
    decoyKinds: {},
    valueSet: new Set(),
    sentences: new Set(),
    ids: new Set(),
  }
  for (const e of ENTITIES) s.values[e] = 0
  for (const c of convs) {
    if (s.ids.has(c.id)) problems.push(`${set}: duplicate conversation id ${c.id}`)
    s.ids.add(c.id)
    for (const t of c.turns) {
      s.messages++
      s.from[t.from]++
      s.sentences.add(t.plain.trim())
      const ents = t.labels.filter((l) => !l.decoy)
      if (ents.length === 0) s.empty++
      for (const l of t.labels) {
        if (l.decoy) {
          s.decoys++
          s.decoyKinds[l.type] = (s.decoyKinds[l.type] ?? 0) + 1
          continue
        }
        if (!ENTITIES.includes(l.type)) {
          problems.push(`${c.id}#${t.index}: unknown entity ${l.type}`)
          continue
        }
        s.values[l.type]++
        s.valueSet.add(`${l.type}:${canon(l.type, l.value)}`)
        const why = invalidReason(l.type, l.value.replace(/[​-‏⁠﻿­]/g, ''))
        if (why) problems.push(`${c.id}#${t.index}: ${l.type} "${l.value}" — ${why}`)
        if (l.value !== l.value.trim())
          problems.push(`${c.id}#${t.index}: ${l.type} "${l.value}" has spaces at its edge`)
      }
    }
  }
  stats[set] = s
}

const o = stats.open
const h = stats.holdout
for (const id of h.ids) if (o.ids.has(id)) problems.push(`conversation id ${id} is in both sets`)
for (const v of h.valueSet) if (o.valueSet.has(v)) problems.push(`holdout value also in open: ${v}`)
for (const sentence of h.sentences)
  if (sentence.length > 25 && o.sentences.has(sentence))
    problems.push(`holdout sentence also in open: ${sentence.slice(0, 60)}`)

const total = (k) => o[k] + h[k]
const report = []
report.push(
  `set       conv  msgs  empty  customer/shop/tool  decoys  ${ENTITIES.map((e) => e.slice(0, 8).padStart(8)).join(' ')}`,
)
for (const [name, s] of [
  ['open', o],
  ['holdout', h],
]) {
  report.push(
    `${name.padEnd(9)} ${String(s.conversations).padStart(4)}  ${String(s.messages).padStart(4)}  ${String(s.empty).padStart(5)}  ${`${s.from.customer}/${s.from.shop}/${s.from.tool}`.padStart(18)}  ${String(s.decoys).padStart(6)}  ${ENTITIES.map((e) => String(s.values[e]).padStart(8)).join(' ')}`,
  )
}
report.push(
  `total     ${String(total('conversations')).padStart(4)}  ${String(total('messages')).padStart(4)}  ${String(total('empty')).padStart(5)}  ${''.padStart(18)}  ${String(total('decoys')).padStart(6)}  ${ENTITIES.map((e) => String(o.values[e] + h.values[e]).padStart(8)).join(' ')}`,
)
const share = (total('empty') / total('messages')) * 100
report.push(
  `messages with nothing to find: ${share.toFixed(1)}%  ·  conversations open/holdout: ${((o.conversations / total('conversations')) * 100).toFixed(0)}/${((h.conversations / total('conversations')) * 100).toFixed(0)}`,
)
report.push(
  `decoy kinds: ${JSON.stringify(Object.fromEntries(Object.entries({ ...o.decoyKinds }).map(([k, v]) => [k, v + (h.decoyKinds[k] ?? 0)])))}`,
)
const extra = Object.keys(h.decoyKinds).filter((k) => !(k in o.decoyKinds))
if (extra.length) report.push(`decoy kinds only in holdout: ${extra.join(', ')}`)

if (total('conversations') < 40) problems.push('fewer than 40 conversations')
if (total('messages') < 250) problems.push('fewer than 250 messages')
for (const e of ENTITIES)
  if (o.values[e] + h.values[e] < 30) problems.push(`fewer than 30 values of ${e}`)
if (total('decoys') < 50) problems.push('fewer than 50 decoys')
if (share < 20) problems.push('less than a fifth of messages with nothing to find')
for (const s of [o, h])
  if (!s.from.shop || !s.from.tool) problems.push('a set without shop or tool messages')

console.log(report.join('\n'))
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`)
  for (const p of problems) console.log('  - ' + p)
  process.exitCode = 1
} else console.log('\ndata OK')
