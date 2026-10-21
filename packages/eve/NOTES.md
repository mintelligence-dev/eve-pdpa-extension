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
   rules as `apps/webhook/policies/default.json` (no `tokenise`, no `hash`, so no
   key and no token store are needed).

## Differences from the spec

| Spec | Here | Why |
|---|---|---|
| `onAudit(event: CoreAuditEvent, …)` | `onAudit(event: AuditRecord, …)` | core's sink type: `scan` events plus one `policy.loaded` per guard |
| `files?: "pass" \| "block"` on parts typed `file`/`image` | AI SDK 7 `UserContent` has `text`, `image` and `file` parts | handled as specified |
| hook "scan mode" | core has no scan-only call; the hook runs `processSync` and reads `outcome` | `tokenise` is refused (below), so a scan has no side effects |
| `CoreOptions` | `policy`, `hmacKey`, `detectors`, `onError` | `tokenise` needs a token store, a session id that is not personal data, and a way for tools to resolve tokens — all out of scope for 0.1.0, so a policy that tokenises is rejected with a clear error instead of producing tokens nobody can resolve |
| `withPdpaGuard` throws `PdpaBlockedError` | same for `from`/`attachSession`/`to`/`receive`; the two eve HTTP message routes answer `422 {"ok":false,"code":"pdpa_blocked","error":<reason>}` | a route handler must return a `Response`; eve turns a thrown error into a generic 500 |

---

# Run 2 recon — tokenise, tools, model, Slack renderer (eve 0.80.1, 20 Oct 2026)

Checked against the installed docs and by running a probe agent under `eve dev`.

| Question | Answer | How it was checked |
|---|---|---|
| What does a tool's `execute(input, ctx)` see? | `ctx` keys: `session`, `getSandbox`, `abortSignal`, `callId`, `toolName`, `messages`, `getToken`, `requireAuth`. **No channel, no continuation address** | probe tool, `tools/definition.d.ts` (`ToolContext = SessionContext & …`) |
| What does a hook see of the channel? | `ctx.channel = { kind, continuationToken? }`. `continuationToken` is **namespaced**: `"<channel file stem>:<address>"`, e.g. `zzprobe:T-123:abc` for `from("T-123:abc")` on `agent/channels/zzprobe.ts`. `kind` is `"http"` for every channel tried, so it does not name the channel. Sessions created through eve's HTTP channel have **no** `continuationToken` | probe hook on `*` |
| Can a hook hand a value to a tool in the same session? | Yes: a `defineState` handle (`eve/context`) declared in a shared module, written by an agent hook, is read by an agent tool in the same turn | probe |
| Slack renderers | `defineSlackRenderer({ events: { "message.completed"(event, channel, ctx, next) } })` from `eve/channels/slack`; `next()` or `next({ ...event, message })`; `channel.continuation.token` is the channel-local address; `ctx` is the session context, so `defineState` works there too | `channels/slack.mdx` *Customize rendering*, `ChannelContinuationOps` |
| Session-end events | `session.completed` and `session.failed` reach hooks. **`reset` emits nothing a hook sees** — no `session.completed`, no `session.failed` | probe: `from(addr).reset()` then the `*` hook |
| Model instance | `defineAgent({ model })` takes a gateway id string or an AI SDK `LanguageModel` (`agent-config.md`); `wrapLanguageModel` from `ai` 7 | docs + run 1 (`mockModel` is a `MockLanguageModelV4`) |
| Default tools | `defineAgent({ defaultTools: false })` removes the optional defaults (bash, file tools, web fetch/search…); `disableTool()` in `agent/tools/<name>.ts` removes one | `concepts/built-in-tools.md` |
| Core `Guard` exposes its policy? | No — `processSync`, `process`, `resolve`, `resolveSync`, `endSession`, `stats` only | core `types.ts` |

## Session id mechanism (spec 2.2)

`pdpaSessionId = "eve_" + base32(HMAC-SHA256(sessionKey, conversation)).slice(0, 26)`, where `conversation` is

- `"<channel>:<address>"` for a message that arrives through `from(address)` — exactly the hook's `ctx.channel.continuationToken`, so the channel wrapper needs the channel's file stem as an option (`channel: "slack"`);
- `"session:<eve session id>"` for a session with no continuation address — eve's HTTP channel. The follow-up route carries the id in its URL; the create route is split in two (create the session empty, then send the masked message as its follow-up) so the id exists before the message is masked.

Inside the session the id is carried by **`defineState`**: the hook computes it on the first `message.received` and stores it; the tool wrapper, the model middleware and the Slack renderer read it. Tools cannot see the address, so this is the fallback the spec allows, using state rather than channel metadata (metadata is not visible to tool `execute`).
