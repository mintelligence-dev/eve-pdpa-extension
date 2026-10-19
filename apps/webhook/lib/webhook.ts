// Built once per cold start and reused by every request on that machine.
import { readFileSync } from 'node:fs'
import { parsePolicy } from '@eve-pdpa-extension/core'
import { createUpstashTokenStore, createWebhook, type Webhook } from '@eve-pdpa-extension/http'

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
// one would fail createWebhook and take every route down with it (D22).
const allowed = (process.env.ALLOWED_DESTINATIONS ?? '')
  .split(',')
  .map((u) => u.trim())
  .filter((u) => u !== '')

export const webhook: Webhook = createWebhook({
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
  onAudit: (event) => console.log(JSON.stringify(event)),
  // Where each message went: one line per forward, beside the audit events.
  onForward: (record) => console.log(JSON.stringify({ type: 'webhook.forward', ...record })),
})
