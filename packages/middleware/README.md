# @eve-pdpa-extension/middleware

Express, Hono and Next.js middleware that hides Thai personal data in a chat request body before your handler sees it, and checks a JSON reply on the way out. Built on [`@eve-pdpa-extension/core`](https://www.npmjs.com/package/@eve-pdpa-extension/core): your guard and its policy decide what is hidden and how.

[ภาษาไทย](./README.th.md)

> Not published yet. Coming in 0.3.

## What it does

1. Reads the JSON body of each request and finds the customer's text — `messages[].content`, the Responses API's `input`, and the other shapes in the presets below. A JSON body is read even when it is sent as `text/plain` or with no content type, which is what `fetch` does with a string body.
2. Runs each one through your guard and puts the protected text back: `เบอร์ 0812345678` becomes `เบอร์ [tok:…]` or `เบอร์ [เบอร์โทร]`, as your policy says.
3. Hands your handler the protected body. Your handler does not change.
4. When the policy blocks a message, answers `422 { error: 'pdpa_blocked', boundary: 'inbound', blockedBy: [...] }` and your handler never runs.
5. With `responseFields`, checks a JSON reply the same way before it goes out. A blocked reply is answered `502` with `boundary: 'outbound'`.
6. When nothing needed protecting, your handler gets the request exactly as it came, byte for byte.

## Use

```bash
npm install @eve-pdpa-extension/middleware
```

One package is enough: `createGuard`, `definePolicy`, `parsePolicy` and `PdpaError` come with it, from the core it installs. Import them from here rather than from core, so your app and the middleware share one copy.

You still create the guard yourself — the policy is yours to decide. The middleware connects it to your server.

```ts
import { createGuard, parsePolicy } from '@eve-pdpa-extension/middleware'
const guard = createGuard({ policy: parsePolicy(policyJson), onAudit: (e) => log(e) })
```

For anything else core offers — a token store, `guard.resolve` — install `@eve-pdpa-extension/core` too, at the version this package depends on. Core's types come with this package as well: `Guard`, `GuardOptions`, `PolicyInput`, `EntityType`, `AuditRecord`.

Needs Node 20 or later. Tested with Express 5, Hono 4 and Next.js 16; Express 4 has not been tested.

### Express

```ts
import { pdpaExpress } from '@eve-pdpa-extension/middleware'

app.post(
  '/chat',
  express.json(), // the body must be parsed first
  pdpaExpress({ guard, sessionId: (req) => req.body.chatId }),
  chatHandler,
)
```

### Hono

```ts
import { pdpaHono } from '@eve-pdpa-extension/middleware'

app.post('/chat', pdpaHono({ guard, sessionId: (r, body) => body.chatId }), async (c) => {
  const body = await c.req.json() // already protected
})
```

Every function you give it — `sessionId`, `ref`, `context`, `onBlocked`, `onNoMatch` — gets the raw `Request` (`c.req.raw`), not Hono's `c`. `sessionId`, `ref` and `context` also get the body, already read as JSON, so a chat id sent in the body can be read there: the `Request` body itself cannot be read without `await`.

Put it before anything else that reads the body. A body read earlier is an error, not a pass: Hono answers 500 through `app.onError`, and the handler does not run.

### Next.js route handler

The handler gets the same kind of request it was written for: a `NextRequest` stays a `NextRequest`. Anything after the request, such as Next's `{ params }`, is passed to your handler as it came.

```ts
import { withPdpa } from '@eve-pdpa-extension/middleware'

export const POST = withPdpa(handler, { guard, responseFields: ['reply'] })
```

### Any other web-standard runtime

Deno, Bun, Cloudflare Workers, Remix, SvelteKit, Astro — anything that hands you a `Request`:

```ts
import { protectRequest, protectResponse } from '@eve-pdpa-extension/middleware'

const r = await protectRequest(request, { guard })
if (!r.ok) return r.response
const response = await handler(r.request)
return protectResponse(response, r.request, { guard, responseFields: ['reply'] })
```

### Anything else

`protectBody` takes parsed JSON and returns it protected. Fastify, Koa, NestJS, a queue worker:

```ts
import { protectBody } from '@eve-pdpa-extension/middleware'

const r = await protectBody(req.body, { guard, sessionId: 'conv_8f2a' })
if (!r.ok) return reply.code(422).send({ blockedBy: r.blockedBy })
req.body = r.body
```

It returns one of two shapes:

| | |
|---|---|
| `{ ok: true, body, changed, matched }` | `body` is the protected copy; your input is never changed · `changed` is `true` when anything was hidden, and when `false`, `body` is your input as it was · `matched` is how many strings `fields` reached: `0` means none, the same case the adapters report to `onNoMatch` |
| `{ ok: false, blockedBy }` | the policy blocked a message · `blockedBy` lists the types that caused it, and is empty when a guard blocks without naming one |

Its options are plain values, not functions:

| Option | |
|---|---|
| `guard` | From `createGuard` · required |
| `fields` | A preset or paths · default `chat` |
| `sessionId` | A string · required when the policy tokenises |
| `ref` | A string · copied into audit |
| `context` | A string · the other side's last message, see below |
| `boundary` | `'inbound'` (default) for what the customer sent · `'outbound'` to check a reply before it goes out: this chat's tokens are shown masked, and a block means the reply must not be sent |

`context` is the other side's last message, such as the question your bot just asked. A reply that is only `123-4-56789-0` after `ขอเลขบัญชีค่ะ` is then found as a bank account. It is read for cue words only: never changed and never written to audit. Every string in the body gets the same `context`. The adapters take it as a function: see Options.

```ts
const r = await protectBody(req.body, { guard, sessionId: 'conv_8f2a', context: lastBotMessage })
```

## Options

| Option | |
|---|---|
| `guard` | From `createGuard` · required |
| `fields` | Where the text is in the request: a preset or paths · default `chat` · a misspelt preset or a bad path throws when the middleware is created, at server start (`protectRequest` and `protectBody` throw on their first call) |
| `responseFields` | Where the text is in a JSON reply · leave it out and replies are not checked |
| `sessionId` | `(request, body) => string` · the conversation · required when the policy tokenises · not a phone number or LINE userId · `body` is the request read as JSON, before anything is protected, or `undefined` when it is not JSON · a reply is checked with the same value |
| `ref` | `(request, body) => string` · your id for the request, copied into audit so an event can be traced back to it |
| `context` | `(request, body) => string \| Promise<string>` · the other side's last message, such as what your bot last asked · `body` is the request already read as JSON · may look it up in your store · used for the request only, not the reply · never written to audit |
| `maxBytes` | Web-standard adapters (Hono, Next.js, `protectRequest`) · the longest request body read · longer is answered `413` and the handler never runs · default 1 MB · Express uses the `limit` of `express.json()` |
| `onBlocked` | `(blockedBy, request, boundary) => Response` (Express: `(blockedBy, req, res, boundary)`) · the answer when a message is blocked · `boundary` is `inbound` for what the customer sent, `outbound` for your reply · default 422 / 502 with `blockedBy` |
| `onNoMatch` | `(request, boundary) => void` (Express: `(req, boundary)`) · called when `fields` (or `responseFields`, for a reply) reach no string at all in a body read as JSON, so a shop that forgot to set `fields` for its body shape finds out · the request goes on as it was · a body with no text, such as a button press, is normal: use it to log, not to block · not called for a body that is not JSON or was blocked · if it throws, the request fails (Express: `next(error)`) |

**Paths:** `messages[].content` is the `content` of every item of `messages`. `[]` walks an array, a dot steps into an object. Only strings are protected.

To add your own paths to a preset, start from `PRESETS`:

```ts
import { PRESETS, pdpaExpress } from '@eve-pdpa-extension/middleware'
app.use(pdpaExpress({ guard, sessionId, fields: [...PRESETS.chat, 'metadata.note'] }))
```

| Preset | Paths |
|---|---|
| `chat` (default) | every chat path below |
| `openai` | `messages[].content`, `messages[].content[].text`, `input`, `input[].content`, `input[].content[].text` |
| `anthropic` | `messages[].content`, `messages[].content[].text` |
| `ai-sdk` | `messages[].content`, `messages[].parts[].text`, `prompt` |
| `line` | `events[].message.text` (a LINE Messaging API webhook) · not in `chat` |

An item with `role: 'system'` or `'developer'` is skipped: it is your instruction, not the customer's text, and often carries your own number on purpose. A top-level `system` field (Anthropic) is not on any path. Every other item is checked, `assistant` and `tool` included: your bot's earlier replies go back to the model too.

## What it answers

| Status | When | Body |
|---|---|---|
| `422` | the policy blocked a message the customer sent | `{ error: 'pdpa_blocked', boundary: 'inbound', blockedBy }` |
| `502` | the policy blocked your reply | `{ error: 'pdpa_blocked', boundary: 'outbound', blockedBy }` |
| `502` | your reply says it is JSON and is not | `{ error: 'invalid_json', boundary: 'outbound' }` |
| `400` | the request says it is JSON and is not | `{ error: 'invalid_json' }` |
| `413` | the request body is longer than `maxBytes` | `{ error: 'payload_too_large' }` |

Only the two blocks go through `onBlocked`. With Express, `400` and `413` come from `express.json()` itself, before this middleware runs.

## A webhook with a signature (LINE)

A signature over the body — LINE's `x-line-signature` — proves the request came from LINE. It is computed over the raw body, so **check it before this middleware**, never after: once a phone number is replaced, the body no longer matches.

```ts
// Express: LINE's own middleware checks the signature and parses the body
import { middleware as line } from '@line/bot-sdk'
app.post('/webhook', line({ channelSecret }), pdpaExpress({ guard, fields: 'line' }), handler)

// Web-standard: check, then protect
if (!validateSignature(await request.clone().text(), channelSecret, request.headers.get('x-line-signature'))) {
  return new Response('bad signature', { status: 401 })
}
const r = await protectRequest(request, { guard, fields: 'line' })
```

A request with nothing to protect passes through unchanged, so a signature checked after the middleware fails only on messages that carried personal data — which is exactly when it is hard to notice. Check first.

A webhook carries only the new message, not the bot's question before it. Give that question as `context`, from wherever you keep it, so a bare `123-4-56789-0` sent after "ขอเลขบัญชีค่ะ" is found. With a policy that tokenises, give `sessionId` too: your own id for the chat, looked up from `source.userId`, never the userId itself.

```ts
pdpaExpress({
  guard,
  fields: 'line',
  sessionId: (req, body) => chatIdFor(body.events[0]?.source.userId),
  context: (req, body) => lastBotMessage(body.events[0]?.source.userId),
})
```

## Known limitations

- **Streamed replies are not checked** · a reply written a word at a time (server-sent events) goes out as it is · check it with core where you assemble it
- **A reply labelled JSON that is not JSON is answered `502`** · it cannot be checked, so it is not sent on · a reply with no content type or `text/plain` is checked when it parses as JSON and passed as it is when it does not · any other type (HTML, a file) is passed as it is
- **A path may start with `[]`** when the body itself is an array: `fields: ['[].text']`
- **`*` is every key of an object**, for keys you cannot name in advance: `*.msg` reads `{"u1":{"msg":…},"u2":{"msg":…}}` · a broad pattern such as `*.*` also reaches ids and can hide them · a string two paths reach is checked once
- **JSON bodies only** · form posts and file uploads are passed through untouched · plain text that is not JSON is passed through too · a body labelled JSON that does not parse is answered 400
- **One blocked message blocks the whole request, history included** · nothing in it is sent on · a chat app that resends the whole history and keeps the blocked message in it (`useChat` adds it before sending) gets every later request blocked too · on a `422`, take the message out of the history the app sends
- **Every message in the body is read on every request** · a chat app that resends the whole history gets the earlier messages checked again (and audited again) · with `tokenise`, one value keeps one token per session, so the text the model sees stays the same
- **Express:** a JSON request with no `express.json()` before the middleware is an error that says so; a body that is not JSON is passed through · with `express.text()`, a string that holds JSON is checked and stays a string · on the way out, `res.json` and `res.send` with an object are checked (Express passes one to the other); `res.send` with a string, `res.jsonp` and streams are not · a custom `onBlocked` that calls `res.json` goes through the outbound check too, harmlessly, not `res.send` or a stream · with `responseFields`, `res.json` sends once the reply is checked, a moment later: `res.headersSent` is still `false` right after the call · **Hono:** a body read before `pdpaHono` runs is an error (500 through `app.onError`) and the handler does not run; so is a reply already read when `responseFields` is set
