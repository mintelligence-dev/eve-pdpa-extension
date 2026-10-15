# COVERAGE — what the package promises, and which check exercises it

Written first, from what npm gives a user and nothing else; statuses filled in from the last run
(`bench/user/run features/all.mjs` → `out/features-all.json`, the two `bench.mjs` runs, and the CLI
cases run by hand — see "CLI" below for why). A line is covered only when a check exercises it.

Sources:
R = core `README.md` · RT = core `README.th.md` (read in full; same content as R) · C = core `CHANGELOG.md` ·
P = core `package.json` · T = the type declarations (`index.d.ts` / `index.d.cts` / `data/index.d.ts`) ·
PS = `schema/policy.schema.json` · AS = `schema/audit-event.schema.json` ·
CR = cli `README.md` / `README.th.md` · CC = cli `CHANGELOG.md` · H = `cli --help`

Where a check lives: `features/<file>.check.mjs › <ID>` (node:test; every test name starts with its ID) ·
`bench.mjs` (detection benchmark) · `cli-checks/cases.json › <id>` (CLI).

Status: **PASS** · **FAIL** (explained in the findings — delivered in the hand-back report, because the
tooling refused to let this run write a FINDINGS.md file) · **RUN** (a measurement, no pass/fail) ·
**NOT COVERED** (reason given)

## Totals

| | Capabilities listed | Exercised by a check | Pass | Fail | Run (measured) | Not covered |
|---|---|---|---|---|---|---|
| core (feature checks + benchmark) | 214 | 210 | 190 | 17 | 3 | 4 |
| CLI | 60 | 59 | 52 | 7 | — | 1 |
| **all** | **274** | **269** | **242** | **24** | **3** | **5** |

Feature checks: 205 tests, 189 pass / 16 fail (`out/features-all.json`). Benchmark lines BM1–BM5: BM4 pass,
BM3 fail, BM1/BM2/BM5 measured. CLI: 59 cases run by `bench/user/cli-check` (`out/cli-report.md`): 52 pass /
7 fail — 5 are findings, 2 (`CL-validate-bad`, `CL-validate-json`) are my case errors (they expect stdout;
`policy validate` reports "invalid" on stderr). One capability cannot be observed.

## 1. Detection — six entities and the documented limits — `features/detection.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| DT1 | TH_NATIONAL_ID with a valid mod-11 check digit is found — plain, dashed, spaced as on the card, Thai digits | R, C, PS | PASS |
| DT1b | … also when typed in other groupings (3-3-3-4, 4-4-5, 5-5-3, 4-4-4-1) — spaces and dashes | C (no grouping excluded) | FAIL — spaced groupings other than the card's are missed |
| DT2 | A wrong check digit is not found | C, T | PASS |
| DT3 | PHONE mobile, national form | C | PASS |
| DT4 | PHONE in +66 form | C, PS | PASS |
| DT5 | Landline, incl. brackets round the area code and provincial codes | C | PASS |
| DT6 | Any dash (en, em, minus, non-breaking, hyphen, full-width) or dots | C | PASS |
| DT7 | No leading 0 / 66 without + only beside a cue word | R, C | PASS |
| DT8 | A landline written with dots needs a cue | R | PASS |
| DT9 | Short public numbers (191, 1669, 1112, 199, 1155) are not found | R | PASS |
| DT10 | A phone inside a tracking number or after a letter is found | R | PASS |
| DT11 | EMAIL — plain, capitals, plus-addressing, sub-domain, Thai text glued to it | R, C | PASS |
| DT12 | BANK_ACCOUNT with "เลขบัญชี"/"โอนเข้า" found; a bare run is not | R, C, PS | PASS |
| DT13 | CREDIT_CARD with Visa / Mastercard (5x, 2x) / Amex / JCB prefix | C, PS | PASS |
| DT14 | A Luhn-invalid number is not found | C, T | PASS |
| DT15 | An unknown-issuer card gets confidence 0.6 | R | PASS |
| DT16 | LINE_USER_ID found; group `C…` and room `R…` ids are not | C, PS | PASS |
| DT17 | Names and addresses are not detected; entitiesSupported is exactly the six | R, T | PASS |

## 2. Detection accuracy — `bench.mjs` → `out/report-open.md`, `out/report-holdout.md`

