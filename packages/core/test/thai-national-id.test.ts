import { describe, expect, it } from 'vitest'
import { thaiNationalIdDetector } from '../src/detectors/thai-national-id.js'
import { createEngine } from '../src/engine.js'
import { createGuard } from '../src/guard.js'
import { normalise } from '../src/normalise.js'
import { definePolicy } from '../src/policy.js'
import type { DetectContext } from '../src/types.js'
import { checkDigit, makeThaiId } from './helpers/make-thai-id.js'

const CTX: DetectContext = { sessionId: 'test', boundary: 'inbound' }

function detect(text: string) {
  return thaiNationalIdDetector.detect(normalise(text), CTX) as ReturnType<
    typeof thaiNationalIdDetector.detect
  > & { length: number }
}

function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

describe('shape', () => {
  it('declares what it is and what it covers', () => {
    expect(thaiNationalIdDetector.id).toBe('th-national-id')
    expect(thaiNationalIdDetector.entities).toEqual(['TH_NATIONAL_ID'])
  })

  it('is synchronous, so processSync can run it', () => {
    expect(Array.isArray(detect('no ids here'))).toBe(true)
  })
})

describe('detection', () => {
  it('finds a bare 13-digit id', () => {
    const id = makeThaiId(seeded(1))
    const found = detect(`เลขบัตร ${id} ค่ะ`)
    expect(found).toHaveLength(1)
    expect(found[0]?.entity).toBe('TH_NATIONAL_ID')
    expect(found[0]?.detector).toBe('th-national-id')
  })

  it('finds an id written with dashes', () => {
    const body = '310050012345'
    const id = `3-1005-00123-45-${checkDigit(body)}`
    const found = detect(`เลขบัตรประชาชน ${id} ครับ`)
    expect(found).toHaveLength(1)
    expect(found[0]?.confidence).toBeGreaterThan(0.95)
  })

  it('trusts the checksum, not the shape', () => {
    const body = '310050012345'
    const good = body + checkDigit(body)
    const bad = body + ((checkDigit(body) + 1) % 10)

    expect(detect(good)[0]?.confidence).toBe(0.99)
    expect(detect(bad)[0]?.confidence).toBe(0.2)
  })

  it('ignores runs that are not 13 digits long', () => {
    expect(detect('order 123456789012345678')).toHaveLength(0)
    expect(detect('เบอร์ 0918887777')).toHaveLength(0)
  })

  it('reports offsets into the normalised text', () => {
    const id = makeThaiId(seeded(7))
    const prefix = 'id '
    const found = detect(prefix + id)
    expect(found[0]?.start).toBe(prefix.length)
    expect(found[0]?.end).toBe(prefix.length + id.length)
  })

  it('finds every id in one message', () => {
    const a = makeThaiId(seeded(2))
    const b = makeThaiId(seeded(3))
    expect(detect(`${a} และ ${b}`)).toHaveLength(2)
  })
})

describe('reuse', () => {
  it('does not carry match state between calls', () => {
    const id = makeThaiId(seeded(5))
    const text = `${id} และ ${id}`
    const first = detect(text)
    const second = detect(text)
    expect(second).toEqual(first)
    expect(second).toHaveLength(2)
  })
})

describe('spaced ids — found by the benchmark, 6 Oct', () => {
  const engine = createEngine([thaiNationalIdDetector])
  const find = (s: string) =>
    engine.runSync(normalise(s), { sessionId: 's', boundary: 'inbound' }).candidates

  it('finds an id written with spaces in the printed grouping', () => {
    expect(find('เลขบัตร 3 1005 00123 45 8')).toMatchObject([
      { entity: 'TH_NATIONAL_ID', confidence: 0.99 },
    ])
  })

  it('finds it in Thai digits too', () => {
    expect(find('เลขบัตร ๓ ๑๐๐๕ ๐๐๑๒๓ ๔๕ ๘')).toHaveLength(1)
  })

  it('does not join two numbers separated by a space into an id', () => {
    // 0812345678 then 123: thirteen digits, but not in the card's grouping.
    expect(find('โทร 0812345678 123 ครั้ง')).toEqual([])
  })

  it('does not take thirteen digits out of a longer run', () => {
    expect(find('เลขอ้างอิง 31005001234580')).toEqual([])
  })
})

