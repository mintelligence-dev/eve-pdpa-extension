// ER — errors: PdpaError and its codes, messages without real values, the Node 18 random source.
//   bench/user/run features/errors.check.mjs
import assert from 'node:assert/strict'
import { randomFillSync } from 'node:crypto'
import {
  createGuard,
  createMemoryTokenStore,
  definePolicy,
  PdpaError,
  parsePolicy,
} from '@thai-pdpa-guard/core'
import { check, expectCode, expectCodeAsync, makeGuard } from '../lib/kit.mjs'

const tokenise = definePolicy({
  entitySet: '0.1',
  entities: { PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'] } },
})
const VALUES = ['0918887777', '091-888-7777', 'somchai.k@gmail.com', '1103702071811']

check('ER1 PdpaError is exported, extends Error and carries code', () => {
  const e = new PdpaError('ERR_PDPA_NO_SESSION', 'test')
  assert.ok(e instanceof Error)
  assert.equal(e.code, 'ERR_PDPA_NO_SESSION')
  assert.equal(e.message, 'test')
})

check(
  'ER2 every code in the README is reachable (INVALID_POLICY, HMAC_KEY, NO_SESSION, ASYNC_STORE)',
  async () => {
    expectCode(
      () => definePolicy({ entitySet: '0.1', entities: { PHONE: { action: 'nope' } } }),
      'ERR_PDPA_INVALID_POLICY',
    )
    expectCode(
      () =>
        createGuard({
          policy: definePolicy({ entitySet: '0.1', entities: { EMAIL: { action: 'hash' } } }),
          onAudit: () => {},
        }),
      'ERR_PDPA_HMAC_KEY',
    )
    expectCode(
      () => createGuard({ policy: tokenise, onAudit: () => {} }).processSync('x'),
      'ERR_PDPA_NO_SESSION',
    )
    const asyncStore = {
      sync: false,
      async set() {},
      async get() {},
      async delete() {},
      async clearSession() {},
    }
    expectCode(
      () =>
        createGuard({ policy: tokenise, tokenStore: asyncStore, onAudit: () => {} }).processSync(
          'x',
          { sessionId: 's' },
        ),
      'ERR_PDPA_ASYNC_STORE',
    )
  },
)

check(
  'ER2b ERR_PDPA_TOKEN_STORE_FULL (types only) is what onError receives when the memory store is full',
  (t) => {
    const { guard, errors } = makeGuard(tokenise, {
      tokenStore: createMemoryTokenStore({ maxTokens: 1 }),
    })
    guard.processSync('เบอร์ 0811111111', { sessionId: 's' })
    guard.processSync('เบอร์ 0822222222', { sessionId: 's' })
    const e = errors[0]?.error
    t.diagnostic(`onError got ${e?.constructor?.name} ${e?.code ?? ''}: ${e?.message}`)
    assert.ok(e instanceof PdpaError)
    assert.equal(e.code, 'ERR_PDPA_TOKEN_STORE_FULL')
    assert.ok(!String(e.message).includes('0822222222'))
  },
)

check('ER3 error messages never contain real values', async (t) => {
  const messages = []
  const grab = (fn) => {
    try {
      fn()
    } catch (e) {
      messages.push(String(e.message))
    }
  }
  const grabAsync = async (fn) => {
    try {
      await fn()
    } catch (e) {
      messages.push(String(e.message))
    }
  }
  const g = createGuard({ policy: tokenise, onAudit: () => {} })
  grab(() => g.processSync('เบอร์ 0918887777 เมล somchai.k@gmail.com'))
  await grabAsync(() => g.resolve('0918887777', { purpose: 'otp_send' }))
  grab(() =>
    definePolicy({
      entitySet: '0.1',
      entities: { PHONE: { action: 'redact' } },
      allowlist: { exact: ['0918887777'], exacts: ['somchai.k@gmail.com'] },
    }),
  )
  grab(() =>
    definePolicy({ entitySet: '0.1', entities: {}, allowlist: { pattern: ['0918887777('] } }),
  )
  grab(() =>
    definePolicy({ entitySet: '0.1', entities: {}, allowlist: { exact: ['1103702071811', 42] } }),
  )
  grab(() => parsePolicy('{"entitySet":"0.1","entities":{},"allowlist":{"exact":["0918887777",]}}'))
  grab(() =>
    parsePolicy(
      '{"entitySet":"0.1","entities":{},"allowlist":{"exact":["somchai.k@gmail.com" "x"]}}',
    ),
  )
  const asyncStore = {
    sync: false,
    async set() {},
    async get() {},
    async delete() {},
    async clearSession() {},
  }
  grab(() =>
    createGuard({ policy: tokenise, tokenStore: asyncStore, onAudit: () => {} }).processSync(
      'เบอร์ 0918887777',
      { sessionId: 's' },
    ),
  )
  const key = 'my-secret-key-123'
  grab(() =>
    createGuard({
      policy: definePolicy({ entitySet: '0.1', entities: { EMAIL: { action: 'hash' } } }),
      hmacKey: key,
      onAudit: () => {},
    }),
  )
  const leaks = messages.filter((m) => [...VALUES, key].some((v) => m.includes(v)))
  for (const m of messages) t.diagnostic(m.slice(0, 160))
  assert.equal(messages.length, 9)
  assert.deepEqual(leaks, [])
})

/** Runs fn with globalThis.crypto removed, as on stock Node 18. */
async function withoutCrypto(fn) {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', {
    value: undefined,
    configurable: true,
    writable: true,
  })
  try {
    return await fn()
  } finally {
    Object.defineProperty(globalThis, 'crypto', desc)
  }
}

