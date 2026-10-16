import { describe, expect, it } from 'vitest'
import { PdpaHttpError } from '../src/errors.js'
import {
  createSigner,
  SIGNATURE_HEADER,
  signRequest,
  TIMESTAMP_HEADER,
  verifyRequest,
} from '../src/signature.js'
import { RESOLVE_SECRET, SECRET } from './helpers.js'

const BODY = '{"sessionId":"conv_8f2a","text":"สวัสดีค่ะ"}'

describe('signRequest and verifyRequest', () => {
  it('a body signed with the secret checks', async () => {
    const headers = new Headers(await signRequest(SECRET, BODY))
    expect(headers.get(TIMESTAMP_HEADER)).toMatch(/^\d+$/)
    expect(headers.get(SIGNATURE_HEADER)).toMatch(/^v1=[0-9a-f]{64}$/)
    expect(await verifyRequest(SECRET, headers, BODY)).toBe(true)
  })

  it('another secret does not', async () => {
    const headers = new Headers(await signRequest(RESOLVE_SECRET, BODY))
    expect(await verifyRequest(SECRET, headers, BODY)).toBe(false)
  })

  it('a changed body does not, even by one character', async () => {
    const headers = new Headers(await signRequest(SECRET, BODY))
    expect(await verifyRequest(SECRET, headers, BODY.replace('ค่ะ', 'คะ'))).toBe(false)
  })

  it('a changed timestamp does not: the timestamp is signed with the body', async () => {
    const now = Date.now()
    const headers = new Headers(await signRequest(SECRET, BODY, now))
    headers.set(TIMESTAMP_HEADER, String(Math.floor(now / 1000) + 1))
    expect(await verifyRequest(SECRET, headers, BODY, { now })).toBe(false)
  })

  it('a request older or newer than the tolerance does not', async () => {
    const now = Date.now()
    const headers = new Headers(await signRequest(SECRET, BODY, now))
    expect(await verifyRequest(SECRET, headers, BODY, { now: now + 299_000 })).toBe(true)
    expect(await verifyRequest(SECRET, headers, BODY, { now: now + 301_000 })).toBe(false)
    expect(await verifyRequest(SECRET, headers, BODY, { now: now - 301_000 })).toBe(false)
    expect(
      await verifyRequest(SECRET, headers, BODY, { now: now + 301_000, toleranceSec: 600 }),
    ).toBe(true)
  })

  it('missing or malformed headers do not', async () => {
    const good = await signRequest(SECRET, BODY)
    const without = (name: string) => {
      const h = new Headers(good)
      h.delete(name)
      return h
    }
    expect(await verifyRequest(SECRET, without(TIMESTAMP_HEADER), BODY)).toBe(false)
    expect(await verifyRequest(SECRET, without(SIGNATURE_HEADER), BODY)).toBe(false)
    for (const bad of ['v2=00', 'v1=zz', 'v1=', (good[SIGNATURE_HEADER] as string).toUpperCase()]) {
      const h = new Headers(good)
      h.set(SIGNATURE_HEADER, bad)
      expect(await verifyRequest(SECRET, h, BODY)).toBe(false)
    }
    const h = new Headers(good)
    h.set(TIMESTAMP_HEADER, 'yesterday')
    expect(await verifyRequest(SECRET, h, BODY)).toBe(false)
  })

  it('bytes and the same text as a string check alike', async () => {
    const signer = createSigner(SECRET)
    const headers = new Headers(await signer.sign(BODY))
    expect(await signer.check(headers, new TextEncoder().encode(BODY))).toBe(true)
  })

  it('a secret under 32 bytes is refused when the signer is made', () => {
    expect(() => createSigner('too-short')).toThrow(PdpaHttpError)
    expect(() => createSigner(new Uint8Array(31))).toThrow(/at least 32 bytes/)
    expect(() => createSigner(new Uint8Array(32))).not.toThrow()
  })
})
