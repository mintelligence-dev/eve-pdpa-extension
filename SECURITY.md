# Security Policy

`eve-pdpa-extension` handles Thai personal data. A vulnerability here can expose
real people's national ID numbers, phone numbers and addresses.

## Reporting a vulnerability

**Do not open a public issue.**

Email **kunlachat@m-intelligence.tech** with the subject line starting
`[eve-pdpa-extension security]`. Include the version, the runtime, and the
smallest input that reproduces the problem.

We aim to acknowledge within 3 working days and to ship a fix or a mitigation
within 30 days for anything rated high or critical.

## Never include real personal data in a report

Reproduce with synthetic values. The repository ships a generator for
checksum-valid synthetic Thai national IDs at
`packages/core/test/helpers/make-thai-id.ts`. A report containing real data will
be deleted and you will be asked to resubmit.

## Scope

In scope:

- a real value appearing in library output, logs, errors or audit events
- a token that can be guessed, or resolved without an allowed purpose
- a policy that validates but is applied differently than written
- detection that silently degrades without being recorded in the audit event

Out of scope:

- missed detections within the published precision and recall targets — this is
  a technical control, not a guarantee, and the accuracy table states the
  expected miss rate
- entity types a release does not yet cover; each audit event lists
  `engine.entitiesSupported`

## Supported versions

Pre-1.0. Only the latest published minor receives fixes.
