import { describe, expect, it } from 'vitest'
import { bankAccountDetector } from '../src/detectors/bank-account.js'
import { creditCardDetector } from '../src/detectors/credit-card.js'
import { phoneDetector } from '../src/detectors/phone.js'
import { thaiNationalIdDetector } from '../src/detectors/thai-national-id.js'
import { createEngine } from '../src/engine.js'
import { normalise } from '../src/normalise.js'
import type { Candidate, DetectContext } from '../src/types.js'

const CTX: DetectContext = { sessionId: 'test', boundary: 'inbound' }

function detect(text: string): Candidate[] {
  return bankAccountDetector.detect(normalise(text), CTX) as Candidate[]
}

describe('needs the sentence, not just the digits', () => {
  it('says nothing about a bare run of ten digits', () => {
    // No checksum, no reserved prefix, no length of its own. Claiming this
    // would put a finding on every order confirmation.
    expect(detect('1234567890')).toEqual([])
  })

  it('claims the same run under the word บัญชี', () => {
    expect(detect('เลขบัญชี 1234567890')).toHaveLength(1)
  })

  it('takes a bank name as the cue', () => {
    expect(detect('กสิกร 1234567890')).toHaveLength(1)
    expect(detect('โอนมาที่ scb 123-4-56789-0')).toHaveLength(1)
  })

  it('reads an English cue in any case', () => {
    expect(detect('Account 1234567890')).toHaveLength(1)
  })

  it('does not take กรุงเทพ as a bank name, because it is the city', () => {
    expect(detect('อยู่กรุงเทพ 1234567890')).toEqual([])
  })
})

describe('shape', () => {
  it('accepts ten to twelve digits', () => {
    expect(detect('บัญชี 1234567890')).toHaveLength(1)
    expect(detect('บัญชี 123456789012')).toHaveLength(1)
  })

  it('rejects anything shorter or longer', () => {
    expect(detect('บัญชี 123456789')).toEqual([])
    expect(detect('บัญชี 1234567890123')).toEqual([])
  })

  it('accepts the separators a passbook prints', () => {
    expect(detect('บัญชี 123-4-56789-0')).toHaveLength(1)
  })

  it('rejects a run that is part of a longer one', () => {
    expect(detect('บัญชี 99912345678901234')).toEqual([])
  })
})

// digit-run.ts: one set of separators for every digit detector, 13 Oct.
describe('the separators every digit detector reads', () => {
  const spans = (s: string) => detect(s).map((c) => s.slice(c.start, c.end))

  it('finds the account after a number that is not part of it', () => {
    // One regex of ten to twelve digits took the amount with it, failed, and
    // never tried the account on its own.
    expect(spans('โอนเงิน 750 บาท เข้าบัญชี 9876543210')).toEqual(['9876543210'])
    expect(spans('บัญชี ยอด 750 9876543210')).toEqual(['9876543210'])
    expect(spans('บัญชี 987 6543210987')).toEqual(['6543210987'])
  })

  it('reads an en dash or a minus sign as it reads a hyphen', () => {
    expect(spans('บัญชี 987–6–54321–0')).toEqual(['987–6–54321–0'])
    expect(spans('บัญชี 987−6−54321−0')).toEqual(['987−6−54321−0'])
  })

  it('reads an account pasted across two lines in the grouping a passbook prints', () => {
    expect(spans('เลขบัญชี 987-6\n54321-0')).toEqual(['987-6\n54321-0'])
  })

  it('does not join amounts listed a line each into an account', () => {
    expect(detect('โอนเข้าบัญชี\n650\n1450\n2200')).toEqual([])
  })

  it('reads dots only in the grouping a passbook prints', () => {
    expect(spans('บัญชี 987.6.54321.0')).toEqual(['987.6.54321.0'])
    expect(detect('บัญชี 98.76.543210')).toEqual([])
  })

  it('leaves a dotted date and time under a transfer cue alone', () => {
    expect(detect('โอนเงินแล้วค่ะ 21.09.68 16.45')).toEqual([])
    expect(detect('โอนเงินวันที่ 21.09.2568 16.45 น.')).toEqual([])
  })
})

describe('against the phone detector', () => {
  it('wins a mobile-shaped run when the sentence says account', () => {
    const engine = createEngine([phoneDetector, bankAccountDetector])
    const merged = engine.runSync(normalise('เลขบัญชี 0812345678'), CTX).candidates

    expect(merged).toHaveLength(1)
    expect(merged[0]?.entity).toBe('BANK_ACCOUNT')
  })

  it('loses the same run when the sentence says phone', () => {
    const engine = createEngine([phoneDetector, bankAccountDetector])
    const merged = engine.runSync(normalise('เบอร์ 0812345678'), CTX).candidates

    expect(merged).toHaveLength(1)
    expect(merged[0]?.entity).toBe('PHONE')
  })
})

