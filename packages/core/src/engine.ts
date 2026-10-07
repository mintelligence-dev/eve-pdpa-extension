import type { Candidate, DetectContext, Detector, EntityType, NormalisedText } from './types.js'

/**
 * Which entity wins when two candidates cover exactly the same number of
 * characters. Length decides first; this list only breaks the tie.
 *
 * Ordered by how much evidence the entity carries. An id or a card number has
 * a checksum behind it, an email has a shape nothing else takes, and a bare
 * digit run claimed as a bank account is the weakest claim we make. Fixed here
 * rather than read off confidence, because each detector sets confidence on its
 * own scale and comparing those numbers across detectors means nothing.
 *
 * ENTITY_TYPES is declaration order and carries no meaning; this is separate on
 * purpose.
 */
const MERGE_PRIORITY: readonly EntityType[] = [
  'TH_NATIONAL_ID',
  'CREDIT_CARD',
  'EMAIL',
  'LINE_USER_ID',
  'PHONE',
  'BANK_ACCOUNT',
]

function priorityOf(entity: EntityType): number {
  const i = MERGE_PRIORITY.indexOf(entity)
  return i === -1 ? MERGE_PRIORITY.length : i
}

export interface EngineResult {
  /** Merged, non-overlapping, ordered by position. Offsets index the NORMALISED text. */
  readonly candidates: readonly Candidate[]
  /** Ran and threw. The scan still produced a result. D4 level 1. */
  readonly degradedDetectors: readonly string[]
  /** Never ran — an async detector inside a sync call. */
  readonly skippedDetectors: readonly string[]
}

export interface Engine {
  readonly detectorIds: readonly string[]
  /** Union of every loaded detector's entities. What this build can see at all. */
  readonly entitiesSupported: readonly EntityType[]
  runSync(input: NormalisedText, ctx: DetectContext): EngineResult
  run(input: NormalisedText, ctx: DetectContext): Promise<EngineResult>
}

/**
 * Drops anything a detector cannot have meant.
 *
 * A reversed or out-of-range span would slice the outgoing message at the wrong
 * place, so a buggy detector could corrupt text rather than protect it. Cheaper
 * to refuse the candidate here than to reason about it in every action.
 */
function isUsableSpan(c: Candidate, length: number): boolean {
  return (
    Number.isInteger(c.start) &&
    Number.isInteger(c.end) &&
    c.start >= 0 &&
    c.end <= length &&
    c.start < c.end
  )
}

/**
 * One winner per stretch of text: the longest candidate takes it.
 *
 * Two detectors claiming the same characters cannot both apply an action, and a
 * partially covered value is not partially protected — 12 of 13 digits still
 * gives the last one away (D5). So coverage decides, and the shorter claim is
 * dropped rather than trimmed.
 *
 * Measurement is a different question: precision and recall count overlapping
 * entities separately and do not cancel out (D5). That happens on the benchmark's
 * own records, not here.
 */
function mergeOverlaps(candidates: readonly Candidate[], length: number): Candidate[] {
  const ranked = [...candidates].sort((a, b) => {
    const byLength = b.end - b.start - (a.end - a.start)
    if (byLength !== 0) return byLength
    const byPriority = priorityOf(a.entity) - priorityOf(b.entity)
    if (byPriority !== 0) return byPriority
    // Everything below only exists so two runs over the same input agree.
    if (a.start !== b.start) return a.start - b.start
    return a.detector < b.detector ? -1 : a.detector > b.detector ? 1 : 0
  })

  // Kept spans never overlap one another, so marking the characters each one
  // covers answers "is this stretch still free?" by reading that stretch alone.
  // Comparing against every kept span instead made a message with thousands
  // of values — a tool returning a customer list — take seconds.
  const taken = new Uint8Array(length)
  const kept: Candidate[] = []
  next: for (const c of ranked) {
    for (let i = c.start; i < c.end; i++) if (taken[i] === 1) continue next
    taken.fill(1, c.start, c.end)
    kept.push(c)
  }

  return kept.sort((a, b) => a.start - b.start)
}

/**
 * Normalises what a detector handed back and records the detector's own name
 * over whatever it claimed, so an audit event can always be traced to the code
 * that produced it.
 */
function collect(
  detector: Detector,
  raw: readonly Candidate[],
  length: number,
  into: Candidate[],
): boolean {
  let dropped = false
  for (const c of raw) {
    if (!isUsableSpan(c, length)) {
      dropped = true
      continue
    }
    into.push({ ...c, detector: detector.id })
  }
  return dropped
}

export function createEngine(detectors: readonly Detector[]): Engine {
  const detectorIds = detectors.map((d) => d.id)
  const entitiesSupported = [...new Set(detectors.flatMap((d) => d.entities))]

  function finish(
    raw: Candidate[],
    length: number,
    degradedDetectors: string[],
    skippedDetectors: string[],
  ): EngineResult {
    return { candidates: mergeOverlaps(raw, length), degradedDetectors, skippedDetectors }
  }

  return {
    detectorIds,
    entitiesSupported,

    runSync(input, ctx): EngineResult {
      const raw: Candidate[] = []
      const degradedDetectors: string[] = []
      const skippedDetectors: string[] = []

      for (const detector of detectors) {
        let result: Candidate[] | Promise<Candidate[]>
        try {
          result = detector.detect(input, ctx)
        } catch {
          // D4 level 1: one detector failing must not take the scan with it.
          // A message that cannot be scanned at all is a message customers
          // route around the guard entirely.
          degradedDetectors.push(detector.id)
          continue
        }

        if (!Array.isArray(result)) {
          // An async detector cannot finish inside a sync call. Naming it beats
          // reporting a scan that reads as clean. Callers who need it use run().
          skippedDetectors.push(detector.id)
          // The work is already in flight; swallow the rejection so an optional
          // detector cannot take the process down.
          void Promise.resolve(result).catch(() => undefined)
          continue
        }

        if (collect(detector, result, input.text.length, raw)) {
          degradedDetectors.push(detector.id)
        }
      }

      return finish(raw, input.text.length, degradedDetectors, skippedDetectors)
    },

    async run(input, ctx): Promise<EngineResult> {
      const raw: Candidate[] = []
      const degradedDetectors: string[] = []

      const settled = await Promise.allSettled(detectors.map(async (d) => d.detect(input, ctx)))

      for (let i = 0; i < detectors.length; i++) {
        const detector = detectors[i]
        const outcome = settled[i]
        if (detector === undefined || outcome === undefined) continue

        if (outcome.status === 'rejected' || !Array.isArray(outcome.value)) {
          degradedDetectors.push(detector.id)
          continue
        }

        if (collect(detector, outcome.value, input.text.length, raw)) {
          degradedDetectors.push(detector.id)
        }
      }

      return finish(raw, input.text.length, degradedDetectors, [])
    },
  }
}
