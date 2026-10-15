import { MAX_TTL_SEC } from './actions/tokenise.js'
import { compileAllowlist } from './allowlist.js'
import { PdpaError } from './errors.js'
import type { Action, CompiledPolicy, EntityRule, EntityType, PolicyInput } from './types.js'
import { ACTIONS, ENTITY_TYPES } from './types.js'

const ACTION_SET: ReadonlySet<string> = new Set<string>(ACTIONS)
const ENTITY_SET: ReadonlySet<string> = new Set<string>(ENTITY_TYPES)

function fail(path: string, problem: string): never {
  // Path only. Policy files legitimately contain real values (allowlist.exact),
  // so an error message must never echo one. D2.
  throw new PdpaError('ERR_PDPA_INVALID_POLICY', `${path}: ${problem}`)
}

const POLICY_KEYS: ReadonlySet<string> = new Set([
  // Editors read it to find the schema. Not a rule, so not part of the hash.
  '$schema',
  'entitySet',
  'onUnmapped',
  'entities',
  'allowlist',
  'placeholderLanguage',
])
const RULE_KEYS: ReadonlySet<string> = new Set([
  'action',
  'minConfidence',
  'keep',
  'ttlSec',
  'allowedPurposes',
  'display',
])
const ON_UNMAPPED: ReadonlySet<string> = new Set(['redact', 'flag', 'ignore'])
const LANGUAGES: ReadonlySet<string> = new Set(['th', 'en'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A misspelt field is not ignored. `allowList` instead of `allowlist` would load
 * cleanly and then redact the shop's own address; `keeps` instead of `keep`
 * would mask everything. Both look like the guard misbehaving, when the policy
 * simply said something other than what was meant. Field names are not values,
 * so naming one in the error is safe.
 */
function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key))
      fail(path === '' ? key : `${path}.${key}`, 'unknown field — check the spelling')
  }
}

function checkRule(entity: string, rule: EntityRule): void {
  if (!isPlainObject(rule)) fail(`entities.${entity}`, 'expected an object with an action')
  rejectUnknownKeys(rule, RULE_KEYS, `entities.${entity}`)

  if (!ACTION_SET.has(rule.action)) {
    fail(`entities.${entity}.action`, `expected one of ${ACTIONS.join('|')}`)
  }
  if (
    rule.minConfidence !== undefined &&
    !(typeof rule.minConfidence === 'number' && rule.minConfidence >= 0 && rule.minConfidence <= 1)
  ) {
    fail(`entities.${entity}.minConfidence`, 'expected a number between 0 and 1')
  }
  if (rule.keep !== undefined && rule.keep !== 'last4' && rule.keep !== 'first2last4') {
    fail(`entities.${entity}.keep`, 'expected "last4" or "first2last4"')
  }
  // Cross-field rules — mirrored by the if/then blocks in policy.schema.json.
  if (rule.keep !== undefined && rule.action !== 'mask') {
    fail(`entities.${entity}.keep`, 'only valid when action is "mask"')
  }
  if (rule.ttlSec !== undefined && rule.action !== 'tokenise') {
    fail(`entities.${entity}.ttlSec`, 'only valid when action is "tokenise"')
  }
  if (rule.allowedPurposes !== undefined && rule.action !== 'tokenise') {
    fail(`entities.${entity}.allowedPurposes`, 'only valid when action is "tokenise"')
  }
  if (rule.display !== undefined && rule.display !== 'mask' && rule.display !== 'redact') {
    fail(`entities.${entity}.display`, 'expected "mask" or "redact"')
  }
  if (rule.display !== undefined && rule.action !== 'tokenise') {
    fail(`entities.${entity}.display`, 'only valid when action is "tokenise"')
  }

  if (rule.action === 'tokenise') {
    // A token no purpose may resolve can never be exchanged back: it is redact
    // that reads worse, and the mistake would only surface when the first tool
    // that needs the value fails in production. Use redact if that is the intent.
    const purposes = rule.allowedPurposes
    if (
      !Array.isArray(purposes) ||
      purposes.length === 0 ||
      purposes.some((p) => typeof p !== 'string' || p.length === 0)
    ) {
      fail(
        `entities.${entity}.allowedPurposes`,
        'required for tokenise — list the purposes that may resolve the token, or use redact',
      )
    }
    // D6: past an hour the store stops being a cache and becomes a database of
    // real values nobody decided to keep.
    if (
      rule.ttlSec !== undefined &&
      !(Number.isInteger(rule.ttlSec) && rule.ttlSec >= 1 && rule.ttlSec <= MAX_TTL_SEC)
    ) {
      fail(
        `entities.${entity}.ttlSec`,
        `expected a whole number of seconds from 1 to ${MAX_TTL_SEC}`,
      )
    }
  }
}

