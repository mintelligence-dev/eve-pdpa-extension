import { describe, expect, it } from 'vitest'
import { thaiNationalIdDetector } from '../src/detectors/thai-national-id.js'
import { normalise } from '../src/normalise.js'
import type { DetectContext } from '../src/types.js'
import { checkDigit, makeThaiId } from './helpers/make-thai-id.js'

const CTX: DetectContext = { sessionId: 'test', boundary: 'inbound' }

function detect(text: string) {
  return thaiNationalIdDetector.detect(normalise(text), CTX) as ReturnType<
    typeof thaiNationalIdDetector.detect
  > & { length: number }
}

function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

describe('shape', () => {
  it('declares what it is and what it covers', () => {
    expect(thaiNationalIdDetector.id).toBe('th-national-id')
    expect(thaiNationalIdDetector.entities).toEqual(['TH_NATIONAL_ID'])
  })

  it('is synchronous, so processSync can run it', () => {
    expect(Array.isArray(detect('no ids here'))).toBe(true)
  })
})

describe('detection', () => {
  it('finds a bare 13-digit id', () => {
    const id = makeThaiId(seeded(1))
    const found = detect(`เลขบัตร ${id} ค่ะ`)
    expect(found).toHaveLength(1)
    expect(found[0]?.entity).toBe('TH_NATIONAL_ID')
    expect(found[0]?.detector).toBe('th-national-id')
  })

  it('finds an id written with dashes', () => {
    const body = '310050012345'
    const id = `3-1005-00123-45-${checkDigit(body)}`
    const found = detect(`เลขบัตรประชาชน ${id} ครับ`)
    expect(found).toHaveLength(1)
    expect(found[0]?.confidence).toBeGreaterThan(0.95)
  })

  it('trusts the checksum, not the shape', () => {
    const body = '310050012345'
    const good = body + checkDigit(body)
    const bad = body + ((checkDigit(body) + 1) % 10)

    expect(detect(good)[0]?.confidence).toBe(0.99)
    expect(detect(bad)[0]?.confidence).toBe(0.2)
  })

  it('ignores runs that are not 13 digits long', () => {
    expect(detect('order 123456789012345678')).toHaveLength(0)
    expect(detect('เบอร์ 0918887777')).toHaveLength(0)
  })

  it('reports offsets into the normalised text', () => {
    const id = makeThaiId(seeded(7))
    const prefix = 'id '
    const found = detect(prefix + id)
    expect(found[0]?.start).toBe(prefix.length)
    expect(found[0]?.end).toBe(prefix.length + id.length)
  })

  it('finds every id in one message', () => {
    const a = makeThaiId(seeded(2))
    const b = makeThaiId(seeded(3))
    expect(detect(`${a} และ ${b}`)).toHaveLength(2)
  })
})

describe('reuse', () => {
  it('does not carry match state between calls', () => {
    const id = makeThaiId(seeded(5))
    const text = `${id} และ ${id}`
    const first = detect(text)
    const second = detect(text)
    expect(second).toEqual(first)
    expect(second).toHaveLength(2)
  })
})
