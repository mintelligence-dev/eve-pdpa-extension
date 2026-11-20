import { describe, expect, it } from 'vitest'
import { crc16, promptpayDetector } from '../src/detectors/promptpay.js'
import { normalise } from '../src/normalise.js'
import type { Candidate, DetectContext } from '../src/types.js'
import { checkDigit } from './helpers/make-thai-id.js'

const CTX: DetectContext = { sessionId: 'test', boundary: 'inbound' }

function detect(text: string, previous?: string): Candidate[] {
  const ctx = previous === undefined ? CTX : { ...CTX, previous }
  return promptpayDetector.detect(normalise(text), ctx) as Candidate[]
}

/** The text each candidate covers, in the normalised text the detector read. */
function found(text: string, previous?: string): string[] {
  const n = normalise(text).text
  return detect(text, previous).map((c) => n.slice(c.start, c.end))
}

/** A Thai id with a correct check digit, built from a fixed body so tests are stable. */
function id(body12: string): string {
  return body12 + checkDigit(body12)
}

const VALID_ID = id('110170020345')

/**
 * A PromptPay QR payload the way a bank app prints it: format indicator, a
 * dynamic/static marker, the PromptPay merchant account (tag 29) with the proxy
 * inside, currency, country, and the CRC. Built here so the CRC is right.
 */
function qr(proxyTag: '01' | '02' | '03', proxy: string): string {
  const aid = `0016A000000677010111`
  const target = `${proxyTag}${String(proxy.length).padStart(2, '0')}${proxy}`
  const account = aid + target
  const body =
    `000201010211` +
    `29${String(account.length).padStart(2, '0')}${account}` +
    `5303764` +
    `5802TH` +
    `6304`
  return body + crc16(body).toString(16).toUpperCase().padStart(4, '0')
}

describe('finds, when the sentence says it is a PromptPay ID', () => {
  it('a mobile number after the word', () => {
    expect(found('โอนเข้าพร้อมเพย์ 081-888-7777 นะคะ')).toEqual(['081-888-7777'])
    expect(found('promptpay: 0818887777')).toEqual(['0818887777'])
  })

  it('a national or tax id that passes its check digit', () => {
    expect(found(`พร้อมเพย์ ${VALID_ID}`)).toEqual([VALID_ID])
    expect(
      found(`PromptPay ${VALID_ID.replace(/(\d)(\d{4})(\d{5})(\d{2})(\d)/, '$1-$2-$3-$4-$5')}`),
    ).toHaveLength(1)
  })

  it('a 15-digit e-wallet id beside an e-wallet or PromptPay word', () => {
    expect(found('e-wallet 004999012345678')).toEqual(['004999012345678'])
    expect(found('พร้อมเพย์ 004999012345678')).toEqual(['004999012345678'])
  })

  it('+66, and the leading 0 dropped', () => {
    expect(found('พร้อมเพย์ +66 81 888 7777')).toEqual(['+66 81 888 7777'])
    expect(found('พร้อมเพย์ 818887777')).toEqual(['818887777'])
  })

  it('Thai numerals', () => {
    expect(found('พร้อมเพย์ ๐๘๑-๘๘๘-๗๗๗๗')).toEqual(['081-888-7777'])
  })

  it('the answer to a question that asked for one', () => {
    expect(found('0818887777', 'ขอเลขพร้อมเพย์ด้วยค่ะ')).toEqual(['0818887777'])
  })

  it('each line of a list under one cue', () => {
    expect(found('พร้อมเพย์\n0818887777\n0898887777')).toEqual(['0818887777', '0898887777'])
  })
})

describe('does not find', () => {
  it('a phone number or an id with no PromptPay word: those are PHONE and TH_NATIONAL_ID', () => {
    expect(found('โทร 081-888-7777')).toEqual([])
    expect(found(`เลขบัตร ${VALID_ID}`)).toEqual([])
  })

  it('a landline, which cannot receive PromptPay', () => {
    expect(found('พร้อมเพย์ 02-123-4567')).toEqual([])
  })

  it('thirteen digits that fail the check digit are found beside the cue, as a typo', () => {
    const bad = `${VALID_ID.slice(0, 12)}${(Number(VALID_ID[12]) + 1) % 10}`
    expect(found(`พร้อมเพย์ ${bad}`)).toEqual([bad])
  })

  it('and not without it, nor when the first digit no ID starts with', () => {
    const bad = `${VALID_ID.slice(0, 12)}${(Number(VALID_ID[12]) + 1) % 10}`
    expect(found(`เลขที่ ${bad}`)).toEqual([])
    expect(found('พร้อมเพย์ 0123456789012')).toEqual([])
  })

  it('a number that is part of a longer one', () => {
    expect(found('พร้อมเพย์ 08188877771234')).toEqual([])
  })

  it('a value under a key that names a time', () => {
    expect(found(`พร้อมเพย์ timestamp=${VALID_ID}`)).toEqual([])
  })

  it('a fifteen-digit number with no cue', () => {
    expect(found('เลขที่ 004999012345678')).toEqual([])
  })
})

describe('a PromptPay QR payload', () => {
  it('is found whole with no cue, whichever proxy it carries', () => {
    for (const payload of [
      qr('01', '0066818887777'),
      qr('02', VALID_ID),
      qr('03', '004999012345678'),
    ]) {
      expect(found(`นี่ค่ะ ${payload} สแกนได้เลย`)).toEqual([payload])
    }
  })

  it('has a CRC that matches the published check value', () => {
    // CRC-16/CCITT-FALSE of "123456789" is 0x29B1, the standard check value.
    expect(crc16('123456789')).toBe(0x29b1)
  })

  it('is still found with a wrong CRC, at a lower confidence', () => {
    const good = qr('01', '0066818887777')
    const tampered = `${good.slice(0, -4)}0000`
    const [hit] = detect(tampered)
    expect(hit?.confidence).toBeLessThan(0.99)
    expect(hit?.confidence).toBeGreaterThanOrEqual(0.95)
    expect(detect(good)[0]?.confidence).toBe(0.99)
  })

  it('is not a PromptPay QR when it names no PromptPay application', () => {
    const body = '000201010211' + '2610' + '0006ABCDEF' + '5303764' + '5802TH' + '6304'
    const other = body + crc16(body).toString(16).toUpperCase().padStart(4, '0')
    expect(found(other)).toEqual([])
  })

  it('is not read when it is cut off before the CRC', () => {
    expect(found(qr('01', '0066818887777').slice(0, -6))).toEqual([])
  })

  it('does not report the proxy inside it a second time', () => {
    expect(detect(`พร้อมเพย์ ${qr('02', VALID_ID)}`)).toHaveLength(1)
  })
})
