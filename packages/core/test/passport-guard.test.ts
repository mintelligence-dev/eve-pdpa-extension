import { describe, expect, it } from 'vitest'
import { allowlistDigestForm } from '../src/allowlist.js'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import type { AuditEvent, PolicyInput } from '../src/types.js'

const KEY = 'a3f1c9e07b2d4f6a8c1e3b5d7f9a0c2e4b6d8f1a3c5e7b9d0f2a4c6e8b1d3f5a'

function guardWith(policy: PolicyInput) {
  const events: AuditEvent[] = []
  const guard = createGuard({
    policy: definePolicy(policy),
    hmacKey: KEY,
    onAudit: (e) => {
      if (e.type === 'scan') events.push(e)
    },
  })
  return { guard, events }
}

const TEXT = 'พาสปอร์ต AB1234567 ค่ะ'

describe('a policy written for 0.1', () => {
  it('does not know the entity, so the number is hidden, not let through (D1)', () => {
    const { guard, events } = guardWith({
      entitySet: '0.1',
      entities: { PHONE: { action: 'redact' } },
    })
    expect(guard.processSync(TEXT).text).toBe('พาสปอร์ต [พาสปอร์ต] ค่ะ')
    expect(events[0]?.findings[0]).toMatchObject({ entity: 'PASSPORT', unmapped: true })
  })
})

describe('with a rule of its own', () => {
  it('redact, in either language', () => {
    const th = guardWith({ entitySet: '0.2', entities: { PASSPORT: { action: 'redact' } } })
    expect(th.guard.processSync(TEXT).text).toBe('พาสปอร์ต [พาสปอร์ต] ค่ะ')
    const en = guardWith({
      entitySet: '0.2',
      placeholderLanguage: 'en',
      entities: { PASSPORT: { action: 'redact' } },
    })
    expect(en.guard.processSync(TEXT).text).toBe('พาสปอร์ต [passport] ค่ะ')
  })

  it('mask hides it all, or keeps the last four on request', () => {
    const none = guardWith({ entitySet: '0.2', entities: { PASSPORT: { action: 'mask' } } })
    expect(none.guard.processSync(TEXT).text).toBe('พาสปอร์ต xxxxxxxxx ค่ะ')
    const last = guardWith({
      entitySet: '0.2',
      entities: { PASSPORT: { action: 'mask', keep: 'last4' } },
    })
    expect(last.guard.processSync(TEXT).text).toBe('พาสปอร์ต xxxxx4567 ค่ะ')
  })

  it('hash gives one value however it is written', () => {
    const { guard } = guardWith({ entitySet: '0.2', entities: { PASSPORT: { action: 'hash' } } })
    const a = guard.processSync('พาสปอร์ต AB1234567').text
    const b = guard.processSync('พาสปอร์ต ab-1234567').text
    const other = guard.processSync('พาสปอร์ต AC1234567').text
    expect(a).toMatch(/\[PASSPORT:[bcdfghjkmnpqrstv]{16}\]/)
    expect(b).toBe(a)
    expect(other).not.toBe(a)
  })

  it('a bare number is hidden only when the policy lowers the threshold to 0.6', () => {
    const def = guardWith({ entitySet: '0.2', entities: { PASSPORT: { action: 'redact' } } })
    expect(def.guard.processSync('AB1234567').text).toBe('AB1234567')
    const low = guardWith({
      entitySet: '0.2',
      entities: { PASSPORT: { action: 'redact', minConfidence: 0.6 } },
    })
    expect(low.guard.processSync('AB1234567').text).toBe('[พาสปอร์ต]')
    expect(low.guard.processSync('booking ref AB1234567').text).toBe('booking ref AB1234567')
  })
})

describe('allowlist', () => {
  it('reads two letters and seven digits as a passport, in any case', () => {
    expect(allowlistDigestForm('ab 1234567')).toBe('AB1234567')
    expect(allowlistDigestForm('AB-1234567')).toBe('AB1234567')
  })
})

describe('audit', () => {
  it('names the entity and never carries the number', () => {
    const { guard, events } = guardWith({
      entitySet: '0.2',
      entities: { PASSPORT: { action: 'redact' } },
    })
    guard.processSync(TEXT)
    const json = JSON.stringify(events)
    expect(json).toContain('PASSPORT')
    expect(json).not.toContain('1234567')
  })
})
