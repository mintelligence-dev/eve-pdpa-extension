import { type AuditRecord, definePolicy, PdpaError } from '@eve-pdpa-extension/core'
import type { UserContent } from 'ai'
import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY, type GuardAuditContext, guardContent } from '../extension/lib/guard.js'
import { dashed, EMAIL, expectNoLeak, PHONE, syntheticId, thaiDigits } from './helpers.js'

const ID = syntheticId(1)
const ID2 = syntheticId(2)

function recorder(): {
  events: AuditRecord[]
  contexts: GuardAuditContext[]
  onAudit: (e: AuditRecord, ctx: GuardAuditContext) => void
} {
  const events: AuditRecord[] = []
  const contexts: GuardAuditContext[] = []
  return {
    events,
    contexts,
    onAudit: (e, ctx) => {
      events.push(e)
      contexts.push(ctx)
    },
  }
}

const blockIds = definePolicy({
  entitySet: '0.1',
  entities: { TH_NATIONAL_ID: { action: 'block' }, PHONE: { action: 'redact' } },
})

describe('guardContent — a string', () => {
  it('masks a Thai id however it is written, a phone and an email', () => {
    const audit = recorder()
    const text = [
      `บัตร ${dashed(ID)}`,
      `อีกใบ ${thaiDigits(ID2)}`,
      `เลขเดิม ${dashed(ID).replace(/-/g, ' ')}`,
      `โทร ${PHONE}`,
      `เมล ${EMAIL}`,
    ].join(' / ')

    const out = guardContent(text, { onAudit: audit.onAudit })

    expect(out.blocked).toBe(false)
    if (out.blocked) return
    expect(out.content).toContain('[เลขบัตรประชาชน]')
    expect(out.content).toContain('xxx-xxx-7777')
    expect(out.content).toContain('[อีเมล]')
    expectNoLeak(out, [ID, ID2, PHONE, EMAIL])
    expectNoLeak(audit.events, [ID, ID2, PHONE, EMAIL])
    expect(out.events).toHaveLength(1)
    expect(out.events[0]?.findings.map((f) => f.entity).sort()).toEqual([
      'EMAIL',
      'PHONE',
      'TH_NATIONAL_ID',
      'TH_NATIONAL_ID',
      'TH_NATIONAL_ID',
    ])
  })

  it('leaves clean text as it is, with one scan event that found nothing', () => {
    const out = guardContent('สวัสดีค่ะ สั่งของไปเมื่อวาน', { onAudit: () => {} })
    expect(out).toMatchObject({ blocked: false, content: 'สวัสดีค่ะ สั่งของไปเมื่อวาน' })
    expect(out.events).toHaveLength(1)
    expect(out.events[0]?.findings).toEqual([])
  })

  it('blocks when the policy blocks, with a reason that names the kind of data only', () => {
    const out = guardContent(`เลขบัตร ${dashed(ID)} เบอร์ ${PHONE}`, {
      policy: blockIds,
      onAudit: () => {},
    })
    expect(out.blocked).toBe(true)
    if (!out.blocked) return
    expect(out.reason).toContain('เลขบัตรประชาชน')
    expect(out.events[0]?.outcome).toBe('blocked')
    expectNoLeak(out, [ID, PHONE])
  })

  it('writes the reason in English under an English policy', () => {
    const policy = definePolicy({
      entitySet: '0.1',
      placeholderLanguage: 'en',
      entities: { CREDIT_CARD: { action: 'block', minConfidence: 0.6 } },
    })
    const out = guardContent('card 4111 1111 1111 1111', { policy, onAudit: () => {} })
    expect(out).toMatchObject({ blocked: true })
    if (!out.blocked) return
    expect(out.reason).toBe(
      'This message was not passed on because it contains a credit card number. Please send it again without that information.',
    )
  })
})

