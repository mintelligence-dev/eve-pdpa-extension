import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import type { GuardOptions } from '../src/types.js'

/**
 * D3 — what happens to audit when the sink misbehaves or is missing.
 *
 * A throwing sink must not fail the message, and must not vanish either: audit
 * that silently stops arriving is a compliance gap, not just a bug.
 */

const policy = definePolicy({
  entitySet: '0.1',
  entities: {
    PHONE: { action: 'redact' },
    TH_NATIONAL_ID: { action: 'tokenise', allowedPurposes: ['kyc'] },
  },
})

const throwingSink = () => {
  throw new Error('log pipeline down')
}

function build(extra: Partial<GuardOptions> = {}) {
  return createGuard({ policy, ...extra })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a sink that throws', () => {
  it('does not fail the message', () => {
    const guard = build({ onAudit: throwingSink })
    const r = guard.processSync('เบอร์ 0918887777')
    expect(r.outcome).toBe('processed')
    expect(r.text).toBe('เบอร์ [เบอร์โทร]')
  })

  it('does not fail a resolve', () => {
    const guard = build({ onAudit: throwingSink })
    const token = /\[tok:[a-z]{16}\]/.exec(guard.processSync('เลขบัตร 3-1005-00123-45-8').text)?.[0]
    expect(guard.resolveSync(token ?? '', { purpose: 'kyc' })).toEqual({
      ok: true,
      value: '3100500123458',
    })
  })

  it('is counted, once per lost event, from scans and resolves alike', () => {
    const guard = build({ onAudit: throwingSink })
    // policy.loaded, written while the guard was being built (D10.7).
    expect(guard.stats.auditSinkErrors).toBe(1)

    guard.processSync('เบอร์ 0918887777')
    guard.processSync('ไม่มีอะไร')
    guard.resolveSync('[tok:bbbbbbbbbbbbbbbb]', { purpose: 'kyc' })

    expect(guard.stats.auditSinkErrors).toBe(4)
  })

  it('does not stop the guard being built', () => {
    expect(() => build({ onAudit: throwingSink })).not.toThrow()
  })

  it('is reported to onError with what was being written', () => {
    const onError = vi.fn()
    const guard = build({ onAudit: throwingSink, onError })

    guard.processSync('เบอร์ 0918887777')
    guard.resolveSync('[tok:bbbbbbbbbbbbbbbb]', { purpose: 'kyc' })

    expect(onError).toHaveBeenCalledTimes(3)
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect(onError.mock.calls[0]?.[1]).toEqual({ source: 'audit_sink', eventType: 'policy.loaded' })
    expect(onError.mock.calls[1]?.[1]).toEqual({ source: 'audit_sink', eventType: 'scan' })
    expect(onError.mock.calls[2]?.[1]).toEqual({ source: 'audit_sink', eventType: 'token.resolve' })
  })

  it('still fails nothing when onError throws too, and is still counted', () => {
    const guard = build({
      onAudit: throwingSink,
      onError: () => {
        throw new Error('error handler broken as well')
      },
    })
    expect(guard.processSync('เบอร์ 0918887777').text).toBe('เบอร์ [เบอร์โทร]')
    expect(guard.stats.auditSinkErrors).toBe(2)
  })

  it('does not count a sink that works', () => {
    const guard = build({ onAudit: () => {} })
    guard.processSync('เบอร์ 0918887777')
    expect(guard.stats.auditSinkErrors).toBe(0)
  })
})

describe('no sink at all', () => {
  // The warning is once per process, so each test loads a fresh copy of guard.
  async function freshGuardModule() {
    vi.resetModules()
    return import('../src/guard.js')
  }

  it('warns once that audit is being discarded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { createGuard: fresh } = await freshGuardModule()

    fresh({ policy })
    fresh({ policy })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/no onAudit.*discarded/)
  })

  it('does not warn when a sink is given, even one that discards on purpose', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { createGuard: fresh } = await freshGuardModule()

    fresh({ policy, onAudit: () => {} })

    expect(warn).not.toHaveBeenCalled()
  })

  it('still protects the message', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { createGuard: fresh } = await freshGuardModule()
    expect(fresh({ policy }).processSync('เบอร์ 0918887777').text).toBe('เบอร์ [เบอร์โทร]')
  })
})
