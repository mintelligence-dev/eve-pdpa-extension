// Packs every publishable package the way release day will — with pnpm, so
// prepack runs and workspace:* is rewritten — and checks what is inside.
//
// Each check is something that once went missing without anyone noticing:
// LICENSE and NOTICE were listed in core's files but lived at the repo root,
// CHANGELOG.md is not shipped by npm unless listed, and npm itself never
// rewrites workspace:* — publishing cli with npm would ship a dependency no
// one can install.
//
// Also used by scripts/check-readme.mjs, which installs these tarballs.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

export const PACKAGES = ['core', 'cli']

const EVERY_PACKAGE = [
  'package.json',
  'README.md',
  'README.th.md',
  'CHANGELOG.md',
  'LICENSE',
  'NOTICE',
]
const ALSO = {
  core: ['schema/policy.schema.json', 'schema/audit-event.schema.json'],
  cli: [],
}

/** Packs each package into a fresh directory and returns { name: tarballPath }. */
export function packAll() {
  const out = mkdtempSync(join(tmpdir(), 'pdpa-pack-'))
  const tarballs = {}
  for (const name of PACKAGES) {
    execFileSync('pnpm', ['pack', '--pack-destination', out], {
      cwd: join(ROOT, 'packages', name),
      stdio: 'ignore',
    })
    const file = readdirSync(out).find((f) => f.startsWith(`eve-pdpa-extension-${name}-`))
    if (file === undefined) throw new Error(`pnpm pack produced no tarball for ${name}`)
    tarballs[name] = join(out, file)
  }
  return tarballs
}

function check(tarballs) {
  const problems = []
  for (const name of PACKAGES) {
    const listed = execFileSync('tar', ['-tzf', tarballs[name]], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map((p) => p.replace(/^package\//, ''))
    for (const want of [...EVERY_PACKAGE, ...ALSO[name]]) {
      if (!listed.includes(want)) problems.push(`${name}: ${want} is not in the tarball`)
    }
    if (listed.some((p) => p.startsWith('src/') || p.startsWith('test/'))) {
      problems.push(`${name}: src/ or test/ is in the tarball`)
    }
    const manifest = JSON.parse(
      execFileSync('tar', ['-xzOf', tarballs[name], 'package/package.json'], { encoding: 'utf8' }),
    )
    for (const [dep, range] of Object.entries(manifest.dependencies ?? {})) {
      if (String(range).startsWith('workspace:')) {
        problems.push(`${name}: dependency ${dep} is still ${range} — publish with pnpm, not npm`)
      }
    }
  }
  return problems
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = check(packAll())
  if (problems.length > 0) {
    for (const p of problems) process.stderr.write(`  ${p}\n`)
    process.exit(1)
  }
  process.stdout.write(`assert-tarballs ok (${PACKAGES.join(', ')})\n`)
}
