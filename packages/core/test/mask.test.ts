import { describe, expect, it } from 'vitest'
import { maskValue } from '../src/actions/mask.js'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'

describe('without keep — D8.1', () => {
  it('hides every character of the value', () => {
    expect(maskValue('0918887777', undefined)).toBe('xxxxxxxxxx')
  })

  it('reveals nothing a policy did not ask for, not even the last four', () => {
    const out = maskValue('4111111111111111', undefined)
    expect(out).not.toContain('1111')
    expect(out).toBe('x'.repeat(16))
  })
})

describe('keep: last4', () => {
  it('keeps the last four characters', () => {
    expect(maskValue('0918887777', 'last4')).toBe('xxxxxx7777')
  })

  it('counts four value characters, not four characters of the span', () => {
    // The span ends in a separator-free group here, but the rule must hold when
    // a separator sits inside the last four positions too.
    expect(maskValue('091-888-77-77', 'last4')).toBe('xxx-xxx-77-77')
  })

  it('masks everything when four would be the whole value', () => {
    expect(maskValue('1234', 'last4')).toBe('xxxx')
    expect(maskValue('12', 'last4')).toBe('xx')
  })
})

describe('separators', () => {
  it('keeps spaces and hyphens where they were', () => {
    expect(maskValue('4111 1111 1111 1111', undefined)).toBe('xxxx xxxx xxxx xxxx')
    expect(maskValue('4111 1111 1111 1111', 'last4')).toBe('xxxx xxxx xxxx 1111')
    expect(maskValue('091-888-7777', 'last4')).toBe('xxx-xxx-7777')
  })

  it('keeps the separator the customer actually typed', () => {
    // No-break space, full-width hyphen, zero-width space: normalise folded or
    // removed these for detection, but the mask works on the original.
    expect(maskValue('091 888 7777', undefined)).toBe('xxx xxx xxxx')
    expect(maskValue('091－888', undefined)).toBe('xxx－xxx')
    expect(maskValue('091​8887777', 'last4')).toBe('xxx​xxx7777')
  })

  it('does not treat @ or . as separators', () => {
    expect(maskValue('a@b.co', undefined)).toBe('xxxxxx')
  })
})

describe('scripts', () => {
  it('keeps Thai numerals as Thai numerals', () => {
    expect(maskValue('๐๙๑๘๘๘๗๗๗๗', 'last4')).toBe('xxxxxx๗๗๗๗')
  })

  it('masks a character outside the BMP once, not once per surrogate half', () => {
    expect(maskValue('a😀b', undefined)).toBe('xxx')
  })
})

describe('through the guard', () => {
  const guardFor = (keep?: 'last4') =>
    createGuard({
      policy: definePolicy({
        entitySet: '0.1',
        entities: { PHONE: keep ? { action: 'mask', keep } : { action: 'mask' } },
      }),
    })

  it('reads keep from the policy', () => {
    expect(guardFor().processSync('เบอร์ 091-888-7777').text).toBe('เบอร์ xxx-xxx-xxxx')
    expect(guardFor('last4').processSync('เบอร์ 091-888-7777').text).toBe('เบอร์ xxx-xxx-7777')
  })

  it('masks the original, so a Thai-numeral number keeps its script', () => {
    expect(guardFor('last4').processSync('เบอร์ ๐๙๑-๘๘๘-๗๗๗๗').text).toBe('เบอร์ xxx-xxx-๗๗๗๗')
  })

  it('records the action in the finding', () => {
    const r = guardFor().processSync('เบอร์ 0918887777')
    expect(r.findings).toEqual([expect.objectContaining({ entity: 'PHONE', action: 'mask' })])
  })
})
