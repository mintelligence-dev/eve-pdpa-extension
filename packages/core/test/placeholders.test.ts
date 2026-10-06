import { describe, expect, it } from 'vitest'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import { encodeLetters, tokenId } from '../src/random.js'
import type { PolicyInput, RandomSource } from '../src/types.js'

const LETTERS = /^[bcdfghjkmnpqrstv]+$/

/** Every entity redacted, so any detection on a second pass changes the text. */
const EVERYTHING: PolicyInput['entities'] = {
  TH_NATIONAL_ID: { action: 'tokenise', allowedPurposes: ['test'] },
  PHONE: { action: 'tokenise', allowedPurposes: ['test'] },
  EMAIL: { action: 'redact' },
  BANK_ACCOUNT: { action: 'redact' },
  CREDIT_CARD: { action: 'redact' },
  LINE_USER_ID: { action: 'redact' },
}

/** Feeds the same bytes every time, to reproduce a specific token. */
const fixedBytes =
  (bytes: number[]): RandomSource =>
  (n) =>
    Uint8Array.from({ length: n }, (_, i) => bytes[i % bytes.length] ?? 0)

describe('the alphabet', () => {
  it('spells a token in 16 letters and no digits', () => {
    const id = tokenId((n) => crypto.getRandomValues(new Uint8Array(n)))
    expect(id).toHaveLength(16)
    expect(id).toMatch(LETTERS)
  })

  it('maps every byte to a different pair, so no bits are lost against hex', () => {
    const all = Array.from({ length: 256 }, (_, b) => encodeLetters(Uint8Array.of(b)))
    expect(new Set(all).size).toBe(256)
    expect(all[0x00]).toBe('bb')
    expect(all[0xff]).toBe('vv')
  })
})

describe('a token survives a second pass through the guard — item 6', () => {
  it('even for the bytes that spelled a phone number in hex', () => {
    // As hex these bytes read 0918887777abcdef, which the phone detector found
    // inside the token and redacted, leaving [tok:[เบอร์โทร]abcdef].
    const guard = createGuard({
      policy: definePolicy({ entitySet: '0.1', entities: EVERYTHING }),
      randomSource: fixedBytes([0x09, 0x18, 0x88, 0x77, 0x77, 0xab, 0xcd, 0xef]),
    })

    const once = guard.processSync('เบอร์ 0812345678').text
    expect(once).toMatch(/^เบอร์ \[tok:[bcdfghjkmnpqrstv]{16}\]$/)
    expect(guard.processSync(once).text).toBe(once)
  })

  it('for a few thousand random tokens', () => {
    const guard = createGuard({ policy: definePolicy({ entitySet: '0.1', entities: EVERYTHING }) })
    for (let i = 0; i < 3000; i++) {
      const once = guard.processSync('เบอร์ 0812345678 เลขบัตร 3-1005-00123-45-8').text
      const twice = guard.processSync(once)
      expect(twice.findings).toEqual([])
    }
  })
})

describe('nothing is skipped by shape', () => {
  it('still catches a real number written inside brackets that look like a token', () => {
    // The approach this replaced would have skipped anything shaped like our
    // own output — and let this number through.
    const guard = createGuard({
      policy: definePolicy({ entitySet: '0.1', entities: { PHONE: { action: 'redact' } } }),
    })
    expect(guard.processSync('เบอร์ผม [tok:0918887777abcdef]').text).toBe(
      'เบอร์ผม [tok:[เบอร์โทร]abcdef]',
    )
  })
})
