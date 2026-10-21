import { type Scope, signRequest } from '../src/signature.js'

// At least 32 bytes each, and different: the gateway refuses anything else.
export const SECRET = 'test-gateway-secret-0123456789abcdef'
export const RESOLVE_SECRET = 'test-resolve-secret-fedcba9876543210'

export const FORWARD_TO = 'https://answers.example/inbound'
export const REPLY_TO = 'https://chat-app.example/reply'

export interface Sent {
  readonly url: string
  readonly headers: Headers
  readonly body: string
}

/** A fetch that records what was sent and answers with `status`, or throws when status is 'throw'. */
export function recorder(status: number | 'throw' = 200): {
  sent: Sent[]
  fetch: typeof fetch
} {
  const sent: Sent[] = []
  const fake = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    sent.push({ url: String(url), headers: new Headers(init?.headers), body: String(init?.body) })
    if (status === 'throw') throw new TypeError('fetch failed')
    return new Response('ok', { status })
  }
  return { sent, fetch: fake as typeof fetch }
}

/** A POST to the gateway, signed with `secret` at `now` for `scope` — /inbound unless named. */
export async function signed(
  body: unknown,
  {
    secret = SECRET,
    now,
    scope = 'inbound',
  }: { secret?: string; now?: number; scope?: Scope } = {},
): Promise<Request> {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  const headers = await signRequest(secret, scope, text, now)
  return new Request('https://hook.example/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: text,
  })
}

/**
 * Upstash's REST API over a Map, as far as the token store uses it: GET, SET
 * with PX, DEL, SADD, SMEMBERS, PEXPIRE, one command at / or many at
 * /pipeline. Expiry follows Date.now(), so fake timers move it.
 */
export function fakeUpstash(): {
  fetch: typeof fetch
  commands: string[][]
  /** The REST path each request went to: '' for one command, '/pipeline', '/multi-exec'. */
  paths: string[]
  keys: () => string[]
} {
  const strings = new Map<string, { value: string; expiresAt: number | null }>()
  const sets = new Map<string, { members: Set<string>; expiresAt: number | null }>()
  const commands: string[][] = []
  const paths: string[] = []

  const live = <T extends { expiresAt: number | null }>(map: Map<string, T>, key: string) => {
    const entry = map.get(key)
    if (entry === undefined) return undefined
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      map.delete(key)
      return undefined
    }
    return entry
  }

  function run(cmd: string[]): unknown {
    commands.push(cmd)
    const [name, key = '', ...rest] = cmd
    switch (name) {
      case 'GET':
        return live(strings, key)?.value ?? null
      case 'SET': {
        const px = rest.indexOf('PX')
        const expiresAt = px === -1 ? null : Date.now() + Number(rest[px + 1])
        strings.set(key, { value: rest[0] as string, expiresAt })
        return 'OK'
      }
      case 'DEL': {
        let n = 0
        for (const k of [key, ...rest]) {
          if (strings.delete(k) || sets.delete(k)) n++
        }
        return n
      }
      case 'SADD': {
        const entry = live(sets, key) ?? { members: new Set<string>(), expiresAt: null }
        for (const m of rest) entry.members.add(m)
        sets.set(key, entry)
        return rest.length
      }
      case 'SMEMBERS':
        return [...(live(sets, key)?.members ?? [])]
      case 'PEXPIRE': {
        const entry = live(sets, key) ?? live(strings, key)
        if (entry === undefined) return 0
        entry.expiresAt = Date.now() + Number(rest[0])
        return 1
      }
      default:
        throw new Error(`fake upstash: ${name} is not supported`)
    }
  }

  const fake = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body))
    const path = /\/(pipeline|multi-exec)$/.exec(String(url))?.[0] ?? ''
    paths.push(path)
    // One process, run in turn: a transaction here is atomic by construction.
    if (path !== '') {
      return Response.json((body as string[][]).map((cmd) => ({ result: run(cmd) })))
    }
    return Response.json({ result: run(body as string[]) })
  }

  return {
    fetch: fake as typeof fetch,
    commands,
    paths,
    keys: () =>
      [...strings.keys(), ...sets.keys()].filter((k) => live(strings, k) ?? live(sets, k)),
  }
}
