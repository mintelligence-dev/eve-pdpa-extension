# @eve-pdpa-extension/core

## 0.1.0

First release. Not yet published.

### Detection

- Six entity types: `TH_NATIONAL_ID` (mod-11 check digit) · `PHONE` (mobile and landline, national or +66; separated by spaces, any dash, dots or brackets round the area code; with no leading 0 or as 66 without the +, only beside a cue word) · `EMAIL` · `BANK_ACCOUNT` (only with a cue word nearby) · `CREDIT_CARD` (Luhn, issuer prefix) · `LINE_USER_ID`.
- Text is normalised before detection — Thai and full-width digits, the space family, invisible characters — while the text returned keeps the customer's original characters.
- `context`: the other side's last message, read for cue words only, so a reply that is just a number is still recognised. Never scanned, rewritten or logged.
- Overlapping matches are settled after the policy has judged each one: a match under its threshold never hides another, matches the policy acts on are hidden together as one span under one action — `block` first, then `tokenise` so the value stays usable, then `redact`, `hash`, `mask` — and one that is only flagged never leaves another in the clear. A partly covered value is never partly protected.
- Linear in the number of values found: a message with 40,000 phone numbers takes about 60 ms.

### Actions and policy

- Six actions: `redact` · `mask` (optionally `keep: "last4"`) · `tokenise` · `hash` (HMAC-SHA-256, key of at least 32 bytes) · `flag` · `block`. A blocked message returns no text at all, with `blockedBy` naming the entity types.
- Policies from code (`definePolicy`) or JSON (`parsePolicy`). Every field is checked at load and a misspelt field is an error. `policy.schema.json` ships for editor completion.
- `onUnmapped` decides what happens to entity types the policy does not name; the default is `redact`, so a type added in a later release is not let through silently.
- `allowlist` lets the shop's own contact details through, matching every way of writing a value.
- `minConfidence` per entity.

### Tokens

- `guard.resolve()` / `resolveSync()` exchange a token for its value only for a purpose the policy allows, within the token's session and lifetime (`ttlSec`, at most an hour).
- Replies passing through with `boundary: 'outbound'` have this session's tokens shown masked (`xxx-xxx-7777`); tokens from another session, or ones the guard does not hold, become a placeholder.
- A policy that tokenises requires `sessionId` on every call (`ERR_PDPA_NO_SESSION`), so one chat can never resolve another's token.
- `TokenStore` interface for a shared store (Redis, KV) across processes; an in-memory store is the default.
- A token store that fails never lets a value through and never fails quietly: the message is blocked, `resolve` returns `store_unavailable`, `onError` is called with `source: 'token_store'`, and `guard.stats.tokenStoreErrors` counts it.

### Audit

- One event per scan, per resolve attempt, and per guard created (`policy.loaded`), passed to `onAudit`. No event carries a real value.
- `audit-event.schema.json` ships with the package and describes every event exactly; the tests hold the guard to it.
- `ref` links an event back to a message or tool call in the app's own records.
- An `onAudit` that throws or rejects does not fail the message; it is counted in `guard.stats.auditSinkErrors` and passed to `onError`.

### Platform

- Zero dependencies, about 26 KB minified, ESM and CommonJS with types.
- Node 18.18+ (Node 18 needs `randomSource` for `tokenise`), Deno, Bun, Cloudflare Workers and browsers. Run the guard on a server: keys and tokens in a browser are readable by anyone.

### Not in this release

Names and addresses are not detected (planned for 0.2). See the README's known limitations.
