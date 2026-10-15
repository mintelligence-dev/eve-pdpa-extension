// Which words count as a bank-account cue? (README: "a cue such as เลขบัญชี or โอนเข้า")
//   bench/user/run examples/probe-bank-cues.mjs
import { createGuard, definePolicy, ENTITY_TYPES } from '@eve-pdpa-extension/core'

const guard = createGuard({
  policy: definePolicy({
    entitySet: '0.1',
    entities: Object.fromEntries(ENTITY_TYPES.map((e) => [e, { action: 'redact' }])),
  }),
  onAudit: () => {},
})
const cues = [
  'เลขบัญชี',
  'เลขที่บัญชี',
  'บัญชี',
  'บช.',
  'บช',
  'บ/ช',
  'เลขบันชี',
  'โอนเข้า',
  'โอนคืนเข้า',
  'โอนมาที่',
  'โอนไปที่',
  'เข้าบัญชี',
  'คืนเงินเข้า',
  'กสิกร',
  'SCB',
  'acc',
  'a/c',
  'account',
  'account no.',
  'bank account',
  'พร้อมเพย์',
]
const rows = []
for (const cue of cues) {
  for (const value of ['123-4-56789-0', '1234567890']) {
    const text = `${cue} ${value} ค่ะ`
    const r = guard.processSync(text)
    rows.push(
      `${cue.padEnd(14)} ${value.padEnd(14)} → ${r.findings.map((f) => f.entity).join('+') || 'NOT FOUND'}`,
    )
  }
}
console.log(rows.join('\n'))
for (const text of [
  'เลขบัญชีกสิกรของหนูนะคะ ชื่อ นางสาวพรทิพย์ แก้วกาญจนา สาขาเซ็นทรัลลาดพร้าว 123-4-56789-0',
  'ชื่อบัญชี นางสาวพรทิพย์ 1234567890',
]) {
  console.log(
    JSON.stringify(text.slice(0, 50)),
    '→',
    guard
      .processSync(text)
      .findings.map((f) => f.entity)
      .join('+') || 'NOT FOUND',
  )
}
