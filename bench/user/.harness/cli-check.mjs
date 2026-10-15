// Runs bench/user/cli-checks/cases.json against the installed CLI and writes
// out/cli-report.md.
//
// A script under bench/user/run cannot start a process — Node's permission
// model stops it, which is the point. This is the one place a process is
// started for it, and each one runs inside the same sandbox as bench/user/cli.
//
// cli-checks/cases.json: { "cases": [{ "id", "args": [...], "exit"?, "stdoutIncludes"?: [...],
//                   "stdoutExcludes"?: [...], "stderrIncludes"?: [...], "note"? }] }
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DIR = resolve(import.meta.dirname, '..')
const CLI = 'node_modules/@thai-pdpa-guard/cli/dist/index.js'
const SANDBOX = ['--permission', `--allow-fs-read=${DIR}/*`, `--allow-fs-write=${DIR}/out/*`]

const parsed = JSON.parse(readFileSync(resolve(DIR, 'cli-checks/cases.json'), 'utf8'))
const cases = Array.isArray(parsed) ? parsed : parsed.cases
const inside = (a) => typeof a === 'string' && !a.includes('..') && !a.startsWith('/')
const lines = []
let failed = 0

for (const c of cases) {
  const problems = []
  let shown = ''
  if (!Array.isArray(c.args) || !c.args.every(inside)) {
    problems.push('args must be strings: flags and paths inside bench/user, no ..')
  } else {
    const r = spawnSync(process.execPath, [...SANDBOX, '--', CLI, ...c.args], {
      cwd: DIR,
      encoding: 'utf8',
      timeout: 30_000,
    })
    const stdout = r.stdout ?? ''
    const stderr = r.stderr ?? ''
    if (c.exit !== undefined && r.status !== c.exit)
      problems.push(`exit ${r.status}, expected ${c.exit}`)
    for (const s of c.stdoutIncludes ?? []) {
      if (!stdout.includes(s)) problems.push(`stdout lacks ${JSON.stringify(s)}`)
    }
    for (const s of c.stdoutExcludes ?? []) {
      if (stdout.includes(s)) problems.push(`stdout contains ${JSON.stringify(s)}`)
    }
    for (const s of c.stderrIncludes ?? []) {
      if (!stderr.includes(s)) problems.push(`stderr lacks ${JSON.stringify(s)}`)
    }
    shown = `exit ${r.status}\n--- stdout\n${stdout.slice(0, 1500)}\n--- stderr\n${stderr.slice(0, 500)}`
  }
  if (problems.length > 0) failed++
  lines.push(
    `## ${problems.length === 0 ? 'pass' : 'FAIL'} · ${c.id}`,
    '',
    `args: ${JSON.stringify(c.args)}`,
    ...(c.note ? [`note: ${c.note}`] : []),
    ...problems.map((p) => `- **${p}**`),
    '',
    '```',
    shown,
    '```',
    '',
  )
}

const summary = `${cases.length} cases · ${cases.length - failed} pass · ${failed} fail`
mkdirSync(resolve(DIR, 'out'), { recursive: true })
writeFileSync(
  resolve(DIR, 'out/cli-report.md'),
  [`# CLI checks`, '', summary, '', ...lines].join('\n'),
)
console.log(`${summary}\nreport: bench/user/out/cli-report.md`)
process.exitCode = failed > 0 ? 1 : 0