// Decided 13 Oct (code review): a run too long only because more of its groups
// follow is covered whole, not cut at twelve digits.
describe('a run longer than an account', () => {
  const spans = (s: string) => detect(s).map((c) => s.slice(c.start, c.end))

  it('covers every group joined the way the account is', () => {
    expect(spans('บัญชี 9876 5432 1098 7654')).toEqual(['9876 5432 1098 7654'])
    expect(spans('โอนเข้าบัญชี 111-2-33333-4-5566')).toEqual(['111-2-33333-4-5566'])
  })

  it('does not take a number after an account written as one group', () => {
    expect(spans('บัญชี 9876543210 300 บาท')).toEqual(['9876543210'])
  })

  it('stops at a separator the account is not written with', () => {
    expect(spans('บัญชี 9876 5432 1098. 7654')).toEqual(['9876 5432 1098'])
    expect(spans('บัญชี 9876 5432 1098\n7654')).toEqual(['9876 5432 1098'])
    expect(spans('บัญชี 987-6-54321-0 150 รายการ')).toEqual(['987-6-54321-0'])
  })

  it('stops before a group a bare dash glues to the next value', () => {
    // Taking the 3 would cut the id in two, and the longer span would then
    // win the merge with the rest of the id outside it.
    const engine = createEngine([thaiNationalIdDetector, bankAccountDetector])
    const text = 'บัญชี 9876 5432 1098 3-1005-00123-40-7'
    const found = engine.runSync(normalise(text), CTX).candidates
    expect(found.map((c) => [c.entity, text.slice(c.start, c.end)])).toEqual([
      ['BANK_ACCOUNT', '9876 5432 1098'],
      ['TH_NATIONAL_ID', '3-1005-00123-40-7'],
    ])
  })

  it('leaves a card under an account cue to the card detector', () => {
    const engine = createEngine([creditCardDetector, bankAccountDetector])
    const found = (s: string) =>
      engine.runSync(normalise(s), CTX).candidates.map((c) => [c.entity, s.slice(c.start, c.end)])

    expect(found('บัญชี 4012 8888 8888 1881')).toEqual([['CREDIT_CARD', '4012 8888 8888 1881']])
    expect(found('ตัดบัญชี 1234 4012 8888 8888 1881')).toEqual([
      ['CREDIT_CARD', '4012 8888 8888 1881'],
    ])
    expect(found('บัญชี 9876 5432 1098 4012 8888 8888 1881')).toEqual([
      ['BANK_ACCOUNT', '9876 5432 1098'],
      ['CREDIT_CARD', '4012 8888 8888 1881'],
    ])
  })

  it('reads a long run of single digits under a cue in linear time', () => {
    // Big enough that a return to quadratic takes seconds, and a limit far
    // enough from linear that coverage or a slow CI runner never reaches it —
    // the rule many-values.test.ts set. 200 ms on 10 KB failed under coverage.
    // Quadratic here (a list check that read back to the start of the line)
    // took 3.8 s on 100 KB.
    let text = 'บัญชี '
    for (let i = 0; text.length < 100 * 1024; i++) text += `${i % 10} `
    const started = performance.now()
    detect(text)
    expect(performance.now() - started).toBeLessThan(2000)
  })
})

// User benchmark, 14 Oct (D20).
describe('cue words', () => {
  it('reads acc and a/c as account, as whole words only', () => {
    expect(detect('plz send to my acc 9876543210 krub')).toHaveLength(1)
    expect(detect('acc. 9876543210')).toHaveLength(1)
    expect(detect('a/c 987-6-54321-0')).toHaveLength(1)
    expect(detect('accept 9876543210')).toEqual([])
    expect(detect('access 9876543210')).toEqual([])
  })

  it('reads a refund paid by transfer', () => {
    expect(detect('โอนคืนให้ที่ 9876543210')).toHaveLength(1)
    expect(detect('จะโอนคืนเข้า 987-6-54321-0 นะคะ')).toHaveLength(1)
  })

  it('reads a bank named in English', () => {
    expect(detect('bangkok bank 9876543210')).toHaveLength(1)
    expect(detect('krungthai 9876543210')).toHaveLength(1)
    expect(detect('banking app 9876543210')).toEqual([])
  })

  it('reads the English cue in the question too', () => {
    const asked = { ...CTX, previous: 'pls send your acc no.' }
    expect(bankAccountDetector.detect(normalise('9876543210'), asked)).toHaveLength(1)
  })

  it('names the run an account when the phone reading of it is grouped like a passbook', () => {
    const engine = createEngine([phoneDetector, bankAccountDetector])
    const merged = engine.runSync(normalise('โอนคืนเข้า 089-7-65432-1'), CTX).candidates
    expect(merged.map((c) => c.entity)).toEqual(['BANK_ACCOUNT'])
  })
})

