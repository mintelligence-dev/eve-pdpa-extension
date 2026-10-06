// Proves the "require" condition of the exports map resolves at runtime.
const core = require('@thai-pdpa-guard/core')
if (typeof core.VERSION !== 'string') throw new Error('VERSION missing via CJS specifier')
if (typeof core.createGuard !== 'function') throw new Error('createGuard missing via CJS specifier')
if (core.default !== undefined) throw new Error('core must not have a default export')
console.log('pkg cjs ok')
