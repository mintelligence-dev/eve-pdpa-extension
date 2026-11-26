import type { Guard } from '@eve-pdpa-extension/core'
import { describe, expect, it } from 'vitest'
import { MAX_TEXT } from '../src/tools.js'
import { build, CARD, connect, EMAIL, PHONE, textOf } from './helpers.js'

describe('tools/list', () => {
  it('lists pdpa_scan and pdpa_redact, read-only, with input and output schemas', async () => {
    const client = await connect(build().guard)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['pdpa_redact', 'pdpa_scan'])
    for (const tool of tools) {
      expect(tool.inputSchema.properties).toHaveProperty('text')
      expect(tool.inputSchema.properties).toHaveProperty('context')
      expect(tool.inputSchema.required).toEqual(['text'])
      expect(tool.outputSchema).toBeDefined()
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false })
    }
  })
})

describe('pdpa_scan', () => {
  it('says what and where, never the values or the text', async () => {
    const client = await connect(build().guard)
    const text = `โทร ${PHONE} หรือ ${EMAIL}`
    const result = await client.callTool({ name: 'pdpa_scan', arguments: { text } })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toEqual({
      found: 2,
      byType: { PHONE: 1, EMAIL: 1 },
      findings: [
        expect.objectContaining({ entity: 'PHONE', start: 4, end: 14, action: 'redact' }),
        expect.objectContaining({ entity: 'EMAIL', start: 20, end: 39, action: 'redact' }),
      ],
    })
    // The positions point into the text the caller already holds.
    expect(text.slice(4, 14)).toBe(PHONE)
    const wire = JSON.stringify(result)
    expect(wire).not.toContain(PHONE)
    expect(wire).not.toContain(EMAIL)
  })

  it('finds nothing in text with nothing in it', async () => {
    const client = await connect(build().guard)
    const result = await client.callTool({ name: 'pdpa_scan', arguments: { text: 'สวัสดีค่ะ' } })
    expect(result.structuredContent).toEqual({ found: 0, byType: {}, findings: [] })
  })

  it('reports a type the policy blocks, without blocking the scan', async () => {
    const client = await connect(build({ CREDIT_CARD: { action: 'block' } }).guard)
    const result = await client.callTool({ name: 'pdpa_scan', arguments: { text: `บัตร ${CARD}` } })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toMatchObject({
      found: 1,
      findings: [{ entity: 'CREDIT_CARD', action: 'block' }],
    })
    expect(JSON.stringify(result)).not.toContain(CARD)
  })
})