/**
 * Deterministic, order-independent digest of the rules that governed a scan.
 *
 * The allowlist is part of those rules. Two policies that differ only in what
 * they let through must not share a hash, or an audit event could not say which
 * one decided that a value was allowed to reach the model.
 */
function hashPolicy(input: PolicyInput): string {
  const canonical = JSON.stringify({
    entitySet: input.entitySet,
    onUnmapped: input.onUnmapped ?? 'redact',
    placeholderLanguage: input.placeholderLanguage ?? 'th',
    entities: Object.keys(input.entities)
      .sort()
      .map((k) => [k, input.entities[k as EntityType]]),
    allowlist: {
      exact: [...(input.allowlist?.exact ?? [])].sort(),
      pattern: [...(input.allowlist?.pattern ?? [])].sort(),
    },
  })
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < canonical.length; i++) {
    const c = canonical.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0
  }
  return `fnv1a64:${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

export function definePolicy(input: PolicyInput): CompiledPolicy {
  if (!isPlainObject(input)) fail('policy', 'expected an object')
  rejectUnknownKeys(input, POLICY_KEYS, '')

  if (input.$schema !== undefined && typeof input.$schema !== 'string') {
    fail('$schema', 'expected a string — the path or URL of policy.schema.json')
  }
  if (typeof input.entitySet !== 'string' || input.entitySet.length === 0) {
    fail('entitySet', 'required — declare which entity set this policy was written against')
  }
  if (!isPlainObject(input.entities)) {
    fail('entities', 'required — an object with one rule per entity type')
  }
  // Unchecked, a typo here loaded fine and then failed on the first unmapped
  // finding with an internal error that named neither the field nor the typo.
  if (input.onUnmapped !== undefined && !ON_UNMAPPED.has(input.onUnmapped)) {
    fail('onUnmapped', 'expected one of redact|flag|ignore')
  }
  if (input.placeholderLanguage !== undefined && !LANGUAGES.has(input.placeholderLanguage)) {
    fail('placeholderLanguage', 'expected th or en')
  }

  for (const [entity, rule] of Object.entries(input.entities)) {
    if (!ENTITY_SET.has(entity)) {
      fail(`entities.${entity}`, 'unknown entity type (a typo here leaves data unprotected)')
    }
    if (rule === undefined) continue
    checkRule(entity, rule)
  }

  // Compiled here only to fail at load — a bad pattern must stop the policy,
  // not the first message it meets. The guard compiles its own copy.
  compileAllowlist(input.allowlist)

  // Copied and frozen, rules and all: holding the caller's object let a change
  // made after loading reach the guard under the hash of the old policy (D20).
  const entities: Record<string, EntityRule> = {}
  for (const [entity, rule] of Object.entries(input.entities)) {
    if (rule === undefined) continue
    entities[entity] = Object.freeze({
      ...rule,
      ...(rule.allowedPurposes === undefined
        ? {}
        : { allowedPurposes: Object.freeze([...rule.allowedPurposes]) }),
    })
  }

  const out = {
    entitySet: input.entitySet,
    onUnmapped: input.onUnmapped ?? 'redact',
    entities: Object.freeze(entities),
    placeholderLanguage: input.placeholderLanguage ?? 'th',
    allowlist: Object.freeze({
      exact: Object.freeze([...(input.allowlist?.exact ?? [])]),
      pattern: Object.freeze([...(input.allowlist?.pattern ?? [])]),
    }),
    hash: hashPolicy(input),
  }
  const policy = Object.freeze(out) as unknown as CompiledPolicy
  COMPILED.add(policy)
  return policy
}

/**
 * Policies definePolicy built. A copy made with `{ ...policy }` keeps the
 * compiled marker and whatever was changed in it, so the marker alone could
 * not tell one from the other (D20). Kept on globalThis under a registered
 * symbol, so the ESM and CommonJS builds loaded side by side share it: a
 * policy from one is still accepted by the other's createGuard.
 */
const REGISTRY = Symbol.for('eve-pdpa-extension.compiled-policies')
const COMPILED: WeakSet<object> = ((globalThis as Record<symbol, unknown>)[REGISTRY] ??=
  new WeakSet<object>()) as WeakSet<object>

/** True only for the object definePolicy or parsePolicy returned. */
export function isCompiledPolicy(policy: unknown): policy is CompiledPolicy {
  return typeof policy === 'object' && policy !== null && COMPILED.has(policy)
}

/** core does no file or YAML handling — that lives in @eve-pdpa-extension/policy. */
export function parsePolicy(json: string): CompiledPolicy {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    fail('policy', 'not valid JSON')
  }
  return definePolicy(parsed as PolicyInput)
}

export function actionFor(policy: CompiledPolicy, entity: EntityType): Action | null {
  const rule = policy.entities[entity]
  if (rule !== undefined) return rule.action
  if (policy.onUnmapped === 'ignore') return null
  return policy.onUnmapped
}
