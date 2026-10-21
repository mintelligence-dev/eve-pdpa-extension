// The template's startup rules: in production, no shared token store and no
// secrets means no agent — an in-memory store is not shared between
// serverless instances, and tokens issued on one could never be resolved on
// another.
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('apps/pdpa-agent startup', () => {
  it('refuses to start in production without Upstash', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('KV_REST_API_URL', '')
    await expect(import('../agent/lib/store.js')).rejects.toThrow(/UPSTASH_REDIS_REST_URL/)
  })

  it('uses Upstash when its URL and token are set, in production or not', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example-upstash.example')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'synthetic-rest-token')
    const { tokenStore } = await import('../agent/lib/store.js')
    expect(tokenStore.sync).toBe(false)
  })

  it('falls back to one shared in-memory store locally', async () => {
    vi.stubEnv('VERCEL_ENV', '')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('KV_REST_API_URL', '')
    const first = (await import('../agent/lib/store.js')).tokenStore
    vi.resetModules()
    const second = (await import('../agent/lib/store.js')).tokenStore
    expect(first.sync).toBe(true)
    // Loaded twice, as eve loads channel, hook and tool modules: one store.
    expect(second).toBe(first)
  })

  it('refuses a missing secret in production, and names the variable only', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('PDPA_SESSION_KEY', '')
    const { secret } = await import('../agent/lib/env.js')
    expect(() => secret('PDPA_SESSION_KEY', 'dev')).toThrow(/^set PDPA_SESSION_KEY/)
  })
})
