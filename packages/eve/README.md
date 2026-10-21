# @eve-pdpa-extension/eve

Protect Thai personal data in an [eve](https://eve.dev) agent at every point it can leak: the customer's message before eve records it, a tool that needs the real value, the prompt before it leaves for the model provider, and the reply on Slack.

> **Mounting the extension alone does not mask anything.** eve runs hooks *after* it has recorded a message, and a hook cannot change what the model reads. Masking happens where this package wraps your channels, tools and model — see [The four layers](#the-four-layers). The extension only blocks and audits.

- Built on [`@eve-pdpa-extension/core`](../core): Thai national ID · phone number · email · bank account · credit card · LINE user ID · audit events that **never contain the real value**
- **Tokenise**: a phone number becomes `[tok:…]` for the model; a tool you choose gets the real number back for one purpose, in that chat only, until it expires
- Node 24+ · tested with eve **0.80.1** (beta — re-run the tests before moving)

> **This is a technical tool, not a certification of compliance with Thailand's Personal Data Protection Act (PDPA).**

> **0.1.0 is not on npm yet** (`"private": true`). The full working setup is [`apps/pdpa-agent`](../../apps/pdpa-agent).

[ภาษาไทย](./README.th.md)

---

## The four layers

| Layer | Helper | Protects |
|---|---|---|
| Channel | `withPdpaGuard(channel, …)` | Inbound messages — before eve records them, hooks see them, or the model reads them |
| Tool | `withTokenResolution(tool, …)` | Gives one tool the real values behind tokens, for one purpose; masks what the tool returns |
| Model | `guardModel(model, …)` | Every prompt on its way to the provider: tool results, connection results, recalled memory, history |
| Slack reply | `pdpaSlackRenderer(…)` | Replies: tokens shown as `xxx-xxx-7777`, unknown or foreign tokens as `[ข้อมูลที่ปิดไว้]` |

Plus **`pdpaHook(…)`** in `agent/hooks/`: required for tokenise. It stores the session id the other layers need, cancels a turn whose message the policy blocks (a channel left unwrapped), and deletes a chat's tokens when its session ends.

Outbound is protected on **Slack only** in 0.1. Other channels are masked inbound.

## Quick start

You own the guard — policy, keys, token store and audit sink all live in core's `createGuard`:

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

```ts
// agent/channels/slack.ts
import { pdpaSlackRenderer, withPdpaGuard } from '@eve-pdpa-extension/eve/guard'
import { slackChannel } from 'eve/channels/slack'
import { pdpa } from '../lib/guard.js'

export default withPdpaGuard(slackChannel({ renderers: [pdpaSlackRenderer(pdpa)] }), {
  ...pdpa,
  channelName: 'slack',   // this file's stem
})
```

```ts
// agent/hooks/pdpa.ts
import { pdpaHook } from '@eve-pdpa-extension/eve/guard'
import { pdpa } from '../lib/guard.js'

export default pdpaHook(pdpa)
```

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
  { ...pdpa, purpose: 'otp_send' },
)
```

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

The customer writes `ขอ OTP ที่เบอร์ 091-888-7777`. eve records and the model reads `ขอ OTP ที่เบอร์ [tok:pmkjhrpmbrqfnbqc]`; `otp_send` receives `0918887777`; its result goes back to the model as `[tok:…]`; the Slack reply reads `ส่ง OTP ไปที่ xxx-xxx-7777 แล้วค่ะ`.

---

## `withPdpaGuard(channel, options)`

Returns a copy of the channel whose every inbound message is masked first. Route methods, paths, transports and every other field — adapter, events, renderers, build metadata — are kept.

| Covers | How |
|---|---|
| `from(address).send()` — Slack, Teams, Telegram, the Chat SDK bridge, custom channels | message, `context` and `title` masked |
| `attachSession(id).send()` · `to(channel, target).send()` · `receive`'s `ctx.from().send()` · WebSocket routes | same |
| eve's HTTP channel, `POST /eve/v1/session` and `POST /eve/v1/session/:sessionId` | the JSON body's `message` and `clientContext`. A message on the create route is sent as the first follow-up of the session created just before it, so its tokens belong to that session |
| `respond()` — answers to approvals and questions | **not scanned** |

Options: `guard`, `sessionKey`, `channelName` (required except on eve's HTTP channel), `files` (`'pass'` default, or `'block'`), `onBlock({ reason, blockedBy })`, `language` (`'th'` default), `policy` and `allowRawTokensInOutput` (below).

A blocked message is never sent: `onBlock` runs, then the send throws `PdpaBlockedError` (eve's channels catch and log it). On eve's HTTP routes the answer is `422 { ok: false, code: "pdpa_blocked", error }`. A token store that is down blocks too, with its own reason.

**Tokens in replies.** eve's HTTP channel streams the model's reply as written, so a `[tok:…]` the model repeats reaches the caller. Wrapping that channel with a tokenising `policy` throws unless `allowRawTokensInOutput: true` — use it for local work only. Core's guard does not expose its policy, so pass `policy` for the check at wrap time; without it, the first message that would be tokenised on that channel is refused with `500 pdpa_config`.

## `withTokenResolution(tool, { guard, sessionKey, purpose, fields? })`

Inside `execute`: every token in the input (or in `fields`, e.g. `['phone']`) is exchanged with `guard.resolve(token, { purpose, sessionId })`; the original `execute` runs with the real values; its result goes through the guard at `tool_output` before it is returned — eve streams and keeps a tool's result, so it is masked there, not only for the model.

If a token cannot be used — expired, another chat's, a purpose the policy does not allow, the store down — the original `execute` is **not called**. The model gets `{ ok: false, reason, ask }`, e.g. `{ ok: false, reason: 'expired', ask: 'The value has expired. Ask the customer for it again.' }`. Description, schemas, approval and label are kept; generator tools stay generators.

## `guardModel(model, { guard, sessionKey })`

Wraps an AI SDK model (or a gateway id string) with `wrapLanguageModel`; every text of every prompt goes through the guard at `prompt`, tool results included. A text the policy blocks becomes `[ข้อมูลที่ปิดไว้]`.

- **Wrap subagents' models and a separate compaction model too** — each is its own call to a provider
- **The model's output is not masked here** — that is the Slack renderer's job, on Slack
- Set `modelContextWindowTokens` on the agent: eve looks the window up by model id, and a wrapped gateway model reports `gateway/<id>`
- After deploying on Vercel, check that the wrapped gateway model still authenticates with OIDC: send one message and look for a reply and a `scan` at `boundary: "prompt"`

## `pdpaSlackRenderer({ guard, sessionKey })`

A Slack renderer for `message.completed`: the reply goes through the guard at `outbound`. Tokens become their display form, foreign or unknown tokens `[ข้อมูลที่ปิดไว้]`, and a reply the policy blocks is replaced by a notice. The narration before a tool call is rewritten too (Slack shows it as the thread status). Questions, approvals and sign-ins keep eve's default.

## `pdpaHook({ guard, sessionKey, files?, blockOn? })`

Register it in `agent/hooks/pdpa.ts`. On `message.received` it stores the session's pdpa id (tools cannot see the channel address), and cancels the turn when the message holds data the policy blocks, or a type in `blockOn`. On `session.completed` and `session.failed` it calls `guard.endSession`. eve's `reset` reaches no hook: those tokens expire with `ttlSec`.

The package's default export mounts the same hook as an extension — `pdpa({ guard, sessionKey })` in `agent/extensions/pdpa.ts` — for setups without tokenise. With tokenise, register the hook in `agent/hooks/` so it shares session state with your tools.

## Session ids

Core writes `sessionId` to every audit event and keeps tokens apart by it, and warns against platform ids there. So every layer derives it:

```text
"eve_" + base32(HMAC-SHA256(sessionKey, conversation)).slice(0, 26)
conversation = "<channelName>:<address>"   or   "session:<eve session id>"  (eve's HTTP channel)
```

`derivePdpaSessionId(sessionKey, conversation)` is exported for your own code — a tool that calls `guard.resolve` itself, say.

## `guardContent(content, { guard, sessionId, boundary?, files? })`

The function underneath: masks a string or an AI SDK `UserContent` array, async. Returns `{ blocked: false, content }` or `{ blocked: true, reason, blockedBy }`.

## Known limitations

- **Outbound only on Slack.** Teams, Telegram, Discord, custom channels and eve's HTTP channel (and so `useEveAgent` web UIs) send the model's reply as written
- **`respond()` passes unscanned** — structured answers to approvals and questions, which can carry free text
- **Tokens issued on a `to()` hand-off cannot be resolved** in the receiving channel's session
- **Subagents** have their own session state: a tool in a subagent cannot resolve the parent's tokens
- **eve's HTTP create route**: a create request with a message and `callback` or `operationId` is refused (`400 pdpa_unsupported`) — create the session, then send
- **Each text part is scanned on its own**; file contents and file names are not scanned (`files: 'block'` stops such messages)
- **Names and addresses** are not detected yet (core)
- A Thai national ID that also passes the card checksum in an issuer's range is read by core as a credit card — blocked under a policy that blocks cards
- eve's HTTP routes are recognised by method and path; re-run the tests before moving eve

## Requirements

Node 24+ · eve 0.80.1 (tested) · AI SDK 7 (`ai`, a peer, as for eve)

## Reporting a vulnerability

**Do not open a public issue.** Email **kunlachat@m-intelligence.tech** with the subject line starting `[eve-pdpa-extension security]`. Reproduce with made-up values — never send real personal data.

## License

Apache-2.0
