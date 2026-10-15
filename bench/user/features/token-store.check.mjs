// TS — token stores: a custom async store, a failing store, and the memory store's limits.
//   bench/user/run features/token-store.check.mjs
import assert from 'node:assert/strict'
import { createGuard, createMemoryTokenStore, definePolicy } from '@eve-pdpa-extension/core'
import { check, expectCode, expectCodeAsync, makeGuard, sleep, strings } from '../lib/kit.mjs'

const TOK = /\[tok:([bcdfghjkmnpqrstv]{16})\]/
const tokenise = { PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'] } }

/** An async store backed by a Map — what a shared store looks like from the guard's side. */
function asyncStore() {
  const map = new Map()
  const calls = []
  return {
    map,
    calls,
    sync: false,
    async set(id, rec) {
      calls.push(['set', id, rec])
      map.set(id, rec)
    },
    async get(id) {
      calls.push(['get', id])
      return map.get(id)
    },
    async delete(id) {
      calls.push(['delete', id])
      map.delete(id)
    },
    async clearSession(sessionId) {
      calls.push(['clearSession', sessionId])
      for (const [k, v] of map) if (v.sessionId === sessionId) map.delete(k)
    },
  }
}

check(
  'TS1 a custom async store: process tokenises, resolve works, endSession calls clearSession',
  async () => {
    const store = asyncStore()
    const { guard } = makeGuard({ entities: tokenise }, { tokenStore: store })
    const r = await guard.process('เบอร์ 0918887777', { sessionId: 's' })
    const token = `[tok:${TOK.exec(r.text)[1]}]`
    assert.deepEqual(await guard.resolve(token, { purpose: 'otp_send', sessionId: 's' }), {
      ok: true,
      value: '0918887777',
    })
    const ended = guard.endSession('s')
    assert.ok(ended instanceof Promise, 'endSession returns a Promise with an async store')
    await ended
    assert.ok(store.calls.some(([op, s]) => op === 'clearSession' && s === 's'))
    assert.deepEqual(await guard.resolve(token, { purpose: 'otp_send', sessionId: 's' }), {
      ok: false,
      reason: 'not_found',
    })
  },
)

check(
  'TS2 an async store under a tokenising policy: processSync and resolveSync throw ERR_PDPA_ASYNC_STORE',
  () => {
    const { guard } = makeGuard({ entities: tokenise }, { tokenStore: asyncStore() })
    expectCode(
      () => guard.processSync('เบอร์ 0918887777', { sessionId: 's' }),
      'ERR_PDPA_ASYNC_STORE',
    )
    expectCode(
      () => guard.resolveSync('[tok:bbbbbbbbbbbbbbbb]', { purpose: 'otp_send', sessionId: 's' }),
      'ERR_PDPA_ASYNC_STORE',
    )
  },
)

check('TS3 an async store under a policy without tokenise: processSync works', () => {
  const { guard } = makeGuard(
    { entities: { PHONE: { action: 'redact' } } },
    { tokenStore: asyncStore() },
  )
  assert.equal(guard.processSync('เบอร์ 0918887777').text, 'เบอร์ [เบอร์โทร]')
})

check(
  'TS4 the TokenRecord a store receives: value, entity, sessionId, purposes, expiresAt in ms, a masked display',
  async (t) => {
    const store = asyncStore()
    const { guard } = makeGuard(
      {
        entities: {
          PHONE: { action: 'tokenise', allowedPurposes: ['otp_send', 'callback'], ttlSec: 300 },
        },
      },
      { tokenStore: store },
    )
    const before = Date.now()
    await guard.process('เบอร์ ๐๙๑-๘๘๘-๗๗๗๗', { sessionId: 'conv_1' })
    const [, , rec] = store.calls.find(([op]) => op === 'set')
    t.diagnostic(JSON.stringify(rec))
    assert.equal(rec.value, '0918887777')
    assert.equal(rec.entity, 'PHONE')
    assert.equal(rec.sessionId, 'conv_1')
    assert.deepEqual([...rec.purposes], ['otp_send', 'callback'])
    assert.ok(
      rec.expiresAt >= before + 299_000 && rec.expiresAt <= Date.now() + 301_000,
      `expiresAt ${rec.expiresAt}`,
    )
    assert.equal(rec.display, 'xxx-xxx-๗๗๗๗')
    const store2 = asyncStore()
    await makeGuard(
      { entities: { PHONE: { action: 'tokenise', allowedPurposes: ['p'], display: 'redact' } } },
      { tokenStore: store2 },
    ).guard.process('เบอร์ 0918887777', { sessionId: 's' })
    assert.equal('display' in store2.calls.find(([op]) => op === 'set')[2], false)
  },
)

const failing = (mode) => ({
  sync: mode === 'sync',
  set() {
    if (mode === 'sync') throw new Error('store down')
    return Promise.reject(new Error('store down'))
  },
  get() {
    if (mode === 'sync') throw new Error('store down')
    return Promise.reject(new Error('store down'))
  },
  delete() {},
  clearSession() {},
})

check(
  'TS5 set fails → message blocked, finding failed: token_store, no token, no throw, onError, tokenStoreErrors +1',
  () => {
    const { guard, errors, scans } = makeGuard(
      { entities: tokenise },
      { tokenStore: failing('sync') },
    )
    const r = guard.processSync('เบอร์ 0918887777', { sessionId: 's' })
    assert.deepEqual([r.text, r.outcome, r.blockedBy], ['', 'blocked', ['PHONE']])
    const f = r.findings[0]
    assert.deepEqual([f.failed, f.action, f.tokenId], ['token_store', 'tokenise', undefined])
    assert.equal(scans()[0].findings[0].failed, 'token_store')
    assert.equal(guard.stats.tokenStoreErrors, 1)
    assert.deepEqual(
      errors.map((e) => ({ ...e.ctx })),
      [{ source: 'token_store', eventType: 'scan' }],
    )
  },
)

check(
  'TS6 get fails → resolve gives store_unavailable, audited like any other attempt',
  async () => {
    const { guard, errors, resolves } = makeGuard(
      { entities: tokenise },
      { tokenStore: failing('sync') },
    )
    assert.deepEqual(
      await guard.resolve('[tok:bbbbbbbbbbbbbbbb]', { purpose: 'otp_send', sessionId: 's' }),
      { ok: false, reason: 'store_unavailable' },
    )
    assert.deepEqual([resolves()[0].outcome, resolves()[0].reason], ['denied', 'store_unavailable'])
    assert.equal(guard.stats.tokenStoreErrors, 1)
    assert.deepEqual({ ...errors[0].ctx }, { source: 'token_store', eventType: 'token.resolve' })
  },
)

check('TS7 get fails during an outbound reply → [ข้อมูลที่ปิดไว้], rendered unavailable', () => {
  const { guard, scans } = makeGuard({ entities: tokenise }, { tokenStore: failing('sync') })
  const r = guard.processSync('เบอร์ [tok:bbbbbbbbbbbbbbbb] ค่ะ', {
    sessionId: 's',
    boundary: 'outbound',
  })
  assert.equal(r.text, 'เบอร์ [ข้อมูลที่ปิดไว้] ค่ะ')
  assert.deepEqual(scans()[0].rendered, [
    { kind: 'token', tokenId: 'bbbbbbbbbbbbbbbb', entity: null, as: 'unavailable' },
  ])
  assert.equal(guard.stats.tokenStoreErrors, 1)
})

check('TS8 a store that rejects behaves like one that throws', async () => {
  const { guard } = makeGuard({ entities: tokenise }, { tokenStore: failing('async') })
  const r = await guard.process('เบอร์ 0918887777', { sessionId: 's' })
  assert.deepEqual([r.text, r.outcome, r.findings[0].failed], ['', 'blocked', 'token_store'])
  assert.deepEqual(
    await guard.resolve('[tok:bbbbbbbbbbbbbbbb]', { purpose: 'otp_send', sessionId: 's' }),
    { ok: false, reason: 'store_unavailable' },
  )
  assert.equal(guard.stats.tokenStoreErrors, 2)
})

check(
  'TS9 the memory store with maxTokens refuses new tokens when full and never evicts a live one',
  async () => {
    const { guard } = makeGuard(
      { entities: tokenise },
      { tokenStore: createMemoryTokenStore({ maxTokens: 2 }) },
    )
    const t1 = TOK.exec(guard.processSync('เบอร์ 0811111111', { sessionId: 's' }).text)[0]
    guard.processSync('เบอร์ 0822222222', { sessionId: 's' })
    const third = guard.processSync('เบอร์ 0833333333', { sessionId: 's' })
    assert.deepEqual([third.outcome, third.findings[0].failed], ['blocked', 'token_store'])
    assert.equal((await guard.resolve(t1, { purpose: 'otp_send', sessionId: 's' })).ok, true)
  },
)

check('TS10 the default memory store is full at 10,000 tokens', async () => {
  const { guard } = makeGuard({ entities: tokenise })
  const many = Array.from({ length: 10_000 }, (_, i) => `08${String(i).padStart(8, '0')}`).join(
    '\n',
  )
  const a = guard.processSync(many, { sessionId: 'bulk' })
  assert.equal(a.outcome, 'processed')
  assert.equal(a.findings.length, 10_000)
  const b = guard.processSync('เบอร์ 0911111111', { sessionId: 'other' })
  assert.deepEqual([b.outcome, b.findings[0].failed], ['blocked', 'token_store'])
  await guard.endSession('bulk')
  assert.equal(
    guard.processSync('เบอร์ 0911111111', { sessionId: 'other' }).outcome,
    'processed',
    'room again after endSession',
  )
})

check('TS11 expired tokens are swept on write', async () => {
  const { guard } = makeGuard(
    { entities: { PHONE: { action: 'tokenise', allowedPurposes: ['p'], ttlSec: 1 } } },
    { tokenStore: createMemoryTokenStore({ maxTokens: 1 }) },
  )
  assert.equal(guard.processSync('เบอร์ 0811111111', { sessionId: 's' }).outcome, 'processed')
  assert.equal(guard.processSync('เบอร์ 0822222222', { sessionId: 's' }).outcome, 'blocked')
  await sleep(1150)
  assert.equal(guard.processSync('เบอร์ 0822222222', { sessionId: 's' }).outcome, 'processed')
})

check('TS12 createMemoryTokenStore().sync is true', () => {
  assert.equal(createMemoryTokenStore().sync, true)
})

check(
  'TS13 a clearSession that fails during endSession (not documented — behaviour recorded)',
  async (t) => {
    const store = {
      ...asyncStore(),
      clearSession: async () => {
        throw new Error('redis down')
      },
    }
    const { guard, errors } = makeGuard({ entities: tokenise }, { tokenStore: store })
    await guard.process('เบอร์ 0918887777', { sessionId: 's' })
    let outcome = 'returned'
    try {
      await guard.endSession('s')
    } catch (e) {
      outcome = `threw ${e.constructor.name}: ${e.message}`
    }
    t.diagnostic(
      `endSession → ${outcome}; tokenStoreErrors ${guard.stats.tokenStoreErrors}; onError calls ${errors.length}`,
    )
    assert.ok(
      !strings(errors.map((e) => String(e.error?.message)))
        .join()
        .includes('0918887777'),
    )
  },
)

check(
  'TS14 the README Redis store works as written, against an in-memory stand-in for node-redis v4',
  async () => {
    // A stand-in with the node-redis v4 calls the README uses: set(…, {PXAT}), get, sAdd, pExpireAt(…, 'GT'|'NX'), del, sMembers.
    const kv = new Map()
    const ttl = new Map()
    const alive = (k) => !(ttl.has(k) && ttl.get(k) <= Date.now())
    const redis = {
      async set(k, v, opts) {
        kv.set(k, v)
        if (opts?.PXAT) ttl.set(k, opts.PXAT)
      },
      async get(k) {
        return kv.has(k) && alive(k) ? kv.get(k) : null
      },
      async sAdd(k, m) {
        const s = kv.get(k) ?? new Set()
        s.add(m)
        kv.set(k, s)
      },
      async pExpireAt(k, at, mode) {
        if (!kv.has(k)) return false
        const cur = ttl.get(k)
        if (mode === 'GT' && (cur === undefined || at <= cur)) return false
        if (mode === 'NX' && cur !== undefined) return false
        ttl.set(k, at)
        return true
      },
      async del(keys) {
        for (const k of [keys].flat()) {
          kv.delete(k)
          ttl.delete(k)
        }
      },
      async sMembers(k) {
        return [...(kv.get(k) ?? [])]
      },
    }
    // ↓ the README's tokenStore, verbatim apart from the missing TypeScript annotation
    const tokenStore = {
      sync: false,
      async set(id, rec) {
        const session = `pdpa:session:${rec.sessionId}`
        await redis.set(`pdpa:tok:${id}`, JSON.stringify(rec), { PXAT: rec.expiresAt })
        await redis.sAdd(session, id)
        if (!(await redis.pExpireAt(session, rec.expiresAt, 'GT')))
          await redis.pExpireAt(session, rec.expiresAt, 'NX')
      },
      async get(id) {
        const raw = await redis.get(`pdpa:tok:${id}`)
        return raw === null ? undefined : JSON.parse(raw)
      },
      async delete(id) {
        await redis.del(`pdpa:tok:${id}`)
      },
      async clearSession(sessionId) {
        const ids = await redis.sMembers(`pdpa:session:${sessionId}`)
        await redis.del([...ids.map((id) => `pdpa:tok:${id}`), `pdpa:session:${sessionId}`])
      },
    }
    const guard = createGuard({
      policy: definePolicy({ entitySet: '0.1', entities: tokenise }),
      tokenStore,
      onAudit: () => {},
    })
    const r = await guard.process('เบอร์ 0918887777', { sessionId: 'conv' })
    const token = `[tok:${TOK.exec(r.text)[1]}]`
    assert.deepEqual(await guard.resolve(token, { purpose: 'otp_send', sessionId: 'conv' }), {
      ok: true,
      value: '0918887777',
    })
    assert.equal(
      (await guard.process(`ส่ง OTP ไปที่ ${token}`, { sessionId: 'conv', boundary: 'outbound' }))
        .text,
      'ส่ง OTP ไปที่ xxxxxx7777',
    )
    await guard.endSession('conv')
    assert.deepEqual(await guard.resolve(token, { purpose: 'otp_send', sessionId: 'conv' }), {
      ok: false,
      reason: 'not_found',
    })
    await expectCodeAsync(
      async () => guard.processSync('x', { sessionId: 'conv' }),
      'ERR_PDPA_ASYNC_STORE',
    )
  },
)
