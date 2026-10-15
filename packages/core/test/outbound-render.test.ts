import { describe, expect, it } from 'vitest'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import type { AuditEvent, AuditRecord, EntityRule } from '../src/types.js'

const KEY = 'a3f1c9e07b2d4f6a8c1e3b5d7f9a0c2e4b6d8f1a3c5e7b9d0f2a4c6e8b1d3f5a'
const TOKEN = /\[tok:[bcdfghjkmnpqrstv]{16}\]/

function setup(rule: EntityRule = { action: 'tokenise', allowedPurposes: ['otp_send'] }) {
  const events: AuditRecord[] = []
  const guard = createGuard({
    policy: definePolicy({
      entitySet: '0.1',
      entities: { PHONE: rule, EMAIL: { action: 'hash' } },
    }),
    hmacKey: KEY,
    onAudit: (e) => events.push(e),
  })
  const scans = () => events.filter((e): e is AuditEvent => e.type === 'scan')
  /** Tokenises a number the way an inbound message would, and returns the token. */
  const tokenFor = (text: string, sessionId = 'conv_a') => {
    const m = TOKEN.exec(guard.processSync(text, { sessionId }).text)
    if (m === null) throw new Error('no token issued')
    return m[0]
  }
  return { guard, scans, tokenFor }
}

describe('D10.1 — tokens in an outbound reply', () => {
  it('shows the customer their value masked, not the token', () => {
    const { guard, tokenFor } = setup()
    const tok = tokenFor('เบอร์ 091-888-7777')
    const r = guard.processSync(`ส่ง OTP ไปที่ ${tok} แล้วค่ะ`, {
      sessionId: 'conv_a',
      boundary: 'outbound',
    })
    expect(r.text).toBe('ส่ง OTP ไปที่ xxx-xxx-7777 แล้วค่ะ')
  })

  it('keeps the format and numerals the customer typed', () => {
    const { guard, tokenFor } = setup()
    const tok = tokenFor('เบอร์ ๐๙๑-๘๘๘-๗๗๗๗')
    const r = guard.processSync(`ยืนยันเบอร์ ${tok}`, { sessionId: 'conv_a', boundary: 'outbound' })
    expect(r.text).toBe('ยืนยันเบอร์ xxx-xxx-๗๗๗๗')
  })

  it('never writes the full value back', () => {
    const { guard, tokenFor } = setup()
    const tok = tokenFor('เบอร์ 0918887777')
    const r = guard.processSync(tok, { sessionId: 'conv_a', boundary: 'outbound' })
    expect(r.text).toBe('xxxxxx7777')
    expect(r.text).not.toContain('091888')
  })

  it('catches a token the model wrote without brackets', () => {
    const { guard, tokenFor } = setup()
    const id = tokenFor('เบอร์ 091-888-7777').slice(1, -1)
    const r = guard.processSync(`ส่งไปที่ ${id} แล้ว`, { sessionId: 'conv_a', boundary: 'outbound' })
    expect(r.text).toBe('ส่งไปที่ xxx-xxx-7777 แล้ว')
  })

  it('gives another session a placeholder, not the masked value', () => {
    const { guard, tokenFor } = setup()
    const tok = tokenFor('เบอร์ 091-888-7777', 'conv_a')
    const r = guard.processSync(`เบอร์ ${tok}`, { sessionId: 'conv_b', boundary: 'outbound' })
    expect(r.text).toBe('เบอร์ [ข้อมูลที่ปิดไว้]')
  })

  it('gives an unknown token a placeholder', () => {
    const { guard } = setup()
    const r = guard.processSync('เบอร์ [tok:bcdfghjkmnpqrstv]', {
      sessionId: 'conv_a',
      boundary: 'outbound',
    })
    expect(r.text).toBe('เบอร์ [ข้อมูลที่ปิดไว้]')
  })

  it('shows the placeholder under display: redact', () => {
    const { guard, tokenFor } = setup({
      action: 'tokenise',
      allowedPurposes: ['otp_send'],
      display: 'redact',
    })
    const tok = tokenFor('เบอร์ 091-888-7777')
    const r = guard.processSync(`เบอร์ ${tok}`, { sessionId: 'conv_a', boundary: 'outbound' })
    expect(r.text).toBe('เบอร์ [เบอร์โทร]')
  })

  it('still resolves to the full canonical value for a tool', () => {
    const { guard, tokenFor } = setup()
    const tok = tokenFor('เบอร์ ๐๙๑-๘๘๘-๗๗๗๗')
    guard.processSync(`ส่งไปที่ ${tok}`, { sessionId: 'conv_a', boundary: 'outbound' })
    expect(guard.resolveSync(tok, { purpose: 'otp_send', sessionId: 'conv_a' })).toEqual({
      ok: true,
      value: '0918887777',
    })
  })

  it('leaves tokens alone on the way in', () => {
    const { guard, tokenFor } = setup()
    const tok = tokenFor('เบอร์ 091-888-7777')
    const r = guard.processSync(`เบอร์ ${tok}`, { sessionId: 'conv_a', boundary: 'inbound' })
    expect(r.text).toBe(`เบอร์ ${tok}`)
  })

  it('masks a raw number the model typed into the reply, rather than showing a token', () => {
    const { guard } = setup()
    const r = guard.processSync('เบอร์ของคุณคือ 091-888-7777', {
      sessionId: 'conv_a',
      boundary: 'outbound',
    })
    expect(r.text).toBe('เบอร์ของคุณคือ xxx-xxx-7777')
  })
})

