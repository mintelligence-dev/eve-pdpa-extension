import { rank } from './engine.js'
import type { Action, Candidate } from './types.js'

/** A candidate past its threshold, with what the policy will do to it. */
export interface Claim extends Candidate {
  readonly action: Action
  /** Let through by the allowlist, judged on its own value (D1). */
  readonly allowlisted: boolean
}

export type Settled<T extends Claim> = T & {
  /** The span covers more than this claim's own value: other claims overlapped it. */
  readonly widened: boolean
}

/** Changes what leaves: rewrites the span, or stops the message. */
function hides(c: Claim): boolean {
  return !c.allowlisted && c.action !== 'flag'
}

/**
 * Which action speaks for characters two claims share (D19). A block first:
 * the policy said the message must not go out. Then a token, which hides the
 * value from the model as fully as a placeholder and still lets an allowed
 * purpose turn it back — a placeholder in its place would leave the call-back
 * or OTP tool with nothing to send to. Then by how much of the value is left
 * in what goes out: nothing, a link between two messages, the shape and maybe
 * the last four, all of it.
 */
const SPEAKS_FIRST: readonly Action[] = ['block', 'tokenise', 'redact', 'hash', 'mask', 'flag']

/**
 * The claim whose action comes first in SPEAKS_FIRST speaks for a span.
 * Between equals the sentence decides — a claim that yields to the other's
 * entity gives way — then the engine's ranking, as before (D19).
 */
function outranks(a: Claim, b: Claim): boolean {
  const byAction = SPEAKS_FIRST.indexOf(a.action) - SPEAKS_FIRST.indexOf(b.action)
  if (byAction !== 0) return byAction < 0
  if (a.yieldsTo === b.entity) return false
  if (b.yieldsTo === a.entity) return true
  return rank(a, b) < 0
}

/**
 * One finding per stretch of text, decided after the policy has judged every
 * candidate on its own (D18).
 *
 * The engine merges with no policy in hand, so a reading the policy was about
 * to drop could win the span and take the real value down with it: a 13-digit
 * Visa also reads as a national id that fails its checksum, scores 0.2, ties on
 * length and wins on priority. Every claim here has already passed its
 * threshold, and the rule is the one a leak is measured by — every character
 * that a claim would hide is hidden.
 *
 *  - Hiding claims that overlap become one span covering all of them, spoken
 *    for by the one whose action comes first (`outranks`). Trimming the
 *    others instead would hash or tokenise half a value.
 *  - A hiding claim beats one that is only flagged or allowlisted: flagging
 *    phone numbers must not leave a bank account read off the same digits in
 *    the clear.
 *  - Except wholly inside an allowlisted value. Those characters are ones the
 *    policy vouched for — the shop's sales0812345678@… address holds a phone
 *    number, and stays as written.
 */
export function settleOverlaps<T extends Claim>(
  claims: readonly T[],
  length: number,
): Settled<T>[] {
  const settled: Settled<T>[] = []
  const taken = new Uint8Array(length)
  const vouched = claims.filter((c) => c.allowlisted).sort((a, b) => a.start - b.start)
  const hiding = claims.filter(hides).sort((a, b) => a.start - b.start)

  let group: T[] = []
  let groupEnd = 0
  const close = (): void => {
    const first = group[0]
    if (first === undefined) return
    let speaker = first
    for (const c of group) if (outranks(c, speaker)) speaker = c
    const widened = first.start !== speaker.start || groupEnd !== speaker.end
    settled.push({ ...speaker, start: first.start, end: groupEnd, widened })
    taken.fill(1, first.start, groupEnd)
    group = []
  }

  // Both lists run by start, so of the allowlisted spans that start at or
  // before a claim, only the one reaching furthest can contain it.
  let v = 0
  let reach = 0
  for (const c of hiding) {
    for (let w = vouched[v]; w !== undefined && w.start <= c.start; w = vouched[++v]) {
      reach = Math.max(reach, w.end)
    }
    if (reach >= c.end) continue
    if (c.start >= groupEnd) close()
    groupEnd = group.length === 0 ? c.end : Math.max(groupEnd, c.end)
    group.push(c)
  }
  close()

  // What is left changes nothing in the text. The engine's rule is enough for
  // it, as long as a stretch already hidden is never handed to it.
  next: for (const c of claims.filter((x) => !hides(x)).sort(rank)) {
    for (let i = c.start; i < c.end; i++) if (taken[i] === 1) continue next
    taken.fill(1, c.start, c.end)
    settled.push({ ...c, widened: false })
  }

  return settled.sort((a, b) => a.start - b.start)
}
