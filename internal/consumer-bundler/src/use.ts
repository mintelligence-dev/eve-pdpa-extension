// The path every bundler-based app takes. Passes even when the node16 story is
// broken, which is exactly why the node16 fixture next door exists.
import { createGuard, definePolicy } from '@eve-pdpa-extension/core'

export const text: string = createGuard({
  policy: definePolicy({
    entitySet: '0.1',
    entities: { PHONE: { action: 'mask', keep: 'last4' } },
  }),
}).processSync('x').text
