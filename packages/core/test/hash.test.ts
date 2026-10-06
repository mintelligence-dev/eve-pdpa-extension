import { createHmac as nodeHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PdpaError } from '../src/errors.js'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import { encodeLetters } from '../src/random.js'
import type { AuditEvent, PolicyInput } from '../src/types.js'

/** Synthetic, 64 hex characters = 64 bytes as UTF-8. Never used outside tests. */
const KEY = 'a3f1c9e07b2d4f6a8c1e3b5d7f9a0c2e4b6d8f1a3c5e7b9d0f2a4c6e8b1d3f5a'

const HASHED = /\[[A-Z_]+:[bcdfghjkmnpqrstv]{16}\]/

function guardWith(
  entities: PolicyInput['entities'],
  opts: { key?: string | Uint8Array; extra?: Partial<PolicyInput> } = {},
) {
  const events: AuditEvent[] = []
  const guard = createGuard({
    policy: definePolicy({ entitySet: '0.1', entities, ...opts.extra }),
    hmacKey: 'key' in opts ? opts.key : KEY,
    onAudit: (e) => {
      if (e.type === 'scan') events.push(e)
    },
  })
  return { guard, events }
}

/** What the output must be, computed without any of the code under test's crypto. */
function expected(entity: string, canonical: string, key = KEY): string {
  const mac = nodeHmac('sha256', key).update(`${entity}\u0000${canonical}`).digest()
  return `[${entity}:${encodeLetters(new Uint8Array(mac.subarray(0, 8)))}]`
}

describe('output', () => {
  it('matches HMAC-SHA256 computed independently by node:crypto', () => {
    const { guard } = guardWith({ PHONE: { action: 'hash' } })
    expect(guard.processSync('เบอร์ 0918887777').text).toBe(
      `เบอร์ ${expected('PHONE', '0918887777')}`,
    )
  })

  it('is the entity name and 16 letters, with no digits anywhere', () => {
    const { guard } = guardWith({ PHONE: { action: 'hash' } })
    const out = guard.processSync('เบอร์ 0918887777').text
    expect(out).toMatch(HASHED)
    expect(out.replace('เบอร์ ', '')).not.toMatch(/\d/)
  })

  it('keeps the English entity name when placeholders are Thai', () => {
    const { guard } = guardWith(
      { PHONE: { action: 'hash' } },
      { extra: { placeholderLanguage: 'th' } },
    )
    expect(guard.processSync('เบอร์ 0918887777').text).toContain('[PHONE:')
  })

  it('leaves the rest of the message as the customer wrote it', () => {
    const { guard } = guardWith({ PHONE: { action: 'hash' } })
    const out = guard.processSync('สั่ง ๕ ชิ้น เบอร์ 0918887777 ค่ะ').text
    expect(out.startsWith('สั่ง ๕ ชิ้น เบอร์ [PHONE:')).toBe(true)
    expect(out.endsWith('] ค่ะ')).toBe(true)
  })
})

describe('the same value always gives the same hash', () => {
  it('however it was written — canonical form, D8', () => {
    const { guard } = guardWith({ PHONE: { action: 'hash' } })
    const want = `เบอร์ ${expected('PHONE', '0918887777')}`
    for (const written of [
      '0918887777',
      '091-888-7777',
      '๐๙๑-๘๘๘-๗๗๗๗',
      '+66 91 888 7777',
      '091​8887777',
    ]) {
      expect(guard.processSync(`เบอร์ ${written}`).text).toBe(want)
    }
  })

  it('across separate guards with the same key, so records can be joined', () => {
    const a = guardWith({ PHONE: { action: 'hash' } }).guard
    const b = guardWith({ PHONE: { action: 'hash' } }).guard
    expect(a.processSync('เบอร์ 0918887777').text).toBe(b.processSync('เบอร์ 0918887777').text)
  })
})

