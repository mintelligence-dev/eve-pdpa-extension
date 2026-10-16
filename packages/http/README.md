# @eve-pdpa-extension/http

A webhook that sits between a chat app and the system that answers it — an AI model, a helpdesk — and protects Thai personal data **both ways**: in the customer's message before the answering system reads it, and in the answer before the customer gets it.

- Any app that can send an HTTP POST · no SDK to install on the sending side
- Every request is signed (HMAC-SHA256 with a timestamp) · the webhook signs what it forwards, so the receiver can check it too
- The caller says where each message goes (`forwardTo`, `replyTo`) · every forward is reported to `onForward`, so where data went is on record
- Each bot gets a **named policy** · a request chooses among policies you reviewed, and can never write its own rules
- Optional `tokenise`: a value the answering system needs — a phone number for an OTP — can be exchanged back at `/resolve`, for an allowed purpose only, and every attempt is audited
- Web standards only (`Request` · `Response` · `fetch` · `crypto.subtle`) · Vercel (Node and Edge) · Next.js · Hono · Deno · Bun · Cloudflare Workers · Node 20+
- Detection and protection come from [`@eve-pdpa-extension/core`](https://www.npmjs.com/package/@eve-pdpa-extension/core)

> **This is a technical tool, not a certification of compliance with Thailand's Personal Data Protection Act (PDPA).**

[ภาษาไทย](./README.th.md)

---

## How it fits

```
chat app ──POST /inbound──▶  webhook (guard)  ──POST──▶  forwardTo (the system that answers)
chat app ◀──POST──────────── webhook (guard)  ◀──POST /outbound──  the system that answers
              (replyTo)                                    sends replyTo back with its answer
OTP service ──POST /resolve──▶ webhook ──▶ the real value, for an allowed purpose
chat app ──POST /end-session──▶ webhook ──▶ every token of that chat deleted
```

The answering system sends its reply through `/outbound` instead of straight to the app — otherwise a value the model writes, or a token it repeats, reaches the customer unchecked.

## Install

```bash
npm install @eve-pdpa-extension/http @eve-pdpa-extension/core
```

## Quick start

```ts
import { parsePolicy } from '@eve-pdpa-extension/core'
import { createUpstashTokenStore, createWebhook } from '@eve-pdpa-extension/http'

const webhook = createWebhook({
  policies: {
    default: parsePolicy(defaultPolicyJson),   // a bot that answers questions: no tokenise
    otp: parsePolicy(otpPolicyJson),           // a bot that sends OTPs: phone tokenised for otp_send
  },
  secret: process.env.PDPA_SECRET,             // ≥ 32 bytes · openssl rand -hex 32
  onAudit: (event) => console.log(JSON.stringify(event)),
  onForward: (record) => console.log(JSON.stringify(record)),   // where each message went

  // Only because a policy tokenises
  resolveSecret: process.env.PDPA_RESOLVE_SECRET,
  tokenStore: createUpstashTokenStore({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  }),
})

// Mount each handler on a route. On Vercel, api/inbound.ts:
export function POST(request: Request) {
  return webhook.inbound(request)
}
// webhook.outbound · webhook.resolve · webhook.endSession — the same way
```

A deployable example is in [`examples/vercel`](https://github.com/mintelligence-dev/eve-pdpa-extension/tree/main/examples/vercel).

## Sending a message in

```ts
import { signRequest } from '@eve-pdpa-extension/http'

const body = JSON.stringify({
  policy: 'otp',
  sessionId: 'conv_8f2a',
  ref: 'msg_10293',
  text: 'เบอร์ 091-888-7777 ค่ะ',
  forwardTo: 'https://ai.example.com/inbound',     // the system that answers
  replyTo: 'https://chat.example.com/reply',       // where its answer should reach the customer
})
await fetch(WEBHOOK_URL + '/inbound', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(await signRequest(PDPA_SECRET, body)) },
  body,
})
```

| Field | Required | |
|---|---|---|
| `policy` | | A name from `policies` · leave it out for `default` |
| `sessionId` | ✅ | Your own chat id · 1–256 characters · **refused if it is personal data** (a LINE userId, a phone number), because it is written to every audit event |
| `ref` | | Your own message id · 1–256 characters · checked the same way |
| `text` | ✅ | The message |
| `context` | | The other side's last message, read for cue words only (*"your account number?"*) · never forwarded |
| `forwardTo` | | Where to send the protected message · falls back to the `forwardTo` option · one or the other is required |
| `replyTo` | | Where the answer should go · passed on to `forwardTo`, which sends it back with its answer to `/outbound` |

Any other field is refused, so a value in a field the webhook does not read cannot pass for checked.

What the receiver gets, signed with the same secret: `{ "policy": "otp", "sessionId": "conv_8f2a", "ref": "msg_10293", "text": "เบอร์ [tok:…] ค่ะ", "replyTo": "https://chat.example.com/reply" }`. It sends its answer to `/outbound` with the same `policy`, `sessionId` and `replyTo`. Check what arrives with `verifyRequest`:

```ts
import { verifyRequest } from '@eve-pdpa-extension/http'

const body = await request.text()
if (!(await verifyRequest(PDPA_SECRET, request.headers, body))) return new Response(null, { status: 401 })
```

## Where messages may go

A `forwardTo` or `replyTo` in a request must be **https**, carry no user name or password, and not be a local or private network address (`localhost`, `127.0.0.1`, `10.x`, `192.168.x`, `169.254.169.254`, `::1` …) — the webhook signs what it sends, and a signed POST to an internal service is the last thing it should make. The `forwardTo` and `replyTo` options are your own choice and are not limited.

> **The secret decides who may name a destination.** Anyone holding it can have the webhook send a signed message anywhere public. Keep it as closely as any credential, and if you know where messages should go, list them:
>
> ```ts
> allowedDestinations: ['https://ai.example.com/', 'https://chat.example.com/reply']
> ```
>
> A destination must then share one entry's origin and start with its path. A host name that points to a private address is not caught without this list: the webhook does not look names up.

`onForward` is told about every forward, delivered or not: `{ at, boundary, policy, sessionId, ref, destination, destinationFrom, delivered, status }`. `destination` is origin and path only — a query string can carry a token, so it is left out.

## Answers

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ "outcome": "processed" }` | Protected and forwarded |
| 200 | `{ "outcome": "blocked", "blockedBy": ["CREDIT_CARD"] }` | Not forwarded · tell the customer, e.g. *"please don't send card numbers in chat"* |
| 400 | `{ "error": "invalid_request", "field", "message" }` | The request is wrong · names the field, never the value |
| 401 | | Missing, wrong or expired signature · one answer for all three |
| 405 · 413 | | Not POST · body over `maxBodyBytes` (64 KiB) |
| 500 | `{ "outcome": "error" }` | The guard could not run · **nothing was forwarded** · send again |
| 502 | `{ "outcome": "forward_failed" }` | Protected, but `forwardTo` / `replyTo` did not take it · send again |

## Exchanging a token: `/resolve`

Signed with **`resolveSecret`**, not `secret` — an app that may send messages in cannot take real values out.

```json
{ "policy": "otp", "token": "[tok:…]", "sessionId": "conv_8f2a", "purpose": "otp_send", "caller": "otp-service", "ref": "call_77" }
```

→ `{ "ok": true, "value": "0918887777" }`, or `{ "ok": false, "reason": "purpose_not_allowed" }` (`not_found` · `session_mismatch` · `expired` · `purpose_not_allowed` · `store_unavailable`). Every attempt, allowed or not, is a `token.resolve` audit event.

`/end-session` with `{ "sessionId": "conv_8f2a" }` deletes every token of that chat. Both routes answer 404 when no policy tokenises.

## Tokens on serverless: `createUpstashTokenStore`

On a serverless platform each request may run on a different machine, and an idle one is shut down — a token kept in memory is gone before `/resolve` asks for it. So **a policy that tokenises needs a `tokenStore` every machine shares**, and `createWebhook` throws without one. `createUpstashTokenStore` talks to [Upstash Redis](https://upstash.com) over its REST API with `fetch`: no connection to keep open, no dependency added.

- **Redis holds the real values until each token expires** · keep `ttlSec` as short as the flow allows · choose the nearest region, and tell your DPO if data is stored outside Thailand · guard the REST token as closely as `resolveSecret`
- If Upstash is down or slow (2 s timeout), core never lets the real value through: the message is blocked, `/resolve` answers `store_unavailable`, a token in a reply becomes a placeholder

## Audit

`onAudit` is required — pass `() => {}` to discard audit on purpose. Events carry positions, types and ids, never a real value. If it returns a Promise, the webhook waits for it before answering: a serverless platform may stop the function once the response is sent.

Vercel keeps function logs for an hour (Hobby) or a day (Pro). **Before real customers, send audit somewhere it is kept** — a log drain or a database — `token.resolve` events above all.

## Options

| Option | |
|---|---|
| `policies` | `{ name: CompiledPolicy }` · names are letters, digits, `_` and `-` |
| `secret` | ≥ 32 bytes · `/inbound`, `/outbound`, `/end-session` and what is forwarded |
| `forwardTo` · `replyTo` | Defaults when a request names none · http(s) URLs · optional |
| `allowedDestinations` | Limits the destinations a request may name · https URLs · off by default |
| `onAudit` | Required |
| `onForward` | Told about every forward · waited for before the handler answers, as `onAudit` |
| `resolveSecret` · `tokenStore` | Required when a policy tokenises · `resolveSecret` must differ from `secret` |
| `hmacKey` | For a policy that uses `hash` |
| `onError` | As core's: failures core caught instead of throwing |
| `toleranceSec` | Signature age allowed either way · default 300 |
| `maxBodyBytes` | Default 65 536 |
| `forwardTimeoutMs` | Default 10 000 |

Startup problems throw `PdpaHttpError` with `code: 'ERR_PDPA_HTTP_CONFIG'`.

## Limitations

- Every detector limitation of core applies · see [Known limitations](https://www.npmjs.com/package/@eve-pdpa-extension/core#known-limitations)
- One JSON format · no adapter that takes a LINE or Slack webhook directly yet
- Text only · attachments are not part of the format

## Reporting a vulnerability

**Do not open a public issue.** Email **kunlachat@m-intelligence.tech** with the subject line starting `[eve-pdpa-extension security]`. Reproduce with made-up values — never send real personal data.

## License

Apache-2.0
