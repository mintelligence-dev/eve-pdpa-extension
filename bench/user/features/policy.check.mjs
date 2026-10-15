// PO — policy loading and validation: README example, every schema rule, error codes and
// field names, defaults, hash, and agreement between policy.schema.json and parsePolicy.
//   bench/user/run features/policy.check.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { actionFor, createGuard, definePolicy, PdpaError, parsePolicy } from '@thai-pdpa-guard/core'
import policySchema from '@thai-pdpa-guard/core/schema/policy.schema.json' with { type: 'json' }
import { check, expectCode } from '../lib/kit.mjs'
import { validate } from '../lib/schema.mjs'

const README_JSON = readFileSync('policies/readme-example.json', 'utf8')
const README = JSON.parse(README_JSON)
const base = (extra = {}) => ({
  entitySet: '0.1',
  entities: { PHONE: { action: 'redact' } },
  ...extra,
})
const bad = (input, field) => {
  const e = expectCode(() => definePolicy(input), 'ERR_PDPA_INVALID_POLICY')
  if (field) assert.ok(e.message.includes(field), `message names ${field}: ${e.message}`)
  return e
}

check('PO1 the README example loads with parsePolicy; its hash is fnv1a64:ee142dc8b1111706', () => {
  const p = parsePolicy(README_JSON)
  assert.equal(p.hash, 'fnv1a64:ee142dc8b1111706')
})

check('PO2 definePolicy with the same rules gives the same hash', () => {
  const { $schema, ...rest } = README
  assert.equal(definePolicy(rest).hash, parsePolicy(README_JSON).hash)
  assert.equal(definePolicy(README).hash, parsePolicy(README_JSON).hash)
})

check('PO3 $schema is ignored and not part of the hash', () => {
  assert.equal(
    definePolicy({ ...README, $schema: 'https://example.com/other.json' }).hash,
    parsePolicy(README_JSON).hash,
  )
})

check(
  'PO4 a misspelled field — top level, rule, allowlist — is ERR_PDPA_INVALID_POLICY naming the field',
  () => {
    bad(base({ onUnmaped: 'flag' }), 'onUnmaped')
    bad(base({ placeholderLang: 'en' }), 'placeholderLang')
    bad({ entitySet: '0.1', entities: { PHONE: { acton: 'redact' } } }, 'acton')
    bad(
      { entitySet: '0.1', entities: { PHONE: { action: 'redact', minConfidense: 0.6 } } },
      'minConfidense',
    )
    bad(base({ allowlist: { exacts: ['02-123-4567'] } }), 'exacts')
  },
)

check('PO5 entitySet is required and non-empty', () => {
  bad({ entities: {} }, 'entitySet')
  bad({ entitySet: '', entities: {} }, 'entitySet')
})

check('PO6 entities is required; an unknown entity name is refused', () => {
  bad({ entitySet: '0.1' }, 'entities')
  bad({ entitySet: '0.1', entities: { PASSPORT: { action: 'redact' } } }, 'PASSPORT')
  bad({ entitySet: '0.1', entities: { phone: { action: 'redact' } } }, 'phone')
})

check('PO7 action is required and must be one of the six', () => {
  bad({ entitySet: '0.1', entities: { PHONE: {} } }, 'action')
  bad({ entitySet: '0.1', entities: { PHONE: { action: 'encrypt' } } }, 'action')
})

check('PO8 minConfidence must be a number 0..1 inside a rule; top-level is refused', () => {
  for (const v of [1.5, -0.1, '0.9', null])
    bad(
      { entitySet: '0.1', entities: { PHONE: { action: 'redact', minConfidence: v } } },
      'minConfidence',
    )
  bad(base({ minConfidence: 0.6 }), 'minConfidence')
  definePolicy({ entitySet: '0.1', entities: { PHONE: { action: 'redact', minConfidence: 0 } } })
  definePolicy({ entitySet: '0.1', entities: { PHONE: { action: 'redact', minConfidence: 1 } } })
})

check('PO9 keep is only "last4" and only with mask', () => {
  bad({ entitySet: '0.1', entities: { PHONE: { action: 'mask', keep: 'last3' } } }, 'keep')
  bad({ entitySet: '0.1', entities: { PHONE: { action: 'redact', keep: 'last4' } } }, 'keep')
  definePolicy({ entitySet: '0.1', entities: { PHONE: { action: 'mask', keep: 'last4' } } })
})

check('PO10 ttlSec is an integer 1..3600, tokenise only', () => {
  const tok = (ttlSec) => ({
    entitySet: '0.1',
    entities: { PHONE: { action: 'tokenise', allowedPurposes: ['p'], ttlSec } },
  })
  for (const v of [0, 3601, 1.5, '300']) bad(tok(v), 'ttlSec')
  definePolicy(tok(1))
  definePolicy(tok(3600))
  bad({ entitySet: '0.1', entities: { PHONE: { action: 'redact', ttlSec: 300 } } }, 'ttlSec')
})

