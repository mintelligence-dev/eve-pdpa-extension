import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import { definePolicy } from '../src/policy.js'

/**
 * The schema and definePolicy must agree on every policy: an editor that shows
 * no error for a file that then fails to load, or the reverse, teaches people to
 * ignore one of them. This file is what keeps them in step.
 *
 * Ajv is a dev dependency used only here; core itself ships with none.
 */

const schema = JSON.parse(
  readFileSync(new URL('../schema/policy.schema.json', import.meta.url), 'utf8'),
)
// validateFormats off: JSON Schema cannot check that a string is a valid regex
// without a formats plugin, and that one rule is definePolicy's alone — see below.
const validate = new Ajv2020({
  strict: true,
  strictRequired: false,
  validateFormats: false,
}).compile(schema)

const schemaAccepts = (policy: unknown) => validate(policy) === true
const loaderAccepts = (policy: unknown) => {
  try {
    definePolicy(policy as never)
    return true
  } catch {
    return false
  }
}

function expectAgreement(policy: unknown) {
  const s = schemaAccepts(policy)
  const l = loaderAccepts(policy)
  if (s !== l) {
    throw new Error(
      `schema ${s ? 'accepts' : 'rejects'} but definePolicy ${l ? 'accepts' : 'rejects'}: ${JSON.stringify(policy)}`,
    )
  }
}

describe('every combination of rule fields', () => {
  const absent = Symbol('absent')
  const actions = ['redact', 'mask', 'tokenise', 'hash', 'flag', 'block', 'delete']
  const keeps = [absent, 'last4', 'first4']
  const ttls = [absent, 0, 1, 300, 3600, 3601, 1.5, '300']
  const purposes = [absent, [], [''], ['otp_send'], ['otp_send', 'kyc'], 'otp_send', [1]]
  const confidences = [absent, 0, 0.5, 1, 1.5, -0.1, '0.9']

  it(`agrees on all ${actions.length * keeps.length * ttls.length * purposes.length * confidences.length} of them`, () => {
    for (const action of actions)
      for (const keep of keeps)
        for (const ttlSec of ttls)
          for (const allowedPurposes of purposes)
            for (const minConfidence of confidences) {
              const rule: Record<string, unknown> = { action }
              if (keep !== absent) rule.keep = keep
              if (ttlSec !== absent) rule.ttlSec = ttlSec
              if (allowedPurposes !== absent) rule.allowedPurposes = allowedPurposes
              if (minConfidence !== absent) rule.minConfidence = minConfidence
              expectAgreement({ entitySet: '0.1', entities: { PHONE: rule } })
            }
  })
})

describe('display, against every action', () => {
  const absent = Symbol('absent')
  const actions = ['redact', 'mask', 'tokenise', 'hash', 'flag', 'block']
  const displays = [absent, 'mask', 'redact', 'reveal', '', 1]

  it(`agrees on all ${actions.length * displays.length} of them`, () => {
    for (const action of actions)
      for (const display of displays) {
        const rule: Record<string, unknown> = { action }
        if (action === 'tokenise') rule.allowedPurposes = ['otp_send']
        if (display !== absent) rule.display = display
        expectAgreement({ entitySet: '0.1', entities: { PHONE: rule } })
      }
  })
})

describe('the top level', () => {
  const base = { entitySet: '0.1', entities: { PHONE: { action: 'redact' } } }

  for (const [name, policy] of Object.entries({
    'a minimal policy': base,
    'a $schema pointer': { $schema: './policy.schema.json', ...base },
    'a $schema that is not a string': { $schema: 1, ...base },
    'no entitySet': { entities: base.entities },
    'an empty entitySet': { ...base, entitySet: '' },
    'no entities': { entitySet: '0.1' },
    'entities that is not an object': { entitySet: '0.1', entities: [] },
    'an empty entities object': { entitySet: '0.1', entities: {} },
    'an unknown entity': { entitySet: '0.1', entities: { PASSPORT: { action: 'redact' } } },
    'a rule with no action': { entitySet: '0.1', entities: { PHONE: {} } },
    'a misspelt rule field': {
      entitySet: '0.1',
      entities: { PHONE: { action: 'mask', keeps: 'last4' } },
    },
    'onUnmapped: flag': { ...base, onUnmapped: 'flag' },
    'onUnmapped: ignore': { ...base, onUnmapped: 'ignore' },
    'onUnmapped: block': { ...base, onUnmapped: 'block' },
    'onUnmapped: garbage': { ...base, onUnmapped: 'garbage' },
    'placeholderLanguage: en': { ...base, placeholderLanguage: 'en' },
    'placeholderLanguage: ja': { ...base, placeholderLanguage: 'ja' },
    'a misspelt top-level field': { ...base, allowList: { exact: ['x'] } },
    'an allowlist': { ...base, allowlist: { exact: ['02-123-4567'], pattern: ['.*@shop\\.th'] } },
    'an empty allowlist': { ...base, allowlist: {} },
    'an allowlist with a misspelt field': { ...base, allowlist: { exacts: ['x'] } },
    'allowlist entries that are not strings': { ...base, allowlist: { exact: [1] } },
    'allowlist that is not an object': { ...base, allowlist: ['x'] },
  })) {
    it(name, () => expectAgreement(policy))
  }
})

describe('where they are known to differ', () => {
  it('only definePolicy can tell that a pattern is not a valid regular expression', () => {
    // The schema marks the field format: regex for editors that support it, but
    // validation of that format is not part of JSON Schema itself.
    const policy = {
      entitySet: '0.1',
      entities: { PHONE: { action: 'redact' } },
      allowlist: { pattern: ['0918887777['] },
    }
    expect(schemaAccepts(policy)).toBe(true)
    expect(loaderAccepts(policy)).toBe(false)
  })
})

describe('the schema file', () => {
  it('names every entity the library supports, and no others', async () => {
    const { ENTITY_TYPES } = await import('../src/types.js')
    expect(Object.keys(schema.properties.entities.properties).sort()).toEqual(
      [...ENTITY_TYPES].sort(),
    )
  })

  it('names every action the library supports, and no others', async () => {
    const { ACTIONS } = await import('../src/types.js')
    expect([...schema.$defs.rule.properties.action.enum].sort()).toEqual([...ACTIONS].sort())
  })
})
