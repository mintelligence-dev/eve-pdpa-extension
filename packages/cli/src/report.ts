import type { ScanReport } from './scan.js'

/** How many messages the human report lists before saying how many more. The JSON report lists all. */
const MAX_LISTED = 20

const n = (x: number) => x.toLocaleString('en-US')
const plural = (x: number, one: string, many: string) => `${n(x)} ${x === 1 ? one : many}`

function table(rows: readonly (readonly [string, string])[]): string[] {
  const width = Math.max(...rows.map(([k]) => k.length))
  return rows.map(([k, v]) => `  ${k.padEnd(width)}  ${v}`)
}

/** For a person at a terminal. Types, counts, line numbers and ids — no values. */
export function formatHuman(r: ScanReport): string {
  const out: string[] = []
  out.push(`thai-pdpa-guard scan  ${r.file}`)
  out.push(
    r.policy.source === 'default'
      ? `policy   none given — every entity reported, nothing rewritten  (${r.policy.hash})`
      : `policy   ${r.policy.hash}`,
  )
  const unread =
    r.records.unreadable > 0 ? ` · ${plural(r.records.unreadable, 'line', 'lines')} unreadable` : ''
  out.push(
    `messages ${n(r.records.scanned)} scanned · ${n(r.records.withFindings)} with personal data${unread}`,
  )
  out.push('')

  const found = Object.entries(r.entities).filter(([, c]) => c > 0)
  if (found.length === 0) {
    out.push('found    nothing')
  } else {
    out.push('found')
    out.push(...table(found.map(([e, c]) => [e, n(c)])))
  }
  if (r.allowlisted > 0) out.push(`  (and ${n(r.allowlisted)} let through by the allowlist)`)

  if (r.actions !== undefined && found.length > 0) {
    out.push('')
    out.push('the policy would')
    const rows = Object.entries(r.actions).map(([a, c]): [string, string] => [a, n(c ?? 0)])
    out.push(...table(rows))
    if (r.records.blocked > 0)
      out.push(`  ${plural(r.records.blocked, 'message', 'messages')} would be blocked whole`)
  }

  if (r.hits.length > 0) {
    out.push('')
    const shown = r.hits.slice(0, MAX_LISTED)
    out.push(
      r.hits.length > shown.length
        ? `messages with personal data (first ${shown.length} of ${n(r.hits.length)} — use --json for all)`
        : 'messages with personal data',
    )
    out.push(
      ...table(
        shown.map((h) => [
          `line ${h.line}${h.id === null ? '' : `  ${h.id}`}`,
          h.entities.join(', ') + (h.blocked === true ? '  [blocked]' : ''),
        ]),
      ),
    )
  }

  if (r.unreadable.length > 0) {
    out.push('')
    const shown = r.unreadable.slice(0, MAX_LISTED)
    out.push(
      r.unreadable.length > shown.length
        ? `unreadable lines — not scanned (first ${shown.length} of ${n(r.unreadable.length)})`
        : 'unreadable lines — not scanned',
    )
    out.push(...table(shown.map((u) => [`line ${u.line}`, u.problem])))
  }

  if (r.degradedDetectors.length > 0) {
    out.push('')
    out.push(
      `warning: detector failed on some messages, which were not fully scanned: ${r.degradedDetectors.join(', ')}`,
    )
  }

  return `${out.join('\n')}\n`
}
