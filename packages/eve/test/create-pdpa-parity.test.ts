// U-CP-3: pdpa.* is the 0.1.0 API with the guard filled in. One conversation —
// in through a channel, the hook, a tool that resolves a token, the model's
// prompt, a reply posted out — run through both, with the same expectations,
// and the same audit trail at the end.
import { type AuditRecord, createMemoryTokenStore } from '@eve-pdpa-extension/core'
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
const { defineTool } = await import('eve/tools')
const guardApi = await import('../extension/lib/guard.js')
const { fakeArgs, post } = await import('./fakes.js')
const { expectNoLeak, HMAC_KEY, makeGuard, PHONE, SESSION_KEY, TOKEN, TOKENISE } = await import(
  './helpers.js'
)

const CARD = '4111 1111 1111 1111'
const ADDRESS = 'C1:1800.1'

interface Wiring {
  readonly audit: AuditRecord[]
  channel(c: any, name: string): any
  tool(t: any, purpose: string): any
  model(m: any): any
  readonly hook: any
}

function oldApi(): Wiring {
  const { guard, audit } = makeGuard(TOKENISE)
  const o = { guard, sessionKey: SESSION_KEY }
  return {
    audit,
    channel: (c, name) => guardApi.withPdpaGuard(c, { ...o, policy: TOKENISE, channelName: name }),
    tool: (t, purpose) => guardApi.withTokenResolution(t, { ...o, purpose }),
    model: (m) => guardApi.guardModel(m, o),
    hook: guardApi.pdpaHook(o),
  }
}

function newApi(): Wiring {
  const audit: AuditRecord[] = []
  const pdpa = guardApi.createPdpa({
    policy: TOKENISE,
    hmacKey: HMAC_KEY,
    sessionKey: SESSION_KEY,
    tokenStore: createMemoryTokenStore(),
    onAudit: (e) => {
      audit.push(e)
    },
    env: {},
  })
  return {
    audit,
    channel: (c, name) => pdpa.channel(c, name),
    tool: (t, purpose) => pdpa.tool(t, purpose),
    model: (m) => pdpa.model(m),
    hook: pdpa.hook,
  }
}

/** What an audit trail says, without the parts that differ run to run: ids, times, tokens. */
function shape(audit: readonly AuditRecord[]): unknown[] {
  return audit.map((e) => {
    const r = e as Record<string, unknown>
    return {
      type: r.type,
      boundary: r.boundary,
      outcome: r.outcome,
      purpose: r.purpose,
      sessionId: r.sessionId,
      findings: Array.isArray(r.findings)
        ? r.findings.map((f: Record<string, unknown>) => [f.entity, f.action])
        : undefined,
    }
  })
}

const trails: Record<string, unknown[]> = {}

describe.each([
  ['0.1.0 API', oldApi],
  ['pdpa.*', newApi],
] as const)('one conversation through the %s', (name, wire) => {
  it('masks in, resolves in the tool, masks the prompt and the reply', async () => {
    slots.clear()
    const w = wire()
    const posted: unknown[] = []
    const { args, calls } = fakeArgs()
    const channel = w.channel(
      {
        routes: [
          {
            method: 'POST' as const,
            path: '/m',
            handler: async (request: Request, a: typeof args) => {
              const { message } = (await request.json()) as { message: string }
              await a.from(ADDRESS).send(message, { auth: null })
              return new Response('ok')
            },
          },
        ],
        adapter: {
          'message.completed': (data: unknown) => {
            posted.push(data)
          },
        },
      },
      'slack',
    )
    const handler = channel.routes[0].handler as (r: Request, a: unknown) => Promise<Response>

    // In: the phone becomes a token before eve records it.
    await handler(post({ message: `ขอ OTP เบอร์ ${PHONE}` }), args)
    const recorded = calls[0]?.message as string
    expect(recorded).toMatch(TOKEN)
    const token = recorded.match(TOKEN)?.[0] as string

    // A card stops the message: nothing reaches eve.
    await expect(handler(post({ message: `บัตร ${CARD}` }), args)).rejects.toMatchObject({
      code: 'PDPA_BLOCKED',
    })
    expect(calls).toHaveLength(1)

    // The hook stores the session's pdpa id, as eve runs it on the recorded message.
    await w.hook.events['message.received'](
      { type: 'message.received', data: { message: recorded, sequence: 1, turnId: 't' } },
      {
        cancel: vi.fn(),
        channel: { kind: 'http', continuationToken: `slack:${ADDRESS}` },
        session: { id: 'wrun_C1' },
      },
    )

    // The tool gets the real number; the model only the token.
    const received: unknown[] = []
    const tool = w.tool(
      defineTool({
        description: 'Send an OTP.',
        inputSchema: { type: 'object', properties: { phone: { type: 'string' } } },
        async execute(input: { phone: string }) {
          received.push(input)
          return { sent: true }
        },
      }),
      'otp_send',
    )
    await tool.execute({ phone: token }, {
      session: { id: 'wrun_C1' },
      callId: 'call_1',
      toolName: 'otp_send',
      messages: [],
    } as never)
    expect(received).toEqual([{ phone: '0918887777' }])

    // The prompt: a phone typed into a system message is masked on the way to the provider.
    const prompts: { role: string; text: string }[][] = []
    const model = w.model(
      mockModel(({ messages }) => {
        prompts.push(messages)
        return 'รับทราบค่ะ'
      }),
    )
    await generateText({ model, system: `ลูกค้าเบอร์ ${PHONE}`, prompt: recorded })
    expectNoLeak(prompts, [PHONE])

    // Out: a reply holding the token posts its display form.
    await channel.adapter['message.completed'](
      { message: `ส่งไปที่ ${token} แล้ว` },
      {
        session: { id: 'wrun_C1' },
      },
    )
    expect(JSON.stringify(posted)).toContain('xxx-xxx-7777')
    expect(JSON.stringify(posted)).not.toMatch(TOKEN)

    expectNoLeak([w.audit, posted, calls], [PHONE, CARD, SESSION_KEY, HMAC_KEY])
    trails[name] = shape(w.audit)
  })
})

describe('the two runs', () => {
  it('leave the same audit trail', () => {
    expect(trails['0.1.0 API']?.length).toBeGreaterThan(4)
    expect(trails['pdpa.*']).toEqual(trails['0.1.0 API'])
  })
})
