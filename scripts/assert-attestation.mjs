#!/usr/bin/env node
// Every fixture must be listed in fixtures/ATTESTATION.md by a contributor who
// confirmed it contains no real personal data.
//
// The self-scan (running our own detectors over fixtures/) arrives in week 5
// when the detectors exist. This register is the part that works today.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const FIXTURES = resolve(ROOT, 'fixtures')
const REGISTER = resolve(FIXTURES, 'ATTESTATION.md')

if (!existsSync(REGISTER)) {
  process.stderr.write('assert-attestation: fixtures/ATTESTATION.md is missing\n')
  process.exit(1)
}
const register = readFileSync(REGISTER, 'utf8')

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (name !== 'ATTESTATION.md') files.push(p)
  }
}
walk(FIXTURES)

const missing = files.map((f) => relative(FIXTURES, f)).filter((rel) => !register.includes(rel))

if (missing.length > 0) {
  process.stderr.write(
    `\nassert-attestation FAILED — not listed in fixtures/ATTESTATION.md:\n${missing
      .map((f) => `  - ${f}`)
      .join('\n')}\n\n`,
  )
  process.exit(1)
}
process.stdout.write(`assert-attestation ok (${files.length} fixtures)\n`)
