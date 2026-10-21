import { describe, expect, it, vi } from 'vitest'

const slots = new Map<string, unknown>()
vi.mock('eve/context', () => ({
  defineState: (name: string, initial: () => unknown) => ({
    get: () => (slots.has(name) ? slots.get(name) : initial()),
    update: (fn: (v: unknown) => unknown) => {
      slots.set(name, fn(slots.has(name) ? slots.get(name) : initial()))
    },
  }),
}))

const { generateText } = await import('ai')
const { mockModel } = await import('eve/evals')
const { derivePdpaSessionId, guardModel } = await import('../extension/lib/guard.js')
const {
  dashed,
  EMAIL,
  expectNoLeak,
  MASK,
  makeGuard,
  PHONE,
  SESSION_KEY,
  syntheticId,
  TOKEN,
  TOKENISE,
} = await import('./helpers.js')

const ID = syntheticId(9)

/** eve's fixture model, keeping every prompt it is sent. */
function recording() {
  const prompts: { role: string; text: string }[][] = []
  const model = mockModel(({ messages }) => {
    prompts.push(messages)
    return 'รับทราบค่ะ'
  })
  return { model, prompts }
}

/** A conversation where personal data reaches the prompt only through a tool's result. */
const MESSAGES = [
  { role: 'user' as const, content: 'ช่วยหาข้อมูลลูกค้า C-17 ให้หน่อย' },
  {
    role: 'assistant' as const,
    content: [
      {
        type: 'tool-call' as const,
        toolCallId: 'call_1',
        toolName: 'crm_lookup',
        input: { id: 'C-17' },
      },
    ],
  },
  {
    role: 'tool' as const,
    content: [
      {
        type: 'tool-result' as const,
        toolCallId: 'call_1',
        toolName: 'crm_lookup',
        output: {
          type: 'json' as const,
          value: { name: 'ลูกค้าตัวอย่าง', phone: PHONE, email: EMAIL, nationalId: dashed(ID) },
        },
      },
    ],
  },
  { role: 'user' as const, content: `เบอร์สำรอง ${PHONE} นะคะ` },
]

describe('guardModel', () => {
  it('masks what reaches the model, even when it arrives in a tool result', async () => {
    slots.clear()
    const sessionId = await derivePdpaSessionId(SESSION_KEY, 'slack:C1:1800.1')
    slots.set('eve-pdpa-extension.session', { id: sessionId })
    const { guard, audit } = makeGuard(TOKENISE)
    const { model, prompts } = recording()
    await generateText({
      model: guardModel(model, { guard, sessionKey: SESSION_KEY }),
      messages: MESSAGES,
    })
    expect(prompts).toHaveLength(1)
    const seen = JSON.stringify(prompts[0])
    expect(seen).toMatch(TOKEN)
    expect(seen).toContain('[เลขบัตรประชาชน]')
    expectNoLeak([prompts, audit], [PHONE, EMAIL, ID, SESSION_KEY])
    const scans = audit.filter((e) => e.type === 'scan')
    expect(scans.every((e) => e.boundary === 'prompt' && e.sessionId === sessionId)).toBe(true)
  })

  it('withholds a prompt text the policy blocks', async () => {
    slots.clear()
    const { guard } = makeGuard(MASK)
    const { model, prompts } = recording()
    await generateText({
      model: guardModel(model, { guard, sessionKey: SESSION_KEY }),
      messages: [{ role: 'user', content: 'บัตร 4111 1111 1111 1111' }],
    })
    expect(JSON.stringify(prompts[0])).toContain('[ข้อมูลที่ปิดไว้]')
    expectNoLeak(prompts, ['4111 1111 1111 1111'])
  })

  it('without a stored session, issues tokens nothing can resolve', async () => {
    slots.clear()
    const { guard, audit } = makeGuard(TOKENISE)
    const { model } = recording()
    await generateText({
      model: guardModel(model, { guard, sessionKey: SESSION_KEY }),
      messages: [{ role: 'user', content: `เบอร์ ${PHONE}` }],
    })
    expect(audit.filter((e) => e.type === 'scan').map((e) => e.sessionId)).toEqual(['eve_unbound'])
  })

  it('accepts a gateway model id without calling anything until it is used', () => {
    const { guard } = makeGuard(MASK)
    const wrapped = guardModel('anthropic/claude-opus-5.5', { guard, sessionKey: SESSION_KEY })
    expect(typeof wrapped).toBe('object')
    expect((wrapped as { modelId: string }).modelId).toBe('anthropic/claude-opus-5.5')
  })
})
