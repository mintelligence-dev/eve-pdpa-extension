# @eve-pdpa-extension/eve

## 0.1.1

Install in three steps: `eve add`, four lines in `agent/agent.ts`, two keys. Everything from 0.1.0 is still there and works as before.

- `eve add https://cdn.jsdelivr.net/npm/@eve-pdpa-extension/eve@0.1.1/r/pdpa.json --overwrite` writes a policy, `agent/lib/pdpa.ts`, `agent/hooks/pdpa.ts` and a wrapped `agent/channels/eve.ts`. The package now ships that registry item in `r/`.
- `createPdpa({ policy })` in `@eve-pdpa-extension/eve/guard` builds the guard from the environment and returns `pdpa.channel`, `pdpa.model`, `pdpa.tool` and `pdpa.hook`, which call `withPdpaGuard`, `guardModel`, `withTokenResolution` and `pdpaHook` with it.
  - Keys from `PDPA_HMAC_KEY` and `PDPA_SESSION_KEY`; tokens in Upstash when `UPSTASH_REDIS_REST_*` or `KV_REST_API_*` is set (Upstash from the Vercel Marketplace sets the latter), with keys prefixed `pdpa-eve:`.
  - When `VERCEL_ENV` is `production`, a missing key or token store is a `PdpaConfigError` as the agent loads. Elsewhere it uses development keys and one memory store per process, and says so once.
  - Audit goes to stdout, one NDJSON line per event, unless you pass `onAudit`.
- `eve-pdpa-check [--production]`: a command that says whether every channel, the model and the hook are wrapped, eve is 0.80.x, and with `--production` the keys and a shared token store are set. It prints names, never values.
- `@eve-pdpa-extension/eve/guard` re-exports the types `PolicyInput`, `CompiledPolicy`, `AuditRecord`, `TokenStore` and `Guard`, so an agent does not need core as a direct dependency.

### Changed

- **`withPdpaGuard` now throws `ERR_PDPA_EVE_ADAPTER` for a channel from an eve it cannot mask.** A channel whose adapter posts only through events eve 0.80.x does not have — eve 1.0.0-rc.1 posts through `interaction.opened` and `interaction.settled` — used to be wrapped without complaint and post its replies unmasked. An agent on eve 1.0.0-rc.1 now stops when it loads instead. eve 0.80.x channels, and channels that post nothing, are not affected. `outbound: false` skips the check.

## 0.1.0

First release.

- `withPdpaGuard(channel, options)`: masks what a customer sends before eve records it or a model reads it, and what the channel posts back, for every eve channel — built-in or your own — by wrapping the channel's adapter. `outbound: false` turns the outbound side off.
- Answers to approvals and questions (`respond`, `inputResponses`) are masked like a message.
- `withTokenResolution(tool, options)`: gives a tool the real value behind a token, only for a purpose the policy allows. `withOutputGuard(tool, options)`: masks what a tool returns.
- `guardModel`, `guardContent`, `pdpaHook` and `derivePdpaSessionId` for model calls, content parts, observing a session, and the session id the guard keys tokens on.
- Known limits: the HTTP channel's NDJSON stream is not masked on the way out, and `reasoning.appended` is not masked. Both are in the README.
