# @eve-pdpa-extension/core

Detect and protect Thai personal data in text before it reaches an AI model, a tool, a log or a human reviewer.

- Thai national ID · phone number · email · bank account · credit card · LINE user ID
- 6 ways to protect a value, chosen per type by your policy · every scan emits an audit event that **never contains the real value**
- Zero dependencies · ~38 KB minified (~14 KB gzip) · runs on Node 18.18+ · Deno · Bun · Cloudflare Workers · browsers

> **This is a technical tool, not a certification of compliance with Thailand's Personal Data Protection Act (PDPA).**
> Using this library does not by itself make your system compliant.

[ภาษาไทย](./README.th.md)

---

## Install

```bash
npm install @eve-pdpa-extension/core
```

## Quick start

You need two things first:
1. A policy file · copy the example from [Policy](#policy) into `pdpa-policy.json`
2. A key for the `hash` action (the example policy hashes emails) · generate one with `openssl rand -hex 32` and store it as `PDPA_HMAC_KEY` · if the policy uses `hash` and there is no key, `createGuard` throws `ERR_PDPA_HMAC_KEY`

```ts
import { readFileSync } from 'node:fs'
import { createGuard, parsePolicy } from '@eve-pdpa-extension/core'

// Create once at server start · run on the server only
const guard = createGuard({
  policy: parsePolicy(readFileSync('pdpa-policy.json', 'utf8')),
  hmacKey: process.env.PDPA_HMAC_KEY,
  onAudit: (event) => console.log(JSON.stringify(event)),   // in production, write to your audit store
})

// 1. Customer message → before it goes to the AI
const inbound = await guard.process('เบอร์ ๐๙๑-๘๘๘-๗๗๗๗ ค่ะ', {
  sessionId: 'conv_8f2a',   // chat id · required if the policy uses tokenise
  ref: 'msg_10293',         // the message id in your system · lets you trace an audit event back
})
inbound.text   // 'เบอร์ [tok:rfdbkfrtnsmbvpsh] ค่ะ'   ← all the AI sees · a random token · the same number in the same chat gets the same token again

// 2. The AI calls a send-OTP tool with the token it saw · the tool exchanges it for the real value
//    In production the token comes from the AI's tool call · here it is taken from step 1 so the example runs
const token = `[tok:${inbound.findings[0]?.tokenId}]`
const r = await guard.resolve(token, { purpose: 'otp_send', sessionId: 'conv_8f2a' })
r.ok && r.value   // '0918887777'

// 3. The AI's reply → before it reaches the customer
const out = await guard.process(`ส่ง OTP ไปที่ ${token} แล้วค่ะ`, {
  sessionId: 'conv_8f2a',
  boundary: 'outbound',
})
out.text   // 'ส่ง OTP ไปที่ xxx-xxx-๗๗๗๗ แล้วค่ะ'   ← the customer never sees the token
```

- `process` returns a Promise · with a sync token store (the default) you can use `processSync`
- Returned text **keeps the customer's own formatting**: Thai digits stay Thai digits, and characters that are not personal data are left untouched
- A token lasts `ttlSec` (300 s by default, at most 3600) · after that `resolve` returns `{ ok: false, reason: 'expired' }` and an outbound reply shows `[ข้อมูลที่ปิดไว้]` · have the tool tell the AI to ask the customer for the value again, and set `ttlSec` to fit how long your flow takes
- **Tell the AI to pass the token on as it sees it** · in the system prompt, e.g. "customer details appear as `[tok:…]` · pass them to tools exactly as written, never guess the real value", and in the tool's parameter description · the AI never needs the real value, and never gets it: the tool resolves, then answers "sent", not the number
- `resolve` takes the token however the model copied it — with the brackets, without them or with one missing, with spaces inside them, wrapped in quotes, or the bare id · one token on its own, never a sentence containing one
- **OTP:** to verify who someone is, send to the number on record, not one typed in the chat · `tokenise` fits a tool that needs a value from the chat — sending a code to a new number, looking a customer up by phone, updating a CRM · the tool must limit how often it sends, since nothing here stops a chat asking for code after code

### `context` — when the customer replies with just a number

Bank account numbers have no check digit, so the detector needs a cue such as "เลขบัญชี" (account number) to catch one. If the shop asked and the customer replied with only the number, pass the shop's last message as `context`:

```ts
await guard.process('123-4-56789-0', { sessionId: 'conv_8f2a' })
// text: '123-4-56789-0'   ← no cue, so not caught

await guard.process('123-4-56789-0', { sessionId: 'conv_8f2a', context: 'รบกวนขอเลขบัญชีด้วยค่ะ' })
// text: 'xxx-x-xx789-0'
```

`context` is only read for cues. It is not scanned for personal data, not rewritten, and not written to audit.

### `boundary` — where the text sits in your system

| Value | Use for |
|---|---|
| `inbound` (default) | Messages from the customer |
| `prompt` | The assembled prompt before it goes to the model |
| `tool_input` · `tool_output` | What goes into a tool and what comes back |
| `outbound` | The reply on its way to the customer · **tokens are turned into their protected display** · a token from another chat, or one the guard does not hold (expired · deleted · invented in the same shape), becomes `[ข้อมูลที่ปิดไว้]` · text that only resembles a token but does not match its format, such as `[tok:abc]`, is sent as written · a real token is rewritten wherever it appears, with its brackets dropped or with spaces inside them |

---

## Policy

A JSON file that says what to do with each type of data:

```json
{
  "$schema": "./node_modules/@eve-pdpa-extension/core/schema/policy.schema.json",
  "entitySet": "0.1",
  "onUnmapped": "redact",
  "placeholderLanguage": "th",
  "entities": {
    "PHONE": { "action": "tokenise", "allowedPurposes": ["otp_send"], "ttlSec": 300, "display": "mask" },
    "TH_NATIONAL_ID": { "action": "redact" },
    "BANK_ACCOUNT": { "action": "mask", "keep": "last4" },
    "EMAIL": { "action": "hash" },
    "CREDIT_CARD": { "action": "block", "minConfidence": 0.6 },
    "LINE_USER_ID": { "action": "redact" }
  },
  "allowlist": {
    "exact": ["support@myshop.co.th", "02-123-4567"],
    "pattern": [".*@myshop\\.co\\.th"]
  }
}
```

- `$schema` gives you completion and warnings in VS Code and other editors
- `parsePolicy` checks every field on load · **a misspelled field is an error**, never silently skipped
- Check a file before using it with `npx @eve-pdpa-extension/cli policy validate pdpa-policy.json`
- Or write the policy in code with `definePolicy({ ... })`

| Field | Meaning |
|---|---|
| `entitySet` | The set of data types this policy was written against (`"0.1"`) · required |
| `entities.<TYPE>.action` | What to do with that type · see the next section |
| `minConfidence` | Findings the detector is less sure of than this are left alone · default `0.95` |
| `onUnmapped` | Types not listed in `entities` · `redact` (default) · `flag` · `ignore` · data types added in a future version stay protected until you write a rule for them |
| `allowlist` | Values let through, such as the shop's own phone and email · `exact` ignores formatting (`02-123-4567` = `021234567` = `๐๒๑๒๓๔๕๖๗`) · `pattern` must match the whole value |
| `placeholderLanguage` | `th` → `[เบอร์โทร]` · `en` → `[phone]` |

## The 6 actions

Result for the text `เบอร์ 091-888-7777 ค่ะ`:

| Action | Result | Use when |
|---|---|---|
| `redact` | `เบอร์ [เบอร์โทร] ค่ะ` | The AI does not need the value |
| `mask` | `เบอร์ xxx-xxx-xxxx ค่ะ` | It should see that there is a number, but not the digits · spaces, dashes and brackets stay; an email or LINE id has none, so all of it is hidden, `@` and dots included |
| `mask` + `keep: "last4"` | `เบอร์ xxx-xxx-7777 ค่ะ` | The customer needs to confirm which number it is |
| `mask` + `keep: "first2last4"` | `เบอร์ 09x-xxx-7777 ค่ะ` | As above, and the AI should see it is a mobile · six of ten digits are shown, so the rest is far easier to guess |
| `tokenise` | `เบอร์ [tok:ppfcrdqbdkttndvp] ค่ะ` | A tool needs the real value later · exchangeable only for `allowedPurposes` · expires after `ttlSec` (max 3600) |
| `hash` | `เบอร์ [PHONE:nmdfpsvvprsnpfgc] ค่ะ` | You need to recognise the same person without knowing the value, e.g. counting repeat customers · the same value always gives the same result · needs `hmacKey` |
| `flag` | `เบอร์ 091-888-7777 ค่ะ` | **The value reaches the AI as typed** · only recorded in audit |
| `block` | Empty text · `outcome: 'blocked'` · `blockedBy: ['PHONE']` | Data that must never be passed on, such as credit cards |

A blocked message always returns `text: ''`, so forgetting to check `outcome` does not leak it. Use `blockedBy` to choose what to tell the customer.

## Audit

Every time the guard runs, it calls `onAudit` with one event:

| type | When |
|---|---|
| `policy.loaded` | Once, when the guard is created · the full rules that `policy.hash` refers to · allowlist values and patterns are stored as SHA-256 |
| `scan` | Every `process` / `processSync` call · what was found, where, and what was done |
| `token.resolve` | Every attempt to exchange a token, allowed or refused · the purpose asked for · who asked |

```json
{
  "schemaVersion": "1.0",
  "type": "scan",
  "sessionId": "conv_8f2a",
  "ref": "msg_10293",
  "boundary": "inbound",
  "policy": { "hash": "fnv1a64:ee142dc8b1111706", "entitySet": "0.1" },
  "findings": [
    { "entity": "PHONE", "start": 6, "end": 18, "confidence": 0.99, "detector": "phone",
      "action": "tokenise", "tokenId": "rfdbkfrtnsmbvpsh", "ttlSec": 300, "allowedPurposes": ["otp_send"] }
  ],
  "outcome": "processed"
}
```
(Some fields left out for brevity · the full shape is in `@eve-pdpa-extension/core/schema/audit-event.schema.json`, which you can use to validate events in your log pipeline)

- Write events as NDJSON (one event per line) as they are
- `onAudit` is sync · if your destination is async, buffer first · if `onAudit` throws, the message still goes through, but it is counted in `guard.stats.auditSinkErrors` and passed to `onError(error, { source: 'audit_sink' })`
- Without `onAudit`, events are discarded with a one-time warning · to discard them on purpose, pass `onAudit: () => {}`

> **Keep audit logs apart from message logs** — events hold no real values, but `start`/`end` plus the original
> message give the value straight back. If both live in the same place, anyone who can open it can put them together.

> **`sessionId` and `ref` are written to audit exactly as you pass them** — if you use a LINE userId or a phone number
> as `sessionId`, your audit log holds personal data and must be stored and retained as personal data · to avoid that,
> use an id your system generates, such as `conv_8f2a`

## Running more than one process

By default, tokens live in the memory of a single process. If you run several processes or pods, they need a shared store. Example with Redis ([node-redis](https://github.com/redis/node-redis) v4):

```ts
import { createGuard, type TokenStore } from '@eve-pdpa-extension/core'
import { createClient } from 'redis'

const redis = await createClient({ url: process.env.REDIS_URL }).connect()

const tokenStore: TokenStore = {
  sync: false,
  async set(id, rec) {
    const session = `pdpa:session:${rec.sessionId}`
    await redis.set(`pdpa:tok:${id}`, JSON.stringify(rec), { PXAT: rec.expiresAt })
    await redis.sAdd(session, id)
    // The chat's token list must live as long as its longest-lived token, or endSession misses some
    // GT only ever extends the expiry, never shortens it · NX sets it the first time · needs Redis 7+
    if (!(await redis.pExpireAt(session, rec.expiresAt, 'GT'))) await redis.pExpireAt(session, rec.expiresAt, 'NX')
  },
  async get(id) {
    const raw = await redis.get(`pdpa:tok:${id}`)
    return raw === null ? undefined : JSON.parse(raw)
  },
  async delete(id) {
    await redis.del(`pdpa:tok:${id}`)
  },
  async clearSession(sessionId) {
    const ids = await redis.sMembers(`pdpa:session:${sessionId}`)
    await redis.del([...ids.map((id) => `pdpa:tok:${id}`), `pdpa:session:${sessionId}`])
  },
}

const guard = createGuard({ policy, tokenStore, onAudit })
await guard.process(text, { sessionId })   // an async store needs process, not processSync
```

- Requires Redis 7 or later (`PEXPIREAT … GT`)
- Redis holds the **real values** until they expire · keep it closed to outside access, and leave persistence off unless you need it
- Call `guard.endSession(sessionId)` when a conversation ends, to delete that chat's tokens at once
- **If the token store is unavailable** (Redis down · the in-memory store full at 10,000 tokens), the guard never lets the real value through, and does not throw:
  - A message that needs tokenising is **blocked** · its audit finding carries `failed: 'token_store'`, which tells it apart from a block the policy asked for
  - `resolve` returns `{ ok: false, reason: 'store_unavailable' }` and is audited like any other attempt
  - A token in an outbound reply becomes `[ข้อมูลที่ปิดไว้]` · audit records it as `unavailable`
  - Each time, `onError(error, { source: 'token_store' })` is called and `guard.stats.tokenStoreErrors` goes up · **point your health check at this count** — if it rises, the store is failing and messages are being blocked

## Errors you should know

All are `PdpaError`; check `error.code` · error messages never contain real values

| code | When |
|---|---|
| `ERR_PDPA_INVALID_POLICY` | The policy is wrong · names the bad field |
| `ERR_PDPA_HMAC_KEY` | The policy uses `hash` but there is no `hmacKey`, or it is shorter than 32 bytes · raised by `createGuard` |
| `ERR_PDPA_NO_SESSION` | The policy uses `tokenise` but no `sessionId` was passed |
| `ERR_PDPA_INVALID_INPUT` | `boundary` is not one of the five, `ref` is not 1–256 characters, or `context` is not a string |
| `ERR_PDPA_ASYNC_STORE` | `processSync` / `resolveSync` called with an async token store **under a policy that tokenises** · a policy without tokenise never uses the token store, so there is no error |
| `ERR_PDPA_NO_CSPRNG` | The runtime has no secure random source (Node 18) · see below |

## Before you use it

> **Run the guard on the server only** — anyone can read an `hmacKey` or a token that is in the browser,
> and users can edit browser code to skip the checks.

> **A hashed value is still personal data while the key exists** — there are about 10⁸ Thai mobile numbers;
> whoever gets the `hmacKey` can hash every one of them in minutes · `hash` is pseudonymisation, not
> anonymisation · the key must be random and at least 32 bytes (`openssl rand -hex 32`) · after a key change,
> old and new hashes no longer match.

> **A purpose is not a password** — code that holds the guard can name any purpose · it prevents accidental misuse
> and puts every request on record in audit · it does not stop an insider who means to cheat.

> **On Node 18, pass `randomSource` yourself if you use `tokenise`** — Node 18 has no `globalThis.crypto`
> · pass `randomSource: (n) => randomFillSync(new Uint8Array(n))` (`import { randomFillSync } from 'node:crypto'`)
> · it must be a secure random source, never `Math.random()` · Node 20+ needs nothing.

## Known limitations

- **Names and addresses are not detected yet** (planned for 0.2) · audit events carry `engine.entitiesSupported`, listing what was checked, so a report with no names in it does not mean there were none
- **Bank accounts need a cue** such as "เลขบัญชี" (account number) or "โอนเข้า" (transfer to), or pass `context` · a bare 10-digit number cannot be told apart from an order number
- **A phone number with no leading 0 needs a cue** such as "เบอร์" or "โทร", or pass `context` · `918887777` (Excel drops the 0) and `66918887777` (66 without the +) alone cannot be told apart from an order number · the same goes for a landline written with dots, `02.123.4567`
- **Short public numbers are not detected, on purpose** · `191`, `1669` and the like identify no one, and hiding them would stop a bot from saying "call 1669"
- **Phone numbers inside parcel tracking numbers are caught too**, e.g. `TH0812345678` · this is deliberate: if letters before the digits stopped detection, anyone could hide a real number by typing `x0918887777`
- **Credit cards from an unknown issuer** get confidence 0.6, below the default 0.95 · to protect them too, set `minConfidence: 0.6`
- **Confidence values and cues were set by reasoning**, not yet tuned on real customer data

## Accuracy

Measured strictly: a value not caught in full (for example 12 of 13 digits hidden) counts as **missed**, not half a point.

Holdout set of 3,435 messages, not used to tune the detectors:

| Type | Values | Precision | Recall | Recall with `context` |
|---|---|---|---|---|
| Thai national ID | 25 | 100% | 100% | 100% |
| Phone number | 165 | 99.4% | 96.4% | 100% |
| Email | 65 | 100% | 100% | 100% |
| Bank account | 50 | 100% | 80% | 100% |
| Credit card | 15 | 100% | 100% | 100% |
| LINE user ID | 5 | 100% | 100% | 100% |

> **Read these numbers with care** — every message is synthetic, so they only measure the shapes we thought of.
> Real data always has shapes nobody anticipated. **Every figure is an upper bound**, not what you will see in production,
> and some types have few samples (5 LINE user IDs).

## CLI

Scan old chat exports without writing code (JSONL · CSV · LINE OA exports):

```bash
npx @eve-pdpa-extension/cli scan chats.csv --policy pdpa-policy.json
```

See [`@eve-pdpa-extension/cli`](https://www.npmjs.com/package/@eve-pdpa-extension/cli)

## Reporting a vulnerability

**Do not open a public issue.** Email **kunlachat@m-intelligence.tech** with the subject line starting `[eve-pdpa-extension security]`. Reproduce with made-up values — never send real personal data.

## License

Apache-2.0
