import { describe, expect, it } from 'vitest'
import { licensePlateDetector } from '../src/detectors/license-plate.js'
import { normalise } from '../src/normalise.js'
import type { Candidate, DetectContext } from '../src/types.js'

const CTX: DetectContext = { sessionId: 'test', boundary: 'inbound' }

function detect(text: string): Candidate[] {
  return licensePlateDetector.detect(normalise(text), CTX) as Candidate[]
}

/** The text each candidate covers, in the normalised text the detector read. */
function found(text: string): string[] {
  const n = normalise(text).text
  return detect(text).map((c) => n.slice(c.start, c.end))
}

describe('finds, when the sentence says it is a plate', () => {
  it('the usual form after a cue word', () => {
    expect(found('ทะเบียนรถ กข 1234 ค่ะ')).toEqual(['กข 1234'])
  })

  it('hyphen, no separator and a series digit', () => {
    expect(found('ทะเบียน นข-5678')).toEqual(['นข-5678'])
    expect(found('ทะเบียน กข1234')).toEqual(['กข1234'])
    expect(found('ทะเบียน 1กข 2345')).toEqual(['1กข 2345'])
  })

  it('one, two or three letters and one to four digits', () => {
    expect(found('ทะเบียน ฒ 9')).toEqual(['ฒ 9'])
    expect(found('ทะเบียน ฒค 99')).toEqual(['ฒค 99'])
    expect(found('ทะเบียน ฒคง 999')).toEqual(['ฒคง 999'])
  })

  it('pressed against the cue, which Thai writes without a space', () => {
    expect(found('ทะเบียนกข1234')).toEqual(['กข1234'])
    expect(found('ทะเบียนรถกข 1234')).toEqual(['กข 1234'])
    expect(found('เลขทะเบียนคือ กข 1234')).toEqual(['กข 1234'])
    expect(found('ทะเบียนรถยนต์เป็น กข 1234')).toEqual(['กข 1234'])
  })

  it('Thai and full-width numerals', () => {
    expect(found('ทะเบียน กข ๑๒๓๔')).toEqual(['กข 1234'])
    expect(found('ทะเบียน กข １２３４')).toEqual(['กข 1234'])
  })

  it('an English cue, as a word', () => {
    expect(found('license plate กข 1234')).toEqual(['กข 1234'])
    expect(found('plate: กข 1234')).toEqual(['กข 1234'])
  })

  it('the cue after the value', () => {
    expect(found('กข 1234 คือทะเบียนรถผมครับ')).toEqual(['กข 1234'])
  })

  it('with Thai text running straight on after it', () => {
    expect(found('ทะเบียน กข 1234ครับ')).toEqual(['กข 1234'])
  })

  it('claims a cued plate above the default threshold', () => {
    const [c] = detect('ทะเบียน กข 1234')
    expect(c?.confidence).toBeGreaterThanOrEqual(0.95)
  })
})

describe('the province printed under the number', () => {
  it('is part of the value when it follows', () => {
    expect(found('ทะเบียน กข 1234 ชลบุรี ค่ะ')).toEqual(['กข 1234 ชลบุรี'])
    expect(found('ทะเบียน 7ชง 8150 เชียงใหม่')).toEqual(['7ชง 8150 เชียงใหม่'])
    expect(found('ทะเบียน กข 1234กรุงเทพฯ')).toEqual(['กข 1234กรุงเทพฯ'])
  })

  it('reads the longer name whole, not the shorter one inside it', () => {
    expect(found('ทะเบียน กข 1234 กรุงเทพมหานคร')).toEqual(['กข 1234 กรุงเทพมหานคร'])
    expect(found('ทะเบียน กข 1234 พระนครศรีอยุธยา')).toEqual(['กข 1234 พระนครศรีอยุธยา'])
  })

  it('is not invented: เลย is "at all" far more often than it is Loei', () => {
    expect(found('ทะเบียน กข 1234 เลยค่ะ')).toEqual(['กข 1234'])
  })

  it('is left alone when something else follows', () => {
    expect(found('ทะเบียน กข 1234 ค่ะ')).toEqual(['กข 1234'])
  })
})

describe('the other side asked for it', () => {
  const ask = (text: string, previous?: string) =>
    licensePlateDetector
      .detect(normalise(text), { ...CTX, ...(previous === undefined ? {} : { previous }) })
      .map((c) => normalise(text).text.slice(c.start, c.end))

  it('reads a bare short answer as a plate', () => {
    expect(ask('กข 1234', 'ขอทะเบียนรถด้วยค่ะ')).toEqual(['กข 1234'])
    expect(ask('7พด 9615 ชลบุรี', 'ทะเบียนรถอะไรคะ')).toEqual(['7พด 9615 ชลบุรี'])
  })

  it('does not, when the question was about something else', () => {
    expect(ask('กข 1234', 'ขอเบอร์โทรด้วยค่ะ')).toEqual([])
  })

  it('does not, when the customer has moved on to a long message', () => {
    expect(ask(`กข 1234 ${'แล้วก็อยากถามเรื่องอื่นด้วย '.repeat(4)}`, 'ทะเบียนรถอะไรคะ')).toEqual([])
  })
})