describe('pdpa_redact', () => {
  it('returns the text with every value hidden, by default as a label', async () => {
    const client = await connect(build().guard)
    const result = await client.callTool({
      name: 'pdpa_redact',
      arguments: { text: `โทร ${PHONE} หรือ ${EMAIL}` },
    })
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toBe('โทร [เบอร์โทร] หรือ [อีเมล]')
    expect(result.structuredContent).toEqual({
      text: 'โทร [เบอร์โทร] หรือ [อีเมล]',
      byType: { PHONE: 1, EMAIL: 1 },
    })
  })

  it('follows the policy: mask keeps what the rule allows', async () => {
    const client = await connect(build({ PHONE: { action: 'mask', keep: 'last4' } }).guard)
    const result = await client.callTool({ name: 'pdpa_redact', arguments: { text: PHONE } })
    expect(textOf(result)).not.toContain(PHONE)
    expect(textOf(result)).toMatch(/5678$/)
  })

  it('uses context to find a bare account number, and never returns the context', async () => {
    const client = await connect(build().guard)
    const context = 'ขอเลขบัญชีค่ะ'
    const result = await client.callTool({
      name: 'pdpa_redact',
      arguments: { text: '123-4-56789-0', context },
    })
    expect(textOf(result)).toBe('[เลขบัญชี]')
    expect(JSON.stringify(result)).not.toContain(context)
  })

  it('a blocked text is an error naming the types, with no text in it', async () => {
    const client = await connect(build({ CREDIT_CARD: { action: 'block' } }).guard)
    const result = await client.callTool({
      name: 'pdpa_redact',
      arguments: { text: `บัตร ${CARD} โทร ${PHONE}` },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('pdpa: blocked by policy (CREDIT_CARD)')
    expect(result.structuredContent).toEqual({ blockedBy: ['CREDIT_CARD'] })
    expect(JSON.stringify(result)).not.toContain(CARD)
    expect(JSON.stringify(result)).not.toContain('บัตร')
  })
})

describe('what is never sent back', () => {
  it('text over the limit is refused without echoing it', async () => {
    const client = await connect(build().guard)
    const text = `${PHONE} ${'ก'.repeat(MAX_TEXT)}`
    for (const name of ['pdpa_scan', 'pdpa_redact']) {
      const result = await client.callTool({ name, arguments: { text } })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result)).not.toContain(PHONE)
    }
  })

  it('context holding values is never returned, by either tool, found or not', async () => {
    const context = `ลูกค้าเคยให้ ${PHONE} กับ ${EMAIL} ไว้`
    const client = await connect(build().guard)
    for (const name of ['pdpa_scan', 'pdpa_redact']) {
      for (const text of ['ไม่มีอะไร', `โทร ${PHONE}`, '']) {
        const result = await client.callTool({ name, arguments: { text, context } })
        const out = JSON.stringify(result)
        expect(out).not.toContain(PHONE)
        expect(out).not.toContain(EMAIL)
        expect(out).not.toContain('ลูกค้าเคยให้')
      }
    }
  })

  it('takes exactly MAX_TEXT characters, and refuses one more', async () => {
    const client = await connect(build().guard)
    const fits = `${PHONE} ${'ก'.repeat(MAX_TEXT - PHONE.length - 1)}`
    expect(fits.length).toBe(MAX_TEXT)
    for (const name of ['pdpa_scan', 'pdpa_redact']) {
      expect((await client.callTool({ name, arguments: { text: fits } })).isError).toBeFalsy()
      const over = await client.callTool({ name, arguments: { text: `${fits}ก` } })
      expect(over.isError).toBe(true)
      expect(JSON.stringify(over)).not.toContain(PHONE)
    }
  })

  it('the slowest known text at MAX_TEXT stays well under a second or two', async () => {
    // National-ID-like text whose cost grows with the square of its length.
    const text = '1-2345-67890-12-'.repeat(Math.ceil(MAX_TEXT / 16)).slice(0, MAX_TEXT)
    const client = await connect(build().guard)
    const started = performance.now()
    await client.callTool({ name: 'pdpa_scan', arguments: { text } })
    expect(performance.now() - started).toBeLessThan(2_000)
  })

  it('a guard that throws gives a message that says nothing about the text', async () => {
    const guard = {
      process: async () => {
        throw new Error(`leaked ${PHONE}`)
      },
    } as unknown as Guard
    const client = await connect(guard)
    for (const name of ['pdpa_scan', 'pdpa_redact']) {
      const result = await client.callTool({ name, arguments: { text: PHONE } })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toBe('pdpa: the text could not be checked')
      expect(JSON.stringify(result)).not.toContain(PHONE)
    }
  })

  it('audit events hold no value', async () => {
    const { guard, events } = build()
    const client = await connect(guard)
    await client.callTool({ name: 'pdpa_redact', arguments: { text: `โทร ${PHONE} ${EMAIL}` } })
    await client.callTool({ name: 'pdpa_scan', arguments: { text: `โทร ${PHONE} ${EMAIL}` } })
    expect(events.length).toBeGreaterThan(0)
    const all = JSON.stringify(events)
    expect(all).not.toContain(PHONE)
    expect(all).not.toContain(EMAIL)
  })
})
