/**
 * A token store on Upstash Redis, reached over its REST API with fetch.
 *
 * On a serverless platform each request may run on a different machine, and a
 * machine is shut down when idle: a token kept in memory by the one that
 * issued it is gone before /resolve asks for it. Every machine reads and
 * writes here instead. REST rather than the Redis protocol, so there is no
 * connection to hold open between invocations and no dependency to add.
 *
 * Redis holds the real values until they expire. Keep tokens short-lived, and
 * guard the REST token as closely as the webhook's resolveSecret.
 */
import type { TokenRecord, TokenStore } from '@eve-pdpa-extension/core'
import { PdpaHttpError } from './errors.js'

export interface UpstashTokenStoreOptions {
  /** UPSTASH_REDIS_REST_URL. https, or http to localhost for a local stand-in. */
  readonly url: string
  /** UPSTASH_REDIS_REST_TOKEN. A token that can write: it sets and deletes keys. */
  readonly token: string
  /** Put in front of every key, so one database can serve more than this. Default `pdpa:`. */
  readonly prefix?: string
  /** A request that takes longer is abandoned and the store treated as down. Default 2000. */
  readonly timeoutMs?: number
  /** For tests. */
  readonly fetch?: typeof fetch
}

/**
 * How long a chat's list of token ids outlives the newest token added to it.
 * A token lives at most an hour (core's ttlSec cap), so a list renewed for an
 * hour on every add is still there when its last token expires — and endSession
 * finds every one. Longer only for a token that somehow lives longer.
 */
const SESSION_INDEX_MS = 3_600_000

const DEFAULT_TIMEOUT_MS = 2000

function storeError(message: string): PdpaHttpError {
  return new PdpaHttpError('ERR_PDPA_HTTP_STORE', message)
}

function checkUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new PdpaHttpError('ERR_PDPA_HTTP_CONFIG', 'url must be the Upstash REST URL')
  }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
    throw new PdpaHttpError(
      'ERR_PDPA_HTTP_CONFIG',
      'url must be https: the store carries real values and its REST token',
    )
  }
  return parsed.href.replace(/\/+$/, '')
}

/** A stored record read back. Anything else means the key was written by something else. */
function toRecord(raw: unknown): TokenRecord {
  if (typeof raw !== 'string') throw storeError('Upstash returned a token that is not a string')
  let rec: unknown
  try {
    rec = JSON.parse(raw)
  } catch {
    throw storeError('Upstash returned a token that is not JSON')
  }
  const r = rec as Partial<TokenRecord> | null
  if (
    r === null ||
    typeof r !== 'object' ||
    typeof r.value !== 'string' ||
    typeof r.entity !== 'string' ||
    typeof r.sessionId !== 'string' ||
    !Array.isArray(r.purposes) ||
    typeof r.expiresAt !== 'number'
  ) {
    throw storeError('Upstash returned a token record of the wrong shape')
  }
  return r as TokenRecord
}

export function createUpstashTokenStore(options: UpstashTokenStoreOptions): TokenStore {
  const base = checkUrl(options.url)
  if (typeof options.token !== 'string' || options.token === '') {
    throw new PdpaHttpError('ERR_PDPA_HTTP_CONFIG', 'token must be the Upstash REST token')
  }
  const prefix = options.prefix ?? 'pdpa:'
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const doFetch = options.fetch ?? globalThis.fetch
  const tokKey = (id: string): string => `${prefix}tok:${id}`
  const sessionKey = (sessionId: string): string => `${prefix}session:${sessionId}`

  /**
   * One POST. Errors name what failed, never the request: its body holds a
   * real value, and its URL and headers the database and the REST token.
   */
  async function post(path: string, body: unknown): Promise<unknown> {
    let res: Response
    try {
      res = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      const why = error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'failed'
      throw storeError(`Upstash request ${why}`)
    }
    if (!res.ok) throw storeError(`Upstash answered HTTP ${res.status}`)
    try {
      return await res.json()
    } catch {
      throw storeError('Upstash answered with something that is not JSON')
    }
  }

  async function command(args: readonly string[]): Promise<unknown> {
    const reply = (await post('', args)) as { result?: unknown; error?: unknown } | null
    if (reply === null || typeof reply !== 'object' || 'error' in reply) {
      throw storeError('Upstash refused a command')
    }
    return reply.result
  }

  /**
   * Commands run as one transaction (MULTI/EXEC): no other client's command
   * lands between them. A pipeline only saves round trips — another machine's
   * write can fall in the middle, and one command can fail while the rest
   * apply (D22). The results, in order.
   */
  async function transaction(commands: readonly (readonly string[])[]): Promise<unknown[]> {
    const replies = await post('/multi-exec', commands)
    if (!Array.isArray(replies) || replies.length !== commands.length) {
      throw storeError('Upstash answered a transaction with the wrong number of replies')
    }
    return replies.map((reply) => {
      if (reply === null || typeof reply !== 'object' || 'error' in reply) {
        throw storeError('Upstash refused a command')
      }
      return (reply as { result?: unknown }).result
    })
  }

  return {
    sync: false,

    async set(id, rec) {
      const now = Date.now()
      const ttl = Math.max(1, rec.expiresAt - now)
      const session = sessionKey(rec.sessionId)
      // Together: a token stored but missing from its chat's list could never
      // be found by clearSession.
      await transaction([
        ['SET', tokKey(id), JSON.stringify(rec), 'PX', String(ttl)],
        ['SADD', session, id],
        ['PEXPIRE', session, String(Math.max(SESSION_INDEX_MS, ttl))],
      ])
    },

    async get(id) {
      const raw = await command(['GET', tokKey(id)])
      return raw === null ? undefined : toRecord(raw)
    },

    async delete(id) {
      await command(['DEL', tokKey(id)])
    },

    async clearSession(sessionId) {
      // The list is read and removed in one step. Read, then removed later, a
      // token another machine added in between lost its place on the list
      // while it stayed resolvable (D22). Added after this step, it starts a
      // new list, and the next clearSession finds it.
      const session = sessionKey(sessionId)
      const [ids] = await transaction([
        ['SMEMBERS', session],
        ['DEL', session],
      ])
      if (!Array.isArray(ids))
        throw storeError('Upstash returned a session list that is not a list')
      const keys = ids.filter((id): id is string => typeof id === 'string').map(tokKey)
      if (keys.length > 0) await command(['DEL', ...keys])
    },
  }
}
