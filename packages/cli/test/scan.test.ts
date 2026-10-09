import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { EXIT } from '../src/cli.js'
import { cli, dir, file, jsonl, report } from './helpers.js'

// Synthetic values only; the id passes its checksum. Each is also listed as the
// guard would fold it, so a report leaking the normalised form is caught too.
const VALUES = [
  '091-888-7777',
  '0918887777',
  '3-1005-00123-45-8',
  '3100500123458',
  'somchai@example.com',
  '02-123-4567',
  '021234567',
]

const CHATS = file(
  [
    jsonl({ id: 'msg_1', text: 'สวัสดีครับ สั่งของได้ไหม' }),
    jsonl({ id: 'msg_2', text: 'เบอร์ 091-888-7777 นะครับ' }),
    'not json {091-888-7777',
    jsonl({ id: 'msg_4', text: 'บัตร 3-1005-00123-45-8 อีเมล somchai@example.com' }),
    jsonl({ id: 'msg_5', body: 'เบอร์ 091-888-7777' }),
    jsonl({ id: 'msg_6', text: 'ติดต่อร้าน 02-123-4567' }),
    jsonl([1, 2]),
  ].join('\n'),
)

const POLICY = file(
  JSON.stringify({
    entitySet: '0.1',
    entities: {
      PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'] },
      TH_NATIONAL_ID: { action: 'block' },
      EMAIL: { action: 'hash' },
    },
    allowlist: { exact: ['02-123-4567'] },
  }),
  '.json',
)

describe('scan', () => {
  it('counts what it found, per entity and per message', async () => {
    const r = await report('scan', CHATS)
    expect(r.records).toEqual({ scanned: 4, withFindings: 3, blocked: 0, unreadable: 3 })
    expect(r.entities).toMatchObject({ PHONE: 2, TH_NATIONAL_ID: 1, EMAIL: 1, BANK_ACCOUNT: 0 })
    expect(r.hits).toEqual([
      { line: 2, id: 'msg_2', entities: ['PHONE'] },
      { line: 4, id: 'msg_4', entities: ['TH_NATIONAL_ID', 'EMAIL'] },
      { line: 6, id: 'msg_6', entities: ['PHONE'] },
    ])
    expect(r.policy.source).toBe('default')
    expect(r).not.toHaveProperty('actions')
  })

  it('reports a line it cannot read by number and reason, and scans the rest', async () => {
    const r = await report('scan', CHATS)
    expect(r.unreadable).toEqual([
      { line: 3, problem: 'not valid JSON' },
      { line: 5, problem: 'no string field "text"' },
      { line: 7, problem: 'not a JSON object' },
    ])
  })

  it('never puts a value in the report, in either format, even from a line it could not read', async () => {
    for (const extra of [[], ['--json'], ['--policy', POLICY], ['--policy', POLICY, '--json']]) {
      const { stdout, stderr } = await cli('scan', CHATS, ...extra)
      for (const v of VALUES) {
        expect(stdout, `${extra.join(' ')} leaked ${v}`).not.toContain(v)
        expect(stderr).not.toContain(v)
      }
    }
  })

  it('with a policy, says what it would do, and counts allowlisted values apart', async () => {
    const r = await report('scan', CHATS, '--policy', POLICY)
    expect(r.policy.source).toBe('file')
    expect(r.actions).toEqual({ tokenise: 1, block: 1, hash: 1 })
    expect(r.allowlisted).toBe(1)
    expect(r.entities.PHONE).toBe(1)
    expect(r.records.blocked).toBe(1)
    expect(r.hits.find((h) => h.line === 4)).toMatchObject({ blocked: true })
  })

  it('does not run out of token space on a large file', async () => {
    const many = file(
      Array.from({ length: 12_000 }, (_, i) =>
        jsonl({ id: i, text: `เบอร์ 09${String(10_000_000 + i).padStart(8, '0')}` }),
      ).join('\n'),
    )
    const r = await report('scan', many, '--policy', POLICY)
    expect(r.records.blocked).toBe(0)
    expect(r.actions).toEqual({ tokenise: 12_000 })
  })

  it('reads the fields it is told to', async () => {
    const custom = file(jsonl({ msgId: 'abc', message: 'เบอร์ 0918887777' }))
    const r = await report('scan', custom, '--text-field', 'message', '--id-field', 'msgId')
    expect(r.hits).toEqual([{ line: 1, id: 'abc', entities: ['PHONE'] }])
  })

  it('takes a numeric id, and gives null when there is none', async () => {
    const ids = file(jsonl({ id: 7, text: 'เบอร์ 0918887777' }, { text: 'เบอร์ 0918887777' }))
    expect((await report('scan', ids)).hits.map((h) => h.id)).toEqual(['7', null])
  })

  it('skips blank lines, and copes with a BOM and Windows line endings', async () => {
    const messy = file(`﻿${jsonl({ text: 'เบอร์ 0918887777' })}\r\n\r\n${jsonl({ text: 'ไม่มี' })}\r\n`)
    const r = await report('scan', messy)
    expect(r.records).toEqual({ scanned: 2, withFindings: 1, blocked: 0, unreadable: 0 })
  })

  it('reads Thai numerals as the guard does', async () => {
    const thai = file(jsonl({ text: 'เบอร์ ๐๙๑-๘๘๘-๗๗๗๗' }))
    expect((await report('scan', thai)).entities.PHONE).toBe(1)
  })

  it('lists only the first twenty messages for a person, and all of them in JSON', async () => {
    const many = file(
      Array.from({ length: 25 }, (_, i) => jsonl({ id: `m${i}`, text: 'เบอร์ 0918887777' })).join(
        '\n',
      ),
    )
    expect((await cli('scan', many)).stdout).toContain('first 20 of 25')
    expect((await report('scan', many)).hits).toHaveLength(25)
  })
})

