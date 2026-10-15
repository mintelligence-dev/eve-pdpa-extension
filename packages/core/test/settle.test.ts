import { describe, expect, it } from 'vitest'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import type {
  Action,
  Candidate,
  Detector,
  EntityRule,
  EntityType,
  PolicyInput,
  ProcessResult,
} from '../src/types.js'

// D18: overlaps are settled after the policy has judged each candidate, and
// every character a claim would hide is hidden.

const TEXT = '0123456789abcdefghij'

/** Claims exactly the span it is given, so each test sets up the overlap it means. */
function claim(
  entity: EntityType,
  start: number,
  end: number,
  confidence = 0.99,
  yieldsTo?: EntityType,
): Detector {
  return {
    id: `${entity}@${start}`,
    entities: [entity],
    detect: () => [
      { entity, start, end, confidence, detector: '', ...(yieldsTo ? { yieldsTo } : {}) },
    ],
  }
}

function run(
  detectors: readonly Detector[] | undefined,
  entities: PolicyInput['entities'],
  opts: {
    allowlist?: PolicyInput['allowlist']
    onUnmapped?: PolicyInput['onUnmapped']
    text?: string
  } = {},
): ProcessResult {
  const guard = createGuard({
    policy: definePolicy({
      entitySet: '0.1',
      entities,
      ...(opts.allowlist === undefined ? {} : { allowlist: opts.allowlist }),
      ...(opts.onUnmapped === undefined ? {} : { onUnmapped: opts.onUnmapped }),
    }),
    ...(detectors === undefined ? {} : { detectors }),
    hmacKey: 'k'.repeat(32),
    onAudit: () => {},
  })
  return guard.processSync(opts.text ?? TEXT, { sessionId: 's' })
}

const REDACT: PolicyInput['entities'] = {
  TH_NATIONAL_ID: { action: 'redact' },
  CREDIT_CARD: { action: 'redact' },
  EMAIL: { action: 'redact' },
  PHONE: { action: 'redact' },
  BANK_ACCOUNT: { action: 'redact' },
}

const spans = (r: ProcessResult) => r.findings.map((f) => [f.entity, f.start, f.end])

describe('a reading the policy drops does not take the span', () => {
  it('when it ties on length and wins on priority', () => {
    // A 13-digit Visa also reads as a national id that fails its checksum.
    const r = run([claim('TH_NATIONAL_ID', 0, 13, 0.2), claim('CREDIT_CARD', 0, 13, 0.98)], REDACT)
    expect(r.text).toBe(`[บัตรเครดิต]${TEXT.slice(13)}`)
  })

  it('when it is longer', () => {
    const r = run([claim('CREDIT_CARD', 0, 14, 0.6), claim('BANK_ACCOUNT', 0, 10, 0.96)], REDACT)
    expect(r.text).toBe(`[เลขบัญชี]${TEXT.slice(10)}`)
  })

  it("when it is under its own rule's minConfidence", () => {
    const r = run([claim('CREDIT_CARD', 0, 14, 0.98), claim('BANK_ACCOUNT', 0, 10, 0.96)], {
      ...REDACT,
      CREDIT_CARD: { action: 'redact', minConfidence: 0.99 },
    })
    expect(r.text).toBe(`[เลขบัญชี]${TEXT.slice(10)}`)
  })
})

describe('values that overlap are hidden together', () => {
  it('in one span covering both, when neither holds the other', () => {
    const r = run([claim('CREDIT_CARD', 0, 8), claim('BANK_ACCOUNT', 5, 12)], REDACT)
    expect(r.text).toBe(`[บัตรเครดิต]${TEXT.slice(12)}`)
    expect(spans(r)).toEqual([['CREDIT_CARD', 0, 12]])
  })

  it('to the end of a chain, spoken for by the longest', () => {
    const r = run(
      [claim('PHONE', 0, 4), claim('BANK_ACCOUNT', 3, 8), claim('EMAIL', 7, 10)],
      REDACT,
    )
    expect(spans(r)).toEqual([['BANK_ACCOUNT', 0, 10]])
  })

  it('but not when they only touch', () => {
    const r = run([claim('PHONE', 0, 4), claim('BANK_ACCOUNT', 4, 8)], REDACT)
    expect(spans(r)).toEqual([
      ['PHONE', 0, 4],
      ['BANK_ACCOUNT', 4, 8],
    ])
  })
})