describe('guardContent — UserContent', () => {
  const file = {
    type: 'file',
    data: 'data:application/pdf;base64,JVBERi0=',
    mediaType: 'application/pdf',
  } as const

  it('masks text parts in order and passes a file part through as the same object', () => {
    const content: UserContent = [
      { type: 'text', text: `เลขบัตร ${dashed(ID)}` },
      file,
      { type: 'text', text: `โทร ${PHONE}` },
    ]
    const out = guardContent(content, { onAudit: () => {} })
    expect(out.blocked).toBe(false)
    if (out.blocked) return
    const parts = out.content as Exclude<UserContent, string>
    expect(parts).toHaveLength(3)
    expect(parts[0]).toEqual({ type: 'text', text: 'เลขบัตร [เลขบัตรประชาชน]' })
    expect(parts[1]).toBe(file)
    expect(parts[2]).toEqual({ type: 'text', text: 'โทร xxx-xxx-7777' })
    expect(out.events).toHaveLength(2)
    expectNoLeak(out, [ID, PHONE])
  })

  it('keeps other fields of a text part', () => {
    const content: UserContent = [
      { type: 'text', text: `โทร ${PHONE}`, providerOptions: { x: { cache: true } } },
    ]
    const out = guardContent(content, { onAudit: () => {} })
    if (out.blocked) throw new Error('unexpected block')
    expect(out.content).toEqual([
      { type: 'text', text: 'โทร xxx-xxx-7777', providerOptions: { x: { cache: true } } },
    ])
  })

  it('blocks a message with a file when files is "block", before scanning anything', () => {
    const content: UserContent = [{ type: 'text', text: `เลขบัตร ${dashed(ID)}` }, file]
    const out = guardContent(content, { files: 'block', onAudit: () => {} })
    expect(out).toMatchObject({ blocked: true, events: [] })
    if (!out.blocked) return
    expect(out.reason).toContain('ไฟล์แนบ')
    expectNoLeak(out, [ID])
  })

  it('blocks the whole message when any one text part is blocked', () => {
    const content: UserContent = [
      { type: 'text', text: 'สวัสดีค่ะ' },
      { type: 'text', text: `เลขบัตร ${dashed(ID)}` },
    ]
    const out = guardContent(content, { policy: blockIds, onAudit: () => {} })
    expect(out.blocked).toBe(true)
    expectNoLeak(out, [ID])
  })

  it('returns the same array when there was nothing to hide', () => {
    const content: UserContent = [{ type: 'text', text: 'สวัสดีค่ะ' }, file]
    const out = guardContent(content, { onAudit: () => {} })
    expect(out.blocked).toBe(false)
    if (!out.blocked) expect(out.content).toBe(content)
  })

  it('never changes the input', () => {
    const content: UserContent = Object.freeze([
      Object.freeze({ type: 'text', text: `เลขบัตร ${dashed(ID)}` } as const),
      file,
    ]) as unknown as UserContent
    const before = structuredClone(content)
    guardContent(content, { onAudit: () => {} })
    guardContent(content, { policy: blockIds, onAudit: () => {} })
    expect(content).toEqual(before)
  })

  it('refuses a message it cannot read instead of passing it on', () => {
    expect(() => guardContent(42 as unknown as string, { onAudit: () => {} })).toThrow(TypeError)
    expect(() =>
      guardContent([{ type: 'text', text: 7 }] as unknown as UserContent, { onAudit: () => {} }),
    ).toThrow(TypeError)
  })
})

describe('guardContent — options', () => {
  it('uses DEFAULT_POLICY and tells onAudit where the scan came from', () => {
    const audit = recorder()
    const options = { onAudit: audit.onAudit }
    guardContent(`โทร ${PHONE}`, options)
    guardContent(`โทร ${PHONE}`, options)
    // One guard per options object: one policy.loaded, then one scan per call.
    expect(audit.events.map((e) => e.type)).toEqual(['policy.loaded', 'scan', 'scan'])
    expect(audit.events[0]).toMatchObject({ policy: { hash: DEFAULT_POLICY.hash } })
    expect(audit.contexts).toEqual([
      { source: 'direct' },
      { source: 'direct' },
      { source: 'direct' },
    ])
  })

  it('refuses a policy that tokenises, at the first call', () => {
    const policy = definePolicy({
      entitySet: '0.1',
      entities: { PHONE: { action: 'tokenise', allowedPurposes: ['otp'] } },
    })
    expect(() => guardContent('x', { policy, onAudit: () => {} })).toThrow(PdpaError)
    expect(() => guardContent('x', { policy, onAudit: () => {} })).toThrow(/PHONE.*tokenise/)
  })

  it('hashes with a key, and refuses to start without one', () => {
    const policy = definePolicy({ entitySet: '0.1', entities: { EMAIL: { action: 'hash' } } })
    const out = guardContent(`เมล ${EMAIL}`, {
      policy,
      hmacKey: 'k'.repeat(64),
      onAudit: () => {},
    })
    expect(out.blocked).toBe(false)
    if (!out.blocked) expect(out.content).toMatch(/^เมล \[EMAIL:[a-z]{16}\]$/)
    expect(() => guardContent('x', { policy, onAudit: () => {} })).toThrow(
      expect.objectContaining({ code: 'ERR_PDPA_HMAC_KEY' }),
    )
  })

  it('rejects an unknown files setting', () => {
    expect(() => guardContent('x', { files: 'drop' as 'pass', onAudit: () => {} })).toThrow(
      TypeError,
    )
  })
})
