import { describe, expect, it } from 'vitest'
import { EXIT } from '../src/cli.js'
import { cli, file, jsonl, report } from './helpers.js'

const csv = (...rows: string[]) => file(rows.join('\r\n'), '.csv')

/** Thai as windows-874 (TIS-620 range): U+0E01–U+0E5B map to 0xA1–0xFB; ASCII is itself. */
function windows874(text: string): Uint8Array {
  return Uint8Array.from(
    [...text].map((ch) => {
      const c = ch.codePointAt(0) as number
      return c >= 0x0e01 && c <= 0x0e5b ? c - 0x0e01 + 0xa1 : c
    }),
  )
}

describe('CSV', () => {
  it('finds the message column by its header, wherever it is', async () => {
    const f = csv('customer,text,id', 'ลูกค้า A,เบอร์ 0918887777,m1', 'ลูกค้า B,สวัสดี,m2')
    const r = await report('scan', f)
    expect(r.format).toBe('csv')
    expect(r.records).toEqual({ scanned: 2, withFindings: 1, blocked: 0, unreadable: 0 })
    expect(r.hits).toEqual([{ line: 2, id: 'm1', entities: ['PHONE'] }])
  })

  it('reads quoted fields: the delimiter, doubled quotes and line breaks inside them', async () => {
    const f = csv(
      'id,text',
      'm1,"สวัสดี, ""ร้าน"" ครับ"',
      'm2,"เบอร์\n091-888-7777\nโทรกลับ"',
      'm3,"บัตร 3-1005-00123-45-8"',
    )
    const r = await report('scan', f)
    expect(r.records.unreadable).toBe(0)
    // m2 starts on line 3 and runs to line 5, so m3 is on line 6.
    expect(r.hits).toEqual([
      { line: 3, id: 'm2', entities: ['PHONE'] },
      { line: 6, id: 'm3', entities: ['TH_NATIONAL_ID'] },
    ])
  })

  it('reports a row with the wrong number of fields, and scans the rest', async () => {
    const f = csv('id,customer,text', 'm1,ลูกค้า,เบอร์ 0918887777, ส่งด่วน', 'm2,ลูกค้า,เบอร์ 0918887777')
    const r = await report('scan', f)
    expect(r.unreadable).toEqual([{ line: 2, problem: '4 fields, header has 3' }])
    expect(r.hits.map((h) => h.id)).toEqual(['m2'])
  })

  it('reports a quoted field the file never closes', async () => {
    const r = await report('scan', csv('id,text', 'm1,สวัสดี', 'm2,"เบอร์ 0918887777'))
    expect(r.unreadable).toEqual([{ line: 3, problem: 'quoted field never closed' }])
  })

  it('never puts a value in the report, even from a row it could not read', async () => {
    const f = csv(
      'id,text',
      'm1,"เบอร์ 091-888-7777"',
      'm2,0918887777,extra',
      'm3,"somchai@example.com',
    )
    for (const extra of [[], ['--json']]) {
      const { stdout, stderr } = await cli('scan', f, ...extra)
      for (const v of ['091-888-7777', '0918887777', 'somchai@example.com']) {
        expect(stdout + stderr).not.toContain(v)
      }
    }
  })

  it('skips blank rows, including the empty ones a spreadsheet leaves at the end', async () => {
    const r = await report('scan', csv('id,text', '', 'm1,สวัสดี', ',', ',', ''))
    expect(r.records).toMatchObject({ scanned: 1, unreadable: 0 })
  })

  it('copes with a BOM, which Excel writes on "CSV UTF-8"', async () => {
    const r = await report('scan', file('﻿id,text\nm1,เบอร์ 0918887777\n', '.csv'))
    expect(r.hits).toEqual([{ line: 2, id: 'm1', entities: ['PHONE'] }])
  })

  it('gives null for an empty id, and no ids at all when there is no id column', async () => {
    const r = await report('scan', csv('id,text', ',เบอร์ 0918887777'))
    expect(r.hits[0]?.id).toBeNull()
    const noId = await report('scan', csv('text', 'เบอร์ 0918887777'))
    expect(noId.hits[0]?.id).toBeNull()
  })

  it('reads the columns it is told to', async () => {
    const f = csv('msg_id,message', 'a1,เบอร์ 0918887777')
    const r = await report('scan', f, '--text-field', 'message', '--id-field', 'msg_id')
    expect(r.hits).toEqual([{ line: 2, id: 'a1', entities: ['PHONE'] }])
  })

  it('reads a file far larger than one read chunk, with quotes and line breaks across the seams', async () => {
    // 64 KB chunks; ~600 KB of rows whose quoted fields fall on every possible offset.
    const rows = ['id,text']
    for (let i = 0; i < 4000; i++) {
      const pad = 'ก'.repeat(i % 37)
      rows.push(i % 3 === 0 ? `m${i},"${pad} ""ok"",\nเบอร์ 0918887777"` : `m${i},${pad} สวัสดี`)
    }
    const r = await report('scan', csv(...rows))
    expect(r.records).toEqual({ scanned: 4000, withFindings: 1334, blocked: 0, unreadable: 0 })
    expect(r.hits.at(-1)).toMatchObject({ id: 'm3999' })
  })

  it('reads TSV, where a comma is just a character', async () => {
    const f = file('id\ttext\nm1\tสวัสดี, เบอร์ 0918887777\n', '.tsv')
    const r = await report('scan', f)
    expect(r.format).toBe('tsv')
    expect(r.hits).toEqual([{ line: 2, id: 'm1', entities: ['PHONE'] }])
  })
})

