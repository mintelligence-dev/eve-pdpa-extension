import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import {
  pdpaExpress,
  pdpaHono,
  protectBody,
  protectRequest,
  protectResponse,
  withPdpa,
} from '../src/index.js'
import { build, CARD, PHONE } from './helpers.js'

type Call = { boundary: string }

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

const reply = (body: unknown) => Response.json(body)

/** Just enough of Express's res to watch what is sent. */
function response() {
  const sent: { status: number; body: unknown }[] = []
  let status = 200
  const res = {
    status(code: number) {
      status = code
      return res
    },
    json(body: unknown) {
      sent.push({ status, body })
      return res
    },
  }
  return { res, sent }
}

/** Runs the middleware and waits for next (or its error). */
function run(mw: ReturnType<typeof pdpaExpress>, req: { body?: unknown }, res: object) {
  return new Promise<unknown>((resolve) => {
    mw(req, res as ReturnType<typeof response>['res'], (error?: unknown) =>
      resolve(error ?? 'next'),
    )
  })
}

describe('protectBody: matched', () => {
  it('counts the strings the fields reached', async () => {
    const { guard } = build()
    const r = await protectBody(
      { messages: [{ content: 'a' }, { content: 'b' }, { content: 3 }] },
      { guard, fields: ['messages[].content'] },
    )
    expect(r).toMatchObject({ ok: true, changed: false, matched: 2 })
  })

  it('0 when the fields fit no string, and the body comes back untouched', async () => {
    const { guard } = build()
    const body = { prompt: `เบอร์ ${PHONE}` }
    const r = await protectBody(body, { guard, fields: ['messages[].content'] })
    expect(r).toEqual({ ok: true, body, changed: false, matched: 0 })
    if (r.ok) expect(r.body).toBe(body)
  })

  it('a changed body still reports matched', async () => {
    const { guard } = build()
    const r = await protectBody({ prompt: `เบอร์ ${PHONE}` }, { guard })
    expect(r).toMatchObject({ ok: true, changed: true, matched: 1 })
  })
})

describe('onNoMatch: protectRequest', () => {
  it('called with the request and inbound; the request goes on as it was', async () => {
    const { guard } = build()
    const calls: [Request, string][] = []
    const request = json({ button: 'yes', n: 1 })
    const r = await protectRequest(request, {
      guard,
      onNoMatch: (input, boundary) => calls.push([input, boundary]),
    })
    expect(calls).toEqual([[request, 'inbound']])
    expect(r).toEqual({ ok: true, request })
  })

  it('not called when a string was reached', async () => {
    const { guard } = build()
    const calls: Call[] = []
    await protectRequest(json({ prompt: 'สวัสดี' }), {
      guard,
      onNoMatch: (_i, boundary) => calls.push({ boundary }),
    })
    expect(calls).toEqual([])
  })

  it('not called when the body is not JSON', async () => {
    const { guard } = build()
    const calls: Call[] = []
    const form = new Request('http://localhost/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `prompt=${PHONE}`,
    })
    const r = await protectRequest(form, {
      guard,
      onNoMatch: (_i, boundary) => calls.push({ boundary }),
    })
    expect(r.ok).toBe(true)
    expect(calls).toEqual([])
  })

  it('not called when the body was blocked', async () => {
    const { guard } = build({ CREDIT_CARD: { action: 'block' } })
    const calls: Call[] = []
    const r = await protectRequest(json({ prompt: `บัตร ${CARD}` }), {
      guard,
      onNoMatch: (_i, boundary) => calls.push({ boundary }),
    })
    expect(r.ok).toBe(false)
    expect(calls).toEqual([])
  })

  it('a throw rejects', async () => {
    const { guard } = build()
    await expect(
      protectRequest(json({ n: 1 }), {
        guard,
        onNoMatch: () => {
          throw new Error('log down')
        },
      }),
    ).rejects.toThrow('log down')
  })
})