describe('D10.1 — hashes in an outbound reply', () => {
  it('become the placeholder', () => {
    const { guard } = setup()
    const hashed = guard.processSync('อีเมล somchai@example.com', { sessionId: 'conv_a' }).text
    expect(hashed).toMatch(/\[EMAIL:[a-z]{16}\]/)
    const r = guard.processSync(hashed, { sessionId: 'conv_a', boundary: 'outbound' })
    expect(r.text).toBe('อีเมล [อีเมล]')
  })
})

describe('D10.6 — the scan event records what a token may be resolved for', () => {
  it('lists the allowed purposes on the tokenise finding', () => {
    const { guard, scans } = setup({ action: 'tokenise', allowedPurposes: ['otp_send', 'kyc'] })
    guard.processSync('เบอร์ 091-888-7777', { sessionId: 'conv_a' })
    const finding = (scans().at(-1) as AuditEvent).findings[0]
    expect(finding?.allowedPurposes).toEqual(['otp_send', 'kyc'])
  })

  it('leaves the field off every other action', () => {
    const { guard, scans } = setup()
    guard.processSync('อีเมล somchai@example.com', { sessionId: 'conv_a' })
    expect((scans().at(-1) as AuditEvent).findings[0]).not.toHaveProperty('allowedPurposes')
  })
})

describe('D10.8 — audit records each rewrite', () => {
  const out = { sessionId: 'conv_a', boundary: 'outbound' } as const

  it('lists each token and hash in reading order, without any value', () => {
    const { guard, tokenFor, scans } = setup()
    const tok = tokenFor('เบอร์ 091-888-7777')
    const id = tok.slice(5, -1)
    guard.processSync(`[EMAIL:bcdfghjkmnpqrstv] และ ${tok}`, out)
    const last = scans().at(-1) as AuditEvent
    expect(last.rendered).toEqual([
      { kind: 'hash', entity: 'EMAIL', as: 'placeholder' },
      { kind: 'token', tokenId: id, entity: 'PHONE', as: 'masked' },
    ])
    expect(JSON.stringify(last)).not.toContain('7777')
  })

  it('marks a token from another session as foreign, and does not name its entity', () => {
    const { guard, tokenFor, scans } = setup()
    const tok = tokenFor('เบอร์ 091-888-7777', 'conv_b')
    guard.processSync(`เบอร์ ${tok}`, out)
    expect((scans().at(-1) as AuditEvent).rendered).toEqual([
      { kind: 'token', tokenId: tok.slice(5, -1), entity: null, as: 'foreign' },
    ])
  })

  it('marks a token it does not hold as unknown', () => {
    const { guard, scans } = setup()
    guard.processSync('เบอร์ [tok:bcdfghjkmnpqrstv]', out)
    expect((scans().at(-1) as AuditEvent).rendered).toEqual([
      { kind: 'token', tokenId: 'bcdfghjkmnpqrstv', entity: null, as: 'unknown' },
    ])
  })

  it('marks a token under display: redact as placeholder', () => {
    const { guard, tokenFor, scans } = setup({
      action: 'tokenise',
      allowedPurposes: ['otp_send'],
      display: 'redact',
    })
    const tok = tokenFor('เบอร์ 091-888-7777')
    guard.processSync(`เบอร์ ${tok}`, out)
    expect((scans().at(-1) as AuditEvent).rendered).toEqual([
      { kind: 'token', tokenId: tok.slice(5, -1), entity: 'PHONE', as: 'placeholder' },
    ])
  })

  it('omits the field when nothing was rewritten', () => {
    const { guard, scans } = setup()
    guard.processSync('สวัสดีค่ะ', out)
    expect(scans().at(-1)).not.toHaveProperty('rendered')
  })
})

describe('D10.9 — ref points the log back at the app', () => {
  it('is copied into the scan event', () => {
    const { guard, scans } = setup()
    guard.processSync('เบอร์ 091-888-7777', { sessionId: 'conv_a', ref: 'msg_10293' })
    expect(scans().at(-1)?.ref).toBe('msg_10293')
  })

  it('is copied into the token.resolve event', () => {
    const events: AuditRecord[] = []
    const guard = createGuard({
      policy: definePolicy({
        entitySet: '0.1',
        entities: { PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'] } },
      }),
      onAudit: (e) => events.push(e),
    })
    const tok = TOKEN.exec(guard.processSync('เบอร์ 091-888-7777', { sessionId: 'conv_a' }).text)
    guard.resolveSync(tok?.[0] ?? '', { purpose: 'otp_send', sessionId: 'conv_a', ref: 'call_77' })
    expect(events.at(-1)).toMatchObject({ type: 'token.resolve', ref: 'call_77' })
  })

  it('is left out when not given', () => {
    const { guard, scans } = setup()
    guard.processSync('เบอร์ 091-888-7777', { sessionId: 'conv_a' })
    expect(scans().at(-1)).not.toHaveProperty('ref')
  })

  it('must be a short string', () => {
    const { guard } = setup()
    const opts = { sessionId: 'conv_a' }
    // A PdpaError like every other refusal (D20), so callers catch one kind.
    const invalid = expect.objectContaining({ code: 'ERR_PDPA_INVALID_INPUT' })
    expect(() => guard.processSync('x', { ...opts, ref: '' })).toThrow(invalid)
    expect(() => guard.processSync('x', { ...opts, ref: 'a'.repeat(257) })).toThrow(invalid)
    expect(() => guard.processSync('x', { ...opts, ref: 42 as unknown as string })).toThrow(invalid)
  })
})
