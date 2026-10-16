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

// Edge cases, 13 Oct: banner@2x.png was flagged as an address.
describe('filenames', () => {
  it('leaves an image named for a high-density screen alone', () => {
    expect(detect('รูป hero@3x.jpg ไม่ขึ้นค่ะ')).toEqual([])
    expect(detect('icon@2X.WEBP')).toEqual([])
  })

  it('leaves any name ending in a file extension that is not a TLD alone', () => {
    expect(detect('แนบ quote@v2.pdf ให้แล้ว')).toEqual([])
  })

  it('still finds an address under a real TLD that is also an extension', () => {
    expect(spans('somchai@example.zip')).toEqual(['somchai@example.zip'])
    expect(spans('somchai@example.ai')).toEqual(['somchai@example.ai'])
  })
})

// User benchmark, 14 Oct: `=` is atext, so "email=" was read as the start of
// the local part and the key went into the span (D20 item 26).
describe('a key typed in front of the address', () => {
  it('starts the span after an email, mail or e-mail key joined with =', () => {
    expect(spans('form: email=narin.k@example.co.th')).toEqual(['narin.k@example.co.th'])
    expect(spans('MAIL=narin@example.com')).toEqual(['narin@example.com'])
    expect(spans('E-Mail=narin@example.com ค่ะ')).toEqual(['narin@example.com'])
  })

  it('reads a key joined with a colon the same way', () => {
    expect(spans('e-mail:narin@example.com')).toEqual(['narin@example.com'])
  })

  it('leaves a key with any other name in the span, as before', () => {
    expect(spans('contact_email=narin@example.com')).toEqual(['contact_email=narin@example.com'])
  })

  it('finds nothing when the key is all there is before the @', () => {
    expect(detect('email=@example.com')).toEqual([])
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

// Code review, 14 Oct: the pattern was tried at every position of a long run
// and read the rest of the run from each, so 50,000 digits took 1.1 s (D20).
describe('cost', () => {
  it('reads a long run with no @ in it in linear time', () => {
    for (const unit of ['7', 'a', 'a.']) {
      const text = unit.repeat(Math.ceil((200 * 1024) / unit.length))
      const started = performance.now()
      detect(text)
      expect(performance.now() - started).toBeLessThan(2000)
    }
  })

  it('reads a long run with an @ at either end, or many of them, in linear time', () => {
    const digits = '7'.repeat(200 * 1024)
    for (const text of [
      `${digits}@`,
      `@${digits}`,
      `${digits}@example.com`,
      'a@'.repeat(100 * 1024),
    ]) {
      const started = performance.now()
      detect(text)
      expect(performance.now() - started).toBeLessThan(2000)
    }
  })

  it('finds the same addresses it found when the whole text was scanned', () => {
    // The search resumes after each match, so two addresses never share
    // characters, and the leftmost start still wins.
    expect(spans('a@example.com@example.net')).toEqual([])
    expect(spans('x..somchai@example.com')).toEqual([])
    expect(spans('@@somchai@example.com')).toEqual([])
  })
})
