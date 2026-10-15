// Black-box: which canonical form does policy.loaded hash for an exact allowlist entry?
// The schema documents the rule; this tries the obvious readings of it per entry.
//   bench/user/run examples/probe-digest.mjs
import { createHash } from 'node:crypto'
import { createGuard, definePolicy } from '@thai-pdpa-guard/core'

const sha = (s) => `sha256:${createHash('sha256').update(s, 'utf8').digest('hex')}`
const digestOf = (entry) => {
  const events = []
  createGuard({
    policy: definePolicy({ entitySet: '0.1', entities: {}, allowlist: { exact: [entry] } }),
    onAudit: (e) => events.push(e),
  })
  return events[0].policy.allowlist.exact[0]
}
const candidates = (e) => {
  const digits = e.replace(/[^0-9]/g, '')
  const set = {
    'as is': e,
    'lower-case': e.toLowerCase(),
    'no spaces/hyphens': e.replace(/[\s-]/g, ''),
    'digits only': digits,
    'NFKC lower': e.normalize('NFKC').toLowerCase(),
  }
  for (const prefix of [
    'TH_NATIONAL_ID',
    'PHONE',
    'LINE_USER_ID',
    'BANK_ACCOUNT',
    'CREDIT_CARD',
    'EMAIL',
  ]) {
    set[`${prefix}:digits`] = `${prefix}:${digits}`
    set[`${prefix}:as is`] = `${prefix}:${e}`
  }
  return set
}
for (const entry of [
  '02-123-4567',
  '1-1037-02071-81-1',
  '1103702071811',
  '123-4-56789-0',
  '4111 1111 1111 1111',
  'U4af4980629f1ae0b2b5c2f7a7b2e9c3d',
  'U4AF4980629F1AE0B2B5C2F7A7B2E9C3D',
]) {
  const got = digestOf(entry)
  const hit = Object.entries(candidates(entry))
    .filter(([, c]) => sha(c) === got)
    .map(([k]) => k)
  console.log(
    entry.padEnd(36),
    hit.length ? `matches: ${hit.join(', ')}` : 'matches none of the documented readings',
  )
}
