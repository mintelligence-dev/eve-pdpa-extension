import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepare, USAGE } from '../src/cli.js'
import { PHONE } from './helpers.js'

const dir = mkdtempSync(join(tmpdir(), 'pdpa-mcp-'))
const file = (name: string, body: string) => {
  const path = join(dir, name)
  writeFileSync(path, body)
  return path
}
const policyFile = (entities: Record<string, unknown>) =>
  file(`p${Math.random()}.json`, JSON.stringify({ entitySet: '0.1', entities }))

const io = (env: Record<string, string> = {}) => {
  const err: string[] = []
  return { io: { env, stderr: (t: string) => err.push(t) }, err }
}

describe('prepare: what the program is asked', () => {
  it('--help and --version answer and do not start', () => {
    expect(prepare(['--help'], io().io)).toEqual({ ok: false, code: 0, message: USAGE })
    const v = prepare(['-v'], io().io)
    expect(v.ok === false && v.code === 0 && v.message).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('an unknown option or a stray argument is exit 2 with the usage', () => {
    for (const args of [['--polcy', 'x.json'], ['x.json']]) {
      const r = prepare(args, io().io)
      expect(r.ok === false && r.code).toBe(2)
      expect(r.ok === false && r.message).toContain('Usage:')
    }
  })
})

describe('prepare: the policy', () => {
  it('no --policy starts with every type redacted', async () => {
    const r = prepare([], io().io)
    if (!r.ok) throw new Error(r.message)
    expect((await r.guard.process(`โทร ${PHONE}`)).text).toBe('โทร [เบอร์โทร]')
  })

  it('--policy is applied', async () => {
    const r = prepare(['--policy', policyFile({ PHONE: { action: 'mask' } })], io().io)
    if (!r.ok) throw new Error(r.message)
    const text = (await r.guard.process(PHONE)).text
    expect(text).not.toBe('[เบอร์โทร]')
    expect(text).not.toContain(PHONE)
  })

  it('a missing or invalid policy file is exit 2 naming the file', () => {
    for (const path of [join(dir, 'nope.json'), file('bad.json', '{"entitySet":')]) {
      const r = prepare(['--policy', path], io().io)
      expect(r.ok === false && r.code).toBe(2)
      expect(r.ok === false && r.message).toContain(path)
    }
  })

  it('a policy that tokenises does not start', () => {
    const path = policyFile({ PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'] } })
    const r = prepare(['--policy', path], io().io)
    expect(r.ok === false && r.code).toBe(2)
    expect(r.ok === false && r.message).toMatch(/tokenises PHONE/)
  })

  it('a policy that hashes needs PDPA_HMAC_KEY', async () => {
    const path = policyFile({ PHONE: { action: 'hash' } })
    const without = prepare(['--policy', path], io().io)
    expect(without.ok === false && without.message).toMatch(/PDPA_HMAC_KEY/)
    const r = prepare(['--policy', path], io({ PDPA_HMAC_KEY: 'k'.repeat(32) }).io)
    if (!r.ok) throw new Error(r.message)
    expect((await r.guard.process(PHONE)).text).not.toContain(PHONE)
  })

  it('a PDPA_HMAC_KEY that is too short is exit 2, and the key is never printed', () => {
    const path = policyFile({ PHONE: { action: 'hash' } })
    const key = 'sh0rtSecretX'
    const r = prepare(['--policy', path], io({ PDPA_HMAC_KEY: key }).io)
    expect(r.ok === false && r.code).toBe(2)
    expect(r.ok === false && r.message).toMatch(/at least 32 bytes/)
    expect(r.ok === false && r.message).not.toContain(key)
  })
})

describe('prepare: audit', () => {
  it('goes to stderr by default, one JSON line per event, with no value', async () => {
    const { io: cliIo, err } = io()
    const r = prepare([], cliIo)
    if (!r.ok) throw new Error(r.message)
    await r.guard.process(`โทร ${PHONE}`)
    expect(err.length).toBeGreaterThan(0)
    for (const line of err) expect(() => JSON.parse(line)).not.toThrow()
    expect(err.join('')).not.toContain(PHONE)
  })

  it('--audit appends to a file instead, and nothing goes to stderr', async () => {
    const path = join(dir, 'audit.jsonl')
    const { io: cliIo, err } = io()
    const r = prepare(['--audit', path], cliIo)
    if (!r.ok) throw new Error(r.message)
    await r.guard.process(`โทร ${PHONE}`)
    await r.guard.process(`โทร ${PHONE}`)
    const lines = readFileSync(path, 'utf8').trim().split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines.join('')).not.toContain(PHONE)
    expect(err).toEqual([])
  })

  it('a new --audit file is readable by its owner only', () => {
    const path = join(dir, 'private.jsonl')
    const r = prepare(['--audit', path], io().io)
    if (!r.ok) throw new Error(r.message)
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('an --audit file that cannot be written stops the start: exit 2, the error code only', () => {
    const r = prepare(['--audit', join(dir, 'no-such-dir', 'a.jsonl')], io().io)
    expect(r.ok === false && r.code).toBe(2)
    expect(r.ok === false && r.message).toMatch(/^audit .*a\.jsonl: ENOENT\n$/)
  })

  it('an --audit file that fails later is reported on stderr, with no value', async () => {
    const path = join(dir, 'later.jsonl')
    const { io: cliIo, err } = io()
    const r = prepare(['--audit', path], cliIo)
    if (!r.ok) throw new Error(r.message)
    // The file becomes a directory: every append now fails.
    rmSync(path)
    mkdirSync(path)
    const result = await r.guard.process(`โทร ${PHONE}`)
    expect(result.text).toBe('โทร [เบอร์โทร]')
    expect(err.length).toBeGreaterThan(0)
    for (const line of err)
      expect(line).toMatch(/^eve-pdpa-mcp: the \S+ audit event was not written \(EISDIR\)\n$/)
    expect(err.join('')).not.toContain(PHONE)
  })
})
