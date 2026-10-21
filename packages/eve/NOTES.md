# eve API notes — verified against eve 0.80.1

Read from the installed package (`node_modules/eve/docs/` and the `.d.ts`/`.js`
under `node_modules/eve/dist/src/`) on 19 October 2026. eve is beta; re-check
every item here before moving the pin.

## Versions

| Package | Pinned | Why |
|---|---|---|
| `eve` | `0.80.1` (exact, devDependency) · `*` peer | latest on npm at install time, published 16 Oct |
| `ai` | `7.0.143` (devDependency) | eve's types import `UserContent` from `ai`; eve peers `ai ^7.0.137` |
| Node | 24 | `eve` declares `engines.node >=24`; the repo's `.npmrc` has `engine-strict=true`, so **`pnpm install` refuses Node 22 once eve is in the workspace** |

## Names this package relies on

| What | Where | Signature (abridged) |
|---|---|---|
| `defineChannel`, `GET`/`POST`/…/`WS` | `eve/channels` | `defineChannel(def) → Channel` — a plain object: `{ __kind, routes, adapter, cors, receive, turnPolicy }` |
| `RouteHandlerArgs<TState>` | `eve/channels` | `{ from, resolveSession, attachSession, to, params, waitUntil, requestIp, describe, listSkillFiles, readSkill, invokeTool }` |
| `ChannelSource.send` | via `args.from(address)` | `send(message: string \| UserContent, options: ChannelSendOptions) → Promise<Session>`; options carry `auth`, `context?: string[]`, `title?`, `outputSchema?`, `turnPolicy?`, `callback?`, `state` |
| `Session.send` | via `args.attachSession(id)` | `send(message, SessionSendOptions) → Promise<SessionSendCommandResult>`; options carry `auth`, `context?`, `title?` |
| `CrossChannelTargetHandle.send` | via `args.to(channel, target)` | `send(message, { auth, turnPolicy? }) → Promise<Session>` |
| `Channel.receive` | channel value | `receive(input, ctx: { from, resolveSession }) → Promise<Session>` — runs when **another** channel hands work to this one with `to(...)` |
| `HttpRouteDefinition` / `WebSocketRouteDefinition` | `eve/channels` | `{ transport?: "http", method, path, handler(req, args) → Promise<Response> }` / `{ transport: "websocket", method: "WEBSOCKET", path, handler(req, args) → hooks }`; WS hooks get the same `args` |
| `eveChannel` | `eve/channels/eve` | `eveChannel({ auth, onMessage?, events?, cors?, uploadPolicy?, fetchFile?, turnPolicy?, … }) → Channel` |
| `chatSdkChannel` | `eve/channels/chat-sdk` | `→ { bot, channel, send, respond }`; `send(message, { thread, adapterName?, auth?, context?, title?, … }) → Promise<Session>` |
| `defineHook` | `eve/hooks` | `defineHook({ events: { "message.received"(event, ctx) {} } })`; `ctx.cancel(): void`; `ctx.session.id` |
| `message.received` payload | stream protocol | `event.data = { message: string, parts?: ({type:"text",text} \| {type:"file",filename?,mediaType,size?,url?})[], sequence, turnId }` |
| `defineExtension` | `eve/extension` | `defineExtension({ config: StandardSchemaV1 }) → handle`; `handle(values)` mounts; `handle.config` is read lazily and falls back to `validate({})` before the mount runs |
| `mockModel` | `eve/evals` | `mockModel(respond)` — `respond(req)` gets `{ messages: {role,text}[], userMessages, lastUserMessage, … }`: every prompt message, system included |

## Findings that change the design

1. **The default eve HTTP channel does not create sessions through `from().send()`.**
   `POST /eve/v1/session` (create, optionally with the first message) calls an
   internal creator stored on the route args (`__eveRouteSessionCreator`), not
   `from`, `attachSession` or `to`. Wrapping those three alone would let the first
   message of every HTTP session through unmasked. `POST /eve/v1/session/:sessionId`
   (follow-up) does use `attachSession(id).send(...)`.
   → `withPdpaGuard` rewrites the JSON body of these two routes instead (`message`
   and `clientContext`, the two fields that reach the model), before eve parses it.
   That is the channel's documented public HTTP contract, not an internal.
2. **`send` options carry text too.** `context` strings are appended to session
   history as user messages (eve's own `clientContext`, Slack thread context), and
   Slack uses the message text as the session `title` in some cases. The guard
   masks `context` entries and `title` as well as the message.
3. **Built-in routes catch a failed `send`.** Slack wraps `sessionOperations.send` in
   `try/catch` and logs `delivery failed`; the Chat SDK bridge runs inside Chat SDK
   handlers. So throwing `PdpaBlockedError` from a guarded `send` does not cause a
   platform retry storm. The error message carries the safe reason only.
4. **Cross-channel hand-offs into a channel go through `receive`, not its routes.**
   `withPdpaGuard` wraps `receive`'s `ctx.from` as well.
5. **Hooks are observe-only and run after the event is durably recorded** (docs:
   *Hooks* → *Execution order*). `ctx.cancel()` from `message.received` stops the turn;
   the message is already in history. `pdpaBlockHook` is defence in depth only.
6. **`eve extension build`** compiles `extension/**` file by file into
   `dist/extension/**.mjs` + `.d.ts` (relative imports kept, bare imports left
   external), **deletes everything under `dist/` first**, writes `dist/index.mjs`
   (mount factory) and adds `./tools` to `exports`. It keeps other `exports`
   entries. So `./guard` points straight at `dist/extension/lib/guard.mjs`: one
   compiled copy of the code serves both entry points, and no second bundler is
   needed.
7. **Core has no default policy.** The package ships `DEFAULT_POLICY`, the same
   rules as `examples/vercel/policies/default.json` (no `tokenise`, no `hash`, so no
   key and no token store are needed).

## Differences from the spec

| Spec | Here | Why |
|---|---|---|
| `onAudit(event: CoreAuditEvent, …)` | `onAudit(event: AuditRecord, …)` | core's sink type: `scan` events plus one `policy.loaded` per guard |
| `files?: "pass" \| "block"` on parts typed `file`/`image` | AI SDK 7 `UserContent` has `text`, `image` and `file` parts | handled as specified |
| hook "scan mode" | core has no scan-only call; the hook runs `processSync` and reads `outcome` | `tokenise` is refused (below), so a scan has no side effects |
| `CoreOptions` | `policy`, `hmacKey`, `detectors`, `onError` | `tokenise` needs a token store, a session id that is not personal data, and a way for tools to resolve tokens — all out of scope for 0.1.0, so a policy that tokenises is rejected with a clear error instead of producing tokens nobody can resolve |
| `withPdpaGuard` throws `PdpaBlockedError` | same for `from`/`attachSession`/`to`/`receive`; the two eve HTTP message routes answer `422 {"ok":false,"code":"pdpa_blocked","error":<reason>}` | a route handler must return a `Response`; eve turns a thrown error into a generic 500 |