describe('onNoMatch: protectResponse', () => {
  it('called with the request and outbound when responseFields reach nothing', async () => {
    const { guard } = build()
    const calls: [Request, string][] = []
    const request = json({ prompt: 'x' })
    const response = reply({ n: 1 })
    const out = await protectResponse(response, request, {
      guard,
      responseFields: ['reply'],
      onNoMatch: (input, boundary) => calls.push([input, boundary]),
    })
    expect(out).toBe(response)
    expect(calls).toEqual([[request, 'outbound']])
  })

  it('not called without responseFields, or when a string was reached', async () => {
    const { guard } = build()
    const calls: Call[] = []
    const onNoMatch = (_i: Request, boundary: string) => calls.push({ boundary })
    await protectResponse(reply({ n: 1 }), json({}), { guard, onNoMatch })
    await protectResponse(reply({ reply: 'สวัสดี' }), json({}), {
      guard,
      responseFields: ['reply'],
      onNoMatch,
    })
    expect(calls).toEqual([])
  })

  it('not called for a reply that is not JSON, or one that was blocked', async () => {
    const calls: Call[] = []
    const onNoMatch = (_i: Request, boundary: string) => calls.push({ boundary })
    const text = new Response('hello', { headers: { 'content-type': 'text/html' } })
    await protectResponse(text, json({}), {
      guard: build().guard,
      responseFields: ['reply'],
      onNoMatch,
    })
    const blocked = await protectResponse(reply({ reply: `บัตร ${CARD}` }), json({}), {
      guard: build({ CREDIT_CARD: { action: 'block' } }).guard,
      responseFields: ['reply'],
      onNoMatch,
    })
    expect(blocked.status).toBe(502)
    expect(calls).toEqual([])
  })

  it('a throw rejects', async () => {
    const { guard } = build()
    await expect(
      protectResponse(reply({ n: 1 }), json({}), {
        guard,
        responseFields: ['reply'],
        onNoMatch: () => {
          throw new Error('log down')
        },
      }),
    ).rejects.toThrow('log down')
  })
})

describe('onNoMatch: withPdpa', () => {
  it('called for the request and the reply, and the handler still runs', async () => {
    const { guard } = build()
    const calls: string[] = []
    let ran = false
    const handler = withPdpa(
      () => {
        ran = true
        return reply({ n: 1 })
      },
      { guard, responseFields: ['reply'], onNoMatch: (_i, boundary) => calls.push(boundary) },
    )
    const res = await handler(json({ n: 2 }))
    expect(res.status).toBe(200)
    expect(ran).toBe(true)
    expect(calls).toEqual(['inbound', 'outbound'])
  })

  it('a throw rejects and the handler does not run', async () => {
    const { guard } = build()
    let ran = false
    const handler = withPdpa(
      () => {
        ran = true
        return reply({})
      },
      {
        guard,
        onNoMatch: () => {
          throw new Error('log down')
        },
      },
    )
    await expect(handler(json({ n: 2 }))).rejects.toThrow('log down')
    expect(ran).toBe(false)
  })
})