check('PO11 allowedPurposes is required for tokenise, ≥1 non-empty strings, tokenise only', () => {
  bad(
    { entitySet: '0.1', entities: { PHONE: { action: 'tokenise' } } },
    'entities.PHONE.allowedPurposes',
  )
  bad(
    { entitySet: '0.1', entities: { PHONE: { action: 'tokenise', allowedPurposes: [] } } },
    'allowedPurposes',
  )
  bad(
    { entitySet: '0.1', entities: { PHONE: { action: 'tokenise', allowedPurposes: [''] } } },
    'allowedPurposes',
  )
  bad(
    { entitySet: '0.1', entities: { PHONE: { action: 'mask', allowedPurposes: ['p'] } } },
    'allowedPurposes',
  )
})

check(
  'PO11b the error for a tokenise rule without purposes reads as the CLI README shows it',
  () => {
    const e = bad({ entitySet: '0.1', entities: { PHONE: { action: 'tokenise' } } })
    assert.ok(
      e.message.includes('entities.PHONE.allowedPurposes: required for tokenise'),
      e.message,
    )
  },
)

check('PO12 display is mask|redact and only with tokenise', () => {
  bad(
    {
      entitySet: '0.1',
      entities: { PHONE: { action: 'tokenise', allowedPurposes: ['p'], display: 'hidden' } },
    },
    'display',
  )
  bad({ entitySet: '0.1', entities: { PHONE: { action: 'mask', display: 'mask' } } }, 'display')
})

check('PO13 onUnmapped and placeholderLanguage take only their enum values', () => {
  bad(base({ onUnmapped: 'block' }), 'onUnmapped')
  bad(base({ placeholderLanguage: 'jp' }), 'placeholderLanguage')
})

check('PO14 allowlist.exact / pattern are string arrays; a pattern must be a valid regex', () => {
  bad(base({ allowlist: { exact: [21234567] } }), 'exact')
  bad(base({ allowlist: { exact: '02-123-4567' } }), 'exact')
  bad(base({ allowlist: { pattern: ['(unclosed'] } }), 'pattern')
})

check('PO15 parsePolicy on text that is not JSON → ERR_PDPA_INVALID_POLICY', () => {
  for (const s of ['{not json', '', 'null', '[]', '"policy"'])
    expectCode(() => parsePolicy(s), 'ERR_PDPA_INVALID_POLICY')
})

check(
  'PO16 compiled policy defaults: onUnmapped redact, placeholderLanguage th, empty allowlist, hash',
  () => {
    const p = definePolicy(base())
    assert.equal(p.onUnmapped, 'redact')
    assert.equal(p.placeholderLanguage, 'th')
    assert.deepEqual(p.allowlist, { exact: [], pattern: [] })
    assert.match(p.hash, /^[a-z0-9]+:[0-9a-f]+$/)
    assert.equal(p.entitySet, '0.1')
  },
)

check('PO17 the shipped schema and parsePolicy accept and refuse the same policies', (t) => {
  const tok = { action: 'tokenise', allowedPurposes: ['otp_send'] }
  const cases = [
    README,
    base(),
    { entitySet: '0.1', entities: {} },
    { entitySet: '0.2', entities: { PHONE: { action: 'redact' } } },
    { entitySet: '0.1', entities: { PHONE: tok } },
    { entitySet: '0.1', entities: { PHONE: { ...tok, ttlSec: 3600, display: 'redact' } } },
    { entitySet: '0.1', entities: { PHONE: { ...tok, ttlSec: 0 } } },
    { entitySet: '0.1', entities: { PHONE: { ...tok, ttlSec: 59.5 } } },
    { entitySet: '0.1', entities: { PHONE: { action: 'tokenise' } } },
    { entitySet: '0.1', entities: { PHONE: { ...tok, allowedPurposes: [] } } },
    { entitySet: '0.1', entities: { PHONE: { ...tok, allowedPurposes: [''] } } },
    { entitySet: '0.1', entities: { PHONE: { ...tok, allowedPurposes: ['otp', 'otp'] } } },
    { entitySet: '0.1', entities: { PHONE: { action: 'mask', keep: 'last4' } } },
    { entitySet: '0.1', entities: { PHONE: { action: 'hash', keep: 'last4' } } },
    { entitySet: '0.1', entities: { PHONE: { action: 'mask', display: 'mask' } } },
    { entitySet: '0.1', entities: { PHONE: { action: 'block', minConfidence: 0.6 } } },
    { entitySet: '0.1', entities: { PHONE: { action: 'block', minConfidence: 2 } } },
    { entitySet: '0.1', entities: { PHONE: { action: 'flag', minConfidence: 0 } } },
    { entitySet: '0.1', entities: { PHONE: { action: 'nope' } } },
    { entitySet: '0.1', entities: { PHONE: {} } },
    { entitySet: '0.1', entities: { PHONE: null } },
    { entitySet: '0.1', entities: { EMAIL: { action: 'hash' } }, onUnmapped: 'ignore' },
    { entitySet: '0.1', entities: {}, onUnmapped: 'mask' },
    { entitySet: '0.1', entities: {}, placeholderLanguage: 'en' },
    { entitySet: '0.1', entities: {}, placeholderLanguage: 'EN' },
    { entitySet: '0.1', entities: {}, allowlist: {} },
    { entitySet: '0.1', entities: {}, allowlist: { exact: [], pattern: [] } },
    { entitySet: '0.1', entities: {}, allowlist: { exact: [''] } },
    { entitySet: '0.1', entities: {}, allowlist: { pattern: ['[a-'] } },
    { entitySet: '0.1', entities: {}, allowlist: { pattern: ['\\p{L}+'] } },
    { entitySet: '0.1', entities: {}, allowlist: { pattern: ['(?<shop>.*)@myshop\\.co\\.th'] } },
    { entitySet: '0.1', entities: {}, allowlist: { domains: ['myshop.co.th'] } },
    { entitySet: '0.1', entities: {}, extra: true },
    { entitySet: 1, entities: {} },
    { entitySet: '0.1', entities: [] },
    { $schema: 42, entitySet: '0.1', entities: {} },
  ]
  const disagree = []
  for (const input of cases) {
    const schemaOk = validate(policySchema, input).length === 0
    let parseOk = true
    let why = ''
    try {
      parsePolicy(JSON.stringify(input))
    } catch (e) {
      if (!(e instanceof PdpaError)) throw e
      parseOk = false
      why = e.message
    }
    if (schemaOk !== parseOk)
      disagree.push(
        `${JSON.stringify(input).slice(0, 120)} — schema ${schemaOk ? 'accepts' : 'refuses'}, parsePolicy ${parseOk ? 'accepts' : `refuses (${why})`}`,
      )
  }
  for (const d of disagree) t.diagnostic(d)
  assert.deepEqual(disagree, [])
})

