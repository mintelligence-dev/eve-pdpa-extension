// Built once per cold start and reused by every request on that machine.
import { readFileSync } from 'node:fs'
import { parsePolicy } from '@eve-pdpa-extension/core'
import { createUpstashTokenStore, createWebhook } from '@eve-pdpa-extension/http'

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

/** An environment variable that may be left unset. */
const optional = (name: string): string | undefined => process.env[name] || undefined

export const webhook = createWebhook({
  // A bot that only answers questions uses default. A bot that sends OTPs
  // names otp, and only that one can have a phone number resolved.
  policies: { default: policy('default'), otp: policy('otp') },
  secret: env('PDPA_SECRET'),

  // Each request names its own forwardTo and replyTo. These two are only
  // fallbacks for a request that names none — leave them unset to require it.
  forwardTo: optional('FORWARD_URL'),
  replyTo: optional('REPLY_URL'),
  // Set ALLOWED_DESTINATIONS (comma-separated https URLs) to accept only those.
  allowedDestinations: optional('ALLOWED_DESTINATIONS')
    ?.split(',')
    .map((u) => u.trim()),

  // For otp, the only policy that tokenises. Without it, delete these two and
  // nothing needs Upstash.
  resolveSecret: env('PDPA_RESOLVE_SECRET'),
  tokenStore: createUpstashTokenStore({
    url: env('UPSTASH_REDIS_REST_URL'),
    token: env('UPSTASH_REDIS_REST_TOKEN'),
  }),

  // Into the function logs, which Vercel keeps for an hour (Hobby) or a day
  // (Pro). Before real customers, send audit somewhere it is kept — a log
  // drain or a database — token.resolve events above all.
  onAudit: (event) => console.log(JSON.stringify(event)),
  // Where each message went: one line per forward, beside the audit events.
  onForward: (record) => console.log(JSON.stringify({ type: 'webhook.forward', ...record })),
})
