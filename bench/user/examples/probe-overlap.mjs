// Which texts make two detectors claim overlapping characters? And what does a policy that
// protects phones but only flags accounts do with a PromptPay phone number?
//   bench/user/run examples/probe-overlap.mjs
import {
  BUILTIN_DETECTORS,
  createEngine,
  createGuard,
  definePolicy,
  normalise,
} from '@eve-pdpa-extension/core'

const engine = createEngine(BUILTIN_DETECTORS)
const texts = [
  'เลขบัญชี 0918887777 ค่ะ',
  'โอนเข้าพร้อมเพย์ 0918887777 ค่ะ',
  'พร้อมเพย์ 0918887777 ค่ะ',
  'บัญชี 0918887777',
  '0918887777@gmail.com',
  'U0918887777abcdef0123456789abcdef',
  'userId U4af4980629f1ae0b2b5c2f7a7b2e9c3d โทร 0918887777',
  'เลขบัญชี 091-888-7777',
  'เลขบัญชี 1103702071811',
  'บัตร 4111111111111111 เลขบัญชี',
]
for (const t of texts) {
  const res = engine.runSync(normalise(t), { sessionId: 's', boundary: 'inbound' })
  console.log(
    JSON.stringify(t),
    '→ raw',
    JSON.stringify(res.raw.map((c) => [c.entity, c.start, c.end, c.confidence])),
  )
}
const policy = definePolicy({
  entitySet: '0.1',
  entities: {
    PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'] },
    BANK_ACCOUNT: { action: 'flag' },
  },
})
const g = createGuard({ policy, onAudit: () => {} })
for (const t of [
  'โอนเข้าพร้อมเพย์ 0918887777 ค่ะ',
  'เลขบัญชี 091-888-7777 (พร้อมเพย์)',
  'โทร 0918887777 ค่ะ',
]) {
  console.log(
    'PHONE tokenise + BANK flag:',
    JSON.stringify(t),
    '→',
    JSON.stringify(g.processSync(t, { sessionId: 's' }).text),
  )
}
