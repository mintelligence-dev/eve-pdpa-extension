// Proves the "import" condition of the exports map resolves at runtime.
import { createGuard, VERSION } from '@thai-pdpa-guard/core'

if (typeof VERSION !== 'string') throw new Error('VERSION missing via ESM specifier')
if (typeof createGuard !== 'function') throw new Error('createGuard missing via ESM specifier')
console.log('pkg esm ok')
