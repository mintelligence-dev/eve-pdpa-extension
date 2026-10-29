import { describe, expect, it } from 'vitest'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import type { AuditEvent, PolicyInput } from '../src/types.js'

const CARD = '4111 1111 1111 1111'

function guardWith(entities: PolicyInput['entities'], extra: Partial<PolicyInput> = {}) {
  const events: AuditEvent[] = []
  const guard = createGuard({
    policy: definePolicy({ entitySet: '0.1', entities, ...extra }),
    onAudit: (e) => {
      if (e.type === 'scan') events.push(e)
    },
  })
  return { guard, events }
}

describe('a blocked message — D8.2', () => {
  it('returns no text at all', () => {
    const { guard } = guardWith({ CREDIT_CARD: { action: 'block' } })
    const r = guard.processSync(`บัตร ${CARD} ค่ะ`)

    expect(r.text).toBe('')
    expect(r.outcome).toBe('blocked')
  })

  it('does not leak the rest of the message to a caller who forgets to check outcome', () => {
    // onUnmapped: ignore means the phone number would pass untouched in a
    // processed message. A blocked one must not carry it anywhere.
    const { guard } = guardWith({ CREDIT_CARD: { action: 'block' } }, { onUnmapped: 'ignore' })
    const r = guard.processSync(`บัตร ${CARD} เบอร์ 0918887777`)

    expect(r.text).toBe('')
    expect(JSON.stringify(r)).not.toContain('0918887777')
  })

  it('says which entity stopped it', () => {
    const { guard } = guardWith({ CREDIT_CARD: { action: 'block' } })
    expect(guard.processSync(`บัตร ${CARD}`).blockedBy).toEqual(['CREDIT_CARD'])
  })

  it('lists each blocking entity once, in reading order', () => {
    const { guard } = guardWith({
      CREDIT_CARD: { action: 'block' },
      TH_NATIONAL_ID: { action: 'block' },
    })
    const r = guard.processSync(`เลขบัตร 3-1005-00123-45-8 บัตร ${CARD} อีกใบ 5555555555554444`)
    expect(r.blockedBy).toEqual(['TH_NATIONAL_ID', 'CREDIT_CARD'])
  })

  it('names only the entities that blocked, not everything that was found', () => {
    const { guard } = guardWith({
      CREDIT_CARD: { action: 'block' },
      PHONE: { action: 'redact' },
    })
    expect(guard.processSync(`บัตร ${CARD} เบอร์ 0918887777`).blockedBy).toEqual(['CREDIT_CARD'])
  })

  it('still reports every finding, so the audit shows everything that was there', () => {
    const { guard, events } = guardWith({
      CREDIT_CARD: { action: 'block' },
      PHONE: { action: 'redact' },
    })
    const r = guard.processSync(`บัตร ${CARD} เบอร์ 0918887777`)

    expect(r.findings.map((f) => f.entity)).toEqual(['CREDIT_CARD', 'PHONE'])
    expect(events[0]?.outcome).toBe('blocked')
    expect(events[0]?.findings).toHaveLength(2)
  })

  it('keeps the value out of the audit event', () => {
    const { guard, events } = guardWith({ CREDIT_CARD: { action: 'block' } })
    guard.processSync(`บัตร ${CARD}`)
    expect(JSON.stringify(events)).not.toContain('4111')
  })
})

describe('a message that was not blocked', () => {
  it('has no blockedBy field at all, not an empty one', () => {
    const { guard } = guardWith({ CREDIT_CARD: { action: 'block' } })
    const r = guard.processSync('ไม่มีอะไรค่ะ')

    expect(r.outcome).toBe('processed')
    expect(r).not.toHaveProperty('blockedBy')
  })

  it('is not blocked by a value the allowlist lets through', () => {
    const { guard } = guardWith(
      { CREDIT_CARD: { action: 'block' } },
      { allowlist: { exact: ['4111111111111111'] } },
    )
    const r = guard.processSync(`บัตรทดสอบ ${CARD}`)

    expect(r.outcome).toBe('processed')
    expect(r.text).toBe(`บัตรทดสอบ ${CARD}`)
    expect(r).not.toHaveProperty('blockedBy')
  })
})

// Slack, 27 Oct: eve wraps every Slack message in a block that holds
// `message_ts: 1761500013.000100`. That ts passes Luhn, and with the card
// threshold at 0.6 (the way to protect unknown issuers) it blocked "สวัสดีค่ะ".
describe('a message wrapped with its Slack timestamps', () => {
  const wrap = (ts: string, text: string) =>
    `<slack_message>\nsender_type: user\nthread_ts: ${ts}\nmessage_ts: ${ts}\n<content>\n${text}\n</content>\n</slack_message>`

  it('is not blocked because a timestamp passes Luhn', () => {
    const { guard } = guardWith({ CREDIT_CARD: { action: 'block', minConfidence: 0.6 } })
    const r = guard.processSync(wrap('1761500013.000100', 'สวัสดีค่ะ'))
    expect(r.outcome).toBe('processed')
    expect(r.findings).toEqual([])
  })

  it('is still blocked for a card written in it, and for a Luhn-only run under another key', () => {
    const { guard } = guardWith({ CREDIT_CARD: { action: 'block', minConfidence: 0.6 } })
    expect(guard.processSync(wrap('1761500013.000100', `บัตร ${CARD}`)).outcome).toBe('blocked')
    expect(guard.processSync('order_no: 1761500013.000100').outcome).toBe('blocked')
  })
})
