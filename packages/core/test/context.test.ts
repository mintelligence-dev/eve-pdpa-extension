import { describe, expect, it } from 'vitest'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import type { AuditEvent, AuditRecord } from '../src/types.js'

function build() {
  const events: AuditRecord[] = []
  const guard = createGuard({
    policy: definePolicy({
      entitySet: '0.1',
      entities: { BANK_ACCOUNT: { action: 'redact' }, PHONE: { action: 'redact' } },
    }),
    onAudit: (e) => events.push(e),
  })
  const scans = () => events.filter((e): e is AuditEvent => e.type === 'scan')
  return { guard, scans }
}

// D10.11 — the cue is in the question, the number is in the answer.
describe('context: the other side’s last message', () => {
  it('finds an account number answered on its own', () => {
    const { guard } = build()
    const answer = '123-4-56789-0 ชื่อ สมชาย'
    expect(guard.processSync(answer).text).toBe(answer)
    expect(guard.processSync(answer, { context: 'รบกวนแจ้งเลขบัญชีสำหรับโอนคืนด้วยนะคะ' }).text).toBe(
      '[เลขบัญชี] ชื่อ สมชาย',
    )
  })

  it('reads a ten-digit answer to an account question as an account, not a phone', () => {
    const { guard } = build()
    const r = guard.processSync('0672051329', { context: 'ขอเลขบัญชีด้วยค่ะ' })
    expect(r.findings.map((f) => f.entity)).toEqual(['BANK_ACCOUNT'])
  })

  it('reads it as a phone when the question asked for a phone', () => {
    const { guard } = build()
    const r = guard.processSync('0672051329', { context: 'รบกวนขอเบอร์ติดต่อกลับค่ะ' })
    expect(r.findings.map((f) => f.entity)).toEqual(['PHONE'])
  })

  it('does not lend a cue to a long message that has moved on', () => {
    const { guard } = build()
    const long = 'ออเดอร์ 8829301847 ของฉันยังไม่มาเลยค่ะ สั่งไปตั้งแต่วันจันทร์แล้ว ช่วยตามให้หน่อยได้ไหมคะ ขอบคุณค่ะ'
    expect(guard.processSync(long, { context: 'ขอเลขบัญชีด้วยค่ะ' }).findings).toEqual([])
  })

  it('never rewrites or records the context', () => {
    const { guard, scans } = build()
    const context = 'เบอร์เดิม 0918887777 ใช้ไม่ได้แล้ว ขอเลขบัญชีใหม่ค่ะ'
    guard.processSync('123-4-56789-0', { context })
    const last = scans().at(-1) as AuditEvent
    expect(last.contextUsed).toBe(true)
    expect(JSON.stringify(last)).not.toContain('0918887777')
    expect(JSON.stringify(last)).not.toContain('เบอร์เดิม')
  })

  it('leaves the field off when no context was given', () => {
    const { guard, scans } = build()
    guard.processSync('สวัสดีค่ะ')
    expect(scans().at(-1)).not.toHaveProperty('contextUsed')
  })

  it('must be a string', () => {
    const { guard } = build()
    expect(() => guard.processSync('x', { context: 42 as unknown as string })).toThrow(TypeError)
  })
})
