import { describe, expect, it } from 'vitest'
import { dateOfBirthCanonical, dateOfBirthDetector } from '../src/detectors/date-of-birth.js'
import { normalise } from '../src/normalise.js'
import type { Candidate, DetectContext } from '../src/types.js'

const CTX: DetectContext = { sessionId: 'test', boundary: 'inbound' }

function detect(text: string, previous?: string): Candidate[] {
  return dateOfBirthDetector.detect(normalise(text), { ...CTX, previous }) as Candidate[]
}

/** The text each candidate covers, in the normalised text the detector read. */
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

describe('finds, when the sentence says it is a birthday', () => {
  it('numbers with a slash, a dash or a dot', () => {
    expect(hidden('วันเกิด 12/05/2530')).toEqual(['12/05/2530'])
    expect(hidden('วันเกิด 1-5-2530')).toEqual(['1-5-2530'])
    expect(hidden('วันเกิด 12.05.2530')).toEqual(['12.05.2530'])
    expect(hidden('birthday 1987-05-12')).toEqual(['1987-05-12'])
  })

  it('Thai months, short and long, with the era', () => {
    expect(hidden('เกิด 12 พ.ค. 2530')).toEqual(['12 พ.ค. 2530'])
    expect(hidden('เกิด 12 พค 2530')).toEqual(['12 พค 2530'])
    expect(hidden('เกิด 12 พฤษภาคม 2530')).toEqual(['12 พฤษภาคม 2530'])
    expect(hidden('เกิด 12 พฤษภา 2530')).toEqual(['12 พฤษภา 2530'])
    expect(hidden('เกิดวันที่ 12 เดือนพฤษภาคม พ.ศ. 2530')).toEqual(['12 เดือนพฤษภาคม พ.ศ. 2530'])
  })

  it('English months, either way round', () => {
    expect(hidden('DOB: 12 May 1987')).toEqual(['12 May 1987'])
    expect(hidden('DOB: May 12, 1987')).toEqual(['May 12, 1987'])
    expect(hidden('date of birth 12th Jan 1987')).toEqual(['12th Jan 1987'])
  })

  it('pressed against the cue, which Thai writes without a space', () => {
    expect(hidden('เกิด12/05/2530')).toEqual(['12/05/2530'])
    expect(hidden('วันเกิดคือ 12/05/2530')).toEqual(['12/05/2530'])
    expect(hidden('เกิดเมื่อวันที่ 12/05/2530')).toEqual(['12/05/2530'])
  })

  it('a cue after the date', () => {
    expect(hidden('12/05/2530 วันเกิดค่ะ')).toEqual(['12/05/2530'])
  })

  it('Thai numerals', () => {
    expect(hidden('วันเกิด ๑๒/๐๕/๒๕๓๐')).toEqual(['12/05/2530'])
  })

  it('a two-digit year or no year, only with the cue right there', () => {
    expect(hidden('เกิด 12 พ.ค. 30')).toEqual(['12 พ.ค. 30'])
    expect(hidden('วันเกิด 12 มีนา')).toEqual(['12 มีนา'])
    expect(found('ราคา 12/05/30')).toEqual([])
    expect(found('ประชุม 12 มีนา')).toEqual([])
  })

  it('the answer to "วันเกิดอะไรคะ", read from the other side’s last message', () => {
    expect(hidden('12/05/2530', 'รบกวนแจ้งวันเกิดด้วยค่ะ')).toEqual(['12/05/2530'])
    expect(hidden('12 พ.ค. 30 ค่ะ', 'ขอวันเดือนปีเกิดค่ะ')).toEqual(['12 พ.ค. 30'])
    expect(hidden('12/05/2530', 'ส่งของวันไหนดีคะ')).toEqual([])
  })

  it('a list under one cue', () => {
    expect(hidden('วันเกิด\n12/05/2530\n01/01/2535')).toEqual(['12/05/2530', '01/01/2535'])
  })

  it('a list on one line, each date after a short label', () => {
    expect(hidden('วันเกิดทุกคน พ่อ 3/7/2501 แม่ 15/1/2504 น้อง 22/9/2555')).toEqual([
      '3/7/2501',
      '15/1/2504',
      '22/9/2555',
    ])
    expect(hidden('วันเกิด 3/7/2501 ส่งของ 15/1/2569')).toEqual(['3/7/2501'])
  })

  it('the way forms and exports write it', () => {
    expect(hidden('วันเกิด 12 / 05 / 2530')).toEqual(['12 / 05 / 2530'])
    expect(hidden('เกิดวันที่ 12 เดือน 5 ปี 2530')).toEqual(['12 เดือน 5 ปี 2530'])
    expect(hidden('DOB 4-Jul-1991')).toEqual(['4-Jul-1991'])
    expect(hidden('birth_date: 1999-01-31')).toEqual(['1999-01-31'])
    expect(hidden('วันเกิด 12/5 ค่ะ')).toEqual(['12/5'])
  })

  it('month first only when the day cannot be a month', () => {
    expect(hidden('DOB 12/31/1988')).toEqual(['12/31/1988'])
    expect(dateOfBirthCanonical('12/31/1988')).toBe('1988-12-31')
    expect(dateOfBirthCanonical('05/06/1988')).toBe('1988-06-05')
  })

  it('a birth time after the date', () => {
    expect(hidden('ลูกเกิด 9 ม.ค. 2566 เวลา 08.45 น. ค่ะ')).toEqual(['9 ม.ค. 2566'])
  })
})

