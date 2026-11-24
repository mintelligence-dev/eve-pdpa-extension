import { describe, expect, it } from 'vitest'
import { eachString } from '../src/fields.js'
import { PRESETS, protectBody } from '../src/index.js'
import { build, CARD, PHONE, TOKENISE } from './helpers.js'

describe('field paths', () => {
  it('walk arrays and objects, strings only', () => {
    const body = {
      messages: [{ content: 'a' }, { content: 7 }, { content: [{ text: 'b' }, { text: null }] }],
      prompt: 'c',
    }
    const seen: string[] = []
    eachString(body, [...PRESETS.chat], (v) => seen.push(v))
    expect(seen).toEqual(['a', 'b', 'c'])
  })

  it('a missing key or a wrong shape is skipped', () => {
    const seen: string[] = []
    eachString({ messages: 'not an array' }, ['messages[].content', 'x.y.z'], (v) => seen.push(v))
    expect(seen).toEqual([])
  })
})

describe('protectBody', () => {
  it('protects every message, leaves the rest and the input alone', async () => {
    const { guard } = build()
    const body = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'ตอบสุภาพ' },
        { role: 'user', content: `เบอร์ ${PHONE} ค่ะ` },
      ],
    }
    const r = await protectBody(body, { guard })
    expect(r).toEqual({
      ok: true,
      body: {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'ตอบสุภาพ' },
          { role: 'user', content: 'เบอร์ [เบอร์โทร] ค่ะ' },
        ],
      },
      changed: true,
    })
    expect(body.messages[1]?.content).toBe(`เบอร์ ${PHONE} ค่ะ`)
  })

  it('OpenAI content parts and AI SDK v5 parts', async () => {
    const { guard } = build()
    const r = await protectBody(
      {
        messages: [
          { role: 'user', content: [{ type: 'text', text: `โทร ${PHONE}` }] },
          { role: 'user', parts: [{ type: 'text', text: `โทร ${PHONE}` }] },
        ],
      },
      { guard },
    )
    expect(JSON.stringify(r)).not.toContain(PHONE)
  })

  it('blocked anywhere: nothing comes back but the types', async () => {
    const { guard } = build({ CREDIT_CARD: { action: 'block' } })
    const r = await protectBody(
      { messages: [{ content: 'สวัสดี' }, { content: `บัตร ${CARD}` }] },
      { guard },
    )
    expect(r).toEqual({ ok: false, blockedBy: ['CREDIT_CARD'] })
  })

  it('a guard that blocks and names no type still stops the body', async () => {
    const { guard } = build()
    const silent = {
      ...guard,
      process: async () => ({
        text: '',
        findings: [],
        outcome: 'blocked' as const,
        skippedDetectors: [],
      }),
    }
    const r = await protectBody({ prompt: `บัตร ${CARD}` }, { guard: silent })
    expect(r).toEqual({ ok: false, blockedBy: [] })
  })

  it('one value, one token in a session; ref and boundary reach audit', async () => {
    const { guard, events } = build({ PHONE: TOKENISE })
    const r = await protectBody(
      { messages: [{ content: PHONE }, { content: `อีกที ${PHONE}` }] },
      { guard, sessionId: 'conv_1', ref: 'msg_9' },
    )
    const texts = r.ok
      ? (r.body as { messages: { content: string }[] }).messages.map((m) => m.content)
      : []
    const tokens = texts.map((t) => /\[tok:[a-z]+\]/.exec(t)?.[0])
    expect(tokens[0]).toBeDefined()
    expect(tokens[0]).toBe(tokens[1])
    const scans = events.filter((e) => e.type === 'scan')
    expect(scans.map((e) => [e.type === 'scan' && e.ref, e.type === 'scan' && e.boundary])).toEqual(
      [
        ['msg_9', 'inbound'],
        ['msg_9', 'inbound'],
      ],
    )
  })

  it('a tokenising policy without a session throws, as the guard does', async () => {
    const { guard } = build({ PHONE: TOKENISE })
    await expect(protectBody({ prompt: PHONE }, { guard })).rejects.toThrow(/sessionId/)
  })

  it('an unknown preset is a mistake, not a silent pass', async () => {
    const { guard } = build()
    await expect(protectBody({}, { guard, fields: 'gpt' as 'chat' })).rejects.toThrow(/preset/)
  })

  it('context: the question asked lets lets a bare reply be found, and is not logged', async () => {
    const { guard, events } = build()
    const body = { prompt: '123-4-56789-0' }
    const without = await protectBody(body, { guard })
    expect(without).toEqual({ ok: true, body, changed: false })
    const withContext = await protectBody(body, { guard, context: 'ขอเลขบัญชีค่ะ' })
    expect(withContext).toEqual({ ok: true, body: { prompt: '[เลขบัญชี]' }, changed: true })
    expect(JSON.stringify(events)).not.toContain('ขอเลขบัญชี')
  })
})
