import {
  type CompiledPolicy,
  definePolicy,
  ENTITY_TYPES,
  type EntityType,
} from '@eve-pdpa-extension/core'

/**
 * The policy used when none is given: every type redacted. The safest default
 * for a tool an agent calls on text it is about to pass on.
 */
export function defaultPolicy(): CompiledPolicy {
  const entities: Partial<Record<EntityType, { action: 'redact' }>> = {}
  for (const type of ENTITY_TYPES) entities[type] = { action: 'redact' }
  return definePolicy({ entitySet: '0.1', entities })
}

/** Why a policy cannot run in this server, or undefined when it can. */
export function policyProblem(
  policy: CompiledPolicy,
  env: { readonly hmacKey?: string | undefined },
): string | undefined {
  const rules = Object.entries(policy.entities)
  const tokenised = rules.filter(([, rule]) => rule?.action === 'tokenise').map(([type]) => type)
  if (tokenised.length > 0) {
    // A token is only worth something to a tool that can resolve it, and this
    // server has none: tokens would pile up in memory with no way back.
    return `this policy tokenises ${tokenised.join(', ')}, which an MCP server cannot do — there is no tool to resolve a token. Use redact or mask for these types.`
  }
  const hashed = rules.some(([, rule]) => rule?.action === 'hash')
  if (hashed && (env.hmacKey === undefined || env.hmacKey === '')) {
    return 'this policy hashes values, which needs a secret key: set PDPA_HMAC_KEY in the server’s environment.'
  }
  return undefined
}
