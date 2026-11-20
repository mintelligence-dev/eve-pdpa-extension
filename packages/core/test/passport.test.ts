import { describe, expect, it } from 'vitest'
import { canonicalValue } from '../src/actions/canonical.js'
import { passportDetector } from '../src/detectors/passport.js'
import { normalise } from '../src/normalise.js'
import type { Candidate, DetectContext } from '../src/types.js'

const CTX: DetectContext = { sessionId: 'test', boundary: 'inbound' }

function detect(text: string, previous?: string): Candidate[] {
  return passportDetector.detect(normalise(text), { ...CTX, previous }) as Candidate[]
}

/** Every candidate's text, at any confidence. */
function found(text: string, previous?: string): string[] {
  const n = normalise(text).text
  return detect(text, previous).map((c) => n.slice(c.start, c.end))
}

/** What the guard acts on at the default 0.95. */
function hidden(text: string, previous?: string): string[] {
  const n = normalise(text).text
  return detect(text, previous)
    .filter((c) => c.confidence >= 0.95)
    .map((c) => n.slice(c.start, c.end))
}

describe('a Thai passport with a cue', () => {
  it('Thai and English cues', () => {
    expect(hidden('พาสปอร์ต AB1234567')).toEqual(['AB1234567'])
    expect(hidden('หนังสือเดินทางเลขที่ AB1234567 ค่ะ')).toEqual(['AB1234567'])
    expect(hidden('passport no. AB1234567')).toEqual(['AB1234567'])
    expect(hidden('เลขพาส AB1234567')).toEqual(['AB1234567'])
  })

  it('a space or a dash inside, and lower case', () => {
    expect(hidden('พาสปอร์ต AB 1234567')).toEqual(['AB 1234567'])
    expect(hidden('พาสปอร์ต AB-1234567')).toEqual(['AB-1234567'])
    expect(hidden('พาสปอร์ต ab1234567')).toEqual(['ab1234567'])
  })

  it('pressed against the cue, and bare "พาส" only there', () => {
    expect(hidden('พาสปอร์ตAB1234567')).toEqual(['AB1234567'])
    expect(hidden('พาส AB1234567')).toEqual(['AB1234567'])
  })

  it('the answer to "ขอเลขพาสปอร์ตค่ะ"', () => {
    expect(hidden('AB1234567 ค่ะ', 'รบกวนขอเลขพาสปอร์ตค่ะ')).toEqual(['AB1234567'])
  })

  it('more separators, and the digits as three and four', () => {
    expect(hidden('passport no. AJ–6650291')).toEqual(['AJ–6650291'])
    expect(hidden('เลขพาสปอร์ต AK.2219807')).toEqual(['AK.2219807'])
    expect(hidden('พาสปอร์ต AL  8834012')).toEqual(['AL  8834012'])
    expect(hidden('เลขพาส AM 557 0936')).toEqual(['AM 557 0936'])
    expect(canonicalValue('PASSPORT', 'AM 557 0936')).toBe('AM5570936')
    expect(found('invoice No.1234567')).toEqual([])
  })

  it('a cue after the number, and misspelt or Chinese cues', () => {
    expect(hidden('AR5756657 คือเลขหนังสือเดินทางของลูกค่ะ')).toEqual(['AR5756657'])
    expect(hidden('พาสปอท AB5093721')).toEqual(['AB5093721'])
    expect(hidden('พาสสปอร์ทลูก KX3905370 ค่ะ')).toEqual(['KX3905370'])
    expect(hidden('pasport AC6604183')).toEqual(['AC6604183'])
    expect(hidden('เล่มพาสใหม่เลข AD1938274')).toEqual(['AD1938274'])
    expect(hidden('护照号码 E59031746')).toEqual(['E59031746'])
  })

  it('a long list of travellers answering the other side', () => {
    const list =
      'สรุปให้ค่ะ\nประยูร ทองดี - RK4300074\nสมชาย บุญมา - HN0474406\nวิภา สายสุวรรณ - CD0458133 (เด็ก)\nขอห้องติดกันนะคะ'
    expect(hidden(list, 'รบกวนสรุปรายชื่อ+เลขหนังสือเดินทางลูกทัวร์ทั้งหมดค่ะ')).toEqual([
      'RK4300074',
      'HN0474406',
      'CD0458133',
    ])
  })

  it('not when the other side said the number is not needed', () => {
    expect(
      hidden('แล้วอีกห้องของเพื่อน RP3828014 รวมบิลกันได้ไหมคะ', 'ใช้พาสปอร์ตตัวจริงค่ะ ไม่ต้องส่งเลขมาล่วงหน้านะคะ'),
    ).toEqual([])
  })

  it('a group code after a passport word is not hidden', () => {
    expect(hidden('รบกวนสรุปเลขหนังสือเดินทางลูกทัวร์ทั้งหมดค่ะ กรุ๊ป JT3526830')).toEqual([])
  })

  it('two travellers under one cue', () => {
    expect(hidden('พาสปอร์ต AB1234567 กับ CD7654321')).toEqual(['AB1234567', 'CD7654321'])
  })
})

