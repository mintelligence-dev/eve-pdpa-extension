import { describe, expect, it } from 'vitest'
import { addressDetector } from '../src/detectors/address.js'
import { PROVINCES } from '../src/detectors/license-plate.js'
import { normalise } from '../src/normalise.js'
import type { Candidate, DetectContext } from '../src/types.js'

const CTX: DetectContext = { sessionId: 'test', boundary: 'inbound' }

function detect(text: string, previous?: string): Candidate[] {
  const ctx = previous === undefined ? CTX : { ...CTX, previous }
  return addressDetector.detect(normalise(text), ctx) as Candidate[]
}

/** The text each candidate covers, in the normalised text the detector read. */
function found(text: string, previous?: string): string[] {
  const n = normalise(text).text
  return detect(text, previous).map((c) => n.slice(c.start, c.end))
}

const DEFAULT_THRESHOLD = 0.95

/** Found at the default threshold: what a policy with no minConfidence would hide. */
function hidden(text: string, previous?: string): string[] {
  const n = normalise(text).text
  return detect(text, previous)
    .filter((c) => c.confidence >= DEFAULT_THRESHOLD)
    .map((c) => n.slice(c.start, c.end))
}

describe('finds a whole address', () => {
  it('the full form, from house number to postcode', () => {
    const full = '99/9 หมู่ 5 ซอยสุขุมวิท 101 ต.บางจาก อ.พระโขนง จ.กรุงเทพมหานคร 10260'
    expect(hidden(`ส่งมาที่ ${full} ค่ะ`)).toEqual([full])
  })

  it('with the labels spelt out, and no spaces, as Thai is written', () => {
    const full = 'บ้านเลขที่ 12 หมู่ที่ 3 ตำบลบางพลี อำเภอบางพลี จังหวัดสมุทรปราการ 10540'
    expect(hidden(full)).toEqual([full])
    const tight = 'บ้านเลขที่12หมู่3ซอยลาดพร้าว12แขวงจอมพลเขตจตุจักรกรุงเทพมหานคร10900'
    expect(hidden(tight)).toEqual([tight])
  })

  it('a house number with no label, when a label follows it', () => {
    expect(hidden('88/12 ถนนสุขุมวิท แขวงคลองตัน เขตคลองเตย กรุงเทพ')).toEqual([
      '88/12 ถนนสุขุมวิท แขวงคลองตัน เขตคลองเตย กรุงเทพ',
    ])
  })

  it('a province with no จ., right after another part', () => {
    expect(hidden('ซอยเพชรเกษม 48 ต.อ้อมน้อย อ.กระทุ่มแบน สมุทรสาคร 74130')).toEqual([
      'ซอยเพชรเกษม 48 ต.อ้อมน้อย อ.กระทุ่มแบน สมุทรสาคร 74130',
    ])
  })

  it('a condo, a floor and a room count as one kind of part', () => {
    const text = 'ที่อยู่ คอนโดริเวอร์ ชั้น 12 ห้อง 1205 ถนนพระราม 3 เขตยานนาวา กรุงเทพ'
    expect(found(text)).toHaveLength(1)
    expect(hidden(text)).toHaveLength(1)
  })

  it('Thai numerals', () => {
    expect(hidden('๙๙/๙ หมู่ ๕ ต.บางจาก อ.พระโขนง จ.กรุงเทพมหานคร ๑๐๒๖๐')).toHaveLength(1)
  })

  it('an address on several lines', () => {
    expect(hidden('บ้านเลขที่ 7\nหมู่ 2 ต.สุเทพ\nอ.เมือง จ.เชียงใหม่ 50200')).toHaveLength(1)
  })

  it('leaves the cue word readable', () => {
    expect(found('ที่อยู่ 12 ซอยร่วมใจ ต.ท่าศาลา อ.เมือง')[0]?.startsWith('12')).toBe(true)
  })

  it('the one named by the other side', () => {
    expect(hidden('12/3 ซอยร่วมใจ ลำพูน', 'ขอที่อยู่จัดส่งด้วยค่ะ')).toHaveLength(1)
  })
})

describe('two kinds of part', () => {
  it('are reported under the default threshold when nothing says it is an address', () => {
    const [hit] = detect('อ.เมือง จ.เชียงใหม่')
    expect(hit).toBeDefined()
    expect(hit?.confidence).toBeLessThan(DEFAULT_THRESHOLD)
    expect(hidden('อ.เมือง จ.เชียงใหม่')).toEqual([])
  })

  it('are hidden when a cue word says it is an address', () => {
    expect(hidden('จัดส่งที่ ถนนสุขุมวิท กรุงเทพ')).toHaveLength(1)
  })
})

describe('does not find', () => {
  it('ordinary Thai that holds one label word', () => {
    expect(found('ซอยหมูให้ละเอียดนะคะ')).toEqual([])
    expect(found('อยู่ในเขตร้อน')).toEqual([])
    expect(found('ตากผ้าที่ระเบียง')).toEqual([])
  })

  it('a province name on its own', () => {
    expect(found('ไปเที่ยวเชียงใหม่มา')).toEqual([])
    expect(found('เลยค่ะ')).toEqual([])
  })

  it('a bare province after a label word is not enough without a second part', () => {
    expect(hidden('ซอยเชียงใหม่')).toEqual([])
  })

  it('a five-digit number that is not a postcode', () => {
    expect(found('ออเดอร์ 12345 จัดส่งแล้ว')).toEqual([])
    expect(found('ยอด 98765 บาท')).toEqual([])
  })

  it('a rank written with จ., not a province', () => {
    expect(found('จ.ส.ต. สมชาย')).toEqual([])
  })

  it('an invoice number after เลขที่', () => {
    expect(found('เลขที่ 123456 ลงวันที่ 5 มกราคม')).toEqual([])
  })

  it('romanised addresses (a known limit)', () => {
    expect(found('99/9 Soi Sukhumvit 101, Bangkok 10260')).toEqual([])
  })
})

describe('the province list', () => {
  it('is the one the plate detector reads: 76 provinces, and Bangkok and Ayutthaya spellings', () => {
    // 76 of 77 (เลย is left out) + กรุงเทพฯ, กรุงเทพ, กทม., กทม and อยุธยา.
    expect(new Set(PROVINCES).size).toBe(PROVINCES.length)
    expect(PROVINCES.length).toBe(81)
  })
})

describe('long input', () => {
  it('is read in linear time, however many labels it holds', () => {
    const text = 'ซอย ถนน ตำบล เขต 12/3 หมู่ 4 '.repeat(4000)
    const started = Date.now()
    detect(text)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('a province name repeated with nothing before it is not slow either', () => {
    const text = 'เชียงใหม่ '.repeat(10000)
    const started = Date.now()
    expect(detect(text)).toEqual([])
    expect(Date.now() - started).toBeLessThan(2000)
  })
})
