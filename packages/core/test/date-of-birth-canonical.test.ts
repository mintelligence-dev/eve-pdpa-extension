import { describe, expect, it } from 'vitest'
import { canonicalValue } from '../src/actions/canonical.js'
import { normalise } from '../src/normalise.js'

/** Reads the value the way the guard will: from the normalised text. */
const canon = (written: string) => canonicalValue('DATE_OF_BIRTH', normalise(written).text)

describe('a date of birth collapses to one form', () => {
  it('every format and era to one ISO Gregorian date', () => {
    for (const f of ['12/05/2530', '12 พ.ค. 2530', '๑๒/๐๕/๒๕๓๐', '1987-05-12', '12 May 1987']) {
      expect(canon(f)).toBe('1987-05-12')
    }
    expect(canon('13/05/2530')).not.toBe(canon('12/05/2530'))
  })
})
