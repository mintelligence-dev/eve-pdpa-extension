# examples/line-agent

A small Thai customer-service [eve](https://eve.dev) agent whose channels mask personal data with [`@eve-pdpa-extension/eve`](../../packages/eve) before eve records a message or the model reads it.

| File | What it does |
|---|---|
| `agent/channels/eve.ts` | eve's HTTP channel — what `curl`, the client SDK and `eve dev` use — wrapped with `withPdpaGuard` |
| `agent/channels/line.ts` | LINE through the Chat SDK bridge and the community adapter [`chat-adapter-line`](https://www.npmjs.com/package/chat-adapter-line), with `guardChatSdk`. A blocked message is answered with the reason. Switched off without LINE credentials |
| `agent/extensions/pdpa.ts` | The package's extension: cancels a turn whose message the policy blocks, in case a channel was left unwrapped |
| `agent/lib/pdpa.ts` | Options shared by all three: `DEFAULT_POLICY` and an audit sink writing NDJSON |
| `agent/lib/recording-model.ts` | eve's `mockModel`, recording every prompt it is sent — used when `PDPA_EXAMPLE_MOCK_MODEL=1` |
| `agent/lib/offline-line.ts` | Test-only: sends the LINE adapter's API calls to a local stub when `PDPA_EXAMPLE_LINE_API_BASE` is set |

Needs **Node 24**. It is a workspace package: install from the repository root.

## Run it locally, no API key

```bash
corepack pnpm install                       # at the repository root
cd examples/line-agent
corepack pnpm dev:mock                      # = PDPA_EXAMPLE_MOCK_MODEL=1 eve dev --no-default-extensions
```

`eve dev` opens its terminal UI on http://127.0.0.1:2000. In another terminal, send a message with made-up personal data:

```bash
curl -s -X POST http://127.0.0.1:2000/eve/v1/session \
  -H 'content-type: application/json' \
  -d '{"message":"เลขบัตร 2-3570-37506-24-2 โทร 091-888-7777 เมล somchai@example.com"}'
# {"ok":true,"sessionId":"wrun_…","status":"accepted"}
```

Read what eve recorded and what the mock model answered (it repeats what it read):

```bash
curl -s "http://127.0.0.1:2000/eve/v1/session/<sessionId>/stream?follow=false" | grep message
# "message.received" … "เลขบัตร [เลขบัตรประชาชน] โทร xxx-xxx-7777 เมล [อีเมล]"
# "message.completed" … "(โมเดลทดสอบ) ข้อความที่โมเดลได้รับ: เลขบัตร [เลขบัตรประชาชน] โทร xxx-xxx-7777 เมล [อีเมล]"
```

A message with a credit card number never reaches eve:

```bash
curl -s -X POST http://127.0.0.1:2000/eve/v1/session \
  -H 'content-type: application/json' -d '{"message":"บัตร 4111 1111 1111 1111 ค่ะ"}'
# {"ok":false,"code":"pdpa_blocked","error":"ข้อความนี้ไม่ได้ถูกส่งต่อ เพราะมีเลขบัตรเครดิต กรุณาส่งใหม่โดยไม่ใส่ข้อมูลนี้"}
```

Audit events go to stdout as NDJSON, one per line; set `PDPA_EXAMPLE_AUDIT_FILE` to write them to a file instead.

## With a real model

Drop `PDPA_EXAMPLE_MOCK_MODEL` and run `corepack pnpm dev`. `agent/agent.ts` names an AI Gateway model; give it `AI_GATEWAY_API_KEY` in `.env.local`, or sign in from the `eve dev` terminal UI with `/login`. See eve's docs: *Agent Configuration* (`node_modules/eve/docs/agent-config.md`).

## With LINE

Copy `.env.example` to `.env.local` and set `LINE_CHANNEL_ACCESS_TOKEN` and `LINE_CHANNEL_SECRET`. The webhook is `POST /eve/v1/line`. LINE needs a public https URL, so locally run a tunnel. Step by step: [MANUAL_TEST.md](./MANUAL_TEST.md).

The automated test — `packages/eve/test/integration.test.ts` — runs this LINE path offline: it signs a webhook the way LINE does and stubs LINE's API on 127.0.0.1.

## Deploy it yourself later

Nothing here deploys. When you do:

- Replace `placeholderAuth()` in `agent/channels/eve.ts` with real auth — it turns away all production traffic on purpose. eve docs: *Auth & route protection*
- Replace `createMemoryState()` in `agent/channels/line.ts` with a durable Chat SDK state adapter (Redis, Upstash…)
- Send audit to a real store instead of stdout, kept apart from message logs
- Follow eve's deployment guide: `node_modules/eve/docs/guides/deployment/overview.md` (or https://eve.dev/docs)
