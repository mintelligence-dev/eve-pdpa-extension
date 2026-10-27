// A fixture agent: every layer of the package, under eve's real runtime.
import { createGuard, createMemoryTokenStore, definePolicy } from '@eve-pdpa-extension/core'

export const guard = createGuard({
  policy: definePolicy({
    entitySet: '0.1',
    entities: {
      PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'], ttlSec: 300, display: 'mask' },
    },
  }),
  tokenStore: createMemoryTokenStore(),
  onAudit: () => {},
})

export const pdpa = { guard, sessionKey: process.env.PDPA_SESSION_KEY ?? '' }
