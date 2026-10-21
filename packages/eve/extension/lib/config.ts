import type { Guard } from '@eve-pdpa-extension/core'
import type { PdpaHookOptions } from './hook.js'
import { checkSessionKey } from './session.js'
import type { StandardSchemaV1 } from './standard-schema.js'

/**
 * What `agent/extensions/<name>.ts` passes to the mount:
 * `pdpa({ guard, sessionKey })`. eve binds the config when the agent loads
 * the mount and keeps it in memory, so a live guard object can travel in it.
 */
export interface PdpaExtensionConfig {
  readonly guard: Guard
  readonly sessionKey: string
  readonly files?: 'pass' | 'block' | undefined
  readonly blockOn?: readonly string[] | undefined
  readonly language?: 'th' | 'en' | undefined
  readonly onUnmasked?: PdpaHookOptions['onUnmasked'] | undefined
  readonly strict?: boolean | undefined
}

const KEYS: ReadonlySet<string> = new Set([
  'guard',
  'sessionKey',
  'files',
  'blockOn',
  'language',
  'onUnmasked',
  'strict',
])

type Issue = StandardSchemaV1.Issue

function validate(value: unknown): StandardSchemaV1.Result<PdpaHookOptions> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { issues: [{ message: 'expected an object such as { guard, sessionKey }' }] }
  }
  const fields = value as Record<string, unknown>
  const issues: Issue[] = []
  // A misspelt field is an error, not a silent default — as core does for a policy.
  for (const k of Object.keys(fields)) {
    if (!KEYS.has(k)) issues.push({ path: [k], message: 'unknown field — check the spelling' })
  }
  const g = fields.guard as Partial<Guard> | undefined
  if (
    typeof g !== 'object' ||
    g === null ||
    typeof g.process !== 'function' ||
    typeof g.endSession !== 'function'
  ) {
    issues.push({
      path: ['guard'],
      message: "expected a guard from @eve-pdpa-extension/core's createGuard()",
    })
  }
  try {
    checkSessionKey(fields.sessionKey)
  } catch (error) {
    // The message names the rule, never the key.
    issues.push({
      path: ['sessionKey'],
      message: error instanceof Error ? error.message : 'invalid',
    })
  }
  if (fields.files !== undefined && fields.files !== 'pass' && fields.files !== 'block') {
    issues.push({ path: ['files'], message: 'expected "pass" or "block"' })
  }
  if (
    fields.blockOn !== undefined &&
    !(Array.isArray(fields.blockOn) && fields.blockOn.every((e) => typeof e === 'string'))
  ) {
    issues.push({ path: ['blockOn'], message: 'expected a list of entity types' })
  }
  if (fields.language !== undefined && fields.language !== 'th' && fields.language !== 'en') {
    issues.push({ path: ['language'], message: 'expected "th" or "en"' })
  }
  if (fields.onUnmasked !== undefined && typeof fields.onUnmasked !== 'function') {
    issues.push({ path: ['onUnmasked'], message: 'expected a function' })
  }
  if (fields.strict !== undefined && typeof fields.strict !== 'boolean') {
    issues.push({ path: ['strict'], message: 'expected true or false' })
  }
  if (issues.length > 0) return { issues }
  return { value: fields as unknown as PdpaHookOptions }
}

/** Standard Schema for the extension's config. Synchronous, as eve requires. */
export const configSchema: StandardSchemaV1<PdpaExtensionConfig, PdpaHookOptions> = {
  '~standard': { version: 1, vendor: 'eve-pdpa-extension', validate },
}
