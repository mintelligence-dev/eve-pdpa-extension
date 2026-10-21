#!/usr/bin/env node
// Brings the gateway deploy template up to date with this repository (D29):
//
//   node scripts/sync-gateway-template.mjs ../eve-pdpa-gateway
//
// The template (github.com/kurachatsarakarn/eve-pdpa-gateway) is what the
// "Deploy to Vercel" button clones. Its app — api/, lib/, vercel.json, the
// smoke script, the README — is its own and edited there. What it takes from
// here, and what this writes, is only:
//   - vendor/core, vendor/http: the files `pnpm pack` would publish, built
//     from this commit, never the source — core and http are not on npm yet
//   - vendor/SOURCE.json: which commit that was
//   - the docs packages/http/docs holds and its tests check: API.md,
//     public/openapi.json, postman/, policies/
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
const DOCS = join(ROOT, 'packages/http/docs')
// docs/<from> → template/<to>
const COPIES = [
  ['API.md', 'API.md'],
  ['openapi.json', 'public/openapi.json'],
  ['postman', 'postman'],
  ['policies', 'policies'],
]
const SOURCES = ['packages/core', 'packages/http']

const args = process.argv.slice(2)
const allowDirty = args.includes('--allow-dirty')
const target = args.find((a) => !a.startsWith('--'))
if (target === undefined) {
  console.error('usage: node scripts/sync-gateway-template.mjs <template repo> [--allow-dirty]')
  process.exit(2)
}
const DEST = resolve(target)
if (!existsSync(join(DEST, 'vercel.json'))) {
  console.error(`${DEST} has no vercel.json: is it the template repository?`)
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

  for (const [from, to] of COPIES) {
    rmSync(join(DEST, to), { recursive: true, force: true })
    cpSync(join(DOCS, from), join(DEST, to), { recursive: true })
  }
  // The template serves the spec from public/, beside API.md's own folder.
  const api = join(DEST, 'API.md')
  writeFileSync(
    api,
    readFileSync(api, 'utf8').replaceAll('](./openapi.json)', '](./public/openapi.json)'),
  )
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(
  `synced into ${DEST}: vendor/ (core, http) and ${COPIES.map(([, to]) => to).join(', ')}`,
)
