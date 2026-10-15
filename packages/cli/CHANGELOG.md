# @thai-pdpa-guard/cli

## 0.1.0

First release. Not yet published.

- `thai-pdpa-guard scan <file>` reports what personal data a file holds — counts per entity type, line numbers and message ids. The report never contains a value, a masked value, or the text around one — and an id that is itself personal data, such as a phone number or a LINE userId, is left out and shown as `(id hidden: PHONE)`.
- Reads JSONL, CSV and TSV. CSV columns are found by header name; quoted fields may span lines; a row with the wrong number of fields is reported and skipped.
- Reads LINE Official Account chat exports one CSV at a time, recognised by their first lines. Messages are counted by customer and shop, and customer names — in the file name and the sender column — are left out of the report. Each message is read with the other side's last message as `context`, so a reply that is only a number counts as what the question asked for.
- `--policy` shows what a policy would do with each value, how many messages it would block, and what its allowlist lets through.
- Reports values a detector found but the policy's `minConfidence` dropped.
- `--encoding` for files that are not UTF-8, such as CSV saved by Thai Excel (windows-874). A file in the wrong encoding stops the scan instead of being read with its Thai words lost.
- `--json` for a machine-readable report.
- `thai-pdpa-guard policy validate <file>` checks a policy the way an app loads it and says what it does with each entity type. Allowlist entries are counted, never shown.
- Exit codes for scripts and CI: `0` nothing found · `1` found · `2` could not run · `3` nothing found but some lines could not be read.
- Node.js 18.18 or later.
