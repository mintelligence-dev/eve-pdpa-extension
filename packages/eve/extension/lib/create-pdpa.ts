/**
 * createPdpa: the whole setup in one call, for `agent/lib/pdpa.ts`.
 *
 *   import policy from '../../policies/pdpa-policy.json' with { type: 'json' }
 *   export const pdpa = createPdpa({ policy })
 *
 * It reads the keys and the token store from the environment, builds the
 * guard, and hands back the wrappers with the guard already in them. Every
 * wrapper is the 0.1.0 function underneath — withPdpaGuard, guardModel,
 * withTokenResolution, pdpaHook — called with the same options.
 *
 * It refuses to start, rather than leak later: in production a missing key or
 * a token store only one machine can see is an error thrown here, which is
 * when the agent loads. Outside production it falls back to development keys
 * and one memory store per process, and says so once.
 */
import {
  type AuditRecord,
  type CompiledPolicy,
  createGuard,
  createMemoryTokenStore,
  definePolicy,
  type Guard,
  type PolicyInput,
  type TokenStore,
} from '@eve-pdpa-extension/core'
import type { LanguageModel } from 'ai'
import type { ToolDefinition } from 'eve/tools'
import { type GuardableChannel, withPdpaGuard } from './channel.js'
import { PdpaConfigError } from './errors.js'
import { pdpaHook } from './hook.js'
import { guardModel } from './model.js'
import type { TokenRefusal } from './tool.js'
import { withTokenResolution } from './tool.js'
import { createUpstashTokenStore } from './upstash/upstash-store.js'

/** A policy as `import … with { type: 'json' }` types it: strings, not the literal unions. */
export type PolicyJson = Readonly<Record<string, unknown>>

export interface CreatePdpaOptions {
  /** Required. Import the policy JSON: eve bundles agent modules, so nothing reads a file at run time. */
  readonly policy: PolicyInput | CompiledPolicy | PolicyJson
  /** Default: env PDPA_HMAC_KEY. Unset: a development value outside production, a throw in production. */
  readonly hmacKey?: string
  /** Default: env PDPA_SESSION_KEY. Same rule as hmacKey. */
  readonly sessionKey?: string
  /**
   * Default, in order: Upstash from env (UPSTASH_REDIS_REST_* or KV_REST_API_*)
   * → outside production, one memory store per process → in production, a throw.
   */
  readonly tokenStore?: TokenStore
  /** For the Upstash store built from env. Default prefix `pdpa-eve:`. */
  readonly upstash?: { readonly prefix?: string }
  /** Default: one NDJSON line per event on stdout. Events never hold a value. */
  readonly onAudit?: (event: AuditRecord) => void
  /** Default: env VERCEL_ENV === 'production'. NODE_ENV is not read: build tools set it. */
  readonly production?: boolean
  /** Default: process.env. When given, process.env is not read at all. */
  readonly env?: Readonly<Record<string, string | undefined>>
}

export interface ChannelOptions {
  /** As in withPdpaGuard: for a channel that streams replies and cannot rewrite a token (eve's HTTP channel). */
  readonly allowRawTokensInOutput?: boolean
}

export interface Pdpa {
  readonly guard: Guard
  readonly sessionKey: string
  readonly policy: CompiledPolicy
  /** withPdpaGuard with this guard. `name` is the file stem of `agent/channels/<name>.ts`. */
  channel<C extends GuardableChannel>(channel: C, name: string, options?: ChannelOptions): C
  /** eve's HTTP channel only: its sessions have no address, so it takes no name. */
  channel<C extends GuardableChannel>(channel: C, options?: ChannelOptions): C
  /** guardModel with this guard. A string goes through the AI Gateway, as eve routes it. */
  model(model: LanguageModel): LanguageModel
  /** withTokenResolution with this guard. `purpose` must be in an entity's `allowedPurposes`. */
  tool<I, O>(tool: ToolDefinition<I, O>, purpose: string): ToolDefinition<I, O | TokenRefusal>
  /** Default-export it from `agent/hooks/<any>.ts`, next to the tools that resolve tokens. */
  readonly hook: ReturnType<typeof pdpaHook>
}

const DEV_HMAC_KEY = 'eve-pdpa-extension-dev-hmac-key-not-for-production'
const DEV_SESSION_KEY = 'eve-pdpa-extension-dev-session-key-not-for-production'
const MIN_KEY_BYTES = 32
const DEFAULT_PREFIX = 'pdpa-eve:'
const MEMORY_STORE = Symbol.for('@eve-pdpa-extension/eve.memory-token-store')
const WARNED = Symbol.for('@eve-pdpa-extension/eve.dev-warning')

const STORE_VARS =
  'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL and KV_REST_API_TOKEN)'

type Env = Readonly<Record<string, string | undefined>>

/** A variable `eve add` wrote as `KEY=` is not set. */
function read(env: Env, name: string): string | undefined {
  const value = env[name]
  return value === undefined || value === '' ? undefined : value
}

