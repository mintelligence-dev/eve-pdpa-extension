import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sha256 } from '../src/crypto/sha256.js'

// node:crypto is barred from src/ by the no-node-builtins gate, not from tests.
// Here it is the independent reference the hand-written code is held against.

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const utf8 = (s: string) => new TextEncoder().encode(s)
const reference = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

describe('NIST FIPS 180-4 example vectors', () => {
  it('empty input', () => {
    expect(hex(sha256(utf8('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('"abc" — one block', () => {
    expect(hex(sha256(utf8('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('448 bits — padding forces a second block', () => {
    expect(hex(sha256(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it('896 bits', () => {
    const msg =
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmno' +
      'ijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'
    expect(hex(sha256(utf8(msg)))).toBe(
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
    )
  })

  it('one million "a" — many blocks', () => {
    expect(hex(sha256(new Uint8Array(1_000_000).fill(0x61)))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    )
  })
})

describe('padding boundaries', () => {
  // 55 bytes is the longest message that fits one block with its padding;
  // 56 needs a second block. 63, 64 and 65 straddle the block size itself.
  for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129]) {
    it(`${n} bytes`, () => {
      const data = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 0xff)
      expect(hex(sha256(data))).toBe(reference(data))
    })
  }
})

describe('against node:crypto', () => {
  it('agrees on a thousand random inputs of random length', () => {
    for (let i = 0; i < 1000; i++) {
      const data = new Uint8Array(randomBytes(Math.floor(Math.random() * 300)))
      expect(hex(sha256(data))).toBe(reference(data))
    }
  })

  it('agrees on Thai text, which is three bytes per character in UTF-8', () => {
    const data = utf8('เลขบัตร ๓-๑๐๐๕-๐๐๑๒๓-๔๕-๘ ค่ะ')
    expect(hex(sha256(data))).toBe(reference(data))
  })
})

describe('shape', () => {
  it('always returns 32 bytes', () => {
    expect(sha256(new Uint8Array(0))).toHaveLength(32)
    expect(sha256(new Uint8Array(1000))).toHaveLength(32)
  })

  it('does not modify its input', () => {
    const data = utf8('abc')
    const copy = Uint8Array.from(data)
    sha256(data)
    expect(data).toEqual(copy)
  })

  it('reads only the view it is given, not the whole underlying buffer', () => {
    const backing = utf8('xxabcxx')
    expect(hex(sha256(backing.subarray(2, 5)))).toBe(hex(sha256(utf8('abc'))))
  })
})
