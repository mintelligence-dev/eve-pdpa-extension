import { describe, expect, it } from 'vitest'
import { phoneDetector } from '../src/detectors/phone.js'
import { normalise } from '../src/normalise.js'
import type { Candidate, DetectContext } from '../src/types.js'

const CTX: DetectContext = { sessionId: 'test', boundary: 'inbound' }

function detect(text: string): Candidate[] {
  return phoneDetector.detect(normalise(text), CTX) as Candidate[]
}

function spans(text: string): string[] {
  return detect(text).map((c) => normalise(text).text.slice(c.start, c.end))
}

describe('mobile', () => {
  it('finds the three allocated ranges', () => {
    for (const n of ['0812345678', '0612345678', '0912345678']) {
      expect(detect(n)).toHaveLength(1)
    }
  })

  it('finds a number written with separators', () => {
    expect(spans('091-888-7777')).toEqual(['091-888-7777'])
    expect(spans('091 888 7777')).toEqual(['091 888 7777'])
  })

  it('finds a number a customer typed in Thai numerals', () => {
    // normalise folds the digits; offsets still index the folded text here.
    expect(detect('ขอเปลี่ยนเบอร์เป็น ๐๙๑-๘๘๘-๗๗๗๗ ค่ะ')).toHaveLength(1)
  })

  it('finds the +66 form', () => {
    expect(detect('+66812345678')).toHaveLength(1)
    expect(detect('+66 81 234 5678')).toHaveLength(1)
  })
})

describe('landline', () => {
  it('finds a nine-digit number on a real area code', () => {
    expect(detect('021234567')).toHaveLength(1)
    expect(detect('038123456')).toHaveLength(1)
  })

  it('acts by default, without needing a cue word', () => {
    expect(detect('021234567')[0]?.confidence).toBeGreaterThanOrEqual(0.95)
  })
})

describe('leaves alone', () => {
  it('a ten-digit run on an area code that has no mobile range', () => {
    // 07 is a landline code, so ten digits starting 07 is neither shape.
    expect(detect('0712345678')).toEqual([])
  })

  it('a run that does not start with 0', () => {
    expect(detect('1812345678')).toEqual([])
  })

  it('a run of the wrong length', () => {
    expect(detect('08123456')).toEqual([])
    expect(detect('081234567890')).toEqual([])
  })

  it('a phone-length window inside a longer digit run', () => {
    expect(detect('99908123456789')).toEqual([])
  })
})

describe('context', () => {
  it('raises confidence when the sentence says it is a phone number', () => {
    const bare = detect('0812345678')[0]?.confidence ?? 0
    const cued = detect('เบอร์ 0812345678')[0]?.confidence ?? 0
    expect(cued).toBeGreaterThan(bare)
  })

  it('reads a cue that follows the number as well as one before it', () => {
    expect(detect('0812345678 ติดต่อได้ค่ะ')[0]?.confidence).toBe(0.99)
  })

  it('stands down when the sentence says the number is an account', () => {
    // Both detectors cannot act on one span, and the merge would hand it to
    // PHONE on priority. Standing down is how the sentence gets to decide.
    expect(detect('เลขบัญชี 0812345678')).toEqual([])
  })

  it('keeps the number when both cues are present', () => {
    expect(detect('โอนเงินแล้วโทร 0812345678')).toHaveLength(1)
  })
})
