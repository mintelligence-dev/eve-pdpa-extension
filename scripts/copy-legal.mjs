// Copies the repo's LICENSE into the package being packed.
//
// Run as each publishable package's `prepack`, so `pnpm pack` and
// `pnpm publish` always ship the current root file. The MIT licence must
// travel with the code, and `files` alone cannot reach outside the package
// directory: listing it there without this script ships nothing. The copies
// are gitignored, so there is one source of truth.

import { copyFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url)
copyFileSync(new URL('LICENSE', root), join(process.cwd(), 'LICENSE'))
