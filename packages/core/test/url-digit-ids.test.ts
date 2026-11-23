import { describe, expect, it } from 'vitest'
import { inLink } from '../src/detectors/context.js'
import { creditCardDetector } from '../src/detectors/credit-card.js'
import { thaiNationalIdDetector } from '../src/detectors/thai-national-id.js'
import { createGuard } from '../src/guard.js'
import { normalise } from '../src/normalise.js'
import { definePolicy } from '../src/policy.js'
import type { Candidate, DetectContext } from '../src/types.js'

const CTX: DetectContext = { sessionId: 's', boundary: 'inbound' }

/** The confidence each detector gives the text, in reading order. */
function scores(text: string): string[] {
  const n = normalise(text)
  const all = [
    ...(creditCardDetector.detect(n, CTX) as Candidate[]),
    ...(thaiNationalIdDetector.detect(n, CTX) as Candidate[]),
  ]
  return all.sort((a, b) => a.start - b.start).map((c) => `${c.entity} ${c.confidence}`)
}

describe('the issue repro (20 Nov)', () => {
  it('a post id in a link is no card and no id', () => {
    expect(scores('https://www.facebook.com/2259969334286937/posts/1')).toEqual(['CREDIT_CARD 0.2'])
    expect(scores('https://m.facebook.com/Sivanna-shop-647295098732162/')).toEqual([
      'CREDIT_CARD 0.2',
    ])
    expect(scores('https://example.com/product/detail/9610000015570')).toEqual([
      'TH_NATIONAL_ID 0.2',
    ])
  })

  it('a number named as a post is no id', () => {
    expect(scores('เลขโพสต์ 9610000015570')).toEqual(['TH_NATIONAL_ID 0.2'])
  })

  it('under the issue policy nothing is blocked or redacted', () => {
    const guard = createGuard({
      policy: definePolicy({
        entitySet: '0.1',
        entities: {
          CREDIT_CARD: { action: 'block', minConfidence: 0.7 },
          TH_NATIONAL_ID: { action: 'redact' },
        },
      }),
      onAudit: () => {},
    })
    for (const text of [
      'https://www.facebook.com/2259969334286937/posts/1',
      'https://m.facebook.com/Sivanna-shop-647295098732162/',
      'https://example.com/product/detail/9610000015570',
      'เลขโพสต์ 9610000015570',
    ]) {
      const r = guard.processSync(text)
      expect([r.outcome, r.text]).toEqual(['processed', text])
    }
  })
})

describe('still caught as before', () => {
  it('cards and ids with no signal against them', () => {
    expect(scores('4111 1111 1111 1111')).toEqual(['CREDIT_CARD 0.98'])
    expect(scores('บัตร 5500005555555559')).toEqual(['CREDIT_CARD 0.98'])
    expect(scores('3782 822463 10005')).toEqual(['CREDIT_CARD 0.98'])
    expect(scores('เลขบัตร 3-1005-00123-45-8')).toEqual(['TH_NATIONAL_ID 0.99'])
    expect(scores('3100500123458')).toEqual(['TH_NATIONAL_ID 0.99'])
  })

  it('a card typed after a link, as its own word', () => {
    expect(scores('ดูที่ https://x.com/a บัตร 4111 1111 1111 1111')).toEqual(['CREDIT_CARD 0.98'])
  })

  it('a card with its expiry is not a link', () => {
    expect(scores('4111111111111111/12')).toEqual(['CREDIT_CARD 0.98'])
  })

  it('an id cue nearer than a word for something else', () => {
    expect(scores('เลขบัตรประชาชน 3100500123458 ออเดอร์ 12')).toEqual(['TH_NATIONAL_ID 0.99'])
    expect(scores('order 3100500123458 เลขบัตร')).toEqual(['TH_NATIONAL_ID 0.99'])
  })
})

describe('a query key that names a card or an id', () => {
  it('keeps the number read as usual', () => {
    expect(scores('form.com/reg?citizen_id=3100500123458')).toEqual(['TH_NATIONAL_ID 0.99'])
    expect(scores('x.com/?thai_id=3100500123458')).toEqual(['TH_NATIONAL_ID 0.99'])
    expect(scores('pay.com/x?card=4111111111111111')).toEqual(['CREDIT_CARD 0.98'])
    expect(scores('pay.com/x?ref=fb&cardNumber=4111111111111111')).toEqual(['CREDIT_CARD 0.98'])
  })

  it('any other key does not', () => {
    expect(scores('shop.com/p?id=9610000015570')).toEqual(['TH_NATIONAL_ID 0.2'])
    expect(scores('facebook.com/story.php?story_fbid=2259969334286937')).toEqual([
      'CREDIT_CARD 0.2',
    ])
  })
})

describe('a length the issuer does not use', () => {
  it('scores as Luhn alone', () => {
    // JCB and Discover prefixes, fifteen digits: neither issues that length.
    expect(scores('356656854403697')).toEqual(['CREDIT_CARD 0.6'])
    expect(scores('647295098732162')).toEqual(['CREDIT_CARD 0.6'])
  })

  it('a national id that also read as a 13-digit Discover is the id only', () => {
    // Discover has no 13-digit card, so the card reading drops under the default.
    const found = scores('6549141818690')
    expect(found).toContain('CREDIT_CARD 0.6')
  })
})

describe('inLink', () => {
  const at = (text: string, value: string) => {
    const start = text.indexOf(value)
    return inLink(text, start, start + value.length)
  }

  it('a scheme, www. or a host with a path', () => {
    expect(at('https://a.co/123456789', '123456789')).toBe(true)
    expect(at('www.a.com/123456789', '123456789')).toBe(true)
    expect(at('shopee.co.th/item-123456789', '123456789')).toBe(true)
  })

  it('not a word on its own, a date, or a card with its expiry', () => {
    expect(at('โทร 123456789 ค่ะ', '123456789')).toBe(false)
    expect(at('12/05/2530', '2530')).toBe(false)
    expect(at('4111111111111111/12', '4111111111111111')).toBe(false)
  })
})
