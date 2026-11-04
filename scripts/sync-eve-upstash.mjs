// Copies the Upstash token store from packages/http into packages/eve.
//
// `eve extension build` compiles only files under packages/eve (it passes the
// package as tsc's rootDir, and refuses symlinks), so the eve package cannot
// import the store from packages/http. It carries a copy instead: the same
// bytes, checked by packages/eve/test/upstash-copy.test.ts. packages/http
// stays the source; after changing the store there, run this script.

import { copyFileSync } from 'node:fs'

const from = new URL('../packages/http/src/', import.meta.url)
const to = new URL('../packages/eve/extension/lib/upstash/', import.meta.url)
for (const name of ['upstash-store.ts', 'errors.ts']) {
  copyFileSync(new URL(name, from), new URL(name, to))
}
console.log('sync-eve-upstash ok (upstash-store.ts, errors.ts)')
