// TK — tokens: sessions, purposes, TTL, resolve and its audit, endSession, randomSource.
//   bench/user/run features/tokens.check.mjs
import assert from 'node:assert/strict'
import { randomFillSync } from 'node:crypto'
import { check, expectCode, expectCodeAsync, makeGuard, schemaErrors, sleep } from '../lib/kit.mjs'

const TOK = /\[tok:([bcdfghjkmnpqrstv]{16})\]/
const PHONE_TOK = {
  action: 'tokenise',
  allowedPurposes: ['otp_send'],
  ttlSec: 300,
  display: 'mask',
}
const tokGuard = (rule = PHONE_TOK, opts) =>
  makeGuard(
    { entities: { PHONE: rule, EMAIL: { action: 'tokenise', allowedPurposes: ['send_receipt'] } } },
    opts,
  )
const tokenIn = (text) => `[tok:${TOK.exec(text)[1]}]`

check('TK1 README quick start: tokenise → resolve(otp_send) → "0918887777"', async () => {
  const { guard } = tokGuard()
  const inbound = await guard.process('เบอร์ ๐๙๑-๘๘๘-๗๗๗๗ ค่ะ', {
    sessionId: 'conv_8f2a',
    ref: 'msg_10293',
  })
  assert.match(inbound.text, /^เบอร์ \[tok:[bcdfghjkmnpqrstv]{16}\] ค่ะ$/)
  const token = `[tok:${inbound.findings[0]?.tokenId}]`
  const r = await guard.resolve(token, { purpose: 'otp_send', sessionId: 'conv_8f2a' })
  assert.deepEqual(r, { ok: true, value: '0918887777' })
})

check('TK2 a fresh random token each time (README quick start comment)', async (t) => {
  const { guard } = tokGuard({ ...PHONE_TOK, ttlSec: 1 })
  const id = (text, sessionId = 's') => guard.processSync(text, { sessionId }).findings[0].tokenId
  const a = id('เบอร์ 0918887777')
  const b = id('เบอร์ 0918887777')
  const c = id('เบอร์ 091-888-7777')
  const d = id('เบอร์ 0918887777', 'other-session')
  await sleep(1150)
  const e = id('เบอร์ 0918887777')
  t.diagnostic(
    `same value, same session: ${a === b ? 'SAME token' : 'new token'} · written with dashes: ${a === c ? 'SAME token' : 'new token'} · other session: ${a === d ? 'SAME token' : 'new token'} · after the first expired: ${a === e ? 'SAME token' : 'new token'}`,
  )
  assert.notEqual(a, b, 'the same value in the same session gets the same token again')
})

check('TK3 token format: [tok: + 16 of bcdfghjkmnpqrstv + ]', () => {
  const { guard } = tokGuard()
  for (let i = 0; i < 50; i++) {
    const r = guard.processSync('เบอร์ 0918887777', { sessionId: 's' })
    assert.match(r.findings[0].tokenId, /^[bcdfghjkmnpqrstv]{16}$/)
    assert.equal(r.text, `เบอร์ [tok:${r.findings[0].tokenId}]`)
  }
})

check(
  'TK4 sessionId is required by process, processSync, resolve, resolveSync and outbound when the policy tokenises',
  async () => {
    const { guard } = tokGuard()
    expectCode(() => guard.processSync('เบอร์ 0918887777'), 'ERR_PDPA_NO_SESSION')
    expectCode(() => guard.processSync('สวัสดีค่ะ ไม่มีเบอร์'), 'ERR_PDPA_NO_SESSION')
    expectCode(() => guard.processSync('ok', { boundary: 'outbound' }), 'ERR_PDPA_NO_SESSION')
    await expectCodeAsync(() => guard.process('เบอร์ 0918887777'), 'ERR_PDPA_NO_SESSION')
    const t = tokenIn(guard.processSync('เบอร์ 0918887777', { sessionId: 's' }).text)
    await expectCodeAsync(() => guard.resolve(t, { purpose: 'otp_send' }), 'ERR_PDPA_NO_SESSION')
    expectCode(() => guard.resolveSync(t, { purpose: 'otp_send' }), 'ERR_PDPA_NO_SESSION')
  },
)

