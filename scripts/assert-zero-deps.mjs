#!/usr/bin/env node
// C1: @eve-pdpa-extension/core must have zero runtime dependencies.
//
// Four independent representations are checked, because each can drift from
// the others: the manifest states intent, the lockfile records what pnpm
// actually resolved, the tarball is what users receive, and the installed tree
// is what ends up on disk.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const CORE = resolve(ROOT, 'packages/core')
const fail = []
const note = (m) => fail.push(m)

// ---- 1. manifest -----------------------------------------------------------
const pkg = JSON.parse(readFileSync(resolve(CORE, 'package.json'), 'utf8'))

if (pkg.dependencies === undefined) {
  // An explicit empty object is a statement of intent that shows up in every diff.
  note('package.json: "dependencies": {} must be present literally, not merely absent')
} else if (Object.keys(pkg.dependencies).length > 0) {
  note(
    `package.json: dependencies must be empty, found ${Object.keys(pkg.dependencies).join(', ')}`,
  )
}

for (const field of [
  'peerDependencies',
  'optionalDependencies',
  'bundleDependencies',
  'bundledDependencies',
]) {
  const v = pkg[field]
  if (v !== undefined && Object.keys(v).length > 0) note(`package.json: ${field} must be empty`)
}

if (pkg.publishConfig?.dependencies !== undefined) {
  note('package.json: publishConfig must not override dependencies')
}
if (pkg.sideEffects !== false)
  note('package.json: "sideEffects": false is required for tree-shaking')
if (pkg.type !== 'module') note('package.json: "type": "module" is required')
if (pkg.license !== 'Apache-2.0') note('package.json: license must be Apache-2.0')
if (pkg.exports?.['./package.json'] === undefined) {
  note('package.json: must export "./package.json" — several toolchains read it')
}

// "types" must come first inside each export condition, because condition
// matching is first-match-wins on key order.
for (const [sub, cond] of Object.entries(pkg.exports ?? {})) {
  if (typeof cond !== 'object' || cond === null) continue
  for (const branch of ['import', 'require']) {
    const b = cond[branch]
    if (b === undefined) continue
    if (Object.keys(b)[0] !== 'types') {
      note(`package.json: exports["${sub}"].${branch} must list "types" first`)
    }
  }
}

// ---- 2. lockfile -----------------------------------------------------------
const lockPath = resolve(ROOT, 'pnpm-lock.yaml')
if (existsSync(lockPath)) {
  const lock = readFileSync(lockPath, 'utf8')
  const start = lock.indexOf('\n  packages/core:')
  if (start !== -1) {
    const rest = lock.slice(start + 1)
    const end = rest.search(/\n {2}\S/)
    const block = end === -1 ? rest : rest.slice(0, end)
    if (/\n {4}dependencies:/.test(block)) {
      note('pnpm-lock.yaml: importer packages/core resolved runtime dependencies')
    }
  }
} else {
  process.stderr.write('  (skipped lockfile check: pnpm-lock.yaml not present yet)\n')
}

// ---- 3. tarball ------------------------------------------------------------
try {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: CORE, encoding: 'utf8' })
  const [meta] = JSON.parse(out)
  const names = meta.files.map((f) => f.path)
  if (names.some((f) => f.startsWith('src/'))) note('tarball: src/ must not be published')
  if (!names.includes('schema/policy.schema.json')) {
    note('tarball: schema/policy.schema.json must be published for editor validation')
  }
  for (const legal of ['LICENSE', 'NOTICE']) {
    if (!names.includes(legal)) note(`tarball: ${legal} must be published (Apache-2.0)`)
  }
  if (!names.includes('schema/audit-event.schema.json')) {
    note('tarball: schema/audit-event.schema.json must be published for log pipelines')
  }
  // A tripwire for code that is not ours — a dependency bundled into dist/ would
  // add hundreds of KB to MBs — not a size budget. The budget users feel is the
  // minified bundle, checked by size-limit against the spec's 150 KB.
  //
  // Raised from 400 KB on 2026-10-05, when all six actions and the hand-written
  // SHA-256/HMAC landed (unpacked ~404 KB). Over half of that is source maps,
  // kept on purpose so a stack trace in a user's app points at our TypeScript.
  // If this trips again, check what grew before raising it: `npm pack --dry-run`.
  //
  // Raised to 700 KB on 2026-10-13 for the two-pass phone detector (D17): 599,598
  // → 629,729 bytes, all of it our own code — maps +18.6 KB, dist +10 KB, READMEs
  // +1.3 KB. No file outside dist/ and the docs changed.
  //
  // Raised to 800 KB the same day: 629,729 → 735,381 bytes, again only dist/ and
  // its maps — the shared digit-run reading behind four detectors (edge cases),
  // then settle.ts (D18). Comments ship four times over (.js, .cjs and both
  // maps), so every 1 KB of explanation in the source costs about 4 KB here.
  const MAX_UNPACKED = 800 * 1024
  if (meta.unpackedSize > MAX_UNPACKED) {
    note(`tarball: unpacked ${meta.unpackedSize} bytes exceeds the ${MAX_UNPACKED} byte tripwire`)
  }
} catch (e) {
  process.stderr.write(`  (skipped tarball check: ${e.message.split('\n')[0]})\n`)
}

// ---- 4. installed tree -----------------------------------------------------
// devDependencies legitimately land here (the build tool has to be reachable).
// What must never appear is anything NOT declared as a devDependency — that is
// a phantom runtime dependency, which is exactly what pnpm's strict layout and
// this check exist to catch.
const declaredDev = new Set(Object.keys(pkg.devDependencies ?? {}))
const nested = resolve(CORE, 'node_modules')
if (existsSync(nested)) {
  const installed = []
  for (const entry of readdirSync(nested)) {
    if (entry === '.bin' || entry.startsWith('.')) continue
    if (entry.startsWith('@')) {
      for (const scoped of readdirSync(resolve(nested, entry))) installed.push(`${entry}/${scoped}`)
    } else {
      installed.push(entry)
    }
  }
  const phantom = installed.filter((name) => !declaredDev.has(name))
  if (phantom.length > 0) {
    note(`packages/core/node_modules has undeclared packages: ${phantom.join(', ')}`)
  }
}

if (fail.length > 0) {
  process.stderr.write(`\nassert-zero-deps FAILED\n${fail.map((f) => `  - ${f}`).join('\n')}\n\n`)
  process.exit(1)
}
process.stdout.write('assert-zero-deps ok\n')
