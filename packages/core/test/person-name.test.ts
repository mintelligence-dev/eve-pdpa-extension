import { describe, expect, it } from 'vitest'
import { personNameDetector } from '../src/detectors/person-name.js'
import { normalise } from '../src/normalise.js'
import type { Candidate, DetectContext } from '../src/types.js'

// Every name below is made up. None is, or is meant to be, a real person.

const CTX: DetectContext = { sessionId: 'test', boundary: 'inbound' }

function detect(text: string, previous?: string): Candidate[] {
  const ctx = previous === undefined ? CTX : { ...CTX, previous }
  return personNameDetector.detect(normalise(text), ctx) as Candidate[]
}

function found(text: string, previous?: string): string[] {
  const n = normalise(text).text
  return detect(text, previous).map((c) => n.slice(c.start, c.end))
}

const DEFAULT_THRESHOLD = 0.95

/** What a policy with no minConfidence would hide. */
function hidden(text: string, previous?: string): string[] {
  const n = normalise(text).text
  return detect(text, previous)
    .filter((c) => c.confidence >= DEFAULT_THRESHOLD)
    .map((c) => n.slice(c.start, c.end))
}

describe('titles', () => {
  // [message, what is hidden]. The title goes with the name.
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['ดิฉันนางสาวสุดา รักไทย เลขบัตรประชาชน 3-1005-00123-45-1', 'นางสาวสุดา รักไทย'],
    ['สวัสดีครับ นายสมชาย ใจดี ขอสอบถามหน่อย', 'นายสมชาย ใจดี'],
    ['นางมาลี ศรีสุข ค่ะ', 'นางมาลี ศรีสุข'],
    ['น.ส.วิภา แก้วใส โทรมา', 'น.ส.วิภา แก้วใส'],
    ['ด.ช.ธีรภัทร พงษ์ไทย', 'ด.ช.ธีรภัทร พงษ์ไทย'],
    ['ด.ญ.พิมพ์ชนก สุขสวัสดิ์', 'ด.ญ.พิมพ์ชนก สุขสวัสดิ์'],
    ['เด็กชายกิตติ ทองดี', 'เด็กชายกิตติ ทองดี'],
    ['ดร.ประเสริฐ วงศ์ไทย', 'ดร.ประเสริฐ วงศ์ไทย'],
    ['นพ.อนุชา เมฆสุวรรณ รักษา', 'นพ.อนุชา เมฆสุวรรณ'],
    ['ลงชื่อ นายสมชายใจดี ผู้ซื้อ', 'นายสมชายใจดี'],
    ['Mr. Somchai Jaidee called', 'Mr. Somchai Jaidee'],
    ['Dr Jane Doe-Smith will attend', 'Dr Jane Doe-Smith'],
  ]
  for (const [message, expected] of cases) {
    it(`finds ${expected}`, () => {
      expect(hidden(message)).toEqual([expected])
    })
  }

  it('a surname that begins with a common word, like มีสุข', () => {
    expect(hidden('นายสมศักดิ์ มีสุข ครับ')).toEqual(['นายสมศักดิ์ มีสุข'])
  })

  it('the name ends at ค่ะ or ครับ written right against it', () => {
    expect(hidden('ดิฉันนางสาวสุดาค่ะ')).toEqual(['นางสาวสุดา'])
    expect(hidden('ผมนายสมชายครับ')).toEqual(['นายสมชาย'])
  })

  it('the name ends where the next thing the customer says begins', () => {
    expect(hidden('นายสมชาย ใจดี เบอร์ 081-888-7777')).toEqual(['นายสมชาย ใจดี'])
    expect(hidden('นายสมชาย ใจดีเลขที่ 99')).toEqual(['นายสมชาย ใจดี'])
  })
})

