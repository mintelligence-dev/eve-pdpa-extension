// Fixtures that need exact bytes (windows-874, a BOM, CRLF, tabs, a zip) or many rows.
// Scripts may only write to out/, so they land in out/cli-fixtures/. Run this before the CLI cases.
//   bench/user/run cli-checks/make-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs'

const dir = 'out/cli-fixtures'
mkdirSync(dir, { recursive: true })

/** windows-874 (TIS-620 + Microsoft's extras): ASCII as is, Thai U+0E01..U+0E5B → 0xA1..0xFB. */
function windows874(text) {
  const bytes = []
  for (const ch of text) {
    const c = ch.codePointAt(0)
    if (c < 0x80) bytes.push(c)
    else if (c >= 0x0e01 && c <= 0x0e5b) bytes.push(c - 0x0e01 + 0xa1)
    else throw new Error(`not in windows-874: ${ch}`)
  }
  return Buffer.from(bytes)
}

// Thai Excel "CSV" export: windows-874, CRLF. The cue word only survives if the encoding is right.
writeFileSync(
  `${dir}/excel-874.csv`,
  windows874('id,text\r\nw1,โอนเข้าเลขบัญชี 123-4-56789-0 ค่ะ\r\nw2,สวัสดีค่ะ\r\n'),
)
// Excel "CSV UTF-8": a BOM before the header — the id column must still be found.
writeFileSync(`${dir}/bom.csv`, '﻿id,text\nb1,เบอร์ 089-123-4567\nb2,สวัสดีค่ะ\n')
// CRLF line ends, and a quoted field with a CRLF inside it.
writeFileSync(
  `${dir}/crlf.csv`,
  'id,text\r\nc1,เบอร์ 089-123-4567\r\nc2,"สองบรรทัด\r\nโทร 02-123-4567"\r\nc3,ขอบคุณค่ะ\r\n',
)
// TSV
writeFileSync(
  `${dir}/chats.tsv`,
  'id\ttext\nt1\tเบอร์ 089-123-4567 ค่ะ\nt2\tสวัสดี, มีของไหม\nt3\tเมล nok.pattra@gmail.com\n',
)
// An empty but valid zip archive (end-of-central-directory record only).
writeFileSync(`${dir}/chats.zip`, Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]))
// 25 messages with a phone each: the human report shows the first 20, --json all of them.
const rows = [
  'id,text',
  ...Array.from(
    { length: 25 },
    (_, i) =>
      `f${String(i + 1).padStart(2, '0')},เบอร์ 08${String(10000000 + i * 7919).slice(0, 8)} ค่ะ`,
  ),
]
writeFileSync(`${dir}/first20.csv`, rows.join('\n') + '\n')
// A file that is not valid UTF-8 and is not Thai either (random bytes in a .jsonl).
writeFileSync(
  `${dir}/binary.jsonl`,
  Buffer.from([0x7b, 0x22, 0x74, 0x65, 0x78, 0x74, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22, 0x7d, 0x0a]),
)

console.log(
  `wrote ${dir}/: excel-874.csv bom.csv crlf.csv chats.tsv chats.zip first20.csv binary.jsonl`,
)
