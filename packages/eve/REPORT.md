# Run report — `@eve-pdpa-extension/eve` 0.1.0

Branch `feat/eve-adapter`, local only. Nothing was published, pushed, tagged or deployed. The package is still `"private": true`.

## What works

| | Status |
|---|---|
| `guardContent` — string and `UserContent`, text parts masked in order, file/image parts passed or blocked, input never changed | ✅ unit tests |
| `withPdpaGuard` — `from().send`, `attachSession().send`, `to().send`, `receive`'s `ctx.from`, WebSocket routes, and eve's two HTTP message routes (body masked, `422` on block) | ✅ unit tests + real eve runtime |
| `guardChatSdk` — masked send, `onBlock` with the thread, `PdpaBlockedError`, send never called on block | ✅ unit tests + real eve runtime over LINE |
| `pdpaBlockHook` + the extension mount (`pdpa({ policy })`) — cancels a blocked turn, audits with `source: "hook"`, config validated at the mount | ✅ unit tests + real eve runtime |
| No original value in the model prompt, the session history, audit, errors, `onBlock`, HTTP answers or the server log | ✅ `no-leak.test.ts` (every public function, masking and blocking policies) and `integration.test.ts` |
| `examples/line-agent` runs locally with the mock model and `curl` | ✅ checked by hand and by the integration test |
| LINE offline: signed webhook → mock model reads masked text → reply to LINE holds no original; blocked → notice, no model call; bad signature → 401 | ✅ `integration.test.ts` |
| `internal/consumer-eve` type-checks the mount factory and `./guard` under `node16` resolution | ✅ `pnpm typecheck` |
| `pnpm pack` contents · publint · attw (esm-only) | ✅ `pnpm --filter @eve-pdpa-extension/eve check:pack` |
| Root `pnpm verify` | see [Final verification](#final-verification) |

The integration test was mutation-checked once: making `withPdpaGuard` send the original message turns 8 tests red.

### Reproduce

Node 24 is required (see [Findings](#findings-worth-knowing) 1).

```bash
corepack pnpm install
corepack pnpm verify
corepack pnpm --filter @eve-pdpa-extension/eve test     # 6 files, 59 tests, ~7 s (starts eve dev once)
corepack pnpm --filter @eve-pdpa-extension/eve build
corepack pnpm --filter @eve-pdpa-extension/eve check:pack

# the example by hand
cd examples/line-agent && corepack pnpm dev:mock
curl -s -X POST http://127.0.0.1:2000/eve/v1/session -H 'content-type: application/json' \
  -d '{"message":"เลขบัตร 2-3570-37506-24-2 โทร 091-888-7777"}'
```

## eve version and the docs relied on

`eve` **0.80.1**, pinned exactly (latest on npm on 19 Oct 2026, published 16 Oct). `ai` 7.0.143. Read from the installed package, `node_modules/eve/docs/`:

- `channels/overview.mdx`, `channels/custom.mdx` (route args, *Wrap an existing channel's routes*, WS routes, cross-channel hand-off, file uploads), `channels/eve.mdx` (HTTP routes, replacing `agent/channels/eve.ts`), `channels/chat-sdk.mdx`
- `guides/hooks.md` (observe-only, execution order, `ctx.cancel()`), `concepts/sessions-runs-and-streaming.md` (`message.received` payload)
- `extensions.md`, `reference/cli.md` (`eve extension build`, `eve dev`), `reference/agent-files.md`, `reference/telemetry.md`
- `agent-config.md` (model), `evals/overview.mdx` (`mockModel`), `getting-started.mdx`, `sandbox/default.mdx`

and, where the docs did not say, the compiled source under `node_modules/eve/dist/src/` — notably `eve-channel/index.js` (how the HTTP channel dispatches), `channel/routes.d.ts`, `channel/channel-operations.d.ts`, `public/definitions/hook.d.ts`, `public/definitions/extension.js`, `evals/mock-model.js`. Details in [`NOTES.md`](./NOTES.md).

## Deviations from the spec

| Spec | Done | Why |
|---|---|---|
| wrap `from` / `attachSession` / `to` for every route | also masks the JSON body of `POST /eve/v1/session` and `POST /eve/v1/session/:sessionId`, and answers `422 {"ok":false,"code":"pdpa_blocked"}` there instead of throwing | eve 0.80.1 creates an HTTP session through an internal creator on the route args, not `from().send()`: wrapping the three operations alone let the **first message of every HTTP session through unmasked**. A route handler must return a `Response`; a throw becomes a generic 500 |
| mask the message | also masks `options.context` and `options.title`, and wraps `receive`'s `ctx.from` | `context` strings become user messages in history (eve's `clientContext`, Slack thread context); Slack may set `title` from the message text; `receive` is how another channel's `to(...)` hand-off arrives |
| `onAudit` ctx `source: "channel" \| "chat-sdk" \| "hook"` | adds `"direct"` for a call to `guardContent` itself | a direct call came from none of the three |
| `CoreOptions` | `policy`, `hmacKey`, `detectors`, `onError`; `tokenise` refused when the guard is built | a token needs a token store, a session id that is not personal data, and a tool that can resolve it — all out of scope for 0.1.0. Without them a token is redact that reads worse |
| `events: CoreAuditEvent[]` | the call's `scan` events (`AuditEvent[]`); `onAudit` also gets `policy.loaded` | core's sink type is `AuditRecord`; `policy.loaded` belongs to the guard, not a call |
| default policy = "core's default policy" | `DEFAULT_POLICY` ships in this package | core has none; same rules as `apps/webhook/policies/default.json` |
| `src/guard/index.ts` + maybe tsdown | one source tree, `extension/lib/`; `./guard` points at `dist/extension/lib/guard.mjs` | `eve extension build` compiles `extension/**` file by file and keeps extra `exports` entries, so one compiled copy serves both entry points and no second bundler is needed (it does delete all of `dist/` first) |
| Standard Schema lib "such as zod" | a hand-written Standard Schema whose `validate` runs core's own policy checks | no new dependency; errors name the field, never a value |
| extension config "carries the policy" | `pdpa({ policy?, hmacKey?, files?, onAudit?, onError? })` | room for the audit sink and key next to the policy |
| hook "scan mode" | `processSync` on the recorded text, cancel when `outcome` is `blocked` | core has no scan-only call; with `tokenise` refused, scanning has no side effects |
| eve's extension adds `./tools` | kept | `eve extension build` writes it every build (empty here) |
| the old package README named the wrapper `protectChannel` | `withPdpaGuard`, as the spec says | |
| tests type-checked | tests are not in `tsconfig.json` | same as core and http; the consumer fixture and the README check cover the public types |
| — | `examples/line-agent` added to `pnpm-workspace.yaml` by name | `examples/` as a whole should not become workspace packages |
| — | no new CI job | the `quality` job already runs on Node 24 and runs build, typecheck and `pnpm test` — which now include the eve package, the consumer fixture and the integration test |
| — | the example was written by hand, not with `eve init` | the owner stopped an `eve init` run in this session |

## Blockers and skipped tests

None blocked. Nothing is skipped on Node 24.

- `integration.test.ts` skips, with the reason printed, below Node 24 or when the example is not installed, or when `eve dev` does not answer `/eve/v1/health` within 45 s. Each test has a 60 s limit; `afterAll` stops the server (SIGTERM, then SIGKILL after 10 s) and its stub
- LINE was made reliable offline, so `MANUAL_TEST.md` is for trying a real LINE channel, not a stand-in for a missing test

## Findings worth knowing

1. **Installing the workspace now needs Node 24.** `.npmrc` has `engine-strict=true` and eve declares `engines.node >=24`, so `pnpm install` on Node 22 fails on eve. `.nvmrc` already says 24 and CI uses 24; the root `package.json` still lists `^22.19.0` among its engines — consider dropping it.
2. **eve's CLI sends telemetry by default.** `pnpm build` runs `eve extension build`, and some of this session's manual `eve` runs happened before telemetry was turned off. The integration test sets `EVE_TELEMETRY_DISABLED=1`. Decide whether to run `eve telemetry disable` on dev machines and set the variable in CI. While the integration test ran, eve opened no connection off the machine.
3. **Under `NODE_ENV=test` (set by vitest), `eve dev` does not call the agent's authored model the same way** — the recording model wrote nothing, yet turns completed. The test starts the server without `NODE_ENV`. Not investigated further.
4. **Restarting `eve dev` leaves earlier conversations dormant** (eve docs, *Local workflow recovery*). A LINE user who talked to the previous server gets no answer until `eve dev --resume`. The test uses a new synthetic LINE user per run.
5. **A Thai ID can be blocked as a credit card** — see request 4 below.

## Requests for core

1. **Export the entity names / placeholder tables** (`PLACEHOLDER_TH`, `PLACEHOLDER_EN` in `guard.ts`). The eve package keeps its own copy of the Thai and English names for block reasons.
2. **Export `isCompiledPolicy`.** The extension config can only accept a policy as JSON, because `definePolicy(compiledPolicy)` fails on the extra `hash` field and nothing public tells the two apart.
3. **A default policy in core.** The same rules now live in `apps/webhook/policies/default.json` and in this package's `DEFAULT_POLICY`.
4. **Credit card vs Thai ID.** A valid 13-digit Thai ID that also passes Luhn inside an issuer range (e.g. one starting `25…`, in Mastercard's 2-series, which is 16 digits long) is found as `CREDIT_CARD` with confidence 0.98 and, since the overlap settles toward the stricter action, the message is blocked under any policy that blocks cards. Seed 3 of the test helpers' generator produces one. Roughly 1 in 10 IDs pass Luhn. Consider checking card length per issuer, or letting a valid Thai ID checksum claim the span.
5. **A scan-only call** (findings and decided actions, no rewriting, no token issued) would suit hooks and audits better than running `processSync` and discarding the text.

## Left for the owner

- [ ] Review, then flip `"private": true` in `packages/eve/package.json` when it is time to release (and add `eve` to `PACKAGES` in `scripts/assert-tarballs.mjs`, and its READMEs to `scripts/check-readme.mjs`, if they should run on release)
- [ ] Try a real LINE channel: [`examples/line-agent/MANUAL_TEST.md`](../../examples/line-agent/MANUAL_TEST.md)
- [ ] Credentials in `examples/line-agent/.env.local`: `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, and a model credential (`AI_GATEWAY_API_KEY`, or `/login` in `eve dev`)
- [ ] Deploying the example is yours to do: replace `placeholderAuth()` and `createMemoryState()` first, then follow eve's *Deployment* guide (`node_modules/eve/docs/guides/deployment/overview.md`, https://eve.dev/docs)
- [ ] npm: add a trusted publisher for `@eve-pdpa-extension/eve`, and create `.github/workflows/publish-eve.yml` with the tag pattern `eve-v*` — **not created here**
- [ ] Decide on eve CLI telemetry (Finding 2)
- [ ] Look at the requests for core

## Final verification

19 Oct 2026, Node 24.22.0, pnpm 12.4.2, after deleting every package's `dist/` and `.size/`:

| Command | Result |
|---|---|
| `corepack pnpm install` | ✅ |
| `corepack pnpm verify` | ✅ exit 0 — lint · build · typecheck (incl. `consumer-eve`, `line-agent`) · 51 test files / 859 tests · gates (`assert-tarballs ok (core, cli, http)`) · size · smoke on node, deno, bun, workerd, chromium · smoke:cli · `check-readme ok (34 checks)` |
| `corepack pnpm --filter @eve-pdpa-extension/eve test` | ✅ 6 files, 59 tests |
| `corepack pnpm --filter @eve-pdpa-extension/eve build` | ✅ |

Core's gates are unchanged: zero dependencies, no builtins, size 38.71 kB raw / 14.69 kB gzip against the same limits, the same smoke matrix. The eve package is not in core's smoke matrix and not in `assert-tarballs`.

## Commits on `feat/eve-adapter`

On top of `feat/webhook` (`git log --oneline feat/webhook..feat/eve-adapter`, newest first), followed by the commit that adds this report:

```
4a1d244 docs(eve): write the package and example READMEs
d11e793 feat(examples): send LINE through guardChatSdk in the line-agent
d1325ad feat(examples): add a line-agent that runs eve with masked channels
f9abc08 docs(eve): point the default policy notes at apps/webhook
860dced test(eve): cover pdpaBlockHook, the extension mount and leaks
8811cb0 test(eve): cover withPdpaGuard and guardChatSdk
75ffe13 test(eve): cover guardContent on strings, parts and policies
ff50838 feat(eve): scaffold the eve extension package
```

---

# Run 2 — tokenise and the `apps/pdpa-agent` template

Spec: `docs/eve-template-tokenise-spec.md` (delta on run 1). Branch `feat/eve-template`, from `feat/eve-adapter`. Local only: nothing published, pushed, tagged, deployed or linked. `packages/eve` and the template stay `"private": true`.

## What works

| | Status |
|---|---|
| Every helper takes the caller's core `guard` and a `sessionKey`; `guard.process` throughout, so an async store (Upstash) works | ✅ unit tests |
| `derivePdpaSessionId` — `"eve_" + base32(HMAC-SHA256(key, conversation))[:26]`; audit only ever sees the derived id | ✅ `session.test.ts` |
| `withPdpaGuard` — session id per conversation; eve HTTP create route split into create + first follow-up so tokens belong to the session; store failure blocks with its own reason; tokenising policy on eve's HTTP channel refused unless `allowRawTokensInOutput` | ✅ `channel.test.ts`, `channel-tokenise.test.ts` |
| `withTokenResolution` — real value inside the tool only; result masked at `tool_output`; expired / wrong purpose / other chat / store down → original not called, safe refusal, `token.resolve` audited | ✅ `tool.test.ts` |
| `pdpaSlackRenderer` — tokens to display form, foreign tokens to `[ข้อมูลที่ปิดไว้]`, blocked reply replaced | ✅ `slack.test.ts` (with the end-to-end chain: Slack in → token → tool → Slack out) |
| `guardModel` — **landed**; prompt masked even when data arrives through a tool result | ✅ `model.test.ts` |
| `pdpaHook` — stores the session id, blocks, `endSession` on `session.completed` / `session.failed` (a resolved token stops resolving) | ✅ `hook.test.ts` |
| Hook canary — a hook that rewrites `message.received` cannot change what eve's mock model receives | ✅ `canary.test.ts` (real eve runtime) |
| `apps/pdpa-agent` under `eve dev` with the mock model: OTP flow end to end, one derived session id across inbound / prompt / tool_output / token.resolve, follow-up in Thai digits, card → 422, no original or secret in prompts, history, audit or server log | ✅ `apps/pdpa-agent/test/e2e.test.ts` |
| Template startup rules (no in-memory store and no missing secret in production) | ✅ `apps/pdpa-agent/test/store.test.ts` |
| `eve build --skip-sandbox-prewarm` for the template | ✅ by hand, and in the new CI job |
| No-leak sweep: synthetic values, `sessionKey` and `hmacKey` absent from returns, errors, causes, `onBlock`, HTTP answers, sends, tool results, prompts, renderer output, audit and console | ✅ `no-leak.test.ts` + e2e |

### Reproduce

```bash
corepack pnpm install
corepack pnpm verify
corepack pnpm --filter @eve-pdpa-extension/eve test
corepack pnpm --filter ./apps/pdpa-agent test

cd apps/pdpa-agent && corepack pnpm dev:mock          # then the curl in its README
```

The template imports `packages/eve`, `packages/http` and `packages/core` as built: run `corepack pnpm build` first after changing them (`verify` does).

## Choices the spec left open

- **Session id mechanism (2.2)**: tools see no channel address (eve 0.80.1 `ToolContext`), so `pdpaHook` stores the derived id in a `defineState` slot on the first `message.received`; tools, the model middleware and the Slack renderer read it. The conversation string is the hook's `ctx.channel.continuationToken` — eve already gives it as `"<channel>:<address>"` — or `"session:<eve id>"` for eve's HTTP channel, whose sessions have no address. Checked with a probe agent (NOTES.md, run 2) and by the template e2e test.
- **Extension vs agent hook (2.6)**: the mount factory takes `{ guard, sessionKey, files?, blockOn?, language? }` (eve keeps config in memory, so a live guard can travel in it), but the template registers `pdpaHook` in `agent/hooks/pdpa.ts`: an agent hook and an agent tool share session state, which was proven; extension-scoped state reaching agent tools was not.
- **`guardModel` (2.5)**: landed. `defineAgent` takes a model instance.

## Merge of `feat/webhook`

Clean: `origin/feat/webhook` was already contained in `feat/eve-adapter` (`git merge --no-edit origin/feat/webhook` → *Already up to date*). `pnpm-workspace.yaml` already had `apps/*`; the run-1 entry `examples/line-agent` was removed when the example moved to `apps/pdpa-agent` with `git mv`.

## Deviations from the spec

| Spec | Done | Why |
|---|---|---|
| `onBlock({ reason, blockedBy })` | as specified | `address` from run 1 dropped with it |
| streaming guard checks "the guard's policy" | `withPdpaGuard({ policy })` for the wrap-time check; without it, the first message tokenised on eve's HTTP channel is refused (`500 pdpa_config`, one `console.error`) | core's `Guard` does not expose its policy |
| eve HTTP create route | split into an empty create and a first follow-up; `callback` or `operationId` with a message is refused (`400 pdpa_unsupported`) | the create route goes through an internal creator, and the session id must exist before the message is tokenised; a split would re-send on an `operationId` retry |
| Slack renderer: `finishReason: "tool-calls"` → `next()` | narration before a tool call is rewritten too | Slack shows that narration as the thread status, so a token there would reach the customer |
| `./guard` exports | adds `guardContent` and types; **`guardChatSdk` removed** (`withPdpaGuard` covers the Chat SDK bridge, LINE is deferred); `DEFAULT_POLICY` removed (the caller owns the policy) | |
| template lists `extensions/pdpa.ts` | `hooks/pdpa.ts` | 2.6 decision above |
| template `test/` e2e "like §3.2" | the Slack leg of §3.2 is covered in `packages/eve/test/slack.test.ts`, not the template e2e | a real Slack round trip needs a signed event and Slack's API |
| `modelContextWindowTokens` not mentioned | set in the template (200k real, 1M mock) | eve finds a context window by model id in the AI Gateway catalog; a wrapped gateway model reports `gateway/<id>`, which the catalog does not list, and `eve build` fails without it |
| Deploy with Vercel button | TODO comment in the template README | Vercel's deploy button has no root-directory parameter (checked its docs); a subfolder in `repository-url` clones only that folder, and the template cannot build without the workspace packages |
| — | root `vitest.config.ts` includes `apps/*/test` | so `pnpm test` (and `verify`) runs the template tests too |

## Blockers and skipped tests

None blocked; nothing skipped on Node 24. The runtime tests (`canary`, template `e2e`) skip with a reason below Node 24 or when eve / the built package is missing, and fail loudly if `eve dev` does not start.

## Findings worth knowing

1. **eve's `reset` reaches no hook**, so `pdpaHook` cannot end a pdpa session that was reset; those tokens live until `ttlSec`.
2. **`disableRoute()` only replaces eve's own default slots** (`channels/eve.ts`, `channels/home.ts`); a channel file with no routes fails eve's compile. The template's Slack channel is therefore always exported; `slackChannel()` checks credentials per request.
3. **`eve dev` loads channel, hook and tool modules separately** (one `policy.loaded` per load), so an in-memory token store must sit on `globalThis` to be one store per process.
4. **Reading a JSON file via `import.meta.url` breaks under eve's bundling**; the template imports `policies/pdpa-policy.json` instead.
5. **`eve build` fetches the AI Gateway model catalog** (network, cached in `.eve/cache`) for a gateway model; the template's explicit `modelContextWindowTokens` avoids the lookup. Sandbox prewarm needs Docker or `microsandbox`; the template opens no sandbox, so CI builds with `--skip-sandbox-prewarm`.
6. The template's dist dependency: `eve dev` builds only *mounted* workspace extensions; the template imports `@eve-pdpa-extension/eve/guard` directly, so a stale `packages/eve/dist` is used until `pnpm build`. One bug in this run (a session id derived twice on the HTTP path) was hidden that way for one manual run.

## Requests

- **core**: expose the policy a guard was built with (`guard.policy`), so wrappers can check for `tokenise` without the caller passing the policy twice. Run-1 requests still stand (`isCompiledPolicy`, entity-name tables, a default policy, the card/ID overlap, a scan-only call).
- **http**: none — `createUpstashTokenStore` is exported and the template imports it as is.
- **eve** (upstream, for the record): a hook event on `reset`; a way for a wrapped model to keep its gateway catalog id.

## Left for the owner

- [ ] Create the Upstash database (Vercel Marketplace or upstash.com) and add its env vars to the Vercel project
- [ ] `openssl rand -hex 32` twice → `PDPA_HMAC_KEY`, `PDPA_SESSION_KEY`
- [ ] Slack app: create it, set `SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET`, point Event Subscriptions at `/eve/v1/slack`
- [ ] Vercel project: Root Directory `apps/pdpa-agent`, include files outside the root, Build Command `corepack pnpm --dir ../.. build && eve build`, region `sin1`, env vars from `.env.example`
- [ ] Replace `placeholderAuth()` in `apps/pdpa-agent/agent/channels/eve.ts`, or drop the HTTP channel in production
- [ ] Deploy (`eve deploy`) — not run here
- [ ] After deploy, verify `guardModel` with OIDC: one message → a real reply and a `scan` at `boundary: "prompt"` in audit
- [ ] Flip `"private"` in `packages/eve/package.json` when ready; create `.github/workflows/publish-eve.yml` with tag pattern `eve-v*` (not created here)
- [ ] Re-date the eve commits on the 21st as planned — both `feat/eve-adapter` and `feat/eve-template` are local

## Final verification (run 2)

20 Oct 2026, Node 24.22.0, pnpm 12.4.2, after deleting every package's `dist/` and `.size/`:

| Command | Result |
|---|---|
| `corepack pnpm install` | ✅ |
| `corepack pnpm verify` | ✅ exit 0 — lint · build · typecheck (incl. `consumer-eve`, `pdpa-agent`) · 57 test files / 877 tests · gates (`assert-tarballs ok (core, cli, http)`) · size (core 38.71 kB / 14.69 kB gzip, unchanged) · smoke on every runtime · smoke:cli · `check-readme ok (34 checks)` |
| `corepack pnpm --filter @eve-pdpa-extension/eve test` | ✅ 10 files, 69 tests |
| `corepack pnpm --filter ./apps/pdpa-agent test` | ✅ 2 files, 8 tests |

No `eve dev` process was left running.

## Commits on `feat/eve-template`

On top of `feat/eve-adapter` (`git log --oneline feat/eve-adapter..feat/eve-template`, newest first), followed by the commit that adds this section:

```
1b85f03 ci(eve): add a Node 24 job for the adapter and the template
3cd3848 feat(pdpa-agent): wire every layer into the template agent
9cb2108 test(eve): prove hooks cannot mask, and type-check every export
78e78d5 feat(eve): mask the whole prompt with guardModel
0be86b2 feat(eve): rewrite Slack replies with pdpaSlackRenderer
cedadc7 feat(eve): resolve tokens for a tool with withTokenResolution
fdcdef7 test(eve): cover a down token store and tokens in unrewritten replies
2cf52d7 feat(eve): take the caller's core guard and derive session ids
a7ec3e6 chore(eve): move the example agent to apps/pdpa-agent
```
