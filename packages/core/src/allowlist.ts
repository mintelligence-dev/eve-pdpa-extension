import { canonicalValue } from './actions/canonical.js'
import { PdpaError } from './errors.js'
import { normalise } from './normalise.js'
import type { EntityType, PolicyInput } from './types.js'
import { ENTITY_TYPES } from './types.js'

/**
 * Values a policy lets through even though a detector found them — the shop's
 * own support address, its call-centre number. D1: an allowlisted value is
 * reported with `allowlisted: true` and left in the text.
 */
export interface Allowlist {
  readonly isEmpty: boolean
  allows(entity: EntityType, canonical: string): boolean
}

const EMPTY: Allowlist = { isEmpty: true, allows: () => false }

function invalid(path: string, problem: string): never {
  // Path only. An allowlist holds real values by design; the error must not echo one.
  throw new PdpaError('ERR_PDPA_INVALID_POLICY', `${path}: ${problem}`)
}

function checkStrings(value: unknown, path: string): readonly string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    invalid(path, 'expected an array of strings')
  }
  return value
}

const LINE_USER_ID_SHAPE = /^U[0-9a-f]{32}$/

/**
 * The one form of an allowlist entry that the `policy.loaded` digest is taken
 * of, so `02-123-4567`, `๐๒-๑๒๓-๔๕๖๗` and `021234567` in a policy give one
 * digest, and an investigator holding the value can recompute it.
 *
 * Entries are not tagged with an entity, so the entity is read off the shape:
 * an `@` means email, U + 32 hex a LINE id, anything else a number — and every
 * numeric entity canonicalises the way PHONE does (separators out, +66 → 0),
 * since none of the others can start with +66. The rule is written out in
 * audit-event.schema.json; change one and the other must follow.
 */
export function allowlistDigestForm(entry: string): string {
  const folded = normalise(entry).text
  const entity: EntityType = folded.includes('@')
    ? 'EMAIL'
    : LINE_USER_ID_SHAPE.test(folded)
      ? 'LINE_USER_ID'
      : 'PHONE'
  return canonicalValue(entity, folded)
}

/**
 * Compiles the allowlist once, at load, so a scan never parses a pattern.
 *
 * Both kinds match the CANONICAL form of a value (`actions/canonical.ts`), not
 * the text as typed:
 *
 *   exact    `02-123-4567` in the policy allows ๐๒๑๒๓๔๕๖๗ in a message, because
 *            each entry is canonicalised the same way the found value is
 *   pattern  matched against the canonical value, so it sees `0212345678` and
 *            `support@myshop.co.th`, never separators or upper case
 *
 * A pattern must match the WHOLE value. `^(?:…)$` is added around it, because an
 * unanchored `0` would allow every value containing a zero — an allowlist is the
 * one place where matching too much leaks data. The pattern is compiled on its
 * own first: that rejects unbalanced input like `a)|(b` which would otherwise
 * escape the wrapper and change what the anchors apply to.
 *
 * Patterns only ever run against one found value, never the whole message. A
 * customer's pattern with catastrophic backtracking is still slow, but it is
 * slow over a few dozen characters rather than a whole transcript.
 */
export function compileAllowlist(input: PolicyInput['allowlist']): Allowlist {
  if (input === undefined) return EMPTY
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    invalid('allowlist', 'expected an object with exact and/or pattern')
  }
  // Same rule as the rest of the policy: a misspelt field is an error, not ignored.
  for (const key of Object.keys(input)) {
    if (key !== 'exact' && key !== 'pattern') {
      invalid(`allowlist.${key}`, 'unknown field — check the spelling')
    }
  }

  const exact = checkStrings(input.exact, 'allowlist.exact')
  const pattern = checkStrings(input.pattern, 'allowlist.pattern')
  if (exact.length === 0 && pattern.length === 0) return EMPTY

  // Canonical form depends on the entity (an email keeps its hyphens, a phone
  // number does not), and the list itself is not split by entity, so each entry
  // is canonicalised once per entity it could be compared against.
  const exactByEntity = new Map<EntityType, ReadonlySet<string>>()
  for (const entity of ENTITY_TYPES) {
    exactByEntity.set(entity, new Set(exact.map((e) => canonicalValue(entity, normalise(e).text))))
  }

  const compiled = pattern.map((p, i) => {
    try {
      new RegExp(p, 'u')
      return new RegExp(`^(?:${p})$`, 'u')
    } catch {
      return invalid(`allowlist.pattern[${i}]`, 'not a valid regular expression')
    }
  })

  return {
    isEmpty: false,
    allows(entity, canonical) {
      if (exactByEntity.get(entity)?.has(canonical) === true) return true
      return compiled.some((re) => re.test(canonical))
    },
  }
}
