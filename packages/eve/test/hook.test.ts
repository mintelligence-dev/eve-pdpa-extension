import { describe, expect, it, vi } from 'vitest'

// Session state outside eve: one slot per name, reset by each test. Inside eve
// this is defineState from eve/context; the probe in NOTES.md (run 2) showed
// an agent hook and an agent tool sharing it.
const slots = new Map<string, unknown>()
vi.mock('eve/context', () => ({
  defineState: (name: string, initial: () => unknown) => ({
    get: () => (slots.has(name) ? slots.get(name) : initial()),
    update: (fn: (v: unknown) => unknown) => {
      slots.set(name, fn(slots.has(name) ? slots.get(name) : initial()))
    },
  }),
}))

const { derivePdpaSessionId, guardContent, pdpaHook } = await import('../extension/lib/guard.js')
const { default: extension } = await import('../extension/extension.js')
const { default: extensionHook } = await import('../extension/hooks/pdpa.js')
const { configSchema } = await import('../extension/lib/config.js')
const { dashed, expectNoLeak, MASK, makeGuard, PHONE, SESSION_KEY, syntheticId, TOKEN } =
  await import('./helpers.js')

const ID = syntheticId(6)
const CARD = '4111 1111 1111 1111'

type Part = { type: 'text'; text: string } | { type: 'file'; mediaType: string; filename?: string }
type Handler = (event: unknown, ctx: unknown) => Promise<void>

/** An event and hook context, shaped as eve 0.80.1 passes them. */
function event(type: string, data: Record<string, unknown> = {}, token?: string) {
  const ctx = {
    cancel: vi.fn(),
    agent: { name: 'pdpa-agent' },
    channel: token === undefined ? { kind: 'http' } : { kind: 'http', continuationToken: token },
    session: { id: 'wrun_H1' },
  }
  return { event: { type, data, meta: { id: 'evt_1', at: '2026-10-20T00:00:00.000Z' } }, ctx }
}
const received = (message: string, parts?: Part[], token?: string) =>
  event(
    'message.received',
    { message, ...(parts ? { parts } : {}), sequence: 1, turnId: 'turn_1' },
    token,
  )
const on = (hook: { events?: Record<string, unknown> }, name: string) =>
  hook.events?.[name] as Handler

