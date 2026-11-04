// createPdpa: the keys, the token store and the audit sink it picks from the
// environment, and the errors it starts with instead of leaking later.
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

const { createMemoryTokenStore } = await import('@eve-pdpa-extension/core')
const { createPdpa, PdpaConfigError, withPdpaGuard } = await import('../extension/lib/guard.js')
const { fakeUpstash } = await import('../../http/test/helpers.js')
const { expectNoLeak, HMAC_KEY, MASK, PHONE, SESSION_KEY, TOKEN, TOKENISE } = await import(
  './helpers.js'
)

const MEMORY_STORE = Symbol.for('@eve-pdpa-extension/eve.memory-token-store')
const WARNED = Symbol.for('@eve-pdpa-extension/eve.dev-warning')
const UPSTASH_TOKEN = 'e2e-upstash-rest-token'
const PROD = { VERCEL_ENV: 'production' }
const KEYS = { PDPA_HMAC_KEY: HMAC_KEY, PDPA_SESSION_KEY: SESSION_KEY }
const STORE = {
  UPSTASH_REDIS_REST_URL: 'https://e2e-example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: UPSTASH_TOKEN,
}
const quiet = { onAudit: () => {} }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  const g = globalThis as Record<symbol, unknown>
  delete g[MEMORY_STORE]
  delete g[WARNED]
})

/** The error createPdpa throws, or null. */
function thrown(fn: () => unknown): (Error & { code?: string }) | null {
  try {
    fn()
    return null
  } catch (error) {
    return error as Error & { code?: string }
  }
}

/** Issues a token for PHONE in a session and returns it. */
async function issue(pdpa: ReturnType<typeof createPdpa>, sessionId = 'eve_s1'): Promise<string> {
  const out = await pdpa.guard.process(`เบอร์ ${PHONE}`, { sessionId, boundary: 'inbound' })
  const token = out.text.match(TOKEN)?.[0]
  expect(token).toBeDefined()
  return token as string
}

describe('createPdpa — keys (U-CP-1)', () => {
  it('uses the keys the environment sets', () => {
    const pdpa = createPdpa({ policy: TOKENISE, env: KEYS, ...quiet })
    expect(pdpa.sessionKey).toBe(SESSION_KEY)
  })

  it('outside production, falls back to development keys that say so, and warns once by name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const a = createPdpa({ policy: TOKENISE, env: {}, ...quiet })
    createPdpa({ policy: TOKENISE, env: {}, ...quiet })
    expect(a.sessionKey).toContain('not-for-production')
    expect(new TextEncoder().encode(a.sessionKey).length).toBeGreaterThanOrEqual(32)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/PDPA_HMAC_KEY.*PDPA_SESSION_KEY/)
  })

  it('treats a key eve add wrote as KEY= as not set', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pdpa = createPdpa({
      policy: TOKENISE,
      env: { PDPA_HMAC_KEY: '', PDPA_SESSION_KEY: '' },
      ...quiet,
    })
    expect(pdpa.sessionKey).toContain('not-for-production')
  })

  it('in production, refuses to start without each key, HMAC first, naming it and nothing secret', () => {
    const none = thrown(() => createPdpa({ policy: TOKENISE, env: { ...PROD, ...STORE } }))
    expect(none).toBeInstanceOf(PdpaConfigError)
    expect(none?.code).toBe('ERR_PDPA_EVE_HMAC_KEY')
    expect(none?.message).toContain('PDPA_HMAC_KEY')

    const noSession = thrown(() =>
      createPdpa({ policy: TOKENISE, env: { ...PROD, ...STORE, PDPA_HMAC_KEY: HMAC_KEY } }),
    )
    expect(noSession?.code).toBe('ERR_PDPA_EVE_SESSION_KEY')
    expect(noSession?.message).toContain('PDPA_SESSION_KEY')
    expectNoLeak([none, noSession], [HMAC_KEY, UPSTASH_TOKEN])
  })

  it('refuses a key shorter than 32 bytes in any environment, without printing it', () => {
    const short = 'e2e-short-key'
    const error = thrown(() =>
      createPdpa({ policy: TOKENISE, env: { ...KEYS, PDPA_SESSION_KEY: short } }),
    )
    expect(error?.code).toBe('ERR_PDPA_EVE_SESSION_KEY')
    expect(error?.message).not.toContain(short)
  })

  it('production can be set by option, and VERCEL_ENV=preview is not production', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(thrown(() => createPdpa({ policy: TOKENISE, env: {}, production: true }))?.code).toBe(
      'ERR_PDPA_EVE_HMAC_KEY',
    )
    expect(
      thrown(() => createPdpa({ policy: TOKENISE, env: { VERCEL_ENV: 'preview' }, ...quiet })),
    ).toBeNull()
    // NODE_ENV is what build tools set: it never makes a local build need keys.
    expect(
      thrown(() => createPdpa({ policy: TOKENISE, env: { NODE_ENV: 'production' }, ...quiet })),
    ).toBeNull()
  })
})

