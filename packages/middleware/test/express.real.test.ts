import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express, { type ErrorRequestHandler, type Express } from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { pdpaExpress } from '../src/index.js'
import { build, CARD, PHONE, TOKENISE } from './helpers.js'

/** The real Express, on a real port, called with fetch. No fakes of req or res. */
const servers: Server[] = []

async function serve(app: Express): Promise<string> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  servers.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections()
          s.close(() => resolve())
        }),
    ),
  )
})

const postJson = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${url}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

/** An error handler that answers with what it was given, so a test can read it. */
const showError: ErrorRequestHandler = (error, _req, res, _next) => {
  res.status(500).json({ message: String((error as Error).message) })
}

describe('pdpaExpress on real Express', () => {
  it('the handler sees the body protected', async () => {
    const { guard } = build()
    let seen: unknown
    const app = express()
    app.post('/chat', express.json(), pdpaExpress({ guard }), (req, res) => {
      seen = req.body
      res.json({ ok: true })
    })
    const res = await postJson(await serve(app), { prompt: `เบอร์ ${PHONE}` })
    expect(res.status).toBe(200)
    expect(seen).toEqual({ prompt: 'เบอร์ [เบอร์โทร]' })
  })

  it('a body with nothing to protect reaches the handler unchanged', async () => {
    const { guard } = build()
    let seen: unknown
    const body = { chatId: 'c1', prompt: 'สวัสดีค่ะ มีของไหม', n: 3 }
    const app = express()
    app.post('/chat', express.json(), pdpaExpress({ guard }), (req, res) => {
      seen = req.body
      res.json({ ok: true })
    })
    await postJson(await serve(app), body)
    expect(seen).toEqual(body)
  })

  it('blocked: 422 with the types, and the handler never runs', async () => {
    const { guard } = build({ CREDIT_CARD: { action: 'block' } })
    let ran = false
    const app = express()
    app.post('/chat', express.json(), pdpaExpress({ guard }), (_req, res) => {
      ran = true
      res.json({ ok: true })
    })
    const res = await postJson(await serve(app), { prompt: `บัตร ${CARD}` })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: 'pdpa_blocked',
      boundary: 'inbound',
      blockedBy: ['CREDIT_CARD'],
    })
    expect(ran).toBe(false)
  })

  it('sessionId with a tokenise policy: one value, one token, kept apart by session', async () => {
    const { guard } = build({ PHONE: TOKENISE })
    const seen: string[] = []
    const app = express()
    app.post(
      '/chat',
      express.json(),
      pdpaExpress({ guard, sessionId: (req) => req.body.chatId }),
      (req, res) => {
        seen.push(req.body.prompt)
        res.json({ ok: true })
      },
    )
    const url = await serve(app)
    await postJson(url, { chatId: 'c1', prompt: PHONE })
    await postJson(url, { chatId: 'c1', prompt: `อีกที ${PHONE}` })
    await postJson(url, { chatId: 'c2', prompt: PHONE })
    const tokens = seen.map((t) => /\[tok:[a-z]+\]/.exec(t)?.[0])
    expect(tokens[0]).toBeDefined()
    expect(seen.join(' ')).not.toContain(PHONE)
    expect(tokens[1]).toBe(tokens[0])
  })

  it('context: an async lookup lets a bare account number be found', async () => {
    const { guard } = build()
    let seen: unknown
    const asked = new Map([['c1', 'ขอเลขบัญชีค่ะ']])
    const app = express()
    app.post(
      '/chat',
      express.json(),
      pdpaExpress({
        guard,
        context: async (req) => {
          await new Promise((r) => setTimeout(r, 5))
          return asked.get(req.body.chatId)
        },
      }),
      (req, res) => {
        seen = req.body
        res.json({ ok: true })
      },
    )
    const url = await serve(app)
    await postJson(url, { chatId: 'c1', prompt: '123-4-56789-0' })
    expect(seen).toEqual({ chatId: 'c1', prompt: '[เลขบัญชี]' })
    // another chat, nothing asked: the same digits are not taken for an account
    await postJson(url, { chatId: 'c2', prompt: '123-4-56789-0' })
    expect(seen).toEqual({ chatId: 'c2', prompt: '123-4-56789-0' })
  })

  it('responseFields: res.json is checked on the way out', async () => {
    const { guard } = build()
    const app = express()
    app.post(
      '/chat',
      express.json(),
      pdpaExpress({ guard, responseFields: ['reply'] }),
      (_req, res) => {
        res.json({ reply: `ร้านจะโทรกลับที่ ${PHONE} ค่ะ` })
      },
    )
    const res = await postJson(await serve(app), { prompt: 'สวัสดี' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ reply: 'ร้านจะโทรกลับที่ [เบอร์โทร] ค่ะ' })
  })

  it('responseFields: res.send with an object is checked too', async () => {
    const { guard } = build()
    const app = express()
    app.post(
      '/chat',
      express.json(),
      pdpaExpress({ guard, responseFields: ['reply'] }),
      (_req, res) => {
        res.send({ reply: `โทร ${PHONE}` })
      },
    )
    const res = await postJson(await serve(app), { prompt: 'สวัสดี' })
    expect(await res.json()).toEqual({ reply: 'โทร [เบอร์โทร]' })
  })

  it('responseFields: a blocked reply is answered 502', async () => {
    const { guard } = build({ CREDIT_CARD: { action: 'block' } })
    const app = express()
    app.post(
      '/chat',
      express.json(),
      pdpaExpress({ guard, responseFields: ['reply'] }),
      (_req, res) => {
        res.json({ reply: `บัตรคือ ${CARD}` })
      },
    )
    const res = await postJson(await serve(app), { prompt: 'สวัสดี' })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      error: 'pdpa_blocked',
      boundary: 'outbound',
      blockedBy: ['CREDIT_CARD'],
    })
  })

  it('without responseFields the reply goes out as the handler wrote it', async () => {
    const { guard } = build()
    const app = express()
    app.post('/chat', express.json(), pdpaExpress({ guard }), (_req, res) => {
      res.json({ reply: PHONE })
    })
    const res = await postJson(await serve(app), { prompt: 'สวัสดี' })
    expect(await res.json()).toEqual({ reply: PHONE })
  })

  it('express.json() missing: next(error) that says so, reaching the error handler', async () => {
    const { guard } = build()
    let ran = false
    const app = express()
    app.post('/chat', pdpaExpress({ guard }), (_req, res) => {
      ran = true
      res.json({ ok: true })
    })
    app.use(showError)
    const res = await postJson(await serve(app), { prompt: `เบอร์ ${PHONE}` })
    expect(res.status).toBe(500)
    expect(((await res.json()) as { message: string }).message).toMatch(/express\.json\(\)/)
    expect(ran).toBe(false)
  })

  it('express.text() with a JSON string: still protected, still a string', async () => {
    const { guard } = build()
    let seen: unknown
    const app = express()
    app.post('/chat', express.text({ type: '*/*' }), pdpaExpress({ guard }), (req, res) => {
      seen = req.body
      res.json({ ok: true })
    })
    const res = await fetch(`${await serve(app)}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ prompt: `เบอร์ ${PHONE}` }),
    })
    expect(res.status).toBe(200)
    expect(typeof seen).toBe('string')
    expect(JSON.parse(seen as string)).toEqual({ prompt: 'เบอร์ [เบอร์โทร]' })
  })

  it('express.text() with plain text that is not JSON: passed through', async () => {
    const { guard } = build()
    let seen: unknown
    const app = express()
    app.post('/chat', express.text({ type: '*/*' }), pdpaExpress({ guard }), (req, res) => {
      seen = req.body
      res.json({ ok: true })
    })
    await fetch(`${await serve(app)}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'สวัสดีค่ะ',
    })
    expect(seen).toBe('สวัสดีค่ะ')
  })

  it('a context lookup that fails reaches the real error handler', async () => {
    const { guard } = build()
    let ran = false
    const app = express()
    app.post(
      '/chat',
      express.json(),
      pdpaExpress({
        guard,
        context: async () => {
          throw new Error('store down')
        },
      }),
      (_req, res) => {
        ran = true
        res.json({ ok: true })
      },
    )
    app.use(showError)
    const res = await postJson(await serve(app), { prompt: 'x' })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ message: 'store down' })
    expect(ran).toBe(false)
  })
})
