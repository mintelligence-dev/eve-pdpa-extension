import { describe, expect, it } from 'vitest'
import { PdpaError } from '../src/errors.js'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import type { AuditEvent, PolicyInput } from '../src/types.js'

const ENTITIES: PolicyInput['entities'] = {
  EMAIL: { action: 'redact' },
  PHONE: { action: 'redact' },
  CREDIT_CARD: { action: 'block' },
}

function guardWith(allowlist: PolicyInput['allowlist']) {
  const events: AuditEvent[] = []
  const guard = createGuard({
    policy: definePolicy({ entitySet: '0.1', entities: ENTITIES, allowlist }),
    onAudit: (e) => {
      if (e.type === 'scan') events.push(e)
    },
  })
  return { guard, events }
}

describe('exact', () => {
  it('lets the shop send its own contact details', () => {
    const { guard } = guardWith({ exact: ['support@myshop.co.th', '021234567'] })
    const reply = 'ติดต่อเราได้ที่ support@myshop.co.th หรือโทร 021234567 ค่ะ'
    expect(guard.processSync(reply, { boundary: 'outbound' }).text).toBe(reply)
  })

  it('still protects everything that is not on the list', () => {
    const { guard } = guardWith({ exact: ['support@myshop.co.th'] })
    const r = guard.processSync('ส่งไปที่ support@myshop.co.th หรือ somchai@example.com')
    expect(r.text).toBe('ส่งไปที่ support@myshop.co.th หรือ [อีเมล]')
  })

  it('matches however the value was written, because both sides are canonical', () => {
    const { guard } = guardWith({ exact: ['02-123-4567', 'Support@MyShop.co.th'] })
    for (const written of ['021234567', '02 123 4567', '๐๒-๑๒๓-๔๕๖๗']) {
      const input = `โทร ${written}`
      expect(guard.processSync(input).text).toBe(input)
    }
    expect(guard.processSync('support@myshop.co.th').text).toBe('support@myshop.co.th')
  })

  it('does not treat a different domain as the same address', () => {
    const { guard } = guardWith({ exact: ['a@my-shop.example'] })
    expect(guard.processSync('a@myshop.example').text).toBe('[อีเมล]')
  })
})

describe('pattern', () => {
  it('allows a whole family of values', () => {
    const { guard } = guardWith({ pattern: ['[a-z0-9.]+@myshop\\.co\\.th'] })
    const input = 'sales@myshop.co.th และ help@myshop.co.th'
    expect(guard.processSync(input).text).toBe(input)
  })

  it('must match the whole value, not just part of it', () => {
    // Unanchored, "0" would let through every value containing a zero.
    const { guard } = guardWith({ pattern: ['0'] })
    expect(guard.processSync('โทร 0918887777').text).toBe('โทร [เบอร์โทร]')
  })

  it('is tested against the canonical value, so case and separators do not matter', () => {
    const { guard } = guardWith({ pattern: ['02\\d{7}', '.*@myshop\\.co\\.th'] })
    expect(guard.processSync('โทร 02-123-4567').text).toBe('โทร 02-123-4567')
    expect(guard.processSync('SALES@MYSHOP.CO.TH').text).toBe('SALES@MYSHOP.CO.TH')
  })

  it('cannot escape the anchors with an unbalanced group', () => {
    // "a)|(b" alone is not a valid regex; wrapped naively it would become
    // ^(?:a)|(b)$ and match anything starting with "a".
    expect(() => guardWith({ pattern: ['a)|(b'] })).toThrow(PdpaError)
  })
})

describe('audit', () => {
  it('records the value as found and allowed, with the action it would have had', () => {
    const { guard, events } = guardWith({ exact: ['021234567'] })
    guard.processSync('โทร 021234567')

    expect(events[0]?.findings).toEqual([
      expect.objectContaining({ entity: 'PHONE', action: 'redact', allowlisted: true }),
    ])
  })

  it('never puts the allowlisted value in the event', () => {
    const { guard, events } = guardWith({ exact: ['021234567'] })
    guard.processSync('โทร 021234567')
    expect(JSON.stringify(events)).not.toContain('021234567')
  })

  it('does not mark findings that were acted on', () => {
    const { guard } = guardWith({ exact: ['021234567'] })
    const r = guard.processSync('โทร 0918887777')
    expect(r.findings[0]).not.toHaveProperty('allowlisted')
  })

  it('lets an allowlisted value through a block action without stopping the message', () => {
    const { guard } = guardWith({ exact: ['4111111111111111'] })
    const r = guard.processSync('บัตรทดสอบ 4111 1111 1111 1111')
    expect(r.outcome).toBe('processed')
  })
})

describe('policy', () => {
  it('rejects a pattern that does not compile, at load, without echoing it', () => {
    let error: unknown
    try {
      guardWith({ pattern: ['0918887777['] })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(PdpaError)
    expect(String(error)).toContain('allowlist.pattern[0]')
    expect(String(error)).not.toContain('0918887777')
  })

  it('rejects entries that are not strings', () => {
    expect(() => guardWith({ exact: [123 as unknown as string] })).toThrow(/allowlist\.exact/)
  })

  it('gives two policies that differ only in their allowlist different hashes', () => {
    const a = definePolicy({ entitySet: '0.1', entities: ENTITIES })
    const b = definePolicy({ entitySet: '0.1', entities: ENTITIES, allowlist: { exact: ['x'] } })
    expect(a.hash).not.toBe(b.hash)
  })

  it('gives the same hash whatever order the entries are listed in', () => {
    const a = definePolicy({
      entitySet: '0.1',
      entities: ENTITIES,
      allowlist: { exact: ['a', 'b'] },
    })
    const b = definePolicy({
      entitySet: '0.1',
      entities: ENTITIES,
      allowlist: { exact: ['b', 'a'] },
    })
    expect(a.hash).toBe(b.hash)
  })
})
