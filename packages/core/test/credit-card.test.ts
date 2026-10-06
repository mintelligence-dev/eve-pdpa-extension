import { describe, expect, it } from 'vitest'
import { creditCardDetector, isValidLuhn } from '../src/detectors/credit-card.js'
import { thaiNationalIdDetector } from '../src/detectors/thai-national-id.js'
import { createEngine } from '../src/engine.js'
import { normalise } from '../src/normalise.js'
import type { Candidate, DetectContext } from '../src/types.js'

const CTX: DetectContext = { sessionId: 'test', boundary: 'inbound' }

/**
 * Published scheme test numbers. They pass Luhn and carry real issuer prefixes
 * but are not issued to anyone, which is what fixtures/ATTESTATION.md requires.
 */
const VISA = '4111111111111111'
const MASTERCARD = '5555555555554444'
const AMEX = '378282246310005'
const JCB = '3530111333300000'
const UNIONPAY = '6221260000000000'
/** Passes Luhn, prefix 99 belongs to no scheme. */
const NO_ISSUER = '9999999999999995'

function detect(text: string): Candidate[] {
  return creditCardDetector.detect(normalise(text), CTX) as Candidate[]
}

function spans(text: string): string[] {
  return detect(text).map((c) => text.slice(c.start, c.end))
}

describe('luhn', () => {
  it('accepts the published test numbers', () => {
    for (const n of [VISA, MASTERCARD, AMEX, JCB, UNIONPAY]) {
      expect(isValidLuhn(n)).toBe(true)
    }
  })

  it('rejects a single-digit slip', () => {
    expect(isValidLuhn('4111111111111112')).toBe(false)
  })

  it('rejects anything that is not all digits', () => {
    expect(isValidLuhn('4111-1111')).toBe(false)
    expect(isValidLuhn('')).toBe(false)
  })
})

describe('finds', () => {
  it('a bare number', () => {
    expect(spans(`เลขบัตร ${VISA} ค่ะ`)).toEqual([VISA])
  })

  it('a number grouped the way people type it', () => {
    expect(spans('4111 1111 1111 1111')).toEqual(['4111 1111 1111 1111'])
    expect(spans('4111-1111-1111-1111')).toEqual(['4111-1111-1111-1111'])
  })

  it('a 15-digit Amex and a 14-digit Diners', () => {
    expect(spans(AMEX)).toEqual([AMEX])
    expect(spans('30569309025904')).toEqual(['30569309025904'])
  })

  it('a number written in Thai numerals', () => {
    const thai = VISA.replace(/\d/g, (d) => '๐๑๒๓๔๕๖๗๘๙'[Number(d)] ?? d)
    expect(detect(thai)).toHaveLength(1)
  })
})

describe('leaves alone', () => {
  it('a run that fails Luhn', () => {
    expect(detect('1234567890123456')).toEqual([])
  })

  it('a number that is too short or too long', () => {
    expect(detect('411111111111')).toEqual([])
    expect(detect('41111111111111111111')).toEqual([])
  })

  it('a card-length tail inside a longer reference number', () => {
    // 20 digits: every 16-digit window is a Luhn candidate, and redacting one
    // would cut an order number in half.
    expect(detect(`9999${VISA}`)).toEqual([])
    expect(detect(`${VISA}9999`)).toEqual([])
  })
})

describe('confidence', () => {
  it('trusts a real issuer prefix enough to act on by default', () => {
    for (const n of [VISA, MASTERCARD, AMEX, JCB, UNIONPAY]) {
      expect(detect(n)[0]?.confidence).toBeGreaterThan(0.95)
    }
  })

  it('reports a Luhn-only run but keeps it under the default threshold', () => {
    // One run in ten passes Luhn by chance. Reported so the benchmark can count
    // them; not acted on unless a policy asks.
    expect(detect(NO_ISSUER)[0]?.confidence).toBeLessThan(0.95)
  })
})

describe('against the national id detector', () => {
  it('does not refile an id as a card when the number passes both checks', () => {
    // Valid mod-11 check digit AND valid Luhn. Same span, so the merge falls
    // through to entity priority.
    const both = '3100500123521'
    const engine = createEngine([thaiNationalIdDetector, creditCardDetector])
    const merged = engine.runSync(normalise(`เลขบัตรประชาชน ${both}`), CTX).candidates

    expect(merged).toHaveLength(1)
    expect(merged[0]?.entity).toBe('TH_NATIONAL_ID')
  })
})