describe('a value that is only flagged does not leave another in the clear', () => {
  const FLAG_PHONES = { ...REDACT, PHONE: { action: 'flag' } } as const

  it('on the same span', () => {
    const r = run([claim('PHONE', 0, 10), claim('BANK_ACCOUNT', 0, 10, 0.96)], FLAG_PHONES)
    expect(r.text).toBe(`[เลขบัญชี]${TEXT.slice(10)}`)
    expect(spans(r)).toEqual([['BANK_ACCOUNT', 0, 10]])
  })

  it('when the flagged one is longer', () => {
    const r = run([claim('PHONE', 0, 12), claim('BANK_ACCOUNT', 2, 12, 0.96)], FLAG_PHONES)
    expect(r.text).toBe(`01[เลขบัญชี]${TEXT.slice(12)}`)
  })

  it('and a flag that overlaps nothing is still reported', () => {
    const r = run([claim('PHONE', 0, 4), claim('BANK_ACCOUNT', 6, 10)], FLAG_PHONES)
    expect(r.findings.map((f) => f.action)).toEqual(['flag', 'redact'])
  })
})

describe('the allowlist', () => {
  it('vouches for what lies wholly inside an allowlisted value', () => {
    const r = run([claim('EMAIL', 0, 20), claim('PHONE', 5, 15)], REDACT, {
      allowlist: { exact: [TEXT] },
    })
    expect(r.text).toBe(TEXT)
    expect(r.findings).toEqual([expect.objectContaining({ entity: 'EMAIL', allowlisted: true })])
  })

  it('keeps the shop address with a phone number in it as written', () => {
    const text = 'ติดต่อ sales0812345678@myshop.co.th'
    const r = run(undefined, REDACT, {
      allowlist: { exact: ['sales0812345678@myshop.co.th'] },
      text,
    })
    expect(r.text).toBe(text)
  })

  it('does not vouch for a value that reaches outside it', () => {
    const r = run([claim('PHONE', 0, 10), claim('BANK_ACCOUNT', 5, 15, 0.96)], REDACT, {
      allowlist: { exact: ['0123456789'] },
    })
    expect(r.text).toBe(`01234[เลขบัญชี]${TEXT.slice(15)}`)
  })
})

describe('the action on a widened span', () => {
  it('is a block if any value in it blocks', () => {
    const r = run([claim('CREDIT_CARD', 0, 6), claim('BANK_ACCOUNT', 4, 14)], {
      ...REDACT,
      CREDIT_CARD: { action: 'block' },
    })
    expect(r.outcome).toBe('blocked')
    expect(r.blockedBy).toEqual(['CREDIT_CARD'])
    expect(r.text).toBe('')
  })

  it('masks without keeping the last four, which may be another value', () => {
    const MASK = {
      ...REDACT,
      CREDIT_CARD: { action: 'mask', keep: 'last4' },
      BANK_ACCOUNT: { action: 'mask' },
    } as const
    const widened = run([claim('CREDIT_CARD', 0, 8), claim('BANK_ACCOUNT', 5, 12)], MASK)
    expect(widened.text).toBe(`${'x'.repeat(12)}${TEXT.slice(12)}`)

    const own = run([claim('CREDIT_CARD', 0, 8), claim('BANK_ACCOUNT', 2, 6)], MASK)
    expect(own.text).toBe(`xxxx4567${TEXT.slice(8)}`)
  })

  it('is never a token, which would hand the other values back', () => {
    // Each token resolves for its own purposes: a callback must not get an account.
    const TOKENISE = {
      ...REDACT,
      PHONE: { action: 'tokenise', allowedPurposes: ['callback'] },
      BANK_ACCOUNT: { action: 'tokenise', allowedPurposes: ['refund'] },
    } as const
    const widened = run([claim('PHONE', 0, 10), claim('BANK_ACCOUNT', 8, 14)], TOKENISE)
    expect(widened.text).toBe(`[เบอร์โทร]${TEXT.slice(14)}`)
    expect(widened.findings[0]).toMatchObject({ entity: 'PHONE', action: 'redact' })
    expect(widened.findings[0]).not.toHaveProperty('tokenId')

    const own = run([claim('PHONE', 0, 10), claim('BANK_ACCOUNT', 2, 8)], TOKENISE)
    expect(own.findings[0]).toHaveProperty('tokenId')
  })
})

