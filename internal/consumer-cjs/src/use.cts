// Resolves the "require" condition of the exports map under node16.
// Catches a .d.cts that is really ESM — the classic dual-publish bug that
// moduleResolution: "bundler" hides completely.
import core = require('@eve-pdpa-extension/core')

const policy = core.definePolicy({
  entitySet: '0.1',
  entities: { EMAIL: { action: 'flag' } },
})

const text: string = core.createGuard({ policy }).processSync('x').text

export = { text }
