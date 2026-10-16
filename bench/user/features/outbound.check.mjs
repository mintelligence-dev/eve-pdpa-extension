// OB — outbound rendering of tokens and hashes, and what audit records about it.
//   bench/user/run features/outbound.check.mjs
import assert from 'node:assert/strict'
import { check, makeGuard, schemaErrors, sleep, strings } from '../lib/kit.mjs'

const TOK = /\[tok:([bcdfghjkmnpqrstv]{16})\]/
const rule = (extra = {}) => ({ action: 'tokenise', allowedPurposes: ['otp_send'], ...extra })
const g = (extra, top = {}) =>
  makeGuard({ entities: { PHONE: rule(extra), EMAIL: { action: 'hash' } }, ...top })
const tokenOf = (guard, text, sessionId = 's') =>
  `[tok:${TOK.exec(guard.processSync(text, { sessionId }).text)[1]}]`
const lastScan = (x) => x.scans().at(-1)

check(
  "OB1 this session's token → the value as typed, masked to the last four (README step 3)",
  async () => {
    const x = g()
    const token = tokenOf(x.guard, 'เบอร์ ๐๙๑-๘๘๘-๗๗๗๗ ค่ะ', 'conv_8f2a')
    const out = await x.guard.process(`ส่ง OTP ไปที่ ${token} แล้วค่ะ`, {
      sessionId: 'conv_8f2a',
      boundary: 'outbound',
    })
    assert.equal(out.text, 'ส่ง OTP ไปที่ xxx-xxx-๗๗๗๗ แล้วค่ะ')
    assert.deepEqual(lastScan(x).rendered, [
      { kind: 'token', tokenId: token.slice(5, -1), entity: 'PHONE', as: 'masked' },
    ])
  },
)

check('OB2 display: redact → the placeholder', () => {
  const x = g({ display: 'redact' })
  const token = tokenOf(x.guard, 'เบอร์ 0918887777')
  assert.equal(
    x.guard.processSync(`ส่งไปที่ ${token} แล้ว`, { sessionId: 's', boundary: 'outbound' }).text,
    'ส่งไปที่ [เบอร์โทร] แล้ว',
  )
  assert.deepEqual(lastScan(x).rendered, [
    { kind: 'token', tokenId: token.slice(5, -1), entity: 'PHONE', as: 'placeholder' },
  ])
})

check("OB3 another session's token → [ข้อมูลที่ปิดไว้], rendered foreign with entity null", () => {
  const x = g()
  const token = tokenOf(x.guard, 'เบอร์ 0918887777', 'chat-A')
  assert.equal(
    x.guard.processSync(`เบอร์คือ ${token}`, { sessionId: 'chat-B', boundary: 'outbound' }).text,
    'เบอร์คือ [ข้อมูลที่ปิดไว้]',
  )
  assert.deepEqual(lastScan(x).rendered, [
    { kind: 'token', tokenId: token.slice(5, -1), entity: null, as: 'foreign' },
  ])
})

check('OB4 a token in the right shape the guard does not hold → [ข้อมูลที่ปิดไว้], unknown', () => {
  const x = g()
  assert.equal(
    x.guard.processSync('ตามนี้ [tok:bbbbbbbbbbbbbbbb] นะคะ', {
      sessionId: 's',
      boundary: 'outbound',
    }).text,
    'ตามนี้ [ข้อมูลที่ปิดไว้] นะคะ',
  )
  assert.deepEqual(lastScan(x).rendered, [
    { kind: 'token', tokenId: 'bbbbbbbbbbbbbbbb', entity: null, as: 'unknown' },
  ])
})

check('OB5 an expired token → [ข้อมูลที่ปิดไว้], unknown', async () => {
  const x = g({ ttlSec: 1 })
  const token = tokenOf(x.guard, 'เบอร์ 0918887777')
  await sleep(1150)
  assert.equal(
    x.guard.processSync(`โทร ${token}`, { sessionId: 's', boundary: 'outbound' }).text,
    'โทร [ข้อมูลที่ปิดไว้]',
  )
  assert.equal(lastScan(x).rendered[0].as, 'unknown')
})

check('OB6 a token after endSession → [ข้อมูลที่ปิดไว้], unknown', async () => {
  const x = g()
  const token = tokenOf(x.guard, 'เบอร์ 0918887777')
  await x.guard.endSession('s')
  assert.equal(
    x.guard.processSync(`โทร ${token}`, { sessionId: 's', boundary: 'outbound' }).text,
    'โทร [ข้อมูลที่ปิดไว้]',
  )
  assert.equal(lastScan(x).rendered[0].as, 'unknown')
})

