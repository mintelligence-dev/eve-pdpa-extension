#!/usr/bin/env node
// C5: core must run on Deno, Bun, workerd and browsers, so it may not touch
// node: builtins or Node-only globals.
//
// This closes the two gaps the build cannot: tsdown's dependency check does not
// inspect require() in the CJS output, and no bundler check sees a global that
// was reached through globalThis.
//
// The unfoolable layer is not here — it is `deno run` with no permission flags
// and workerd without nodejs_compat. This layer exists to say WHICH LINE.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DIST = resolve(ROOT, 'packages/core/dist')

if (!existsSync(DIST)) {
  process.stderr.write('assert-no-node-builtins: packages/core/dist not found — run build first\n')
  process.exit(1)
}

const BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
  'node:test',
  'node:sea',
  'node:sqlite',
])

const BANNED_GLOBALS = [
  ['process', /(?<![\w.$])process\s*\./],
  ['Buffer', /(?<![\w.$])Buffer\s*[.(]/],
  ['__dirname', /(?<![\w.$])__dirname(?![\w$])/],
  ['__filename', /(?<![\w.$])__filename(?![\w$])/],
  ['eval', /(?<![\w.$])eval\s*\(/],
  ['new Function', /new\s+Function\s*\(/],
  ['require.resolve', /require\.resolve\s*\(/],
  ['import.meta.url', /import\.meta\.url/],
  ['fetch', /(?<![\w.$])fetch\s*\(/],
  ['XMLHttpRequest', /(?<![\w.$])XMLHttpRequest(?![\w$])/],
  ['WebSocket', /(?<![\w.$])WebSocket(?![\w$])/],
  ['EventSource', /(?<![\w.$])EventSource(?![\w$])/],
  ['navigator.sendBeacon', /navigator\s*\.\s*sendBeacon/],
]

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(js|cjs|d\.ts|d\.cts)$/.test(name)) files.push(p)
  }
}
walk(DIST)

const fail = []
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  const rel = relative(ROOT, file)

  // (a) every require() specifier must be relative
  const requireRe = /(?:^|[^\w.$])require\s*\(\s*(['"])([^'"]+)\1\s*\)/g
  let m = requireRe.exec(src)
  while (m !== null) {
    const spec = m[2]
    if (!spec.startsWith('./') && !spec.startsWith('../')) {
      const line = src.slice(0, m.index).split('\n').length
      const why = BUILTINS.has(spec) ? 'node builtin' : 'bare specifier'
      fail.push(`${rel}:${line}  require("${spec}") — ${why}`)
    }
    m = requireRe.exec(src)
  }

  // (b) static/dynamic import of anything non-relative
  const importRe = /from\s*(['"])([^'"]+)\1|import\s*\(\s*(['"])([^'"]+)\3\s*\)/g
  m = importRe.exec(src)
  while (m !== null) {
    const spec = m[2] ?? m[4]
    if (spec && !spec.startsWith('./') && !spec.startsWith('../')) {
      const line = src.slice(0, m.index).split('\n').length
      fail.push(`${rel}:${line}  import "${spec}" — core must import nothing external`)
    }
    m = importRe.exec(src)
  }

  // (c) dynamic import with a computed specifier defeats every static check
  const computed = /import\s*\(\s*(?!['"])/g
  m = computed.exec(src)
  while (m !== null) {
    const line = src.slice(0, m.index).split('\n').length
    fail.push(`${rel}:${line}  import() with a non-literal specifier is not allowed in core`)
    m = computed.exec(src)
  }

  // (d) Node-only or network globals
  for (const [name, re] of BANNED_GLOBALS) {
    lines.forEach((text, i) => {
      if (re.test(text))
        fail.push(`${rel}:${i + 1}  banned global "${name}" — ${text.trim().slice(0, 80)}`)
    })
  }
}

if (fail.length > 0) {
  process.stderr.write(
    `\nassert-no-node-builtins FAILED\n${fail.map((f) => `  - ${f}`).join('\n')}\n\n`,
  )
  process.exit(1)
}
process.stdout.write(`assert-no-node-builtins ok (${files.length} files)\n`)
