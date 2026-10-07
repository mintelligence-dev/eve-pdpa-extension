import { randomBytes } from 'node:crypto'
import {
  type Action,
  type CompiledPolicy,
  createGuard,
  definePolicy,
  ENTITY_TYPES,
  type EntityType,
  type TokenStore,
} from '@thai-pdpa-guard/core'

/** What a reader hands the scanner: a message, or a line it could not read. */
export type ReadItem =
  | {
      readonly kind: 'record'
      readonly line: number
      readonly id: string | null
      readonly text: string
    }
  | { readonly kind: 'bad'; readonly line: number; readonly problem: string }

/** One message that held personal data. Where it is and what kinds — never the values. */
export interface Hit {
  readonly line: number
  readonly id: string | null
  readonly entities: readonly EntityType[]
  readonly blocked?: true
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
  readonly unreadable: readonly { readonly line: number; readonly problem: string }[]
  /** Detectors that failed on at least one message. Those messages were not fully scanned. */
  readonly degradedDetectors: readonly string[]
}

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

export type Format = 'jsonl' | 'csv' | 'tsv'

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
  })

  const entities = Object.fromEntries(ENTITY_TYPES.map((e) => [e, 0])) as Record<EntityType, number>
  const actions: Partial<Record<Action, number>> = {}
  const hits: Hit[] = []
  const unreadable: { line: number; problem: string }[] = []
  let scanned = 0
  let blocked = 0
  let allowlisted = 0

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

    const kinds: EntityType[] = []
    for (const f of result.findings) {
      if (f.allowlisted === true) {
        allowlisted++
        continue
      }
      entities[f.entity]++
      actions[f.action] = (actions[f.action] ?? 0) + 1
      if (!kinds.includes(f.entity)) kinds.push(f.entity)
    }
    if (result.outcome === 'blocked') blocked++
    if (kinds.length > 0) {
      hits.push({
        line: item.line,
        id: item.id,
        entities: kinds,
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
    unreadable,
    degradedDetectors: [...degraded],
  }
}
