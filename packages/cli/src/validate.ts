import {
  type CompiledPolicy,
  ENTITY_TYPES,
  type EntityRule,
  PdpaError,
  parsePolicy,
} from '@thai-pdpa-guard/core'

export type Validation =
  | { readonly ok: true; readonly policy: CompiledPolicy }
  | { readonly ok: false; readonly problem: string }

/**
 * Loads a policy file exactly as an app would, through parsePolicy, so a file
 * that passes here is a file createGuard accepts.
 *
 * A policy legitimately holds real values (allowlist.exact), so no message here
 * may echo the file's content. definePolicy's errors name the field only (D2).
 * JSON.parse's do not — V8 quotes the text around a syntax error — so those are
 * reduced to a line number.
 */
export function validatePolicy(json: string): Validation {
  try {
    JSON.parse(json)
  } catch (error) {
    return { ok: false, problem: `not valid JSON${whereInJson(json, error)}` }
  }
  try {
    return { ok: true, policy: parsePolicy(json) }
  } catch (error) {
    if (error instanceof PdpaError) return { ok: false, problem: error.message }
    throw error
  }
}

function whereInJson(json: string, error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  const line = /\(line (\d+) column \d+\)/.exec(message)?.[1]
  if (line !== undefined) return ` (line ${line})`
  const at = /position (\d+)/.exec(message)?.[1]
  if (at === undefined) return ''
  return ` (line ${json.slice(0, Number(at)).split('\n').length})`
}

function describeRule(rule: EntityRule): string {
  const parts: string[] = [rule.action]
  if (rule.action === 'mask') parts.push(rule.keep === 'last4' ? 'last 4 shown' : 'all hidden')
  if (rule.action === 'tokenise') {
    parts.push(`purposes: ${(rule.allowedPurposes ?? []).join(', ')}`)
    parts.push(`ttl ${rule.ttlSec ?? 300}s`)
    parts.push(`reply shows ${rule.display === 'redact' ? 'placeholder' : 'masked value'}`)
  }
  if (rule.minConfidence !== undefined) parts.push(`minConfidence ${rule.minConfidence}`)
  return parts.join(' · ')
}

/**
 * What the policy does with each entity, in words. Allowlist entries are
 * counted, never shown: they are the shop's own contact details, often a
 * person's, and a pattern can spell a value out as plainly as an exact entry.
 */
export function describePolicy(file: string, policy: CompiledPolicy): string {
  const rows = ENTITY_TYPES.map((entity): [string, string] => {
    const rule = policy.entities[entity]
    if (rule !== undefined) return [entity, describeRule(rule)]
    return [
      entity,
      policy.onUnmapped === 'ignore'
        ? 'not in the policy → let through, not reported (onUnmapped: ignore)'
        : `not in the policy → ${policy.onUnmapped} (onUnmapped)`,
    ]
  })
  const width = Math.max(...rows.map(([k]) => k.length))
  const out = [`${file}  valid  ${policy.hash}`, '']
  for (const [k, v] of rows) out.push(`  ${k.padEnd(width)}  ${v}`)

  const { exact, pattern } = policy.allowlist
  out.push('')
  out.push(
    exact.length + pattern.length === 0
      ? 'allowlist   none'
      : `allowlist   ${exact.length} exact · ${pattern.length} pattern (values not shown)`,
  )
  out.push(`placeholders ${policy.placeholderLanguage === 'en' ? '[phone]' : '[เบอร์โทร]'}`)

  const rules = Object.values(policy.entities)
  const notes: string[] = []
  if (rules.some((r) => r?.action === 'hash')) {
    notes.push('uses hash: createGuard needs an hmacKey of at least 32 bytes')
  }
  if (rules.some((r) => r?.action === 'tokenise')) {
    notes.push('uses tokenise: every process and resolve call needs a sessionId')
  }
  if (rules.some((r) => r?.action === 'flag')) {
    notes.push('uses flag: those values reach the model as typed, and are only reported')
  }
  if (notes.length > 0) {
    out.push('')
    for (const note of notes) out.push(`note: ${note}`)
  }
  return `${out.join('\n')}\n`
}
