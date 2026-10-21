import { type CompiledPolicy, definePolicy, PdpaError } from '@eve-pdpa-extension/core'

/**
 * What a guard uses when it is given no policy. core has no default of its
 * own, so this one ships here: the rules of examples/vercel/policies/default.json.
 *
 * No `tokenise` and no `hash`, so it needs no token store and no key. A credit
 * card stops the message; everything else is hidden before eve records it.
 */
export const DEFAULT_POLICY: CompiledPolicy = definePolicy({
  entitySet: '0.1',
  onUnmapped: 'redact',
  placeholderLanguage: 'th',
  entities: {
    PHONE: { action: 'mask', keep: 'last4' },
    TH_NATIONAL_ID: { action: 'redact' },
    BANK_ACCOUNT: { action: 'mask', keep: 'last4' },
    EMAIL: { action: 'redact' },
    CREDIT_CARD: { action: 'block', minConfidence: 0.6 },
    LINE_USER_ID: { action: 'redact' },
  },
})

/**
 * A token is only worth issuing if something can exchange it back, and nothing
 * here can: the guard lives inside the channel wrapper, out of reach of the
 * agent's tools, and tokens are kept per session under an id that must not
 * itself be personal data. Until that exists, a tokenised value would reach
 * the model as a token no one can resolve — redact that reads worse — so the
 * policy is refused when the guard is built, not on the first message.
 */
export function refuseTokenise(policy: CompiledPolicy): void {
  const entities: Readonly<Record<string, { readonly action?: unknown } | undefined>> =
    typeof policy === 'object' && policy !== null ? (policy.entities ?? {}) : {}
  for (const [entity, rule] of Object.entries(entities)) {
    if (rule?.action === 'tokenise') {
      throw new PdpaError(
        'ERR_PDPA_INVALID_POLICY',
        `entities.${entity}.action: tokenise is not supported by @eve-pdpa-extension/eve yet — nothing here can resolve the token; use redact or mask`,
      )
    }
  }
}