describe('numbers next to an id — found by the edge cases, 13 Oct', () => {
  const id = makeThaiId(seeded(11))
  const printed = (sep: string) =>
    [id.slice(0, 1), id.slice(1, 5), id.slice(5, 10), id.slice(10, 12), id.slice(12)].join(sep)
  const spans = (s: string) => detect(s).map((c) => s.slice(c.start, c.end))

  it('finds an id after a short number that is not part of it', () => {
    expect(spans(`ค่าส่ง 45 ${id}`)).toEqual([id])
    expect(spans(`ค่าส่ง 45 ${printed('-')}`)).toEqual([printed('-')])
  })

  it('finds an id with a short number after it', () => {
    expect(spans(`${id} 3 ชุด`)).toEqual([id])
  })

  it('finds an id written with dots in the printed grouping', () => {
    expect(spans(printed('.'))).toEqual([printed('.')])
    expect(detect(printed('.'))[0]?.confidence).toBe(0.99)
  })

  it('leaves thirteen dotted digits in any other grouping alone', () => {
    expect(detect('ver 1.2.3.4567.89012')).toHaveLength(0)
    expect(detect(`${id.slice(0, 3)}.${id.slice(3, 6)}.${id.slice(6)}`)).toHaveLength(0)
  })

  it('does not start an id after a dash', () => {
    expect(detect(`45-${id}`)).toHaveLength(0)
  })
})

// digit-run.ts: one set of separators for every digit detector, 13 Oct.
describe('the separators every digit detector reads', () => {
  const id = makeThaiId(seeded(23))
  const printed = (sep: string) =>
    [id.slice(0, 1), id.slice(1, 5), id.slice(5, 10), id.slice(10, 12), id.slice(12)].join(sep)
  const spans = (s: string) => detect(s).map((c) => s.slice(c.start, c.end))

  it('reads an en dash, an em dash or a minus sign as it reads a hyphen', () => {
    for (const dash of ['–', '—', '−']) expect(spans(printed(dash))).toEqual([printed(dash)])
    expect(spans(`${id.slice(0, 6)}–${id.slice(6)}`)).toEqual([`${id.slice(0, 6)}–${id.slice(6)}`])
  })

  it('reads an id pasted across two lines in the printed grouping', () => {
    const wrapped = `${id.slice(0, 1)} ${id.slice(1, 5)} ${id.slice(5, 10)}\n${id.slice(10, 12)} ${id.slice(12)}`
    expect(spans(`เลขบัตร\n${wrapped}`)).toEqual([wrapped])
  })

  it('reads spaces round a dash as a space, so the printed grouping is needed', () => {
    expect(spans(printed(' - '))).toEqual([printed(' - ')])
    expect(detect(`${id.slice(0, 6)} - ${id.slice(6)}`)).toHaveLength(0)
  })

  it('reads an id wrapped onto two lines anywhere, with no cue (D19)', () => {
    // A PDF, an email or a form wraps where it runs out of room, not where the card groups.
    expect(spans(`${id.slice(0, 6)}\n${id.slice(6)}`)).toEqual([
      `${id.slice(0, 6)}\n${id.slice(6)}`,
    ])
    expect(detect(`${id.slice(0, 7)}\r\n${id.slice(7)}`)[0]?.confidence).toBe(0.97)
  })

  it('does not join a phone number and a quantity on the next line, though they pass', () => {
    expect(detect('0812345678\n103')).toHaveLength(0)
    expect(detect('140\n0812345678')).toHaveLength(0)
    // Two breaks is two lines of something else.
    expect(detect(`${id.slice(0, 4)}\n${id.slice(4, 9)}\n${id.slice(9)}`)).toHaveLength(0)
  })
})

