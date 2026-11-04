# @eve-pdpa-extension/eve

Mask Thai personal data in an [eve](https://eve.dev) agent before it reaches the model, gets recorded, or goes back to the customer.

```text
Customer writes          ขอ OTP ที่เบอร์ 091-888-7777
eve records / model reads ขอ OTP ที่เบอร์ [tok:pmkjhrpmbrqfnbqc]
otp_send tool receives    0918887777                     ← the real value, seen by this tool only
Reply the customer sees   ส่ง OTP ไปที่ xxx-xxx-7777 แล้วค่ะ
```

- Detection comes from [`@eve-pdpa-extension/core`](../core): Thai national ID, phone number, email, bank account, credit card and LINE user ID
- Audit events **never contain the real value**
- Node 24+, tested with eve **0.80.1** (eve is in beta: re-run the tests before moving to a new version)

> **This is a technical tool, not a certification of compliance with Thailand's Personal Data Protection Act (PDPA).**

[ภาษาไทย](./README.th.md)

---

## How it works

Personal data can leak at several points in an agent, so this package has a wrapper for each one. Each wraps a different part of the agent.

```text
customer ◀──▶ channel ── withPdpaGuard ── masks messages going in, before eve records them,
                                          and replies and questions going out
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
| `withPdpaGuard` | a channel, both ways | in: eve records the real value and the model reads it · out: the customer sees raw `[tok:…]` in the reply |
| `pdpaHook` | an agent hook | tools cannot resolve tokens issued on a channel with an address (Slack, Telegram, …), because they cannot tell which chat it is (eve's HTTP channel still works) |
| `guardModel` | the model | results from unwrapped tools, connections and memory reach the model provider with real values |
| `withTokenResolution` | a tool that needs real values | the tool gets `[tok:…]` instead of the real number and cannot do its job |
| `withOutputGuard` | a tool that fetches personal data itself, such as a CRM lookup | eve records and streams the tool's result with the real values in it |

> **Mounting the extension alone does not mask anything.** eve runs hooks *after* it has recorded a message, and a hook cannot change what the model reads. Masking happens where you wrap your channels, tools and model.

---

## Install in 3 steps

From an agent made with `eve init`: add the item, edit `agent/agent.ts`, set two keys.

<!-- pdpa-install -->
```bash
eve add https://cdn.jsdelivr.net/npm/@eve-pdpa-extension/eve@0.1.1/r/pdpa.json --overwrite
# Then fill in the two keys eve add put in .env.local, one `openssl rand -hex 32` each:
# PDPA_HMAC_KEY=...
# PDPA_SESSION_KEY=...
```

```ts title="agent/agent.ts"
import { defineAgent } from "eve";
import { pdpa } from "./lib/pdpa.js";

export default defineAgent({
  model: pdpa.model("openai/gpt-6-luna-fast"),
  modelContextWindowTokens: 1_050_000,
  reasoning: "high",
  defaultTools: false,
});
```
<!-- /pdpa-install -->

**1. `eve add` writes four files** and adds `@eve-pdpa-extension/eve` to `package.json`:

| File | What it is |
|---|---|
| `policies/pdpa-policy.json` | what happens to each kind of data: phones become tokens for `otp_send`, ID numbers are hidden, card numbers stop the message, … Edit it to fit |
| `agent/lib/pdpa.ts` | `createPdpa({ policy })`: the guard, its keys and its token store, read from the environment |
| `agent/hooks/pdpa.ts` | `export default pdpa.hook`: ties each chat to its tokens |
| `agent/channels/eve.ts` | eve's HTTP channel, wrapped. **`--overwrite` replaces the one `eve init` wrote** — and any of these four you have edited. Without it, eve add skips the file silently and the channel stays unwrapped |

**2. In `agent/agent.ts`**, four lines: import `pdpa`, wrap the model you already had in `pdpa.model(…)`, set `modelContextWindowTokens` (a wrapped model hides its id from eve's model catalog: use your model's context window), and turn off eve's default tools (bash, files, web fetch), which can send what the model reads to places no wrapper watches.

**3. The keys** are any two secrets of 32 bytes or more. Without them `eve dev` runs on development keys and says so once; production refuses to start.

**Check it.** `eve-pdpa-check` reads the project and says what is missing, by name, never a value:

```bash
npx eve-pdpa-check                # channels, model, hook, eve version
npx eve-pdpa-check --production   # also both keys and a shared token store
```

If jsDelivr is down, the same file is at `https://unpkg.com/@eve-pdpa-extension/eve@0.1.1/r/pdpa.json`.

### Deploy on Vercel

1. Add **Upstash for Redis** to the project from the Vercel Marketplace. It sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` yourself). Tokens are stored there, so every function instance can resolve them; keys start with `pdpa-eve:`.
2. Set `PDPA_HMAC_KEY` and `PDPA_SESSION_KEY` for Production — new values, not the ones in `.env.local`.

When `VERCEL_ENV` is `production` and a key or the store is missing, `createPdpa` throws as the agent loads, naming the variable. Anywhere else it falls back to development keys and a memory store, which only one machine can see.

### A tool that needs the real value

```ts
// agent/tools/otp_send.ts
import { defineTool } from "eve/tools";
import { pdpa } from "../lib/pdpa.js";

export default pdpa.tool(
  defineTool({
    description: "Send an OTP by SMS. Pass the phone number as written in the chat.",
    inputSchema: { type: "object", properties: { phone: { type: "string" } }, required: ["phone"] },
    async execute(input: { phone: string }) {
      // input.phone is the real number here, and only here.
      return { sent: true, to: input.phone };
    },
  }),
  "otp_send", // must be in the policy's allowedPurposes for PHONE
);
```

### Other channels

Wrap every file in `agent/channels/` the same way, with its file stem:

```ts
// agent/channels/telegram.ts
import { telegramChannel } from "eve/channels/telegram";
import { pdpa } from "../lib/pdpa.js";

export default pdpa.channel(telegramChannel(), "telegram");
```

---

## Set it up by hand

What `createPdpa` does for you, one wrapper at a time. It still works, and `pdpa.channel`, `pdpa.model`, `pdpa.tool` and `pdpa.hook` call exactly these.

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
import { withPdpaGuard } from '@eve-pdpa-extension/eve/guard'
import { slackChannel } from 'eve/channels/slack'
import { pdpa } from '../lib/guard.js'

export default withPdpaGuard(slackChannel(), {
  ...pdpa,
  channelName: 'slack',   // must match this file's stem
})
```

Wrap every file in `agent/channels/`, whichever channel it is: Slack, Telegram, Teams, Discord, your own. It is the same call each time, and it masks both ways. A channel you leave unwrapped hands eve the real values and posts the model's tokens as written.

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
import { withOutputGuard } from '@eve-pdpa-extension/eve/guard'
import { defineTool } from 'eve/tools'
import { pdpa } from '../lib/guard.js'

export default withOutputGuard(
  defineTool({
    description: 'Look up a customer by their customer number.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async execute(input: { id: string }) {
      // customer data from elsewhere: whatever it returns is masked before eve keeps it
      return { id: input.id, phone: '091-888-7777' }
    },
  }),
  pdpa,
)
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

