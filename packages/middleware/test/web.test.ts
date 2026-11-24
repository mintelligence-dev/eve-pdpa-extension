import { describe, expect, it } from 'vitest'
import { pdpaHono, protectRequest, withPdpa } from '../src/index.js'
import { build, CARD, PHONE } from './helpers.js'

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://shop.test/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

describe('protectRequest', () => {
  it('a new Request with the text protected, headers kept', async () => {
    const { guard } = build()
    const r = await protectRequest(post({ prompt: `เบอร์ ${PHONE}` }, { 'x-chat-id': 'c1' }), {
      guard,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(await r.request.json()).toEqual({ prompt: 'เบอร์ [เบอร์โทร]' })
    expect(r.request.headers.get('x-chat-id')).toBe('c1')
    expect(r.request.method).toBe('POST')
  })

  it('blocked: 422 with the types', async () => {
    const { guard } = build({ CREDIT_CARD: { action: 'block' } })
    const r = await protectRequest(post({ prompt: `บัตร ${CARD}` }), { guard })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.response.status).toBe(422)
    expect(await r.response.json()).toEqual({
      error: 'pdpa_blocked',
      boundary: 'inbound',
      blockedBy: ['CREDIT_CARD'],
    })
  })

  it('onBlocked answers instead', async () => {
    const { guard } = build({ CREDIT_CARD: { action: 'block' } })
    const r = await protectRequest(post({ prompt: `บัตร ${CARD}` }), {
      guard,
      onBlocked: () => new Response('ขออภัย ไม่สามารถรับเลขบัตรได้', { status: 200 }),
    })
    if (r.ok) throw new Error('expected blocked')
    expect(await r.response.text()).toBe('ขออภัย ไม่สามารถรับเลขบัตรได้')
  })

  it('plain text that is not JSON: passed through; broken JSON: 400', async () => {
    const { guard } = build()
    const text = new Request('https://shop.test/x', { method: 'POST', body: `โทร ${PHONE}` })
    expect(await protectRequest(text, { guard })).toEqual({ ok: true, request: text })
    const broken = await protectRequest(post('{"prompt":'), { guard })
    expect(broken.ok === false && broken.response.status).toBe(400)
  })

  it('sessionId and ref read from the request reach audit', async () => {
    const { guard, events } = build()
    await protectRequest(post({ prompt: PHONE }, { 'x-chat-id': 'c1', 'x-msg-id': 'm1' }), {
      guard,
      sessionId: (req) => req.headers.get('x-chat-id') ?? undefined,
      ref: (req) => req.headers.get('x-msg-id') ?? undefined,
    })
    const scan = events.find((e) => e.type === 'scan')
    expect(scan?.type === 'scan' && [scan.sessionId, scan.ref]).toEqual(['c1', 'm1'])
  })
})

describe('withPdpa (Next.js route handler)', () => {
  it('the handler sees the protected body; a JSON reply is checked on the way out', async () => {
    const { guard } = build()
    let seen: unknown
    const POST = withPdpa(
      async (request: Request) => {
        seen = await request.json()
        return Response.json({ reply: `ร้านจะโทรกลับที่ ${PHONE} ค่ะ` })
      },
      { guard, responseFields: ['reply'] },
    )
    const res = await POST(post({ prompt: `เบอร์ ${PHONE}` }))
    expect(seen).toEqual({ prompt: 'เบอร์ [เบอร์โทร]' })
    expect(await res.json()).toEqual({ reply: 'ร้านจะโทรกลับที่ [เบอร์โทร] ค่ะ' })
  })

  it('no responseFields: the reply goes out as the handler wrote it', async () => {
    const { guard } = build()
    const POST = withPdpa(() => Response.json({ reply: PHONE }), { guard })
    expect(await (await POST(post({ prompt: 'สวัสดี' }))).json()).toEqual({ reply: PHONE })
  })

  it('blocked: the handler never runs', async () => {
    const { guard } = build({ CREDIT_CARD: { action: 'block' } })
    let ran = false
    const POST = withPdpa(
      () => {
        ran = true
        return new Response('ok')
      },
      { guard },
    )
    expect((await POST(post({ prompt: `บัตร ${CARD}` }))).status).toBe(422)
    expect(ran).toBe(false)
  })
})

describe('pdpaHono', () => {
  it('replaces the raw request before next, checks c.res after', async () => {
    const { guard } = build()
    const c = { req: { raw: post({ prompt: `เบอร์ ${PHONE}` }) }, res: new Response(null) }
    let seen: unknown
    const out = await pdpaHono({ guard, responseFields: ['reply'] })(c, async () => {
      seen = await c.req.raw.json()
      c.res = Response.json({ reply: `โทร ${PHONE}` })
    })
    expect(out).toBeUndefined()
    expect(seen).toEqual({ prompt: 'เบอร์ [เบอร์โทร]' })
    expect(await c.res.json()).toEqual({ reply: 'โทร [เบอร์โทร]' })
  })

  it('blocked: answers, next never runs', async () => {
    const { guard } = build({ CREDIT_CARD: { action: 'block' } })
    const c = { req: { raw: post({ prompt: `บัตร ${CARD}` }) }, res: new Response(null) }
    let ran = false
    const out = await pdpaHono({ guard })(c, async () => {
      ran = true
    })
    expect(out?.status).toBe(422)
    expect(ran).toBe(false)
  })
})

describe('context', () => {
  const ACCOUNT = '123-4-56789-0'

  it('protectRequest: an async lookup, given the parsed body, lets a bare reply be found', async () => {
    const { guard, events } = build()
    const asked = new Map([['U1', 'ขอเลขบัญชีค่ะ']])
    const seen: unknown[] = []
    const line = { events: [{ source: { userId: 'U1' }, message: { text: ACCOUNT } }] }
    const r = await protectRequest(post(line), {
      guard,
      fields: 'line',
      context: async (_request, body) => {
        seen.push(body)
        const b = body as typeof line
        return asked.get(b.events[0]?.source.userId ?? '')
      },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(seen).toEqual([line])
    expect(await r.request.json()).toEqual({
      events: [{ source: { userId: 'U1' }, message: { text: '[เลขบัญชี]' } }],
    })
    expect(JSON.stringify(events)).not.toContain('ขอเลขบัญชี')
  })

  it('without it the same reply passes, byte for byte', async () => {
    const { guard } = build()
    const request = post({ prompt: ACCOUNT })
    const r = await protectRequest(request, { guard })
    expect(r.ok && r.request).toBe(request)
  })

  it('a reply is checked without it', async () => {
    const { guard } = build()
    const handler = async () => Response.json({ reply: ACCOUNT })
    const wrapped = withPdpa(handler, {
      guard,
      responseFields: ['reply'],
      context: () => 'ขอเลขบัญชีค่ะ',
    })
    const res = await wrapped(post({ prompt: 'สวัสดี' }))
    expect(await res.json()).toEqual({ reply: ACCOUNT })
  })
})
