// Shared helpers for the feature checks.

import { writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { test } from 'node:test'
import { createGuard, definePolicy, ENTITY_TYPES, PdpaError } from '@eve-pdpa-extension/core'
import auditSchema from '@eve-pdpa-extension/core/schema/audit-event.schema.json' with {
  type: 'json',
}
import { validate } from './schema.mjs'

/** 44 bytes, random-looking, only for tests. */
export const KEY = 'bench-only-hmac-key-7f3a91c04be2d58e6a1f0c9d'

/** One rule for all six entities. */
export const allRules = (rule) => Object.fromEntries(ENTITY_TYPES.map((e) => [e, { ...rule }]))

/** A guard plus everything it reported. Always passes onAudit (no warning side effects). */
export function makeGuard(policyInput, options = {}) {
  const events = []
  const errors = []
  const policy =
    policyInput.hash && policyInput.entities
      ? policyInput
      : definePolicy({ entitySet: '0.1', ...policyInput })
  const guard = createGuard({
    policy,
    hmacKey: KEY,
    onAudit: (e) => events.push(e),
    onError: (error, ctx) => errors.push({ error, ctx }),
    ...options,
  })
  return {
    guard,
    events,
    errors,
    policy,
    scans: () => events.filter((e) => e.type === 'scan'),
    resolves: () => events.filter((e) => e.type === 'token.resolve'),
  }
}

/** Findings as { entity, value } pairs, the value cut from the original text. */
export const found = (text, result) =>
  result.findings.map((f) => ({
    entity: f.entity,
    value: text.slice(f.start, f.end),
    confidence: f.confidence,
  }))

/** Every string inside an object, at any depth. */
export function strings(obj) {
  const out = []
  const walk = (x) => {
    if (typeof x === 'string') out.push(x)
    else if (Array.isArray(x)) x.forEach(walk)
    else if (x && typeof x === 'object') Object.values(x).forEach(walk)
  }
  walk(obj)
  return out
}

/** Schema errors for an audit event (empty = valid). */
export const schemaErrors = (event) => validate(auditSchema, event)

/** Asserts fn throws a PdpaError with this code; returns the error. */
export function expectCode(fn, code) {
  let caught
  try {
    fn()
  } catch (e) {
    caught = e
  }
  if (!caught) throw new Error(`expected ${code}, nothing was thrown`)
  if (!(caught instanceof PdpaError))
    throw new Error(
      `expected PdpaError ${code}, got ${caught?.constructor?.name}: ${caught?.message}`,
    )
  if (caught.code !== code)
    throw new Error(`expected ${code}, got ${caught.code}: ${caught.message}`)
  return caught
}
export async function expectCodeAsync(fn, code) {
  let caught
  try {
    await fn()
  } catch (e) {
    caught = e
  }
  if (!caught) throw new Error(`expected ${code}, nothing was thrown`)
  if (!(caught instanceof PdpaError))
    throw new Error(
      `expected PdpaError ${code}, got ${caught?.constructor?.name}: ${caught?.message}`,
    )
  if (caught.code !== code)
    throw new Error(`expected ${code}, got ${caught.code}: ${caught.message}`)
  return caught
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- results file, so COVERAGE.md can be checked against the last run ----
const RESULTS = {}
const entry = basename(process.argv[1] ?? 'checks').replace(/\.m?js$/, '')
process.on('exit', () => {
  try {
    writeFileSync(`out/features-${entry}.json`, JSON.stringify(RESULTS, null, 2))
  } catch {}
})

/** node:test `test`, recording pass/fail per test id for out/features-<entry>.json. */
export function check(name, fn) {
  return test(name, async (t) => {
    try {
      await fn(t)
      RESULTS[name] = 'pass'
    } catch (e) {
      RESULTS[name] = `FAIL: ${String(e?.message ?? e)
        .split('\n')[0]
        .slice(0, 300)}`
      throw e
    }
  })
}