| ID | Promise | Source | Status |
|---|---|---|---|
| BM1 | Precision / recall per entity, strict, without `context` — open and holdout | R (Accuracy) | RUN — open 96.2% P / 93.5% R overall; holdout see report |
| BM2 | The same with `context` | R (Accuracy) | RUN — open 96.3% P / 95.8% R overall |
| BM3 | Decoys are not flagged; spans are not wider than the value | R | FAIL — decoys flagged: open 6 (7 with context), holdout 1; overreach: open 1, holdout 2 |
| BM4 | No raw value in any audit event during the benchmark | R, C, AS | PASS — 0 problems in all four runs |
| BM5 | Compared with the README table (an upper bound by its own words) | R | RUN — below the README for ID, phone, bank, card precision on the open set |

## 3. Normalisation — `features/normalise.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| NM1 | Thai digits are detected and kept in the returned text | R, C | PASS |
| NM2 | Full-width digits are detected | C, T | PASS |
| NM3 | The space family between digit groups; mask keeps the original space characters | C, T | PASS |
| NM4 | Invisible characters inside a value (ZWSP, ZWNJ, ZWJ, BOM, WJ, LRM, RLM, soft hyphen) | C, T | PASS |
| NM5 | Offsets index the original text in UTF-16 after emoji and removed characters | AS | PASS |
| NM6 | Characters that are not personal data are untouched (emoji, CR/LF, tabs, Thai) | R | PASS |
| NM7 | `normalise()` folds digits and spaces, keeps `original`, `shifts` null when 1:1 | T | PASS |
| NM8 | `normalise()` records shifts; separators are not stripped | T | PASS |
| NM9 | `toOriginalStart/End/Span` — the documented ZWSP example | T | PASS |

## 4. `context` — `features/context.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| CX1 | `123-4-56789-0` with no cue stays as is | R | PASS |
| CX2 | With `context: 'รบกวนขอเลขบัญชีด้วยค่ะ'` → `xxx-x-xx789-0` | R | PASS |
| CX3 | A phone without leading 0 is found when the context asks for a phone | R, CR | PASS |
| CX4 | Context is not scanned (values in it are not reported or acted on) | R, C, T | PASS |
| CX5 | Context is not written to audit; `contextUsed: true` | R, T, AS | PASS |
| CX6 | `contextUsed` absent without context | T, AS | PASS |
| CX7 | Context does not change the type of a value written in full in the message | T | PASS |

