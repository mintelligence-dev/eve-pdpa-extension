# @eve-pdpa-extension/eve

## 0.1.0

First release.

- `withPdpaGuard(channel, options)`: masks what a customer sends before eve records it or a model reads it, and what the channel posts back, for every eve channel — built-in or your own — by wrapping the channel's adapter. `outbound: false` turns the outbound side off.
- Answers to approvals and questions (`respond`, `inputResponses`) are masked like a message.
- `withTokenResolution(tool, options)`: gives a tool the real value behind a token, only for a purpose the policy allows. `withOutputGuard(tool, options)`: masks what a tool returns.
- `guardModel`, `guardContent`, `pdpaHook` and `derivePdpaSessionId` for model calls, content parts, observing a session, and the session id the guard keys tokens on.
- Known limits: the HTTP channel's NDJSON stream is not masked on the way out, and `reasoning.appended` is not masked. Both are in the README.
