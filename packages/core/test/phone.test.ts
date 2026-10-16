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

  it('yields to an account when the sentence says the number is one (D19)', () => {
    // Still claimed, so a policy that hides phones and only flags accounts
    // hides it; marked, so a policy that treats both alike names the account.
    expect(spans('เลขบัญชี 0812345678')).toEqual(['0812345678'])
    expect(detect('เลขบัญชี 0812345678')[0]?.yieldsTo).toBe('BANK_ACCOUNT')
    expect(detect('เบอร์ 0812345678')[0]?.yieldsTo).toBeUndefined()
  })

  it('keeps the number when both cues are present', () => {
    expect(detect('โอนเงินแล้วโทร 0812345678')).toHaveLength(1)
  })
})

// D17 — how people also write a number. Each shape was missed before 13 Oct.
describe('other separators', () => {
  it('reads dots, any dash, and spaces round a hyphen', () => {
    expect(spans('091.888.7777')).toEqual(['091.888.7777'])
    expect(spans('091–888–7777')).toEqual(['091–888–7777'])
    expect(spans('091—888—7777')).toEqual(['091—888—7777'])
    expect(spans('091 - 888 - 7777')).toEqual(['091 - 888 - 7777'])
  })

  it('takes both brackets round an area code into the span, and does not charge for them', () => {
    expect(spans('(053) 123-456')).toEqual(['(053) 123-456'])
    expect(spans('สาขา (02)987-6543 ต่อ 12')).toEqual(['(02)987-6543'])
    expect(detect('(053) 123-456')[0]?.confidence).toBe(0.95)
  })

  it('leaves a bracket round the whole number outside the span', () => {
    expect(spans('(0918887777)')).toEqual(['0918887777'])
    expect(spans('(091-888-7777)')).toEqual(['091-888-7777'])
  })

  it('reads a line break as a space', () => {
    expect(spans('091 888\n7777')).toEqual(['091 888\n7777'])
    expect(spans('ราคา 450\n0918887777')).toEqual(['0918887777'])
    expect(spans('0918887777\n0891234567')).toEqual(['0918887777', '0891234567'])
  })

  it('starts a new number after a dot, as after a space', () => {
    expect(spans('1.0918887777')).toEqual(['0918887777'])
  })

  it('charges dots, so a dotted landline needs a cue to act', () => {
    expect(detect('091.888.7777')[0]?.confidence).toBe(0.95)
    expect(detect('02.123.4567')[0]?.confidence).toBe(0.93)
    expect(detect('โทร 02.123.4567')[0]?.confidence).toBe(0.99)
  })

  it('charges dots grouped the way nobody writes a number', () => {
    expect(detect('0918.887.777')[0]?.confidence).toBe(0.92)
  })

  it('takes any grouping of spaces and hyphens, as it always has', () => {
    expect(detect('0918 887 777')[0]?.confidence).toBe(0.97)
  })

  it('splits two numbers that share a run', () => {
    expect(spans('091 888 7777 089 123 4567')).toEqual(['091 888 7777', '089 123 4567'])
    expect(spans('โทร 091-888-7777. 02-123-4567')).toEqual(['091-888-7777', '02-123-4567'])
  })

  it('leaves dotted dates and amounts alone', () => {
    expect(detect('นัด 09.10.2569')).toEqual([])
    expect(detect('ยอด 1.250.000 บาท')).toEqual([])
    expect(detect('เวลา 09.30-10.30 น.')).toEqual([])
  })
})

describe('no leading 0, or 66 without the plus', () => {
  it('reads the number when a cue says it is a phone', () => {
    expect(spans('เบอร์ 918887777')).toEqual(['918887777'])
    expect(spans('โทร 66918887777')).toEqual(['66918887777'])
    expect(detect('เบอร์ 918887777')[0]?.confidence).toBe(0.96)
  })

  it('reads the cue from the question the message answers', () => {
    const asked = { ...CTX, previous: 'ขอเบอร์ติดต่อหน่อยค่ะ' }
    expect(phoneDetector.detect(normalise('918887777'), asked)).toHaveLength(1)
  })

  it('leaves the number alone with no cue', () => {
    // Nine digits are an order, an amount, anything — Excel drops the 0 and
    // nobody can tell any more, so it is not guessed.
    expect(detect('918887777')).toEqual([])
    expect(detect('ยอดโอน 918887777 บาท')).toEqual([])
    expect(detect('66918887777')).toEqual([])
  })

  it('stands down when the sentence or the question names an order', () => {
    expect(detect('ไม่ต้องให้เบอร์ค่ะ แจ้งเลขออเดอร์ 918887777')).toEqual([])
    const asked = { ...CTX, previous: 'แจ้งเบอร์หรือเลขออเดอร์ก็ได้ค่ะ' }
    expect(phoneDetector.detect(normalise('918887777'), asked)).toEqual([])
  })

  it('still takes a number with its 0 next to an order cue', () => {
    expect(detect('เลขออเดอร์ 0918887777')).toHaveLength(1)
  })
})

