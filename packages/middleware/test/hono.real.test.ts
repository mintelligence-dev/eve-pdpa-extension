import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { pdpaHono } from '../src/index.js'
import { build, CARD, PHONE, TOKENISE } from './helpers.js'

/** The real Hono, called through app.request(). No fake context. */
const post = (app: Hono, body: unknown, headers: Record<string, string> = {}) =>
  app.request('/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

describe('pdpaHono on real Hono', () => {
  it('c.req.json() in the handler returns the protected body', async () => {
    const { guard } = build()
    let seen: unknown
    const app = new Hono()
    app.post('/chat', pdpaHono({ guard }), async (c) => {
      seen = await c.req.json()
      return c.json({ ok: true })
    })
    const res = await post(app, { prompt: `เบอร์ ${PHONE}` })
    expect(res.status).toBe(200)
    expect(seen).toEqual({ prompt: 'เบอร์ [เบอร์โทร]' })
  })

  it('c.req.text() and a cloned read see it too', async () => {
    const { guard } = build()
    let seen = ''
    const app = new Hono()
    app.post('/chat', pdpaHono({ guard }), async (c) => {
      seen = await c.req.raw.clone().text()
      return c.json({ again: await c.req.json() })
    })
    const res = await post(app, { prompt: `เบอร์ ${PHONE}` })
    expect(JSON.parse(seen)).toEqual({ prompt: 'เบอร์ [เบอร์โทร]' })
    expect(await res.json()).toEqual({ again: { prompt: 'เบอร์ [เบอร์โทร]' } })
  })

  it('a body with nothing to protect reaches the handler unchanged', async () => {
    const { guard } = build()
    let seen: unknown
    const body = { chatId: 'c1', prompt: 'สวัสดีค่ะ มีของไหม', n: 3 }
    const app = new Hono()
    app.post('/chat', pdpaHono({ guard }), async (c) => {
      seen = await c.req.json()
      return c.json({ ok: true })
    })
    await post(app, body)
    expect(seen).toEqual(body)
  })

  it('blocked: 422 with the types, and the handler never runs', async () => {
    const { guard } = build({ CREDIT_CARD: { action: 'block' } })
    let ran = false
    const app = new Hono()
    app.post('/chat', pdpaHono({ guard }), (c) => {
      ran = true
      return c.json({ ok: true })
    })
    const res = await post(app, { prompt: `บัตร ${CARD}` })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: 'pdpa_blocked',
      boundary: 'inbound',
      blockedBy: ['CREDIT_CARD'],
    })
    expect(ran).toBe(false)
  })

  it('sessionId with a tokenise policy: one value, one token', async () => {
    const { guard } = build({ PHONE: TOKENISE })
    const seen: string[] = []
    const app = new Hono()
    app.post(
      '/chat',
      pdpaHono({ guard, sessionId: (req) => req.headers.get('x-chat-id') ?? undefined }),
      async (c) => {
        seen.push(((await c.req.json()) as { prompt: string }).prompt)
        return c.json({ ok: true })
      },
    )
    await post(app, { prompt: PHONE }, { 'x-chat-id': 'c1' })
    await post(app, { prompt: `อีกที ${PHONE}` }, { 'x-chat-id': 'c1' })
    const tokens = seen.map((t) => /\[tok:[a-z]+\]/.exec(t)?.[0])
    expect(tokens[0]).toBeDefined()
    expect(seen.join(' ')).not.toContain(PHONE)
    expect(tokens[1]).toBe(tokens[0])
  })

  it('context: an async lookup lets a bare account number be found', async () => {
    const { guard } = build()
    let seen: unknown
    const app = new Hono()
    app.post(
      '/chat',
      pdpaHono({
        guard,
        context: async (req) => {
          await new Promise((r) => setTimeout(r, 5))
          return req.headers.get('x-chat-id') === 'c1' ? 'ขอเลขบัญชีค่ะ' : undefined
        },
      }),
      async (c) => {
        seen = await c.req.json()
        return c.json({ ok: true })
      },
    )
    await post(app, { prompt: '123-4-56789-0' }, { 'x-chat-id': 'c1' })
    expect(seen).toEqual({ prompt: '[เลขบัญชี]' })
    await post(app, { prompt: '123-4-56789-0' }, { 'x-chat-id': 'c2' })
    expect(seen).toEqual({ prompt: '123-4-56789-0' })
  })

  it('responseFields: c.json is checked on the way out', async () => {
    const { guard } = build()
    const app = new Hono()
    app.post('/chat', pdpaHono({ guard, responseFields: ['reply'] }), (c) =>
      c.json({ reply: `ร้านจะโทรกลับที่ ${PHONE} ค่ะ` }),
    )
    const res = await post(app, { prompt: 'สวัสดี' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ reply: 'ร้านจะโทรกลับที่ [เบอร์โทร] ค่ะ' })
  })

  it('responseFields: a blocked reply is answered 502', async () => {
    const { guard } = build({ CREDIT_CARD: { action: 'block' } })
    const app = new Hono()
    app.post('/chat', pdpaHono({ guard, responseFields: ['reply'] }), (c) =>
      c.json({ reply: `บัตรคือ ${CARD}` }),
    )
    const res = await post(app, { prompt: 'สวัสดี' })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      error: 'pdpa_blocked',
      boundary: 'outbound',
      blockedBy: ['CREDIT_CARD'],
    })
  })

  it('without responseFields the reply goes out as the handler wrote it', async () => {
    const { guard } = build()
    const app = new Hono()
    app.post('/chat', pdpaHono({ guard }), (c) => c.json({ reply: PHONE }))
    expect(await (await post(app, { prompt: 'สวัสดี' })).json()).toEqual({ reply: PHONE })
  })

  it('JSON sent as text/plain is still protected', async () => {
    const { guard } = build()
    let seen: unknown
    const app = new Hono()
    app.post('/chat', pdpaHono({ guard }), async (c) => {
      seen = await c.req.json()
      return c.json({ ok: true })
    })
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ prompt: `เบอร์ ${PHONE}` }),
    })
    expect(res.status).toBe(200)
    expect(seen).toEqual({ prompt: 'เบอร์ [เบอร์โทร]' })
  })

  it('a form body is passed through untouched', async () => {
    const { guard } = build()
    let seen = ''
    const app = new Hono()
    app.post('/chat', pdpaHono({ guard }), async (c) => {
      seen = await c.req.text()
      return c.json({ ok: true })
    })
    await app.request('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `prompt=${PHONE}`,
    })
    expect(seen).toBe(`prompt=${PHONE}`)
  })

  it('order: before a body read, a later middleware and the handler both see the protected body', async () => {
    const { guard } = build()
    const seen: unknown[] = []
    const app = new Hono()
    app.use('/chat', pdpaHono({ guard }))
    app.use('/chat', async (c, next) => {
      seen.push(await c.req.json())
      await next()
    })
    app.post('/chat', async (c) => {
      seen.push(await c.req.json())
      return c.json({ ok: true })
    })
    await post(app, { prompt: `เบอร์ ${PHONE}` })
    expect(seen).toEqual([{ prompt: 'เบอร์ [เบอร์โทร]' }, { prompt: 'เบอร์ [เบอร์โทร]' }])
  })

  it('order: after a body read, the request fails (500), the handler never runs on the unprotected body', async () => {
    // Hono's c.req.json() consumes the stream, so pdpaHono cannot clone it:
    // a TypeError, which Hono answers 500. It fails closed, not silently open.
    const { guard } = build()
    const seen: unknown[] = []
    const errors: Error[] = []
    const app = new Hono()
    app.onError((error, c) => {
      errors.push(error)
      return c.text('error', 500)
    })
    app.use('/chat', async (c, next) => {
      await c.req.json()
      await next()
    })
    app.use('/chat', pdpaHono({ guard }))
    app.post('/chat', async (c) => {
      seen.push(await c.req.json())
      return c.json({ ok: true })
    })
    const res = await post(app, { prompt: `เบอร์ ${PHONE}` })
    expect(res.status).toBe(500)
    expect(seen).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('before the middleware')
  })
})
