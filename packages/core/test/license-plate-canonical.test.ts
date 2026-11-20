import { describe, expect, it } from 'vitest'
import { canonicalValue } from '../src/actions/canonical.js'
import { normalise } from '../src/normalise.js'

/** Reads the value the way the guard will: from the normalised text. */
const canon = (written: string) => canonicalValue('LICENSE_PLATE', normalise(written).text)

describe('a license plate collapses to one form', () => {
  it('separators and Thai numerals out, letters kept', () => {
    for (const f of ['กข1234', 'กข 1234', 'กข-1234', 'กข ๑๒๓๔', 'กข​1234']) {
      expect(canon(f)).toBe('กข1234')
    }
    expect(canon('1กข 2345')).toBe('1กข2345')
    // The letters are half the value: two plates sharing digits are two plates.
    expect(canon('กข 1234')).not.toBe(canon('กค 1234'))
  })
})
