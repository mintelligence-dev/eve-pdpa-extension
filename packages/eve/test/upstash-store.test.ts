// The Upstash token store the eve package carries: the same bytes as
// packages/http's (scripts/sync-eve-upstash.mjs copies them), the same
// behaviour, and what createPdpa does with it — its prefix, and a store that
// is down.
import { readFileSync } from 'node:fs'
import type { TokenRecord } from '@eve-pdpa-extension/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

const slots = new Map<string, unknown>()
vi.mock('eve/context', () => ({
  defineState: (name: string, initial: () => unknown) => ({
    get: () => (slots.has(name) ? slots.get(name) : initial()),
    update: (fn: (v: unknown) => unknown) => {
      slots.set(name, fn(slots.has(name) ? slots.get(name) : initial()))
    },
  }),
}))

const { createUpstashTokenStore } = await import('../extension/lib/upstash/upstash-store.js')
const { PdpaHttpError } = await import('../extension/lib/upstash/errors.js')
const { createPdpa } = await import('../extension/lib/guard.js')
const { fakeUpstash } = await import('../../http/test/helpers.js')
const { expectNoLeak, HMAC_KEY, PHONE, SESSION_KEY, TOKEN, TOKENISE } = await import('./helpers.js')

const URL_ = 'https://e2e-example.upstash.io'
const REST_TOKEN = 'e2e-upstash-rest-token'
const ENV = {
  PDPA_HMAC_KEY: HMAC_KEY,
  PDPA_SESSION_KEY: SESSION_KEY,
  UPSTASH_REDIS_REST_URL: URL_,
  UPSTASH_REDIS_REST_TOKEN: REST_TOKEN,
}

const record = (over: Partial<TokenRecord> = {}): TokenRecord => ({
  value: '0918887777',
  entity: 'PHONE',
  sessionId: 'conv_8f2a',
  purposes: ['otp_send'],
  expiresAt: Date.now() + 300_000,
  display: 'xxx-xxx-7777',
  ...over,
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the copy', () => {
  for (const name of ['upstash-store.ts', 'errors.ts']) {
    it(`${name} is byte for byte packages/http's — run scripts/sync-eve-upstash.mjs`, () => {
      const source = readFileSync(new URL(`../../http/src/${name}`, import.meta.url))
      const copy = readFileSync(new URL(`../extension/lib/upstash/${name}`, import.meta.url))
      expect(copy.equals(source)).toBe(true)
    })
  }
})

describe('createUpstashTokenStore in eve (U-UP-1)', () => {
  it('SET … PX, SADD and PEXPIRE in one /multi-exec; GET reads it back', async () => {
    const upstash = fakeUpstash()
    const store = createUpstashTokenStore({ url: URL_, token: REST_TOKEN, fetch: upstash.fetch })
    await store.set('bcdfghjkmnpqrstv', record())
    expect(upstash.paths).toEqual(['/multi-exec'])
    expect(upstash.commands.map((c) => c[0])).toEqual(['SET', 'SADD', 'PEXPIRE'])
    expect(upstash.commands[0]?.slice(3, 4)).toEqual(['PX'])
    expect(await store.get('bcdfghjkmnpqrstv')).toEqual(record({ expiresAt: expect.any(Number) }))
    expect(await store.get('cccccccccccccccc')).toBeUndefined()
  })

  it('a token is gone when its TTL runs out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const upstash = fakeUpstash()
    const store = createUpstashTokenStore({ url: URL_, token: REST_TOKEN, fetch: upstash.fetch })
    await store.set('bcdfghjkmnpqrstv', record({ expiresAt: Date.now() + 300_000 }))
    vi.setSystemTime(Date.now() + 299_000)
    expect(await store.get('bcdfghjkmnpqrstv')).toBeDefined()
    vi.setSystemTime(Date.now() + 2_000)
    expect(await store.get('bcdfghjkmnpqrstv')).toBeUndefined()
  })

  it('DEL removes one token; clearSession reads SMEMBERS and removes that chat only', async () => {
    const upstash = fakeUpstash()
    const store = createUpstashTokenStore({ url: URL_, token: REST_TOKEN, fetch: upstash.fetch })
    await store.set('bbbbbbbbbbbbbbbb', record())
    await store.set('cccccccccccccccc', record())
    await store.set('dddddddddddddddd', record({ sessionId: 'conv_other' }))
    await store.delete('bbbbbbbbbbbbbbbb')
    expect(await store.get('bbbbbbbbbbbbbbbb')).toBeUndefined()
    await store.clearSession('conv_8f2a')
    expect(upstash.commands.some((c) => c[0] === 'SMEMBERS')).toBe(true)
    expect(await store.get('cccccccccccccccc')).toBeUndefined()
    expect(await store.get('dddddddddddddddd')).toBeDefined()
  })
})

