import { describe, expect, it } from 'vitest'
import { canonicalValue } from '../src/actions/canonical.js'
import { normalise } from '../src/normalise.js'

/** Reads the value the way the guard will: from the normalised text. */
const canon = (written: string) => canonicalValue('PASSPORT', normalise(written).text)

describe('a passport number collapses to one form', () => {
  it('upper case, separators out', () => {
    for (const f of ['AB1234567', 'ab 1234567', 'AB-1234567']) {
      expect(canon(f)).toBe('AB1234567')
    }
  })
})
