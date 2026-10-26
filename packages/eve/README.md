# @eve-pdpa-extension/eve

Mask Thai personal data in an [eve](https://eve.dev) agent before it reaches the model, gets recorded, or goes back to the customer.

```text
Customer writes          ขอ OTP ที่เบอร์ 091-888-7777
eve records / model reads ขอ OTP ที่เบอร์ [tok:pmkjhrpmbrqfnbqc]
otp_send tool receives    0918887777                     ← the real value, seen by this tool only
Slack reply               ส่ง OTP ไปที่ xxx-xxx-7777 แล้วค่ะ
```

- Detection comes from [`@eve-pdpa-extension/core`](../core): Thai national ID, phone number, email, bank account, credit card and LINE user ID
- Audit events **never contain the real value**
- Node 24+, tested with eve **0.80.1** (eve is in beta: re-run the tests before moving to a new version)

> **This is a technical tool, not a certification of compliance with Thailand's Personal Data Protection Act (PDPA).**

> **0.1.0 is not on npm yet** (`"private": true`). A full working agent that uses every layer is kept in a separate private repository.

[ภาษาไทย](./README.th.md)

---

## How it works

Personal data can leak at several points in an agent, so this package has a wrapper for each one. Each wraps a different part of the agent.

```text
              ┌─ withPdpaGuard ──── masks inbound messages, before eve records them
customer ──▶ channel
              └─ pdpaSlackRenderer / pdpaTelegramEvents ── masks the reply on its way out
                     │
                     ▼
                 pdpaHook ──────────── stores the session · cancels blocked messages · warns about unwrapped channels
                     │
                     ▼
                guardModel ─────────── masks the whole prompt before it leaves for the model provider
                     │
                     ▼
           withTokenResolution ─────── gives the real value behind a token to the tools you allow
            withOutputGuard ────────── masks the result of a tool that fetches personal data itself
```

| Helper | Wraps | Without it |
|---|---|---|
| `withPdpaGuard` | an inbound channel | eve records the real value and the model reads it |
| `pdpaSlackRenderer` / `pdpaTelegramEvents` | the reply on Slack / Telegram | the customer sees raw `[tok:…]` in the reply |
| `pdpaHook` | an agent hook | tools cannot resolve tokens issued on Slack or Telegram, because they cannot tell which chat it is (eve's HTTP channel still works) |
| `guardModel` | the model | results from unwrapped tools, connections and memory reach the model provider with real values |
| `withTokenResolution` | a tool that needs real values | the tool gets `[tok:…]` instead of the real number and cannot do its job |
| `withOutputGuard` | a tool that fetches personal data itself, such as a CRM lookup | eve records and streams the tool's result with the real values in it |

> **Mounting the extension alone does not mask anything.** eve runs hooks *after* it has recorded a message, and a hook cannot change what the model reads. Masking happens where you wrap your channels, tools and model.

---

## Quick start in 5 steps

### 1. Create the guard and the policy

This file is the one place that decides what happens to each kind of data. Every step below imports `pdpa` from it.

```ts
// agent/lib/guard.ts
import { createGuard, createMemoryTokenStore, definePolicy } from '@eve-pdpa-extension/core'

export const policy = definePolicy({
  entitySet: '0.1',
  entities: {
    PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'], ttlSec: 300, display: 'mask' },
    TH_NATIONAL_ID: { action: 'redact' },
    CREDIT_CARD: { action: 'block', minConfidence: 0.6 },
  },
})

export const guard = createGuard({
  policy,
  tokenStore: createMemoryTokenStore(),   // production: a shared store, such as Upstash
  onAudit: (event) => console.log(JSON.stringify(event)),
})

// openssl rand -hex 32 — the same key everywhere in one deployment
export const pdpa = { guard, sessionKey: process.env.PDPA_SESSION_KEY ?? '' }
```

**Actions**

| Action | The model sees | Use it when |
|---|---|---|
| `redact` | `[ข้อมูลที่ปิดไว้]` | nobody needs the value |
| `mask` | `xxx-xxx-7777` | the customer needs to tell which number it is, not see all of it |
| `tokenise` | `[tok:…]` | a tool needs the real value, e.g. to send an OTP |
| `hash` | `[PHONE:nmdfpsvvprsnpfgc]`, the same for the same value | you need to recognise the same person without the value (needs `hmacKey` in `createGuard`) |
| `flag` | the real value (recorded in audit only) | the value passes on purpose, but you want to know it was there |
| `block` | nothing: the message is refused | data you should never take in, such as card numbers |

**What `allowedPurposes` is.** For `tokenise` only: the list of reasons a token may be exchanged for the real value. You name them, e.g. `'otp_send'` or `'callback'`, then give a tool the same name in step 4. If the names do not match, that tool is refused every time.

### 2. Wrap your channels

```ts
// agent/channels/slack.ts
import { pdpaSlackRenderer, withPdpaGuard } from '@eve-pdpa-extension/eve/guard'
import { slackChannel } from 'eve/channels/slack'
import { pdpa } from '../lib/guard.js'

export default withPdpaGuard(slackChannel({ renderers: [pdpaSlackRenderer(pdpa)] }), {
  ...pdpa,
  channelName: 'slack',   // must match this file's stem
})
```

Wrap every file in `agent/channels/`. A channel you leave unwrapped hands eve the real values. For Telegram, see `pdpaTelegramEvents` in the reference below.

### 3. Register the hook

```ts
// agent/hooks/pdpa.ts
import { pdpaHook } from '@eve-pdpa-extension/eve/guard'
import { pdpa } from '../lib/guard.js'

export default pdpaHook(pdpa)
```

Tools cannot see which chat a message came from; this hook remembers it for them. With `tokenise`, it is required.

### 4. Wrap the tools that touch personal data

A tool that needs real values from the chat: wrap it with `withTokenResolution`.

```ts
// agent/tools/otp_send.ts
import { withTokenResolution } from '@eve-pdpa-extension/eve/guard'
import { defineTool } from 'eve/tools'
import { pdpa } from '../lib/guard.js'

export default withTokenResolution(
  defineTool({
    description: 'Send an OTP by SMS. Pass the phone number as written in the chat.',
    inputSchema: { type: 'object', properties: { phone: { type: 'string' } }, required: ['phone'] },
    async execute(input: { phone: string }) {
      // input.phone is the real number here, and only here.
      return { sent: true, to: input.phone }
    },
  }),
  { ...pdpa, purpose: 'otp_send' },   // must be in allowedPurposes from step 1
)
```

A tool that fetches personal data from elsewhere, such as a CRM or a database: wrap it with `withOutputGuard`. It takes no `purpose`, since it resolves no token.

```ts
// agent/tools/crm_lookup.ts
export default withOutputGuard(crmLookupTool, pdpa)
```

Both are needed because eve keeps and streams a tool's result as it is; `guardModel` masks it only on its way to the model. A tool that never touches personal data needs no wrapper.

### 5. Wrap the model

```ts
// agent/agent.ts
import { guardModel } from '@eve-pdpa-extension/eve/guard'
import { defineAgent } from 'eve'
import { pdpa } from './lib/guard.js'

export default defineAgent({
  model: guardModel('anthropic/claude-opus-5.5', pdpa),
  modelContextWindowTokens: 200_000,   // a wrapped model hides its id from eve's model catalog
  defaultTools: false,
})
```

The last check before data leaves your system: it masks whatever the earlier steps did not, such as an unwrapped tool's result or data from a connection.

---

## Reference

### `withPdpaGuard(channel, options)`

Returns a copy of the channel whose every inbound message is masked first. Routes, adapter, events, renderers and every other field are kept.

| Option | Value |
|---|---|
| `guard`, `sessionKey` | from `pdpa` in step 1 |
| `channelName` | the channel file's stem (required except on eve's HTTP channel) |
| `files` | `'pass'` (default) lets files through; `'block'` refuses messages with files |
| `onBlock({ reason, blockedBy })` | called when a message is blocked, e.g. to send the customer a notice |
| `language` | language of the notice, `'th'` (default) |
| `policy`, `allowRawTokensInOutput` | for eve's HTTP channel (below) |

**What is checked**

| Way in | Checked |
|---|---|
| `from(address).send()`, used by Slack, Teams, Telegram, the Chat SDK bridge and custom channels | the message, `context` and `title` |
| `attachSession(id).send()`, `to(channel, target).send()`, `receive`'s `ctx.from().send()` and WebSocket routes | the same |
| `respond()` on the same handles: the answer to an approval or a question | the typed answer or denial note (`text`) and `context`; a pressed button (`requestId`, `optionId`) passes as it is |
| eve's HTTP channel: `POST /eve/v1/session` and `POST /eve/v1/session/:sessionId` | `message`, `inputResponses[].text` and `clientContext` in the JSON body |

**When a message is blocked** it is never sent on: `onBlock` runs, then the send throws `PdpaBlockedError` (eve's channels catch and log it). A blocked answer works the same way, and its request stays open, so the person can answer again. On eve's HTTP routes the answer is `422 { ok: false, code: "pdpa_blocked", error }`. A token store that is down blocks too, with its own reason.

**eve's HTTP channel and tokens.** This channel streams the model's reply as written, so a `[tok:…]` the model repeats reaches the caller. Wrapping it with a policy that tokenises therefore throws unless `allowRawTokensInOutput: true` — use that for local work only.

Core's guard does not expose its policy, so pass `policy` for the check at wrap time. Without it, the first message that would be tokenised on that channel is refused with `500 pdpa_config`.

### `withTokenResolution(tool, { guard, sessionKey, purpose, fields? })`

When the tool is called:
1. every token in the input (or in `fields` only, e.g. `['phone']`) is exchanged for the real value with `guard.resolve(token, { purpose, sessionId })`
2. the original `execute` runs with the real values
3. its result is masked (boundary `tool_output`) before it is returned, because eve streams and keeps a tool's result, not only hands it to the model

If a token cannot be used, the original `execute` is **not called**. The model gets an answer like this instead, so it can ask the customer again:

| Reason | Example |
|---|---|
| expired (past `ttlSec`) | `{ ok: false, reason: 'expired', ask: 'The value has expired. Ask the customer for it again.' }` |
| another chat's token | `{ ok: false, reason: …, ask: … }` |
| `purpose` not in `allowedPurposes` | the same |
| the token store is down | the same |

Description, schemas, approval and label are kept; generator tools stay generators.

### `withOutputGuard(tool, { guard, sessionKey })`

When the tool is called, the original `execute` runs with the input as given (tokens stay tokens; nothing is resolved), and its result is masked (boundary `tool_output`) before it is returned, as in step 3 of `withTokenResolution`.

- a result that holds data the policy blocks becomes `{ ok: false, reason: 'blocked', ask }`
- description, schemas, approval and label are kept; a generator tool stays a generator, and each value it yields is masked
- a tool that both resolves tokens and fetches data itself needs only `withTokenResolution`, which masks its result already

### `guardModel(model, { guard, sessionKey })`

Wraps an AI SDK model (or a gateway id string) with `wrapLanguageModel`. Every text of every prompt goes through the guard (boundary `prompt`), tool results included. A text the policy blocks becomes `[ข้อมูลที่ปิดไว้]`.

- **Wrap subagents' models and a separate compaction model too**: each one calls the model provider on its own
- **The model's reply is not masked here**: that is the job of the Slack renderer and the Telegram events
- **Set `modelContextWindowTokens`**: eve looks the window up by model id, and a wrapped gateway model reports `gateway/<id>`
- **After deploying on Vercel**, check that the wrapped model still authenticates with OIDC: send one message and look for a reply and an audit `scan` at `boundary: "prompt"`

### `pdpaSlackRenderer({ guard, sessionKey })`

A Slack renderer for `message.completed`. The reply goes through the guard (boundary `outbound`) before it is posted.

- known tokens are shown in their `display` form, e.g. `xxx-xxx-7777`
- unknown tokens, or another chat's, become `[ข้อมูลที่ปิดไว้]`
- a reply the policy blocks is replaced by a notice
- the narration before a tool call is rewritten too (Slack shows it as the thread status)
- questions, approvals and sign-ins keep eve's default

### `pdpaTelegramEvents({ guard, sessionKey })`

eve's Telegram channel has no renderers, so this returns a `message.completed` entry for `telegramChannel({ events })`. It does what eve's built-in one does (posts the finished reply as plain text, posts nothing for the narration before a tool call), but masks the reply first, with the same results as the Slack renderer. Questions, approvals, sign-ins and errors keep eve's default.

```ts
export default withPdpaGuard(telegramChannel({ events: pdpaTelegramEvents(pdpa) }), {
  ...pdpa,
  channelName: 'telegram',
})
```

### `pdpaHook({ guard, sessionKey, files?, blockOn?, onUnmasked?, strict? })`

Register it in `agent/hooks/pdpa.ts`. Its options are checked when it is created, so a missing guard or `sessionKey` stops eve from loading the hook rather than surfacing on the first message.

| Event | What the hook does |
|---|---|
| `message.received` | stores the session's pdpa id for tools, the model and renderers, and cancels the turn when the message holds data the policy blocks, or a type in `blockOn` |
| `session.completed`, `session.failed` | calls `guard.endSession`, which deletes that chat's tokens |
| eve's `reset` | reaches no hook: those tokens expire with `ttlSec` |

**A channel you forgot to wrap.** A wrapped channel hands eve text that is already masked. When the hook still finds personal data in a recorded message, that message came through a channel nobody wrapped (types set to `flag` do not count: they pass on purpose). The hook then:

- calls `onUnmasked({ channel, entities })` if you set it
- otherwise warns once per channel in the log: `Wrap agent/channels/<channel>.ts with withPdpaGuard`
- with `strict: true`, also cancels the turn, so the model never reads it — though eve has recorded it by then

Neither the call nor the warning carries a value: only the channel name and the data types.

**Mounting as an extension.** The package's default export mounts the same hook as an extension: `pdpa({ guard, sessionKey })` in `agent/extensions/pdpa.ts`. Use it only for setups without tokenise. With tokenise, register the hook in `agent/hooks/` so it shares session state with your tools.

### Session ids

Core keeps tokens apart by `sessionId` and writes it to every audit event, and warns against platform ids there. So every layer of this package derives the id the same way:

```text
"eve_" + base32(HMAC-SHA256(sessionKey, conversation)).slice(0, 26)
conversation = "<channelName>:<address>"   or   "session:<eve session id>"  (eve's HTTP channel)
```

If your own code needs it, a tool that calls `guard.resolve` itself say, use `derivePdpaSessionId(sessionKey, conversation)`.

### `guardContent(content, { guard, sessionId, boundary?, files? })`

The function every layer uses underneath: masks a string or an AI SDK `UserContent` array, async. Returns `{ blocked: false, content }` or `{ blocked: true, reason, blockedBy }`.

---

## Known limitations

- **Outbound only on Slack and Telegram.** Teams, Discord, custom channels and eve's HTTP channel (and so `useEveAgent` web UIs) send the model's reply as written
- **The unwrapped-channel warning sees messages only**: `pdpaHook` gets no event for an answer to a question or an approval, so an answer through a channel nobody wrapped is not reported
- **Tokens issued on a `to()` hand-off cannot be resolved** in the receiving channel's session
- **Subagents have their own session state**: a tool in a subagent cannot resolve the parent's tokens
- **eve's HTTP create route**: a create request with a message and `callback` or `operationId` is refused (`400 pdpa_unsupported`); create the session, then send
- **Each text part is checked on its own**; file contents and file names are not checked (`files: 'block'` stops such messages)
- **Names and addresses are not detected yet** (a core limitation)
- **Some Thai national IDs read as credit cards**: one that also passes the card checksum in an issuer's range is blocked under a policy that blocks cards
- **eve's HTTP routes are recognised by method and path**: re-run the tests before moving to a new eve

## Requirements

- Node 24+
- eve 0.80.1 (tested)
- AI SDK 7 (`ai`, a peer dependency, as for eve)

## Reporting a vulnerability

Email **kunlachat@m-intelligence.tech** with the subject line starting `[eve-pdpa-extension security]`. Reproduce with made-up values — never send real personal data.

## License

Apache-2.0