describe('exit codes', () => {
  it('0 when every message was read and nothing found', async () => {
    expect((await cli('scan', file(jsonl({ text: 'สวัสดี' })))).code).toBe(EXIT.CLEAN)
  })

  it('1 when something was found', async () => {
    expect((await cli('scan', CHATS)).code).toBe(EXIT.FOUND)
  })

  it('3 when nothing was found but some lines could not be read', async () => {
    const r = await cli('scan', file(`${jsonl({ text: 'สวัสดี' })}\nbroken`))
    expect(r.code).toBe(EXIT.UNREADABLE)
    expect(r.stdout).toContain('not scanned')
  })

  it('2 for anything that stops it running', async () => {
    const usage = [
      [],
      ['scan'],
      ['scan', CHATS, CHATS],
      ['lint', CHATS],
      ['scan', CHATS, '--nope'],
      ['scan', join(dir, 'missing.jsonl')],
      ['scan', file('', '.txt')],
      ['scan', CHATS, '--format', 'csv'],
      ['scan', CHATS, '--policy', join(dir, 'missing.json')],
    ]
    for (const argv of usage) expect((await cli(...argv)).code, argv.join(' ')).toBe(EXIT.USAGE)
  })

  it('2 for an invalid policy, naming the field and never the value', async () => {
    const bad = file(
      JSON.stringify({
        entitySet: '0.1',
        entities: {},
        allowlist: { exact: ['0918887777'], pattrn: [] },
      }),
      '.json',
    )
    const r = await cli('scan', CHATS, '--policy', bad)
    expect(r.code).toBe(EXIT.USAGE)
    expect(r.stderr).toContain('allowlist.pattrn')
    expect(r.stderr).not.toContain('0918887777')
  })

  it('takes --format when the extension does not say', async () => {
    const txt = file(jsonl({ text: 'สวัสดี' }), '.txt')
    expect((await cli('scan', txt, '--format', 'jsonl')).code).toBe(EXIT.CLEAN)
  })

  it('answers --help and --version with 0', async () => {
    expect((await cli('--help')).code).toBe(EXIT.CLEAN)
    expect((await cli('--version')).stdout).toMatch(/^\d+\.\d+\.\d+\n$/)
  })
})

