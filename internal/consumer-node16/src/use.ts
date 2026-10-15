// Resolves the "import" condition under moduleResolution: node16.
// If exports/types are mismatched this fails in ~200ms with a readable error,
// which beats debugging an attw problem code.
import { type CompiledPolicy, createGuard, definePolicy } from '@eve-pdpa-extension/core'

const policy: CompiledPolicy = definePolicy({
  entitySet: '0.1',
  entities: { TH_NATIONAL_ID: { action: 'redact' } },
})

export const text: string = createGuard({ policy }).processSync('x').text