describe('createPdpa — token store (U-CP-2)', () => {
  for (const [name, env] of [
    ['UPSTASH_REDIS_REST_*', STORE],
    [
      'KV_REST_API_*',
      { KV_REST_API_URL: 'https://e2e-kv.upstash.io', KV_REST_API_TOKEN: UPSTASH_TOKEN },
    ],
  ] as const) {
    it(`sends tokens to the Upstash store ${name} names`, async () => {
      const upstash = fakeUpstash()
      const urls: string[] = []
      vi.stubGlobal('fetch', (async (url: string, init: RequestInit) => {
        urls.push(url)
        return upstash.fetch(url, init)
      }) as typeof fetch)
      const pdpa = createPdpa({ policy: TOKENISE, env: { ...KEYS, ...env }, ...quiet })
      const token = await issue(pdpa)
      const base = Object.values(env)[0] as string
      expect(urls.length).toBeGreaterThan(0)
      expect(urls.every((u) => u.startsWith(base))).toBe(true)
      expect(upstash.keys().every((k) => k.startsWith('pdpa-eve:'))).toBe(true)
      const resolved = await pdpa.guard.resolve(token, { sessionId: 'eve_s1', purpose: 'otp_send' })
      expect(resolved).toMatchObject({ ok: true, value: '0918887777' })
    })
  }

  it('a half-set pair is an error that names the missing variable', () => {
    const error = thrown(() =>
      createPdpa({
        policy: TOKENISE,
        env: { ...KEYS, UPSTASH_REDIS_REST_URL: STORE.UPSTASH_REDIS_REST_URL },
      }),
    )
    expect(error?.code).toBe('ERR_PDPA_EVE_STORE')
    expect(error?.message).toContain('UPSTASH_REDIS_REST_TOKEN')
    expect(error?.message).not.toContain(STORE.UPSTASH_REDIS_REST_URL)
  })

  it('outside production, every createPdpa in the process shares one memory store', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = createPdpa({ policy: TOKENISE, env: KEYS, ...quiet })
    const second = createPdpa({ policy: TOKENISE, env: KEYS, ...quiet })
    const token = await issue(first)
    const resolved = await second.guard.resolve(token, {
      sessionId: 'eve_s1',
      purpose: 'otp_send',
    })
    expect(resolved).toMatchObject({ ok: true, value: '0918887777' })
    expect((globalThis as Record<symbol, unknown>)[MEMORY_STORE]).toBeDefined()
  })

  it('in production without a store, refuses to start and names all four variables', () => {
    const error = thrown(() => createPdpa({ policy: TOKENISE, env: { ...PROD, ...KEYS } }))
    expect(error).toBeInstanceOf(PdpaConfigError)
    expect(error?.code).toBe('ERR_PDPA_EVE_STORE')
    for (const name of [
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
      'KV_REST_API_URL',
      'KV_REST_API_TOKEN',
    ]) {
      expect(error?.message).toContain(name)
    }
    expectNoLeak(error, [HMAC_KEY, SESSION_KEY])
  })

  it('a tokenStore passed in wins over the environment, in production too', async () => {
    const pdpa = createPdpa({
      policy: TOKENISE,
      tokenStore: createMemoryTokenStore(),
      env: { ...PROD, ...KEYS },
      ...quiet,
    })
    await issue(pdpa)
  })

  it('takes the policy as imported JSON, as a policy input or already compiled', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const json = JSON.parse(
      JSON.stringify({ entitySet: '0.1', entities: { PHONE: { action: 'mask', keep: 'last4' } } }),
    ) as Record<string, unknown>
    expect(createPdpa({ policy: json, env: KEYS, ...quiet }).policy.entities.PHONE?.action).toBe(
      'mask',
    )
    expect(createPdpa({ policy: MASK, env: KEYS, ...quiet }).policy).toBe(MASK)
  })
})