const RULE: Readonly<Record<Action, EntityRule>> = {
  block: { action: 'block' },
  redact: { action: 'redact' },
  hash: { action: 'hash' },
  tokenise: { action: 'tokenise', allowedPurposes: ['callback'] },
  mask: { action: 'mask' },
  flag: { action: 'flag' },
}
const SPEAKS_FIRST: readonly Action[] = ['block', 'tokenise', 'redact', 'hash', 'mask', 'flag']

describe('one action speaks for a shared span, in a fixed order (D19)', () => {
  it('block, tokenise, redact, hash, mask, flag', () => {
    for (let i = 1; i < SPEAKS_FIRST.length; i++) {
      const strong = SPEAKS_FIRST[i - 1] as Action
      const weak = SPEAKS_FIRST[i] as Action
      for (const [a, b] of [
        ['PHONE', 'BANK_ACCOUNT'],
        ['BANK_ACCOUNT', 'PHONE'],
      ] as const) {
        const r = run([claim(a, 0, 10), claim(b, 0, 10)], {
          ...REDACT,
          [a]: RULE[strong],
          [b]: RULE[weak],
        })
        expect(r.findings[0], `${strong} over ${weak}`).toMatchObject({ entity: a, action: strong })
      }
    }
  })

  it('and between equals, the reading the sentence names', () => {
    const yielding = claim('PHONE', 0, 10, 0.99, 'BANK_ACCOUNT')
    const r = run([yielding, claim('BANK_ACCOUNT', 0, 10, 0.96)], REDACT)
    expect(spans(r)).toEqual([['BANK_ACCOUNT', 0, 10]])

    const stricter = run([yielding, claim('BANK_ACCOUNT', 0, 10, 0.96)], {
      ...REDACT,
      BANK_ACCOUNT: { action: 'mask' },
    })
    expect(stricter.text).toBe(`[เบอร์โทร]${TEXT.slice(10)}`)
  })
})

