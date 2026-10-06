/**
 * SHA-256, FIPS 180-4, written out because nothing else fits.
 *
 * `node:crypto` is barred from core (it does not exist on workerd or in the
 * browser), a library would be core's first dependency, and `crypto.subtle` is
 * async-only so `processSync` could never call it. The algorithm is a standard,
 * not an invention: correctness is proved against NIST vectors and against the
 * host's own implementation, not argued. See `test/sha256.test.ts`.
 *
 * Not constant-time — no JavaScript is. That matters when a secret is compared
 * against attacker input; this library only ever produces digests and never
 * verifies one.
 */

/** First 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** First 32 bits of the fractional parts of the square roots of the first 8 primes. */
const H0 = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const

export const SHA256_BLOCK_BYTES = 64
export const SHA256_DIGEST_BYTES = 32

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n))
}

export function sha256(data: Uint8Array): Uint8Array {
  const length = data.length

  // Padding: one 0x80 byte, zeros, then the message length in BITS as a 64-bit
  // big-endian integer, so the total is a whole number of 64-byte blocks. A
  // message of 55 bytes fits in one block; 56 needs two. That boundary is where
  // hand-written implementations most often go wrong, and the tests sit on it.
  const total = Math.ceil((length + 9) / SHA256_BLOCK_BYTES) * SHA256_BLOCK_BYTES
  const padded = new Uint8Array(total)
  padded.set(data)
  padded[length] = 0x80

  const view = new DataView(padded.buffer)
  // length * 8 can exceed 2^32, so split it rather than shift it.
  view.setUint32(total - 8, Math.floor(length / 0x20000000))
  view.setUint32(total - 4, (length * 8) >>> 0)

  const w = new Uint32Array(64)
  let h0: number = H0[0]
  let h1: number = H0[1]
  let h2: number = H0[2]
  let h3: number = H0[3]
  let h4: number = H0[4]
  let h5: number = H0[5]
  let h6: number = H0[6]
  let h7: number = H0[7]

  for (let offset = 0; offset < total; offset += SHA256_BLOCK_BYTES) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)

    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] as number
      const w2 = w[i - 2] as number
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10)
      // A Uint32Array store wraps to 32 bits on its own.
      w[i] = (w[i - 16] as number) + s0 + (w[i - 7] as number) + s1
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    let f = h5
    let g = h6
    let h = h7

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + (K[i] as number) + (w[i] as number)) | 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0

      h = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }

    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0
    h5 = (h5 + f) | 0
    h6 = (h6 + g) | 0
    h7 = (h7 + h) | 0
  }

  const out = new Uint8Array(SHA256_DIGEST_BYTES)
  const outView = new DataView(out.buffer)
  const words = [h0, h1, h2, h3, h4, h5, h6, h7]
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, (words[i] as number) >>> 0)
  return out
}
