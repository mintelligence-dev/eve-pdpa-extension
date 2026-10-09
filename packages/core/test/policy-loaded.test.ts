import { describe, expect, it } from 'vitest'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import type { AuditEvent, AuditRecord, PolicyLoadedEvent } from '../src/types.js'

const policy = definePolicy({
  entitySet: '0.1',
  entities: {
    PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'], ttlSec: 120 },
    EMAIL: { action: 'redact' },
  },
  allowlist: { exact: ['support@myshop.co.th', '02-123-4567'], pattern: ['.*@myshop\\.co\\.th'] },
})

function build() {
  const events: AuditRecord[] = []
  const guard = createGuard({ policy, onAudit: (e) => events.push(e) })
  return { guard, events }
}

// D10.7 — the log explains its own policy hashes.
describe('policy.loaded', () => {
  it('is the first event, written once, when the guard is built', () => {
    const { guard, events } = build()
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('policy.loaded')
    guard.processSync('เบอร์ 091-888-7777', { sessionId: 'conv_a' })
    guard.processSync('สวัสดี', { sessionId: 'conv_a' })
    expect(events.filter((e) => e.type === 'policy.loaded')).toHaveLength(1)
  })

  it('carries the same hash every scan carries, and the rules behind it', () => {
    const { guard, events } = build()
    guard.processSync('เบอร์ 091-888-7777', { sessionId: 'conv_a' })
    const loaded = events[0] as PolicyLoadedEvent
    const scan = events[1] as AuditEvent
    expect(loaded.policy.hash).toBe(scan.policy.hash)
    expect(loaded.policy.entities).toEqual(policy.entities)
    expect(loaded.policy.onUnmapped).toBe('redact')
    expect(loaded.policy.allowlist.pattern).toHaveLength(1)
  })

  it('writes allowlist values as digests, never as they are', () => {
    const { events } = build()
    const loaded = events[0] as PolicyLoadedEvent
    const blob = JSON.stringify(loaded)
    expect(blob).not.toContain('support@myshop')
    expect(blob).not.toContain('123-4567')
    expect(loaded.policy.allowlist.exact).toHaveLength(2)
    for (const d of loaded.policy.allowlist.exact) expect(d).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('gives a value the digest anyone holding the value can recompute', async () => {
    const { events } = build()
    const loaded = events[0] as PolicyLoadedEvent
    const bytes = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode('support@myshop.co.th')),
    )
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(loaded.policy.allowlist.exact).toContain(`sha256:${hex}`)
  })

  it('gives every way of writing one value the same digest', () => {
    const digestsOf = (exact: string[]) => {
      const events: AuditRecord[] = []
      createGuard({
        policy: definePolicy({ entitySet: '0.1', entities: {}, allowlist: { exact } }),
        onAudit: (e) => events.push(e),
      })
      return (events[0] as PolicyLoadedEvent).policy.allowlist.exact
    }
    const [phone] = digestsOf(['021234567'])
    for (const written of ['02-123-4567', '๐๒-๑๒๓-๔๕๖๗', '+66 2 123 4567', '02 123 4567']) {
      expect(digestsOf([written]), written).toEqual([phone])
    }
    const [email] = digestsOf(['support@myshop.co.th'])
    expect(digestsOf(['Support@MyShop.co.th'])).toEqual([email])
    // An email keeps its hyphens: my-shop and myshop are different domains.
    expect(digestsOf(['support@my-shop.co.th'])).not.toEqual([email])
  })

  it('digests the canonical form, which anyone with the value can rebuild', async () => {
    const { events } = build()
    const loaded = events[0] as PolicyLoadedEvent
    const bytes = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode('021234567')),
    )
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    // The policy lists it as 02-123-4567.
    expect(loaded.policy.allowlist.exact).toContain(`sha256:${hex}`)
  })

  it('writes patterns as digests too, since one can hold a real number', async () => {
    const pattern = '0918887777|somchai\\.r@gmail\\.com'
    const events: AuditRecord[] = []
    createGuard({
      policy: definePolicy({ entitySet: '0.1', entities: {}, allowlist: { pattern: [pattern] } }),
      onAudit: (e) => events.push(e),
    })
    const loaded = events[0] as PolicyLoadedEvent
    const blob = JSON.stringify(loaded)
    expect(blob).not.toContain('0918887777')
    expect(blob).not.toContain('somchai')
    // Taken of the pattern as written, so the policy file gives the same digest.
    const bytes = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pattern)),
    )
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(loaded.policy.allowlist.pattern).toEqual([`sha256:${hex}`])
  })

  it('is not written when there is no sink', () => {
    // Nothing to assert on but that building does not throw without onAudit.
    expect(() => createGuard({ policy, onAudit: undefined })).not.toThrow()
  })
})