describe('with the built-in detectors', () => {
  it('keeps a PromptPay number usable: a token beats a placeholder (D19)', () => {
    const r = run(
      undefined,
      { ...REDACT, PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'] } },
      { text: 'เลขบัญชี 091-888-7777 (พร้อมเพย์)' },
    )
    expect(r.text).toMatch(/^เลขบัญชี \[tok:[a-z]{16}\] \(พร้อมเพย์\)$/)
  })

  it('hides a PromptPay number when the policy hides phones more than accounts (D19)', () => {
    const text = 'เลขบัญชี 091-888-7777 (พร้อมเพย์)'
    const hidden = 'เลขบัญชี [เบอร์โทร] (พร้อมเพย์)'
    expect(run(undefined, { ...REDACT, BANK_ACCOUNT: { action: 'flag' } }, { text }).text).toBe(
      hidden,
    )
    expect(
      run(undefined, { PHONE: { action: 'redact' } }, { text, onUnmapped: 'ignore' }).text,
    ).toBe(hidden)
    // Alike, the sentence still names it.
    expect(run(undefined, REDACT, { text }).findings.map((f) => f.entity)).toEqual(['BANK_ACCOUNT'])
  })

  it('hides a 13-digit Visa that also reads as a national id', () => {
    const r = run(undefined, REDACT, { text: 'บัตร 4222222222222' })
    expect(r.text).toBe('บัตร [บัตรเครดิต]')
  })

  it('hides an account an amount turns into a card-shaped run', () => {
    const r = run(undefined, REDACT, { text: 'บัญชี 9876543210 300 บาท' })
    expect(r.text).not.toContain('9876543210')
  })

  it('hides an account when the card it also reads as is only flagged', () => {
    const r = run(
      undefined,
      { ...REDACT, CREDIT_CARD: { action: 'flag' } },
      { text: 'บัญชี 4123456789 102 บาท' },
    )
    expect(r.text).not.toContain('4123456789')
  })
})

/** Small and seeded, so a failure names a case that runs again the same way. */
function prng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('every character a claim would hide is hidden, under an action no lower than its own', () => {
  const ENTITIES: readonly EntityType[] = [
    'TH_NATIONAL_ID',
    'CREDIT_CARD',
    'EMAIL',
    'LINE_USER_ID',
    'PHONE',
    'BANK_ACCOUNT',
  ]
  const CONFIDENCES = [0.2, 0.6, 0.9, 0.96, 0.99]
  const LINE = 'x'.repeat(30)

  it('over 2,000 random overlaps under 40 random policies', () => {
    const random = prng(20261013)
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)] as T
    let script: Candidate[] = []
    const scripted: Detector = { id: 'scripted', entities: ENTITIES, detect: () => script }

    for (let p = 0; p < 40; p++) {
      const entities: Partial<Record<EntityType, EntityRule>> = {}
      for (const e of ENTITIES) {
        const action = pick(SPEAKS_FIRST)
        entities[e] = { ...RULE[action], ...(random() < 0.3 ? { minConfidence: 0.97 } : {}) }
      }
      const guard = createGuard({
        policy: definePolicy({ entitySet: '0.1', entities }),
        detectors: [scripted],
        hmacKey: 'k'.repeat(32),
        onAudit: () => {},
      })

      for (let n = 0; n < 50; n++) {
        script = Array.from({ length: 1 + Math.floor(random() * 6) }, () => {
          const start = Math.floor(random() * 28)
          const end = start + 1 + Math.floor(random() * Math.min(12, 30 - start))
          return {
            entity: pick(ENTITIES),
            start,
            end,
            confidence: pick(CONFIDENCES),
            detector: '',
            ...(random() < 0.2 ? { yieldsTo: pick(ENTITIES) } : {}),
          }
        })
        const r = guard.processSync(LINE, { sessionId: 's' })
        const where = JSON.stringify({ entities, script })

        for (let i = 1; i < r.findings.length; i++) {
          expect((r.findings[i - 1]?.end ?? 0) <= (r.findings[i]?.start ?? 0), where).toBe(true)
        }
        const hidden = r.findings.filter((f) => f.action !== 'flag')
        for (const c of script) {
          const rule = entities[c.entity] as EntityRule
          if (c.confidence < (rule.minConfidence ?? 0.95) || rule.action === 'flag') continue
          if (rule.action === 'block') expect(r.outcome, where).toBe('blocked')
          // Overlapping claims are hidden as one span, so one finding holds all of it.
          const by = hidden.find((f) => f.start <= c.start && c.end <= f.end)
          expect(by, where).toBeDefined()
          // The one exception is meant: a token widened over other values is a placeholder.
          const widenedToken = rule.action === 'tokenise' && by?.action === 'redact'
          expect(
            widenedToken ||
              SPEAKS_FIRST.indexOf(by?.action ?? 'flag') <= SPEAKS_FIRST.indexOf(rule.action),
            `${c.entity} ${rule.action} hidden by ${by?.action} · ${where}`,
          ).toBe(true)
        }
      }
    }
  })
})