describe('different inputs give different hashes', () => {
  it('two numbers', () => {
    const { guard } = guardWith({ PHONE: { action: 'hash' } })
    expect(guard.processSync('เบอร์ 0918887777').text).not.toBe(
      guard.processSync('เบอร์ 0918887778').text,
    )
  })

  it('the same digits as a phone and as an account', () => {
    const { guard } = guardWith({ PHONE: { action: 'hash' }, BANK_ACCOUNT: { action: 'hash' } })
    const asPhone = guard.processSync('เบอร์ 0812345678').text.replace('เบอร์ ', '')
    const asAccount = guard.processSync('เลขบัญชี 0812345678').text.replace('เลขบัญชี ', '')

    expect(asPhone.startsWith('[PHONE:')).toBe(true)
    expect(asAccount.startsWith('[BANK_ACCOUNT:')).toBe(true)
    expect(asPhone.slice(-17)).not.toBe(asAccount.slice(-17))
  })

  it('a different key', () => {
    const other = 'b'.repeat(64)
    const a = guardWith({ PHONE: { action: 'hash' } }).guard
    const b = guardWith({ PHONE: { action: 'hash' } }, { key: other }).guard
    expect(a.processSync('เบอร์ 0918887777').text).not.toBe(b.processSync('เบอร์ 0918887777').text)
  })
})

describe('a second pass through the guard', () => {
  it('finds nothing inside the hash — item 6', () => {
    const { guard } = guardWith({
      PHONE: { action: 'hash' },
      CREDIT_CARD: { action: 'hash' },
      TH_NATIONAL_ID: { action: 'hash' },
    })
    const once = guard.processSync('เบอร์ 0918887777 บัตร 4111 1111 1111 1111').text
    const twice = guard.processSync(once)
    expect(twice.text).toBe(once)
    expect(twice.findings).toEqual([])
  })
})

describe('the key — checked when the guard is built', () => {
  const policy = definePolicy({ entitySet: '0.1', entities: { PHONE: { action: 'hash' } } })

  const errorFor = (hmacKey: unknown): PdpaError | undefined => {
    try {
      createGuard({ policy, hmacKey: hmacKey as string })
    } catch (e) {
      return e as PdpaError
    }
    return undefined
  }

  it('is required when the policy uses hash', () => {
    expect(errorFor(undefined)?.code).toBe('ERR_PDPA_HMAC_KEY')
  })

  it('must be at least 32 bytes', () => {
    expect(errorFor('x'.repeat(31))?.code).toBe('ERR_PDPA_HMAC_KEY')
    expect(errorFor(new Uint8Array(31))?.code).toBe('ERR_PDPA_HMAC_KEY')
    expect(errorFor('x'.repeat(32))).toBeUndefined()
    expect(errorFor(new Uint8Array(32))).toBeUndefined()
  })

  it('counts a string by its UTF-8 bytes, not its characters', () => {
    // 11 Thai characters, 33 bytes.
    expect(errorFor('ก'.repeat(11))).toBeUndefined()
    // 10 Thai characters, 30 bytes.
    expect(errorFor('ก'.repeat(10))?.code).toBe('ERR_PDPA_HMAC_KEY')
  })

  it('must be a string or bytes', () => {
    expect(errorFor(12345)?.code).toBe('ERR_PDPA_HMAC_KEY')
  })

  it('never appears in the error message', () => {
    const short = 'secret-but-short'
    expect(String(errorFor(short))).not.toContain(short)
  })

  it('is not asked for when the policy does not use hash', () => {
    expect(() =>
      createGuard({
        policy: definePolicy({ entitySet: '0.1', entities: { PHONE: { action: 'redact' } } }),
      }),
    ).not.toThrow()
  })
})

describe('what stays out of the audit event', () => {
  it('neither the value nor the key', () => {
    const { guard, events } = guardWith({ PHONE: { action: 'hash' } })
    guard.processSync('เบอร์ 0918887777')
    const json = JSON.stringify(events)
    expect(json).not.toContain('0918887777')
    expect(json).not.toContain(KEY)
    expect(events[0]?.findings[0]?.action).toBe('hash')
  })
})

describe('with the rest of the policy', () => {
  it('does not stop the message, unlike the temporary fail-closed behaviour it replaces', () => {
    const { guard } = guardWith({ PHONE: { action: 'hash' } })
    const r = guard.processSync('เบอร์ 0918887777')
    expect(r.outcome).toBe('processed')
    expect(r).not.toHaveProperty('blockedBy')
  })

  it('lets an allowlisted value through unhashed', () => {
    const { guard } = guardWith(
      { PHONE: { action: 'hash' } },
      { extra: { allowlist: { exact: ['021234567'] } } },
    )
    expect(guard.processSync('โทร 02-123-4567').text).toBe('โทร 02-123-4567')
  })
})
