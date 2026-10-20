#!/usr/bin/env node
// Checks a deployment of the webhook end to end, with synthetic data only.
//
//   PDPA_SECRET=… PDPA_RESOLVE_SECRET=… [VERCEL_BYPASS=…] node apps/webhook/scripts/smoke.mjs <url>
//
// Run it in your own terminal: the secrets stay in your shell and nothing here
// prints them. VERCEL_BYPASS is the deployment's "Protection Bypass for
// Automation" value, needed while a preview is behind Deployment Protection.
//
// Forwards go to the deployment's own /robots.txt, which does not take a POST,
// so a forward always fails with 502. That keeps every message inside the
// deployment, and still tells apart the outcomes that matter: 502 means the
// message was checked and its token stored in Upstash. When Upstash cannot be
// reached the otp message comes back blocked by PHONE (nothing goes on without
// its token), resolve says store_unavailable and end-session answers 500.
import { createHmac, randomBytes } from 'node:crypto'

const base = process.argv[2]?.replace(/\/+$/, '')
const secret = process.env.PDPA_SECRET
const resolveSecret = process.env.PDPA_RESOLVE_SECRET
if (!base || !secret || !resolveSecret) {
  console.error('usage: PDPA_SECRET=… PDPA_RESOLVE_SECRET=… [VERCEL_BYPASS=…] node smoke.mjs <url>')
  process.exit(2)
}
const nowhere = `${base}/robots.txt`
// Not a timestamp: 13 digits can pass for a national ID, and the webhook
// refuses an id that looks like personal data.
const session = `smoke_${randomBytes(4).toString('hex')}`

async function post(route, scope, key, payload) {
  const body = JSON.stringify(payload)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const mac = createHmac('sha256', key).update(`${timestamp}.${scope}.${body}`).digest('hex')
  const headers = {
    'content-type': 'application/json',
    'x-pdpa-timestamp': timestamp,
    'x-pdpa-signature': `v1=${mac}`,
  }
  if (process.env.VERCEL_BYPASS) headers['x-vercel-protection-bypass'] = process.env.VERCEL_BYPASS
  const res = await fetch(`${base}${route}`, { method: 'POST', headers, body })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { notJson: text.slice(0, 80) }
  }
  return { status: res.status, json }
}

// The webhook's own 401, not Vercel's login page in front of it.
const refused = (r) => r.status === 401 && r.json.error === 'unauthorized'

const checks = [
  [
    'signed for another scope is refused',
    () => post('/api/outbound', 'inbound', secret, { sessionId: session, text: 'x' }),
    refused,
  ],
  [
    'default policy: checked, forward fails as planned',
    () =>
      post('/api/inbound', 'inbound', secret, {
        sessionId: session,
        text: 'เบอร์ 091-888-7777 ค่ะ',
        forwardTo: nowhere,
      }),
    (r) => r.status === 502 && r.json.outcome === 'forward_failed',
  ],
  [
    'otp policy: token stored in Upstash, forward fails as planned',
    () =>
      post('/api/inbound', 'inbound', secret, {
        policy: 'otp',
        sessionId: session,
        text: 'ส่ง OTP ไปที่ 091-888-7777 ค่ะ',
        forwardTo: nowhere,
      }),
    (r) => r.status === 502 && r.json.outcome === 'forward_failed',
  ],
  [
    'a card number is blocked by the policy',
    () =>
      post('/api/inbound', 'inbound', secret, {
        sessionId: session,
        text: 'บัตร 4111 1111 1111 1111',
        forwardTo: nowhere,
      }),
    (r) => r.status === 200 && r.json.outcome === 'blocked',
  ],
  [
    'resolve reads Upstash: an unknown token is not_found',
    () =>
      post('/api/resolve', 'resolve', resolveSecret, {
        policy: 'otp',
        token: '[tok:bcdfghjkmnpqrstv]',
        sessionId: session,
        purpose: 'otp_send',
        caller: 'smoke',
      }),
    (r) => r.status === 200 && r.json.ok === false && r.json.reason === 'not_found',
  ],
  [
    'resolve refuses the inbound secret',
    () =>
      post('/api/resolve', 'resolve', secret, {
        token: '[tok:bcdfghjkmnpqrstv]',
        sessionId: session,
        purpose: 'otp_send',
      }),
    refused,
  ],
  [
    'end-session clears the chat in Upstash (a transaction)',
    () => post('/api/end-session', 'end-session', secret, { sessionId: session }),
    (r) => r.status === 200 && r.json.ok === true,
  ],
]

let failed = 0
for (const [name, run, ok] of checks) {
  let r
  try {
    r = await run()
  } catch (error) {
    r = { status: 'no answer', json: { error: String(error?.cause?.code ?? error) } }
  }
  const pass = typeof r.status === 'number' && ok(r)
  if (!pass) failed++
  // Status and the answer's outcome fields only: never a value, never a header.
  const shown = Object.fromEntries(
    Object.entries(r.json ?? {}).filter(([k]) =>
      ['outcome', 'blockedBy', 'ok', 'reason', 'error', 'field', 'notJson'].includes(k),
    ),
  )
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name} · ${r.status} ${JSON.stringify(shown)}`)
}
console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) failed`)
if (failed > 0 && !process.env.VERCEL_BYPASS) {
  console.log(
    'Deployment Protection on? Set VERCEL_BYPASS to the Protection Bypass for Automation value.',
  )
}
process.exit(failed === 0 ? 0 : 1)