describe('createPdpa with Upstash (U-UP-2)', () => {
  async function tokenThrough(env: Record<string, string>, upstash?: { prefix?: string }) {
    const fake = fakeUpstash()
    vi.stubGlobal('fetch', fake.fetch)
    const pdpa = createPdpa({
      policy: TOKENISE,
      env,
      onAudit: () => {},
      ...(upstash && { upstash }),
    })
    const out = await pdpa.guard.process(`เบอร์ ${PHONE}`, { sessionId: 'eve_s1' })
    expect(out.text).toMatch(TOKEN)
    return fake.keys()
  }

  it('puts pdpa-eve: in front of every key by default', async () => {
    const keys = await tokenThrough(ENV)
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) expect(key.startsWith('pdpa-eve:')).toBe(true)
  })

  it('puts the prefix it is given in front of every key', async () => {
    const keys = await tokenThrough(ENV, { prefix: 'pdpa-agent:' })
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) expect(key.startsWith('pdpa-agent:')).toBe(true)
  })
})

describe('createPdpa with Upstash down (U-UP-3)', () => {
  for (const [name, down] of [
    ['HTTP 500', (async () => new Response('down', { status: 500 })) as typeof fetch],
    [
      'a timeout',
      ((_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        })) as typeof fetch,
    ],
  ] as const) {
    it(`fails closed on ${name}: the message is held back, resolve refuses, stats count it`, async () => {
      vi.stubGlobal('fetch', down)
      const errors: unknown[] = []
      const pdpa = createPdpa({ policy: TOKENISE, env: ENV, onAudit: () => {} })
      // The store createPdpa built from env: its default 2 s timeout, twice.
      const guard = pdpa.guard
      const out = await guard.process(`ขอ OTP เบอร์ ${PHONE}`, { sessionId: 'eve_s1' })
      expect(out.outcome).toBe('blocked')
      expectNoLeak(out, [PHONE, REST_TOKEN, URL_])

      const resolved = await guard
        .resolve('[tok:bcdfghjkmnpqrstv]', { sessionId: 'eve_s1', purpose: 'otp_send' })
        .catch((e: unknown) => {
          errors.push(e)
          return { ok: false as const, reason: 'thrown' }
        })
      expect(resolved.ok).toBe(false)
      expect(guard.stats.tokenStoreErrors).toBeGreaterThan(0)
      expectNoLeak([resolved, errors], [PHONE, REST_TOKEN, URL_, HMAC_KEY, SESSION_KEY])
    }, 10_000)
  }

  it('a store error from the copy names what failed, never the request', async () => {
    const store = createUpstashTokenStore({
      url: URL_,
      token: REST_TOKEN,
      fetch: (async () => new Response('nope', { status: 500 })) as typeof fetch,
    })
    const error = await store.set('bbbbbbbbbbbbbbbb', record()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PdpaHttpError)
    expect((error as InstanceType<typeof PdpaHttpError>).code).toBe('ERR_PDPA_HTTP_STORE')
    expectNoLeak(error, ['0918887777', URL_, REST_TOKEN])
  })
})