describe('without a cue', () => {
  it('does not claim a consonant and a number, which is ordinary Thai', () => {
    expect(detect('จอง 2 คน ชั้น 3 ห้อง ก 12')).toEqual([])
    expect(detect('ของ 5 ชิ้น')).toEqual([])
    expect(detect('ขอ 2 กล่อง')).toEqual([])
  })

  it('reports the series-digit shape, below the default threshold', () => {
    const [c] = detect('มารับรถ 1กข 2345 นะ')
    expect(c).toBeDefined()
    expect(c?.confidence).toBeLessThan(0.95)
  })
})

describe('leaves alone', () => {
  it('a cue that is not near the value', () => {
    expect(detect('ทะเบียนรถ กข 1234 ส่งของ 5 ชิ้น').length).toBe(1)
  })

  it('a word that is only consonants, under a cue', () => {
    expect(detect('ทะเบียนรถ 1234')).toEqual([])
    expect(detect('ทะเบียนบ้านของ 5 หลัง')).toEqual([])
  })

  it('five digits, which no plate has', () => {
    expect(detect('ทะเบียน กข 12345')).toEqual([])
  })

  it('a value inside a longer token', () => {
    expect(detect('ทะเบียน Akข 1234')).toEqual([])
    expect(detect('ทะเบียน กข 1234a')).toEqual([])
  })

  it('"plate" inside another word', () => {
    expect(detect('template กข 1234')).toEqual([])
  })

  it('Latin letters, which no Thai plate carries', () => {
    expect(detect('ทะเบียน AB 1234')).toEqual([])
  })

  it('a plate pressed against Thai text on the left with no cue before it', () => {
    expect(detect('รถของฉันกข 1234')).toEqual([])
  })
})

describe('evidence for and against', () => {
  const score = (text: string) => detect(text)[0]?.confidence
  const ACTED = 0.95

  it('acts on a cued four-digit plate and no more than that', () => {
    expect(score('ทะเบียน กข 1234')).toBeGreaterThanOrEqual(ACTED)
    // With a cue beside it, even one digit is (กจ 82 and สส 5 are bought at auction)…
    expect(score('ทะเบียน กข 1')).toBeGreaterThanOrEqual(ACTED)
    // …but a cue further back, and one digit, is not enough until the dial is turned down.
    expect(score('ขอแจ้งทะเบียนรถนะคะ คันใหม่ที่จะมาคือ กข 1')).toBeLessThan(ACTED)
  })

  it('a province after the number is evidence, not a cue: found at 0.7, not acted on', () => {
    const c = score('ตต 1199 ขอนแก่น')
    expect(c).toBeDefined()
    expect(c).toBeLessThan(ACTED)
    expect(c).toBeGreaterThanOrEqual(0.7)
  })

  it('a count word after a small number is evidence against, even with a cue and a province', () => {
    expect(found('สำเนาทะเบียนบ้าน ขอ 2 ชุดค่ะ')).toEqual([])
    expect(found('ต่อทะเบียนรถครบ 5 ปีแล้วค่ะ')).toEqual([])
    expect(found('ทะเบียนรถ จด 2 คันเลยค่ะ')).toEqual([])
    expect(found('จอง 2 เชียงใหม่ ค่ะ')).toEqual([])
    expect(found('ขอ 2 กรุงเทพ ครับ')).toEqual([])
  })

  it('an amount is evidence against', () => {
    expect(found('ค่าโอนทะเบียน รวม 3500 บาทค่ะ')).toEqual([])
    expect(found('ทะเบียน ยอด 1,500 บาท')).toEqual([])
  })

  it('a place or a position in front is evidence against', () => {
    expect(found('ห้อง ก 12 ชลบุรี')).toEqual([])
    // Even with a cue in reach the position pulls it under the line it is acted on.
    expect(score('ทะเบียนที่นั่ง ก 12') ?? 0).toBeLessThan(ACTED)
  })

  it('the year after a plate is not a count: กข 1234 ปี 2563', () => {
    expect(found('ทะเบียน กข 1234 ปี 2563')).toEqual(['กข 1234'])
  })

  it('house, marriage and trade registrations are not vehicle plates', () => {
    expect(found('ทะเบียนบ้าน ก 12')).toEqual([])
    expect(found('สำเนาทะเบียนบ้าน กข 1234 ชุด')).toEqual([])
  })

  it('a cue earlier in the same message reaches a plate further on', () => {
    const text = 'ขอแจ้งทะเบียนรถสำหรับจอดที่โรงแรมนะคะ เป็นฮอนด้าซีวิคสีเทา มาถึงประมาณบ่ายสอง คันนี้ ภธ 2468'
    expect(found(text)).toEqual(['ภธ 2468'])
    expect(score(text)).toBeGreaterThanOrEqual(ACTED)
  })

  it("a second plate in the same list shares the first one's cue", () => {
    expect(found('ทะเบียน กข 1234 กับ ขค 5678 จะเข้ามาจอดสองคันค่ะ')).toEqual(['กข 1234', 'ขค 5678'])
    expect(found('ทะเบียน กข 1234, ขค 5678 และ ฆง 9012')).toHaveLength(3)
  })

  it('a double space, an en dash and an invisible character between letters and number', () => {
    expect(found('ทะเบียน บย  6012 ค่ะ')).toEqual(['บย  6012'])
    expect(found('ทะเบียน ศษ–3301 ครับ')).toEqual(['ศษ–3301'])
    expect(found('ทะเบียน กข\u200b1234')).toHaveLength(1)
  })

  it('reports the lowest evidence it will, and nothing below it', () => {
    expect(detect('กข 1234')).toEqual([])
    expect(detect('คน 5')).toEqual([])
  })
})
