# FINDINGS — first run, 13 Oct

The integrator was cut off before it could write this file (its write was refused, and its
hand-back never arrived). This page was compiled by the main session from the integrator's own
failing checks (`features/*.check.mjs`), `out/report-*.md`, `out/cli-report.md` and
`COVERAGE.md`. Items marked **verified** were reproduced again outside the sandbox. Behaviour
only; causes are left to whoever fixes them.

## 🔴 Personal data reaches the output

1. **A phone number stays in the clear when the policy treats bank accounts differently**
   (OV1b, OV3b) — verified. PHONE `redact`, BANK_ACCOUNT `flag` or not mapped:
   `เลขบัญชี 091-888-7777 (พร้อมเพย์)` comes back unchanged. PromptPay accounts are phone numbers.
   **Fixed 13 Oct (D19):** the action that comes first (`block`, `tokenise`, `redact`…) now speaks for the span.
2. **The CLI prints record ids that are themselves personal data** (CL-leak-id, CL-leak-id-json,
   CL-leak-userid). A JSONL whose `id` is `0891234567`, or a LINE webhook log keyed by `userId`,
   prints those values — `--help` says the report "never contains the personal data itself".
   **Fixed 13 Oct (D19):** such an id shows as `(id hidden: PHONE)`.
3. **A national id spaced in any grouping but the card's is missed** (DT1b) — verified.
   `110 170 020 3450`, `1101 7002 03450`, `822 263 034 9016` are not found. In 5-5-3
   (`20833 23638 294`) only `23638 294` is hidden, as a PHONE, and `20833` stays.
   **Fixed 13 Oct (D19):** any spacing is read when a cue word (`เลขบัตร`, `ปชช`…) is near; without one it is still missed.
4. **Realistic misses from the dataset** (`out/report-open.md`):
   - the third number of a pasted list: `เบอร์⏎803685274⏎997127246⏎811642252`
   - English shorthand: `refund to my acc 4535567048 bangkok bank`, `a/c 453-5-56704-8`
   - tool fields: `topup(msisdn=66616699461, …)`
   - a correction with no cue: `เอ้ย ผิด 425-6-46627-3 อันนี้ถูกค่ะ`
   - a Thai IDN address: `สมชาย@ไทยแลนด์.ไทย` (documented as out of scope)

## 🟡 Wrong or undocumented behaviour

5. **Email detection is quadratic on long digit runs** (PL3) — verified: 50,000 digits take
   ~1.2 s in the email detector alone (every other detector < 40 ms); 200,000 take ~19 s.
6. **Audit `eventId`s collide when the policy does not tokenise** (AU9b) — verified: 100 calls,
   3 distinct ids.
7. **Decoys flagged**: LINE webhook `timestamp` values in milliseconds as TH_NATIONAL_ID
   (`1760259091075`, three times); a 16-digit bank transfer reference after `เลขอ้างอิง` as
   CREDIT_CARD; tracking numbers with a letter prefix (`TH0645123987`, `KERDO031257894`) as PHONE.
8. **Wrong type**: `โอนคืนเข้า 086-1-59417-2` (a passbook-format account) is hidden as PHONE.
9. **Audit and input checks**: a call that throws leaves no event, though the schema has
   `outcome: "error"` (AU11); boundary `'Outbound'` is accepted and written to the event (BD3);
   a `ref` outside 1–256 characters throws a plain `TypeError`, not a `PdpaError` (AU12);
   a compiled policy changed by object spread is accepted by `createGuard` (PO19b).
10. **Outbound rendering**: an expired token is shown masked instead of `[ข้อมูลที่ปิดไว้]`
    (OB5); `[ tok:… ]` with spaces inside is rewritten (OB7).

## 📝 Docs

11. README says "a fresh random token each time"; the same value in the same session gets the
    same token (TK2).
12. The allowlist digest rule in the schema does not mention that a missing leading 0 is put
    back, so national id, account and card entries do not reproduce (AL9b);
    `allowlistDigestForm` is named in the types but not exported (EX7).
13. `mask` on EMAIL and LINE_USER_ID hides `@` and `.` too; the docs say "everything except
    separators" without saying what an email's separators are (AC8b).
14. The CLI README's `918887777` example after an account question is reported as nothing
    (CL-lineoa-readme-9digits).
15. `--version` and the package say 0.0.0, the CHANGELOG 0.1.0 (EX3b, CL-version) — expected
    before the first publish.

## Not findings

- CL-validate-bad, CL-validate-json: the case expected stdout; the right text is on stderr.

## Not covered (see COVERAGE.md)

CommonJS entry, Node 18 / Deno / Bun / Workers / browsers, bundle size, and "the CLI never
rewrites" — the sandbox cannot observe them.
