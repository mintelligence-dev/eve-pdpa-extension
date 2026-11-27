# @eve-pdpa-extension/core

## Unreleased

### Fixed

- A long run of digits and separators no longer takes seconds. Checking whether a card or national id number sat in a link (new in 0.2.0) read the whole run again for every number in it, and the link pattern read it once per position: 100,000 characters of `1-2345-67890-12-` took about 5 s, of `4111111111111111/` about 14 s. Each run is now read once, and the pattern only starts where a host name can: the same texts take under 50 ms, and what counts as a link is unchanged.

## 0.2.0

### License

- Licensed under MIT instead of Apache-2.0, as the other M Intelligence open-source projects are. Versions already published stay under Apache-2.0. The package no longer ships a `NOTICE` file.

### Detection

- An `@` in a link's path is no longer read as an address: `https://line.me/R/ti/p/@shop.com` and `instagram.com/@handle.name` were spanned from `//` as emails. A slash now ends the local part, as a space does, which also finds an address written right before one (`somchai@example.com/…`), missed until now.
<!-- License plate -->
- New entity type `LICENSE_PLATE`: a series digit, one to three Thai consonants and up to four digits, with the province printed under it when one follows (76 of the 77, without เลย). Every run of that shape is kept as a candidate and scored from what stands round it — a cue word, the other side's question, a province after it, a series digit and four digits for it; a count word after a small number, an amount, a room or table in front, an everyday word as the letters, house and other registrations against it — and the score is the confidence, so `minConfidence` is the dial: at the default 0.95 a plate is hidden only with a cue, at 0.7 also by its province and digits. `canonical` form is the plate without separators, so `hash` and allowlist entries match however it was written.
<!-- Date of birth -->
- New entity type `DATE_OF_BIRTH`: a real date — `12/05/2530`, `12 พ.ค. 30`, `12 พฤษภาคม พ.ศ. 2530`, `12 เดือน 5 ปี 2530`, `May 12, 1987`, `4-Jul-1991`, `1987-05-12`, day before month unless only month-first can be a date, Buddhist or Gregorian era — scored the same way: a birth cue (`วันเกิด`, `เกิด` beside it, `DOB`) or the other side asking for one for it; a shipping, payment or expiry word in front, a time after it or a date range against it, and "เกิด" meaning "happened", a hometown, an animal's birth or a birthday party is no cue. Dates listed on one line after one cue ("พ่อ … แม่ … น้อง …") are read as birthdays too. At the default 0.95 a date is hidden only with a cue. A two-digit year, or a day and month with no year, is read only with the cue pressed against it; a year alone is not read. No clock is consulted, so the result does not change with the day it runs. `canonical` form is the ISO Gregorian date, so `hash` and allowlist entries match however it was written.
<!-- Passport -->
- New entity type `PASSPORT`: a Thai passport as two Latin letters and seven digits (`AA1234567`, with an optional space or dash), the format official documents show, and a foreign one (six to nine letters and digits) only with a cue pressed against it. With a cue (`พาสปอร์ต`, `หนังสือเดินทาง`, `passport`) or the other side asking for one it is hidden at the default 0.95; a Thai-shaped number with no cue scores 0.6, under the default threshold, so it is neither hidden nor listed, and with no cue beside a parcel, order, booking, invoice or staff-number word it does not score even that. Look-alike characters (O for 0) are never corrected. `canonical` form is upper case with no separators.
<!-- PromptPay -->
- `PROMPTPAY`: a phone number, a national or tax ID, or a 15-digit e-wallet ID beside พร้อมเพย์, PromptPay or e-wallet (a thirteen-digit ID there is hidden even when its check digit is wrong: a typo is still the person's ID), and a whole PromptPay QR payload, checked by its CRC-16, with no cue. Ranked after `PHONE` and `TH_NATIONAL_ID`: where it covers the same characters the older entity keeps the name, and a stricter action on `PROMPTPAY` still wins the span.
<!-- Address -->
- `ADDRESS`: a postal address, in Thai or romanised, read from its labels: house number, หมู่ / Moo, ซอย / Soi, ถนน / Road, ตำบล · แขวง / Subdistrict, อำเภอ · เขต / District, province and postcode. Three kinds of part, or two beside a cue such as ที่อยู่ or address, are hidden; two with no cue are reported at 0.8, under the default threshold. The cue word stays readable. The province list is `detectors/provinces.ts`.
<!-- Person name -->
- `PERSON_NAME`: a person's name, found when the sentence introduces it: a title or rank (นาย, นางสาว, ดร., พ.ต.ท., Mr, Dr), คุณ with a first name and surname or straight after a greeting, an introduction (ผมชื่อ, my name is), a label (ชื่อ-นามสกุล, name:), or the answer to a question that asked for a name. No list of names ships, so a name with none of these is not found: see Known limitations in the README.
- `ADDRESS`, `PERSON_NAME` and `PROMPTPAY` read runs of spaces and tabs as one space. A name does not go on across a line break; an address may.
- A policy written for 0.1 names none of `PROMPTPAY`, `ADDRESS` and `PERSON_NAME` either, so `onUnmapped` applies and they are redacted unless the policy says otherwise.
- A policy written for 0.1 names none of `LICENSE_PLATE`, `DATE_OF_BIRTH` and `PASSPORT`, so `onUnmapped` applies: all three are redacted unless the policy says otherwise.
- `audit-event.schema.json` and `policy.schema.json` list the new entities; `engine.entitiesSupported` names each one whose detector is in the build.
- A card or national id number inside a link (`https://…`, `www.…`, `host.com/…`) scores 0.2 and is not hidden: a Facebook post id passed Luhn and, under a policy that blocks cards, stopped the whole message. The value of a query key that names a card or an id (`?card=`, `?citizen_id=`, `?thai_id=` …) is still read as usual. A card whose prefix belongs to Mastercard, Amex, JCB, UnionPay, Discover or Diners but whose length that issuer does not use now scores 0.6, as Luhn alone (Visa lengths are not checked). A 13-digit number named as a post, a product, a barcode, an order or a parcel (`เลขโพสต์`, `รหัสสินค้า`, `order` …), with no id cue as near, scores 0.2. Scores with none of these are unchanged.

### Audit

- **Breaking:** audit events are now `schemaVersion: "2.0"`. `at` is renamed `timestamp` on every event type (same value: UTC ISO 8601 with milliseconds) — update queries and any stored copy of `audit-event.schema.json` before upgrading. `skippedDetectors` is dropped from the scan event: no built-in detector is async, so it was always empty; the result of `processSync` still lists them. It may come back in a later schema version once an async detector ships. `prevHash`, reserved for a hash chain and always `null`, is dropped from every event type; a chain, if one is built, will come with its own schema version.
- Every finding has `result`: `applied`, `allowlisted`, `failed` (the action could not be carried out and the message was blocked) or `widened` (hidden over a span that grew to cover an overlapping value; `tokenise` became `redact`). `action` still names what the policy asked for; `allowlisted` and `failed` are kept as before.
- A scan event has `belowThreshold` when a detector found something the threshold dropped: a count per type, only for types the policy acts on, e.g. `{ "PASSPORT": 2 }`. Use it to decide whether to lower `minConfidence`.
- A `blocked` scan names the types that stopped it in `blockedBy`, as the result already did; an `error` scan has `errorCode`, the `PdpaError` code or `unexpected`, never the error message.
- The entity list adds `LICENSE_PLATE`, `DATE_OF_BIRTH`, `PASSPORT`, `PROMPTPAY`, `ADDRESS` and `PERSON_NAME`.

## 0.1.0

First release.

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

- `guard.resolve()` / `resolveSync()` exchange a token for its value only for a purpose the policy allows, within the token's session and lifetime (`ttlSec`, at most an hour). The token is read however a model copied it into a tool call — brackets dropped or half dropped, spaces inside, wrapped in quotes — the same spellings an outbound reply is read in; it must still be one token on its own.
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

- Zero dependencies, about 38 KB minified (14 KB gzip), ESM and CommonJS with types.
- Node 18.18+ (Node 18 needs `randomSource` for `tokenise`), Deno, Bun, Cloudflare Workers and browsers. Run the guard on a server: keys and tokens in a browser are readable by anyone.

### Not in this release

Names and addresses are not detected (planned for 0.2). See the README's known limitations.
