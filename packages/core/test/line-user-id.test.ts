import { describe, expect, it } from 'vitest'
import { lineUserIdDetector } from '../src/detectors/line-user-id.js'
import { normalise } from '../src/normalise.js'
import type { Candidate, DetectContext } from '../src/types.js'

const CTX: DetectContext = { sessionId: 'test', boundary: 'inbound' }

/** Synthetic: 32 hex characters, no real account behind them. */
const ID = `U${'0123456789abcdef'.repeat(2)}`

function detect(text: string): Candidate[] {
  return lineUserIdDetector.detect(normalise(text), CTX) as Candidate[]
}

describe('finds', () => {
  it('a user id in a tool payload', () => {
    const text = `{"userId":"${ID}"}`
    const [c] = detect(text)
    expect(text.slice(c?.start ?? 0, c?.end)).toBe(ID)
  })

  it('a user id pressed against Thai text', () => {
    expect(detect(`ลูกค้า${ID}ค่ะ`)).toHaveLength(1)
  })
})

describe('leaves alone', () => {
  it('a hex run that is too short or too long', () => {
    expect(detect(`U${'a'.repeat(31)}`)).toEqual([])
    expect(detect(`U${'a'.repeat(33)}`)).toEqual([])
  })

  it('uppercase hex, which LINE does not issue', () => {
    expect(detect(`U${'ABCDEF0123456789'.repeat(2)}`)).toEqual([])
  })

  it('an id sitting inside a longer token', () => {
    expect(detect(`x${ID}`)).toEqual([])
    expect(detect(`${ID}9`)).toEqual([])
  })

  it('group and room ids, which identify a conversation and not a person', () => {
    expect(detect(ID.replace('U', 'C'))).toEqual([])
    expect(detect(ID.replace('U', 'R'))).toEqual([])
  })
})
