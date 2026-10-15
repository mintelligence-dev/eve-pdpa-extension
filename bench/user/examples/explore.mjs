// First look at what each action does to each entity, written while learning the API.
//
//   bench/user/run examples/explore.mjs
import { createGuard, definePolicy, ENTITY_TYPES } from '@eve-pdpa-extension/core'

const KEY = 'explore-key-0123456789abcdef0123456789'
const samples = {
  TH_NATIONAL_ID: 'เลขบัตร 1-1037-02071-81-1 ค่ะ',
  PHONE: 'เบอร์ 091-888-7777 ค่ะ',
  EMAIL: 'เมล somchai.k@gmail.com ค่ะ',
  BANK_ACCOUNT: 'เลขบัญชี 123-4-56789-0 ค่ะ',
  CREDIT_CARD: 'บัตร 4111 1111 1111 1111 ค่ะ',
  LINE_USER_ID: 'userId U4af4980629f1ae0b2b5c2f7a7b2e9c3d ค่ะ',
}

function run(rules, extra = {}) {
  const guard = createGuard({
    policy: definePolicy({ entitySet: '0.1', entities: rules, ...extra }),
    hmacKey: KEY,
    onAudit: () => {},
  })
  return guard
}

for (const lang of ['th', 'en']) {
  for (const action of ['redact', 'mask', 'hash']) {
    const rules = Object.fromEntries(ENTITY_TYPES.map((e) => [e, { action }]))
    const g = run(rules, { placeholderLanguage: lang })
    for (const [e, t] of Object.entries(samples)) {
      const r = g.processSync(t)
      console.log(
        lang,
        action.padEnd(6),
        e.padEnd(15),
        JSON.stringify(r.text),
        r.findings.map((f) => `${f.entity}:${f.start}-${f.end}@${f.confidence}`).join(','),
      )
    }
  }
}
{
  const rules = Object.fromEntries(ENTITY_TYPES.map((e) => [e, { action: 'mask', keep: 'last4' }]))
  const g = run(rules)
  for (const [e, t] of Object.entries(samples)) {
    const r = g.processSync(t)
    console.log('mask+last4', e.padEnd(15), JSON.stringify(r.text))
  }
}

// below threshold
{
  const rules = Object.fromEntries(ENTITY_TYPES.map((e) => [e, { action: 'redact' }]))
  const g = run(rules)
  const r = g.processSync('เลขอ้างอิง 9000123456789016 ค่ะ')
  console.log('below threshold:', JSON.stringify(r))
}
// unmapped
for (const onUnmapped of ['redact', 'flag', 'ignore']) {
  const g = run({ PHONE: { action: 'redact' } }, { onUnmapped })
  const r = g.processSync('เบอร์ 091-888-7777 เมล somchai.k@gmail.com')
  console.log('onUnmapped', onUnmapped, JSON.stringify(r))
}
