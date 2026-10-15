// What happens when a developer tweaks a loaded policy with object spread?
//   bench/user/run examples/probe-spread-policy.mjs
import { createGuard, definePolicy } from '@eve-pdpa-extension/core'

const loaded = definePolicy({ entitySet: '0.1', entities: { PHONE: { action: 'redact' } } })
const events = []
const tweaked = {
  ...loaded,
  placeholderLanguage: 'en',
  entities: { PHONE: { action: 'flag' } },
  allowlist: { exact: [], pattern: ['.*'] },
}
try {
  const g = createGuard({ policy: tweaked, onAudit: (e) => events.push(e) })
  console.log('createGuard accepted the spread copy')
  console.log('process:', JSON.stringify(g.processSync('เบอร์ 0918887777')))
  console.log('policy.loaded:', JSON.stringify(events[0].policy))
  console.log('hash same as the original:', events[0].policy.hash === loaded.hash)
} catch (e) {
  console.log('refused:', e.code, e.message)
}
const invalid = { ...loaded, entities: { PHONE: { action: 'nonsense' } } }
try {
  const g = createGuard({ policy: invalid, onAudit: () => {} })
  console.log(
    'invalid action accepted; process →',
    JSON.stringify(g.processSync('เบอร์ 0918887777')),
  )
} catch (e) {
  console.log('invalid action:', e.code ?? e.name, e.message)
}
