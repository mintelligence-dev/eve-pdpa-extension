/**
 * Where a request may ask the webhook to send things.
 *
 * The caller names the destination itself — the webhook does not know in
 * advance which systems will use it (D11, 16 Oct). The webhook signs whatever
 * it forwards, so a destination is checked before anything is sent: https
 * only, no credentials in the URL, and never an address inside a network,
 * where a signed POST could reach a service nobody meant to expose.
 *
 * A host name that resolves to an internal address is not caught: resolving
 * names needs DNS, which a web-standard runtime does not offer. A deployment
 * that must be sure lists its destinations in allowedDestinations.
 */

/** One entry of allowedDestinations: a destination must share its origin and start with its path. */
export interface AllowedPrefix {
  readonly origin: string
  readonly path: string
}

/** true for a host inside a network: loopback, private, link-local, or a local-only name. */
function internalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local') || host.endsWith('.internal')) return true

  // IPv4. The URL parser has already turned 0x7f.1 and 2130706433 into 127.0.0.1.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4 !== null) return internalV4(v4.slice(1).map(Number) as [number, number, number, number])

  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true
    // ::ffff:127.0.0.1 — an IPv4 address written as IPv6. The parser writes the
    // last two groups in hex: ::ffff:7f00:1.
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
    if (mapped !== null) {
      const hi = Number.parseInt(mapped[1] as string, 16)
      const lo = Number.parseInt(mapped[2] as string, 16)
      return internalV4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff])
    }
    const first = Number.parseInt(host.split(':')[0] || '0', 16)
    if ((first & 0xfe00) === 0xfc00) return true // fc00::/7, unique local
    if ((first & 0xffc0) === 0xfe80) return true // fe80::/10, link local
  }
  return false
}

function internalV4([a, b]: [number, number, number, number]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

/** The destination as written to onForward: no query or fragment, which can carry tokens. */
export function describe(url: URL): string {
  return `${url.origin}${url.pathname}`
}

/**
 * The checked URL, or the reason it is refused. The reason never repeats the
 * URL: it came from the request.
 */
export function checkDestination(
  raw: string,
  allowed: readonly AllowedPrefix[] | null,
): URL | string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'must be an absolute https URL'
  }
  if (url.protocol !== 'https:') return 'must be an https URL'
  if (url.username !== '' || url.password !== '') return 'must not carry a user name or password'
  if (internalHost(url.hostname)) return 'must not be a local or private network address'
  if (
    allowed !== null &&
    !allowed.some((p) => url.origin === p.origin && url.pathname.startsWith(p.path))
  ) {
    return "is not one of this webhook's allowed destinations"
  }
  return url
}

/** allowedDestinations as written in the options, checked once at startup. */
export function parseAllowed(list: readonly string[]): AllowedPrefix[] {
  return list.map((entry) => {
    let url: URL
    try {
      url = new URL(entry)
    } catch {
      throw new Error('allowedDestinations entries must be absolute https URLs')
    }
    if (url.protocol !== 'https:' || url.search !== '' || url.hash !== '') {
      throw new Error('allowedDestinations entries must be https URLs with no query or fragment')
    }
    return { origin: url.origin, path: url.pathname }
  })
}
