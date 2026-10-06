import { describe, expect, it } from 'vitest'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import type { AuditEvent } from '../src/types.js'

const guardWith = (action: 'flag') => {
  const events: AuditEvent[] = []
  const guard = createGuard({
    policy: definePolicy({ entitySet: '0.1', entities: { PHONE: { action } } }),
    onAudit: (e) => {
      if (e.type === 'scan') events.push(e)
    },
  })
  return { guard, events }
}

describe('flag', () => {
  it('leaves the text exactly as the customer wrote it', () => {
    const { guard } = guardWith('flag')
    const input = 'เบอร์ ๐๙๑-๘๘๘-๗๗๗๗ ค่ะ'
    expect(guard.processSync(input).text).toBe(input)
  })

  it('still records a finding, which is the whole point of flag', () => {
    const { guard, events } = guardWith('flag')
    const r = guard.processSync('เบอร์ 0918887777')

    expect(r.findings).toEqual([expect.objectContaining({ entity: 'PHONE', action: 'flag' })])
    expect(events[0]?.findings).toHaveLength(1)
  })

  it('does not stop the message', () => {
    const { guard, events } = guardWith('flag')
    expect(guard.processSync('เบอร์ 0918887777').outcome).toBe('processed')
    expect(events[0]?.outcome).toBe('processed')
  })

  it('keeps the value out of the audit event even though it reached the model', () => {
    const { guard, events } = guardWith('flag')
    guard.processSync('เบอร์ 0918887777')
    expect(JSON.stringify(events)).not.toContain('0918887777')
  })
})
