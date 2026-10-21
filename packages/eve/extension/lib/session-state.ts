import { defineState } from 'eve/context'
import { derivePdpaSessionId, sessionConversation } from './session.js'

/**
 * Where pdpaHook leaves the conversation's pdpa session id for the rest of the
 * session: tools, the model middleware and the Slack renderer read it here,
 * since none of them can see the channel address. Durable per session, and
 * never shared with subagents (eve's rule for state).
 */
const pdpaSession = defineState('eve-pdpa-extension.session', () => ({
  id: null as string | null,
}))

/** The stored id, or null outside an eve callback or before pdpaHook ran. */
export function storedPdpaSessionId(): string | null {
  try {
    return pdpaSession.get().id
  } catch {
    return null
  }
}

/** Keeps the first id a session sees: an alias added later must not move its tokens. */
export function storePdpaSessionId(id: string): void {
  try {
    pdpaSession.update((current) => (current.id === null ? { id } : current))
  } catch {}
}

/**
 * The id for the session a tool, renderer or model call runs in. Without a
 * stored id — no pdpaHook, or a session eve's HTTP channel created — it is
 * derived from the eve session id, which is what the HTTP channel wrapper
 * used when the message came in.
 */
export async function currentPdpaSessionId(
  sessionKey: string,
  eveSessionId: string,
): Promise<string> {
  return storedPdpaSessionId() ?? derivePdpaSessionId(sessionKey, sessionConversation(eveSessionId))
}
