import { describe, expect, it } from 'vitest'
import { createGuard } from '../src/guard.js'
import { isValidThaiNationalId } from '../src/normalise.js'
import { definePolicy } from '../src/policy.js'
import type { AuditEvent } from '../src/types.js'
import { makeThaiId } from './helpers/make-thai-id.js'

const policy = definePolicy({
  entitySet: '0.1',
  onUnmapped: 'redact',
  entities: { TH_NATIONAL_ID: { action: 'redact' } },
})

describe('no real value ever leaves the guard', () => {
  it('keeps the value out of the output text and the audit event', () => {
    const id = makeThaiId()
    const events: AuditEvent[] = []
    const guard = createGuard({
      policy,
      onAudit: (e) => {
        if (e.type === 'scan') events.push(e)
      },
    })

    const out = guard.processSync(`เลขบัตรประชาชน ${id} ครับ`)

    expect(out.text).not.toContain(id)
    expect(JSON.stringify(events)).not.toContain(id)
    expect(events).toHaveLength(1)
    expect(events[0]?.findings[0]?.entity).toBe('TH_NATIONAL_ID')
  })

  it('carries the policy hash so a scan can be reproduced', () => {
    const events: AuditEvent[] = []
    createGuard({
      policy,
      onAudit: (e) => {
        if (e.type === 'scan') events.push(e)
      },
    }).processSync(`id ${makeThaiId()}`)
    expect(events[0]?.policy.hash).toMatch(/^fnv1a64:[0-9a-f]{16}$/)
  })

  it('says which entities this build can see, so "none found" is not misread', () => {
    const events: AuditEvent[] = []
    createGuard({
      policy,
      onAudit: (e) => {
        if (e.type === 'scan') events.push(e)
      },
    }).processSync('hello')
    // All six entities 0.1 claims. Anything 0.2 adds — names, addresses, dates
    // of birth — must stay off this list until a detector can really see it.
    expect(events[0]?.engine.entitiesSupported).toEqual([
      'TH_NATIONAL_ID',
      'CREDIT_CARD',
      'EMAIL',
      'LINE_USER_ID',
      'PHONE',
      'BANK_ACCOUNT',
    ])
  })
})

describe('the customer gets their own message back, not a folded copy', () => {
  it('leaves Thai numerals as Thai numerals outside the redacted span', () => {
    // The control has to be digits no detector claims: an order of five pieces
    // for 250 baht. Folding is for detection only — what the customer typed is
    // what the customer gets back.
    const id = makeThaiId()
    const out = createGuard({ policy }).processSync(`เลขบัตรประชาชน ${id} สั่ง ๕ ชิ้น ราคา ๒๕๐ บาท`)

    expect(out.text).toContain('๕ ชิ้น')
    expect(out.text).toContain('๒๕๐ บาท')
    expect(out.text).not.toContain('250')
    expect(out.text).toContain('[เลขบัตรประชาชน]')
  })

  it('redacts the right span even when invisible characters shift the offsets', () => {
    const id = makeThaiId()
    const hidden = `${id.slice(0, 5)}​${id.slice(5)}`
    const events: AuditEvent[] = []
    const out = createGuard({
      policy,
      onAudit: (e) => {
        if (e.type === 'scan') events.push(e)
      },
    }).processSync(`ก่อนหน้า เลขบัตรประชาชน ${hidden} หลังจาก`)

    // The zero-width space hid it from a plain pattern; normalisation exposed it.
    expect(out.text).not.toContain(hidden)
    expect(out.text).toContain('ก่อนหน้า')
    expect(out.text).toContain('หลังจาก')
    expect(out.text).toContain('[เลขบัตรประชาชน]')

    // Offsets recorded for the DPO must index the ORIGINAL message, since that
    // is the copy their support system stored.
    const f = events[0]?.findings[0]
    expect(f).toBeDefined()
    expect(`ก่อนหน้า เลขบัตรประชาชน ${hidden} หลังจาก`.slice(f?.start, f?.end)).toBe(hidden)
  })
})

describe('checksum gates the detection', () => {
  it('generates only valid ids', () => {
    for (let i = 0; i < 500; i++) expect(isValidThaiNationalId(makeThaiId())).toBe(true)
  })

  it('leaves a checksum-invalid 13-digit run alone', () => {
    const out = createGuard({ policy }).processSync('เลขบัตรประชาชน 3100500123451 ครับ')
    expect(out.text).toContain('3100500123451')
  })
})

describe('policy errors never echo a value', () => {
  it('reports the path only', () => {
    expect(() =>
      definePolicy({
        entitySet: '0.1',
        entities: { TH_NATIONAL_ID: { action: 'redact', keep: 'last4' } },
      }),
    ).toThrow(/entities\.TH_NATIONAL_ID\.keep/)
  })

  it('rejects an unknown entity name rather than ignoring it', () => {
    expect(() =>
      definePolicy({
        entitySet: '0.1',
        entities: { PHNE: { action: 'redact' } } as never,
      }),
    ).toThrow(/unknown entity type/)
  })
})
