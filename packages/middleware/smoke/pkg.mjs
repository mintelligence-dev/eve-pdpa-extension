// Proves the "import" condition of the exports map resolves at runtime.
import { createGuard, protectBody } from '@eve-pdpa-extension/middleware'

if (typeof protectBody !== 'function') throw new Error('protectBody missing via ESM specifier')
if (typeof createGuard !== 'function') throw new Error('createGuard missing via ESM specifier')
console.log('pkg esm ok')