describe('onNoMatch: pdpaHono (real Hono)', () => {
  const post = (app: Hono, body: unknown) =>
    app.request('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('called for the request and for c.json, and the reply goes out as it was', async () => {
    const { guard } = build()
    const calls: string[] = []
    const app = new Hono()
    app.post(
      '/chat',
      pdpaHono({ guard, responseFields: ['reply'], onNoMatch: (_i, b) => calls.push(b) }),
      (c) => c.json({ ok: true }),
    )
    const res = await post(app, { button: 'yes' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(calls).toEqual(['inbound', 'outbound'])
  })

  it('not called when a string was reached', async () => {
    const { guard } = build()
    const calls: string[] = []
    const app = new Hono()
    app.post('/chat', pdpaHono({ guard, onNoMatch: (_i, b) => calls.push(b) }), (c) =>
      c.json({ ok: true }),
    )
    await post(app, { prompt: 'สวัสดี' })
    expect(calls).toEqual([])
  })

  it('a throw is a 500 through app.onError and the handler does not run', async () => {
    const { guard } = build()
    const errors: Error[] = []
    let ran = false
    const app = new Hono()
    app.onError((e, c) => {
      errors.push(e)
      return c.text('error', 500)
    })
    app.post(
      '/chat',
      pdpaHono({
        guard,
        onNoMatch: () => {
          throw new Error('log down')
        },
      }),
      (c) => {
        ran = true
        return c.json({ ok: true })
      },
    )
    const res = await post(app, { button: 'yes' })
    expect(res.status).toBe(500)
    expect(errors[0]?.message).toBe('log down')
    expect(ran).toBe(false)
  })
})

describe('onNoMatch: pdpaExpress', () => {
  it('called with req and inbound, then next', async () => {
    const { guard } = build()
    const calls: [unknown, string][] = []
    const req = { body: { button: 'yes' } }
    const { res } = response()
    const mw = pdpaExpress({ guard, onNoMatch: (r, b) => calls.push([r, b]) })
    expect(await run(mw, req, res)).toBe('next')
    expect(calls).toEqual([[req, 'inbound']])
    expect(req.body).toEqual({ button: 'yes' })
  })

  it('not called when a string was reached, the body is not JSON, or it was blocked', async () => {
    const calls: string[] = []
    const onNoMatch = (_r: unknown, b: string) => calls.push(b)
    expect(
      await run(
        pdpaExpress({ guard: build().guard, onNoMatch }),
        { body: { prompt: 'x' } },
        response().res,
      ),
    ).toBe('next')
    expect(
      await run(
        pdpaExpress({ guard: build().guard, onNoMatch }),
        { headers: { 'content-type': 'text/plain' } },
        response().res,
      ),
    ).toBe('next')
    const blocked = response()
    const blockedRun = new Promise<void>((resolve) => {
      const json = blocked.res.json.bind(blocked.res)
      blocked.res.json = (b: unknown) => {
        json(b)
        resolve()
        return blocked.res
      }
    })
    pdpaExpress({ guard: build({ CREDIT_CARD: { action: 'block' } }).guard, onNoMatch })(
      { body: { prompt: `บัตร ${CARD}` } },
      blocked.res,
      () => {},
    )
    await blockedRun
    expect(calls).toEqual([])
  })

  it('called for a res.json reply that reaches nothing, which is still sent', async () => {
    const { guard } = build()
    const calls: [unknown, string][] = []
    const req = { body: { prompt: 'สวัสดี' } }
    const { res, sent } = response()
    const mw = pdpaExpress({
      guard,
      responseFields: ['reply'],
      onNoMatch: (r, b) => calls.push([r, b]),
    })
    await run(mw, req, res)
    await new Promise<void>((resolve) => {
      res.json({ n: 1 })
      setTimeout(resolve, 20)
    })
    expect(calls).toEqual([[req, 'outbound']])
    expect(sent.at(-1)).toEqual({ status: 200, body: { n: 1 } })
  })

  it('a throw goes to next(error)', async () => {
    const { guard } = build()
    const mw = pdpaExpress({
      guard,
      onNoMatch: () => {
        throw new Error('log down')
      },
    })
    expect(String(await run(mw, { body: { button: 'yes' } }, response().res))).toMatch(/log down/)
  })

  it('a throw on a reply goes to next(error) and the reply is not sent', async () => {
    const { guard } = build()
    const { res, sent } = response()
    const errors: unknown[] = []
    const mw = pdpaExpress({
      guard,
      responseFields: ['reply'],
      onNoMatch: (_r, b) => {
        if (b === 'outbound') throw new Error('log down')
      },
    })
    await new Promise<void>((resolve) => {
      mw({ body: { prompt: 'สวัสดี' } }, res, (e?: unknown) => {
        if (e !== undefined) {
          errors.push(e)
          resolve()
          return
        }
        res.json({ n: 1 })
      })
    })
    expect(String(errors[0])).toMatch(/log down/)
    expect(sent).toEqual([])
  })
})

describe('a body read before the middleware', () => {
  it('protectRequest throws a TypeError that says why', async () => {
    const { guard } = build()
    const request = json({ prompt: `เบอร์ ${PHONE}` })
    await request.text()
    await expect(protectRequest(request, { guard })).rejects.toThrow(TypeError)
    await expect(protectRequest(request, { guard })).rejects.toThrow(/before the middleware ran/)
  })

  it('protectResponse throws a TypeError naming the reply', async () => {
    const { guard } = build()
    const response = reply({ reply: PHONE })
    await response.text()
    const p = protectResponse(response, json({}), { guard, responseFields: ['reply'] })
    await expect(p).rejects.toThrow(TypeError)
    await expect(
      protectResponse(response, json({}), { guard, responseFields: ['reply'] }),
    ).rejects.toThrow(/reply body was read/)
  })

  it('protectResponse leaves a read reply alone when responseFields is not set', async () => {
    const { guard } = build()
    const response = reply({ reply: PHONE })
    await response.text()
    expect(await protectResponse(response, json({}), { guard })).toBe(response)
  })
})
