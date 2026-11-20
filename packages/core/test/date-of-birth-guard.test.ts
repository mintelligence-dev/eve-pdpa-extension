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

const TEXT = 'วันเกิด 12/05/2530 ค่ะ'

describe('a policy written for 0.1', () => {
  it('does not know the entity, so the date is hidden, not let through (D1)', () => {
    const { guard, events } = guardWith({
      entitySet: '0.1',
      entities: { PHONE: { action: 'redact' } },
    })
    expect(guard.processSync(TEXT).text).toBe('วันเกิด [วันเกิด] ค่ะ')
    expect(events[0]?.findings[0]).toMatchObject({ entity: 'DATE_OF_BIRTH', unmapped: true })
  })
})

describe('with a rule of its own', () => {
  it('redact, in either language', () => {
    const th = guardWith({ entitySet: '0.2', entities: { DATE_OF_BIRTH: { action: 'redact' } } })
    expect(th.guard.processSync(TEXT).text).toBe('วันเกิด [วันเกิด] ค่ะ')
    const en = guardWith({
      entitySet: '0.2',
      placeholderLanguage: 'en',
      entities: { DATE_OF_BIRTH: { action: 'redact' } },
    })
    expect(en.guard.processSync(TEXT).text).toBe('วันเกิด [date-of-birth] ค่ะ')
  })

  it('mask hides it all, or keeps the year on request', () => {
    const none = guardWith({ entitySet: '0.2', entities: { DATE_OF_BIRTH: { action: 'mask' } } })
    expect(none.guard.processSync(TEXT).text).toBe('วันเกิด xxxxxxxxxx ค่ะ')
    const last = guardWith({
      entitySet: '0.2',
      entities: { DATE_OF_BIRTH: { action: 'mask', keep: 'last4' } },
    })
    expect(last.guard.processSync(TEXT).text).toBe('วันเกิด xxxxxx2530 ค่ะ')
  })

  it('hash gives one value for every way of writing the birthday', () => {
    const { guard } = guardWith({
      entitySet: '0.2',
      entities: { DATE_OF_BIRTH: { action: 'hash' } },
    })
    const a = guard.processSync('วันเกิด 12/05/2530').text
    const b = guard.processSync('วันเกิด 12 พ.ค. 2530').text
    const c = guard.processSync('วันเกิด 1987-05-12').text
    const other = guard.processSync('วันเกิด 13/05/2530').text
    expect(a).toMatch(/\[DATE_OF_BIRTH:[bcdfghjkmnpqrstv]{16}\]/)
    expect(b).toBe(a)
    expect(c).toBe(a)
    expect(other).not.toBe(a)
  })

  it('does not act on a delivery date', () => {
    const { guard } = guardWith({
      entitySet: '0.2',
      entities: { DATE_OF_BIRTH: { action: 'redact', minConfidence: 0.5 } },
    })
    const text = 'ส่งของวันที่ 12/05/2569 ค่ะ'
    expect(guard.processSync(text).text).toBe(text)
  })
})

describe('allowlist', () => {
  it('reads a whole date as a date of birth, however it is written', () => {
    expect(allowlistDigestForm('12/05/2530')).toBe('1987-05-12')
    expect(allowlistDigestForm('12 พ.ค. 2530')).toBe('1987-05-12')
    // A two-digit year is not read as a date here: 01-02-03 could be anything.
    expect(allowlistDigestForm('01-02-03')).not.toBe('2003-02-01')
  })
})

describe('audit', () => {
  it('names the entity and never carries the date', () => {
    const { guard, events } = guardWith({
      entitySet: '0.2',
      entities: { DATE_OF_BIRTH: { action: 'redact' } },
    })
    guard.processSync(TEXT)
    const json = JSON.stringify(events)
    expect(json).toContain('DATE_OF_BIRTH')
    expect(json).not.toContain('2530')
    expect(json).not.toContain('12/05')
  })
})

describe('overlap', () => {
  it('a phone number and an id beside a birthday stay what they are', () => {
    const { guard } = guardWith({
      entitySet: '0.2',
      entities: {
        DATE_OF_BIRTH: { action: 'redact' },
        PHONE: { action: 'redact' },
      },
    })
    expect(guard.processSync('เกิด 12/05/2530 โทร 0918887777').text).toBe(
      'เกิด [วันเกิด] โทร [เบอร์โทร]',
    )
  })
})
