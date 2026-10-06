import { describe, expect, it } from 'vitest'
import { bankAccountDetector } from '../src/detectors/bank-account.js'
import { phoneDetector } from '../src/detectors/phone.js'
import { createEngine } from '../src/engine.js'
import { normalise } from '../src/normalise.js'
import type { Candidate, DetectContext } from '../src/types.js'

const CTX: DetectContext = { sessionId: 'test', boundary: 'inbound' }

function detect(text: string): Candidate[] {
  return bankAccountDetector.detect(normalise(text), CTX) as Candidate[]
}

describe('needs the sentence, not just the digits', () => {
  it('says nothing about a bare run of ten digits', () => {
    // No checksum, no reserved prefix, no length of its own. Claiming this
    // would put a finding on every order confirmation.
    expect(detect('1234567890')).toEqual([])
  })

  it('claims the same run under the word บัญชี', () => {
    expect(detect('เลขบัญชี 1234567890')).toHaveLength(1)
  })

  it('takes a bank name as the cue', () => {
    expect(detect('กสิกร 1234567890')).toHaveLength(1)
    expect(detect('โอนมาที่ scb 123-4-56789-0')).toHaveLength(1)
  })

  it('reads an English cue in any case', () => {
    expect(detect('Account 1234567890')).toHaveLength(1)
  })

  it('does not take กรุงเทพ as a bank name, because it is the city', () => {
    expect(detect('อยู่กรุงเทพ 1234567890')).toEqual([])
  })
})

describe('shape', () => {
  it('accepts ten to twelve digits', () => {
    expect(detect('บัญชี 1234567890')).toHaveLength(1)
    expect(detect('บัญชี 123456789012')).toHaveLength(1)
  })

  it('rejects anything shorter or longer', () => {
    expect(detect('บัญชี 123456789')).toEqual([])
    expect(detect('บัญชี 1234567890123')).toEqual([])
  })

  it('accepts the separators a passbook prints', () => {
    expect(detect('บัญชี 123-4-56789-0')).toHaveLength(1)
  })

  it('rejects a run that is part of a longer one', () => {
    expect(detect('บัญชี 99912345678901234')).toEqual([])
  })
})

describe('against the phone detector', () => {
  it('wins a mobile-shaped run when the sentence says account', () => {
    const engine = createEngine([phoneDetector, bankAccountDetector])
    const merged = engine.runSync(normalise('เลขบัญชี 0812345678'), CTX).candidates

    expect(merged).toHaveLength(1)
    expect(merged[0]?.entity).toBe('BANK_ACCOUNT')
  })

  it('loses the same run when the sentence says phone', () => {
    const engine = createEngine([phoneDetector, bankAccountDetector])
    const merged = engine.runSync(normalise('เบอร์ 0812345678'), CTX).candidates

    expect(merged).toHaveLength(1)
    expect(merged[0]?.entity).toBe('PHONE')
  })
})
