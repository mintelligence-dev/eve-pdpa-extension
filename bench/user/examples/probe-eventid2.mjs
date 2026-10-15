// eventId under policies that do not tokenise, and with custom detectors.
//   bench/user/run examples/probe-eventid2.mjs
import { BUILTIN_DETECTORS, createGuard, definePolicy } from '@thai-pdpa-guard/core'

const show = (label, policyInput, extra = {}) => {
  const events = []
  const g = createGuard({
    policy: definePolicy({ entitySet: '0.1', ...policyInput }),
    hmacKey: 'k'.repeat(40),
    onAudit: (e) => events.push(e),
    ...extra,
  })
  g.processSync('เบอร์ 0918887777', { sessionId: 's' })
  g.processSync('เบอร์ 0811111111', { sessionId: 's' })
  console.log(label.padEnd(44), events.map((e) => `${e.type}:${e.eventId}`).join('  '))
}
show('redact only', { entities: { PHONE: { action: 'redact' } } })
show('hash only', { entities: { PHONE: { action: 'hash' } } })
show('tokenise', { entities: { PHONE: { action: 'tokenise', allowedPurposes: ['p'] } } })
show(
  'redact + custom detectors list',
  { entities: { PHONE: { action: 'redact' } } },
  { detectors: [...BUILTIN_DETECTORS] },
)
show(
  'redact + an async detector',
  { entities: { PHONE: { action: 'redact' } } },
  {
    detectors: [...BUILTIN_DETECTORS, { id: 'slow', entities: ['PHONE'], detect: async () => [] }],
  },
)
show(
  'redact + a throwing detector',
  { entities: { PHONE: { action: 'redact' } } },
  {
    detectors: [
      ...BUILTIN_DETECTORS,
      {
        id: 'boom',
        entities: ['EMAIL'],
        detect() {
          throw new Error('x')
        },
      },
    ],
  },
)
