# @eve-pdpa-extension/middleware

Express, Hono and Next.js middleware that hides Thai personal data in a chat request body before your handler sees it, and checks a JSON reply on the way out. Built on [`@eve-pdpa-extension/core`](https://www.npmjs.com/package/@eve-pdpa-extension/core): your guard and its policy decide what is hidden and how.

[ภาษาไทย](./README.th.md)

> Not published yet. Part of 0.2.

## What it does

1. Reads the JSON body of each request and finds the customer's text — `messages[].content` and the other shapes chat apps send.
2. Runs each one through your guard and puts the protected text back: `เบอร์ 0812345678` becomes `เบอร์ [tok:…]` or `เบอร์ [เบอร์โทร]`, as your policy says.
3. Hands your handler the protected body. Your handler does not change.
4. When the policy blocks a message, answers `422 { error: 'pdpa_blocked', blockedBy: [...] }` and your handler never runs.
5. With `responseFields`, checks a JSON reply the same way before it goes out.

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

## Options

| Option | |
|---|---|
| `guard` | From `createGuard` · required |
| `fields` | Where the text is in the request: a preset or paths · default `chat` |
| `responseFields` | Where the text is in a JSON reply · leave it out and replies are not checked |
| `sessionId` | `(request) => string` · the conversation · required when the policy tokenises · not a phone number or LINE userId |
| `ref` | `(request) => string` · your id for the request, copied into audit so an event can be traced back to it |
| `onBlocked` | The answer when a message is blocked · default 422 with `blockedBy` |

**Paths:** `messages[].content` is the `content` of every item of `messages`. `[]` walks an array, a dot steps into an object. Only strings are protected.

| Preset | Paths |
|---|---|
| `chat` (default) | every path below |
| `openai` · `anthropic` | `messages[].content`, `messages[].content[].text` |
| `ai-sdk` | `messages[].content`, `messages[].parts[].text`, `prompt` |

A system prompt is not read: it is your text, not the customer's.

## Known limitations

- **Streamed replies are not checked** · a reply written a word at a time (server-sent events) goes out as it is · check it with core where you assemble it
- **JSON bodies only** · form posts and file uploads are passed through untouched · JSON that does not parse is answered 400
- **Every message in the body is read on every request** · a chat app that resends the whole history gets the earlier messages checked again (and audited again) · with `tokenise`, one value keeps one token per session, so the text the model sees stays the same
- **Express:** only `res.json` is checked on the way out, not `res.send` or a stream · **Hono:** a body read before `pdpaHono` runs is the unprotected one
