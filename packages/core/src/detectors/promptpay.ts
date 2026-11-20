import { isValidThaiNationalId } from '../normalise.js'
import type { Candidate, DetectContext, Detector, NormalisedText } from '../types.js'
import { isAsciiDigit, isIsolated } from './boundary.js'
import {
  containsAny,
  contextWindow,
  continuesList,
  keyedAsTime,
  previousHasCue,
} from './context.js'
import { DIGIT_RUN, type Group, opensValue, readingEnd, splitRun } from './digit-run.js'
import { toNationalForm } from './phone.js'
import { squeezing } from './squeeze.js'

/**
 * A PromptPay identifier: the thing a customer types to say where money goes.
 *
 * It is not a new kind of number. A PromptPay ID (the "proxy") is a mobile
 * number, a national or tax ID, or a 15-digit e-wallet ID, and the first two
 * are already found by `phone.ts` and `thai-national-id.ts`. What this detector
 * adds is the sentence: "พร้อมเพย์ 081-888-7777" is a PromptPay ID, and a policy
 * may want that hidden harder than a phone number said in passing. It also reads
 * two things no other detector can:
 *
 *  - the 15-digit e-wallet ID, which has no shape of its own and is claimed only
 *    beside a PromptPay or e-wallet word;
 *  - the PromptPay QR payload (EMV QR, "000201…6304ABCD"), which carries the ID
 *    inside it and is read whole, so no part of the ID is left outside the span.
 *
 * Zero dependencies: the payload is parsed and its CRC checked here, in a few
 * lines, rather than by a QR or EMV library.
 */

/** Words that say the number beside them is a PromptPay ID. */
const PROMPTPAY_CUES = [
  'พร้อมเพย์',
  'พร้อมเพย',
  'พร้อมเพ',
  'promptpay',
  'prompt pay',
  'prompt-pay',
  // The e-wallet ID is a PromptPay proxy too, and the word people use for it.
  'e-wallet',
  'ewallet',
  'e wallet',
  'อีวอลเล็ต',
  'อีวอลเลท',
  'วอลเล็ต',
]

/** Passes the check digit, or a mobile number, beside a cue. */
const CONFIDENCE_ID = 0.98
/** The country code written out (+66, 66), or the leading 0 dropped. */
/** A thirteen-digit number beside the cue whose check digit is wrong. */
const CONFIDENCE_ID_UNCHECKED = 0.96
const CONFIDENCE_BARE_PHONE = 0.96
/** Fifteen digits beside a cue: no check digit is published to test it against. */
const CONFIDENCE_EWALLET = 0.96

/** A QR payload whose CRC is right. */
const CONFIDENCE_QR = 0.99
/**
 * Well formed and naming PromptPay, but the CRC is wrong: a payload edited by
 * hand or cut by a chat limit still holds the ID, so it is still hidden.
 */
const CONFIDENCE_QR_BAD_CRC = 0.96

/** Digits only. A glued letter does not end the run, as in phone.ts. */
function belongsToRun(ch: string): boolean {
  return isAsciiDigit(ch)
}

/** The longest reading a PromptPay ID can have: the e-wallet ID. */
const MAX_DIGITS = 15

/** The mobile ranges the NBTC has allocated: 06, 08, 09. A landline cannot receive PromptPay. */
function isMobile(national: string): boolean {
  return /^0[689]\d{8}$/.test(national)
}

/**
 * The confidence of `digits` read as a PromptPay ID, or null when it is none.
 * `plus` is true when the run was written with a + in front.
 */
function scoreProxy(digits: string, plus: boolean): number | null {
  switch (digits.length) {
    case 15:
      return CONFIDENCE_EWALLET
    case 13:
      // Beside พร้อมเพย์ a thirteen-digit number is an ID with a typo in it, which
      // is still the person's ID: the check digit is not asked for here.
      if (isValidThaiNationalId(digits)) return CONFIDENCE_ID
      return /^[1-8]/.test(digits) ? CONFIDENCE_ID_UNCHECKED : null
    case 11:
      // 66 and a nine-digit national number, with or without the plus.
      return digits.startsWith('66') && isMobile(toNationalForm(plus ? `+${digits}` : digits))
        ? CONFIDENCE_BARE_PHONE
        : null
    case 10:
      return isMobile(digits) ? CONFIDENCE_ID : null
    case 9:
      // The leading 0 dropped: "พร้อมเพย์ 818887777". Only ever beside a cue.
      return isMobile(`0${digits}`) ? CONFIDENCE_BARE_PHONE : null
    default:
      return null
  }
}

/**
 * CRC-16/CCITT-FALSE: polynomial 0x1021, start value 0xFFFF, no reflection.
 * What EMV QR (and so PromptPay) puts in tag 63. Bitwise rather than from a
 * table: payloads are short, and a 256-entry table is bytes core does not need.
 */
