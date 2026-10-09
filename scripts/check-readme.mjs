// Runs the examples in the package READMEs against the packed tarballs, in a
// project outside the repo — the way someone who copies them will run them.
//
// The README is the first code most users run, and nothing else tests it.
// Before this existed, the quick start used a hard-coded token (resolve:
// not_found on every copy), the Redis example did not import createGuard and
// lost long-lived tokens on endSession, and the CLI promised Node 18 but
// could not run a tokenising policy there. Each was found by hand.
//
// Checks, for each README in Thai and English:
//   core  the policy block passes policy.schema.json and parsePolicy loads it
//         every TypeScript block typechecks under strict, against the packed
//         package and real redis types
//         the quick start runs, and every `expression // 'value'` comment in it
//         is asserted (token ids, which are random, match by shape)
//   cli   every `$ thai-pdpa-guard …` block prints exactly what it shows,
//         on this Node and on Node 18.18 (the oldest the README promises)
//
// Node 18 comes from `npx node@18.18.0`, downloaded once into npx's cache.

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import { packAll } from './assert-tarballs.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const NODE18 = '18.18.0'
const results = []
const ok = (name, pass, detail = '') => results.push({ name, pass, detail })

const blocks = (file) =>
  [...readFileSync(join(ROOT, file), 'utf8').matchAll(/```(\w*)\n([\s\S]*?)```/g)].map(
    ([, lang, code]) => ({ lang, code }),
  )

// ---- a project outside the repo, with the tarballs installed --------------

const tarballs = packAll()
const app = mkdtempSync(join(tmpdir(), 'pdpa-readme-'))
const modules = join(app, 'node_modules')
for (const [name, tarball] of Object.entries(tarballs)) {
  const dir = join(modules, '@thai-pdpa-guard', name)
  mkdirSync(dir, { recursive: true })
  execFileSync('tar', ['-xzf', tarball, '-C', dir, '--strip-components=1'])
}
// Types and the Redis client the examples import, borrowed from the repo.
mkdirSync(join(modules, '@types'), { recursive: true })
symlinkSync(join(ROOT, 'node_modules/@types/node'), join(modules, '@types/node'))
symlinkSync(join(ROOT, 'node_modules/redis'), join(modules, 'redis'))
writeFileSync(join(app, 'package.json'), '{ "type": "module" }\n')

const TSC = join(ROOT, 'node_modules/.bin/tsc')
function typecheck(file) {
  const r = spawnSync(
    TSC,
    [
      '--noEmit',
      '--strict',
      '--module',
      'nodenext',
      '--moduleResolution',
      'nodenext',
      '--target',
      'es2022',
      '--skipLibCheck',
      '--types',
      'node',
      file,
    ],
    { cwd: app, encoding: 'utf8' },
  )
  return r.status === 0 ? '' : r.stdout.trim().split('\n')[0]
}

// ---- core ------------------------------------------------------------------

const ajv = new Ajv2020({ strict: false, validateFormats: false })
const policySchema = JSON.parse(
  readFileSync(join(modules, '@thai-pdpa-guard/core/schema/policy.schema.json'), 'utf8'),
)
const { parsePolicy } = await import(join(modules, '@thai-pdpa-guard/core/dist/index.js'))

/** `inbound.text   // 'value'` → an assertion. Token ids are random: matched by shape. */
function withAssertions(code) {
  const lines = code.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const inline = /^([\w.]+(?: && [\w.]+)?)\s+\/\/ '([^']*)'/.exec(line)
    const next = /^\/\/ text: '([^']*)'/.exec(lines[i + 1] ?? '')
    if (inline) {
      out.push(
        `__check(${JSON.stringify(line.trim())}, ${inline[1]}, ${JSON.stringify(inline[2])})`,
      )
    } else if (next && /^await guard\.process\(/.test(line)) {
      out.push(
        `__check(${JSON.stringify(line.trim())}, (${line.trim()}).text, ${JSON.stringify(next[1])})`,
      )
      i++
    } else {
      out.push(line)
    }
  }
  return out.join('\n')
}

const CHECK = `
const __fails: string[] = []
function __check(where: string, got: unknown, want: string): void {
  const shape = new RegExp('^' + want.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&').replace(/tok:[a-z]{16}/g, 'tok:[bcdfghjkmnpqrstv]{16}') + '$')
  if (!shape.test(String(got))) __fails.push(where + ' → ' + JSON.stringify(got) + ', README says ' + JSON.stringify(want))
}
`

