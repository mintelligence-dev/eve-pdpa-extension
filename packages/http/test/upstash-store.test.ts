import { createGuard, definePolicy, type TokenRecord } from '@eve-pdpa-extension/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PdpaHttpError } from '../src/errors.js'
import { createUpstashTokenStore } from '../src/upstash-store.js'
import { fakeUpstash } from './helpers.js'

const URL_ = 'https://eu1-example.upstash.io'
const REST_TOKEN = 'upstash-rest-token'

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
})

describe('createUpstashTokenStore', () => {
  it('writes a token and its chat, and reads the token back', async () => {
    const upstash = fakeUpstash()
    const store = createUpstashTokenStore({ url: URL_, token: REST_TOKEN, fetch: upstash.fetch })
    expect(store.sync).toBe(false)
    await store.set('bcdfghjkmnpqrstv', record())
    expect(upstash.commands.map((c) => c[0])).toEqual(['SET', 'SADD', 'PEXPIRE'])
    expect(upstash.commands[0]?.slice(0, 2)).toEqual(['SET', 'pdpa:tok:bcdfghjkmnpqrstv'])
    expect(upstash.commands[1]).toEqual(['SADD', 'pdpa:session:conv_8f2a', 'bcdfghjkmnpqrstv'])
    expect(await store.get('bcdfghjkmnpqrstv')).toEqual(record({ expiresAt: expect.any(Number) }))
    expect(await store.get('ccccccccccccccc')).toBeUndefined()
  })

  it('a token is gone when it expires, and the chat list outlives it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const upstash = fakeUpstash()
    const store = createUpstashTokenStore({ url: URL_, token: REST_TOKEN, fetch: upstash.fetch })
    await store.set('bcdfghjkmnpqrstv', record({ expiresAt: Date.now() + 300_000 }))
    vi.setSystemTime(Date.now() + 299_000)
    expect(await store.get('bcdfghjkmnpqrstv')).toBeDefined()
    vi.setSystemTime(Date.now() + 2_000)
    expect(await store.get('bcdfghjkmnpqrstv')).toBeUndefined()
    expect(upstash.keys()).toEqual(['pdpa:session:conv_8f2a'])
  })

  it('clearSession deletes every token of that chat and no other', async () => {
    const upstash = fakeUpstash()
    const store = createUpstashTokenStore({ url: URL_, token: REST_TOKEN, fetch: upstash.fetch })
    await store.set('bbbbbbbbbbbbbbbb', record())
    await store.set('cccccccccccccccc', record())
    await store.set('dddddddddddddddd', record({ sessionId: 'conv_other' }))
    await store.clearSession('conv_8f2a')
    expect(await store.get('bbbbbbbbbbbbbbbb')).toBeUndefined()
    expect(await store.get('cccccccccccccccc')).toBeUndefined()
    expect(await store.get('dddddddddddddddd')).toBeDefined()
  })

  it('sends the REST token as a bearer token, and a prefix in front of every key', async () => {
    const seen: Headers[] = []
    const upstash = fakeUpstash()
    const spy = (async (url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers))
      return upstash.fetch(url, init)
    }) as typeof fetch
    const store = createUpstashTokenStore({
      url: `${URL_}/`,
      token: REST_TOKEN,
      prefix: 'shop1:',
      fetch: spy,
    })
    await store.delete('bbbbbbbbbbbbbbbb')
    expect(seen[0]?.get('authorization')).toBe(`Bearer ${REST_TOKEN}`)
    expect(upstash.commands[0]).toEqual(['DEL', 'shop1:tok:bbbbbbbbbbbbbbbb'])
  })

  it('a failure throws an error that holds no value, URL or REST token', async () => {
    const failures: (typeof fetch)[] = [
      (async () => new Response('nope', { status: 500 })) as typeof fetch,
      (async () => Response.json({ error: 'ERR wrong 0918887777' })) as typeof fetch,
      (async () => Response.json([{ error: 'ERR' }, { result: 1 }, { result: 1 }])) as typeof fetch,
      (async () => {
        throw new TypeError(`fetch failed for ${URL_}`)
      }) as typeof fetch,
      (async () => new Response('<html>', { status: 200 })) as typeof fetch,
    ]
    for (const failing of failures) {
      const store = createUpstashTokenStore({ url: URL_, token: REST_TOKEN, fetch: failing })
      for (const call of [
        () => store.set('bbbbbbbbbbbbbbbb', record()),
        () => store.get('bbbbbbbbbbbbbbbb'),
      ]) {
        const error = await call().then(
          () => null,
          (e: unknown) => e,
        )
        expect(error).toBeInstanceOf(PdpaHttpError)
        expect((error as PdpaHttpError).code).toBe('ERR_PDPA_HTTP_STORE')
        for (const secret of ['0918887777', URL_, REST_TOKEN]) {
          expect((error as Error).message).not.toContain(secret)
        }
      }
    }
  })

  it('a request that hangs is abandoned after timeoutMs', async () => {
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })) as typeof fetch
    const store = createUpstashTokenStore({
      url: URL_,
      token: REST_TOKEN,
      timeoutMs: 20,
      fetch: hanging,
    })
    await expect(store.get('bbbbbbbbbbbbbbbb')).rejects.toThrow('Upstash request timed out')
  })

  it('refuses a plain-http URL away from localhost, and a missing token', () => {
    expect(() =>
      createUpstashTokenStore({ url: 'http://eu1-example.upstash.io', token: REST_TOKEN }),
    ).toThrow(/must be https/)
    expect(() =>
      createUpstashTokenStore({ url: 'http://localhost:8079', token: REST_TOKEN }),
    ).not.toThrow()
    expect(() => createUpstashTokenStore({ url: 'not a url', token: REST_TOKEN })).toThrow(
      PdpaHttpError,
    )
    expect(() => createUpstashTokenStore({ url: URL_, token: '' })).toThrow(/token/)
  })

  it('works under a guard: tokenise, then resolve from another guard on the same store', async () => {
    const upstash = fakeUpstash()
    const policy = definePolicy({
      entitySet: '0.1',
      entities: { PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'], ttlSec: 300 } },
    })
    const machine = () =>
      createGuard({
        policy,
        onAudit: () => {},
        tokenStore: createUpstashTokenStore({ url: URL_, token: REST_TOKEN, fetch: upstash.fetch }),
      })
    // Two guards, as on two serverless machines: one issues, the other resolves.
    const a = machine()
    const b = machine()
    const { text } = await a.process('เบอร์ 091-888-7777', { sessionId: 'conv_8f2a' })
    const token = text.match(/\[tok:[a-z]{16}\]/)?.[0] as string
    expect(await b.resolve(token, { purpose: 'otp_send', sessionId: 'conv_8f2a' })).toEqual({
      ok: true,
      value: '0918887777',
    })
  })
})
