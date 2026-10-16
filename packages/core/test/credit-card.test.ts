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

// Each shape was missed before 13 Oct (edge cases): the run was cut at 19
// digits wherever the regex stopped, so whatever sat next to the card failed
// Luhn with it.
describe('a card with something next to it', () => {
  it('reads the card without the expiry or CVV typed after it', () => {
    expect(spans('5555-5555-5555-4444 03/29 987')).toEqual(['5555-5555-5555-4444'])
    expect(spans('5555 5555 5555 4444 03/29')).toEqual(['5555 5555 5555 4444'])
    expect(spans('3782 822463 10005 0429')).toEqual(['3782 822463 10005'])
  })

  it('reads the card without an amount typed before it', () => {
    expect(spans('ยอด 2490 5555 5555 5555 4444')).toEqual(['5555 5555 5555 4444'])
  })

  it('reads a card pasted across two lines', () => {
    expect(spans('เลขบัตร\n5555 5555\n5555 4444')).toEqual(['5555 5555\n5555 4444'])
    expect(spans('5555 5555 \r\n5555 4444')).toEqual(['5555 5555 \r\n5555 4444'])
  })

  it("does not join numbers across a space unless the gaps are a card's", () => {
    // A national id and a quantity: the fourteen digits pass Luhn, the id on
    // its own does not. Read as a card, the longer span would win the merge
    // and the id inside it would go below the threshold with it.
    expect(detect('3100500123440 2 ใบ')).toEqual([])
    // Passes Luhn, no issuer: the gaps are all it has to go on.
    expect(detect('99999 99999 999995')).toEqual([])
  })

  it('does not join lines that are separate numbers', () => {
    expect(detect('0812345678\n0898765432')).toEqual([])
  })
})

// Code review, 13 Oct: three ways the readings of one run were chosen wrong.
describe('choosing among the readings of one run', () => {
  it('finds the card behind a number whose cut passes Luhn with no issuer', () => {
    // 1006 4012 8888 8888 passes Luhn and scores 0.6. Widest-first from the
    // left took it and never tried the Visa starting at the next group.
    expect(spans('อ้างอิง 1006 4012 8888 8888 1881')).toEqual(['4012 8888 8888 1881'])
    expect(spans('1000 5105 1051 0510 5100')).toEqual(['5105 1051 0510 5100'])
    expect(detect('1000 5105 1051 0510 5100')[0]?.confidence).toBe(0.98)
  })

  it("prefers the card's own gaps when an issuer reading takes a neighbour", () => {
    // 45250 4012 8888 8888 is wider, starts like a Visa and passes Luhn too.
    // Taken for its width, it would leave the card's last group in the clear.
    expect(spans('ยอด 45250 4012 8888 8888 1881')).toEqual(['4012 8888 8888 1881'])
  })

  it('still reports a reading with no issuer when nothing stronger overlaps it', () => {
    expect(detect(`ref ${NO_ISSUER.match(/.{4}/g)?.join(' ')}`)[0]?.confidence).toBe(0.6)
  })

  it('reads a card with a real issuer in any spacing, as before 13 Oct', () => {
    expect(spans('4012 888 8888 81881')).toEqual(['4012 888 8888 81881'])
    expect(spans('บัตร 5 1 0 5 1 0 5 1 0 5 1 0 5 1 0 0 ค่ะ')).toEqual([
      '5 1 0 5 1 0 5 1 0 5 1 0 5 1 0 0',
    ])
    expect(detect('41111 11111 111111')[0]?.confidence).toBe(0.98)
  })

  it('keeps the gaps for a dot or a line break, whoever issued the card', () => {
    expect(detect('4012.888.8888.81881')).toEqual([])
    expect(detect('4012 888\n8888 81881')).toEqual([])
  })

  it('reads a long run of single digits in linear time', () => {
    let text = ''
    for (let i = 0; text.length < 100 * 1024; i++) text += `${(i * 7) % 10} `
    const started = performance.now()
    detect(text)
    expect(performance.now() - started).toBeLessThan(2000)
  })
})

// digit-run.ts: one set of separators for every digit detector, 13 Oct.
describe('the separators every digit detector reads', () => {
  it('reads a card written with dots in its printed gaps', () => {
    expect(spans('6011.1111.1111.1117')).toEqual(['6011.1111.1111.1117'])
    expect(spans('3714 496353 98431')).toEqual(['3714 496353 98431'])
    expect(spans('3714.496353.98431')).toEqual(['3714.496353.98431'])
  })

  it('leaves dotted digits in any other grouping alone', () => {
    // 4111111111111111 again, grouped like an amount and a date.
    expect(detect('41.111.111 11.11.1111')).toEqual([])
    expect(detect('4111.11111.1111111')).toEqual([])
  })

  it('reads an en dash or a minus sign as it reads a hyphen', () => {
    expect(spans('6011–1111–1111–1117')).toEqual(['6011–1111–1111–1117'])
    expect(spans('6011−111111111117')).toEqual(['6011−111111111117'])
  })

  it("reads spaces round a dash as a space, so the gaps must be a card's", () => {
    expect(spans('6011 - 1111 - 1111 - 1117')).toEqual(['6011 - 1111 - 1111 - 1117'])
    expect(detect('601 - 1111111111117')).toEqual([])
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

// User benchmark, 14 Oct (D20): a bank slip's reference number.
describe('a transfer reference', () => {
  it('scores an issuer reading as Luhn alone beside a reference cue', () => {
    expect(detect(`เลขอ้างอิงรายการ ${VISA}`)[0]?.confidence).toBe(0.6)
    expect(detect(`Ref: ${MASTERCARD}`)[0]?.confidence).toBe(0.6)
    expect(detect(`${VISA} ref ค่ะ`)[0]?.confidence).toBe(0.6)
  })

  it('does not read ref inside another word', () => {
    expect(detect(`refund to ${VISA}`)[0]?.confidence).toBe(0.98)
    expect(detect(`I prefer ${VISA}`)[0]?.confidence).toBe(0.98)
  })

  it('keeps the card when the sentence also names a card', () => {
    expect(detect(`อ้างอิงบัตร ${VISA}`)[0]?.confidence).toBe(0.98)
    expect(detect(`ref card ${MASTERCARD}`)[0]?.confidence).toBe(0.98)
  })

  it('keeps the card when the cue belongs to the number beside it', () => {
    expect(detect(`อ้างอิง 12345 ${VISA}`)[0]?.confidence).toBe(0.98)
  })

  it('scores a reading under a key that names a time as Luhn alone', () => {
    expect(detect(`"created_at":${VISA}`)[0]?.confidence).toBe(0.6)
  })
})
