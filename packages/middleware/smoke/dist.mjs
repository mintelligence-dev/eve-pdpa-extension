// Runtime-agnostic smoke test of the BUILT middleware. Runs on every Node
// major middleware's engines allow, on Deno, Bun and workerd, against dist/,
// not the source.
//
// Rules for this file, as for core's and http's smoke:
//   - no process, Buffer, Deno, Bun or any other host-specific global
//   - throw on failure; never call exit (miniflare inlines this file)
//   - ALL work happens inside run(), never at module top level
//   - nothing newer than Node 18.18 has
//
// What differs between runtimes is what middleware leans on: Request and
// Response (Response.json, clone, the body stream), structuredClone and the
// constructor of the Request it is handed. Each adapter goes through here once.

import { createGuard, definePolicy } from '@eve-pdpa-extension/core'
import * as mw from '../dist/index.js'

// Synthetic only, as every fixture: see fixtures/ATTESTATION.md.
const PHONE = '0812345678'
const CARD = '4111 1111 1111 1111'

function check(ok, what) {
  if (!ok) throw new Error(what)
}

const post = (body, init = {}) =>
  new Request('https://shop.example/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

export async function run() {
  const exports = ['protectBody', 'protectRequest', 'protectResponse', 'withPdpa', 'pdpaHono']
  for (const k of [...exports, 'pdpaExpress', 'PRESETS', 'createGuard', 'definePolicy']) {
    check(k in mw, `missing export: ${k}`)
  }

  const guard = createGuard({
    policy: definePolicy({
      entitySet: '0.1',
      entities: { PHONE: { action: 'mask' }, CREDIT_CARD: { action: 'block' } },
    }),
    onAudit: () => {},
  })
  const hidden = (text) => !text.includes(PHONE)

  // protectBody: parsed JSON in, protected copy out, input untouched.
  const input = { messages: [{ role: 'user', content: `โทร ${PHONE}` }] }
  const body = await mw.protectBody(input, { guard })
  check(body.ok && body.changed && body.matched === 1, 'protectBody: not protected')
  check(hidden(JSON.stringify(body.body)), 'protectBody: phone left in')
  check(input.messages[0].content.includes(PHONE), 'protectBody: changed its input')

  // protectRequest: a rebuilt Request when something changed, the same one when not.
  const req = await mw.protectRequest(post({ chatId: 'c1', prompt: `โทร ${PHONE}` }), {
    guard,
    sessionId: (_r, b) => b.chatId,
  })
  check(req.ok, 'protectRequest: blocked')
  check(hidden(await req.request.text()), 'protectRequest: phone left in')
  const plain = post({ prompt: 'สวัสดี' })
  const same = await mw.protectRequest(plain, { guard })
  check(same.ok && same.request === plain, 'protectRequest: rebuilt an unchanged request')

  // The answers it gives on its own: 422, 413, 400.
  const blocked = await mw.protectRequest(post({ prompt: CARD }), { guard })
  check(!blocked.ok && blocked.response.status === 422, 'blocked request is not 422')
  const large = await mw.protectRequest(post({ prompt: 'ก'.repeat(200) }), { guard, maxBytes: 100 })
  check(!large.ok && large.response.status === 413, 'long body is not 413')
  const broken = await mw.protectRequest(post('{"prompt":'), { guard })
  check(!broken.ok && broken.response.status === 400, 'broken JSON is not 400')

  // protectResponse: a JSON reply checked; one labelled JSON that is not, 502.
  const reply = await mw.protectResponse(Response.json({ reply: PHONE }), plain, {
    guard,
    responseFields: ['reply'],
  })
  check(hidden(await reply.text()), 'protectResponse: phone left in')
  const bad = new Response('{"reply":', { headers: { 'content-type': 'application/json' } })
  const badReply = await mw.protectResponse(bad, plain, { guard, responseFields: ['reply'] })
  check(badReply.status === 502, 'unreadable JSON reply is not 502')

  // withPdpa: the handler sees the protected body, the reply is checked.
  const POST = mw.withPdpa(
    async (r) => {
      const seen = await r.json()
      check(hidden(seen.prompt), 'withPdpa: handler saw the phone')
      return Response.json({ reply: `ได้รับเบอร์ ${PHONE}` })
    },
    { guard, responseFields: ['reply'] },
  )
  check(hidden(await (await POST(post({ prompt: PHONE }))).text()), 'withPdpa: reply not checked')

  // pdpaHono, with just the part of Hono's context it uses.
  const c = { req: { raw: post({ prompt: PHONE }) }, res: new Response(null) }
  await mw.pdpaHono({ guard, responseFields: ['reply'] })(c, async () => {
    check(hidden(await c.req.raw.text()), 'pdpaHono: handler saw the phone')
    c.res = Response.json({ reply: PHONE })
  })
  check(hidden(await c.res.text()), 'pdpaHono: reply not checked')

  // pdpaExpress, with just the parts of req and res it uses.
  const sent = []
  const res = {
    status: () => res,
    json: (b) => {
      sent.push(b)
      return res
    },
  }
  const expressReq = { body: { prompt: PHONE }, headers: { 'content-type': 'application/json' } }
  await new Promise((done, fail) =>
    mw.pdpaExpress({ guard, responseFields: ['reply'] })(expressReq, res, (e) =>
      e ? fail(e) : done(),
    ),
  )
  check(hidden(expressReq.body.prompt), 'pdpaExpress: handler saw the phone')
  res.json({ reply: PHONE })
  await new Promise((r) => setTimeout(r, 0))
  check(sent.length === 1 && hidden(JSON.stringify(sent[0])), 'pdpaExpress: reply not checked')

  return 'middleware smoke ok: protectBody · request · response · 422 · 413 · 400 · 502 · withPdpa · hono · express'
}
