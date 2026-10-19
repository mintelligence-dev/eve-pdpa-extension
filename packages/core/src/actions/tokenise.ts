import { sha256 } from '../crypto/sha256.js'
import { encodeLetters, TOKEN_ID_PATTERN, tokenId } from '../random.js'
import type { EntityRule, EntityType, RandomSource, ResolveReason, TokenRecord } from '../types.js'

/** D6: long enough for an OTP flow. */
export const DEFAULT_TTL_SEC = 300
/** D6: the most a policy may set. */
export const MAX_TTL_SEC = 3600

/**
 * One token, spelt any way an outbound reply is read in (`TOKEN_IN_REPLY` in
 * guard.ts): it reaches resolve through an AI's tool call, and a model copying
 * `[tok:…]` drops a bracket or lets a space in as readily in a tool argument
 * as in a reply. Or the bare id. Never a token inside a sentence — with two
 * in one, there is no telling which was meant (D21).
 */
const TOKEN = new RegExp(`^(?:\\[?\\s*tok:(${TOKEN_ID_PATTERN})\\s*\\]?|(${TOKEN_ID_PATTERN}))$`)

/** Quotes a model may put round what it copies. Spaces are trimmed as well. */
const QUOTES = new Set(['"', "'", '`', '“', '”', '‘', '’'])

/**
 * Longer than any way of writing one token: `[tok:` + 16 letters + `]` with
 * spaces and quotes round it. Anything longer is not a token, and is not read
 * further — resolve takes a model's tool argument, which has no length limit.
 */
const MAX_TOKEN_INPUT = 256

const wrapping = (ch: string): boolean => QUOTES.has(ch) || ch.trim() === ''

/**
 * The value without the spaces and quotes round it. Two index walks, not a
 * regex: `^[…]+|[…]+$` retries from every position of a long inner run, and
 * took 0.8 s on 40,000 spaces (D22).
 */
function unwrap(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && wrapping(value[start] as string)) start++
  while (end > start && wrapping(value[end - 1] as string)) end--
  return value.slice(start, end)
}

const encoder = new TextEncoder()

/** Twice the default store size: room for the store to fill before the index is swept. */
const REUSE_INDEX_LIMIT = 20_000

/**
 * The id inside a token, or null when the input is not a token at all.
 *
 * Null rather than a best guess: whatever was passed in goes nowhere near the
 * audit log unless it has the exact shape of an id this guard issues. A caller
 * that hands over a raw phone number by mistake gets not_found, and the number
 * is not written down anywhere.
 */
export function parseTokenId(token: string): string | null {
  if (token.length > MAX_TOKEN_INPUT) return null
  const m = TOKEN.exec(unwrap(token))
  return m === null ? null : (m[1] ?? m[2] ?? null)
}

/**
 * D6, checked in this order, first failure wins:
 *   not_found → session_mismatch → expired → purpose_not_allowed
 *
 * Session before expiry, so a token from another session is reported as such
 * even after it has expired. Purpose last, so a refusal on purpose always means
 * a live token in the right session was asked for for the wrong reason — the
 * case worth investigating.
 */
export function judge(
  rec: TokenRecord | undefined,
  sessionId: string,
  purpose: string,
  now: number,
): ResolveReason | null {
  if (rec === undefined) return 'not_found'
  if (rec.sessionId !== sessionId) return 'session_mismatch'
  if (rec.expiresAt <= now) return 'expired'
  if (!rec.purposes.includes(purpose)) return 'purpose_not_allowed'
  return null
}

/**
 * A token store call the tokeniser needs made. Yielded rather than made
 * directly, so one copy of the logic serves a sync store (processSync) and an
 * async one (process): the guard's driver performs the call, synchronously or
 * with await, and sends the result back in. A store that throws or rejects is
 * thrown back in at the same point.
 */
export type StoreStep =
  | { readonly op: 'get'; readonly id: string }
  | { readonly op: 'set'; readonly id: string; readonly rec: TokenRecord }

