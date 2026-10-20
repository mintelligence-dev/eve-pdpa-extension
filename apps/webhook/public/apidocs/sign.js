// Signs a "Try it out" request from /apidocs the way API.md describes:
// HMAC-SHA256(secret, `${timestamp}.${scope}.${body}`) as lowercase hex, the
// scope being the route. Runs in the browser with Web Crypto. The secrets are
// what the person trying the API typed into the page: nothing here keeps them.

const SCOPES = {
  '/api/inbound': 'inbound',
  '/api/outbound': 'outbound',
  '/api/resolve': 'resolve',
  '/api/end-session': 'end-session',
}

const utf8 = new TextEncoder()

async function hmacHex(key, message) {
  const k = await crypto.subtle.importKey(
    'raw',
    utf8.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, utf8.encode(message)))
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The request signed, and a line saying what was done. A request to no route
 * of the webhook goes out as it is; one whose secret is missing goes out
 * unsigned, so the webhook's 401 shows what happens without it.
 */
export async function sign(request, secrets, now = Date.now()) {
  const scope = SCOPES[new URL(request.url, 'http://localhost').pathname]
  if (scope === undefined || String(request.method).toUpperCase() !== 'POST') {
    return { request, note: '' }
  }
  const name = scope === 'resolve' ? 'PDPA_RESOLVE_SECRET' : 'PDPA_SECRET'
  const key = scope === 'resolve' ? secrets.resolveSecret : secrets.secret
  if (!key) {
    return { request, note: `ยังไม่ได้ใส่ ${name} — ส่งไปแบบไม่เซ็น จะได้ 401` }
  }
  // The signature covers the body exactly as sent, so it is fixed here.
  const body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {})
  const timestamp = String(Math.floor(now / 1000))
  const mac = await hmacHex(key, `${timestamp}.${scope}.${body}`)
  request.body = body
  request.headers = {
    ...request.headers,
    'x-pdpa-timestamp': timestamp,
    'x-pdpa-signature': `v1=${mac}`,
  }
  return { request, note: `เซ็นด้วย ${name} · scope ${scope}` }
}
