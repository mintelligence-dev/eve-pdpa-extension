#!/usr/bin/env node
// Runs the built artifact on every runtime core claims to support.
//
// Fails if any runtime fails. A skipped runtime is reported loudly and also
// fails, because a green tick that means "not tested" is the exact kind of
// false confidence this project exists to remove. Use --allow-missing locally
// if you have not installed everything yet.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SMOKE = resolve(ROOT, 'packages/core/smoke/run.mjs')
const BIN = resolve(ROOT, 'node_modules/.bin')
const allowMissing = process.argv.includes('--allow-missing')

if (!existsSync(resolve(ROOT, 'packages/core/dist/index.js'))) {
  process.stderr.write('smoke: packages/core/dist not found — run build first\n')
  process.exit(1)
}

const runtimes = [
  { name: 'node', cmd: process.execPath, args: [SMOKE] },
  // No -A and no --allow-* on purpose. Deno halts on any filesystem, network,
  // env or subprocess access, which proves C4 and most of C5 in one line.
  { name: 'deno', cmd: resolve(BIN, 'deno'), args: ['run', SMOKE] },
  { name: 'bun', cmd: resolve(BIN, 'bun'), args: [SMOKE] },
  { name: 'workerd', cmd: process.execPath, args: [resolve(ROOT, 'scripts/smoke-workerd.mjs')] },
  { name: 'chromium', cmd: process.execPath, args: [resolve(ROOT, 'scripts/smoke-browser.mjs')] },
]

let failed = 0
for (const rt of runtimes) {
  if (rt.cmd !== process.execPath && !existsSync(rt.cmd)) {
    process.stdout.write(`  ${rt.name.padEnd(9)} MISSING — not installed\n`)
    if (!allowMissing) failed++
    continue
  }
  const r = spawnSync(rt.cmd, rt.args, { cwd: ROOT, encoding: 'utf8' })
  if (r.status === 0) {
    process.stdout.write(
      `  ${rt.name.padEnd(9)} ok   ${(r.stdout || '').trim().split('\n').pop() ?? ''}\n`,
    )
  } else {
    failed++
    process.stdout.write(`  ${rt.name.padEnd(9)} FAIL\n`)
    process.stderr.write(`${(r.stderr || r.stdout || '(no output)').trim()}\n`)
  }
}

if (failed > 0) {
  process.stderr.write(`\nsmoke FAILED on ${failed} runtime(s)\n`)
  process.exit(1)
}
process.stdout.write('smoke ok on every runtime\n')