check('TK5 a purpose not in allowedPurposes → purpose_not_allowed', async () => {
  const { guard } = tokGuard()
  const t = tokenIn(guard.processSync('เบอร์ 0918887777', { sessionId: 's' }).text)
  assert.deepEqual(await guard.resolve(t, { purpose: 'marketing', sessionId: 's' }), {
    ok: false,
    reason: 'purpose_not_allowed',
  })
  assert.deepEqual(
    await guard.resolve(t, { purpose: 'send_receipt', sessionId: 's' }),
    { ok: false, reason: 'purpose_not_allowed' },
    "another entity's purpose",
  )
})

check('TK6 another session asking for the token → session_mismatch', async () => {
  const { guard } = tokGuard()
  const t = tokenIn(guard.processSync('เบอร์ 0918887777', { sessionId: 'chat-A' }).text)
  assert.deepEqual(await guard.resolve(t, { purpose: 'otp_send', sessionId: 'chat-B' }), {
    ok: false,
    reason: 'session_mismatch',
  })
})

check('TK7 after ttlSec the token is expired', async () => {
  const { guard } = tokGuard({ ...PHONE_TOK, ttlSec: 1 })
  const t = tokenIn(guard.processSync('เบอร์ 0918887777', { sessionId: 's' }).text)
  assert.equal((await guard.resolve(t, { purpose: 'otp_send', sessionId: 's' })).ok, true)
  await sleep(1150)
  assert.deepEqual(await guard.resolve(t, { purpose: 'otp_send', sessionId: 's' }), {
    ok: false,
    reason: 'expired',
  })
})

check('TK8 an unknown token, or something that is not a token → not_found', async () => {
  const { guard } = tokGuard()
  for (const s of [
    '[tok:bbbbbbbbbbbbbbbb]',
    'bbbbbbbbbbbbbbbb',
    'hello',
    '0918887777',
    '[tok:abc]',
    '',
  ]) {
    assert.deepEqual(
      await guard.resolve(s, { purpose: 'otp_send', sessionId: 's' }),
      { ok: false, reason: 'not_found' },
      JSON.stringify(s),
    )
  }
})

check("TK9 endSession deletes the chat's tokens at once", async () => {
  const { guard } = tokGuard()
  const t = tokenIn(guard.processSync('เบอร์ 0918887777', { sessionId: 's' }).text)
  const other = tokenIn(guard.processSync('เบอร์ 0811111111', { sessionId: 'other' }).text)
  await guard.endSession('s')
  assert.deepEqual(await guard.resolve(t, { purpose: 'otp_send', sessionId: 's' }), {
    ok: false,
    reason: 'not_found',
  })
  assert.equal(
    (await guard.resolve(other, { purpose: 'otp_send', sessionId: 'other' })).ok,
    true,
    'other sessions keep theirs',
  )
})

check('TK10 resolveSync works with the default store', () => {
  const { guard } = tokGuard()
  const t = tokenIn(guard.processSync('เบอร์ 091-888-7777', { sessionId: 's' }).text)
  assert.deepEqual(guard.resolveSync(t, { purpose: 'otp_send', sessionId: 's' }), {
    ok: true,
    value: '0918887777',
  })
})

check(
  'TK11 one token.resolve event per attempt — purpose, caller, ref, outcome, reason; the string passed is never echoed',
  async () => {
    const { guard, resolves } = tokGuard()
    const t = tokenIn(guard.processSync('เบอร์ 0918887777', { sessionId: 's' }).text)
    await guard.resolve(t, {
      purpose: 'otp_send',
      sessionId: 's',
      caller: 'otp-tool',
      ref: 'call_1',
    })
    await guard.resolve(t, { purpose: 'marketing', sessionId: 's', caller: 'crm', ref: 'call_2' })
    await guard.resolve(t, { purpose: 'otp_send', sessionId: 'x', ref: 'call_3' })
    await guard.resolve('เบอร์ลูกค้า 0918887777', {
      purpose: 'otp_send',
      sessionId: 's',
      ref: 'call_4',
    })
    const ev = resolves()
    assert.equal(ev.length, 4)
    assert.deepEqual(
      ev.map((e) => [e.outcome, e.reason ?? null, e.purpose, e.caller, e.ref]),
      [
        ['allowed', null, 'otp_send', 'otp-tool', 'call_1'],
        ['denied', 'purpose_not_allowed', 'marketing', 'crm', 'call_2'],
        ['denied', 'session_mismatch', 'otp_send', null, 'call_3'],
        ['denied', 'not_found', 'otp_send', null, 'call_4'],
      ],
    )
    assert.equal(ev[0].entity, 'PHONE')
    assert.equal(ev[2].entity, null, 'session_mismatch carries no entity')
    assert.equal(ev[3].tokenId, null)
    for (const e of ev) {
      assert.deepEqual(schemaErrors(e), [])
      assert.ok(!JSON.stringify(e).includes('0918887777'), 'raw value in token.resolve')
    }
  },
)

