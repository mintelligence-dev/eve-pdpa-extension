// Copies the repo's LICENSE and NOTICE into the package being packed.
//
// Run as each publishable package's `prepack`, so `pnpm pack` and
// `pnpm publish` always ship the current root files. Apache-2.0 requires
// NOTICE to travel with the code, and `files` alone cannot reach outside the
// package directory: listing them there without this script ships nothing.
// The copies are gitignored, so there is one source of truth.

import { copyFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url)
for (const name of ['LICENSE', 'NOTICE']) {
  copyFileSync(new URL(name, root), join(process.cwd(), name))
}
