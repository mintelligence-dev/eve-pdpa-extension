import {
  type CompiledPolicy,
  createGuard,
  definePolicy,
  PdpaError,
  type PolicyInput,
} from '@eve-pdpa-extension/core'
import type { GuardOptions } from './content.js'
import { DEFAULT_POLICY, refuseTokenise } from './policy.js'
import type { StandardSchemaV1 } from './standard-schema.js'

/** What `agent/extensions/<name>.ts` passes to the mount: `pdpa({ policy })`. */
export interface PdpaExtensionConfig {
  /** A policy as core's `definePolicy` takes it — the parsed JSON of a policy file. Defaults to `DEFAULT_POLICY`. */
  readonly policy?: PolicyInput | undefined
  /** For a policy that uses `hash`. At least 32 bytes. */
  readonly hmacKey?: string | Uint8Array | undefined
  /** `block` cancels a turn whose message has a file. Default `pass`. */
  readonly files?: 'pass' | 'block' | undefined
  readonly onAudit?: GuardOptions['onAudit'] | undefined
  readonly onError?: GuardOptions['onError'] | undefined
}

const KEYS: ReadonlySet<string> = new Set(['policy', 'hmacKey', 'files', 'onAudit', 'onError'])

type Issue = StandardSchemaV1.Issue

function validate(value: unknown): StandardSchemaV1.Result<GuardOptions> {
  const input = value ?? {}
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { issues: [{ message: 'expected an object such as { policy }' }] }
  }
  const fields = input as Record<string, unknown>
  const issues: Issue[] = []
  // As core does for a policy: a misspelt field is an error, not a silent default.
  for (const key of Object.keys(fields)) {
    if (!KEYS.has(key)) issues.push({ path: [key], message: 'unknown field — check the spelling' })
  }

  let policy: CompiledPolicy = DEFAULT_POLICY
  if (fields.policy !== undefined) {
    try {
      // core's messages name the field, never a value: safe to surface.
      policy = definePolicy(fields.policy as PolicyInput)
      refuseTokenise(policy)
    } catch (error) {
      issues.push({
        path: ['policy'],
        message: error instanceof PdpaError ? error.message : 'invalid policy',
      })
    }
  }
  const { hmacKey, files, onAudit, onError } = fields
  if (hmacKey !== undefined && typeof hmacKey !== 'string' && !(hmacKey instanceof Uint8Array)) {
    issues.push({ path: ['hmacKey'], message: 'expected a string or Uint8Array' })
  }
  if (files !== undefined && files !== 'pass' && files !== 'block') {
    issues.push({ path: ['files'], message: 'expected "pass" or "block"' })
  }
  if (onAudit !== undefined && typeof onAudit !== 'function') {
    issues.push({ path: ['onAudit'], message: 'expected a function' })
  }
  if (onError !== undefined && typeof onError !== 'function') {
    issues.push({ path: ['onError'], message: 'expected a function' })
  }
  if (issues.length > 0) return { issues }

  const options: GuardOptions = {
    policy,
    ...(hmacKey === undefined ? {} : { hmacKey: hmacKey as string | Uint8Array }),
    ...(files === undefined ? {} : { files: files as 'pass' | 'block' }),
    ...(onAudit === undefined ? {} : { onAudit: onAudit as GuardOptions['onAudit'] & {} }),
    ...(onError === undefined ? {} : { onError: onError as GuardOptions['onError'] & {} }),
  }

  // A policy that hashes without a usable key fails here, at the mount, rather
  // than on the first message. A throwaway guard with a silent sink, so the
  // caller's audit gets no policy.loaded for a guard that never runs.
  try {
    createGuard({
      policy,
      onAudit: () => {},
      ...(options.hmacKey === undefined ? {} : { hmacKey: options.hmacKey }),
    })
  } catch (error) {
    return {
      issues: [
        {
          path: ['hmacKey'],
          message: error instanceof PdpaError ? error.message : 'the guard could not be built',
        },
      ],
    }
  }
  return { value: options }
}

/** Standard Schema for the extension's config. Synchronous, as eve requires. */
export const configSchema: StandardSchemaV1<PdpaExtensionConfig, GuardOptions> = {
  '~standard': { version: 1, vendor: 'eve-pdpa-extension', validate },
}
