// Installs @thai-pdpa-guard/core and /cli into bench/user the way a user gets
// them — from the packed tarballs — then takes out what a user never reads but
// an agent could: the source maps, which carry the TypeScript, and comments.
//
//   pnpm build && node bench/user/.harness/setup.mjs
//
// Run again after any change to core or cli: what is installed is a snapshot.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const HERE = resolve(import.meta.dirname, '..')
const ROOT = resolve(HERE, '../..')
const ts = createRequire(join(ROOT, 'packages/core/package.json'))('typescript')

const pack = mkdtempSync(join(tmpdir(), 'pdpa-user-'))
try {
  for (const name of ['core', 'cli']) {
    execFileSync('pnpm', ['pack', '--pack-destination', pack], {
      cwd: join(ROOT, 'packages', name),
      stdio: 'ignore',
    })
  }
  rmSync(join(HERE, 'node_modules'), { recursive: true, force: true })
  const tarballs = readdirSync(pack).map((f) => join(pack, f))
  execFileSync(
    'npm',
    [
      'install',
      '--no-save',
      '--no-package-lock',
      '--no-audit',
      '--no-fund',
      '--offline',
      ...tarballs,
    ],
    { cwd: HERE, stdio: 'ignore' },
  )
} finally {
  rmSync(pack, { recursive: true, force: true })
}

for (const name of ['core', 'cli']) {
  const dist = join(HERE, 'node_modules/@thai-pdpa-guard', name, 'dist')
  for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const f = entry.name
    const file = join(entry.parentPath, f)
    if (f.endsWith('.map')) {
      rmSync(file)
    } else if (/\.c?js$/.test(f)) {
      const esm = f.endsWith('.js')
      const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
        fileName: f,
        compilerOptions: {
          allowJs: true,
          removeComments: true,
          target: ts.ScriptTarget.ES2022,
          module: esm ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS,
          verbatimModuleSyntax: esm,
        },
      })
      writeFileSync(file, outputText)
    }
  }
}

const version = JSON.parse(
  readFileSync(join(HERE, 'node_modules/@thai-pdpa-guard/core/package.json'), 'utf8'),
).version
console.log(`bench/user: installed @thai-pdpa-guard/core and cli ${version} — no maps, no comments`)