for (const readme of ['packages/core/README.md', 'packages/core/README.th.md']) {
  const bs = blocks(readme)

  const policy = bs.find((b) => b.lang === 'json' && b.code.includes('"entitySet"'))
  writeFileSync(join(app, 'pdpa-policy.json'), policy.code)
  const policyJson = JSON.parse(policy.code)
  ok(
    `${readme}: policy passes policy.schema.json`,
    ajv.validate(policySchema, policyJson),
    ajv.errorsText(),
  )
  let loads = true
  try {
    parsePolicy(policy.code)
  } catch {
    loads = false
  }
  ok(`${readme}: parsePolicy loads the policy`, loads)

  const ts = bs.filter((b) => b.lang === 'ts')
  const quick = ts.find((b) => b.code.includes('parsePolicy(readFileSync'))
  const context = ts.find((b) => b.code.startsWith("await guard.process('123-4-56789-0'"))
  const redis = ts.find((b) => b.code.includes('TokenStore'))

  const quickFile = join(app, 'quickstart.ts')
  writeFileSync(
    quickFile,
    `${CHECK}\n${withAssertions(`${quick.code}\n${context.code}`)}\nif (__fails.length) { console.error(__fails.join('\\n')); process.exit(1) }\n`,
  )
  const qt = typecheck('quickstart.ts')
  ok(`${readme}: quick start + context typecheck`, qt === '', qt)
  const run = spawnSync(process.execPath, ['quickstart.ts'], {
    cwd: app,
    encoding: 'utf8',
    env: { ...process.env, PDPA_HMAC_KEY: 'k'.repeat(64) },
  })
  ok(`${readme}: quick start + context run as written`, run.status === 0, run.stderr.trim())

  // The Redis block leans on names from the rest of the README; declare them.
  const imports = redis.code.split('\n').filter((l) => l.startsWith('import '))
  const body = redis.code.split('\n').filter((l) => !l.startsWith('import '))
  writeFileSync(
    join(app, 'redis.ts'),
    [
      ...imports,
      "import { definePolicy } from '@thai-pdpa-guard/core'",
      "const policy = definePolicy({ entitySet: '0.1', entities: {} })",
      'const onAudit = () => {}',
      "const text = ''",
      "const sessionId = 'conv_1'",
      ...body,
    ].join('\n'),
  )
  const rt = typecheck('redis.ts')
  ok(`${readme}: Redis TokenStore typechecks against redis@4`, rt === '', rt)
}

// ---- cli -------------------------------------------------------------------

// Inputs the CLI examples read. chats.csv is the README's own; the policy is
// core's; the other two are described in the README, not printed in it.
writeFileSync(
  join(app, 'excel.csv'),
  Buffer.from(
    [...'id,text\nm1,เลขบัญชี 123-4-56789-0\n'].map((ch) => {
      const c = ch.codePointAt(0)
      return c >= 0x0e01 && c <= 0x0e5b ? c - 0x0e01 + 0xa1 : c
    }),
  ),
)
writeFileSync(
  join(app, '3_20261001_20261007_สมชาย ตัวอย่าง.csv'),
  [
    'ชื่อบัญชี,ร้านตัวอย่าง',
    "ไทม์โซน,'+07:00",
    'วันดาวน์โหลด,2026/10/07 15:23',
    'ประเภทผู้ส่ง,ชื่อผู้ส่ง,วันส่ง,เวลาส่ง,ข้อความ',
    "User,'สมชาย ตัวอย่าง,2026/10/07,13:23:47,สวัสดีครับ",
    "User,'สมชาย ตัวอย่าง,2026/10/07,13:24:08,เบอร์ผม 091-888-7777 ครับ",
    'Account,แอดมินเอ,2026/10/07,13:27:01,ส่ง OTP ไปที่ 091-888-7777 แล้วครับ',
  ].join('\r\n'),
)

const CLI = join(modules, '@thai-pdpa-guard/cli/dist/index.js')
const lines = (s) => s.split('\n').filter((l) => l.trim() !== '')

function cli(node, args) {
  const r =
    node === 'current'
      ? spawnSync(process.execPath, [CLI, ...args], { cwd: app, encoding: 'utf8' })
      : spawnSync('npx', ['--yes', `node@${NODE18}`, CLI, ...args], { cwd: app, encoding: 'utf8' })
  return lines(r.stdout + r.stderr)
}

for (const readme of ['packages/cli/README.md', 'packages/cli/README.th.md']) {
  const bs = blocks(readme)
  writeFileSync(join(app, 'chats.csv'), bs.find((b) => b.lang === 'csv').code)
  for (const { lang, code } of bs) {
    if (lang !== '') continue
    const parts = code.split(/^\$ (thai-pdpa-guard .*)$/m)
    for (let i = 1; i < parts.length; i += 2) {
      const args = [...parts[i].matchAll(/"[^"]*"|\S+/g)]
        .map((m) => m[0].replace(/^"|"$/g, ''))
        .slice(1)
      const want = lines(parts[i + 1])
      for (const node of ['current', NODE18]) {
        const got = cli(node, args)
        // `...` in the README elides the top of the report; check what follows it.
        const pass = want.includes('...')
          ? want.slice(want.indexOf('...') + 1).every((l) => got.includes(l))
          : want.length === 0 || want.join('\n') === got.join('\n')
        const first = want.find((l, k) => l !== got[k])
        ok(
          `${readme}: $ ${parts[i]}  [node ${node === 'current' ? process.versions.node : node}]`,
          pass,
          pass
            ? ''
            : `README: ${first ?? '(nothing)'}\n      got:    ${got[want.indexOf(first)] ?? '(nothing)'}`,
        )
      }
    }
  }
}

// ---- report ----------------------------------------------------------------

const failed = results.filter((r) => !r.pass)
for (const r of failed) process.stderr.write(`  FAIL ${r.name}\n      ${r.detail}\n`)
if (failed.length > 0) {
  process.stderr.write(`check-readme: ${failed.length} of ${results.length} failed\n`)
  process.exit(1)
}
process.stdout.write(`check-readme ok (${results.length} checks)\n`)
