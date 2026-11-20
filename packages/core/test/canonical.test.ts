import { describe, expect, it } from 'vitest'
import { canonicalValue } from '../src/actions/canonical.js'
import { normalise } from '../src/normalise.js'
import type { EntityType } from '../src/types.js'

/** Reads the value the way the guard will: from the normalised text. */
const canon = (entity: EntityType, written: string) =>
  canonicalValue(entity, normalise(written).text)

describe('every way of writing a value collapses to one form', () => {
  it('phone: separators, Thai numerals, full-width digits and +66', () => {
    const forms = [
      '0918887777',
      '091-888-7777',
      '091 888 7777',
      '๐๙๑-๘๘๘-๗๗๗๗',
      '０９１８８８７７７７',
      '+66918887777',
      '+66 91 888 7777',
      '091 888 7777',
      '091​8887777',
      // D17: the shapes the detector reads since 13 Oct.
      '091.888.7777',
      '091–888–7777',
      '091 - 888 - 7777',
      '918887777',
      '66918887777',
    ]
    for (const f of forms) expect(canon('PHONE', f)).toBe('0918887777')
    expect(canon('PHONE', '(02) 123-4567')).toBe('021234567')
    expect(canon('PHONE', '(+662) 123 4567')).toBe('021234567')
    expect(canon('PHONE', 'O91-888-7777')).toBe('0918887777')
  })

  it('national id: dashes and Thai numerals', () => {
    expect(canon('TH_NATIONAL_ID', '3-1005-00123-45-8')).toBe('3100500123458')
    expect(canon('TH_NATIONAL_ID', '๓-๑๐๐๕-๐๐๑๒๓-๔๕-๘')).toBe('3100500123458')
  })

  it('id, card and account: every separator the detectors read, dots and line breaks too', () => {
    expect(canon('TH_NATIONAL_ID', '3.1005.00123.45.8')).toBe('3100500123458')
    expect(canon('TH_NATIONAL_ID', '3–1005–00123–45–8')).toBe('3100500123458')
    expect(canon('CREDIT_CARD', '4111.1111.1111.1111')).toBe('4111111111111111')
    expect(canon('CREDIT_CARD', '4111 1111\n1111 1111')).toBe('4111111111111111')
    expect(canon('BANK_ACCOUNT', '123.4.56789.0')).toBe('1234567890')
  })

  it('card: the grouping people type', () => {
    expect(canon('CREDIT_CARD', '4111 1111 1111 1111')).toBe('4111111111111111')
    expect(canon('CREDIT_CARD', '4111-1111-1111-1111')).toBe('4111111111111111')
  })

  it('bank account: the separators a passbook prints', () => {
    expect(canon('BANK_ACCOUNT', '123-4-56789-0')).toBe('1234567890')
  })

  it('email: case, including full-width input', () => {
    expect(canon('EMAIL', 'Somchai@Example.COM')).toBe('somchai@example.com')
    expect(canon('EMAIL', 'ＳＯＭＣＨＡＩ＠ｅｘａｍｐｌｅ．ｃｏｍ')).toBe('somchai@example.com')
  })
})

describe('what it must not merge', () => {
  it('keeps the hyphen in an email domain, which names a different domain without it', () => {
    expect(canon('EMAIL', 'a@my-shop.example')).toBe('a@my-shop.example')
    expect(canon('EMAIL', 'a@my-shop.example')).not.toBe(canon('EMAIL', 'a@myshop.example'))
  })

  it('leaves a LINE id alone, since its case is part of the id', () => {
    const id = `U${'0123456789abcdef'.repeat(2)}`
    expect(canon('LINE_USER_ID', id)).toBe(id)
  })

  it('keeps two different numbers different', () => {
    expect(canon('PHONE', '091-888-7777')).not.toBe(canon('PHONE', '091-888-7778'))
  })
})