// Needs a build, which `pnpm test` does not run: skipped without one. verify
// builds first, so there it always runs, against the code as it is now.
const BIN = fileURLToPath(new URL('../dist/index.js', import.meta.url))

describe('the built binary', () => {
  it.skipIf(!existsSync(BIN))('runs, and exits with the code the report implies', async () => {
    const bin = BIN
    const run = promisify(execFile)
    await expect(run(process.execPath, [bin, 'scan', CHATS])).rejects.toMatchObject({ code: 1 })
    const clean = file(jsonl({ text: 'สวัสดี' }))
    await expect(run(process.execPath, [bin, 'scan', clean])).resolves.toBeDefined()
  })
})

describe('below the confidence threshold', () => {
  // Passes Luhn, but no card issuer uses a 9 prefix: the detector gives 0.6.
  const WEAK_CARD = '9000123456789016'
  const weak = file(
    jsonl(
      { id: 'm1', text: `เลข ${WEAK_CARD} ครับ` },
      { id: 'm2', text: 'เบอร์ 0918887777' },
      { id: 'm3', text: `อีกใบ ${WEAK_CARD}` },
    ),
  )
  const policyWith = (rule: object) =>
    file(JSON.stringify({ entitySet: '0.1', entities: { CREDIT_CARD: rule } }), '.json')

  it('counts what the guard dropped, and where, apart from what it acted on', async () => {
    const r = await report('scan', weak)
    expect(r.entities.CREDIT_CARD).toBe(0)
    expect(r.belowThreshold.entities).toEqual({
      CREDIT_CARD: { count: 2, threshold: 0.95, lowest: 0.6, highest: 0.6 },
    })
    expect(r.belowThreshold.hits).toEqual([
      { line: 1, id: 'm1', entities: ['CREDIT_CARD'] },
      { line: 3, id: 'm3', entities: ['CREDIT_CARD'] },
    ])
  })

  it("uses the rule's minConfidence — at 0.6 the guard acts, and nothing is below", async () => {
    const r = await report(
      'scan',
      weak,
      '--policy',
      policyWith({ action: 'redact', minConfidence: 0.6 }),
    )
    expect(r.entities.CREDIT_CARD).toBe(2)
    expect(r.belowThreshold.entities).toEqual({})
  })

  it('agrees with the guard on the default threshold', async () => {
    // No minConfidence: guard and report must both use the same default, or a
    // value would be counted in both places or neither.
    const r = await report('scan', weak, '--policy', policyWith({ action: 'redact' }))
    expect(r.entities.CREDIT_CARD).toBe(0)
    expect(r.belowThreshold.entities.CREDIT_CARD?.threshold).toBe(0.95)
  })

  it('leaves out an entity the policy ignores', async () => {
    const ignoring = file(
      JSON.stringify({ entitySet: '0.1', onUnmapped: 'ignore', entities: {} }),
      '.json',
    )
    expect((await report('scan', weak, '--policy', ignoring)).belowThreshold.entities).toEqual({})
  })

  it('says so for a person, without the value', async () => {
    const { stdout, code } = await cli('scan', weak)
    expect(stdout).toContain('below the confidence threshold')
    expect(stdout).toContain('CREDIT_CARD  2  (confidence 0.6, threshold 0.95)')
    expect(stdout).not.toContain(WEAK_CARD)
    // The phone was acted on; that, not the weak cards, is what sets the exit code.
    expect(code).toBe(EXIT.FOUND)
  })

  it('does not change the exit code on its own', async () => {
    const onlyWeak = file(jsonl({ text: `เลข ${WEAK_CARD}` }))
    expect((await cli('scan', onlyWeak)).code).toBe(EXIT.CLEAN)
  })
})

describe('on a runtime without globalThis.crypto (stock Node 18)', () => {
  it('still scans with a tokenising policy', async () => {
    // What createGuard sees on Node 18; the CLI must supply its own source.
    vi.stubGlobal('crypto', undefined)
    try {
      const r = await report('scan', CHATS, '--policy', POLICY)
      expect(r.actions).toMatchObject({ tokenise: 1 })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
