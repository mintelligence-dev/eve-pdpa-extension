import {
  type AuditRecord,
  createGuard,
  definePolicy,
  type PolicyInput,
} from '@eve-pdpa-extension/core'

/** A guard and the audit events it wrote. Synthetic values only in these tests. */
export function build(entities: PolicyInput['entities'] = {}) {
  const events: AuditRecord[] = []
  const guard = createGuard({
    policy: definePolicy({ entitySet: '0.1', entities }),
    onAudit: (e) => events.push(e),
  })
  return { guard, events }
}

export const TOKENISE = { action: 'tokenise', allowedPurposes: ['otp_send'] } as const
export const PHONE = '0812345678'
export const CARD = '4111 1111 1111 1111'