describe('คุณ', () => {
  it('a name after a space', () => {
    expect(hidden('สวัสดีค่ะ คุณ สมชาย ใจดี')).toEqual(['คุณ สมชาย ใจดี'])
  })

  it('คุณ against one word is the weaker reading, unless a greeting comes right before', () => {
    // It is also the pronoun "you": "คุณส่งสติกเกอร์".
    expect(hidden('คุณส่งสติกเกอร์')).toEqual([])
    expect(hidden('ขอบคุณค่ะคุณส่งสติกเกอร์')).toEqual([])
    expect(found('ขอบคุณค่ะคุณสมชาย')).toEqual(['คุณสมชาย'])
    expect(hidden('ขอบคุณค่ะคุณสมชาย')).toEqual([])
    // After a greeting it is a name.
    expect(hidden('สวัสดีค่ะคุณสมชาย')).toEqual(['คุณสมชาย'])
    expect(hidden('เรียนคุณมาลี')).toEqual(['คุณมาลี'])
  })

  it('คุณ against a first name and a surname is a name', () => {
    expect(hidden('สวัสดีครับ คุณธนากร แสงทอง')).toEqual(['คุณธนากร แสงทอง'])
    expect(hidden('คุณวิภาวดี ใจงาม สั่งสินค้าไว้')).toEqual(['คุณวิภาวดี ใจงาม'])
  })

  it('not คุณภาพ, คุณสมบัติ, คุณครู, คุณแม่, คุณลูกค้า', () => {
    for (const word of [
      'คุณภาพดีมาก',
      'คุณสมบัติครบ',
      'คุณครูคะ',
      'คุณแม่ไม่สบาย',
      'ขอบคุณลูกค้าที่ใช้บริการ',
      'ขอบคุณ ค่ะ',
    ]) {
      expect(found(word), word).toEqual([])
    }
  })
})

describe('an intro or a label', () => {
  it('ผมชื่อ, ดิฉันชื่อ, หนูชื่อ — the intro stays, the name goes', () => {
    expect(hidden('ผมชื่อสมชาย ใจดี ครับ')).toEqual(['สมชาย ใจดี'])
    expect(hidden('ดิฉันชื่อ สุดา รักไทย ค่ะ')).toEqual(['สุดา รักไทย'])
    expect(hidden('หนูชื่อพิมพ์ชนกค่ะ')).toEqual(['พิมพ์ชนก'])
  })

  it('my name is, in Latin letters', () => {
    expect(hidden('Hello, my name is Somchai Jaidee.')).toEqual(['Somchai Jaidee'])
  })

  it('ชื่อ-นามสกุล with a first name and a surname', () => {
    expect(hidden('ชื่อ-นามสกุล: สมชาย ใจดี')).toEqual(['สมชาย ใจดี'])
    expect(hidden('ชื่อผู้รับ สุดา รักไทย')).toEqual(['สุดา รักไทย'])
    expect(hidden('Name: Somchai Jaidee')).toEqual(['Somchai Jaidee'])
  })

  it('a label with one word after it is reported, under the default threshold', () => {
    expect(found('ชื่อ สมชาย')).toEqual(['สมชาย'])
    expect(hidden('ชื่อ สมชาย')).toEqual([])
  })

  it('not a label that heads a product, a shop or a file', () => {
    for (const word of [
      'ชื่อสินค้า เสื้อยืดสีขาว',
      'ชื่อร้าน กาแฟสด',
      'ชื่อไฟล์ report',
      'ชื่อโปรโมชั่น ลด 50',
      'ชื่อเสียงดี',
    ]) {
      expect(found(word), word).toEqual([])
    }
  })
})

