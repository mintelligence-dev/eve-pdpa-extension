import { describe, expect, it } from 'vitest'
import { pdpaExpress } from '../src/index.js'
import { build, CARD, PHONE } from './helpers.js'

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

/** Runs the middleware and waits for next or a reply. */
function run(
  mw: ReturnType<typeof pdpaExpress>,
  req: { body?: unknown },
  res: ReturnType<typeof response>['res'],
) {
  return new Promise<unknown>((resolve) => {
    const json = res.json.bind(res)
    res.json = (b: unknown) => {
      json(b)
      resolve('replied')
      return res
    }
    mw(req, res, (error?: unknown) => resolve(error ?? 'next'))
  })
}

describe('pdpaExpress', () => {
  it('replaces req.body, then next', async () => {
    const { guard } = build()
    const req = { body: { prompt: `เบอร์ ${PHONE}` } }
    const { res } = response()
    expect(await run(pdpaExpress({ guard }), req, res)).toBe('next')
    expect(req.body).toEqual({ prompt: 'เบอร์ [เบอร์โทร]' })
  })

  it('blocked: 422 with the types, no next', async () => {
    const { guard } = build({ CREDIT_CARD: { action: 'block' } })
    const { res, sent } = response()
    expect(await run(pdpaExpress({ guard }), { body: { prompt: `บัตร ${CARD}` } }, res)).toBe(
      'replied',
    )
    expect(sent).toEqual([
      {
        status: 422,
        body: { error: 'pdpa_blocked', boundary: 'inbound', blockedBy: ['CREDIT_CARD'] },
      },
    ])
  })

  it('a JSON request with no body parser: an error that says so', async () => {
    const { guard } = build()
    const { res } = response()
    const req = { headers: { 'content-type': 'application/json' } }
    const error = await run(pdpaExpress({ guard }), req, res)
    expect(String(error)).toMatch(/express\.json\(\)/)
  })

  it('a body that is not JSON is passed through, as protectRequest does', async () => {
    const { guard } = build()
    const { res } = response()
    const req = { headers: { 'content-type': 'text/plain' } }
    expect(await run(pdpaExpress({ guard }), req, res)).toBe('next')
  })

  it('context: read from req, may be async', async () => {
    const { guard } = build()
    const req = { body: { chatId: 'c1', prompt: '123-4-56789-0' } }
    const { res } = response()
    const mw = pdpaExpress({
      guard,
      context: async (r: typeof req) => (r.body.chatId === 'c1' ? 'ขอเลขบัญชีค่ะ' : undefined),
    })
    expect(await run(mw, req, res)).toBe('next')
    expect(req.body).toEqual({ chatId: 'c1', prompt: '[เลขบัญชี]' })
  })

  it('a context lookup that fails goes to next(error)', async () => {
    const { guard } = build()
    const { res } = response()
    const mw = pdpaExpress({
      guard,
      context: async () => {
        throw new Error('store down')
      },
    })
    expect(String(await run(mw, { body: { prompt: 'x' } }, res))).toMatch(/store down/)
  })

  it('with responseFields, res.json is checked on the way out', async () => {
    const { guard } = build()
    const { res, sent } = response()
    await run(pdpaExpress({ guard, responseFields: ['reply'] }), { body: { prompt: 'สวัสดี' } }, res)
    await new Promise<void>((resolve) => {
      res.json({ reply: `โทร ${PHONE}` })
      setTimeout(resolve, 20)
    })
    expect(sent.at(-1)).toEqual({ status: 200, body: { reply: 'โทร [เบอร์โทร]' } })
  })
})