function key(
  given: string | undefined,
  env: Env,
  name: 'PDPA_HMAC_KEY' | 'PDPA_SESSION_KEY',
  production: boolean,
  dev: string,
): { value: string; dev: boolean } {
  const code = name === 'PDPA_HMAC_KEY' ? 'ERR_PDPA_EVE_HMAC_KEY' : 'ERR_PDPA_EVE_SESSION_KEY'
  const value = given ?? read(env, name)
  if (value === undefined) {
    if (production) {
      throw new PdpaConfigError(
        code,
        `${name} is not set. Production needs its own secret of at least ${MIN_KEY_BYTES} bytes (openssl rand -hex 32).`,
      )
    }
    return { value: dev, dev: true }
  }
  if (new TextEncoder().encode(value).length < MIN_KEY_BYTES) {
    // Never the value: only what is wrong with it.
    throw new PdpaConfigError(
      code,
      `${name} is shorter than ${MIN_KEY_BYTES} bytes (openssl rand -hex 32).`,
    )
  }
  return { value, dev: false }
}

/** The Upstash store the environment names, if it names one. A half-set pair is a mistake. */
function upstashFromEnv(env: Env, prefix: string): TokenStore | undefined {
  for (const [urlName, tokenName] of [
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
  ] as const) {
    const url = read(env, urlName)
    const token = read(env, tokenName)
    if (url === undefined && token === undefined) continue
    if (url === undefined || token === undefined) {
      const missing = url === undefined ? urlName : tokenName
      const set = url === undefined ? tokenName : urlName
      throw new PdpaConfigError('ERR_PDPA_EVE_STORE', `${set} is set but ${missing} is not.`)
    }
    return createUpstashTokenStore({ url, token, prefix })
  }
  return undefined
}

/**
 * One memory store for the whole process: eve loads channels, hooks and tools
 * as separate modules, so a store made per module would not see the tokens
 * another one issued.
 */
function sharedMemoryStore(): TokenStore {
  const slot = globalThis as { [MEMORY_STORE]?: TokenStore }
  slot[MEMORY_STORE] ??= createMemoryTokenStore()
  return slot[MEMORY_STORE]
}

function warnOnce(what: readonly string[]): void {
  const slot = globalThis as { [WARNED]?: boolean }
  if (slot[WARNED] === true) return
  slot[WARNED] = true
  console.warn(
    `[eve-pdpa-extension] not production (VERCEL_ENV is not "production"): using ${what.join(' and ')}. Set them before you deploy.`,
  )
}

/** A compiled policy is frozen; an imported JSON object is not. createGuard checks the rest. */
function compile(policy: CreatePdpaOptions['policy']): CompiledPolicy {
  if (Object.isFrozen(policy)) return policy as CompiledPolicy
  return definePolicy(policy as PolicyInput)
}

function auditToStdout(event: AuditRecord): void {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

export function createPdpa(options: CreatePdpaOptions): Pdpa {
  if (typeof options !== 'object' || options === null || options.policy === undefined) {
    throw new TypeError('createPdpa: expected { policy } — import your policy JSON and pass it')
  }
  const env: Env = options.env ?? process.env
  const production = options.production ?? read(env, 'VERCEL_ENV') === 'production'
  const policy = compile(options.policy)

  // In this order, so the first thing a new deployment is told to set is the first key.
  const hmac = key(options.hmacKey, env, 'PDPA_HMAC_KEY', production, DEV_HMAC_KEY)
  const session = key(options.sessionKey, env, 'PDPA_SESSION_KEY', production, DEV_SESSION_KEY)

  let tokenStore =
    options.tokenStore ?? upstashFromEnv(env, options.upstash?.prefix ?? DEFAULT_PREFIX)
  let memory = false
  if (tokenStore === undefined) {
    if (production) {
      throw new PdpaConfigError(
        'ERR_PDPA_EVE_STORE',
        `no token store for production. Set ${STORE_VARS} — on Vercel, add Upstash from the Marketplace — or pass tokenStore. A memory store only works on one machine.`,
      )
    }
    tokenStore = sharedMemoryStore()
    memory = true
  }

  const dev = [
    ...(hmac.dev ? ['a development PDPA_HMAC_KEY'] : []),
    ...(session.dev ? ['a development PDPA_SESSION_KEY'] : []),
    ...(memory ? ['a memory token store'] : []),
  ]
  if (dev.length > 0) warnOnce(dev)

  const guard = createGuard({
    policy,
    hmacKey: hmac.value,
    tokenStore,
    onAudit: options.onAudit ?? auditToStdout,
  })
  const sessionKey = session.value
  const purposes = new Set(
    Object.values(policy.entities).flatMap((rule) =>
      rule?.action === 'tokenise' ? (rule.allowedPurposes ?? []) : [],
    ),
  )

  function channel<C extends GuardableChannel>(
    value: C,
    nameOrOptions?: string | ChannelOptions,
    maybeOptions?: ChannelOptions,
  ): C {
    const name = typeof nameOrOptions === 'string' ? nameOrOptions : undefined
    const extra = (typeof nameOrOptions === 'string' ? maybeOptions : nameOrOptions) ?? {}
    return withPdpaGuard(value, {
      guard,
      sessionKey,
      policy,
      ...(name === undefined ? {} : { channelName: name }),
      ...extra,
    })
  }

  return {
    guard,
    sessionKey,
    policy,
    channel,
    model: (model) => guardModel(model, { guard, sessionKey }),
    tool(tool, purpose) {
      if (!purposes.has(purpose)) {
        throw new PdpaConfigError(
          'ERR_PDPA_EVE_PURPOSE',
          `pdpa.tool: purpose "${purpose}" is not in any entity's allowedPurposes in the policy — add it to the entity the tool needs`,
        )
      }
      return withTokenResolution(tool, { guard, sessionKey, purpose })
    },
    hook: pdpaHook({ guard, sessionKey }),
  }
}
