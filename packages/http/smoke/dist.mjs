// Runtime-agnostic smoke test of the BUILT gateway. Runs on every Node major
// http's engines allow and on workerd, against dist/, not the source.
//
// Rules for this file, as for core's smoke:
//   - no process, Buffer or any other host-specific global
//   - throw on failure; never call exit (miniflare inlines this file)
//   - ALL work happens inside run(): workerd forbids generating random values
//     during module evaluation, and tokens and signatures need them
//   - nothing newer than Node 20 has: no import.meta.dirname, no fs.glob
//
// What differs between runtimes is what http leans on: Web Crypto for the
// signatures, Request and Response, AbortSignal.timeout, ReadableStream for
// the body cap. Every route goes through here once.

import { createMemoryTokenStore, definePolicy } from '@eve-pdpa-extension/core'
import * as http from '../dist/index.js'

// Synthetic only. 32 bytes or more, as createGateway requires.
const SECRET = 'smoke-secret-0123456789abcdef-0123'
const RESOLVE_SECRET = 'smoke-resolve-0123456789abcdef-012'
const PHONE = '091-888-7777'
const DIGITS = '0918887777'
const FORWARD_TO = 'https://ai.example.com/inbound'
const REPLY_TO = 'https://chat.example.com/reply'

function check(ok, what) {
  if (!ok) throw new Error(what)
}

async function signed(route, scope, secret, payload) {
  const body = JSON.stringify(payload)
  const headers = await http.signRequest(secret, scope, body)
  return new Request(`https://gateway.example${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })
}

export async function run() {
  for (const k of ['createGateway', 'createUpstashTokenStore', 'signRequest', 'verifyRequest']) {
    check(k in http, `missing export: ${k}`)
  }

  // Where the gateway forwards to: kept, so the signature it sent can be checked.
  const sent = []
  const gateway = http.createGateway({
    policies: {
      default: definePolicy({ entitySet: '0.1', entities: { PHONE: { action: 'mask' } } }),
      otp: definePolicy({
        entitySet: '0.1',
        entities: { PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'] } },
      }),
    },
    secret: SECRET,
    resolveSecret: RESOLVE_SECRET,
    tokenStore: createMemoryTokenStore(),
    onAudit: () => {},
    fetch: async (url, init) => {
      sent.push({ url: String(url), headers: new Headers(init.headers), body: init.body })
      return new Response('ok')
    },
  })

  // /inbound: masked, forwarded, signed for `forward`.
  let res = await gateway.inbound(
    await signed('/api/inbound', 'inbound', SECRET, {
      sessionId: 'conv_smoke',
      text: `เบอร์ ${PHONE} ค่ะ`,
      forwardTo: FORWARD_TO,
      replyTo: REPLY_TO,
    }),
  )
  check(res.status === 200, `inbound: ${res.status} ${await res.text()}`)
  const forwarded = sent.at(-1)
  check(forwarded.url === FORWARD_TO, 'inbound: forwarded to the wrong place')
  check(
    !forwarded.body.includes(DIGITS) && !forwarded.body.includes(PHONE),
    'inbound: phone sent on',
  )
  check(
    await http.verifyRequest(SECRET, 'forward', forwarded.headers, forwarded.body),
    'inbound: the forward signature does not verify',
  )

  // A signature for another route is refused.
  res = await gateway.outbound(
    await signed('/api/outbound', 'inbound', SECRET, { sessionId: 'conv_smoke', text: 'x' }),
  )
  check(res.status === 401, `outbound signed for inbound: ${res.status}`)

  // /inbound with otp, then /resolve with the token it issued.
  await gateway.inbound(
    await signed('/api/inbound', 'inbound', SECRET, {
      policy: 'otp',
      sessionId: 'conv_smoke',
      text: `ส่ง OTP ไปที่ ${PHONE}`,
      forwardTo: FORWARD_TO,
    }),
  )
  const token = JSON.parse(sent.at(-1).body).text.match(/\[tok:[a-z]+\]/)?.[0]
  check(token !== undefined, 'otp: no token in what was forwarded')
  res = await gateway.resolve(
    await signed('/api/resolve', 'resolve', RESOLVE_SECRET, {
      policy: 'otp',
      token,
      sessionId: 'conv_smoke',
      purpose: 'otp_send',
    }),
  )
  const resolved = await res.json()
  check(resolved.ok === true && resolved.value === DIGITS, `resolve: ${JSON.stringify(resolved)}`)

  // /outbound: checked and sent to replyTo, signed for `reply`.
  res = await gateway.outbound(
    await signed('/api/outbound', 'outbound', SECRET, {
      policy: 'otp',
      sessionId: 'conv_smoke',
      text: `ส่ง OTP ไปที่ ${token} แล้วค่ะ`,
      replyTo: REPLY_TO,
    }),
  )
  check(res.status === 200, `outbound: ${res.status} ${await res.text()}`)
  const reply = sent.at(-1)
  check(reply.url === REPLY_TO, 'outbound: replied to the wrong place')
  check(!reply.body.includes(DIGITS), 'outbound: the real number reached the chat app')
  check(
    await http.verifyRequest(SECRET, 'reply', reply.headers, reply.body),
    'outbound: the reply signature does not verify',
  )

  // /end-session deletes the token: resolving it again finds nothing.
  res = await gateway.endSession(
    await signed('/api/end-session', 'end-session', SECRET, { sessionId: 'conv_smoke' }),
  )
  check(res.status === 200, `end-session: ${res.status}`)
  res = await gateway.resolve(
    await signed('/api/resolve', 'resolve', RESOLVE_SECRET, {
      policy: 'otp',
      token,
      sessionId: 'conv_smoke',
      purpose: 'otp_send',
    }),
  )
  check((await res.json()).ok === false, 'end-session: the token still resolves')

  return 'http smoke ok: inbound · outbound · resolve · end-session · signatures'
}
