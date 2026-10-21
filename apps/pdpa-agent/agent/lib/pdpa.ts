import { appendFileSync } from 'node:fs'
import { DEFAULT_POLICY, type GuardOptions } from '@eve-pdpa-extension/eve/guard'

/**
 * One audit line per event, as NDJSON: to PDPA_EXAMPLE_AUDIT_FILE when set,
 * otherwise stdout. Events hold positions and kinds, never a value.
 *
 * `ctx.address` is left out on purpose: it is the platform's conversation id,
 * and on LINE that contains the customer's LINE user id.
 */
const onAudit: GuardOptions['onAudit'] = (event, ctx) => {
  const line = `${JSON.stringify({ ...event, source: ctx.source })}\n`
  const file = process.env.PDPA_EXAMPLE_AUDIT_FILE
  if (file) appendFileSync(file, line)
  else process.stdout.write(line)
}

/** Shared by every channel wrapper and the extension mount. */
export const pdpaOptions: GuardOptions = { policy: DEFAULT_POLICY, onAudit }
