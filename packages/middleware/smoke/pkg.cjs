// Proves the "require" condition of the exports map resolves at runtime, and
// that the CJS build finds core through core's own "require" condition.
const mw = require('@eve-pdpa-extension/middleware')

for (const k of ['protectBody', 'protectRequest', 'withPdpa', 'pdpaExpress', 'pdpaHono']) {
  if (typeof mw[k] !== 'function') throw new Error(`${k} missing via CJS specifier`)
}
if (typeof mw.createGuard !== 'function') throw new Error('createGuard missing via CJS specifier')

const guard = mw.createGuard({
  policy: mw.definePolicy({ entitySet: '0.1', entities: { PHONE: { action: 'mask' } } }),
  onAudit: () => {},
})
mw.protectBody({ prompt: 'โทร 0812345678' }, { guard }).then((r) => {
  if (!r.ok || JSON.stringify(r.body).includes('0812345678'))
    throw new Error('CJS build did not protect')
  console.log('pkg cjs ok')
})