check(
  'ER4 no globalThis.crypto and no randomSource under tokenise → ERR_PDPA_NO_CSPRNG',
  async (t) => {
    await withoutCrypto(async () => {
      let where = 'nowhere'
      try {
        const g = createGuard({ policy: tokenise, onAudit: () => {} })
        where = 'not at createGuard'
        g.processSync('เบอร์ 0918887777', { sessionId: 's' })
        where = 'not at the first tokenise either'
      } catch (e) {
        t.diagnostic(
          `thrown ${where === 'nowhere' ? 'by createGuard' : 'by the first tokenise'}: ${e.code}`,
        )
        assert.equal(e.code, 'ERR_PDPA_NO_CSPRNG')
        return
      }
      assert.fail(`no error: ${where}`)
    })
  },
)

check('ER5 a randomSource that returns the wrong number of bytes is refused', async (t) => {
  let thrown
  let result
  try {
    const g = createGuard({
      policy: tokenise,
      randomSource: () => new Uint8Array(1),
      onAudit: () => {},
    })
    result = g.processSync('เบอร์ 0918887777', { sessionId: 's' })
  } catch (e) {
    thrown = e
  }
  t.diagnostic(
    thrown
      ? `threw ${thrown.constructor.name} ${thrown.code ?? ''}: ${thrown.message}`
      : `no throw: ${JSON.stringify(result)}`,
  )
  assert.ok(
    thrown instanceof PdpaError || result?.outcome === 'blocked',
    'a short random source was used',
  )
  if (result) assert.ok(!result.text.includes('0918887777'))
})

check(
  'ER6 with randomSource and no globalThis.crypto, tokenise works (the Node 18 recipe)',
  async () => {
    await withoutCrypto(async () => {
      const g = createGuard({
        policy: tokenise,
        randomSource: (n) => randomFillSync(new Uint8Array(n)),
        onAudit: () => {},
      })
      const r = g.processSync('เบอร์ 0918887777', { sessionId: 's' })
      assert.match(r.text, /^เบอร์ \[tok:[bcdfghjkmnpqrstv]{16}\]$/)
      const token = r.text.slice(6)
      assert.deepEqual(await g.resolve(token, { purpose: 'otp_send', sessionId: 's' }), {
        ok: true,
        value: '0918887777',
      })
      await expectCodeAsync(() => g.resolve(token, { purpose: 'otp_send' }), 'ERR_PDPA_NO_SESSION')
    })
  },
)