describe('the answer to a question that asked for a name', () => {
  it('a first name and surname with nothing else in the message', () => {
    expect(hidden('สมชาย ใจดี', 'รบกวนขอชื่อ-นามสกุลด้วยค่ะ')).toEqual(['สมชาย ใจดี'])
  })

  it('not once the customer has moved on to something longer', () => {
    const long = 'สมชาย ใจดี และอยากสอบถามเรื่องสินค้าที่สั่งไปเมื่อวานว่าส่งแล้วหรือยังคะ ช่วยเช็คให้หน่อยค่ะ'
    expect(hidden(long, 'ขอชื่อด้วยค่ะ')).toEqual([])
  })

  it('not when nothing asked for a name', () => {
    expect(hidden('สมชาย ใจดี', 'ขอเบอร์ติดต่อด้วยค่ะ')).toEqual([])
  })
})

describe('found by measuring public text (Wisesight, ThaiNER)', () => {
  it('an age after เด็กชาย is not a name', () => {
    expect(found('พบผู้เสียชีวิต 2 รายเป็นเด็กหญิง อายุ 3 ขวบ')).toEqual([])
  })

  it('please, after a name, is the next thing said', () => {
    // The second word is not read as a surname, so it is one word against คุณ: reported, under the threshold.
    expect(found('คุณจั้ม โปรดพกบัตรตัวจริง')).toEqual(['คุณจั้ม'])
    expect(found('คุณสมชาย กรุณาโอนเงิน')).toEqual(['คุณสมชาย'])
  })
})

describe('found by a call-centre data set (Kaggle, simulated calls)', () => {
  it('an institution after a name is the next thing said, not a surname', () => {
    expect(hidden('เรียนคุณสมชาย ธนาคารกรุงเทพขอแจ้งว่าบัญชีของท่านมีธุรกรรม')).toEqual(['คุณสมชาย'])
    expect(hidden('เรียนคุณสุนิสา สำนักงานประกันสังคม โทรมาแจ้งสิทธิ')).toEqual(['คุณสุนิสา'])
    expect(hidden('ขอเรียนคุณณัฐพล กระทรวงสาธารณสุขโทรมาแจ้งนัด')).toEqual(['คุณณัฐพล'])
  })

  it('นาย and นาง with a particle are "you" and "she"', () => {
    expect(found('แล้วนายล่ะ?')).toEqual([])
    expect(found('นางเหรอ ไม่เชื่อ')).toEqual([])
  })

  it('คุณ followed by a long run of words is "you", whatever stands before it', () => {
    expect(found('สวัสดีค่ะ คุณมีสิทธิได้รับบ้านฟรีจากโครงการเฉพาะกิจ')).toEqual([])
    expect(found('สวัสดีค่ะ คุณได้รับแจ้งเตือนจากระบบ')).toEqual([])
  })
})

describe('ranks', () => {
  it('written out, and as abbreviations', () => {
    expect(hidden('พลตำรวจโท สมชาย ใจดี สั่งซื้อ')).toEqual(['พลตำรวจโท สมชาย ใจดี'])
    expect(hidden('พ.ต.ท.สุรชัย มั่นคง โทรมา')).toEqual(['พ.ต.ท.สุรชัย มั่นคง'])
    expect(hidden('จ.ส.ต. สมชาย ใจดี')).toEqual(['จ.ส.ต. สมชาย ใจดี'])
    expect(hidden('สิบเอกมานะ อดทน')).toEqual(['สิบเอกมานะ อดทน'])
    expect(hidden('คุณหญิงสมศรี ศรีสุข')).toEqual(['คุณหญิงสมศรี ศรีสุข'])
  })

  it('a woman officer: หญิง is part of the rank, not of the name', () => {
    expect(hidden('ร.ต.อ.หญิง วิภา แก้วใส')).toEqual(['ร.ต.อ.หญิง วิภา แก้วใส'])
  })

  it('not a word that starts like a rank', () => {
    expect(found('พันธุ์ไม้ขายดี')).toEqual([])
  })
})

