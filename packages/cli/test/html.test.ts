import { describe, expect, it } from 'vitest'
import { EXIT } from '../src/cli.js'
import { cli, file, jsonl } from './helpers.js'

const VALUES = [
  '091-888-7777',
  '0918887777',
  '3-1005-00123-45-8',
  '3100500123458',
  'somchai@example.com',
]

const CHATS = file(
  [
    jsonl({ id: 'msg_1', text: 'สวัสดีครับ' }),
    jsonl({ id: 'msg_2', text: 'เบอร์ 091-888-7777 นะครับ' }),
    jsonl({
      id: '<script>alert(1)</script>',
      text: 'บัตร 3-1005-00123-45-8 อีเมล somchai@example.com',
    }),
    'not json {091-888-7777',
  ].join('\n'),
)

describe('scan --html', () => {
  it('prints one page and keeps the exit code of a plain scan', async () => {
    const { code, stdout } = await cli('scan', CHATS, '--html')
    expect(code).toBe(EXIT.FOUND)
    expect(stdout.startsWith('<!doctype html>')).toBe(true)
    expect(stdout).toContain('PHONE')
    expect(stdout).toContain('msg_2')
  })

  it('never holds a value, and loads nothing from outside', async () => {
    const { stdout } = await cli('scan', CHATS, '--html')
    for (const v of VALUES) expect(stdout).not.toContain(v)
    expect(stdout).not.toMatch(/<script|<img|<link|<iframe|\bsrc=|\bhref=|https?:\/\//i)
    expect(stdout).toContain("default-src 'none'")
  })

  it('escapes what came from the file', async () => {
    const { stdout } = await cli('scan', CHATS, '--html')
    expect(stdout).not.toContain('<script>alert(1)')
    expect(stdout).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('says nothing found without claiming the file is clean', async () => {
    const clean = file(jsonl({ id: 'a', text: 'สวัสดีครับ' }))
    const { code, stdout } = await cli('scan', clean, '--html')
    expect(code).toBe(EXIT.CLEAN)
    expect(stdout).toContain('Nothing found')
    expect(stdout).toContain('does not mean')
  })

  it('refuses --json together with --html', async () => {
    const { code, stderr } = await cli('scan', CHATS, '--json', '--html')
    expect(code).toBe(EXIT.USAGE)
    expect(stderr).toContain('cannot be used together')
  })

  it('right-aligns a number column with its header, and only that column', async () => {
    const { stdout } = await cli('scan', CHATS, '--html')
    expect(stdout).toContain('<th class="n">Values</th>')
    expect(stdout).toContain('<th class="n">Line</th>')
    expect(stdout).not.toContain('<th class="n">Type</th>')
    expect(stdout).not.toContain('<th class="n">Id</th>')
  })

  it('leaves out the Sender column when the file does not say who wrote each message', async () => {
    const { stdout } = await cli('scan', CHATS, '--html')
    expect(stdout).not.toContain('Sender')
  })

  it('shows the Sender column for a LINE OA export', async () => {
    const lineOa = file(
      [
        'ชื่อบัญชี,ร้านตัวอย่าง',
        "ไทม์โซน,'+07:00",
        'วันดาวน์โหลด,2026/10/07 15:23',
        'ประเภทผู้ส่ง,ชื่อผู้ส่ง,วันส่ง,เวลาส่ง,ข้อความ',
        "User,'สมชาย ตัวอย่าง,2026/10/07,13:23:47,เบอร์ผม 091-888-7777 ครับ",
        "Account,'แอดมินเอ,2026/10/07,13:24:47,ส่ง OTP ไปที่ 091-888-7777 แล้วครับ",
      ].join('\r\n'),
      '.csv',
    )
    const { stdout } = await cli('scan', lineOa, '--html')
    expect(stdout).toContain('<th>Sender</th>')
    expect(stdout).toContain('customer')
    expect(stdout).toContain('shop')
    expect(stdout).not.toContain('091-888-7777')
    expect(stdout).not.toContain('สมชาย')
  })
})