export function crc16(text: string): number {
  let crc = 0xffff
  for (let i = 0; i < text.length; i++) {
    crc ^= (text.charCodeAt(i) & 0xff) << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc
}

/** Application ID of PromptPay's credit transfer and bill payment: A000000677010111, …12. */
const PROMPTPAY_AID = 'A00000067701011'

/** The payload format indicator every EMV QR opens with. */
const QR_OPEN = '000201'

/** Most fields a payload is read for. A real one has about fifteen. */
const MAX_FIELDS = 64

interface QrRead {
  readonly end: number
  readonly crcOk: boolean
}

/**
 * Reads the EMV payload that opens at `at`, or returns null.
 *
 * It is a list of fields, each a two-digit tag, a two-digit length and that many
 * characters. The payload ends at tag 63, whose four characters are the CRC of
 * everything before them. Taken only if it names PromptPay inside a merchant
 * account tag (26 to 51): an EMV QR for a card or another scheme is not this
 * detector's.
 */
function readQr(text: string, at: number): QrRead | null {
  let pos = at
  let promptpay = false
  for (let field = 0; field < MAX_FIELDS; field++) {
    const tag = text.slice(pos, pos + 2)
    const size = text.slice(pos + 2, pos + 4)
    if (!/^\d\d$/.test(tag) || !/^\d\d$/.test(size)) return null
    const length = Number(size)
    const valueAt = pos + 4
    if (valueAt + length > text.length) return null

    if (tag === '63') {
      if (length !== 4 || !promptpay) return null
      const given = text.slice(valueAt, valueAt + 4)
      if (!/^[0-9A-Fa-f]{4}$/.test(given)) return null
      const expected = crc16(text.slice(at, valueAt)).toString(16).toUpperCase().padStart(4, '0')
      return { end: valueAt + 4, crcOk: given.toUpperCase() === expected }
    }

    const n = Number(tag)
    if (n >= 26 && n <= 51 && text.slice(valueAt, valueAt + length).includes(PROMPTPAY_AID)) {
      promptpay = true
    }
    pos = valueAt + length
  }
  return null
}

function findPayloads(text: string): Candidate[] {
  const found: Candidate[] = []
  for (let at = text.indexOf(QR_OPEN); at !== -1; at = text.indexOf(QR_OPEN, at + 1)) {
    const read = readQr(text, at)
    if (read === null) continue
    found.push({
      entity: 'PROMPTPAY',
      start: at,
      end: read.end,
      confidence: read.crcOk ? CONFIDENCE_QR : CONFIDENCE_QR_BAD_CRC,
      detector: 'promptpay',
    })
    // The payload is one span: nothing inside it is read again.
    at = read.end - 1
  }
  return found
}

const promptpayDetectorImpl: Detector = {
  id: 'promptpay',
  entities: ['PROMPTPAY'],

  detect(input: NormalisedText, ctx?: DetectContext): Candidate[] {
    const text = input.text
    const found: Candidate[] = findPayloads(text)
    const taken = found.map((c) => [c.start, c.end] as const)
    const inPayload = (start: number, end: number) => taken.some(([s, e]) => start < e && end > s)

    // The other side asked for a PromptPay ID and this message answers it.
    const asked = previousHasCue(text, ctx?.previous, PROMPTPAY_CUES)
    // Where the last ID found ends: the next line of a list borrows the cue.
    let listed = -1

    for (const m of text.matchAll(DIGIT_RUN)) {
      const groups = splitRun(m[0], m.index)

      for (let from = 0; from < groups.length; from++) {
        if (!opensValue((groups[from] as Group).before)) continue

        // Longest reading first: 15 before 13 before 11, so an e-wallet ID is
        // not taken for the national ID inside it.
        let best: { to: number; confidence: number; plus: boolean } | null = null
        let digits = ''
        const last = readingEnd(groups, from, MAX_DIGITS)
        for (let to = from; to < last; to++) {
          digits += (groups[to] as Group).digits
          const first = groups[from] as Group
          const plus = text[first.start - 1] === '+'
          const confidence = scoreProxy(digits, plus)
          if (confidence !== null) best = { to: to + 1, confidence, plus }
        }
        if (best === null) continue

        const first = groups[from] as Group
        const end = (groups[best.to - 1] as Group).end
        const start = best.plus ? first.start - 1 : first.start
        if (!isIsolated(text, start, end, belongsToRun)) continue
        if (inPayload(start, end)) continue
        if (keyedAsTime(text, start)) continue

        const cued =
          asked ||
          containsAny(contextWindow(text, start, end), PROMPTPAY_CUES) ||
          continuesList(text, start, listed)
        if (!cued) continue

        listed = end
        found.push({
          entity: 'PROMPTPAY',
          start,
          end,
          confidence: best.confidence,
          detector: 'promptpay',
        })
        from = best.to - 1
      }
    }

    return found
  },
}

export const promptpayDetector: Detector = squeezing(promptpayDetectorImpl)