describe('a Thai-shaped number with no cue', () => {
  it('is reported for review, under the default threshold', () => {
    expect(found('AB1234567')).toEqual(['AB1234567'])
    expect(hidden('AB1234567')).toEqual([])
    expect(detect('AB1234567')[0]?.confidence).toBe(0.6)
  })

  it('is not reported beside a parcel, an order, a booking or a staff number', () => {
    expect(found('เลขพัสดุ AB1234567')).toEqual([])
    expect(found('booking ref AB1234567')).toEqual([])
    expect(found('รหัสสินค้า SK1234567')).toEqual([])
    expect(found('รหัสพนักงาน EM1234567')).toEqual([])
    expect(found('invoice no. IV1234567')).toEqual([])
  })

  it('a passport cue pressed against it outweighs a booking nearby', () => {
    expect(hidden('โรงแรมขอ booking กับ passport AB1234567')).toEqual(['AB1234567'])
  })
})

describe('a foreign passport', () => {
  it('a number word with a passport cue earlier in the same stretch', () => {
    expect(hidden('พาสปอร์ตสามีเป็นอเมริกันค่ะ เลข 493018275')).toEqual(['493018275'])
  })

  it('only with a cue pressed against it', () => {
    expect(hidden('passport: E12345678')).toEqual(['E12345678'])
    expect(hidden('passport: 123456789')).toEqual(['123456789'])
    expect(hidden('E12345678 ค่ะ', 'ขอเลขหนังสือเดินทางค่ะ')).toEqual(['E12345678'])
    expect(found('E12345678')).toEqual([])
  })

  it('not a price or a short number', () => {
    expect(found('ค่าทำพาสปอร์ต 150000 บาท')).toEqual([])
    expect(found('พาสปอร์ต 1000')).toEqual([])
  })
})

describe('not a passport', () => {
  it('inside a longer code', () => {
    expect(found('เลขพัสดุ EX123456789TH')).toEqual([])
    expect(found('KEX1234567')).toEqual([])
    expect(found('AB12345678')).toEqual([])
    expect(found('AB123456')).toEqual([])
  })

  it('the bill, a cover, a scanner or the Wi-Fi, even beside a passport word', () => {
    expect(found('ใบแจ้งหนี้ค่าธรรมเนียมทำพาสปอร์ต IV1192837')).toEqual([])
    expect(found('ปกพาสปอร์ตรหัส PP1029384')).toEqual([])
    expect(found('เครื่องสแกนพาสปอร์ตเสีย S/N SN4820193')).toEqual([])
    expect(found('ไวไฟห้อง ชื่อ HotelGuest พาส RM4820173')).toEqual([])
  })

  it('a booking number after a passport word is not hidden', () => {
    expect(hidden('ส่งพาสปอร์ตให้แล้ว เลขจอง BK9102837')).toEqual([])
  })

  it('a password', () => {
    expect(found('พาสเวิร์ด Ab123456')).toEqual([])
    expect(found('password: abc123456')).toEqual([])
  })

  it('look-alike letters are not read as digits', () => {
    expect(found('พาสปอร์ต AB12O4567')).toEqual([])
    expect(found('AB12O4567')).toEqual([])
  })
})

describe('canonical form', () => {
  it('upper case, separators out', () => {
    for (const f of ['AB1234567', 'ab1234567', 'AB 1234567', 'ab-1234567']) {
      expect(canonicalValue('PASSPORT', f)).toBe('AB1234567')
    }
  })
})