// User benchmark, 14 Oct (D20): a list pasted under one heading.
describe('a list, one account a line', () => {
  const spans = (s: string) => detect(s).map((c) => s.slice(c.start, c.end))

  it('reads each line as the line above was read, past the cue window', () => {
    expect(spans('เลขบัญชีของแต่ละสาขาค่ะ\n9876543210\n8765432109\n7654321098')).toEqual([
      '9876543210',
      '8765432109',
      '7654321098',
    ])
  })

  it('ends the list at a blank line', () => {
    expect(spans('เลขบัญชีของแต่ละสาขาค่ะ\n9876543210\n8765432109\n\n7654321098')).toEqual([
      '9876543210',
      '8765432109',
    ])
  })
})

describe('a key that names a time', () => {
  it('is not an account, even under a transfer cue', () => {
    expect(detect('{"transfer_time":1760000000}')).toEqual([])
    expect(detect('transfer updatedAt=1760000000')).toEqual([])
  })
})

// User question, 14 Oct (D20): the abbreviation written other ways than บช.
describe('the abbreviation บช', () => {
  it('reads บช standing on its own, after เลข with a space too', () => {
    expect(detect('บช 9876543210')).toHaveLength(1)
    expect(detect('ขอเลข บช 987-6-54321-0 ค่ะ')).toHaveLength(1)
    expect(detect('เข้าบช 9876543210')).toHaveLength(1)
  })

  it('reads it with a slash or a dot between the letters', () => {
    expect(detect('บ/ช 9876543210')).toHaveLength(1)
    expect(detect('เลขที่ บ/ช 9876543210')).toHaveLength(1)
    expect(detect('บ.ช. 987-6-54321-0')).toHaveLength(1)
  })

  it('does not read บช inside a word, where บ ends one syllable and ช starts the next', () => {
    expect(detect('ได้ของครบชุดแล้ว 9876543210')).toEqual([])
    expect(detect('ขออภัยตอบช้า 9876543210')).toEqual([])
    expect(detect('รับชำระ 9876543210')).toEqual([])
    expect(detect('ระงับชั่วคราว 9876543210')).toEqual([])
  })

  it('takes the question that asked with บช as the cue', () => {
    const asked = { ...CTX, previous: 'รบกวนขอ บช ที่จะให้โอนคืนค่ะ' }
    expect(bankAccountDetector.detect(normalise('9876543210'), asked)).toHaveLength(1)
  })

  it('names a mobile-shaped run under บ/ช an account, as the phone detector reads it too', () => {
    const engine = createEngine([phoneDetector, bankAccountDetector])
    const merged = engine.runSync(normalise('บ/ช 0897654321'), CTX).candidates
    expect(merged.map((c) => c.entity)).toEqual(['BANK_ACCOUNT'])
  })
})

// User benchmark, 14 Oct (D20 item 25): an order number nearer than the
// account cue was claimed as an account.
describe('an account cue against a nearer reference cue', () => {
  it('leaves a run named an order alone when the account cue is a clause further back', () => {
    expect(detect('โอนเข้าบัญชีแล้วนะคะ ส่วนออเดอร์ 2604150077')).toEqual([])
    expect(detect('transfer done, ref: 2604150077')).toEqual([])
  })

  it('leaves a run named an order alone when the account cue was only in the question', () => {
    const asked = { ...CTX, previous: 'แจ้งเลขบัญชีที่จะให้คืนเงินค่ะ' }
    expect(bankAccountDetector.detect(normalise('ยกเลิกออเดอร์ 2604150077'), asked)).toEqual([])
    expect(bankAccountDetector.detect(normalise('เลขพัสดุ 2604150077'), asked)).toEqual([])
  })

  it('keeps an account whose own cue is the nearer one', () => {
    expect(detect('บัญชี 9876543210 ออเดอร์ 31')).toHaveLength(1)
    expect(detect('ออเดอร์ 31 คืนเงินเข้าบัญชี 9876543210')).toHaveLength(1)
    expect(detect('ออเดอร์ที่ยกเลิก โอนคืน 9876543210')).toHaveLength(1)
  })

  it('does not let a reference word that labels the next number take this one', () => {
    const asked = { ...CTX, previous: 'ขอเลขบัญชีค่ะ' }
    expect(bankAccountDetector.detect(normalise('9876543210 order #31'), asked)).toHaveLength(1)
  })

  it('keeps the account when both cues are as near', () => {
    expect(detect('order 9876543210 account')).toHaveLength(1)
  })
})
