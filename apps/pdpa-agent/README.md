# apps/pdpa-agent

A Thai customer-service [eve](https://eve.dev) agent with every layer of [`@eve-pdpa-extension/eve`](../../packages/eve) wired in: customers' personal data is masked before eve records it, phone numbers become tokens the model can pass to a tool, the tool alone sees the real number, and Slack replies show it masked. It is the reference setup to copy — private, not published, deployed by you.

> **Not legal advice, and not a certificate of compliance with Thailand's PDPA.** It is a technical starting point.

[ภาษาไทย](./README.th.md)

## Quick start — local, no API key

Needs **Node 24**. From the repository root:

```bash
corepack pnpm install
corepack pnpm build                 # the agent imports packages/eve and packages/http as built
cd apps/pdpa-agent
corepack pnpm dev:mock              # eve dev with the scripted mock model, on http://127.0.0.1:2000
```

Ask for an OTP with a made-up number:

```bash
curl -s -X POST http://127.0.0.1:2000/eve/v1/session \
  -H 'content-type: application/json' \
  -d '{"message":"ขอ OTP ที่เบอร์ 091-888-7777 ค่ะ"}'
# {"ok":true,"sessionId":"wrun_…","status":"accepted"}

curl -s "http://127.0.0.1:2000/eve/v1/session/<sessionId>/stream?follow=false"
```

In the stream, watch the token being resolved:

| Event | What it shows |
|---|---|
| `message.received` | `ขอ OTP ที่เบอร์ [tok:…] ค่ะ` — eve recorded a token, never the number |
| `actions.requested` | the model calls `otp_send` with `{ "phone": "[tok:…]" }` |
| `action.result` | `{ "sent": true, "to": "[tok:…]" }` — the tool had the real number; its result is masked again |
| `message.completed` | the reply. **On this HTTP channel it holds the raw token** — see *The 4 layers* |

Audit goes to stdout as NDJSON: `scan` events at `inbound`, `prompt` and `tool_output`, and one `token.resolve` with `outcome: "allowed"`, `purpose: "otp_send"` — all under one derived session id, none holding the number.

A card number is refused before eve sees it: `curl … -d '{"message":"บัตร 4111 1111 1111 1111"}'` answers `422`.

## The 4 layers

| Layer | File | Protects |
|---|---|---|
| **Channel** | `agent/channels/eve.ts`, `agent/channels/slack.ts` — `withPdpaGuard` | Inbound messages, before eve records them, any hook sees them, or the model reads them. Tokenises phones, redacts IDs, hashes emails, blocks cards |
| **Tool** | `agent/tools/otp_send.ts` — `withTokenResolution` | Exchanges a token for the real number for `otp_send` only, in this chat only, until it expires; masks what the tool returns |
| **Model** | `agent/agent.ts` — `guardModel` | Every prompt on its way to the provider: tool results, history, anything the other layers missed |
| **Slack reply** | `agent/channels/slack.ts` — `pdpaSlackRenderer` | Replies: a token becomes `xxx-xxx-7777`, another chat's token `[ข้อมูลที่ปิดไว้]` |

Plus `agent/hooks/pdpa.ts` (`pdpaHook`): stores the session id tools need, cancels a turn whose message the policy blocks, deletes a chat's tokens when its session ends. It never masks — eve has recorded the message before a hook runs.

**eve's HTTP channel cannot rewrite replies**, so the model's `[tok:…]` reaches whoever calls it. `channels/eve.ts` passes `allowRawTokensInOutput: true` for local use only (eve dev, the terminal UI, tests). Customers reach the agent through Slack.

`defaultTools: false` in `agent/agent.ts` removes eve's shell, file and web tools: a customer-service agent needs none, and each is another way for a value to leave.

## What is not included

- Outbound protection on any channel but Slack — Teams, Telegram, Discord and custom channels are masked inbound only
- Streaming web UI replies (`useEveAgent`): eve's HTTP channel streams the reply as written
- Names and addresses: core does not detect them yet
- LINE

## Architecture boundary

- **The template stores no real value.** Real values live only in the token store, and only until `ttlSec` (300 s) or the end of the session
- **Upstash holds real phone numbers** until they expire. Keep it private to this project, and do not enable persistence you do not need
- `PDPA_HMAC_KEY` and `PDPA_SESSION_KEY` are production secrets. Whoever holds the HMAC key can reverse every email hash by trying addresses; the session key ties audit records to conversations
- Audit holds positions, types and the derived session id — keep it apart from message logs anyway

## Observability

The channels keep eve's default audience — an anonymous HTTP caller is `unknown`, Slack decides per conversation — and eve then records **metadata only** in preview and production traces. Do not set `audience: "public"` on these channels. Inbound text is masked before any trace sees it; this is defence in depth for tool arguments, tool results and model output. If you add a trace destination (`agent/instrumentation/*.ts`), give it a `tracePolicy` with `recordInputs: false` and `recordOutputs: false` unless it truly needs content — eve docs: `node_modules/eve/docs/guides/instrumentation/instrumentation.mdx`, *Control inputs and outputs*.

## Deploy it yourself

Nothing here deploys. When you do:

1. **Upstash**: create a Redis database (Vercel Marketplace → Upstash, or upstash.com). Its env vars go into the project; either `UPSTASH_REDIS_REST_*` or `KV_REST_API_*`
2. **Secrets**: `openssl rand -hex 32` twice → `PDPA_HMAC_KEY`, `PDPA_SESSION_KEY`
3. **Slack app**: create it at api.slack.com/apps, set `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`, point Event Subscriptions at `https://<your-domain>/eve/v1/slack` — eve's docs: `node_modules/eve/docs/channels/slack.mdx`
4. **Vercel project** from this repository:
   - Root Directory: `apps/pdpa-agent`
   - Keep *Include files outside the root directory in the Build Step* on: the agent uses `packages/eve`, `packages/http` and `packages/core` from this monorepo
   - Build Command: `corepack pnpm --dir ../.. build && eve build` — the packages' `dist/` is not in git, so they are built first
   - Function region: `sin1` (Singapore) is closest to Thai users — the same choice as `apps/webhook`
   - Environment variables: everything in `.env.example` except the `PDPA_TEMPLATE_*` test switches. `AI_GATEWAY_API_KEY` is not needed on Vercel: the AI Gateway uses the project's OIDC token
5. **Replace `placeholderAuth()`** in `agent/channels/eve.ts` with your own auth — it turns all production traffic away on purpose — or remove the HTTP channel
6. **Deploy** with `eve deploy` (eve docs: `node_modules/eve/docs/guides/deployment/vercel.mdx`)
7. **Check `guardModel` after the first deploy**: send one message and confirm a `scan` event with `boundary: "prompt"` in audit, and a reply from the real model — that proves the wrapped gateway model authenticates with OIDC

<!--
TODO "Deploy with Vercel" button: Vercel's deploy button has no root-directory
parameter (vercel.com/docs/deploy-button/source, checked 20 Oct 2026). A
subdirectory in repository-url clones only that folder, and this agent cannot
build without the workspace packages beside it. Add the button once
@eve-pdpa-extension/eve and /http are on npm and the template can depend on
published versions.
-->

## Tests

```bash
corepack pnpm --filter ./apps/pdpa-agent test
```

`test/e2e.test.ts` runs the agent under `eve dev` with the mock model and checks the OTP flow, a follow-up, a blocked card, and that no original value or secret reaches the prompt, history, audit or server log. `test/store.test.ts` checks the startup rules: no in-memory store and no missing secret in production.
