import { BUILTIN_DETECTORS } from './detectors/index.js'
import { createEngine } from './engine.js'
import { normalise, toOriginalSpan } from './normalise.js'
import type { AuditFinding, Detector, EntityType, Guard, ProcessOptions } from './types.js'

export interface StreamOptions extends ProcessOptions {
  /**
   * How many characters are kept back from the end before anything is sent on.
   * The detectors need to see what follows a value to be sure of it (an address
   * is only an address once its third part arrives), so this is both the
   * protection and the delay. Must be larger than the longest value you need
   * caught: the default of 128 covers every built-in type. Smaller is faster
   * and lets a long address through in pieces.
   */
  readonly holdBack?: number
  /**
   * The most text kept waiting for a safe place to cut, when a stream has no
   * spaces or newlines. Past it the text is cut anywhere that is not inside a
   * value already found. Default 512.
   */
  readonly maxPending?: number
  /** Replaces the built-in set, as for `createGuard`. Use the same ones. */
  readonly detectors?: readonly Detector[]
}

export interface StreamGuard {
  /** Text now safe to send on. May be empty: it is being held back. */
  push(chunk: string): Promise<string>
  /** Call once when the stream ends: the held-back text, protected. */
  end(): Promise<string>
  /**
   * True once a `block` rule fired. From then on `push` and `end` return ''.
   * **Text sent before that cannot be taken back.** For a `block` that must stop
   * the whole message, use `process` on the finished text instead.
   */
  readonly blocked: boolean
  /** Entity types that stopped the stream. Types only. */
  readonly blockedBy: readonly EntityType[]
}

/** Tokens and hash placeholders are one word with no spaces: never cut inside one. */
const PLACEHOLDER = /\S*(?:tok:|\[[A-Z_]+:)\S*/g
const LOOKBEHIND = 200
/** Stands in for a value already sent on. Not a digit, a letter or a separator. */
const BLANK = '\u00b7'

/**
 * Protects text that arrives in pieces, such as a model's reply as it streams.
 *
 * Text is held back until it is `holdBack` characters from the end and at a
 * place no value spans, then guarded and released. The text before it is kept,
 * with its values blanked, as context, so a cue such as "เลขบัญชี" just before
 * the cut still counts. Each released piece is one `guard.process` call, so it gets
 * its own audit event; the sum of the pieces is what one call on the whole
 * text would give, as far as the longest value is within `holdBack`.
 *
 * Latency is the cost: nothing newer than `holdBack` characters is sent until
 * the stream ends. Run it on the server.
 */
export function createStreamGuard(guard: Guard, options: StreamOptions = {}): StreamGuard {
  const { holdBack = 128, maxPending = 512, detectors, ...processOptions } = options
  if (
    !Number.isInteger(holdBack) ||
    holdBack < 0 ||
    !Number.isInteger(maxPending) ||
    maxPending < 1
  ) {
    throw new RangeError('holdBack must be a whole number ≥ 0 and maxPending one ≥ 1')
  }
  const engine = createEngine(detectors ?? BUILTIN_DETECTORS)
  let pending = ''
  let before = ''
  let blocked = false
  let blockedBy: readonly EntityType[] = []

  /** Where it is safe to cut: not inside a value, a placeholder or a surrogate pair. */
  async function cutPoint(limit: number): Promise<number> {
    if (limit <= 0) return 0
    const norm = normalise(before + pending)
    const found = await engine.run(norm, {
      sessionId: 'stream',
      boundary: processOptions.boundary ?? 'inbound',
    })
    const spans: [number, number][] = []
    for (const c of found.raw) {
      const [s, e] = toOriginalSpan(norm, c.start, c.end)
      spans.push([s - before.length, e - before.length])
    }
    for (const m of pending.matchAll(PLACEHOLDER)) {
      spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length])
    }
    const inside = (p: number) => spans.some(([s, e]) => s < p && p < e)
    const splitsPair = (p: number) => {
      const c = pending.charCodeAt(p - 1)
      return c >= 0xd800 && c <= 0xdbff
    }
    // A place the text breaks anyway, nearest the limit.
    for (let p = limit; p > 0; p--) {
      if (/\s/.test(pending.charAt(p - 1)) && !inside(p)) return p
    }
    if (pending.length < maxPending) return 0
    for (let p = limit; p > 0; p--) if (!inside(p) && !splitsPair(p)) return p
    return 0
  }

  /**
   * The segment as it was written, with each value found in it replaced by a
   * dot of the same length. The next piece is read against this, so a cue word
   * a little way back still counts, and sits exactly as far from the value as
   * it did in the whole text. Guarded output would not: a placeholder is
   * shorter than the number it replaced.
   */
  function blanked(segment: string, offset: number, findings: readonly AuditFinding[]): string {
    let out = ''
    let at = 0
    for (const f of [...findings].sort((x, y) => x.start - y.start)) {
      const s = f.start - offset
      const e = f.end - offset
      if (s < at || e > segment.length) continue
      out += segment.slice(at, s) + BLANK.repeat(e - s)
      at = e
    }
    return out + segment.slice(at)
  }

  async function release(cut: number): Promise<string> {
    if (cut <= 0) return ''
    const segment = pending.slice(0, cut)
    pending = pending.slice(cut)
    let offset = before.length
    let result = await guard.process(before + segment, processOptions)
    // The text before the cut is only there to be read. If it came back
    // changed, do not guess where it ends: guard the segment alone.
    let text = ''
    if (result.outcome === 'processed' && result.text.startsWith(before)) {
      text = result.text.slice(before.length)
    } else if (result.outcome === 'processed') {
      offset = 0
      before = ''
      result = await guard.process(segment, processOptions)
      text = result.text
    }
    if (result.outcome === 'blocked') {
      blocked = true
      blockedBy = result.blockedBy ?? []
      pending = ''
      return ''
    }
    before = (before + blanked(segment, offset, result.findings)).slice(-LOOKBEHIND)
    return text
  }

  return {
    async push(chunk) {
      if (blocked) return ''
      pending += chunk
      return release(await cutPoint(pending.length - holdBack))
    },
    async end() {
      if (blocked) return ''
      const out = await release(pending.length)
      pending = ''
      return out
    },
    get blocked() {
      return blocked
    },
    get blockedBy() {
      return blockedBy
    },
  }
}

/**
 * `createStreamGuard` over an async iterable of strings, such as a model's
 * stream. Yields protected text; stops, with nothing more, if a `block` rule
 * fires — check `blocked` on the guard if you need to know.
 */
export async function* protectStream(
  source: AsyncIterable<string>,
  guard: Guard,
  options?: StreamOptions,
): AsyncGenerator<string> {
  const stream = createStreamGuard(guard, options)
  for await (const chunk of source) {
    const out = await stream.push(chunk)
    if (out !== '') yield out
    if (stream.blocked) return
  }
  const rest = await stream.end()
  if (rest !== '') yield rest
}
