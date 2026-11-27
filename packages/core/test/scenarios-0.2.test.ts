import { describe, expect, it } from 'vitest'
import { crc16 } from '../src/detectors/promptpay.js'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'

/**
 * Whole chat messages through the guard, with every 0.2 detector and the 0.1
 * ones switched on, and what leaves written down. Every value is made up.
 *
 * Two lists, and the second matters as much as the first: what is hidden, and
 * what is *not*, so a reader of the README knows where the guard stops. A test in
 * the second list fails the day the limit is lifted, which is the cue to move it.
 */

const guard = createGuard({
  policy: definePolicy({
    entitySet: '0.2',
    onUnmapped: 'redact',
    placeholderLanguage: 'th',
    entities: {},
  }),
  hmacKey: 'a3f1c9e07b2d4f6a8c1e3b5d7f9a0c2e4b6d8f1a3c5e7b9d0f2a4c6e8b1d3f5a',
})

const out = (text: string, previous?: string): string =>
  guard.processSync(text, {
    sessionId: 'scenario',
    ...(previous === undefined ? {} : { context: previous }),
  }).text

/** A PromptPay QR payload with a right CRC. */
function qr(proxy: string): string {
  const account = `0016A00000067701011101${String(proxy.length).padStart(2, '0')}${proxy}`
  const body = `00020101021129${String(account.length).padStart(2, '0')}${account}53037645802TH6304`
  return body + crc16(body).toString(16).toUpperCase().padStart(4, '0')
}

describe('hidden', () => {
  const hiddenCases: ReadonlyArray<readonly [string, string, string]> = [
    [
      'the example from the spec: a name, an id and a phone',
      'สวัสดีค่ะ ดิฉันนางสาวสุดา รักไทย เลขบัตรประชาชน 3-1005-00123-45-8 ขอเปลี่ยนเบอร์เป็น ๐๙๑-๘๘๘-๗๗๗๗ ค่ะ',
      'สวัสดีค่ะ ดิฉัน[ชื่อ] เลขบัตรประชาชน [เลขบัตรประชาชน] ขอเปลี่ยนเบอร์เป็น [เบอร์โทร] ค่ะ',
    ],
    [
      'a delivery address in a sentence',
      'ส่งของมาที่ 99/9 หมู่ 5 ซอยสุขุมวิท 101 ต.บางจาก อ.พระโขนง จ.กรุงเทพมหานคร 10260 นะคะ',
      'ส่งของมาที่ [ที่อยู่] นะคะ',
    ],
    [
      'a name and an address together in a form',
      'ชื่อ-นามสกุล: สมชาย ใจดี\nที่อยู่ 12/3 ซอยร่วมใจ ต.ท่าศาลา อ.เมือง จ.ลำพูน 51000',
      'ชื่อ-นามสกุล: [ชื่อ]\nที่อยู่ [ที่อยู่]',
    ],
    [
      'a PromptPay phone number',
      'โอนมาที่พร้อมเพย์ 081-888-7777 ได้เลยค่ะ',
      // Named as a phone: the older entity keeps a shared span, and it is hidden all the same.
      'โอนมาที่พร้อมเพย์ [เบอร์โทร] ได้เลยค่ะ',
    ],
    [
      'a PromptPay QR payload pasted whole',
      `สแกนอันนี้ค่ะ ${qr('0066818887777')}`,
      'สแกนอันนี้ค่ะ [พร้อมเพย์]',
    ],
    ['an e-wallet id', 'e-wallet 004999012345678 ค่ะ', 'e-wallet [พร้อมเพย์] ค่ะ'],
    [
      'a romanised address',
      'Ship to 99/9 Soi Sukhumvit 101, Bangkok 10260 please',
      'Ship to [ที่อยู่] please',
    ],
    [
      'an id with a typo, beside the PromptPay word',
      'พร้อมเพย์ 3-1005-00123-45-1',
      'พร้อมเพย์ [พร้อมเพย์]',
    ],
    ['a name typed with doubled spaces', 'ชื่อ-นามสกุล:  กานดา  เรืองสุข ค่ะ', 'ชื่อ-นามสกุล:  [ชื่อ] ค่ะ'],
    ['a PromptPay number pasted with tabs', 'พร้อมเพย์\t081\t433\t1673', 'พร้อมเพย์\t[พร้อมเพย์]'],
    [
      'an English address in capitals',
      'SHIP TO 153 SUKHUMVIT ROAD SAMUT PRAKAN 11696',
      'SHIP TO [ที่อยู่]',
    ],
    ['a name given as the answer to the bot', 'สมชาย ใจดี', '[ชื่อ]'],
  ]
  for (const [what, message, expected] of hiddenCases) {
    it(what, () => {
      // The answer-to-a-question case needs the question as context.
      const previous = what.includes('answer to the bot') ? 'ขอชื่อ-นามสกุลด้วยค่ะ' : undefined
      expect(out(message, previous)).toBe(expected)
    })
  }
})

describe('not hidden: where the guard stops', () => {
  // [why, message]. Each message passes through unchanged.
  const limits: ReadonlyArray<readonly [string, string]> = [
    ['a name nothing introduces', 'สมชาย ใจดี โทรมาแล้ว'],
    ['a name in the middle of a sentence', 'ได้คุยกับสมชายใจดีเมื่อวานแล้ว'],
    ['a place with no labels: a district and a province only, said in passing', 'อยู่บางนา กรุงเทพ'],
    ['a province or a district on its own', 'บ้านอยู่เชียงใหม่ค่ะ'],
    ['a name that is a product', 'ชื่อสินค้า เสื้อยืดสีขาว'],
    ['an ordinary word that starts like a title', 'นายหน้าขายบ้านมาโทรหา'],
    [
      'an id-shaped number whose check digit is wrong (the one printed on the Notion spec page)',
      'เลขบัตรประชาชน 3-1005-00123-45-1',
    ],
    ['a five-digit order number', 'ออเดอร์ 12345 ส่งแล้วค่ะ'],
  ]
  for (const [why, message] of limits) {
    it(why, () => {
      expect(out(message)).toBe(message)
    })
  }
})

describe('reported, but under the default threshold', () => {
  // Found and written to the audit log, not hidden, until a policy lowers
  // `minConfidence` for the entity.
  it('two address parts and nothing that says it is an address', () => {
    const message = 'อ.เมือง จ.เชียงใหม่'
    expect(out(message)).toBe(message)
  })

  it('คุณ glued to one word, which is also "you" in คุณส่งสติกเกอร์', () => {
    const message = 'ขอบคุณค่ะคุณสมชาย'
    expect(out(message)).toBe(message)
  })

  it('a name with one word after a bare label', () => {
    const message = 'ชื่อ สมชาย'
    expect(out(message)).toBe(message)
  })
})
