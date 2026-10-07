import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXIT } from '../src/cli.js'
import { cli, dir, report } from './helpers.js'

/**
 * Shaped like a Thai-language LINE OA Manager export seen in 2025-09: a few
 * lines about the file, then the header, then one row per message. Every name
 * and value here is made up.
 */
const PREAMBLE = ['ชื่อบัญชี,ร้านตัวอย่าง', "ไทม์โซน,'+07:00", 'วันดาวน์โหลด,2026/10/07 15:23']
const HEADER = 'ประเภทผู้ส่ง,ชื่อผู้ส่ง,วันส่ง,เวลาส่ง,ข้อความ'
const CUSTOMER = 'สมชาย ตัวอย่าง'
const row = (who: 'User' | 'Account', name: string, text: string) =>
  `${who},'${name},2026/10/07,13:23:47,${text}`

let n = 0
/** Named the way the export names it: number, first and last day, the customer's LINE name. */
function exportFile(lines: string[], encode?: (s: string) => Uint8Array): string {
  const path = join(dir, `${++n}_20261001_20261007_${CUSTOMER}.csv`)
  const body = lines.join('\r\n')
  writeFileSync(path, encode === undefined ? body : encode(body))
  return path
}

const CHAT = exportFile([
  ...PREAMBLE,
  HEADER,
  row('Account', 'ข้อความตอบกลับอัตโนมัติ', '"ขอบคุณที่ทักมาครับ\nพิมพ์ 99 ได้เลย"'),
  row('User', CUSTOMER, 'สวัสดีครับ'),
  row('User', CUSTOMER, 'เบอร์ผม 091-888-7777 ครับ'),
  row('Account', 'แอดมินเอ', 'คุณส่งสติกเกอร์'),
  row('User', CUSTOMER, 'โอนเข้าเลขบัญชี 123-4-56789-0 แล้วนะครับ'),
  row('Account', 'แอดมินเอ', 'ส่ง OTP ไปที่ 091-888-7777 แล้วครับ'),
])

describe('LINE OA chat export', () => {
  it('is recognised from its first line, with no --format', async () => {
    expect((await report('scan', CHAT)).format).toBe('line-oa')
  })

  it('skips the lines about the file and reads from the header on', async () => {
    const r = await report('scan', CHAT)
    // Six messages; the shop's name and the export date are not among them.
    expect(r.records).toEqual({ scanned: 6, withFindings: 3, blocked: 0, unreadable: 0 })
    expect(r.entities).toMatchObject({ PHONE: 2, BANK_ACCOUNT: 1 })
  })

  it('says who wrote each message, and counts both sides', async () => {
    const r = await report('scan', CHAT)
    expect(r.hits).toEqual([
      { line: 8, id: null, entities: ['PHONE'], sender: 'customer' },
      { line: 10, id: null, entities: ['BANK_ACCOUNT'], sender: 'customer' },
      { line: 11, id: null, entities: ['PHONE'], sender: 'shop' },
    ])
    expect(r.senders).toEqual({
      customer: { scanned: 3, withFindings: 2, values: 2 },
      shop: { scanned: 3, withFindings: 1, values: 1 },
    })
  })

  it("never shows the customer's name — not from the file name, not from the sender column", async () => {
    for (const extra of [[], ['--json']]) {
      const { stdout, stderr } = await cli('scan', CHAT, ...extra)
      expect(stdout + stderr).not.toContain('สมชาย')
      expect(stdout + stderr).not.toContain('แอดมินเอ')
    }
    expect((await report('scan', CHAT)).file).toMatch(/^\d+_20261001_20261007_….csv$/)
  })

  it('shows the file as given when it is not named the way the export names it', async () => {
    const renamed = join(dir, 'chat-backup.csv')
    writeFileSync(renamed, [...PREAMBLE, HEADER, row('User', CUSTOMER, 'สวัสดี')].join('\n'))
    expect((await report('scan', renamed)).file).toBe(renamed)
  })

  it('reads an export in another language when told the message column', async () => {
    const english = exportFile([
      'Account name,Example shop',
      'Sender type,Sender name,Date,Time,Message',
      row('User', CUSTOMER, 'my number 0918887777'),
    ])
    const r = await report('scan', english, '--format', 'line-oa', '--text-field', 'Message')
    expect(r.hits).toEqual([{ line: 3, id: null, entities: ['PHONE'] }])
  })

  it('stops with a reason when there is no message column', async () => {
    const r = await cli('scan', exportFile([...PREAMBLE, 'a,b,c', 'x,y,z']), '--format', 'line-oa')
    expect(r.code).toBe(EXIT.USAGE)
    expect(r.stderr).toContain('no "ข้อความ" column')
  })

  it('reports a row with the wrong number of fields, by line', async () => {
    const r = await report(
      'scan',
      exportFile([...PREAMBLE, HEADER, 'User,x,2026/10/07,13:00:00,a,b']),
    )
    expect(r.unreadable).toEqual([{ line: 5, problem: '6 fields, header has 5' }])
  })

  it('is recognised in windows-874 once the encoding is given', async () => {
    const tis620 = (s: string) =>
      Uint8Array.from(
        [...s].map((ch) => {
          const c = ch.codePointAt(0) as number
          return c >= 0x0e01 && c <= 0x0e5b ? c - 0x0e01 + 0xa1 : c
        }),
      )
    const f = exportFile([...PREAMBLE, HEADER, row('User', 'A', 'เลขบัญชี 123-4-56789-0')], tis620)
    expect((await cli('scan', f)).code).toBe(EXIT.USAGE)
    const r = await report('scan', f, '--encoding', 'windows-874')
    expect(r.format).toBe('line-oa')
    expect(r.entities.BANK_ACCOUNT).toBe(1)
  })

  it('leaves an ordinary CSV alone', async () => {
    const plain = join(dir, 'plain.csv')
    writeFileSync(plain, 'id,text\nm1,สวัสดี\n')
    const r = await report('scan', plain)
    expect(r.format).toBe('csv')
    expect(r).not.toHaveProperty('senders')
  })
})
