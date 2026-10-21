#!/usr/bin/env node
// Runs the SHIPPED dist/index.js inside the real workerd binary.
//
// miniflare, not @cloudflare/vitest-pool-workers: the pool re-bundles from
// source, which proves the source works on workerd but not that the artifact
// users install does — and the artifact is what C5 is about.
//
// compatibilityFlags is empty on purpose. Without nodejs_compat, any node:
// import genuinely fails rather than being politely polyfilled.
//
// `node scripts/smoke-workerd.mjs http` runs http's smoke instead (D24): the
// gateway's dist with core's beside it, both as shipped.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Miniflare } from 'miniflare'

const ROOT = resolve(import.meta.dirname, '..')
const PKG = process.argv[2] ?? 'core'
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8')
// workerd resolves modules by name, not through node_modules: every import of
// core, bare or relative, points at the one core.js module.
const toCore = (src) => src.replace(/(['"])@eve-pdpa-extension\/core\1/g, "'./core.js'")
const lib = read('packages/core/dist/index.js')
const modules =
  PKG === 'http'
    ? [
        {
          type: 'ESModule',
          path: 'smoke.js',
          contents: toCore(read('packages/http/smoke/dist.mjs')).replace(
            '../dist/index.js',
            './http.js',
          ),
        },
        {
          type: 'ESModule',
          path: 'http.js',
          contents: toCore(read('packages/http/dist/index.js')),
        },
        { type: 'ESModule', path: 'core.js', contents: lib },
      ]
    : [
        {
          type: 'ESModule',
          path: 'smoke.js',
          contents: read('packages/core/smoke/dist.mjs').replace('../dist/index.js', './core.js'),
        },
        { type: 'ESModule', path: 'core.js', contents: lib },
      ]

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
    ...modules,
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