check('OB7 text that only resembles a token ([tok:abc]) is sent as written', () => {
  const x = g()
  for (const s of [
    '[tok:abc]',
    '[tok:BBBBBBBBBBBBBBBB]',
    '[tok:bbbbbbbbbbbbbbb]',
    '[ tok:bbbbbbbbbbbbbbbb ]',
  ]) {
    assert.equal(
      x.guard.processSync(`ดู ${s} ค่ะ`, { sessionId: 's', boundary: 'outbound' }).text,
      `ดู ${s} ค่ะ`,
    )
    assert.equal('rendered' in lastScan(x), false)
  }
})

check('OB8 a hash written into a reply → the placeholder, rendered kind hash', (t) => {
  const x = g()
  const hashed = x.guard
    .processSync('เมล somchai.k@gmail.example', { sessionId: 's' })
    .text.slice(4)
  assert.match(hashed, /^\[EMAIL:[a-z]{16}\]$/)
  assert.equal(
    x.guard.processSync(`ส่งใบเสร็จไปที่ ${hashed} แล้ว`, { sessionId: 's', boundary: 'outbound' }).text,
    'ส่งใบเสร็จไปที่ [อีเมล] แล้ว',
  )
  assert.deepEqual(lastScan(x).rendered, [{ kind: 'hash', entity: 'EMAIL', as: 'placeholder' }])
  const fake = x.guard.processSync('ส่งไป [PHONE:bbbbbbbbbbbbbbbb] แล้ว', {
    sessionId: 's',
    boundary: 'outbound',
  })
  t.diagnostic(
    `an invented hash in a reply: ${JSON.stringify(fake.text)} rendered ${JSON.stringify(lastScan(x).rendered)}`,
  )
})

check('OB9 rendered only on outbound, only when something was rewritten, in reading order', () => {
  const x = g()
  const t1 = tokenOf(x.guard, 'เบอร์ 0918887777')
  const t2 = tokenOf(x.guard, 'เบอร์ 0811111111')
  x.guard.processSync('ขอบคุณค่ะ', { sessionId: 's', boundary: 'outbound' })
  assert.equal('rendered' in lastScan(x), false)
  for (const boundary of ['inbound', 'prompt', 'tool_input', 'tool_output']) {
    x.guard.processSync(`เบอร์ ${t1}`, { sessionId: 's', boundary })
    assert.equal('rendered' in lastScan(x), false, boundary)
  }
  x.guard.processSync(`สองเบอร์ ${t2} และ [tok:bbbbbbbbbbbbbbbb] และ ${t1}`, {
    sessionId: 's',
    boundary: 'outbound',
  })
  assert.deepEqual(
    lastScan(x).rendered.map((r) => [r.tokenId, r.as]),
    [
      [t2.slice(5, -1), 'masked'],
      ['bbbbbbbbbbbbbbbb', 'unknown'],
      [t1.slice(5, -1), 'masked'],
    ],
  )
  for (const e of x.scans()) assert.deepEqual(schemaErrors(e), [])
})

check('OB10 neither the value nor the masked form appears in the audit event', () => {
  const x = g()
  const token = tokenOf(x.guard, 'เบอร์ ๐๙๑-๘๘๘-๗๗๗๗')
  x.guard.processSync(`ส่งไปที่ ${token}`, { sessionId: 's', boundary: 'outbound' })
  const all = strings(x.events).join('\n')
  for (const s of ['๐๙๑-๘๘๘-๗๗๗๗', '0918887777', 'xxx-xxx-๗๗๗๗', '๗๗๗๗', '7777'])
    assert.ok(!all.includes(s), `audit holds ${s}`)
})

check(
  'OB11 a raw value the model writes into a reply is protected, and the customer never sees a token',
  (t) => {
    const x = g()
    const out = x.guard.processSync('ได้เลยค่ะ จะโทรไปที่ 0918887777 นะคะ', {
      sessionId: 's',
      boundary: 'outbound',
    })
    t.diagnostic(`outbound with a raw phone under tokenise: ${JSON.stringify(out.text)}`)
    assert.ok(!out.text.includes('0918887777'), 'raw value reached the customer')
    assert.ok(!/\[tok:/.test(out.text), 'the customer sees a token')
  },
)

check('OB12 tokens at prompt, tool_input and tool_output are left as they are', () => {
  const x = g()
  const token = tokenOf(x.guard, 'เบอร์ 0918887777')
  for (const boundary of ['prompt', 'tool_input', 'tool_output']) {
    assert.equal(
      x.guard.processSync(`send_otp(${token})`, { sessionId: 's', boundary }).text,
      `send_otp(${token})`,
      boundary,
    )
  }
})

check(
  'OB13 the outbound placeholder for a hidden token in an English-placeholder policy (observed)',
  (t) => {
    const x = g({}, { placeholderLanguage: 'en' })
    const out = x.guard.processSync('see [tok:bbbbbbbbbbbbbbbb]', {
      sessionId: 's',
      boundary: 'outbound',
    })
    t.diagnostic(`placeholderLanguage en: ${JSON.stringify(out.text)}`)
    assert.ok(!out.text.includes('[tok:'))
  },
)
