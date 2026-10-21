import { createMemoryTokenStore, type TokenStore } from '@eve-pdpa-extension/core'
import { createUpstashTokenStore } from '@eve-pdpa-extension/http'
import { envOneOf, isProduction } from './env.js'

/**
 * Where tokens and the real values behind them live until they expire.
 *
 * - Upstash Redis when its REST URL and token are set: shared by every
 *   function instance, as tokenise needs on Vercel.
 * - Otherwise core's in-memory store, for `eve dev` and tests. One store per
 *   process, kept on globalThis because eve loads the channel, hook and tool
 *   modules separately: each would otherwise get a store of its own and a
 *   token issued by the channel could never be resolved by the tool.
 *
 * In production there is no in-memory fallback: separate serverless
 * instances would each hold their own tokens, so the agent refuses to start.
 */
function build(): TokenStore {
  const url = envOneOf('UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL')
  const token = envOneOf('UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN')
  if (url !== undefined && token !== undefined) return createUpstashTokenStore({ url, token })
  if (isProduction()) {
    throw new Error(
      'set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN: the policy tokenises, and an in-memory ' +
        'token store is not shared between serverless instances',
    )
  }
  const shared = Symbol.for('eve-pdpa-extension.pdpa-agent.memory-store')
  const g = globalThis as typeof globalThis & { [shared]?: TokenStore }
  g[shared] ??= createMemoryTokenStore()
  return g[shared]
}

export const tokenStore: TokenStore = build()
