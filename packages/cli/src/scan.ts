import { randomBytes, randomFillSync } from 'node:crypto'
import {
  type Action,
  actionFor,
  BUILTIN_DETECTORS,
  type CompiledPolicy,
  createEngine,
  createGuard,
  definePolicy,
  ENTITY_TYPES,
  type EntityType,
  normalise,
  type TokenStore,
} from '@thai-pdpa-guard/core'

/** What a reader hands the scanner: a message, or a line it could not read. */
export type ReadItem =
  | {
      readonly kind: 'record'
      readonly line: number
      readonly id: string | null
      readonly text: string
      /** Who wrote it, where the export says. LINE OA only. */
      readonly sender?: Sender
    }
  | { readonly kind: 'bad'; readonly line: number; readonly problem: string }

/** `customer` wrote it, or the `shop` did — staff or an auto-reply. Never a name. */
export type Sender = 'customer' | 'shop'

/** One message that held personal data. Where it is and what kinds — never the values. */
export interface Hit {
  readonly line: number
  readonly id: string | null
  readonly entities: readonly EntityType[]
  readonly sender?: Sender
  readonly blocked?: true
}

export interface SenderCount {
  readonly scanned: number
  readonly withFindings: number
  /** Values found, allowlisted ones excluded. */
  readonly values: number
}

export interface ScanReport {
  readonly file: string
  readonly format: Format
  /** `default` reports every entity and rewrites nothing; `file` is the user's policy. */
  readonly policy: { readonly source: 'default' | 'file'; readonly hash: string }
  readonly records: {
    readonly scanned: number
    readonly withFindings: number
    readonly blocked: number
    readonly unreadable: number
  }
  /** Values found per entity, allowlisted ones excluded. */
  readonly entities: Readonly<Record<EntityType, number>>
  /** `file` policy only: what the policy would have done with each value. */
  readonly actions?: Readonly<Partial<Record<Action, number>>>
  /** Values found and let through by the policy's allowlist. */
  readonly allowlisted: number
  readonly hits: readonly Hit[]
  /**
   * LINE OA only: the same counts split by who wrote the message. Staff type
   * customers' data too — "sent the OTP to 091…" — so both sides are scanned.
   */
  readonly senders?: Readonly<Record<Sender, SenderCount>>
  /**
   * Found by a detector, but below the rule's minConfidence, so the policy did
   * nothing with them. Most are not personal data — that is what the
   * threshold is for — but the count says how much rests on it.
   */
  readonly belowThreshold: {
    readonly entities: Readonly<Partial<Record<EntityType, ThresholdCount>>>
    readonly hits: readonly Hit[]
  }
  readonly unreadable: readonly { readonly line: number; readonly problem: string }[]
  /** Detectors that failed on at least one message. Those messages were not fully scanned. */
  readonly degradedDetectors: readonly string[]
}

export interface ThresholdCount {
  readonly count: number
  /** The rule's minConfidence, or the guard's default. */
  readonly threshold: number
  readonly lowest: number
  readonly highest: number
}

/**
 * The guard's threshold when a rule names none. Mirrors guard.ts; the
 * below-threshold tests fail if the two drift apart.
 */
const DEFAULT_MIN_CONFIDENCE = 0.95

/** Every entity flagged: found and counted, nothing rewritten. */
export const DEFAULT_POLICY: CompiledPolicy = definePolicy({
  entitySet: '0.1',
  entities: Object.fromEntries(ENTITY_TYPES.map((e) => [e, { action: 'flag' }])),
})

/**
 * Tokens issued during a scan are never resolved, so nothing is kept. A real
 * store would fill up over a large file and start blocking messages, which
 * would show up in the report as something the policy did not do.
 */
const DISCARD_STORE: TokenStore = {
  sync: true,
  set() {},
  get: () => undefined,
  delete() {},
  clearSession() {},
}

export type Format = 'jsonl' | 'csv' | 'tsv' | 'line-oa'

export interface ScanOptions {
  readonly file: string
  readonly format: Format
  readonly policy?: CompiledPolicy
}

/**
 * Runs every message through a guard and counts what it found.
 *
 * The report holds positions, types and the app's own ids. It never holds a
 * value, a masked value, or the text around one — a DPO should be able to
 * paste it into a ticket.
 */
