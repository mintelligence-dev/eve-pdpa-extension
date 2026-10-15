// EX — exports and packaging, as the type declarations describe them.
//   bench/user/run features/exports.check.mjs
import assert from 'node:assert/strict'
import * as core from '@thai-pdpa-guard/core'
import * as data from '@thai-pdpa-guard/core/data'
import auditSchema from '@thai-pdpa-guard/core/schema/audit-event.schema.json' with { type: 'json' }
import policySchema from '@thai-pdpa-guard/core/schema/policy.schema.json' with { type: 'json' }
import { check, makeGuard } from '../lib/kit.mjs'

// Every runtime export the type declarations list (types-only exports are not runtime values).
const FUNCTIONS = [
  'isValidLuhn',
  'createEngine',
  'definePolicy',
  'parsePolicy',
  'actionFor',
  'createGuard',
  'normalise',
  'toOriginalStart',
  'toOriginalEnd',
  'toOriginalSpan',
  'isValidThaiNationalId',
  'createMemoryTokenStore',
]
const DETECTORS = [
  'creditCardDetector',
  'bankAccountDetector',
  'emailDetector',
  'lineUserIdDetector',
  'phoneDetector',
  'thaiNationalIdDetector',
]
const CONSTANTS = ['ENTITY_TYPES', 'ACTIONS', 'BOUNDARIES', 'BUILTIN_DETECTORS', 'VERSION']
// What the installed package's manifest says (read by hand: code here may not open package files).
const MANIFEST_VERSION = '0.0.0'
const CHANGELOG_RELEASE = '0.1.0'

check('EX1 every function and constant in the types exists at runtime', () => {
  for (const f of FUNCTIONS) assert.equal(typeof core[f], 'function', `${f} is a function`)
  for (const d of DETECTORS) assert.equal(typeof core[d]?.detect, 'function', `${d}.detect`)
  for (const c of CONSTANTS) assert.ok(core[c] !== undefined, `${c} exported`)
  assert.equal(typeof core.PdpaError, 'function', 'PdpaError class')
  const declared = new Set([...FUNCTIONS, ...DETECTORS, ...CONSTANTS, 'PdpaError'])
  const extra = Object.keys(core).filter((k) => !declared.has(k))
  assert.deepEqual(extra, [], `runtime exports not in the types: ${extra.join(', ')}`)
})

check('EX2 ENTITY_TYPES, ACTIONS, BOUNDARIES hold exactly the documented values', () => {
  assert.deepEqual(
    [...core.ENTITY_TYPES],
    ['TH_NATIONAL_ID', 'PHONE', 'EMAIL', 'BANK_ACCOUNT', 'CREDIT_CARD', 'LINE_USER_ID'],
  )
  assert.deepEqual([...core.ACTIONS], ['redact', 'mask', 'tokenise', 'hash', 'flag', 'block'])
  assert.deepEqual(
    [...core.BOUNDARIES],
    ['inbound', 'prompt', 'tool_input', 'tool_output', 'outbound'],
  )
})

check('EX3a VERSION = the manifest version = engine.version in audit', () => {
  assert.equal(core.VERSION, MANIFEST_VERSION)
  const { events } = makeGuard({ entities: { PHONE: { action: 'redact' } } })
  assert.equal(events[0].engine.version, core.VERSION)
})

check('EX3b the installed version is the release the CHANGELOG describes (0.1.0)', () => {
  // CHANGELOG: "## 0.1.0 — First release". The audit trail would say something else.
  assert.equal(
    core.VERSION,
    CHANGELOG_RELEASE,
    `VERSION and audit engine.version are ${core.VERSION}`,
  )
})

check('EX5 data subpath: DICTIONARIES entries have id, licence, lookup; hasDictionary(id)', (t) => {
  assert.ok(Array.isArray(data.DICTIONARIES), 'DICTIONARIES is an array')
  for (const d of data.DICTIONARIES) {
    assert.equal(typeof d.id, 'string')
    assert.equal(typeof d.licence, 'string')
    assert.equal(typeof d.lookup, 'function')
    assert.equal(typeof d.lookup('สมชาย'), 'boolean')
    assert.equal(data.hasDictionary(d.id), true)
  }
  assert.equal(data.hasDictionary('no-such-dictionary'), false)
  t.diagnostic(
    `DICTIONARIES: ${JSON.stringify(data.DICTIONARIES.map((d) => ({ id: d.id, licence: d.licence })))} — only the types and the manifest mention this subpath; no README or CHANGELOG does`,
  )
})

check(
  'EX6 schema files load through their package subpaths and declare JSON Schema 2020-12',
  () => {
    for (const s of [policySchema, auditSchema])
      assert.equal(s.$schema, 'https://json-schema.org/draft/2020-12/schema')
    assert.equal(policySchema.title, 'thai-pdpa-guard policy')
    assert.equal(auditSchema.title, 'thai-pdpa-guard audit event')
  },
)

check(
  'EX7 allowlistDigestForm, which the types name as the rule for allowlist digests, is available',
  () => {
    // types, PolicyLoadedEvent.policy.allowlist.exact: "The rule is in audit-event.schema.json and `allowlistDigestForm`."
    assert.equal(typeof core.allowlistDigestForm, 'function', 'allowlistDigestForm is not exported')
  },
)