describe('short public numbers', () => {
  it('are never a phone number: they identify no one', () => {
    for (const n of ['191', '1669', '1112', '1300', '1555']) {
      expect(detect(`ฉุกเฉินโทร ${n} ได้เลย`)).toEqual([])
    }
  })
})

describe('letter O typed for the leading 0', () => {
  it('takes the O into the span of a number the cue already found', () => {
    expect(spans('โทร O91-888-7777')).toEqual(['O91-888-7777'])
    expect(spans('เบอร์ o2 987 6543')).toEqual(['o2 987 6543'])
  })

  it('does not change the score the number got without it', () => {
    expect(detect('โทร O91-888-7777')[0]?.confidence).toBe(0.96)
  })

  it('makes no number a phone that was not one already', () => {
    expect(detect('O918887777')).toEqual([])
    expect(detect('รหัส O91-888-7777')).toEqual([])
  })

  it('leaves the O out when it ends a word, or when the 0 is there too', () => {
    expect(spans('โทร PO918887777')).toEqual(['918887777'])
    expect(spans('โทร O0918887777')).toEqual(['0918887777'])
  })
})

// Code review, 13 Oct: a date and a time together are ten digits or more.
describe('dates and times', () => {
  it('does not read a dotted date and the time after it as a phone', () => {
    expect(detect('โทรกลับวันที่ 21.06.2569 13.30')).toEqual([])
    expect(detect('นัดรับของ 21.06.2569 13.30 น.')).toEqual([])
  })

  it('does not read a date with a two-digit year and a time as a phone', () => {
    expect(detect('โทรหาลูกค้า 09.11.68 14.15')).toEqual([])
  })

  it('does not read a date written with dashes, or a bare hour, as a phone', () => {
    expect(detect('ส่งของ 08-12-2568 11.45')).toEqual([])
    expect(detect('นัด 09.11.2568 10 โมง')).toEqual([])
  })

  it('still finds a number in the same run as a date', () => {
    expect(spans('นัด 21.06.2569 0861234567')).toEqual(['0861234567'])
    expect(spans('ส่ง 21.06.2569 13.30 091-888-7777')).toEqual(['091-888-7777'])
  })

  it('still finds a number grouped in twos that only looks like a time inside a longer chain', () => {
    expect(spans('โทร 081.234.12.34')).toEqual(['081.234.12.34'])
  })
})

describe('cost', () => {
  it('reads a long run of single digits in linear time', () => {
    // Every pair of groups was scored: 2 KB of "0 1 2 …" took 1.6 s.
    for (const sep of [' ', '.', '\n']) {
      let text = ''
      for (let i = 0; text.length < 100 * 1024; i++) text += `${i % 10}${sep}`
      const started = performance.now()
      detect(text)
      expect(performance.now() - started).toBeLessThan(2000)
    }
  })
})

// User benchmark, 14 Oct (D20): tool output names the number with a field
// name, not a word.
describe('cue words', () => {
  it("reads a telco's msisdn field as a phone cue", () => {
    expect(spans('recharge(msisdn=66851234567, pack=30D)')).toEqual(['66851234567'])
    expect(spans('{"msisdn":"851234567"}')).toEqual(['851234567'])
  })
})

