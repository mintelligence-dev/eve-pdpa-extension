#!/usr/bin/env node
// Copies the gateway into its deploy template repository (D29):
//
//   node scripts/sync-gateway-template.mjs ../eve-pdpa-gateway
//
// apps/gateway stays the one place the gateway is edited. The template is what
// the "Deploy to Vercel" button clones, so it has to stand alone: core and http
// are not on npm yet, so they go in as vendor/core and vendor/http — the files
// `pnpm pack` would publish, built from this commit, never the source.
//
// What this writes, and nothing else:
//   - vendor/core, vendor/http, vendor/SOURCE.json (replaced whole)
//   - the app's own files: api/, lib/, policies/, public/, postman/,
//     scripts/smoke.mjs, API.md (replaced whole)
// The template's README, package.json, vercel.json and tsconfig.json are its
// own, written for someone who has never seen this monorepo, and are left
// alone.
//
// Once core and http are on npm, the template depends on them by version and
// vendor/ goes.

import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const APP = join(ROOT, 'apps/gateway')
const APP_PATHS = ['api', 'lib', 'policies', 'public', 'postman', 'scripts/smoke.mjs', 'API.md']
const SOURCES = ['packages/core', 'packages/http', 'apps/gateway']

const args = process.argv.slice(2)
const allowDirty = args.includes('--allow-dirty')
const target = args.find((a) => !a.startsWith('--'))
if (target === undefined) {
  console.error('usage: node scripts/sync-gateway-template.mjs <template repo> [--allow-dirty]')
  process.exit(2)
}
const DEST = resolve(target)
if (!existsSync(join(DEST, 'package.json'))) {
  console.error(`${DEST} has no package.json: is it the template repository?`)
  process.exit(1)
}

const run = (cmd, argv, cwd = ROOT) =>
  execFileSync(cmd, argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()

// SOURCE.json names a commit, so what is copied has to be that commit.
const dirty = run('git', ['status', '--porcelain', '--', ...SOURCES])
if (dirty !== '' && !allowDirty) {
  console.error(`uncommitted changes in ${SOURCES.join(', ')} — commit them first:\n${dirty}`)
  process.exit(1)
}

run('pnpm', [
  '--filter',
  '@eve-pdpa-extension/core',
  '--filter',
  '@eve-pdpa-extension/http',
  'build',
])

const tmp = mkdtempSync(join(tmpdir(), 'gateway-template-'))
try {
  const vendor = join(DEST, 'vendor')
  rmSync(vendor, { recursive: true, force: true })
  const versions = {}
  for (const name of ['core', 'http']) {
    const dir = join(ROOT, 'packages', name)
    const tgz = run('pnpm', ['pack', '--pack-destination', tmp], dir).split('\n').at(-1)
    const out = join(tmp, name)
    mkdirSync(out)
    run('tar', ['-xzf', resolve(dir, tgz), '-C', out])
    const pkg = JSON.parse(readFileSync(join(out, 'package/package.json'), 'utf8'))
    // Nothing runs on install: the files are built already.
    delete pkg.scripts
    delete pkg.devDependencies
    if (pkg.dependencies?.['@eve-pdpa-extension/core'] !== undefined) {
      pkg.dependencies['@eve-pdpa-extension/core'] = 'file:../core'
    }
    writeFileSync(join(out, 'package/package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
    cpSync(join(out, 'package'), join(vendor, name), { recursive: true })
    versions[name] = pkg.version
  }
  writeFileSync(
    join(vendor, 'SOURCE.json'),
    `${JSON.stringify(
      {
        note: 'Built from the monorepo by scripts/sync-gateway-template.mjs. Do not edit.',
        repository: 'https://github.com/mintelligence-dev/eve-pdpa-extension',
        commit: run('git', ['rev-parse', 'HEAD']),
        dirty: dirty !== '',
        versions,
      },
      null,
      2,
    )}\n`,
  )

  for (const path of APP_PATHS) {
    rmSync(join(DEST, path), { recursive: true, force: true })
    cpSync(join(APP, path), join(DEST, path), { recursive: true })
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`synced into ${DEST}: vendor/ (core, http) and ${APP_PATHS.join(', ')}`)