### `createPdpa(options)`

```ts
import { createPdpa } from '@eve-pdpa-extension/eve/guard'
```

| Option | Default |
|---|---|
| `policy` | required: the policy JSON, imported (`with { type: 'json' }`), or a `definePolicy` result |
| `hmacKey`, `sessionKey` | env `PDPA_HMAC_KEY`, `PDPA_SESSION_KEY`; outside production a development value |
| `tokenStore` | Upstash from env `UPSTASH_REDIS_REST_*` or `KV_REST_API_*`; outside production one memory store per process |
| `upstash.prefix` | `'pdpa-eve:'`, in front of every key it writes |
| `onAudit` | one NDJSON line per event on stdout. An event never holds a value |
| `production` | `process.env.VERCEL_ENV === 'production'` (`NODE_ENV` is not read: build tools set it) |
| `env` | `process.env`; pass your own to read nothing else |

It returns `{ guard, sessionKey, policy, channel, model, tool, hook }`:

| | Same as |
|---|---|
| `pdpa.channel(channel, name, options?)` | `withPdpaGuard(channel, { guard, sessionKey, policy, channelName: name, ...options })`. Leave out `name` for eve's HTTP channel only |
| `pdpa.model(model)` | `guardModel(model, { guard, sessionKey })` |
| `pdpa.tool(tool, purpose)` | `withTokenResolution(tool, { guard, sessionKey, purpose })` |
| `pdpa.hook` | `pdpaHook({ guard, sessionKey })` |

**Errors** are a `PdpaConfigError`, thrown while the agent loads. The message names what to set, never a value:

| `code` | When |
|---|---|
| `ERR_PDPA_EVE_HMAC_KEY`, `ERR_PDPA_EVE_SESSION_KEY` | production without the key, or a key shorter than 32 bytes anywhere |
| `ERR_PDPA_EVE_STORE` | production without a token store, or only half of a URL and token pair set |
| `ERR_PDPA_EVE_PURPOSE` | `pdpa.tool` with a purpose no entity in the policy allows |
| `ERR_PDPA_EVE_ADAPTER` | a channel from an eve this package cannot mask (below) |

### `eve-pdpa-check [--production] [--cwd <dir>]`

| Check | Fails when |
|---|---|
| channels | a file in `agent/channels/` is not wrapped with `pdpa.channel(` or `withPdpaGuard(` |
| model | `agent/agent.ts` has no `pdpa.model(` or `guardModel(` |
| hook | no file in `agent/hooks/` default-exports `pdpa.hook` or `pdpaHook(…)` |
| eve | the installed eve is not 0.80.x |
| keys, store | with `--production`: a key, or a shared token store, is not set (in the environment or a `.env` file) |
| defaultTools | a warning only, when `agent/agent.ts` does not set `defaultTools: false` |