describe('given names that look like words', () => {
  it('สมบัติ and ธรรม… are names after นาย and นาง, and words after คุณ', () => {
    expect(hidden('นายสมบัติ รุ่งเรือง ครับ')).toEqual(['นายสมบัติ รุ่งเรือง'])
    expect(hidden('นายแพทย์สมบัติ รุ่งเรือง ตรวจแล้ว')).toEqual(['นายแพทย์สมบัติ รุ่งเรือง'])
    expect(found('คุณสมบัติครบ')).toEqual([])
  })

  it('a title with no dot inside: ดช. ดญ.', () => {
    expect(hidden('ดช.สมปอง ใจดี')).toEqual(['ดช.สมปอง ใจดี'])
    expect(hidden('ดญ.พิมพ์ใจ รักดี')).toEqual(['ดญ.พิมพ์ใจ รักดี'])
  })

  it('more labels for who ordered', () => {
    expect(hidden('ชื่อผู้สั่ง: สมหญิง ดีเลิศ')).toEqual(['สมหญิง ดีเลิศ'])
    expect(hidden('ชื่อนามสกุลจริง: อรุณี สว่างวงศ์')).toEqual(['อรุณี สว่างวงศ์'])
    expect(hidden('ชื่อผู้ซื้อ สุรชัย พงษ์สวัสดิ์')).toEqual(['สุรชัย พงษ์สวัสดิ์'])
  })
})

describe('over-hiding that is known and accepted', () => {
  // A Latin title with a capitalised word after it is read as a name. A brand or
  // a phrase that looks the same is hidden too: a word lost, where a name left
  // in costs more. A test here fails if that is ever narrowed.
  for (const message of [
    'Mr. Right is hard to find',
    'Dr. Pepper ขวดละ 20 บาท',
    'Miss Universe 2026',
  ]) {
    it(message, () => {
      expect(hidden(message)).toHaveLength(1)
    })
  }
})

describe('words that begin like a title and are not one', () => {
  it('นายก, นายจ้าง, นายหน้า, นายทุน', () => {
    for (const word of [
      'นายกรัฐมนตรีแถลง',
      'นายกฯ ประกาศ',
      'นายจ้างต้องจ่าย',
      'นายหน้าขายบ้าน',
      'นายทุนใหญ่',
    ]) {
      expect(found(word), word).toEqual([])
    }
  })

  it('นางฟ้า, นางงาม, นางแบบ, นางพยาบาล', () => {
    for (const word of ['นางฟ้าตัวน้อย', 'นางงามจักรวาล', 'นางแบบสาว', 'นางพยาบาลใจดี']) {
      expect(found(word), word).toEqual([])
    }
  })

  it('a name that starts like นายก is still a name', () => {
    expect(hidden('นายกร ใจดี')).toEqual(['นายกร ใจดี'])
  })
})

describe('known limits: a name nothing introduces is not found', () => {
  // These are the things this detector cannot do and says so. The optional NER
  // package is what would read them. A test here fails if the limit is ever
  // lifted, so the README can be updated with it.
  const unseen: ReadonlyArray<readonly [string, string]> = [
    ['a name with no title, cue or question', 'สมชาย ใจดี โทรมาแล้ว'],
    ['a name in the middle of a sentence', 'ได้คุยกับสมชายใจดีเมื่อวานแล้ว'],
    ['a nickname on its own', 'พี่หนุ่มโทรมา'],
    ['a name in Latin with no introduction', 'Somchai Jaidee called yesterday'],
    ['a name in a list', 'สมชาย ใจดี, สุดา รักไทย, มาลี ศรีสุข'],
    ['a monk title', 'พระสมชาย ธัมมโชติ'],
  ]
  for (const [what, message] of unseen) {
    it(what, () => {
      expect(found(message)).toEqual([])
    })
  }
})

describe('long input', () => {
  it('is read in linear time', () => {
    const text = 'นายสมชาย ใจดี คุณ สุดา ชื่อ มาลี '.repeat(4000)
    const started = Date.now()
    detect(text)
    expect(Date.now() - started).toBeLessThan(3000)
  })
})
