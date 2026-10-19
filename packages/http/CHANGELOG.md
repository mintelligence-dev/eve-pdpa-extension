# @eve-pdpa-extension/http

## 0.1.0

First release. Not yet published.

- `createWebhook` returns four handlers that take a web `Request` and return a `Response`: `/inbound` protects a customer's message and forwards it to `forwardTo`, `/outbound` checks the answer and sends it to `replyTo`, `/resolve` exchanges a token for its real value, `/end-session` deletes a chat's tokens.
- Every request is checked against an HMAC-SHA256 signature over a timestamp and the body, and everything forwarded is signed the same way. `signRequest` and `verifyRequest` are exported for the two ends. A missing, wrong or stale signature gets one answer, 401.
- Named policies: a request chooses one of the policies the webhook was built with, or `default`. It can never send rules of its own.
- The caller names where a message goes: `forwardTo` and `replyTo` in the request, or the options as defaults. `/inbound` passes `replyTo` on so the answering system can send it back with its answer. A destination from a request must be https, carry no credentials, and not be a local or private network address; `allowedDestinations` can limit them further. `onForward` is told about every forward — destination as origin and path, delivered, status.
- `sessionId`, `ref` and `caller` are refused when they are themselves personal data, since they are written to every audit event. Unknown fields are refused rather than ignored. Error answers name the field, never the value.
- Tokenise is optional. A policy that tokenises needs a shared `tokenStore` and a `resolveSecret` different from `secret`, or `createWebhook` throws. Without one, `/resolve` and `/end-session` answer 404. `/resolve` takes `token` however the model copied it, as core's `resolve` does.
- `createUpstashTokenStore` keeps tokens in Upstash Redis over its REST API with `fetch`, with a 2-second timeout. Errors carry no value, URL or REST token.
- `onAudit` is required. A Promise it returns is waited for before the handler answers.
- A guard that cannot run is a 500 and nothing is forwarded. A forward that fails is a 502.
- Web standards only. Node 20 or later.