describe('CSV that cannot be scanned at all — exit 2, with a reason', () => {
  it('has no message column, and says which columns it does have', async () => {
    const r = await cli('scan', csv('customer,message', 'A,สวัสดี'))
    expect(r.code).toBe(EXIT.USAGE)
    expect(r.stderr).toContain('no column "text"')
    expect(r.stderr).toContain('customer, message')
  })

  it('lacks an id column the user named — the default id column may be missing', async () => {
    expect((await cli('scan', csv('text', 'สวัสดี'))).code).toBe(EXIT.CLEAN)
    const r = await cli('scan', csv('text', 'สวัสดี'), '--id-field', 'msg_id')
    expect(r.code).toBe(EXIT.USAGE)
    expect(r.stderr).toContain('no column "msg_id"')
  })

  it('is empty', async () => {
    expect((await cli('scan', file('', '.csv'))).code).toBe(EXIT.USAGE)
  })
})

describe('encoding', () => {
  const thaiExcel = () => file(windows874('id,text\nm1,เลขบัญชี 123-4-56789-0\n'), '.csv')

  it('refuses a file that is not UTF-8 instead of losing its Thai words, and says what to try', async () => {
    const r = await cli('scan', thaiExcel())
    expect(r.code).toBe(EXIT.USAGE)
    expect(r.stderr).toContain('--encoding windows-874')
  })

  it('reads windows-874 when told to — and the Thai cue word finds the account', async () => {
    const r = await report('scan', thaiExcel(), '--encoding', 'windows-874')
    expect(r.hits).toEqual([{ line: 2, id: 'm1', entities: ['BANK_ACCOUNT'] }])
  })

  it('applies to JSONL too', async () => {
    const f = file(windows874(jsonl({ text: 'เลขบัญชี 123-4-56789-0' })))
    expect((await cli('scan', f)).code).toBe(EXIT.USAGE)
    expect((await report('scan', f, '--encoding', 'windows-874')).entities.BANK_ACCOUNT).toBe(1)
  })

  it('rejects an encoding it does not know', async () => {
    const r = await cli('scan', csv('text', 'สวัสดี'), '--encoding', 'klingon')
    expect(r.code).toBe(EXIT.USAGE)
    expect(r.stderr).toContain('unknown encoding')
  })
})
