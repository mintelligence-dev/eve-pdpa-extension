import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createGuard } from '../src/guard.js'
import { parsePolicy } from '../src/policy.js'

const KEY = 'a3f1c9e07b2d4f6a8c1e3b5d7f9a0c2e4b6d8f1a3c5e7b9d0f2a4c6e8b1d3f5a'
const json = readFileSync(new URL('../../../examples/pdpa-policy.json', import.meta.url), 'utf8')

// The example a reader copies first. If it stops loading, the README is wrong.
describe('examples/pdpa-policy.json', () => {
  it('loads', () => {
    expect(() => parsePolicy(json)).not.toThrow()
  })

  it('does what its rules say on a typical LINE message', () => {
    const guard = createGuard({ policy: parsePolicy(json), hmacKey: KEY, onAudit: () => {} })
    const r = guard.processSync(
      'เลขบัตร 3-1005-00123-45-8 เบอร์ 091-888-7777 โอนเข้าบัญชี 123-4-56789-0 ติดต่อ support@myshop.co.th',
      { sessionId: 'conv_a' },
    )
    expect(r.outcome).toBe('processed')
    expect(r.text).toMatch(
      /^เลขบัตร \[เลขบัตรประชาชน\] เบอร์ \[tok:[a-z]{16}\] โอนเข้าบัญชี xxx-x-xx789-0 ติดต่อ support@myshop\.co\.th$/,
    )
  })

  it('blocks a card number', () => {
    const guard = createGuard({ policy: parsePolicy(json), hmacKey: KEY, onAudit: () => {} })
    const r = guard.processSync('บัตร 4111 1111 1111 1111', { sessionId: 'conv_a' })
    expect(r).toMatchObject({ text: '', outcome: 'blocked', blockedBy: ['CREDIT_CARD'] })
  })
})
