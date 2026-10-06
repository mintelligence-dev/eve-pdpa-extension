#!/usr/bin/env node
// core must not reference @thai-pdpa-guard/ner in any form. A bundler that
// follows the reference drags a 420 MB model into a customer's browser bundle.
//
// This is nearly redundant with the build's own dependency check — except for
// `import type`, which is erased at build time and is therefore invisible to
// every other layer, while signalling exactly the coupling this rule prevents.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SRC = resolve(ROOT, 'packages/core/src')

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(ts|mts|cts|js)$/.test(name)) files.push(p)
  }
}
walk(SRC)

// Only real module specifiers count. Prose in a comment that names a sibling
// package is documentation, not coupling.
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])(@thai-pdpa-guard\/[^'"]*)\1/

const fail = []
for (const file of files) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const m = SPECIFIER.exec(line)
      if (m !== null) {
        fail.push(`${relative(ROOT, file)}:${i + 1}  imports ${m[2]} — ${line.trim().slice(0, 70)}`)
      }
    })
}

if (fail.length > 0) {
  process.stderr.write(
    `\nassert-no-ner-import FAILED — core must not reference sibling packages\n${fail
      .map((f) => `  - ${f}`)
      .join('\n')}\n\n`,
  )
  process.exit(1)
}
process.stdout.write(`assert-no-ner-import ok (${files.length} files)\n`)