check('TK12 ttlSec defaults to 300 and appears in the finding; 3600 is accepted', () => {
  const a = tokGuard({ action: 'tokenise', allowedPurposes: ['otp_send'] }).guard.processSync(
    'เบอร์ 0918887777',
    { sessionId: 's' },
  )
  assert.equal(a.findings[0].ttlSec, 300)
  assert.deepEqual(a.findings[0].allowedPurposes, ['otp_send'])
  const b = tokGuard({ ...PHONE_TOK, ttlSec: 3600 }).guard.processSync('เบอร์ 0918887777', {
    sessionId: 's',
  })
  assert.equal(b.findings[0].ttlSec, 3600)
})

check(
  'TK13 any purpose may be asked; only allowed ones succeed; every ask is recorded as named',
  async () => {
    const { guard, resolves } = tokGuard()
    const t = tokenIn(guard.processSync('เบอร์ 0918887777', { sessionId: 's' }).text)
    const r = await guard.resolve(t, { purpose: 'ส่งโปรโมชัน 🎉', sessionId: 's' })
    assert.deepEqual(r, { ok: false, reason: 'purpose_not_allowed' })
    assert.equal(resolves()[0].purpose, 'ส่งโปรโมชัน 🎉')
  },
)

check('TK14 tokens and resolve values for other formats (observed, not documented)', async (t) => {
  const { guard } = tokGuard()
  for (const text of [
    'เบอร์ +66 91 888 7777',
    'เบอร์ ０９１８８８７７７７',
    'เมล Somchai.K@Gmail.com',
  ]) {
    const res = guard.processSync(text, { sessionId: 's' })
    const purpose = res.findings[0].entity === 'EMAIL' ? 'send_receipt' : 'otp_send'
    const v = await guard.resolve(tokenIn(res.text), { purpose, sessionId: 's' })
    t.diagnostic(`${text} → resolve ${JSON.stringify(v)}`)
    assert.equal(v.ok, true)
  }
  const second = tokGuard().guard
  const tok = tokenIn(guard.processSync('เบอร์ 0918887777', { sessionId: 's' }).text)
  t.diagnostic(
    `a second guard asked for the first guard's token: ${JSON.stringify(await second.resolve(tok, { purpose: 'otp_send', sessionId: 's' }))}`,
  )
})

check('TK15 the randomSource given is the one used for token ids', () => {
  let calls = 0
  const fixed = (n) => {
    calls++
    return new Uint8Array(n).fill(7)
  }
  const a = tokGuard(PHONE_TOK, { randomSource: fixed }).guard.processSync('เบอร์ 0918887777', {
    sessionId: 's',
  }).findings[0].tokenId
  const b = tokGuard(PHONE_TOK, { randomSource: fixed }).guard.processSync('เบอร์ 0918887777', {
    sessionId: 's',
  }).findings[0].tokenId
  assert.ok(calls > 0, 'randomSource called')
  assert.equal(a, b, 'same bytes, same token id')
  const real = tokGuard(PHONE_TOK, {
    randomSource: (n) => randomFillSync(new Uint8Array(n)),
  }).guard.processSync('เบอร์ 0918887777', { sessionId: 's' })
  assert.match(real.findings[0].tokenId, /^[bcdfghjkmnpqrstv]{16}$/)
})