describe('pdpaHook', () => {
  it('cancels the turn once when the message holds data the policy blocks', async () => {
    slots.clear()
    const { guard } = makeGuard()
    const { event: e, ctx } = received(`บัตร ${CARD} ครับ`)
    await on(pdpaHook({ guard, sessionKey: SESSION_KEY }), 'message.received')(e, ctx)
    expect(ctx.cancel).toHaveBeenCalledOnce()
  })

  it('lets a clean or masked message run, and cancels on a type listed in blockOn', async () => {
    slots.clear()
    const { guard } = makeGuard(MASK)
    const hook = on(
      pdpaHook({ guard, sessionKey: SESSION_KEY, blockOn: ['TH_NATIONAL_ID'] }),
      'message.received',
    )
    const clean = received('สวัสดีค่ะ')
    await hook(clean.event, clean.ctx)
    expect(clean.ctx.cancel).not.toHaveBeenCalled()
    const id = received(`เลขบัตร ${dashed(ID)}`)
    await hook(id.event, id.ctx)
    expect(id.ctx.cancel).toHaveBeenCalledOnce()
  })

  it('reads text parts, and cancels a file under files: "block"', async () => {
    slots.clear()
    const { guard } = makeGuard()
    const parts = on(pdpaHook({ guard, sessionKey: SESSION_KEY }), 'message.received')
    const card = received('[file: a.png (image/png)]', [
      { type: 'text', text: `บัตร ${CARD}` },
      { type: 'file', mediaType: 'image/png', filename: 'a.png' },
    ])
    await parts(card.event, card.ctx)
    expect(card.ctx.cancel).toHaveBeenCalledOnce()
    const files = on(
      pdpaHook({ guard, sessionKey: SESSION_KEY, files: 'block' }),
      'message.received',
    )
    const pdf = received('ดูไฟล์', [{ type: 'file', mediaType: 'application/pdf' }])
    await files(pdf.event, pdf.ctx)
    expect(pdf.ctx.cancel).toHaveBeenCalledOnce()
  })

  it('stores the pdpa id from the continuation token, and keeps the first one', async () => {
    slots.clear()
    const { guard, audit } = makeGuard(MASK)
    const hook = on(pdpaHook({ guard, sessionKey: SESSION_KEY }), 'message.received')
    const first = received('สวัสดี', undefined, 'slack:C1:1800.1')
    await hook(first.event, first.ctx)
    const expected = await derivePdpaSessionId(SESSION_KEY, 'slack:C1:1800.1')
    expect(slots.get('eve-pdpa-extension.session')).toEqual({ id: expected })
    const aliased = received('อีกครั้ง', undefined, 'slack:C1:1800.2')
    await hook(aliased.event, aliased.ctx)
    expect(slots.get('eve-pdpa-extension.session')).toEqual({ id: expected })
    expect(audit.filter((e) => e.type === 'scan').map((e) => e.sessionId)).toEqual([
      expected,
      expected,
    ])
  })

  it('without an address, uses the eve session id — as the HTTP channel wrapper does', async () => {
    slots.clear()
    const { guard } = makeGuard(MASK)
    const { event: e, ctx } = received('สวัสดี')
    await on(pdpaHook({ guard, sessionKey: SESSION_KEY }), 'message.received')(e, ctx)
    expect(slots.get('eve-pdpa-extension.session')).toEqual({
      id: await derivePdpaSessionId(SESSION_KEY, 'session:wrun_H1'),
    })
  })

  it('ends the pdpa session when eve ends the session: its tokens stop resolving', async () => {
    for (const end of ['session.completed', 'session.failed']) {
      slots.clear()
      const { guard } = makeGuard()
      const hook = pdpaHook({ guard, sessionKey: SESSION_KEY })
      const first = received('สวัสดี', undefined, 'slack:C1:1800.1')
      await on(hook, 'message.received')(first.event, first.ctx)
      const sessionId = await derivePdpaSessionId(SESSION_KEY, 'slack:C1:1800.1')
      const out = await guardContent(`โทร ${PHONE}`, { guard, sessionId })
      if (out.blocked) throw new Error('unexpected block')
      const token = out.content.match(TOKEN)?.[0] ?? ''
      expect(await guard.resolve(token, { purpose: 'otp_send', sessionId })).toMatchObject({
        ok: true,
      })
      const done = event(end, {}, 'slack:C1:1800.1')
      await on(hook, end)(done.event, done.ctx)
      expect(await guard.resolve(token, { purpose: 'otp_send', sessionId })).toEqual({
        ok: false,
        reason: 'not_found',
      })
    }
  })

  it('audits every scan without a value or the key', async () => {
    slots.clear()
    const { guard, audit } = makeGuard()
    const { event: e, ctx } = received(`เลขบัตร ${dashed(ID)} โทร ${PHONE} บัตร ${CARD}`)
    await on(pdpaHook({ guard, sessionKey: SESSION_KEY }), 'message.received')(e, ctx)
    expect(audit.at(-1)).toMatchObject({ type: 'scan', outcome: 'blocked', boundary: 'inbound' })
    expectNoLeak(audit, [ID, PHONE, CARD, SESSION_KEY])
  })
})

describe('the extension', () => {
  const validate = (value: unknown) => configSchema['~standard'].validate(value)

  it('takes a guard and a session key, and names a wrong field without its value', () => {
    const { guard } = makeGuard()
    expect(validate({ guard, sessionKey: SESSION_KEY })).toEqual({
      value: { guard, sessionKey: SESSION_KEY },
    })
    const bad = validate({ guard: {}, sessionKey: 'short-secret', files: 'drop', polcy: 1 }) as {
      issues: { path: string[]; message: string }[]
    }
    expect(bad.issues.map((i) => i.path[0])).toEqual(['polcy', 'guard', 'sessionKey', 'files'])
    expectNoLeak(bad, ['short-secret'])
  })

  it('binds the mount config, and its hook reads it on the first message', async () => {
    slots.clear()
    const { guard, audit } = makeGuard()
    expect(() => extension({ guard: {} as never, sessionKey: SESSION_KEY })).toThrow(
      /^Invalid extension config: guard/,
    )
    extension({ guard, sessionKey: SESSION_KEY })
    const { event: e, ctx } = received(`บัตร ${CARD}`)
    await on(extensionHook, 'message.received')(e, ctx)
    expect(ctx.cancel).toHaveBeenCalledOnce()
    expect(audit.at(-1)).toMatchObject({ type: 'scan', outcome: 'blocked' })
  })
})
