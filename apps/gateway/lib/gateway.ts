// Built once per cold start and reused by every request on that machine.
import { readFileSync } from 'node:fs'
import { type AuditRecord, parsePolicy } from '@eve-pdpa-extension/core'
import { createGateway, createUpstashTokenStore, type Gateway } from '@eve-pdpa-extension/http'

// vercel.json ships policies/ with every function, since a path built at run
// time is one Vercel's file tracing cannot follow.
const policy = (name: string) =>
  parsePolicy(readFileSync(new URL(`../policies/${name}.json`, import.meta.url), 'utf8'))

function env(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`set ${name} in the project's environment variables`)
  }
  return value
}

/**
 * The first of `names` that is set. The same value goes by different names:
 * Vercel's Upstash integration sets KV_REST_API_*, Upstash's own console
 * shows UPSTASH_REDIS_REST_*.
 */
function envOneOf(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]
    if (value !== undefined && value !== '') return value
  }
  throw new Error(`set ${names.join(' or ')} in the project's environment variables`)
}

/** An environment variable that may be left unset: the option, or nothing at all. */
function optional<K extends string>(key: K, name: string): { [P in K]?: string } {
  const value = process.env[name]
  return value === undefined || value === '' ? {} : ({ [key]: value } as { [P in K]?: string })
}

// Comma-separated. A trailing comma or a blank value is not an entry: an empty
// one would fail createGateway and take every route down with it (D22).
const allowed = (process.env.ALLOWED_DESTINATIONS ?? '')
  .split(',')
  .map((u) => u.trim())
  .filter((u) => u !== '')

/**
 * One JSON line per event, with `log` first: what the line is about, in
 * words, for whoever reads the function logs. The rest is the event as is.
 */
function logLine(label: string, fields: object): void {
  console.log(JSON.stringify({ log: label, ...fields }))
}

function auditLabel(event: AuditRecord): string {
  switch (event.type) {
    case 'policy.loaded':
      return 'โหลด policy'
    case 'scan': {
      const what = event.boundary === 'inbound' ? 'ตรวจข้อความลูกค้า (ขาเข้า)' : 'ตรวจคำตอบ AI (ขาออก)'
      return event.outcome === 'blocked' ? `${what} · บล็อก ไม่ส่งต่อ` : what
    }
    case 'token.resolve':
      return 'แลก token เป็นค่าจริง'
    default:
      return 'audit'
  }
}

// DEMO ONLY (D26). DEBUG_LOG_TEXT=1 logs what each forward carries — the
// protected text, never the message as it came in — so a demo can show what
// the answering system and the chat app received. The text is still the
// customer's conversation: unset it, or delete this block, before real
// customers.
const debugText = process.env.DEBUG_LOG_TEXT === '1'
if (debugText) {
  console.warn('DEBUG_LOG_TEXT is on: the protected text of every forward is logged. Demo only.')
}
const debugFetch: typeof fetch = async (input, init) => {
  let sent: unknown = init?.body
  try {
    sent = JSON.parse(String(init?.body))
  } catch {}
  let status: number | null = null
  try {
    const res = await fetch(input, init)
    status = res.status
    return res
  } finally {
    // Origin and path, as gateway.forward records it: a query can carry ids.
    const url = new URL(String(input))
    const to = `${url.origin}${url.pathname}`
    logLine('DEBUG ข้อความที่ส่งออกไป', { type: 'gateway.debug', to, status, sent })
  }
}

export const gateway: Gateway = createGateway({
  // A bot that only answers questions uses default. A bot that sends OTPs
  // names otp, and only that one can have a phone number resolved.
  policies: { default: policy('default'), otp: policy('otp') },
  secret: env('PDPA_SECRET'),

  // Each request names its own forwardTo and replyTo. These two are only
  // fallbacks for a request that names none — leave them unset to require it.
  ...optional('forwardTo', 'FORWARD_URL'),
  ...optional('replyTo', 'REPLY_URL'),
  // Set ALLOWED_DESTINATIONS (comma-separated https URLs) to accept only those.
  ...(allowed.length > 0 ? { allowedDestinations: allowed } : {}),

  // For otp, the only policy that tokenises. Without it, delete these two and
  // nothing needs Upstash.
  resolveSecret: env('PDPA_RESOLVE_SECRET'),
  tokenStore: createUpstashTokenStore({
    url: envOneOf('KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL'),
    token: envOneOf('KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN'),
  }),

  // Into the function logs, which Vercel keeps for an hour (Hobby) or a day
  // (Pro). Before real customers, send audit somewhere it is kept — a log
  // drain or a database — token.resolve events above all.
  onAudit: (event) => logLine(auditLabel(event), event),
  // Where each message went: one line per forward, beside the audit events.
  onForward: (record) => {
    const to = record.boundary === 'inbound' ? 'ส่งต่อให้ AI' : 'ส่งคำตอบกลับแอปแชท'
    logLine(record.delivered ? to : `${to} · ส่งไม่ถึง`, { type: 'gateway.forward', ...record })
  },
  ...(debugText ? { fetch: debugFetch } : {}),
})