## 5. The six actions — `features/actions.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| AC1 | `redact` → `เบอร์ [เบอร์โทร] ค่ะ` | R | PASS |
| AC2 | `mask` → `เบอร์ xxx-xxx-xxxx ค่ะ` | R | PASS |
| AC3 | `mask` + last4 → `เบอร์ xxx-xxx-7777 ค่ะ` | R | PASS |
| AC4 | `tokenise` → `เบอร์ [tok:<16>] ค่ะ` | R | PASS |
| AC5 | `hash` → `เบอร์ [PHONE:<16>] ค่ะ` | R | PASS |
| AC6 | `flag` → as typed, finding recorded | R | PASS |
| AC7 | `block` → `''`, blocked, `['PHONE']` | R | PASS |
| AC8 | `mask` hides everything except separators — ID, phone, account, card | PS | PASS |
| AC8b | … for EMAIL and LINE_USER_ID (what are an email's separators?) | PS | FAIL — `@` and `.` are hidden too (docs unclear) |
| AC9 | `mask` + last4 leaves the last four characters — every entity | PS | PASS |
| AC10 | Each finding's `action` is the rule's action | T, AS | PASS |

## 6. Placeholders — `features/placeholders.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| PH1 | `th` → `[เบอร์โทร]` | R | PASS |
| PH2 | `en` → `[phone]` | R | PASS |
| PH3 | Default `th` | PS | PASS |
| PH4 | Every entity has th/en placeholders carrying nothing of the value (5 of 6 undocumented) | R | PASS |
| PH5 | Hash output always uses the English entity name | PS | PASS |

## 7. Policy — `features/policy.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| PO1 | README example loads; hash `fnv1a64:ee142dc8b1111706` | R, CR | PASS |
| PO2 | `definePolicy` with the same rules → same hash | R, AS | PASS |
| PO3 | `$schema` ignored and not hashed | PS, T | PASS |
| PO4 | Misspelled field anywhere → `ERR_PDPA_INVALID_POLICY` naming it | R, C | PASS |
| PO5 | `entitySet` required, non-empty | R, PS | PASS |
| PO6 | `entities` required; unknown entity refused | PS | PASS |
| PO7 | `action` required, one of six | PS | PASS |
| PO8 | `minConfidence` 0..1, inside a rule only | PS | PASS |
| PO9 | `keep` only `last4`, only with mask | PS | PASS |
| PO10 | `ttlSec` integer 1..3600, tokenise only | R, PS | PASS |
| PO11 | `allowedPurposes` required for tokenise, non-empty strings, tokenise only | PS | PASS |
| PO11b | Error text as the CLI README shows it | CR | PASS |
| PO12 | `display` mask/redact, tokenise only | PS | PASS |
| PO13 | `onUnmapped`, `placeholderLanguage` enums | PS | PASS |
| PO14 | allowlist arrays of strings; patterns must compile | PS | PASS |
| PO15 | `parsePolicy` on non-JSON → `ERR_PDPA_INVALID_POLICY` | R | PASS |
| PO16 | Compiled defaults | T, PS | PASS |
| PO17 | Shipped schema and `parsePolicy` agree on 36 policy variants | PS | PASS |
| PO18 | `actionFor` | T | PASS |
| PO19 | `createGuard` refuses a plain object | T | PASS |
| PO19b | `createGuard` refuses a compiled policy changed by object spread ("accepts nothing else") | T | FAIL |
| PO20 | Same rules (any key order) → same hash; changes → new hash | AS | PASS |

## 8. `minConfidence` — `features/min-confidence.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| MC1 | Default 0.95: an unknown-issuer card is left alone and not reported | R, PS | PASS |
| MC2 | 0.6 acts on it | R | PASS |
| MC3 | Per entity | C | PASS |
| MC4 | 1 leaves 0.99 alone; 0 acts on all | PS | PASS |
| MC5 | README policy blocks `9000123456789016` | CR | PASS |

## 9. `onUnmapped` — `features/unmapped.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| UN1 | Default redact, `unmapped: true` | R, C, T | PASS |
| UN2 | `flag` | R, PS | PASS |
| UN3 | `ignore`, silently | PS | PASS |
| UN4 | `entities: {}` protects all six | R, C | PASS |

## 10. `allowlist` — `features/allowlist.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| AL1 | README's three spellings of `02-123-4567` | R, PS | PASS |
| AL2 | +66, spaces, brackets, full-width, en dash, dots | C | PASS |
| AL2b | An entry written with brackets matches the plain number | C | PASS |
| AL3 | Email whatever the capitals | PS | PASS |
| AL4 | Left as is, `allowlisted: true`, rule action, no token | PS, T | PASS |
| AL5 | Pattern must match the whole value | R, PS | PASS |
| AL6 | Pattern tested after formatting is removed | PS | PASS |
| AL7 | Applies to every entity | PS | PASS |
| AL8 | A real value next to an allowlisted one is still protected | C | PASS |
| AL9 | `policy.loaded`: sha256 of the canonical form — phone, email, LINE id; never the value | R, AS, T | PASS |
| AL9b | … the documented rule also reproduces national id, account, card, upper-case LINE id digests | AS, T | FAIL |
| AL10 | Pattern digests as written | AS, T | PASS |

## 11. Tokens — `features/tokens.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| TK1 | Quick start round trip → `'0918887777'` | R | PASS |
| TK2 | "A fresh random token each time" | R | FAIL — same value + same session → same token (docs conflict, see FINDINGS) |
| TK3 | Token format | AS | PASS |
| TK4 | `sessionId` required on every call under tokenise | R, C, T | PASS |
| TK5 | `purpose_not_allowed` | R, C | PASS |
| TK6 | `session_mismatch` | C, T | PASS |
| TK7 | `expired` after ttlSec | R, PS | PASS |
| TK8 | `not_found` | T, AS | PASS |
| TK9 | `endSession` deletes the chat's tokens at once (others keep theirs) | R, T | PASS |
| TK10 | `resolveSync` | C, T | PASS |
| TK11 | `token.resolve` per attempt; the passed string is never echoed | R, T, AS | PASS |
| TK12 | Default ttlSec 300 in the finding; 3600 accepted | PS | PASS |
| TK13 | Any purpose may be asked; every ask on record | R | PASS |
| TK14 | Resolve values for other formats; a second guard's store (observed) | R | PASS (observations in the run log) |
| TK15 | The given `randomSource` is the one used | R, T | PASS |

## 12. Outbound rendering — `features/outbound.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| OB1 | Own token → masked as typed (`xxx-xxx-๗๗๗๗`) | R, C, PS | PASS |
| OB2 | `display: 'redact'` → placeholder | T, PS | PASS |
| OB3 | Another session's token → `[ข้อมูลที่ปิดไว้]`, foreign | R, T, AS | PASS |
| OB4 | Invented token → `[ข้อมูลที่ปิดไว้]`, unknown | R, T | PASS |
| OB5 | Expired token → `[ข้อมูลที่ปิดไว้]`, unknown | R, T | FAIL — shown masked |
| OB6 | Token after endSession → unknown | R, T | PASS |
| OB7 | Text that only resembles a token is sent as written | R | FAIL — `[ tok:… ]` is rewritten |
| OB8 | A hash in a reply → placeholder, `kind: 'hash'` | T, AS | PASS |
| OB9 | `rendered` only outbound, only when rewritten, reading order | T, AS | PASS |
| OB10 | Neither value nor masked form in audit | T | PASS |
| OB11 | A raw value in a reply is protected; no token reaches the customer | R | PASS |
| OB12 | Tokens at prompt / tool_input / tool_output left as they are | R | PASS |
| OB13 | Placeholder for a hidden token under `en` (observed: `[redacted]`) | R | PASS |

## 13. `hash` — `features/hash.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| HS1 | No key → `ERR_PDPA_HMAC_KEY` | R | PASS |
| HS2 | < 32 bytes refused; 32 OK (string and Uint8Array) | R, T | PASS |
| HS3 | String key counts as UTF-8 bytes | T | PASS |
| HS4 | No key needed without hash | T | PASS |
| HS5 | Same value → same result, across guards with one key | R | PASS |
| HS6 | One person written differently → one hash (phone, email, ID, card) | R | PASS |
| HS7 | Key change → hashes differ | R | PASS |
| HS8 | Distinct values → distinct hashes; format | R | PASS |

## 14. `block` — `features/block.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| BL1 | `''`, blocked, blockedBy | R, C | PASS |
| BL2 | blockedBy reading order, each once | T | PASS |
| BL3 | blockedBy absent unless blocked | T | PASS |
| BL4 | Findings listed; audit `outcome: 'blocked'` | R, AS | PASS |
| BL5 | One blocked value stops the whole message | PS | PASS |

## 15. Overlap settling — `features/overlap.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| OV0 | (setup) the texts really give overlapping matches | — | PASS |
| OV1 | A match under its threshold never hides another | C | PASS |
| OV1b | … also after the account cue ("เลขบัญชี" + a mobile number) | C | FAIL |
| OV2 | Acted-on matches hidden together as one span | C | PASS |
| OV3 | A flagged match never leaves another in the clear | C | PASS |
| OV3b | … also after the account cue (PromptPay = phone) | C | FAIL |
| OV4 | A partly covered value is never partly protected | C | PASS |

## 16. Audit — `features/audit.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| AU1 | `policy.loaded` once, at createGuard, full rules | R, C, T | PASS |
| AU2 | One `scan` per call, also when nothing is found | R, C | PASS |
| AU3 | Every event and variant validates against the shipped schema | R, C, AS | PASS |
| AU4 | No raw value in any event: 587 messages × 7 rules + outbound + resolve, 4,994 events | R, C, AS | PASS |
| AU5 | `sessionId`/`ref` as passed; `'anonymous'` default | R, T, AS | PASS |
| AU6 | README scan example fields | R | PASS |
| AU7 | `engine` block | T, AS | PASS |
| AU8 | `input.chars` in UTF-16 units | AS | PASS |
| AU9 | `at` format, `prevHash` null, `durationMs` ≥ 0 | AS | PASS |
| AU9b | eventIds distinct ("unique enough to tell two events apart") | AS | FAIL — 180 events, 7 ids, under policies without tokenise |
| AU10 | One-line JSON (NDJSON) | R | PASS |
| AU11 | A call that throws is still on record (`outcome: "error"`) | R, T, AS | FAIL — no event at all |
| AU12 | A `ref` outside 1..256 → PdpaError, or a valid event | AS, R | FAIL — plain TypeError |

## 17. `stats` and `onError` — `features/stats-onerror.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| ST1 | Stats start at zero | T | PASS |
| ST2 | onAudit throws → processed, counted, onError(audit_sink, eventType) | R, C, T | PASS |
| ST3 | Rejected Promise counted when it rejects | C, T | PASS |
| ST4 | onError throwing is ignored | T | PASS |
| ST5 | No onAudit → one warning, once (`console.warn`) | R, T | PASS |
| ST6 | `onAudit: () => {}` → no warning | R, T | PASS |
| ST7 | onAudit throwing on `policy.loaded` does not stop createGuard | R | PASS |

## 18. Token stores — `features/token-store.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| TS1 | Custom async store: process, resolve, endSession → clearSession | R, T | PASS |
| TS2 | Async store + tokenise: processSync/resolveSync → `ERR_PDPA_ASYNC_STORE` | R, T | PASS |
| TS3 | Async store without tokenise: processSync works | R | PASS |
| TS4 | TokenRecord shape, `expiresAt` in ms, masked `display` | R, T | PASS |
| TS5 | `set` fails → blocked, `failed: 'token_store'`, onError, stats | R, C, T | PASS |
| TS6 | `get` fails → `store_unavailable`, audited | R | PASS |
| TS7 | `get` fails at outbound → placeholder, `unavailable` | R | PASS |
| TS8 | A rejecting store behaves like a throwing one | C, T | PASS |
| TS9 | `maxTokens`: refuses when full, never evicts | T | PASS |
| TS10 | Default store full at 10,000 | R, T | PASS |
| TS11 | Expired tokens swept on write | T | PASS |
| TS12 | Memory store `sync: true` | T | PASS |
| TS13 | `clearSession` failing in `endSession` (undocumented — recorded) | — | PASS (behaviour described in the findings) |
| TS14 | README Redis store, verbatim, against a node-redis stand-in | R | PASS |

## 19. Errors — `features/errors.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| ER1 | `PdpaError` extends Error, carries `code` | R, T | PASS |
| ER2 | README codes reachable | R, T | PASS |
| ER2b | `ERR_PDPA_TOKEN_STORE_FULL` (types only) reaches onError | T | PASS |
| ER3 | Error messages never contain values (9 error paths, incl. broken policy JSON and keys) | R | PASS |
| ER4 | No crypto, no randomSource → `ERR_PDPA_NO_CSPRNG` (at createGuard) | R | PASS |
| ER5 | A short randomSource is refused | T | PASS |
| ER6 | The Node 18 recipe works without `globalThis.crypto` | R | PASS |

## 20. Boundaries — `features/boundaries.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| BD1 | Default inbound | R | PASS |
| BD2 | All five accepted and recorded | R, T | PASS |
| BD3 | An unknown boundary is refused or never written to audit | T, AS | FAIL — `'Outbound'` accepted and written |
| BD4 | Same detection at every boundary | R | PASS |

## 21. Detectors and engine — `features/detectors-engine.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| DE1 | Six built-ins covering ENTITY_TYPES | T | PASS |
| DE2 | Each exported detector's API | T | PASS |
| DE3 | `detectors: []` | T | PASS |
| DE4 | `detectors: [phoneDetector]` | T | PASS |
| DE5 | Async detector skipped by processSync, run by process | T, AS | PASS |
| DE6 | A throwing detector → degradedDetectors; its error text not in audit | T, AS | PASS |
| DE7 | `createEngine` | T | PASS |
| DE8 | `DetectContext.previous` lower-cased | T | PASS |
| DE9 | `isValidLuhn`, `isValidThaiNationalId`, digit-3 property | T | PASS |

## 22. Exports and packaging — `features/exports.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| EX1 | Every runtime export in the types exists; nothing extra | T | PASS |
| EX2 | ENTITY_TYPES / ACTIONS / BOUNDARIES | T | PASS |
| EX3a | VERSION = manifest = `engine.version` | T, P | PASS |
| EX3b | … = the CHANGELOG release 0.1.0 | C | FAIL — 0.0.0 |
| EX4 | CommonJS entry works | C, P | NOT COVERED — loading it needs `createRequire` / the manifest, which the bench's code rules refuse |
| EX5 | `./data` subpath | T, P | PASS (DICTIONARIES is empty) |
| EX6 | Schema files via package subpaths | R, P | PASS |
| EX7 | `allowlistDigestForm` (named in the types) available | T | FAIL — not exported |
| EX8 | No dependencies; Node ≥ 18.18 | R, C, P | NOT COVERED by a check — read by hand in package.json (`dependencies: {}`, `>=18.18.0`); code may not import the manifest |

## 23. Platform and performance — `features/platform.check.mjs`

| ID | Promise | Source | Status |
|---|---|---|---|
| PL1 | 40,000 phone numbers ≈ 60 ms | C | PASS (55–58 ms) |
| PL2 | Linear in values found | C | PASS (×4.4 for ×4) |
| PL3 | Long digit runs stay linear (not a documented claim) | — | FAIL — quadratic (×14.5–16.5 for ×4; 200,000 digits ≈ 19 s) |
| PL4 | ~26 KB minified | R, C | NOT COVERED — reading the build is not allowed |
| PL5 | Node 18.18, Deno, Bun, Workers, browsers | R, C | NOT COVERED — Node 22 only (Node 18's missing crypto simulated in ER4/ER6) |

## 24. CLI — `cli-checks/cases.json`

The cases are in `cli-checks/cases.json` (fixtures in `cli-checks/fixtures/`; byte-exact ones are generated by
`cli-checks/make-fixtures.mjs` into `out/cli-fixtures/`). During the first session `cli-check` could not
run (it read `cli/cases.json`, and `cli` is the wrapper file), so each case's `note` holds a manual verdict;
`cli-check` now reads `cli-checks/cases.json`, and the statuses below are from `out/cli-report.md`.

| Case | Promise | Source | Status |
|---|---|---|---|
| CL-help, CL-help-short | `--help`/`-h`, exit 0 | H | PASS, PASS |
| CL-version | `--version` prints the release (0.1.0) | C, H | FAIL (0.0.0) |
| CL-version-short | `-v`, exit 0 | H | PASS |
| CL-noargs, CL-unknown-cmd, CL-unknown-flag | bad arguments → 2 | CR, H | PASS ×3 |
| CL-readme | README report, line for line | CR | PASS |
| CL-readme-policy | README `--policy` report | CR, CC | PASS |
| CL-readme-json, CL-readme-policy-json | `--json`, with and without policy | CR, CC | PASS ×2 |
| CL-first20, CL-first20-json | first 20 in the human report, all in JSON | CR | PASS ×2 |
| CL-jsonl, CL-ndjson, CL-tsv, CL-csv-noid | formats by extension | CR | PASS ×4 |
| CL-fields-missing, CL-fields, CL-textfield-absent | `--text-field`, `--id-field` | CR, H | PASS ×3 |
| CL-format-unknown, CL-format-txt, CL-format-bad | `--format` | CR, H | PASS ×3 |
| CL-874-stop, CL-874-read, CL-encoding-bad, CL-binary-jsonl | encodings | CR, CC | PASS ×4 |
| CL-bom, CL-crlf, CL-multiline | Excel BOM, CRLF, quoted multi-line fields | CR, CC | PASS ×3 |
| CL-exit0, CL-exit3, CL-missing, CL-scan-nofile | exit codes 0 / 3 / 2 | CR, H | PASS ×4 |
| CL-policy-missing, CL-policy-invalid, CL-policy-broken | `--policy` errors → 2 | CR | PASS ×3 |
| CL-lineoa | LINE OA: recognised, customer/shop, no names | CR, CC | PASS |
| CL-lineoa-thai-name | the same with a Thai customer name in the file name | CR | PASS (run by cli-check) |
| CL-lineoa-context | replies read against the question | CR, CC | PASS |
| CL-lineoa-readme-9digits | the README's own `918887777` after an account question | CR | FAIL — reported as nothing |
| CL-lineoa-otherlang-noflags, CL-lineoa-otherlang | other-language export with flags | CR | PASS ×2 |
| CL-lineoa-nocol | changed headers → stops, names the column | CR | PASS |
| CL-lineoa-senders | unknown sender types (observed) | CR | PASS |
| CL-validate-ok, CL-validate-allowlist | `policy validate` | CR, CC | PASS ×2 |
| CL-validate-bad, CL-validate-json | `policy validate` names the bad field / refuses broken JSON, exit 1 | CR, CC | FAIL ×2 — case error: the text is right but on stderr, the cases expect stdout |
| CL-validate-missing, CL-validate-nofile, CL-policy-nosub | validate exit 2 | CR, H | PASS ×3 |
| CL-leak-badline, CL-leak-badrow | broken lines reported without content | CR, CC | PASS ×2 |
| CL-leak-id, CL-leak-id-json, CL-leak-userid | ids that are personal data | CR, CC, H | FAIL ×3 |
| CL-leak-noheader | CSV without a header row | CR, H | pass in cli-check (stdout only) — but its stderr shows the first row with a phone and an email; a finding |
| CL-zip | `.zip` not read | CR | PASS |
| CL-norewrite | Reports only, never rewrites | CR | NOT COVERED — the sandbox forbids writes anyway; intent cannot be observed |
