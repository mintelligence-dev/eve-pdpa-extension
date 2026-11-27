import type { Hit, ScanReport } from './scan.js'

/** How many messages the human report lists before saying how many more. The JSON report lists all. */
const MAX_LISTED = 20

const n = (x: number) => x.toLocaleString('en-US')
const plural = (x: number, one: string, many: string) => `${n(x)} ${x === 1 ? one : many}`

function table(rows: readonly (readonly [string, string])[]): string[] {
  const width = Math.max(...rows.map(([k]) => k.length))
  return rows.map(([k, v]) => `  ${k.padEnd(width)}  ${v}`)
}

/** `line 7   m04`: numbers padded so the ids line up whatever the line count. */
function where(h: Hit, all: readonly Hit[]): string {
  const width = Math.max(...all.map((x) => String(x.line).length))
  const who = h.sender === undefined ? '' : `  ${h.sender === 'shop' ? 'shop    ' : 'customer'}`
  const id =
    h.idHidden !== undefined
      ? `  (id hidden: ${h.idHidden.join(', ')})`
      : h.id === null
        ? ''
        : `  ${h.id}`
  return `line ${String(h.line).padEnd(width)}${who}${id}`
}

/** For a person at a terminal. Types, counts, line numbers and ids — no values. */
export function formatHuman(r: ScanReport): string {
  const out: string[] = []
  out.push(`eve-pdpa scan  ${r.file}`)
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
  if (r.senders !== undefined) {
    const { customer: c, shop: sh } = r.senders
    out.push(
      `         from customers ${n(c.withFindings)} of ${n(c.scanned)} · from the shop ${n(sh.withFindings)} of ${n(sh.scanned)}`,
    )
  }
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
          where(h, shown),
          h.entities.join(', ') + (h.blocked === true ? '  [blocked]' : ''),
        ]),
      ),
    )
  }

  const weak = Object.entries(r.belowThreshold.entities)
  if (weak.length > 0) {
    out.push('')
    out.push('below the confidence threshold — found, but the policy does nothing with them')
    out.push(
      ...table(
        weak.map(([e, t]) => {
          const range = t.lowest === t.highest ? `${t.lowest}` : `${t.lowest}–${t.highest}`
          return [e, `${n(t.count)}  (confidence ${range}, threshold ${t.threshold})`]
        }),
      ),
    )
    const shown = r.belowThreshold.hits.slice(0, MAX_LISTED)
    if (r.belowThreshold.hits.length > shown.length) {
      out.push(`  in ${n(r.belowThreshold.hits.length)} messages; first ${shown.length}:`)
    }
    out.push(...table(shown.map((h) => [where(h, shown), h.entities.join(', ')])))
    out.push('  lower minConfidence in the policy to act on them')
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

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const STYLE = `:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--mut:#666;--line:#ddd;--warn:#b45309}
@media(prefers-color-scheme:dark){:root{--bg:#161616;--fg:#eee;--mut:#999;--line:#333;--warn:#f59e0b}}
body{font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);max-width:52rem;margin:0 auto;padding:1.5rem 1rem}
h1{font-size:1.3rem;margin:0 0 .25rem}h2{font-size:1.05rem;margin:1.75rem 0 .5rem}
.mut{color:var(--mut)}.warn{color:var(--warn)}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:.35rem .6rem;border-bottom:1px solid var(--line)}
th.n,td.n{text-align:right;width:1%;white-space:nowrap;font-variant-numeric:tabular-nums}.wrap{overflow-x:auto}`

/**
 * A column whose every cell is a whole number is right-aligned, header
 * included, and kept narrow so the number sits next to its label.
 */
function htmlTable(head: readonly string[], rows: readonly (readonly string[])[]): string {
  const numeric = head.map(
    (_, i) => rows.length > 0 && rows.every((r) => /^[\d,]+$/.test(r[i] ?? '')),
  )
  const cls = (i: number) => (numeric[i] === true ? ' class="n"' : '')
  const th = head.map((h, i) => `<th${cls(i)}>${esc(h)}</th>`).join('')
  const body = rows
    .map((r) => `<tr>${r.map((c, i) => `<td${cls(i)}>${esc(c)}</td>`).join('')}</tr>`)
    .join('')
  return `<div class="wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`
}

/** The Sender column only exists for a LINE OA export, which says who wrote each message. */
function hitTable(hits: readonly Hit[], withSender: boolean): string {
  const head = withSender ? ['Line', 'Id', 'Sender', 'Types'] : ['Line', 'Id', 'Types']
  return htmlTable(
    head,
    hits.map((h) => {
      const [line, id, sender, types] = hitRow(h) as [string, string, string, string]
      return withSender ? [line, id, sender, types] : [line, id, types]
    }),
  )
}

const hitRow = (h: Hit): string[] => [
  String(h.line),
  h.idHidden !== undefined ? `(id hidden: ${h.idHidden.join(', ')})` : (h.id ?? ''),
  h.sender ?? '',
  h.entities.join(', ') + (h.blocked === true ? ' [blocked]' : ''),
]

/**
 * One self-contained page: inline style, no script, no image, no link out, and
 * a CSP that forbids loading anything. Same content as the human report —
 * types, counts, line numbers and ids, never a value — and every string that
 * came from the user's file is escaped.
 */
export function formatHtml(r: ScanReport): string {
  const s: string[] = []
  const withSender = r.senders !== undefined
  s.push(`<h1>eve-pdpa scan</h1><p class="mut">${esc(r.file)} · ${esc(r.format)}</p>`)
  s.push(
    `<p>${r.policy.source === 'default' ? 'No policy given — every entity reported, nothing rewritten' : 'Policy'} <span class="mut">(${esc(r.policy.hash)})</span></p>`,
  )
  s.push(
    htmlTable(
      ['Messages', 'Count'],
      [
        ['Scanned', n(r.records.scanned)],
        ['With personal data', n(r.records.withFindings)],
        ['Unreadable lines (not scanned)', n(r.records.unreadable)],
        ...(r.records.blocked > 0 ? [['Would be blocked whole', n(r.records.blocked)]] : []),
      ],
    ),
  )
  if (r.senders !== undefined) {
    const { customer: c, shop: sh } = r.senders
    s.push('<h2>By sender</h2>')
    s.push(
      htmlTable(
        ['Sender', 'Scanned', 'With personal data'],
        [
          ['Customers', n(c.scanned), n(c.withFindings)],
          ['Shop', n(sh.scanned), n(sh.withFindings)],
        ],
      ),
    )
  }
  const found = Object.entries(r.entities).filter(([, c]) => c > 0)
  s.push('<h2>Found</h2>')
  s.push(
    found.length === 0
      ? '<p>Nothing found. <span class="mut">This does not mean the file holds no personal data.</span></p>'
      : htmlTable(
          ['Type', 'Values'],
          found.map(([e, c]) => [e, n(c)]),
        ),
  )
  if (r.allowlisted > 0)
    s.push(`<p class="mut">${n(r.allowlisted)} more let through by the allowlist.</p>`)
  if (r.actions !== undefined && found.length > 0) {
    s.push('<h2>The policy would</h2>')
    s.push(
      htmlTable(
        ['Action', 'Values'],
        Object.entries(r.actions).map(([a, c]) => [a, n(c ?? 0)]),
      ),
    )
  }
  if (r.hits.length > 0) {
    s.push('<h2>Messages with personal data</h2>')
    s.push(hitTable(r.hits, withSender))
  }
  const weak = Object.entries(r.belowThreshold.entities)
  if (weak.length > 0) {
    s.push(
      '<h2>Below the confidence threshold</h2><p class="mut">Found, but the policy does nothing with them.</p>',
    )
    s.push(
      htmlTable(
        ['Type', 'Count', 'Confidence', 'Threshold'],
        weak.map(([e, t]) => [
          e,
          n(t.count),
          t.lowest === t.highest ? `${t.lowest}` : `${t.lowest}–${t.highest}`,
          String(t.threshold),
        ]),
      ),
    )
    s.push(hitTable(r.belowThreshold.hits, withSender))
  }
  if (r.unreadable.length > 0) {
    s.push('<h2>Unreadable lines — not scanned</h2>')
    s.push(
      htmlTable(
        ['Line', 'Problem'],
        r.unreadable.map((u) => [String(u.line), u.problem]),
      ),
    )
  }
  if (r.degradedDetectors.length > 0) {
    s.push(
      `<p class="warn">Warning: a detector failed on some messages, which were not fully scanned: ${esc(r.degradedDetectors.join(', '))}</p>`,
    )
  }
  s.push(
    '<p class="mut">A technical tool, not a certification of compliance with Thailand\'s PDPA. This page lists types, counts, line numbers and ids, never the personal data itself.</p>',
  )
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>eve-pdpa scan report</title>
<style>${STYLE}</style></head><body>
${s.join('\n')}
</body></html>
`
}
