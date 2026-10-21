import { appendFileSync } from 'node:fs'
import {
  type AuditRecord,
  createGuard,
  definePolicy,
  type Guard,
  type PolicyInput,
} from '@eve-pdpa-extension/core'
import policyFile from '../../policies/pdpa-policy.json' with { type: 'json' }
import { secret } from './env.js'
import { tokenStore } from './store.js'

// The one guard of this agent: every channel, tool, the model middleware, the
// Slack renderer and the hook use it. Real values only ever sit in tokenStore.

// Imported, not read from disk at run time: eve bundles agent modules, and a
// path built from import.meta.url would point into the bundle.
export const policy = definePolicy(policyFile as PolicyInput)

// Development values: fine for `eve dev`, refused in production (lib/env.ts).
export const sessionKey = secret(
  'PDPA_SESSION_KEY',
  'pdpa-agent-dev-session-key-not-for-production',
)
const hmacKey = secret('PDPA_HMAC_KEY', 'pdpa-agent-dev-hmac-key-not-for-production-use')

/**
 * One NDJSON line per audit event: to PDPA_TEMPLATE_AUDIT_FILE when set,
 * otherwise stdout. Events hold positions, kinds and the derived session id —
 * never a value. Keep them apart from message logs.
 */
function onAudit(event: AuditRecord): void {
  const line = `${JSON.stringify(event)}\n`
  const file = process.env.PDPA_TEMPLATE_AUDIT_FILE
  if (file) appendFileSync(file, line)
  else process.stdout.write(line)
}

export const guard: Guard = createGuard({ policy, hmacKey, tokenStore, onAudit })

/** Spread into every helper from @eve-pdpa-extension/eve/guard. */
export const pdpa = { guard, sessionKey } as const
