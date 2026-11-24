# @eve-pdpa-extension/middleware

Express, Hono and Next.js middleware that hides Thai personal data in a chat request body before your handler sees it, and checks a JSON reply on the way out. Built on [`@eve-pdpa-extension/core`](https://www.npmjs.com/package/@eve-pdpa-extension/core): your guard and its policy decide what is hidden and how.

[ภาษาไทย](./README.th.md)

> Not published yet. Part of 0.2.

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

One package is enough: `createGuard`, `definePolicy` and `parsePolicy` come with it, from the core it installs. Import them from here rather than from core, so your app and the middleware share one copy.

You still create the guard yourself — the policy is yours to decide. The middleware connects it to your server.

```ts
import { createGuard, parsePolicy } from '@eve-pdpa-extension/middleware'
const guard = createGuard({ policy: parsePolicy(policyJson), onAudit: (e) => log(e) })
```

For anything else core offers — a token store, `guard.resolve` — install `@eve-pdpa-extension/core` too, at the version this package depends on.

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

app.post('/chat', pdpaHono({ guard, sessionId: (r) => r.headers.get('x-chat-id') ?? undefined }), async (c) => {
  const body = await c.req.json() // already protected
})
```

Put it before anything else that reads the body.

### Next.js route handler

The handler gets the same kind of request it was written for: a `NextRequest` stays a `NextRequest`.

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

`context` is the other side's last message, such as the question your bot just asked. A reply that is only `123-4-56789-0` after `ขอเลขบัญชีค่ะ` is then found as a bank account. It is read for cue words only: never changed and never written to audit. Every string in the body gets the same `context`. The adapters take it as a function: see Options.

```ts
const r = await protectBody(req.body, { guard, sessionId: 'conv_8f2a', context: lastBotMessage })
```

## Options

| Option | |
|---|---|
| `guard` | From `createGuard` · required |
| `fields` | Where the text is in the request: a preset or paths · default `chat` |
| `responseFields` | Where the text is in a JSON reply · leave it out and replies are not checked |
| `sessionId` | `(request) => string` · the conversation · required when the policy tokenises · not a phone number or LINE userId |
| `ref` | `(request) => string` · your id for the request, copied into audit so an event can be traced back to it |
| `context` | `(request, body) => string \| Promise<string>` · the other side's last message, such as what your bot last asked · `body` is the request already read as JSON · may look it up in your store · used for the request only, not the reply · never written to audit |
| `onBlocked` | `(blockedBy, request, boundary) => Response` (Express: `(blockedBy, req, res, boundary)`) · the answer when a message is blocked · `boundary` is `inbound` for what the customer sent, `outbound` for your reply · default 422 / 502 with `blockedBy` |

**Paths:** `messages[].content` is the `content` of every item of `messages`. `[]` walks an array, a dot steps into an object. Only strings are protected.

| Preset | Paths |
|---|---|
| `chat` (default) | every chat path below |
| `openai` | `messages[].content`, `messages[].content[].text`, `input`, `input[].content`, `input[].content[].text` |
| `anthropic` | `messages[].content`, `messages[].content[].text` |
| `ai-sdk` | `messages[].content`, `messages[].parts[].text`, `prompt` |
| `line` | `events[].message.text` (a LINE Messaging API webhook) · not in `chat` |

An item with `role: 'system'` or `'developer'` is skipped: it is your instruction, not the customer's text, and often carries your own number on purpose. A top-level `system` field (Anthropic) is not on any path.

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


A webhook carries only the new message, not the bot's question before it. Give that question as `context`, from wherever you keep it, so a bare `123-4-56789-0` sent after "ขอเลขบัญชีค่ะ" is found:

```ts
pdpaExpress({
  guard,
  fields: 'line',
  context: (req) => lastBotMessage(req.body.events[0]?.source.userId),
})
```

## Known limitations

- **Streamed replies are not checked** · a reply written a word at a time (server-sent events) goes out as it is · check it with core where you assemble it
- **JSON bodies only** · form posts and file uploads are passed through untouched · plain text that is not JSON is passed through too · a body labelled JSON that does not parse is answered 400
- **Every message in the body is read on every request** · a chat app that resends the whole history gets the earlier messages checked again (and audited again) · with `tokenise`, one value keeps one token per session, so the text the model sees stays the same
- **Express:** a JSON request with no `express.json()` before the middleware is an error that says so; a body that is not JSON is passed through · with `express.text()`, a string that holds JSON is checked and stays a string · on the way out, `res.json` and `res.send` with an object are checked (Express passes one to the other); `res.send` with a string, `res.jsonp` and streams are not · a custom `onBlocked` that calls `res.json` goes through the outbound check too, harmlessly, not `res.send` or a stream · **Hono:** a body read before `pdpaHono` runs is the unprotected one
