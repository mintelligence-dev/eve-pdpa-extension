import { describe, expect, it } from 'vitest'
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

const TEXT = 'ทะเบียนรถ กข 1234 ค่ะ'

describe('a policy written for 0.1', () => {
  it('does not know the entity, so the plate is hidden, not let through (D1)', () => {
    const { guard, events } = guardWith({
      entitySet: '0.1',
      entities: { PHONE: { action: 'redact' } },
    })
    expect(guard.processSync(TEXT).text).toBe('ทะเบียนรถ [ทะเบียนรถ] ค่ะ')
    expect(events[0]?.findings[0]).toMatchObject({ entity: 'LICENSE_PLATE', unmapped: true })
  })

  it('lets it through only where the policy says so in writing', () => {
    const { guard } = guardWith({
      entitySet: '0.1',
      onUnmapped: 'ignore',
      entities: { PHONE: { action: 'redact' } },
    })
    expect(guard.processSync(TEXT).text).toBe(TEXT)
  })
})

describe('with a rule of its own', () => {
  it('redact, in either language', () => {
    const th = guardWith({ entitySet: '0.2', entities: { LICENSE_PLATE: { action: 'redact' } } })
    expect(th.guard.processSync(TEXT).text).toBe('ทะเบียนรถ [ทะเบียนรถ] ค่ะ')
    const en = guardWith({
      entitySet: '0.2',
      placeholderLanguage: 'en',
      entities: { LICENSE_PLATE: { action: 'redact' } },
    })
    expect(en.guard.processSync(TEXT).text).toBe('ทะเบียนรถ [license-plate] ค่ะ')
  })

  it('mask keeps the separators and, on request, the end', () => {
    const none = guardWith({ entitySet: '0.2', entities: { LICENSE_PLATE: { action: 'mask' } } })
    expect(none.guard.processSync(TEXT).text).toBe('ทะเบียนรถ xx xxxx ค่ะ')
    const last = guardWith({
      entitySet: '0.2',
      entities: { LICENSE_PLATE: { action: 'mask', keep: 'last4' } },
    })
    expect(last.guard.processSync(TEXT).text).toBe('ทะเบียนรถ xx 1234 ค่ะ')
  })

  it('hash gives one value for every way of writing the plate', () => {
    const { guard } = guardWith({
      entitySet: '0.2',
      entities: { LICENSE_PLATE: { action: 'hash' } },
    })
    const a = guard.processSync('ทะเบียน กข 1234').text
    const b = guard.processSync('ทะเบียน กข-1234').text
    const c = guard.processSync('ทะเบียน กข ๑๒๓๔').text
    const other = guard.processSync('ทะเบียน กค 1234').text
    expect(a).toMatch(/\[LICENSE_PLATE:[bcdfghjkmnpqrstv]{16}\]/)
    expect(b).toBe(a)
    expect(c).toBe(a)
    expect(other).not.toBe(a)
  })

  it('block stops the message', () => {
    const { guard } = guardWith({
      entitySet: '0.2',
      entities: { LICENSE_PLATE: { action: 'block' } },
    })
    expect(guard.processSync(TEXT).outcome).toBe('blocked')
  })

  it('flag reports it and leaves the text', () => {
    const { guard, events } = guardWith({
      entitySet: '0.2',
      entities: { LICENSE_PLATE: { action: 'flag' } },
    })
    expect(guard.processSync(TEXT).text).toBe(TEXT)
    expect(events[0]?.findings).toHaveLength(1)
  })

  it('does not act on a bare shape under the default threshold', () => {
    const { guard } = guardWith({
      entitySet: '0.2',
      entities: { LICENSE_PLATE: { action: 'redact' } },
    })
    const text = 'มารับรถ 1กข 2345 นะ'
    expect(guard.processSync(text).text).toBe(text)
  })

  it('at 0.7 it also acts on a province after the number, and still not on a booking', () => {
    const { guard } = guardWith({
      entitySet: '0.2',
      entities: { LICENSE_PLATE: { action: 'redact', minConfidence: 0.7 } },
    })
    expect(guard.processSync('ตต 1199 ขอนแก่น').text).toBe('[ทะเบียนรถ]')
    expect(guard.processSync('จอง 2 เชียงใหม่ ค่ะ').text).toBe('จอง 2 เชียงใหม่ ค่ะ')
    expect(guard.processSync('ขอ 2 กรุงเทพ ครับ').text).toBe('ขอ 2 กรุงเทพ ครับ')
  })

  it('acts on it when the policy lowers the threshold', () => {
    const { guard } = guardWith({
      entitySet: '0.2',
      entities: { LICENSE_PLATE: { action: 'redact', minConfidence: 0.5 } },
    })
    expect(guard.processSync('มารับรถ 1กข 2345 นะ').text).toBe('มารับรถ [ทะเบียนรถ] นะ')
  })
})

describe('allowlist', () => {
  it("lets the shop's own delivery van through, however it is written", () => {
    const { guard } = guardWith({
      entitySet: '0.2',
      entities: { LICENSE_PLATE: { action: 'redact' } },
      allowlist: { exact: ['กข 1234'] },
    })
    for (const written of ['กข 1234', 'กข-1234', 'กข1234', 'กข ๑๒๓๔']) {
      const input = `ทะเบียน ${written}`
      expect(guard.processSync(input).text).toBe(input)
    }
    expect(guard.processSync('ทะเบียน กค 1234').text).toBe('ทะเบียน [ทะเบียนรถ]')
  })
})

describe('audit', () => {
  it('names the entity and never carries the plate', () => {
    const { guard, events } = guardWith({
      entitySet: '0.2',
      entities: { LICENSE_PLATE: { action: 'redact' } },
    })
    guard.processSync(TEXT)
    const json = JSON.stringify(events)
    expect(json).toContain('LICENSE_PLATE')
    expect(json).not.toContain('กข')
    expect(json).not.toContain('1234')
  })
})

describe('overlap', () => {
  it('a phone number beside a plate is not taken for part of it', () => {
    const { guard } = guardWith({
      entitySet: '0.2',
      entities: { LICENSE_PLATE: { action: 'redact' }, PHONE: { action: 'redact' } },
    })
    expect(guard.processSync('ทะเบียน กข 1234 โทร 0918887777').text).toBe(
      'ทะเบียน [ทะเบียนรถ] โทร [เบอร์โทร]',
    )
  })
})