export async function scan(items: AsyncIterable<ReadItem>, opts: ScanOptions): Promise<ScanReport> {
  const policy = opts.policy ?? DEFAULT_POLICY
  const degraded = new Set<string>()
  const guard = createGuard({
    policy,
    // The audit trail of a scan is this report; events are read only for the
    // one thing a result does not carry — a detector that failed on a message.
    onAudit: (e) => {
      if (e.type === 'scan') for (const d of e.degradedDetectors) degraded.add(d)
    },
    tokenStore: DISCARD_STORE,
    // hash output is never shown, so any key will do; a fresh one per run
    // means nothing about it outlives the scan.
    hmacKey: new Uint8Array(randomBytes(32)),
    // Node 18 has no globalThis.crypto, and core cannot import node:crypto
    // (D7), so a tokenising policy would stop the scan there. The CLI only
    // ever runs on Node, so it hands core Node's CSPRNG directly.
    randomSource: (n) => randomFillSync(new Uint8Array(n)),
  })

  // The guard drops a candidate under the threshold before anything else sees
  // it. The same detectors, run again here, show what was dropped.
  const engine = createEngine(BUILTIN_DETECTORS)
  const weak: Partial<Record<EntityType, ThresholdCount>> = {}
  const weakHits: Hit[] = []

  const entities = Object.fromEntries(ENTITY_TYPES.map((e) => [e, 0])) as Record<EntityType, number>
  const actions: Partial<Record<Action, number>> = {}
  const hits: Hit[] = []
  const unreadable: { line: number; problem: string }[] = []
  let scanned = 0
  let blocked = 0
  let allowlisted = 0
  const senders: Record<Sender, { scanned: number; withFindings: number; values: number }> = {
    customer: { scanned: 0, withFindings: 0, values: 0 },
    shop: { scanned: 0, withFindings: 0, values: 0 },
  }
  let sawSender = false

  for await (const item of items) {
    if (item.kind === 'bad') {
      unreadable.push({ line: item.line, problem: item.problem })
      continue
    }
    scanned++
    // One session per message, ended straight after: a tokenising policy
    // needs one (D10.4), and the tokeniser's index must not grow with the file.
    const sessionId = `scan:${item.line}`
    const result = await guard.process(item.text, { sessionId })
    await guard.endSession(sessionId)

    const side = item.sender === undefined ? undefined : senders[item.sender]
    if (side !== undefined) {
      sawSender = true
      side.scanned++
    }
    const from = item.sender === undefined ? {} : { sender: item.sender }

    const kinds: EntityType[] = []
    for (const f of result.findings) {
      if (f.allowlisted === true) {
        allowlisted++
        continue
      }
      if (side !== undefined) side.values++
      entities[f.entity]++
      actions[f.action] = (actions[f.action] ?? 0) + 1
      if (!kinds.includes(f.entity)) kinds.push(f.entity)
    }
    if (result.outcome === 'blocked') blocked++

    const weakKinds: EntityType[] = []
    const detected = await engine.run(normalise(item.text), { sessionId, boundary: 'inbound' })
    for (const c of detected.candidates) {
      // An entity the policy ignores is ignored at any confidence.
      if (actionFor(policy, c.entity) === null) continue
      const threshold = policy.entities[c.entity]?.minConfidence ?? DEFAULT_MIN_CONFIDENCE
      if (c.confidence >= threshold) continue
      const was = weak[c.entity]
      weak[c.entity] = {
        count: (was?.count ?? 0) + 1,
        threshold,
        lowest: Math.min(was?.lowest ?? 1, c.confidence),
        highest: Math.max(was?.highest ?? 0, c.confidence),
      }
      if (!weakKinds.includes(c.entity)) weakKinds.push(c.entity)
    }
    if (weakKinds.length > 0) {
      weakHits.push({ line: item.line, id: item.id, entities: weakKinds, ...from })
    }
    if (kinds.length > 0) {
      if (side !== undefined) side.withFindings++
      hits.push({
        line: item.line,
        id: item.id,
        entities: kinds,
        ...from,
        ...(result.outcome === 'blocked' ? { blocked: true as const } : {}),
      })
    }
  }

  return {
    file: opts.file,
    format: opts.format,
    policy: { source: opts.policy === undefined ? 'default' : 'file', hash: policy.hash },
    records: { scanned, withFindings: hits.length, blocked, unreadable: unreadable.length },
    entities,
    ...(opts.policy === undefined ? {} : { actions }),
    allowlisted,
    hits,
    ...(sawSender ? { senders } : {}),
    belowThreshold: { entities: weak, hits: weakHits },
    unreadable,
    degradedDetectors: [...degraded],
  }
}