describe('createPdpa — audit (U-CP-4)', () => {
  it('writes one NDJSON line per event to stdout, with no value in it', async () => {
    const lines: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      lines.push(String(chunk))
      return true
    })
    const pdpa = createPdpa({
      policy: TOKENISE,
      env: { ...KEYS, ...STORE },
      tokenStore: createMemoryTokenStore(),
    })
    await pdpa.guard.process(`โทร ${PHONE} อีเมล somchai@example.com`, {
      sessionId: 'eve_s1',
      boundary: 'inbound',
    })
    vi.mocked(process.stdout.write).mockRestore()
    expect(lines.length).toBeGreaterThanOrEqual(2)
    for (const line of lines) {
      expect(line.endsWith('\n')).toBe(true)
      expect(line.slice(0, -1)).not.toContain('\n')
      expect(() => JSON.parse(line)).not.toThrow()
    }
    expect(lines.map((l) => JSON.parse(l).type)).toContain('scan')
    expectNoLeak(lines, [PHONE, 'somchai@example.com', HMAC_KEY, SESSION_KEY])
  })
})

describe('createPdpa — options.env (U-CP-5)', () => {
  it('does not read process.env when env is given', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('PDPA_HMAC_KEY', 'e2e-process-env-hmac-key-0000000000000000')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // process.env says production with a key; env says neither.
      const pdpa = createPdpa({ policy: TOKENISE, env: {}, ...quiet })
      expect(pdpa.sessionKey).toContain('not-for-production')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('reads process.env when env is not given', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    try {
      expect(thrown(() => createPdpa({ policy: TOKENISE }))?.code).toBe('ERR_PDPA_EVE_HMAC_KEY')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('pdpa.tool — purpose', () => {
  it('refuses a purpose the policy does not allow, when the agent loads', async () => {
    const { defineTool } = await import('eve/tools')
    const pdpa = createPdpa({ policy: TOKENISE, env: KEYS, ...quiet })
    const tool = defineTool({
      description: 'x',
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        return {}
      },
    })
    expect(thrown(() => pdpa.tool(tool, 'marketing'))?.code).toBe('ERR_PDPA_EVE_PURPOSE')
    expect(thrown(() => pdpa.tool(tool, 'otp_send'))).toBeNull()
  })
})

describe('withPdpaGuard — eve adapters it cannot mask (U-ADP-1, U-ADP-2)', () => {
  const route = { method: 'POST' as const, path: '/in', handler: async () => new Response() }
  const opts = { guard: null as never, sessionKey: SESSION_KEY, channelName: 'chat' }
  const pdpa = () => createPdpa({ policy: TOKENISE, env: KEYS, ...quiet })

  it('throws, with a code and the eve version, for an adapter shaped like eve 1.0.0-rc.1', () => {
    const rc1 = {
      routes: [route],
      adapter: { kind: 'chat', 'interaction.opened': () => {}, 'interaction.settled': () => {} },
    }
    for (const wrap of [
      () => withPdpaGuard(rc1, { ...opts, guard: pdpa().guard }),
      () => pdpa().channel(rc1, 'chat'),
    ]) {
      const error = thrown(wrap)
      expect(error).toBeInstanceOf(PdpaConfigError)
      expect(error?.code).toBe('ERR_PDPA_EVE_ADAPTER')
      expect(error?.message).toContain('0.80.x')
      expect(error?.message).toMatch(/eve (\d+\.\d+\.\d+|unknown)/)
    }
  })

  it('does not throw for eve 0.80.1 channels: built-in, events only, or posting nothing', async () => {
    const { defineChannel, POST } = await import('eve/channels')
    const { telegramChannel } = await import('eve/channels/telegram')
    const { eveChannel } = await import('eve/channels/eve')
    const { guard } = pdpa()
    const eventsOnly = defineChannel({
      routes: [POST('/in', async () => new Response())],
      events: { 'message.completed': () => {} },
    })
    const silent = defineChannel({ routes: [POST('/in', async () => new Response())] })
    for (const channel of [eventsOnly, silent, telegramChannel({})]) {
      expect(thrown(() => withPdpaGuard(channel, { ...opts, guard }))).toBeNull()
    }
    expect(
      thrown(() => pdpa().channel(eveChannel({ auth: [] }), { allowRawTokensInOutput: true })),
    ).toBeNull()
  })

  it('outbound: false skips the check, as it skips the masking', () => {
    const rc1 = { routes: [route], adapter: { 'interaction.opened': () => {} } }
    expect(
      thrown(() => withPdpaGuard(rc1, { ...opts, guard: pdpa().guard, outbound: false })),
    ).toBeNull()
  })
})
