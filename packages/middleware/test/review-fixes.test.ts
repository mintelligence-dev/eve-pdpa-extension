import { describe, expect, it } from 'vitest'
import {
  PRESETS,
  pdpaExpress,
  pdpaHono,
  protectBody,
  protectRequest,
  withPdpa,
} from '../src/index.js'
import { build, CARD, PHONE } from './helpers.js'

const at = (body: string, headers: Record<string, string> = {}) =>
  new Request('https://shop.test/chat', { method: 'POST', headers, body })

describe('a JSON body is read whatever its content type, unless it says otherwise', () => {
  it('fetch with a string body sends text/plain: still protected', async () => {
    const { guard } = build()
    const r = await protectRequest(at(JSON.stringify({ prompt: `เบอร์ ${PHONE}` })), { guard })
    expect(r.ok && (await r.request.json())).toEqual({ prompt: 'เบอร์ [เบอร์โทร]' })
  })

  it('no content type at all: still protected', async () => {
    const { guard } = build()
    const req = new Request('https://shop.test/chat', {
      method: 'POST',
      body: new Blob([JSON.stringify({ prompt: PHONE })]),
    })
    const r = await protectRequest(req, { guard })
    expect(r.ok && (await r.request.json())).toEqual({ prompt: '[เบอร์โทร]' })
  })

  it('a form is not read', async () => {
    const { guard } = build()
    const form = new FormData()
    form.set('prompt', PHONE)
    const req = new Request('https://shop.test/chat', { method: 'POST', body: form })
    expect(await protectRequest(req, { guard })).toEqual({ ok: true, request: req })
  })

  it('Express with express.text(): a JSON string is checked and stays a string', async () => {
    const { guard } = build()
    const req = { body: JSON.stringify({ prompt: `เบอร์ ${PHONE}` }) }
    await new Promise((resolve) =>
      pdpaExpress({ guard })(req, { status: () => ({}), json: () => ({}) } as never, resolve),
    )
    expect(req.body).toBe(JSON.stringify({ prompt: 'เบอร์ [เบอร์โทร]' }))
  })
})

describe('the shop’s own instructions are not read', () => {
  it('system and developer items are skipped', async () => {
    const { guard } = build()
    const r = await protectBody(
      {
        messages: [
          { role: 'system', content: `ร้านโทร ${PHONE}` },
          { role: 'developer', content: `เบอร์ร้าน ${PHONE}` },
          { role: 'user', content: `เบอร์ผม ${PHONE}` },
        ],
      },
      { guard },
    )
    expect(r.ok && r.body).toEqual({
      messages: [
        { role: 'system', content: `ร้านโทร ${PHONE}` },
        { role: 'developer', content: `เบอร์ร้าน ${PHONE}` },
        { role: 'user', content: 'เบอร์ผม [เบอร์โทร]' },
      ],
    })
  })
})

describe('more body shapes', () => {
  it('the OpenAI Responses API: input as a string and as items', async () => {
    const { guard } = build()
    const one = await protectBody({ input: `เบอร์ ${PHONE}` }, { guard })
    const many = await protectBody(
      { input: [{ role: 'user', content: [{ type: 'input_text', text: `เบอร์ ${PHONE}` }] }] },
      { guard },
    )
    expect(JSON.stringify([one, many])).not.toContain(PHONE)
  })

  it('a LINE webhook with the line preset', async () => {
    const { guard } = build()
    const r = await protectBody(
      { events: [{ type: 'message', message: { type: 'text', text: `เบอร์ ${PHONE}` } }] },
      { guard, fields: 'line' },
    )
    expect(JSON.stringify(r)).not.toContain(PHONE)
    expect(PRESETS.chat).not.toContain('events[].message.text')
  })
})

describe('nothing to protect: the request goes on byte for byte', () => {
  it('protectBody returns the same body, protectRequest the same Request', async () => {
    const { guard } = build()
    const body = { prompt: 'สวัสดีค่ะ' }
    const r = await protectBody(body, { guard })
    expect(r.ok && r.body).toBe(body)
    const req = at('{ "prompt" : "สวัสดีค่ะ" }', {
      'content-type': 'application/json',
      'x-line-signature': 'sig',
    })
    const out = await protectRequest(req, { guard })
    expect(out.ok && out.request).toBe(req)
  })
})