export interface Tokeniser {
  /** Yields the store calls it needs; returns the token id, reusing one already issued in the session. */
  issue(
    sessionId: string,
    entity: EntityType,
    canonical: string,
    rule: EntityRule,
    display: string | undefined,
  ): Generator<StoreStep, string, unknown>
  forgetSession(sessionId: string): void
}

/**
 * Issues tokens against a sync store.
 *
 * The same value in the same session gets the same token (D8.4): a customer who
 * repeats their number should not look like a customer with two numbers. The
 * value stored is the CANONICAL form, which is what makes reuse possible — two
 * spellings of one number cannot share a token if the token remembers both. It
 * is also the form a tool wants: 0918887777, not ๐๙๑-๘๘๘-๗๗๗๗.
 *
 * Reuse does not extend the lifetime. TTL runs from the first issue, or a long
 * conversation would keep a token alive indefinitely.
 *
 * The reuse index is keyed by a digest, not the value, so this map holds no
 * second plaintext copy of anything the store already has.
 */
export function createTokeniser(random: RandomSource): Tokeniser {
  /** Per session: value digest → the token issued for it, and when that token expires. */
  const reuse = new Map<string, Map<string, { id: string; expiresAt: number }>>()
  let entries = 0

  /**
   * Sessions that never call endSession would otherwise grow the index forever.
   * Past the limit, drop every entry whose token has expired, then — if that is
   * not enough — the oldest, until the index is back under it.
   *
   * Read from the index alone, never the store. Asking the store about each
   * entry was 20,000 calls in one message against a remote store such as
   * Upstash, and one failed call blocked a message whose token was already
   * stored (D22). The index only decides reuse: an entry dropped early means a
   * repeated value gets a second token, which is valid too.
   */
  function prune(): void {
    const now = Date.now()
    for (const [sessionId, session] of reuse) {
      for (const [key, entry] of session) {
        if (entry.expiresAt <= now) {
          session.delete(key)
          entries--
        }
      }
      if (session.size === 0) reuse.delete(sessionId)
    }
    // Sessions in the order they were first indexed: the oldest go first.
    for (const [sessionId, session] of reuse) {
      if (entries <= REUSE_INDEX_LIMIT) break
      entries -= session.size
      reuse.delete(sessionId)
    }
  }

  return {
    // Under process(), two messages in one session can interleave at a yield,
    // so the same value arriving twice at once may get two tokens. Both are
    // valid and both resolve; reuse is a convenience for the model, not a
    // guarantee the store depends on.
    *issue(sessionId, entity, canonical, rule, display) {
      const key = encodeLetters(sha256(encoder.encode(`${entity}\u0000${canonical}`)))
      let session = reuse.get(sessionId)

      const existing = session?.get(key)
      if (existing !== undefined) {
        // Expired by the index's own clock: no need to ask the store.
        if (existing.expiresAt > Date.now()) {
          const rec = (yield { op: 'get', id: existing.id }) as TokenRecord | undefined
          if (rec !== undefined && rec.sessionId === sessionId && rec.expiresAt > Date.now()) {
            return existing.id
          }
        }
        session?.delete(key)
        entries--
      }

      const id = tokenId(random)
      const ttl = rule.ttlSec ?? DEFAULT_TTL_SEC
      // Throws when the store cannot take it. The guard turns that into a
      // blocked message (D4 level 2); nothing is indexed for a token never stored.
      const rec: TokenRecord = {
        value: canonical,
        entity,
        sessionId,
        purposes: rule.allowedPurposes ?? [],
        expiresAt: Date.now() + ttl * 1000,
        ...(display === undefined ? {} : { display }),
      }
      yield { op: 'set', id, rec }

      if (session === undefined) {
        session = new Map()
        reuse.set(sessionId, session)
      }
      session.set(key, { id, expiresAt: rec.expiresAt })
      entries++
      if (entries > REUSE_INDEX_LIMIT) prune()
      return id
    },

    forgetSession(sessionId) {
      entries -= reuse.get(sessionId)?.size ?? 0
      reuse.delete(sessionId)
    },
  }
}
