import { describe, expect, it } from 'vitest'
import { createBrowserGuard } from '../src/browser.js'
import { definePolicy } from '../src/policy.js'
import type { AuditEvent, PolicyInput } from '../src/types.js'

const PHONE = 'เบอร์ 091-888-7777 ค่ะ'

function make(entities: PolicyInput['entities'], extra: Partial<PolicyInput> = {}) {
  const events: AuditEvent[] = []
  const guard = createBrowserGuard({
    policy: definePolicy({ entitySet: '0.1', entities, ...extra }),
    onAudit: (e) => {
      events.push(e as AuditEvent)
    },
  })
  return { guard, events }
}

describe('createBrowserGuard', () => {
  it.each(['redact', 'mask', 'flag', 'block'] as const)('accepts %s', async (action) => {
    const { guard } = make({ PHONE: { action } })
    const r = await guard.process(PHONE)
    expect(r.findings.some((f) => f.entity === 'PHONE')).toBe(true)
    if (action === 'redact' || action === 'mask') expect(r.text).not.toContain('888-7777')
    if (action === 'block') expect(r.text).toBe('')
  })

  it('refuses tokenise at construction, naming the entity', () => {
    expect(() => make({ PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'] } })).toThrow(
      /entities\.PHONE: "tokenise" is not available in the browser/,
    )
  })

  it('refuses hash at construction, even though no key was needed to ask', () => {
    expect(() => make({ EMAIL: { action: 'hash' } })).toThrow(/"hash" is not available/)
  })

  it('refuses a policy not built by definePolicy', () => {
    expect(() =>
      createBrowserGuard({ policy: { entities: {} } as never, onAudit: () => {} }),
    ).toThrow(/definePolicy/)
  })

  it('leaves no real value in the audit event', async () => {
    const { guard, events } = make({ PHONE: { action: 'redact' } })
    await guard.process(PHONE)
    expect(JSON.stringify(events)).not.toMatch(/888-7777|0918887777/)
  })
})
