import { describe, expect, it } from 'vitest'
import { thaiNationalIdDetector } from '../src/detectors/thai-national-id.js'
import { createEngine } from '../src/engine.js'
import { normalise } from '../src/normalise.js'
import type { Candidate, DetectContext, Detector, EntityType } from '../src/types.js'
import { makeThaiId } from './helpers/make-thai-id.js'

const CTX: DetectContext = { sessionId: 'test', boundary: 'inbound' }

/** A detector that reports exactly what the test tells it to. */
function fixed(id: string, candidates: readonly Partial<Candidate>[]): Detector {
  return {
    id,
    entities: ['PHONE'],
    detect: () =>
      candidates.map((c) => ({
        entity: 'PHONE' as EntityType,
        start: 0,
        end: 1,
        confidence: 1,
        detector: id,
        ...c,
      })),
  }
}

function broken(id: string): Detector {
  return {
    id,
    entities: ['EMAIL'],
    detect() {
      throw new Error('dictionary failed to load')
    },
  }
}

/** Stands in for the NER detector that arrives in 0.3. */
function slow(id: string, candidates: readonly Partial<Candidate>[] = []): Detector {
  const sync = fixed(id, candidates)
  return {
    id,
    entities: ['BANK_ACCOUNT'],
    detect: async (input, ctx) => sync.detect(input, ctx) as Candidate[],
  }
}

describe('what the build can see', () => {
  it('reports the loaded detectors and the union of their entities', () => {
    const engine = createEngine([thaiNationalIdDetector, fixed('phones', [])])
    expect(engine.detectorIds).toEqual(['th-national-id', 'phones'])
    expect(engine.entitiesSupported).toEqual(['TH_NATIONAL_ID', 'PHONE'])
  })

  it('says plainly that an empty set sees nothing', () => {
    const engine = createEngine([])
    expect(engine.entitiesSupported).toEqual([])
    expect(engine.runSync(normalise('3-1005-00123-45-8'), CTX).candidates).toEqual([])
  })
})

describe('degrade — D4 level 1', () => {
  it('keeps scanning with the detectors that still work', () => {
    const engine = createEngine([broken('thai-ner'), thaiNationalIdDetector])
    const result = engine.runSync(normalise(`เลขบัตร ${makeThaiId(() => 0.5)}`), CTX)

    expect(result.degradedDetectors).toEqual(['thai-ner'])
    expect(result.candidates).toHaveLength(1)
  })

  it('flags an async detector that rejects', async () => {
    const rejects: Detector = {
      id: 'thai-ner',
      entities: ['EMAIL'],
      detect: () => Promise.reject(new Error('model missing')),
    }
    const result = await createEngine([rejects, thaiNationalIdDetector]).run(
      normalise(makeThaiId(() => 0.5)),
      CTX,
    )

    expect(result.degradedDetectors).toEqual(['thai-ner'])
    expect(result.candidates).toHaveLength(1)
  })

  it('degrades rather than trusting a span it cannot use', () => {
    const engine = createEngine([
      fixed('bad', [
        { start: 5, end: 2 },
        { start: 0, end: 4 },
        { start: 0, end: 999 },
      ]),
    ])
    const result = engine.runSync(normalise('0812345678'), CTX)

    expect(result.degradedDetectors).toEqual(['bad'])
    expect(result.candidates).toEqual([expect.objectContaining({ start: 0, end: 4 })])
  })
})

describe('async detectors in a sync call', () => {
  it('names them instead of reporting a clean scan', () => {
    const result = createEngine([slow('thai-ner'), thaiNationalIdDetector]).runSync(
      normalise(makeThaiId(() => 0.5)),
      CTX,
    )

    expect(result.skippedDetectors).toEqual(['thai-ner'])
    expect(result.degradedDetectors).toEqual([])
    expect(result.candidates).toHaveLength(1)
  })

  it('runs them in run()', async () => {
    const engine = createEngine([slow('thai-ner', [{ start: 0, end: 10 }])])
    const result = await engine.run(normalise('0812345678'), CTX)

    expect(result.skippedDetectors).toEqual([])
    expect(result.candidates).toHaveLength(1)
  })
})

describe('overlaps — longest wins', () => {
  it('drops the shorter claim rather than trimming it', () => {
    const engine = createEngine([
      fixed('short', [{ start: 2, end: 6 }]),
      fixed('long', [{ start: 0, end: 10 }]),
    ])
    const [only, ...rest] = engine.runSync(normalise('0812345678'), CTX).candidates

    expect(rest).toEqual([])
    expect(only?.detector).toBe('long')
  })

  it('keeps every candidate unmerged as raw, for the guard to settle with policy (D18)', () => {
    const engine = createEngine([
      fixed('short', [{ start: 2, end: 6 }]),
      fixed('long', [{ start: 0, end: 10 }]),
    ])
    const r = engine.runSync(normalise('0812345678'), CTX)

    expect(r.raw.map((c) => c.detector)).toEqual(['short', 'long'])
    expect(r.candidates).toHaveLength(1)
  })

  it('keeps candidates that only touch at the edge', () => {
    const engine = createEngine([
      fixed('a', [
        { start: 0, end: 4 },
        { start: 4, end: 8 },
      ]),
    ])
    expect(engine.runSync(normalise('08123456'), CTX).candidates).toHaveLength(2)
  })

  it('breaks an exact tie on entity, not on confidence', () => {
    const weakButSpecific = fixed('cards', [
      { start: 0, end: 10, entity: 'CREDIT_CARD', confidence: 0.3 },
    ])
    const strongButVague = fixed('accounts', [
      { start: 0, end: 10, entity: 'BANK_ACCOUNT', confidence: 0.99 },
    ])

    const forwards = createEngine([weakButSpecific, strongButVague])
    const backwards = createEngine([strongButVague, weakButSpecific])
    const input = normalise('0812345678')

    expect(forwards.runSync(input, CTX).candidates[0]?.entity).toBe('CREDIT_CARD')
    expect(backwards.runSync(input, CTX).candidates[0]?.entity).toBe('CREDIT_CARD')
  })

  it('collapses two detectors that found the same thing', () => {
    const engine = createEngine([
      fixed('regex', [{ start: 0, end: 10 }]),
      fixed('dictionary', [{ start: 0, end: 10 }]),
    ])
    expect(engine.runSync(normalise('0812345678'), CTX).candidates).toHaveLength(1)
  })

  it('returns what survives in reading order', () => {
    const engine = createEngine([
      fixed('a', [
        { start: 20, end: 24 },
        { start: 0, end: 4 },
        { start: 10, end: 14 },
      ]),
    ])
    const starts = engine.runSync(normalise('x'.repeat(30)), CTX).candidates.map((c) => c.start)

    expect(starts).toEqual([0, 10, 20])
  })
})

describe('audit truthfulness', () => {
  it('stamps the detector that really ran over whatever it claimed', () => {
    const liar = fixed('real-id', [{ start: 0, end: 4, detector: 'something-else' }])
    const [c] = createEngine([liar]).runSync(normalise('0812345678'), CTX).candidates

    expect(c?.detector).toBe('real-id')
  })
})
