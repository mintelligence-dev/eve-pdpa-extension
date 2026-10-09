import { describe, expect, it } from 'vitest'
import { emailDetector } from '../src/detectors/email.js'
import { normalise } from '../src/normalise.js'
import type { Candidate, DetectContext } from '../src/types.js'

const CTX: DetectContext = { sessionId: 'test', boundary: 'inbound' }

function detect(text: string): Candidate[] {
  return emailDetector.detect(normalise(text), CTX) as Candidate[]
}

function spans(text: string): string[] {
  return detect(text).map((c) => text.slice(c.start, c.end))
}

describe('finds', () => {
  it('a plain address in a Thai sentence', () => {
    expect(spans('ส่งใบเสร็จมาที่ somchai@example.com ด้วยค่ะ')).toEqual(['somchai@example.com'])
  })

  it('an address with no space before it, which Thai text often has', () => {
    expect(spans('อีเมลsomchai@example.com')).toEqual(['somchai@example.com'])
  })

  it('dots, plus tags and the rest of the allowed local part', () => {
    expect(spans('somchai.r+receipt@example.co.th')).toEqual(['somchai.r+receipt@example.co.th'])
  })

  it('a hyphenated domain', () => {
    expect(spans('a@my-shop.example')).toEqual(['a@my-shop.example'])
  })

  it('every address in one message', () => {
    expect(spans('a@example.com และ b@example.net')).toHaveLength(2)
  })

  it('an address at the end of a sentence, without the full stop', () => {
    expect(spans('ส่งที่ somchai@example.com.')).toEqual(['somchai@example.com'])
    expect(spans('ส่งที่ somchai@example.com. ขอบคุณค่ะ')).toEqual(['somchai@example.com'])
    expect(spans('อีเมล somchai@example.com...')).toEqual(['somchai@example.com'])
    expect(spans('somchai@example.co.th.ค่ะ')).toEqual(['somchai@example.co.th'])
  })

  it('an address a customer typed in full-width characters', () => {
    // normalise folds the whole full-width range, so the detector never sees it.
    expect(detect('ＡＢ＠ｅｘａｍｐｌｅ．ｃｏｍ')).toHaveLength(1)
  })
})

describe('leaves alone', () => {
  it('an @ with nothing that looks like a domain', () => {
    expect(detect('ราคา 500@ชิ้น')).toEqual([])
    expect(detect('@somchai')).toEqual([])
  })

  it('a bare domain with no mailbox', () => {
    expect(detect('ดูที่ example.com ค่ะ')).toEqual([])
  })

  it('a single-letter TLD', () => {
    expect(detect('a@b.c')).toEqual([])
  })

  it('a run that carries on past the TLD', () => {
    // Matching the head of a longer token would redact a span that is not an
    // address and leave the rest of the token in place.
    expect(detect('a@example.com1')).toEqual([])
    expect(detect('a@example.com-x')).toEqual([])
    // A dot that leads on into more of the run is not a full stop.
    expect(detect('a@example.com.1')).toEqual([])
    expect(detect('a@example.com..x')).toEqual([])
  })
})

describe('what it does not claim to cover', () => {
  it('skips a quoted local part rather than spanning the spaces inside it', () => {
    // A miss, and the right kind: the alternative is a span that starts in the
    // middle of the quoted name and takes the closing quote with it.
    expect(detect('"somchai r"@example.com')).toEqual([])
  })

  it('skips a raw Thai IDN domain', () => {
    expect(detect('somchai@ตัวอย่าง.ไทย')).toEqual([])
  })
})

describe('confidence', () => {
  it('is above the default threshold, so a policy acts without being told to', () => {
    expect(detect('a@example.com')[0]?.confidence).toBeGreaterThan(0.95)
  })
})