check('PO18 actionFor(policy, entity) returns the rule action for a listed entity', (t) => {
  const p = parsePolicy(README_JSON)
  assert.equal(actionFor(p, 'PHONE'), 'tokenise')
  assert.equal(actionFor(p, 'CREDIT_CARD'), 'block')
  const seen = ['redact', 'flag', 'ignore'].map(
    (onUnmapped) =>
      `${onUnmapped}→${actionFor(definePolicy({ entitySet: '0.1', entities: {}, onUnmapped }), 'EMAIL')}`,
  )
  t.diagnostic(`unlisted entity (not documented): ${seen.join(', ')}`)
})

check('PO19 createGuard refuses a plain object as policy', () => {
  assert.throws(() =>
    createGuard({
      policy: { entitySet: '0.1', entities: { PHONE: { action: 'redact' } } },
      onAudit: () => {},
    }),
  )
})

check(
  'PO19b createGuard refuses a compiled policy changed by object spread (types: "accepts nothing else")',
  (t) => {
    const loaded = definePolicy(base())
    const events = []
    const tweaked = {
      ...loaded,
      entities: { PHONE: { action: 'flag' } },
      allowlist: { exact: [], pattern: ['.*'] },
    }
    let accepted = false
    try {
      const g = createGuard({ policy: tweaked, onAudit: (e) => events.push(e) })
      accepted = true
      const r = g.processSync('เบอร์ 0918887777')
      t.diagnostic(
        `accepted: text ${JSON.stringify(r.text)}, policy.loaded.hash ${events[0].policy.hash} (original ${loaded.hash}), rules ${JSON.stringify(events[0].policy.entities)}`,
      )
    } catch (e) {
      t.diagnostic(`refused: ${e.code ?? e.name}`)
    }
    let invalidError
    try {
      createGuard({
        policy: { ...loaded, entities: { PHONE: { action: 'nonsense' } } },
        onAudit: () => {},
      })
    } catch (e) {
      invalidError = e
    }
    t.diagnostic(
      `spread copy with action "nonsense": ${invalidError ? `${invalidError.constructor.name} ${invalidError.code ?? ''} ${invalidError.message}` : 'accepted'}`,
    )
    assert.equal(
      accepted,
      false,
      'a spread copy with new rules was accepted, and its events carry the old policy hash',
    )
    assert.ok(
      invalidError instanceof PdpaError,
      'an invalid rule smuggled in by spread is not refused with a PdpaError',
    )
  },
)

check(
  'PO20 same rules → same hash (also in another key order); changed rules or allowlist → a new hash',
  () => {
    const a = definePolicy({
      entitySet: '0.1',
      entities: { PHONE: { action: 'redact' }, EMAIL: { action: 'mask' } },
    })
    const b = definePolicy({
      entities: { EMAIL: { action: 'mask' }, PHONE: { action: 'redact' } },
      entitySet: '0.1',
    })
    assert.equal(a.hash, b.hash)
    assert.notEqual(
      definePolicy({
        entitySet: '0.1',
        entities: { PHONE: { action: 'mask' }, EMAIL: { action: 'mask' } },
      }).hash,
      a.hash,
    )
    const withAllow = definePolicy({
      entitySet: '0.1',
      entities: { PHONE: { action: 'redact' }, EMAIL: { action: 'mask' } },
      allowlist: { exact: ['02-123-4567'] },
    })
    assert.notEqual(withAllow.hash, a.hash)
  },
)