Exit 0 passes, 1 found a problem, 2 the command was used wrong.

### `withPdpaGuard(channel, options)`

Returns a copy of the channel whose every inbound message is masked first, and whose replies are masked before the channel posts them (below). Routes, events, renderers and every other field are kept.

| Option | Value |
|---|---|
| `guard`, `sessionKey` | from `pdpa` in step 1 |
| `channelName` | the channel file's stem (required except on eve's HTTP channel) |
| `files` | `'pass'` (default) lets files through; `'block'` refuses messages with files |
| `onBlock({ reason, blockedBy })` | called when a message is blocked, e.g. to send the customer a notice |
| `language` | language of the notice, `'th'` (default) |
| `outbound` | `true` (default) masks what the channel posts; `false` leaves its handlers as they are |
| `policy`, `allowRawTokensInOutput` | for eve's HTTP channel (below) |

**What is checked**

| Way in | Checked |
|---|---|
| `from(address).send()`, used by Slack, Teams, Telegram, the Chat SDK bridge and custom channels | the message, `context` and `title` |
| `attachSession(id).send()`, `to(channel, target).send()`, `receive`'s `ctx.from().send()` and WebSocket routes | the same |
| `respond()` on the same handles: the answer to an approval or a question | the typed answer or denial note (`text`) and `context`; a pressed button (`requestId`, `optionId`) passes as it is |
| eve's HTTP channel: `POST /eve/v1/session` and `POST /eve/v1/session/:sessionId` | `message`, `inputResponses[].text` and `clientContext` in the JSON body |

**When a message is blocked** it is never sent on: `onBlock` runs, then the send throws `PdpaBlockedError` (eve's channels catch and log it). A blocked answer works the same way, and its request stays open, so the person can answer again. On eve's HTTP routes the answer is `422 { ok: false, code: "pdpa_blocked", error }`. A token store that is down blocks too, with its own reason.

**What is masked on the way out.** eve's channels post from one handler per event. For each handler the channel has, `withPdpaGuard` masks the text of the event (boundary `outbound`) and then calls the channel's own handler with the masked copy, so the channel posts exactly as it does without the guard:

| Event | Masked |
|---|---|
| `message.completed` | the reply, and the narration before a tool call (Slack shows it as the thread status) |
| `input.requested` | the question, the choices, and the input of the tool call an approval gates |
| `input.resolved` | a typed answer shown back on the card |
| `actions.requested`, `action.partial`, `action.result` | the label a tool shows while it runs (a label built from the tool's input would show a token) |
| `reasoning.completed` | a finished reasoning block |

A known token is shown in its `display` form, e.g. `xxx-xxx-7777`; an unknown one, or another chat's, becomes `[ข้อมูลที่ปิดไว้]`; text the policy blocks is replaced by a notice (in `language`). If the guard cannot answer, such as when the token store is down, nothing is posted. What eve keeps and streams is not changed: a session's history still holds the token.

The handlers are on the channel's `adapter`, which eve does not document (0.80.1). The package's tests run it under the real eve runtime, so a release of eve that changes it fails there. A channel whose adapter posts only through events eve 0.80.x does not have — eve 1.0.0-rc.1's `interaction.opened` and `interaction.settled` — throws `ERR_PDPA_EVE_ADAPTER` when it is wrapped, rather than post replies unmasked.

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
- **The model's reply is not masked here**: that is the job of `withPdpaGuard` on the channel
- **Set `modelContextWindowTokens`**: eve looks the window up by model id, and a wrapped gateway model reports `gateway/<id>`
- **After deploying on Vercel**, check that the wrapped model still authenticates with OIDC: send one message and look for a reply and an audit `scan` at `boundary: "prompt"`

### `pdpaHook({ guard, sessionKey, files?, blockOn?, onUnmasked?, strict? })`

Register it in `agent/hooks/pdpa.ts`. Its options are checked when it is created, so a missing guard or `sessionKey` stops eve from loading the hook rather than surfacing on the first message.

| Event | What the hook does |
|---|---|
| `message.received` | stores the session's pdpa id for tools, the model and the channel, and cancels the turn when the message holds data the policy blocks, or a type in `blockOn` |
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

- **eve's HTTP channel is not masked on the way out**: it streams every event as the model wrote it, so `useEveAgent` web UIs and other clients of `/eve/v1/session/:id/stream` see tokens as written. Other channels, built in or your own, are masked where they post
- **Streamed deltas are not masked**: `message.appended` is only counted by Slack, not posted, but `reasoning.appended` can show part of the model's reasoning as the thread status until the finished (masked) reasoning replaces it. A token in it is a token, never the real value
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
