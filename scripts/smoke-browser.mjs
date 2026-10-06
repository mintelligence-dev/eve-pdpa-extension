#!/usr/bin/env node
// Runs the shipped ESM bundle in a real browser.
//
// This is the only job that catches document/window/localStorage leaking into
// core, and the browser build is a stated 0.3 deliverable — so the gate exists
// from the first commit rather than being retrofitted.

import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const ROOT = resolve(import.meta.dirname, '..')
const lib = readFileSync(resolve(ROOT, 'packages/core/dist/index.js'), 'utf8')
const smoke = readFileSync(resolve(ROOT, 'packages/core/smoke/dist.mjs'), 'utf8').replace(
  '../dist/index.js',
  './core.js',
)

const routes = {
  '/': [
    'text/html; charset=utf-8',
    '<!doctype html><meta charset="utf-8"><script type="module">' +
      "import { run } from '/smoke.js'; try { console.log(await run()) } catch (e) { console.error(e?.stack ?? String(e)) } finally { window.__smokeDone = true }" +
      '</script>',
  ],
  '/smoke.js': ['text/javascript; charset=utf-8', smoke],
  '/core.js': ['text/javascript; charset=utf-8', lib],
}

const server = createServer((req, res) => {
  const hit = routes[(req.url ?? '/').split('?')[0]]
  if (!hit) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, { 'content-type': hit[0] }).end(hit[1])
})

await new Promise((r) => server.listen(0, '127.0.0.1', r))
const { port } = server.address()

let browser
try {
  browser = await chromium.launch()
  const page = await browser.newPage()
  const logs = []
  const errors = []
  page.on('console', (m) => logs.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' })
  // run() is async; wait for it to finish rather than for the network to go quiet.
  await page.waitForFunction(() => window.__smokeDone === true, null, { timeout: 15000 })

  if (errors.length > 0) throw new Error(errors.join('\n'))
  if (!logs.some((l) => l.startsWith('smoke ok'))) {
    throw new Error(`smoke did not report success. console: ${JSON.stringify(logs)}`)
  }
  process.stdout.write(`chromium ${logs.find((l) => l.startsWith('smoke ok'))}\n`)
} catch (err) {
  process.stderr.write(`${err?.stack ?? err}\n`)
  process.exitCode = 1
} finally {
  await browser?.close()
  server.close()
}