// User benchmark, 14 Oct (D20): a list pasted under one heading.
describe('a list, one number a line', () => {
  const header = 'เบอร์ของทุกคนในทีมค่ะ'

  it('reads each line as the line above was read, past the cue window', () => {
    expect(spans(`${header}\n851234567\n861234567\n871234567\n891234567`)).toEqual([
      '851234567',
      '861234567',
      '871234567',
      '891234567',
    ])
  })

  it('reads a numbered or bulleted list the same way', () => {
    expect(spans('เบอร์ค่ะ\n1) 851234567\n2) 861234567\n- 871234567')).toEqual([
      '851234567',
      '861234567',
      '871234567',
    ])
  })

  it('reads an indented list line, up to 64 characters of lead', () => {
    // The lead is bounded so the check stays linear on a long line (16 Oct);
    // the bound is far past any indent a chat has.
    for (const n of [16, 17, 64]) {
      expect(spans(`เบอร์ค่ะ\n851234567\n${' '.repeat(n)}861234567`)).toHaveLength(2)
    }
    expect(spans(`เบอร์ค่ะ\n851234567\n${' '.repeat(65)}861234567`)).toHaveLength(1)
  })

  it('starts a number after the bracket of a list item, which closes no area code', () => {
    // Every ) was read as the end of an area code, so no number could start
    // after one: "1) 0812345678" was missed with or without a cue.
    expect(spans('1) 0851234567\n2) 0861234567')).toEqual(['0851234567', '0861234567'])
    expect(spans('(02) 123 4567')).toEqual(['(02) 123 4567'])
  })

  it('ends the list at a blank line', () => {
    expect(spans(`${header}\n851234567\n861234567\n\n871234567`)).toEqual([
      '851234567',
      '861234567',
    ])
  })

  it('ends the list at a line that opens with a word, or names an order', () => {
    expect(spans(`${header}\n851234567\n861234567\nยอดรวม 871234567`)).toHaveLength(2)
    expect(spans(`${header}\n851234567\n861234567\n871234567 ออเดอร์`)).toHaveLength(2)
  })

  it('borrows nothing from a line with no phone on it', () => {
    expect(detect(`ยอดโอนของทุกคนในทีมค่ะ\n851234567\n861234567`)).toEqual([])
  })
})

// User benchmark, 14 Oct (D20): tool and webhook timestamps.
describe('a key that names a time', () => {
  it('is not a phone cue, even beside one', () => {
    expect(detect('sms_sent ts=851234567')).toEqual([])
    expect(detect('otp {"created_at":851234567}')).toEqual([])
  })
})

// User benchmark, 14 Oct (D20): an account in the grouping a passbook prints.
describe('the passbook grouping 3-1-5-1', () => {
  it('yields to BANK_ACCOUNT under any account cue the bank detector reads', () => {
    expect(detect('โอนคืนเข้า 089-7-65432-1 ค่ะ')[0]?.yieldsTo).toBe('BANK_ACCOUNT')
    expect(detect('kasikorn 089-7-65432-1')[0]?.yieldsTo).toBe('BANK_ACCOUNT')
  })

  it('yields even beside a phone cue: no phone is written that way', () => {
    expect(detect('โทรแจ้งก่อนโอนคืนเข้า 089-7-65432-1')[0]?.yieldsTo).toBe('BANK_ACCOUNT')
  })

  it('keeps a number in a phone grouping under a transfer cue, as PromptPay is', () => {
    expect(detect('โอนเข้า 089-765-4321 ค่ะ')[0]?.yieldsTo).toBeUndefined()
  })

  it('keeps the grouping a phone with no account cue', () => {
    expect(detect('089-7-65432-1')[0]?.yieldsTo).toBeUndefined()
  })
})

// User question, 14 Oct (D20): the account abbreviation, read as the bank
// detector reads it so the two agree on which run is an account.
describe('the account abbreviation บช', () => {
  it('yields to BANK_ACCOUNT under บช, บ/ช or บ.ช', () => {
    expect(detect('บช 0897654321')[0]?.yieldsTo).toBe('BANK_ACCOUNT')
    expect(detect('เลขที่ บ/ช 0897654321')[0]?.yieldsTo).toBe('BANK_ACCOUNT')
    expect(detect('บ.ช. 0897654321')[0]?.yieldsTo).toBe('BANK_ACCOUNT')
  })

  it('yields when the question asked with บช', () => {
    const asked = { ...CTX, previous: 'ขอเลข บช ค่ะ' }
    expect(phoneDetector.detect(normalise('0897654321'), asked)[0]?.yieldsTo).toBe('BANK_ACCOUNT')
  })

  it('does not yield to บช inside a word', () => {
    expect(detect('ขออภัยตอบช้า 0897654321')[0]?.yieldsTo).toBeUndefined()
  })
})
