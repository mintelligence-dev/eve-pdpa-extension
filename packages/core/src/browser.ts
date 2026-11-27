import { PdpaError } from './errors.js'
import { createGuard } from './guard.js'
import { isCompiledPolicy } from './policy.js'
import type { Action, Guard, GuardOptions } from './types.js'

/**
 * Actions that need no secret. `hash` needs a key and `tokenise` needs a token
 * store and a way back to the real value; in a browser, anyone with the page
 * can read both.
 */
const BROWSER_ACTIONS: ReadonlySet<Action> = new Set(['redact', 'mask', 'flag', 'block'])

export type BrowserGuardOptions = Omit<GuardOptions, 'hmacKey' | 'tokenStore' | 'randomSource'>

/**
 * A guard for code that runs in the user's own browser, for example to hide
 * personal data before a message is sent up to your server.
 *
 * It refuses a policy that uses `hash` or `tokenise`, at construction, and
 * takes no key or token store. It is a courtesy to the user and a first line
 * before the message leaves their device. It is not a control: the person
 * holding the page can edit or skip it, so the server must run its own guard.
 */
export function createBrowserGuard(options: BrowserGuardOptions): Guard {
  const { policy } = options
  if (!isCompiledPolicy(policy)) {
    throw new PdpaError(
      'ERR_PDPA_INVALID_POLICY',
      'createBrowserGuard requires a policy built by definePolicy() or parsePolicy(), used as returned',
    )
  }
  for (const [entity, rule] of Object.entries(policy.entities)) {
    if (rule !== undefined && !BROWSER_ACTIONS.has(rule.action)) {
      throw new PdpaError(
        'ERR_PDPA_INVALID_POLICY',
        `entities.${entity}: "${rule.action}" is not available in the browser (use redact, mask, flag or block) — a key or token in a page can be read by anyone`,
      )
    }
  }
  return createGuard(options)
}
