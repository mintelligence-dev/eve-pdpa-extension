/**
 * The session id core writes into every audit event and keeps tokens apart
 * by. Core warns against platform ids there — a LINE thread id holds the
 * customer's LINE user id, a Twilio address is a phone number — so the id is
 * an HMAC of the conversation under a key the operator holds:
 *
 *   "eve_" + base32(HMAC-SHA256(sessionKey, conversation)).slice(0, 26)
 *
 * `conversation` names the chat the same way at every point of a turn:
 *
 *   "<channel>:<address>"   a message that came through from(address) — the
 *                           same string eve gives hooks as ctx.channel.continuationToken
 *   "session:<eve id>"      a session with no address: eve's own HTTP channel
 *
 * Tools cannot see the address (eve 0.80.1), so pdpaHook stores the id in a
 * defineState slot when the first message arrives; tools, the model
 * middleware and the Slack renderer read it from there. NOTES.md, run 2.
 */
const MIN_KEY_BYTES = 32
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

export function checkSessionKey(sessionKey: unknown): void {
  const bytes = typeof sessionKey === 'string' ? new TextEncoder().encode(sessionKey).length : -1
  if (bytes < MIN_KEY_BYTES) {
    // Never the key itself: only what is wrong with it.
    throw new TypeError(
      `sessionKey: expected a secret string of at least ${MIN_KEY_BYTES} bytes (openssl rand -hex 32)`,
    )
  }
}

function base32(bytes: Uint8Array): string {
  let out = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(buffer >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31]
  return out
}

const keys = new Map<string, Promise<CryptoKey>>()

function hmacKey(sessionKey: string): Promise<CryptoKey> {
  let key = keys.get(sessionKey)
  if (key === undefined) {
    key = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(sessionKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    keys.set(sessionKey, key)
  }
  return key
}

/**
 * The pdpa session id for one conversation. Deterministic for the same key
 * and conversation; reveals neither.
 *
 *   derivePdpaSessionId(key, 'slack:C0123:1800000000.0001')
 *   derivePdpaSessionId(key, `session:${eveSessionId}`)
 */
export async function derivePdpaSessionId(
  sessionKey: string,
  conversation: string,
): Promise<string> {
  checkSessionKey(sessionKey)
  if (typeof conversation !== 'string' || conversation.length === 0) {
    throw new TypeError('conversation: expected a non-empty string')
  }
  const mac = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(sessionKey),
    new TextEncoder().encode(conversation),
  )
  return `eve_${base32(new Uint8Array(mac)).slice(0, 26)}`
}

/** `conversation` for a message that arrived through `from(address)` on channel `channel`. */
export function addressConversation(channel: string, address: string): string {
  return `${channel}:${address}`
}

/** `conversation` for a session with no address, by its eve session id. */
export function sessionConversation(eveSessionId: string): string {
  return `session:${eveSessionId}`
}