describe('does not act on a date that is not a birthday', () => {
  it('shipping, appointments, payment, expiry', () => {
    expect(hidden('ส่งของวันที่ 12.05.2565 ค่ะ')).toEqual([])
    expect(hidden('นัดวันที่ 12/05/2569 เวลา 14:30')).toEqual([])
    expect(hidden('ชำระภายใน 30/11/2569')).toEqual([])
    expect(hidden('บัตรหมดอายุ 12/05/2570')).toEqual([])
  })

  it('"เกิด" that means "happened"', () => {
    expect(hidden('อุบัติเหตุเกิดวันที่ 12/05/2567')).toEqual([])
    expect(hidden('วันที่เกิดรายการ 2 ตุลาคม 2567')).toEqual([])
    expect(hidden('เกิดเหตุเมื่อ 12/05/2567')).toEqual([])
    expect(hidden('รายการนี้เกิดเมื่อ 2/11/2569')).toEqual([])
  })

  it('a hometown, an animal, a party, a perk, or a date said not to be one', () => {
    expect(hidden('น้ำท่วมที่บ้านเกิดเมื่อ 15/10/2554')).toEqual([])
    expect(hidden('ลูกหมาเกิด 20/09/2569')).toEqual([])
    expect(hidden('ปาร์ตี้วันเกิดเพื่อน 22/11/2569')).toEqual([])
    expect(hidden('งานวันเกิดบริษัท 1 ธ.ค. 2569')).toEqual([])
    expect(hidden('สิทธิ์วันเกิดใช้ได้ถึง 30/11/2569')).toEqual([])
    expect(hidden('ไม่ใช่วันเกิดนะคะ 12/05/2569')).toEqual([])
  })

  it('a nickname that is also an animal is still a person', () => {
    expect(hidden('แมวเกิด 12/05/2530 ค่ะ')).toEqual(['12/05/2530'])
  })

  it('a cue that belongs to the next date', () => {
    expect(hidden('บัตรหมดอายุ 12/05/2570 วันเกิด 1/1/2530')).toEqual(['1/1/2530'])
  })

  it('a date range or a time', () => {
    expect(found('โปร 1-5 พ.ค. 2569')).toEqual([])
    expect(found('12/05/2569 14:30')).toEqual([])
  })

  it('a bare date with nothing round it is not hidden at 0.95', () => {
    expect(hidden('12/05/2530')).toEqual([])
    expect(hidden('สมชาย 12/05/2530 ส่งรูปให้')).toEqual([])
  })
})

describe('reads only real dates', () => {
  it('a day the month does not have', () => {
    expect(found('เกิด 31/02/2530')).toEqual([])
    expect(found('เกิด 31/04/2530')).toEqual([])
    expect(found('เกิด 13/13/2530')).toEqual([])
  })

  it('29 February only in a leap year, after Buddhist era is turned into Gregorian', () => {
    expect(hidden('เกิด 29/02/2531')).toEqual(['29/02/2531'])
    expect(found('เกิด 29/02/2530')).toEqual([])
  })

  it('a year no one was born in', () => {
    expect(found('เกิด 12/05/3000')).toEqual([])
  })

  it('not part of a longer number, a phone number or a version', () => {
    expect(found('โทร 081-234-5678')).toEqual([])
    expect(found('วันเกิด 112/05/2530')).toEqual([])
    expect(found('วันเกิด 12/05/25301')).toEqual([])
    expect(found('v1.12.05.2530')).toEqual([])
    expect(found('12/05-2530 วันเกิด')).toEqual([])
  })
})

describe('confidence', () => {
  it('with a cue it reaches the default threshold', () => {
    expect(detect('วันเกิด 12/05/2530')[0]?.confidence).toBe(1)
  })

  it('an old year and a name nearby, and no cue, stay under 0.95', () => {
    const c = detect('ชื่อ สมชาย ใจดี 12/05/2530')[0]?.confidence ?? 0
    expect(c).toBeGreaterThanOrEqual(0.7)
    expect(c).toBeLessThan(0.95)
  })
})

describe('canonical form', () => {
  it('every way of writing one birthday is one value', () => {
    for (const f of [
      '12/05/2530',
      '12-5-2530',
      '12.05.2530',
      '12 พ.ค. 2530',
      '12 พฤษภาคม พ.ศ. 2530',
      '12 พ.ค. 30',
      '1987-05-12',
      '12 May 1987',
      'May 12, 1987',
    ]) {
      expect(dateOfBirthCanonical(f)).toBe('1987-05-12')
    }
  })

  it('no year, and not a whole date', () => {
    expect(dateOfBirthCanonical('12 มีนา')).toBe('--03-12')
    expect(dateOfBirthCanonical('12/05/2530 ค่ะ')).toBeNull()
    expect(dateOfBirthCanonical('0918887777')).toBeNull()
  })

  it('two digits: Buddhist era for Thai, Gregorian for an English month or ค.ศ.', () => {
    expect(dateOfBirthCanonical('12/05/30')).toBe('1987-05-12')
    expect(dateOfBirthCanonical('12 May 87')).toBe('1987-05-12')
    expect(dateOfBirthCanonical('12 May 05')).toBe('2005-05-12')
  })
})
