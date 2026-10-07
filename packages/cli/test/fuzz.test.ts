import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { main } from '../src/cli.js'
import { dir } from './helpers.js'

/**
 * Files nobody would write on purpose. Whatever goes in, the CLI must not
 * crash: an uncaught error makes Node exit 1, which is the code for "personal
 * data found". Every run ends in one of the four codes it documents.
 */

// Seeded so a failure can be replayed.
let seed = 12345
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T

const PIECES = [
  ',',
  '"',
  '""',
  '\n',
  '\r\n',
  '\r',
  '\t',
  '{',
  '}',
  '[',
  ']',
  ':',
  '\\',
  '\\"',
  'text',
  'id',
  '"text"',
  '"id"',
  'ชื่อบัญชี',
  'ประเภทผู้ส่ง',
  'ข้อความ',
  'User',
  'Account',
  'เบอร์ 0918887777',
  '๐๙๑๘๘๘๗๗๗๗',
  '3-1005-00123-45-8',
  'a@b.co',
  '\u0000',
  '﻿',
  '​',
  '🙂',
  'null',
  'true',
  '1e999',
  '-0',
  ' ',
  "'",
  '=cmd',
  'เลขบัญชี 123-4-56789-0',
]

function randomText(len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += pick(PIECES)
  return s
}

const EXTS = ['.csv', '.tsv', '.jsonl', '.ndjson']
const EXTRA_ARGS = [[], ['--json'], ['--format', 'line-oa'], ['--text-field', 'ข้อความ']]

let fileNo = 0
const fuzzDir = join(dir, 'fuzz')
mkdirSync(fuzzDir, { recursive: true })

async function run(content: string | Uint8Array, ext: string, extra: string[] = []) {
  const path = join(fuzzDir, `z${fileNo++}${ext}`)
  writeFileSync(path, content)
  let out = ''
  const code = await main(['scan', path, ...extra], {
    stdout: (t) => {
      out += t
    },
    stderr: (t) => {
      out += t
    },
  })
  return { code, out, path }
}

describe('files nobody would write on purpose', () => {
  it('2,000 random text files: never throws, always a known exit code', async () => {
    for (let i = 0; i < 2000; i++) {
      const { code } = await run(randomText(Math.floor(rnd() * 200)), pick(EXTS), pick(EXTRA_ARGS))
      expect([0, 1, 2, 3]).toContain(code)
    }
  }, 120_000)

  it('500 random byte files', async () => {
    for (let i = 0; i < 500; i++) {
      const bytes = Uint8Array.from({ length: Math.floor(rnd() * 500) }, () =>
        Math.floor(rnd() * 256),
      )
      const { code } = await run(bytes, pick(EXTS), pick(EXTRA_ARGS))
      expect([0, 1, 2, 3]).toContain(code)
    }
  }, 120_000)

  it('edge shapes', async () => {
    const cases: [string, string | Uint8Array, string][] = [
      ['empty', '', '.csv'],
      ['empty jsonl', '', '.jsonl'],
      ['only BOM', '﻿', '.csv'],
      ['only newlines', '\n\n\r\n\n', '.jsonl'],
      ['header only', 'id,text', '.csv'],
      [
        '10k columns',
        `${Array.from({ length: 10000 }, (_, i) => `c${i}`).join(',')},text\n${','.repeat(10000)}เบอร์ 0918887777`,
        '.csv',
      ],
      [
        'deep JSON nesting',
        `{"text":"x","a":${'['.repeat(100000)}${']'.repeat(100000)}}`,
        '.jsonl',
      ],
      // Few findings on purpose: thousands in one message is slow in core today
      // (time grows with the square of the count) — see progress.th.md.
      [
        '5 MB single message',
        JSON.stringify({ text: `${'ก'.repeat(5_000_000)} เบอร์ 0918887777` }),
        '.jsonl',
      ],
      ['5 MB unclosed quote', `id,text\n1,"${'ก'.repeat(5_000_000)}`, '.csv'],
      ['NUL bytes', 'id,text\n1,\u0000\u0000เบอร์ 0918887777\u0000', '.csv'],
      ['text is object', JSON.stringify({ text: { a: 1 } }), '.jsonl'],
      ['line-oa preamble, no header', 'ชื่อบัญชี,x\n'.repeat(50), '.csv'],
      ['line-oa header only', 'ชื่อบัญชี,x\nประเภทผู้ส่ง,ชื่อผู้ส่ง,วันส่ง,เวลาส่ง,ข้อความ\n', '.csv'],
    ]
    for (const [name, content, ext] of cases) {
      const { code } = await run(content, ext)
      expect([0, 1, 2, 3], name).toContain(code)
    }
  }, 120_000)

  it('a directory named like a CSV — once crashed the LINE OA check', async () => {
    const d = join(fuzzDir, 'adir.csv')
    mkdirSync(d)
    let out = ''
    const code = await main(['scan', d], { stdout: (t) => (out += t), stderr: (t) => (out += t) })
    expect(code).toBe(2)
    expect(out).toContain('not a file')
  })
})