describe('blocked: which way it was going', () => {
  it('a blocked reply is 502 with boundary outbound; onBlocked is told', async () => {
    const { guard } = build({ CREDIT_CARD: { action: 'block' } })
    const POST = withPdpa(() => Response.json({ reply: `บัตร ${CARD}` }), {
      guard,
      responseFields: ['reply'],
    })
    const res = await POST(at(JSON.stringify({ prompt: 'สวัสดี' })))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      error: 'pdpa_blocked',
      boundary: 'outbound',
      blockedBy: ['CREDIT_CARD'],
    })

    const seen: string[] = []
    const custom = withPdpa(() => Response.json({ reply: `บัตร ${CARD}` }), {
      guard,
      responseFields: ['reply'],
      onBlocked: (_types, _req, boundary) => {
        seen.push(boundary)
        return new Response('ขออภัยค่ะ', { status: 200 })
      },
    })
    expect(await (await custom(at(JSON.stringify({ prompt: 'สวัสดี' })))).text()).toBe('ขออภัยค่ะ')
    expect(seen).toEqual(['outbound'])
  })

  it('Hono: a blocked reply replaces c.res', async () => {
    const { guard } = build({ CREDIT_CARD: { action: 'block' } })
    const c = { req: { raw: at(JSON.stringify({ prompt: 'สวัสดี' })) }, res: new Response(null) }
    await pdpaHono({ guard, responseFields: ['reply'] })(c, async () => {
      c.res = Response.json({ reply: `บัตร ${CARD}` })
    })
    expect(c.res.status).toBe(502)
  })
})

describe('withPdpa keeps the request class', () => {
  it('a Request subclass (as NextRequest is) stays that subclass', async () => {
    class NextLike extends Request {
      get nextUrl() {
        return new URL(this.url)
      }
    }
    const { guard } = build()
    let seen: unknown
    const POST = withPdpa(
      async (request: NextLike) => {
        seen = request
        return Response.json({ path: request.nextUrl.pathname })
      },
      { guard },
    )
    const res = await POST(
      new NextLike('https://shop.test/api/chat', {
        method: 'POST',
        body: JSON.stringify({ prompt: PHONE }),
      }),
    )
    expect(seen).toBeInstanceOf(NextLike)
    expect(await res.json()).toEqual({ path: '/api/chat' })
  })
})

describe('small things from the review', () => {
  it('a body that is an array: a path may start with []', async () => {
    const { guard } = build()
    const r = await protectBody([{ text: `เบอร์ ${PHONE}` }, { text: 'สวัสดี' }], {
      guard,
      fields: ['[].text'],
    })
    expect(r).toEqual({
      ok: true,
      changed: true,
      matched: 2,
      body: [{ text: 'เบอร์ [เบอร์โทร]' }, { text: 'สวัสดี' }],
    })
  })

  it('a name missing before a later [] is still an error', async () => {
    const { guard } = build()
    await expect(protectBody({ a: 1 }, { guard, fields: ['a.[]'] })).rejects.toThrow(/empty step/)
  })

  it('a path written twice is scanned once: one audit event', async () => {
    const { guard, events } = build()
    await protectBody({ prompt: `เบอร์ ${PHONE}` }, { guard, fields: ['prompt', 'prompt'] })
    expect(events.filter((e) => e.type === 'scan')).toHaveLength(1)
  })

  it('a request body over maxBytes: 413, handler not run', async () => {
    const { guard } = build()
    const big = JSON.stringify({ prompt: 'ก'.repeat(200) })
    const r = await protectRequest(at(big), { guard, maxBytes: 100 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.response.status).toBe(413)
  })

  it('a body over maxBytes with no content-length (chunked) is cut off too', async () => {
    const { guard } = build()
    const chunks = new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder()
        c.enqueue(enc.encode('{"prompt":"'))
        c.enqueue(enc.encode('x'.repeat(500)))
        c.enqueue(enc.encode('"}'))
        c.close()
      },
    })
    const request = new Request('https://shop.test/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: chunks,
      duplex: 'half',
    } as RequestInit)
    const r = await protectRequest(request, { guard, maxBytes: 100 })
    expect(r.ok === false && r.response.status).toBe(413)
  })

  it('a body under the default cap passes as before', async () => {
    const { guard } = build()
    const r = await protectRequest(at(JSON.stringify({ prompt: 'สวัสดี' })), { guard })
    expect(r.ok).toBe(true)
  })

  it('a reply labelled JSON that is not JSON: 502, not sent on', async () => {
    const { guard } = build()
    const wrapped = withPdpa(
      async () =>
        new Response(`โทร ${PHONE} นะคะ`, { headers: { 'content-type': 'application/json' } }),
      { guard, responseFields: ['reply'] },
    )
    const res = await wrapped(at(JSON.stringify({ prompt: 'x' })))
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain(PHONE)
  })

  it('a plain-text reply is passed as it is', async () => {
    const { guard } = build()
    const wrapped = withPdpa(async () => new Response('สวัสดี'), { guard, responseFields: ['reply'] })
    const res = await wrapped(at(JSON.stringify({ prompt: 'x' })))
    expect(await res.text()).toBe('สวัสดี')
  })
})
