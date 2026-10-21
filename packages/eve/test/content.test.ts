import type { UserContent } from 'ai'
import { describe, expect, it } from 'vitest'
import { derivePdpaSessionId, guardContent } from '../extension/lib/guard.js'
import {
  dashed,
  EMAIL,
  expectNoLeak,
  failingStore,
  MASK,
  makeGuard,
  PHONE,
  SESSION_KEY,
  syntheticId,
  TOKEN,
  TOKENISE,
  thaiDigits,
} from './helpers.js'

const ID = syntheticId(1)
const ID2 = syntheticId(2)
const CARD = '4111 1111 1111 1111'
const sessionId = await derivePdpaSessionId(SESSION_KEY, 'slack:C1:1800.1')
const file = {
  type: 'file',
  data: 'data:application/pdf;base64,JVBERi0=',
  mediaType: 'application/pdf',
} as const

describe('guardContent — a string', () => {
  it('masks a Thai id however it is written, a phone and an email', async () => {
    const { guard, audit } = makeGuard(MASK)
    const text = [
      `บัตร ${dashed(ID)}`,
      `อีกใบ ${thaiDigits(ID2)}`,
      `เลขเดิม ${dashed(ID).replace(/-/g, ' ')}`,
      `โทร ${PHONE}`,
      `เมล ${EMAIL}`,
    ].join(' / ')
    const out = await guardContent(text, { guard, sessionId })
    expect(out.blocked).toBe(false)
    if (out.blocked) return
    expect(out.content).toContain('[เลขบัตรประชาชน]')
    expect(out.content).toContain('xxx-xxx-7777')
    expect(out.content).toContain('[อีเมล]')
    expectNoLeak([out, audit], [ID, ID2, PHONE, EMAIL])
  })

  it('turns a phone into a token under a tokenising policy, scoped to the session', async () => {
    const { guard, audit } = makeGuard(TOKENISE)
    const out = await guardContent(`ขอ OTP ที่เบอร์ ${thaiDigits(PHONE)}`, { guard, sessionId })
    if (out.blocked) throw new Error('unexpected block')
    expect(out.content).toMatch(TOKEN)
    const r = await guard.resolve(out.content.match(TOKEN)?.[0] ?? '', {
      purpose: 'otp_send',
      sessionId,
    })
    expect(r).toEqual({ ok: true, value: '0918887777' })
    expect(audit.filter((e) => e.type === 'scan')).toMatchObject([
      { sessionId, boundary: 'inbound' },
    ])
    expectNoLeak([out, audit], [PHONE])
  })

  it('passes the boundary through to core', async () => {
    const { guard, audit } = makeGuard(MASK)
    await guardContent('สวัสดี', { guard, sessionId, boundary: 'tool_output' })
    expect(audit.at(-1)).toMatchObject({ type: 'scan', boundary: 'tool_output' })
  })

  it('leaves clean text as it is', async () => {
    const { guard } = makeGuard(MASK)
    expect(await guardContent('สวัสดีค่ะ', { guard, sessionId })).toEqual({
      blocked: false,
      content: 'สวัสดีค่ะ',
    })
  })

  it('blocks with a reason and the entity types, never the value', async () => {
    const { guard } = makeGuard(TOKENISE)
    const out = await guardContent(`บัตร ${CARD}`, { guard, sessionId })
    expect(out).toEqual({
      blocked: true,
      reason: expect.stringContaining('เลขบัตรเครดิต'),
      blockedBy: ['CREDIT_CARD'],
    })
    expectNoLeak(out, [CARD])
  })

  it('blocks with a store reason when the token store is down', async () => {
    const { guard } = makeGuard(TOKENISE, failingStore())
    const out = await guardContent(`โทร ${PHONE}`, { guard, sessionId })
    expect(out).toMatchObject({ blocked: true, blockedBy: ['PHONE'] })
    if (!out.blocked) return
    expect(out.reason).toContain('ไม่สำเร็จชั่วคราว')
    expectNoLeak(out, [PHONE])
  })

  it('writes the reason in English when asked', async () => {
    const { guard } = makeGuard(TOKENISE)
    const out = await guardContent(`card ${CARD}`, { guard, sessionId, language: 'en' })
    if (!out.blocked) throw new Error('expected a block')
    expect(out.reason).toBe(
      'This message was not passed on because it contains a credit card number. Please send it again without that information.',
    )
  })
})

describe('guardContent — UserContent', () => {
  it('masks text parts in order and passes a file part through as the same object', async () => {
    const { guard } = makeGuard(MASK)
    const content: UserContent = [
      { type: 'text', text: `เลขบัตร ${dashed(ID)}` },
      file,
      { type: 'text', text: `โทร ${PHONE}` },
    ]
    const out = await guardContent(content, { guard, sessionId })
    if (out.blocked) throw new Error('unexpected block')
    const parts = out.content as Exclude<UserContent, string>
    expect(parts[0]).toEqual({ type: 'text', text: 'เลขบัตร [เลขบัตรประชาชน]' })
    expect(parts[1]).toBe(file)
    expect(parts[2]).toEqual({ type: 'text', text: 'โทร xxx-xxx-7777' })
  })

  it('blocks a message with a file when files is "block"', async () => {
    const { guard, audit } = makeGuard(MASK)
    const out = await guardContent([{ type: 'text', text: 'ดูไฟล์' }, file], {
      guard,
      sessionId,
      files: 'block',
    })
    expect(out).toMatchObject({ blocked: true, blockedBy: [] })
    expect(audit.filter((e) => e.type === 'scan')).toEqual([])
  })

  it('returns the same array when there was nothing to hide, and never changes the input', async () => {
    const { guard } = makeGuard(MASK)
    const clean: UserContent = [{ type: 'text', text: 'สวัสดีค่ะ' }, file]
    const out = await guardContent(clean, { guard, sessionId })
    if (!out.blocked) expect(out.content).toBe(clean)
    const dirty = Object.freeze([
      Object.freeze({ type: 'text', text: `เลขบัตร ${dashed(ID)}` } as const),
    ]) as unknown as UserContent
    const before = structuredClone(dirty)
    await guardContent(dirty, { guard, sessionId })
    expect(dirty).toEqual(before)
  })

  it('refuses a message it cannot read, and a guard that is not core’s', async () => {
    const { guard } = makeGuard(MASK)
    await expect(guardContent(42 as unknown as string, { guard, sessionId })).rejects.toThrow(
      TypeError,
    )
    await expect(
      guardContent([{ type: 'text', text: 7 }] as unknown as UserContent, { guard, sessionId }),
    ).rejects.toThrow(TypeError)
    await expect(guardContent('x', { guard: {} as never, sessionId })).rejects.toThrow(
      /createGuard/,
    )
  })
})
