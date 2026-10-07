import { describe, expect, it } from 'vitest'
import { EXIT } from '../src/cli.js'
import { cli, file } from './helpers.js'

const policy = (p: unknown) => file(typeof p === 'string' ? p : JSON.stringify(p), '.json')

describe('policy validate', () => {
  it('accepts the example policy and says what it does with each entity', async () => {
    const r = await cli(
      'policy',
      'validate',
      new URL('../../../examples/pdpa-policy.json', import.meta.url).pathname,
    )
    expect(r.code).toBe(EXIT.CLEAN)
    expect(r.stdout).toMatch(/valid {2}fnv1a64:[0-9a-f]{16}/)
    expect(r.stdout).toMatch(/PHONE +tokenise · purposes: otp_send · ttl 300s/)
    expect(r.stdout).toMatch(/CREDIT_CARD +block · minConfidence 0.6/)
    expect(r.stdout).toContain('needs an hmacKey')
    expect(r.stdout).toContain('needs a sessionId')
  })

  it('names what onUnmapped does with each entity the policy leaves out', async () => {
    const r = await cli(
      'policy',
      'validate',
      policy({ entitySet: '0.1', onUnmapped: 'ignore', entities: {} }),
    )
    expect(r.stdout).toMatch(/EMAIL +not in the policy → let through, not reported/)
  })

  it('counts allowlist entries and never shows them, exact or pattern', async () => {
    const r = await cli(
      'policy',
      'validate',
      policy({
        entitySet: '0.1',
        entities: {},
        allowlist: {
          exact: ['0918887777', 'somchai@example.com'],
          pattern: ['0918887777|0812345678'],
        },
      }),
    )
    expect(r.stdout).toContain('2 exact · 1 pattern (values not shown)')
    for (const v of ['0918887777', 'somchai', '0812345678']) expect(r.stdout).not.toContain(v)
  })

  it('rejects an invalid policy with exit 1, naming the field', async () => {
    const r = await cli(
      'policy',
      'validate',
      policy({ entitySet: '0.1', entities: { PHONE: { action: 'tokenise' } } }),
    )
    expect(r.code).toBe(EXIT.FOUND)
    expect(r.stderr).toContain('entities.PHONE.allowedPurposes')
  })

  it('catches the misspellings that would otherwise load as something else', async () => {
    for (const p of [
      { entitySet: '0.1', entities: { BANK_ACOUNT: { action: 'redact' } } },
      { entitySet: '0.1', entities: { EMAIL: { action: 'mask', keeps: 'last4' } } },
      { entitySet: '0.1', entities: {}, allowList: { exact: [] } },
    ]) {
      expect((await cli('policy', 'validate', policy(p))).code, JSON.stringify(p)).toBe(EXIT.FOUND)
    }
  })

  it('gives the line of a JSON syntax error, never the text around it', async () => {
    const r = await cli(
      'policy',
      'validate',
      policy('{"entitySet":"0.1",\n "allowlist":{"exact":["0918887777" "x"]}}'),
    )
    expect(r.code).toBe(EXIT.FOUND)
    expect(r.stderr).toContain('not valid JSON (line 2)')
    expect(r.stderr).not.toContain('0918887777')
  })

  it('never echoes a value from a policy that fails for another reason', async () => {
    const r = await cli(
      'policy',
      'validate',
      policy({
        entitySet: '0.1',
        entities: {},
        allowlist: { exact: ['0918887777'], pattern: ['('] },
      }),
    )
    expect(r.code).toBe(EXIT.FOUND)
    expect(r.stderr).toContain('allowlist.pattern[0]')
    expect(r.stderr).not.toContain('0918887777')
  })

  it('exits 2 when it cannot run', async () => {
    for (const argv of [
      ['policy'],
      ['policy', 'lint', 'x.json'],
      ['policy', 'validate'],
      ['policy', 'validate', '/no/such/file.json'],
    ]) {
      expect((await cli(...argv)).code, argv.join(' ')).toBe(EXIT.USAGE)
    }
  })
})
