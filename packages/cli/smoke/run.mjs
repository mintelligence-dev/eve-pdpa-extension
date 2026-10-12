// Runs the built cli (dist/index.js) as a user would: a child process, real
// files, exit codes. CI runs it on every Node major the cli claims, and on the
// lowest version engines allows, with no install — so this file may use only
// what Node 18.18.0 has (no import.meta.dirname, no fs.glob).
//
// The paths that differ between Node versions are the ones exercised here:
//   - parseArgs with defaults (node:util)
//   - randomSource from node:crypto, which core needs on stock Node 18
//   - TextDecoder('windows-874'), which needs a Node built with full ICU
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BIN = fileURLToPath(new URL('../dist/index.js', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'pdpa-cli-smoke-'))

// Synthetic values only; the id passes its checksum.
const VALUES = ['091-888-7777', '3-1005-00123-45-8', 'somchai@example.com']

const jsonl = (...records) => records.map((r) => JSON.stringify(r)).join('\n')
let fileNo = 0
function file(content, ext) {
  const path = join(dir, `f${fileNo++}${ext}`)
  writeFileSync(path, content)
  return path
}

/** Thai as windows-874 (TIS-620 range): U+0E01–U+0E5B map to 0xA1–0xFB; ASCII is itself. */
function windows874(text) {
  return Uint8Array.from(
    [...text].map((ch) => {
      const c = ch.codePointAt(0)
      return c >= 0x0e01 && c <= 0x0e5b ? c - 0x0e01 + 0xa1 : c
    }),
  )
}

function cli(...args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })
  if (r.error) throw r.error
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

function expectCode(r, want, what) {
  if (r.code !== want) {
    throw new Error(`${what}: exit ${r.code}, want ${want}\n${r.stderr}`)
  }
}

function json(r, what) {
  try {
    return JSON.parse(r.stdout)
  } catch {
    throw new Error(`${what}: stdout is not JSON\n${r.stdout}\n${r.stderr}`)
  }
}

const CHATS = file(
  jsonl(
    { id: 'msg_1', text: 'สวัสดีครับ สั่งของได้ไหม' },
    { id: 'msg_2', text: 'เบอร์ 091-888-7777 นะครับ' },
    { id: 'msg_3', text: 'บัตร 3-1005-00123-45-8 อีเมล somchai@example.com' },
  ),
  '.jsonl',
)
const CLEAN = file(jsonl({ id: 'msg_1', text: 'สวัสดีครับ' }), '.jsonl')
const POLICY = file(
  JSON.stringify({
    entitySet: '0.1',
    entities: {
      PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'] },
      TH_NATIONAL_ID: { action: 'block' },
      EMAIL: { action: 'hash' },
    },
  }),
  '.json',
)
const THAI_EXCEL = file(windows874('id,text\nm1,เลขบัญชี 123-4-56789-0\n'), '.csv')

try {
  expectCode(cli('--version'), 0, '--version')

  const found = cli('scan', CHATS, '--json')
  expectCode(found, 1, 'scan with personal data')
  const r = json(found, 'scan with personal data')
  if (r.entities.PHONE !== 1 || r.entities.TH_NATIONAL_ID !== 1 || r.entities.EMAIL !== 1) {
    throw new Error(`scan counted the wrong entities: ${JSON.stringify(r.entities)}`)
  }

  expectCode(cli('scan', CLEAN), 0, 'scan with nothing to find')

  // tokenise and hash draw on randomSource, which stock Node 18 must get from node:crypto.
  const withPolicy = cli('scan', CHATS, '--policy', POLICY, '--json')
  expectCode(withPolicy, 1, 'scan with a policy')
  const actions = json(withPolicy, 'scan with a policy').actions
  if (actions?.tokenise !== 1 || actions.block !== 1 || actions.hash !== 1) {
    throw new Error(`policy actions are wrong: ${JSON.stringify(actions)}`)
  }

  for (const out of [found, withPolicy, cli('scan', CHATS, '--policy', POLICY)]) {
    for (const v of VALUES) {
      if (out.stdout.includes(v) || out.stderr.includes(v)) throw new Error(`report leaked ${v}`)
    }
  }

  const excel = cli('scan', THAI_EXCEL, '--encoding', 'windows-874', '--json')
  expectCode(excel, 1, 'scan a windows-874 csv')
  if (json(excel, 'scan a windows-874 csv').entities.BANK_ACCOUNT !== 1) {
    throw new Error('windows-874 csv: bank account not found')
  }

  expectCode(cli('policy', 'validate', POLICY), 0, 'policy validate')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(`cli ok on node ${process.version}`)
