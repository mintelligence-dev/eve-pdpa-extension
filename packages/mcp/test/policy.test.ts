import { definePolicy, ENTITY_TYPES } from '@eve-pdpa-extension/core'
import { describe, expect, it } from 'vitest'
import { defaultPolicy, policyProblem } from '../src/policy.js'

describe('defaultPolicy', () => {
  it('redacts every entity type', () => {
    const policy = defaultPolicy()
    for (const type of ENTITY_TYPES) expect(policy.entities[type]?.action).toBe('redact')
  })
})

describe('policyProblem', () => {
  const policy = (entities: Parameters<typeof definePolicy>[0]['entities']) =>
    definePolicy({ entitySet: '0.1', entities })

  it('accepts redact, mask, flag and block', () => {
    const p = policy({
      PHONE: { action: 'mask' },
      EMAIL: { action: 'redact' },
      LINE_USER_ID: { action: 'flag' },
      CREDIT_CARD: { action: 'block' },
    })
    expect(policyProblem(p, {})).toBeUndefined()
  })

  it('refuses tokenise, naming the types, because nothing here can resolve a token', () => {
    const p = policy({
      PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'] },
      EMAIL: { action: 'redact' },
    })
    const why = policyProblem(p, {})
    expect(why).toMatch(/tokenises PHONE/)
    expect(why).toMatch(/redact or mask/)
  })

  it('refuses hash without PDPA_HMAC_KEY, accepts it with one', () => {
    const p = policy({ PHONE: { action: 'hash' } })
    expect(policyProblem(p, {})).toMatch(/PDPA_HMAC_KEY/)
    expect(policyProblem(p, { hmacKey: '' })).toMatch(/PDPA_HMAC_KEY/)
    expect(policyProblem(p, { hmacKey: 'k'.repeat(32) })).toBeUndefined()
  })
})
