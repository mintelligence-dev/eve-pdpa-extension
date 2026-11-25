import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { pdpaExpress, pdpaHono, protectRequest, protectResponse, withPdpa } from '../src/index.js'
import { build, PHONE } from './helpers.js'

const post = (body: unknown) =>
  new Request('http://localhost/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

type Body = { chatId?: string; msgId?: string } | undefined
const fromBody = {
  sessionId: (_: unknown, body: unknown) => (body as Body)?.chatId,
  ref: (_: unknown, body: unknown) => (body as Body)?.msgId,
}

/** sessionId and ref of every audit event, in order, with its boundary. */
const scopes = (events: ReturnType<typeof build>['events']) =>
  events
    .filter((e) => e.type === 'scan')
    .map((e) => (e.type === 'scan' ? [e.boundary, e.sessionId, e.ref] : []))

describe('sessionId and ref are given the body read as JSON', () => {
  it('protectRequest: the chat id in the body reaches audit', async () => {
    const { guard, events } = build()
    await protectRequest(post({ chatId: 'c1', msgId: 'm1', prompt: PHONE }), { guard, ...fromBody })
    expect(scopes(events)).toEqual([['inbound', 'c1', 'm1']])
  })

  it('the body given is the one sent, before anything in it is protected', async () => {
    const { guard } = build()
    let seen: unknown
    await protectRequest(post({ chatId: 'c1', prompt: PHONE }), {
      guard,
      sessionId: (_, body) => {
        seen = body
        return 'c1'
      },
    })
    expect(seen).toEqual({ chatId: 'c1', prompt: PHONE })
  })

  it('withPdpa: the reply is checked in the session read from the request body', async () => {
    const { guard, events } = build()
    const POST = withPdpa(
      async (req: Request) => {
        await req.json() // the handler reads the body: it cannot be read again after
        return Response.json({ reply: `โทร ${PHONE}` })
      },
      { guard, responseFields: ['reply'], ...fromBody },
    )
    await POST(post({ chatId: 'c1', msgId: 'm1', prompt: PHONE }))
    expect(scopes(events)).toEqual([
      ['inbound', 'c1', 'm1'],
      ['outbound', 'c1', 'm1'],
    ])
  })

  it('withPdpa: the same when the request had nothing to protect', async () => {
    const { guard, events } = build()
    const POST = withPdpa(async () => Response.json({ reply: `โทร ${PHONE}` }), {
      guard,
      responseFields: ['reply'],
      ...fromBody,
    })
    await POST(post({ chatId: 'c1', msgId: 'm1', prompt: 'สวัสดี' }))
    expect(scopes(events).at(-1)).toEqual(['outbound', 'c1', 'm1'])
  })

  it('protectResponse finds the body with another options object, as the README writes it', async () => {
    const { guard, events } = build()
    const r = await protectRequest(post({ chatId: 'c1', prompt: PHONE }), { guard, ...fromBody })
    if (!r.ok) throw new Error('blocked')
    await protectResponse(Response.json({ reply: PHONE }), r.request, {
      guard,
      responseFields: ['reply'],
      ...fromBody,
    })
    expect(scopes(events).map((s) => s[1])).toEqual(['c1', 'c1'])
  })

  it('protectResponse on a request never read gives sessionId no body', async () => {
    const { guard } = build()
    const given: unknown[] = []
    await protectResponse(Response.json({ reply: PHONE }), post({ chatId: 'c1' }), {
      guard,
      responseFields: ['reply'],
      sessionId: (_, body) => {
        given.push(body)
        return undefined
      },
    })
    expect(given).toEqual([undefined])
  })

  it('Hono: the chat id in the body, in and out', async () => {
    const { guard, events } = build()
    const app = new Hono()
    app.post('/chat', pdpaHono({ guard, responseFields: ['reply'], ...fromBody }), async (c) => {
      const body = await c.req.json()
      return c.json({ reply: `ได้รับ ${body.prompt}` })
    })
    await app.request(post({ chatId: 'c1', msgId: 'm1', prompt: PHONE }))
    expect(scopes(events)).toEqual([
      ['inbound', 'c1', 'm1'],
      ['outbound', 'c1', 'm1'],
    ])
  })

  it('Express: given the parsed body, and the same for the reply', async () => {
    const { guard, events } = build()
    const mw = pdpaExpress({ guard, responseFields: ['reply'], ...fromBody })
    const sent: unknown[] = []
    const res = {
      status: () => res,
      json: (b: unknown) => {
        sent.push(b)
        return res
      },
    }
    await new Promise<void>((done) =>
      mw({ body: { chatId: 'c1', msgId: 'm1', prompt: PHONE } }, res, () => done()),
    )
    res.json({ reply: PHONE })
    await new Promise((r) => setTimeout(r, 0))
    expect(scopes(events)).toEqual([
      ['inbound', 'c1', 'm1'],
      ['outbound', 'c1', 'm1'],
    ])
  })

  it('a sessionId that takes only the request still works', async () => {
    const { guard, events } = build()
    await protectRequest(post({ prompt: PHONE }), { guard, sessionId: () => 'c9' })
    expect(scopes(events)[0]?.[1]).toBe('c9')
  })
})

describe('a bad preset or path fails when the middleware is created', () => {
  const { guard } = build()
  const bad = [
    ['an unknown preset', { fields: 'opeani' as never }],
    ['an empty step', { fields: ['messages..content'] }],
    ['a bad reply path', { responseFields: ['reply.'] }],
  ] as const

  for (const [what, options] of bad) {
    it(`${what}: pdpaExpress, pdpaHono and withPdpa all throw at once`, () => {
      expect(() => pdpaExpress({ guard, ...options })).toThrow(TypeError)
      expect(() => pdpaHono({ guard, ...options })).toThrow(TypeError)
      expect(() => withPdpa(async () => new Response(), { guard, ...options })).toThrow(TypeError)
    })
  }

  it('good paths, presets and no fields at all do not throw', () => {
    for (const fields of [undefined, 'chat', 'line', ['[].text', '*.msg', 'a[].b']] as const) {
      expect(() => pdpaExpress({ guard, ...(fields ? { fields } : {}) })).not.toThrow()
      expect(() => pdpaHono({ guard, ...(fields ? { fields } : {}) })).not.toThrow()
    }
  })
})
