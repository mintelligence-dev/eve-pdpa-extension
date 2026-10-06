#!/usr/bin/env node
// Runs the SHIPPED dist/index.js inside the real workerd binary.
//
// miniflare, not @cloudflare/vitest-pool-workers: the pool re-bundles from
// source, which proves the source works on workerd but not that the artifact
// users install does — and the artifact is what C5 is about.
//
// compatibilityFlags is empty on purpose. Without nodejs_compat, any node:
// import genuinely fails rather than being politely polyfilled.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Miniflare } from 'miniflare'

const ROOT = resolve(import.meta.dirname, '..')
const lib = readFileSync(resolve(ROOT, 'packages/core/dist/index.js'), 'utf8')
const smoke = readFileSync(resolve(ROOT, 'packages/core/smoke/dist.mjs'), 'utf8').replace(
  '../dist/index.js',
  './core.js',
)

const mf = new Miniflare({
  compatibilityDate: '2026-08-06',
  compatibilityFlags: [],
  modules: [
    {
      type: 'ESModule',
      path: 'worker.js',
      // run() is called inside fetch, never at module top level: workerd
      // forbids generating random values during global scope evaluation and
      // the smoke script exercises tokenise.
      contents: [
        `import { run } from './smoke.js'`,
        `export default {`,
        `  async fetch() {`,
        `    try {`,
        `      return new Response(await run())`,
        `    } catch (e) {`,
        `      return new Response(e?.stack ?? String(e), { status: 500 })`,
        `    }`,
        `  },`,
        `}`,
      ].join('\n'),
    },
    { type: 'ESModule', path: 'smoke.js', contents: smoke },
    { type: 'ESModule', path: 'core.js', contents: lib },
  ],
})

try {
  const res = await mf.dispatchFetch('http://smoke.local/')
  const body = await res.text()
  if (!res.ok) {
    process.stderr.write(`${body}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(`workerd ${body}\n`)
  }
} catch (err) {
  process.stderr.write(`${err?.stack ?? err}\n`)
  process.exitCode = 1
} finally {
  await mf.dispose()
}
