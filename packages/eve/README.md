# @eve-pdpa-extension/eve

Mask Thai personal data in an [eve](https://eve.dev) agent's channels — before eve records the message, before any hook sees it, before the model reads it.

- Wraps any eve channel: eve's own HTTP channel, Slack, Teams, Telegram, the Chat SDK bridge (LINE and others), your own `defineChannel`
- Masks with [`@eve-pdpa-extension/core`](../core): Thai national ID · phone number · email · bank account · credit card · LINE user ID
- A message the policy blocks is never handed to eve · every scan emits an audit event that **never contains the real value**
- Node 24+ · tested with eve **0.80.1** — eve is beta and its API moves; see [Requirements](#requirements)

> **This is a technical tool, not a certification of compliance with Thailand's Personal Data Protection Act (PDPA).**
> Using this package does not by itself make your agent compliant.

> **0.1.0 is not on npm yet.** The package is `"private": true` until it is released. Until then, use it from this repository's workspace — see [`examples/line-agent`](../../examples/line-agent).

[ภาษาไทย](./README.th.md)

---

## Where the masking happens

```
customer ──▶ channel ──▶ [ masked here ] ──▶ eve records the message ──▶ hooks ──▶ model
                           withPdpaGuard
                           guardChatSdk
```

An eve **hook cannot do this job**. eve's docs: hooks run *after* the event is durably recorded, are observe-only, and cannot change what the model reads. The only place an inbound message can still be changed is the channel, where it is handed to eve with `send()`. So this package wraps the channel, and ships a hook only as a second line: it cancels a turn whose message the policy blocks, in case some channel was left unwrapped.

## Install

```bash
npm install @eve-pdpa-extension/eve
```

`eve` is a peer dependency: your agent's own copy runs.

## Quick start

**1. eve's HTTP channel** — the routes `eve dev`, `curl`, the client SDK and `useEveAgent` talk to. Author `agent/channels/eve.ts` to replace the default with a wrapped one:

```ts
// agent/channels/eve.ts
import { withPdpaGuard } from '@eve-pdpa-extension/eve/guard'
import { localDev, placeholderAuth, vercelOidc } from 'eve/channels/auth'
import { eveChannel } from 'eve/channels/eve'

export default withPdpaGuard(eveChannel({ auth: [vercelOidc(), localDev(), placeholderAuth()] }), {
  onAudit: (event) => console.log(JSON.stringify(event)),   // in production, write to your audit store
})
```

**2. Any other channel** — wrap the value you would have exported. (`onAudit` below is your audit sink, as in step 1.)

```ts
// agent/channels/slack.ts
import { withPdpaGuard } from '@eve-pdpa-extension/eve/guard'
import { slackChannel } from 'eve/channels/slack'

export default withPdpaGuard(slackChannel(), { onAudit })
```

**3. The Chat SDK bridge** (LINE, WhatsApp, email…) — wrap the `send` that `chatSdkChannel` returns:

```ts
// agent/channels/line.ts
import { createMemoryState } from '@chat-adapter/state-memory'
import { guardChatSdk, PdpaBlockedError } from '@eve-pdpa-extension/eve/guard'
import type { Thread } from 'chat'
import { createLineAdapter } from 'chat-adapter-line'
import { chatSdkChannel } from 'eve/channels/chat-sdk'

const { bot, channel, send } = chatSdkChannel({
  userName: 'my-shop',
  adapters: { line: createLineAdapter() },
  state: createMemoryState(),
  streaming: false,
})

const guardedSend = guardChatSdk(send, {
  onAudit,
  // Tell the customer why nothing happened. The reason names the kind of data, never the data.
  onBlock: async ({ reason, thread }) => {
    await (thread as Thread).post(reason)
  },
})

bot.onDirectMessage(async (thread, message) => {
  try {
    await guardedSend(message.text, { thread })
  } catch (error) {
    if (!(error instanceof PdpaBlockedError)) throw error
  }
})

export default channel
```

**4. The extension** (optional, defence in depth) — mount it to cancel any turn whose message the policy blocks:

```ts
// agent/extensions/pdpa.ts
import pdpa from '@eve-pdpa-extension/eve'

export default pdpa({ onAudit })   // or pdpa({ policy, onAudit })
```

A full, runnable agent with all four is in [`examples/line-agent`](../../examples/line-agent).

### What changes

The customer types:

```
เลขบัตร 2-3570-37506-24-2 โทร 091-888-7777 เมล somchai@example.com
```

eve records, the hooks see, and the model reads ([default policy](#default_policy)):

```
เลขบัตร [เลขบัตรประชาชน] โทร xxx-xxx-7777 เมล [อีเมล]
```

A message with a credit card number is not handed to eve at all.

---

## `withPdpaGuard(channel, options?)`

Returns a copy of the channel whose every inbound message is masked first. Each route keeps its method, path and transport; every other field of the channel — adapter, events, build metadata such as Slack's app manifest — is kept as is.

What it covers:

| Operation | Masked |
|---|---|
| `from(address).send(message, options)` — what eve's built-in channels and the Chat SDK bridge use | the message, `options.context`, `options.title` |
| `attachSession(id).send(...)` · `to(channel, target).send(...)` | the same |
| `receive(input, ctx)` — a hand-off **into** this channel from another one | `ctx.from(...).send(...)`, as above |
| WebSocket routes (`WS(...)`) | the hooks the route returns send through the guarded operations |
| eve's HTTP routes `POST /eve/v1/session` and `POST /eve/v1/session/:sessionId` | the JSON body's `message` and `clientContext`, before eve reads it ¹ |
| `respond(...)` — answers to approval and question prompts | **not scanned**, passed through as is |

¹ In eve 0.80.1, creating a session over HTTP does not go through `from().send()`, so wrapping the operations alone would miss every first message. For these two routes the wrapper masks the request body itself — the channel's documented HTTP contract.

**When the policy blocks a message,** it is never sent: `onBlock({ address, reason })` is called, then

- on eve's HTTP routes the request is answered `422` with `{ "ok": false, "code": "pdpa_blocked", "error": "<reason>" }`
- everywhere else the `send()` throws `PdpaBlockedError`. eve's built-in channels catch a failed send and log it (Slack logs `delivery failed`); the customer hears nothing unless `onBlock` tells them

## `guardChatSdk(send, options?)`

Wraps the `send` that `chatSdkChannel` returns. Same signature as `send`. The message and any `context` or `title` passed with it are masked; a blocked message calls `onBlock({ reason, thread })` and throws `PdpaBlockedError` without calling `send`.

Use **either** `guardChatSdk(send)` **or** `withPdpaGuard(channel)` on a Chat SDK channel, not both — each would scan the message, and audit would get two events for one message.

## `guardContent(content, options?)`

The function underneath. Synchronous. Takes a string or an AI SDK `UserContent` array and returns

```text
| { blocked: false; content; events }   // content: a new string, or a new array whose text parts are masked
| { blocked: true;  reason;  events }   // reason: safe to show the customer
```

- Text parts are masked in order; image and file parts are passed through as the same objects, or block the message under `files: 'block'`
- Any one text part the policy blocks stops the whole message
- Never changes its input; with nothing to hide, an array comes back as the same array
- The core guard behind it is built once per `options` object — pass the same object each time, not a fresh literal per call

## `pdpaBlockHook(options?)` and the extension

`pdpaBlockHook` returns an eve hook on `message.received`. When the recorded message holds data the policy blocks, it calls `ctx.cancel()`, so the turn ends before the model runs; every message is also scanned for audit (`source: 'hook'`).

It **does not mask** — by the time it runs, eve has already recorded the message. Use it in addition to the channel wrappers, never instead.

The package's default export mounts it as an extension. Its config:

| Field | Meaning |
|---|---|
| `policy` | A policy as core's `definePolicy` takes it (the parsed JSON of a policy file). Default: [`DEFAULT_POLICY`](#default_policy) |
| `hmacKey` | For a policy that uses `hash` |
| `files` | `'block'` cancels a turn whose message has a file. Default `'pass'` |
| `onAudit` · `onError` | As in [Options](#options) |

A wrong field fails at the mount with the field's name and never a value: `Invalid extension config: policy: entities.PHONE.action: expected one of …`.

## Options

Shared by every function above.

| Option | Default | Meaning |
|---|---|---|
| `policy` | `DEFAULT_POLICY` | From core's `definePolicy` or `parsePolicy` |
| `hmacKey` | — | For a policy that uses `hash`. At least 32 bytes (`openssl rand -hex 32`) |
| `files` | `'pass'` | `'pass'`: image and file parts go on untouched, unscanned · `'block'`: they stop the message |
| `onAudit(event, ctx)` | discarded, with one warning | Every core audit event. `ctx.source` is `'channel'`, `'chat-sdk'`, `'hook'` or `'direct'`; `ctx.address` is the platform's conversation id |
| `onError(error, ctx)` | — | Told about failures core caught instead of throwing, such as an `onAudit` that threw |
| `onBlock(info)` | — | `withPdpaGuard` and `guardChatSdk` only. Called once per blocked message. A throw from it becomes the `cause` of the `PdpaBlockedError` |
| `detectors` | core's built-in set | Replaces core's detectors, as in core's `createGuard` |

A policy that uses `tokenise` is refused when the wrapper is built — see [Known limitations](#known-limitations).

### `DEFAULT_POLICY`

Core has no default policy, so this package ships one. No `tokenise` and no `hash`, so it needs no key and no token store:

| Type | Action | The model reads |
|---|---|---|
| `TH_NATIONAL_ID` | `redact` | `[เลขบัตรประชาชน]` |
| `PHONE` | `mask`, keep last 4 | `xxx-xxx-7777` |
| `EMAIL` | `redact` | `[อีเมล]` |
| `BANK_ACCOUNT` | `mask`, keep last 4 | `xxx-x-xx789-0` |
| `LINE_USER_ID` | `redact` | `[LINE ID]` |
| `CREDIT_CARD` | `block` from confidence 0.6 | nothing — the message is stopped |

Write your own with core's `definePolicy` — see [core's README](../core/README.md#policy).

## Audit

`onAudit` gets core's events unchanged — one `policy.loaded` when each wrapper is built, then one `scan` per string scanned (the message, and each `context` entry and `title` when present). Events carry positions and kinds, never a value. Their shape is core's `audit-event.schema.json`.

> **`ctx.address` is often personal data itself** — a LINE thread id contains the customer's LINE user id; a Twilio address is a phone number. Hash it before it goes anywhere your audit goes, or leave it out.

Scan events carry `sessionId: "anonymous"`: the wrapper does not know a session id that is safe to log.

## Errors

| Error | When |
|---|---|
| `PdpaBlockedError` (`code: 'PDPA_BLOCKED'`) | A guarded `send` was stopped. `reason` and `message` name the kind of data only |
| `PdpaError` `ERR_PDPA_INVALID_POLICY` | Thrown when a wrapper is built: the policy is not from `definePolicy`/`parsePolicy`, or it uses `tokenise` |
| `PdpaError` `ERR_PDPA_HMAC_KEY` | Thrown when a wrapper is built: the policy uses `hash` and `hmacKey` is missing or shorter than 32 bytes |
| `TypeError` | A message, part, `context` or `title` of a shape the guard cannot read. It is refused, never passed on unread. On eve's HTTP routes the answer is `400` |

## Known limitations

- **Inbound only.** The model's replies, streamed text and outbound messages are not masked
- **Tool inputs and outputs, MCP and OpenAPI connection results, and memory recall are not scanned**
- **`tokenise` is refused.** Nothing here can resolve a token for a tool yet, so a token would reach the model as a placeholder no one can exchange back. `redact`, `mask`, `hash`, `flag` and `block` work
- **File and image contents are not scanned, and neither are file names** · `files: 'block'` stops such messages instead
- **`respond()` is passed through.** Answers to approval and question prompts sent as structured input responses — which can carry free text — are not scanned. A plain-text reply the customer types goes through `send()` and is masked
- **On eve's HTTP channel, `context` and `title` returned by your own `onMessage` are not scanned** — the message `onMessage` receives is already masked, so what it copies from the message is masked too. eve's agent-to-agent routes (`/eve/v1/callback/…`, `/eve/v1/task-input/…`) are not scanned
- **Each text part is scanned on its own** — a number split across two parts is not found
- **A Thai national ID that also passes the card checksum, in a card issuer's range, is read by core as a credit card** and, under `DEFAULT_POLICY`, blocked rather than redacted — core settles an overlap toward the stricter action
- **The eve HTTP routes are recognised by method and path** (`POST /eve/v1/session`, `POST /eve/v1/session/:sessionId`). If a later eve moves them, re-run this package's integration test before upgrading
- Names and addresses are not detected yet — see core's limitations

## Requirements

- **Node 24 or later** — eve's own floor. (Core supports Node 18.18; this package does not)
- **eve**: tested with **0.80.1**. eve is beta; re-run the tests in this package before moving to a newer eve
- AI SDK 7 (`ai`), which eve already requires

## Reporting a vulnerability

**Do not open a public issue.** Email **kunlachat@m-intelligence.tech** with the subject line starting `[eve-pdpa-extension security]`. Reproduce with made-up values — never send real personal data.

## License

Apache-2.0