// D19: customers retype an id from memory, not off the card (user benchmark, 13 Oct).
describe('any spacing, when the sentence says it is an id', () => {
  const id = makeThaiId(seeded(31))
  const grouped = (sizes: number[]) => {
    const parts: string[] = []
    let at = 0
    for (const n of sizes) {
      parts.push(id.slice(at, at + n))
      at += n
    }
    return parts.join(' ')
  }
  const spans = (s: string, ctx = CTX) =>
    thaiNationalIdDetector.detect(normalise(s), ctx).map((c) => s.slice(c.start, c.end))

  it('reads 3-3-3-4 and 5-5-3 beside a cue word', () => {
    expect(spans(`เลขบัตร ${grouped([3, 3, 3, 4])}`)).toEqual([grouped([3, 3, 3, 4])])
    expect(spans(`บัตรประชาชน ${grouped([5, 5, 3])} ค่ะ`)).toEqual([grouped([5, 5, 3])])
    expect(detect(`ปชช ${grouped([4, 4, 5])}`)[0]?.confidence).toBe(0.97)
  })

  it('reads the cue from the question the message answers', () => {
    const ctx = { ...CTX, previous: 'ขอเลขบัตรประชาชนด้วยค่ะ' }
    expect(spans(grouped([3, 3, 3, 4]), ctx)).toEqual([grouped([3, 3, 3, 4])])
  })

  it('still needs the cue, and the check digit', () => {
    expect(detect(grouped([3, 3, 3, 4]))).toHaveLength(0)
    const wrong = `${id.slice(0, 12)}${(Number(id[12]) + 1) % 10}`
    expect(
      detect(`เลขบัตร ${wrong.slice(0, 3)} ${wrong.slice(3, 6)} ${wrong.slice(6)}`),
    ).toHaveLength(0)
  })

  it('hides the whole id, not just the part a phone reading takes', () => {
    const guard = createGuard({
      policy: definePolicy({
        entitySet: '0.1',
        entities: { TH_NATIONAL_ID: { action: 'redact' }, PHONE: { action: 'redact' } },
      }),
      onAudit: () => {},
    })
    const text = `เลขบัตร ${grouped([5, 5, 3])} เบอร์ 066-713-6837`
    expect(guard.processSync(text).text).toBe('เลขบัตร [เลขบัตรประชาชน] เบอร์ [เบอร์โทร]')
  })
})

// User benchmark, 14 Oct (D20): LINE webhook and tool timestamps in ms.
describe('a key that names a time', () => {
  const stamp = (body: string) => `${body}${checkDigit(body)}`
  const ms = stamp('176100000000')

  it('scores a number that passes the checksum as shape only', () => {
    for (const text of [
      `{"timestamp":${ms}}`,
      `ts=${ms}`,
      `updated=${ms}`,
      `"createdAt": ${ms}`,
      `sent_time: ${ms}`,
    ]) {
      expect(detect(text)[0]?.confidence).toBe(0.2)
    }
  })

  it('still reads an id under any other key', () => {
    expect(detect(`citizen_id=${ms}`)[0]?.confidence).toBe(0.99)
    expect(detect(`"at":${ms}`)[0]?.confidence).toBe(0.99)
  })
})

// User benchmark, 14 Oct (D20): a list pasted under one heading.
describe('a list, one id a line', () => {
  const a = makeThaiId(seeded(41))
  const b = makeThaiId(seeded(43))
  const spaced = (id: string) =>
    `${id.slice(0, 3)} ${id.slice(3, 6)} ${id.slice(6, 9)} ${id.slice(9)}`
  const spans = (s: string) => detect(s).map((c) => s.slice(c.start, c.end))

  it('reads an id spaced any way on the line after one that passed its checksum', () => {
    expect(spans(`ข้อมูลผู้เข้าพักทั้งสองท่านค่ะ\n${a}\n${spaced(b)}`)).toEqual([a, spaced(b)])
  })

  it('does not take the number of a numbered line into the id', () => {
    const text = `ข้อมูลผู้เข้าพักทั้งสองท่านค่ะ\n1. ${a}\n2. ${spaced(b)}`
    expect(spans(text)).toEqual([a, spaced(b)])
  })

  it('still needs the check digit', () => {
    const wrong = `${b.slice(0, 12)}${(Number(b[12]) + 1) % 10}`
    expect(spans(`ข้อมูลผู้เข้าพักทั้งสองท่านค่ะ\n${a}\n${spaced(wrong)}`)).toEqual([a])
  })
})
