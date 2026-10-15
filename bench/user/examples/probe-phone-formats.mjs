// Common ways Thai shops and customers write phone numbers that are not in the benchmark data yet.
//   bench/user/run examples/probe-phone-formats.mjs
import { createGuard, definePolicy, ENTITY_TYPES } from '@eve-pdpa-extension/core'

const guard = createGuard({
  policy: definePolicy({
    entitySet: '0.1',
    entities: Object.fromEntries(ENTITY_TYPES.map((e) => [e, { action: 'redact' }])),
  }),
  onAudit: () => {},
})
const samples = [
  'โทร. 0-2123-4567',
  'โทร 0-2123-4567 ต่อ 12',
  'Tel. 0 2123 4567',
  'มือถือ 08-1234-5678',
  'เบอร์ 081-2345678',
  'เบอร์ 0812-345-678',
  'โทร +66(0)2-123-4567',
  'Tel: +66 (0) 81 234 5678',
  'Tel (+66) 81-234-5678',
  'โทร 66-81-234-5678',
  'เบอร์ +๖๖ ๘๑ ๒๓๔ ๕๖๗๘',
  'เบอร์ 0812345678/0898765432',
  'เบอร์ 081-234-5678,089-876-5432',
  'โทร081-234-5678ค่ะ',
  '📞081-234-5678',
  'เบอร์ 081 234 5678 (ไลน์ไอดีเดียวกัน)',
  'ติดต่อ 0812345678 หรือ 0898765432 หรือ 053-123-456',
]
for (const s of samples) {
  const r = guard.processSync(s)
  console.log(JSON.stringify(s).padEnd(46), '→', JSON.stringify(r.text))
}
