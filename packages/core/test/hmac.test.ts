import { createHmac as nodeHmac, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createHmac } from '../src/crypto/hmac.js'

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const utf8 = (s: string) => new TextEncoder().encode(s)
const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill)
const reference = (k: Uint8Array, m: Uint8Array) => nodeHmac('sha256', k).update(m).digest('hex')

describe('RFC 4231 test cases', () => {
  it('1 — short key', () => {
    const mac = createHmac(bytes(20, 0x0b))(utf8('Hi There'))
    expect(hex(mac)).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7')
  })

  it('2 — key shorter than the digest', () => {
    const mac = createHmac(utf8('Jefe'))(utf8('what do ya want for nothing?'))
    expect(hex(mac)).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
  })

  it('3 — combined length of key and data larger than one block', () => {
    const mac = createHmac(bytes(20, 0xaa))(bytes(50, 0xdd))
    expect(hex(mac)).toBe('773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe')
  })

  it('4 — combined length larger, different key', () => {
    const key = Uint8Array.from({ length: 25 }, (_, i) => i + 1)
    const mac = createHmac(key)(bytes(50, 0xcd))
    expect(hex(mac)).toBe('82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b')
  })

  it('5 — truncated to 128 bits', () => {
    const mac = createHmac(bytes(20, 0x0c))(utf8('Test With Truncation'))
    expect(hex(mac.subarray(0, 16))).toBe('a3b6167473100ee06e0c796c2955552b')
  })

  it('6 — key larger than one block, so it is hashed first', () => {
    const mac = createHmac(bytes(131, 0xaa))(
      utf8('Test Using Larger Than Block-Size Key - Hash Key First'),
    )
    expect(hex(mac)).toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54')
  })

  it('7 — key and data both larger than one block', () => {
    const mac = createHmac(bytes(131, 0xaa))(
      utf8(
        'This is a test using a larger than block-size key and a larger than block-size data. ' +
          'The key needs to be hashed before being used by the HMAC algorithm.',
      ),
    )
    expect(hex(mac)).toBe('9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2')
  })
})

describe('against node:crypto', () => {
  it('agrees on random keys of every size class and random messages', () => {
    // Key lengths below, at and above one block, since each takes a different path.
    for (const keyLength of [1, 16, 32, 63, 64, 65, 200]) {
      for (let i = 0; i < 100; i++) {
        const key = new Uint8Array(randomBytes(keyLength))
        const msg = new Uint8Array(randomBytes(Math.floor(Math.random() * 200)))
        expect(hex(createHmac(key)(msg))).toBe(reference(key, msg))
      }
    }
  })
})

describe('the key', () => {
  it('is copied, so changing the caller’s array afterwards changes nothing', () => {
    const key = bytes(32, 0x42)
    const mac = createHmac(key)
    const before = hex(mac(utf8('x')))
    key.fill(0)
    expect(hex(mac(utf8('x')))).toBe(before)
  })

  it('decides the output — a different key gives a different MAC', () => {
    const msg = utf8('PHONE\u00000918887777')
    expect(hex(createHmac(bytes(32, 1))(msg))).not.toBe(hex(createHmac(bytes(32, 2))(msg)))
  })
})
