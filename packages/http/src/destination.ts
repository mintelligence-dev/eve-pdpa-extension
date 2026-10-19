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

/** One entry of allowedDestinations: a destination must share its origin and sit at or below its path. */
export interface AllowedPrefix {
  readonly origin: string
  readonly path: string
}

/**
 * true for a host that is not on the public internet: loopback, private,
 * link-local, multicast, reserved, an IPv4 address carried inside IPv6, or a
 * name that only resolves locally.
 */
function internalHost(hostname: string): boolean {
  // A trailing dot is the fully qualified spelling of the same name:
  // localhost. and metadata.google.internal. reach what they name (D22).
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local') || host.endsWith('.internal')) return true

  // IPv4. The URL parser has already turned 0x7f.1 and 2130706433 into 127.0.0.1.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4 !== null) return internalV4(v4.slice(1).map(Number) as V4)

  if (host.includes(':')) {
    const groups = ipv6Groups(host)
    return groups === null || internalV6(groups)
  }
  return false
}

type V4 = [number, number, number, number]

function internalV4([a, b, c]: V4): boolean {
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // protocol assignments, TEST-NET-1
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast, reserved, broadcast
  )
}

/**
 * The eight 16-bit groups of an IPv6 address as the URL parser writes it —
 * lower case, :: for the longest run of zeros, never a dotted IPv4 tail.
 * null for anything else, which is then refused.
 */
function ipv6Groups(host: string): number[] | null {
  const halves = host.split('::')
  if (halves.length > 2) return null
  const read = (part: string): number[] | null => {
    if (part === '') return []
    const out: number[] = []
    for (const g of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null
      out.push(Number.parseInt(g, 16))
    }
    return out
  }
  const head = read(halves[0] as string)
  const tail = halves.length === 2 ? read(halves[1] as string) : []
  if (head === null || tail === null) return null
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  return [...head, ...new Array<number>(missing).fill(0), ...tail]
}

function internalV6(g: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g
  const embedded = (hi: number, lo: number) => internalV4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff])
  const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0)

  if (zeroTo(8) || (zeroTo(7) && g7 === 1)) return true // :: and ::1
  // An IPv4 address written as IPv6 reaches that IPv4 address.
  if (zeroTo(5) && (g5 === 0 || g5 === 0xffff)) return embedded(g6, g7) // ::a.b.c.d, ::ffff:a.b.c.d
  if (zeroTo(4) && g4 === 0xffff && g5 === 0) return embedded(g6, g7) // ::ffff:0:a.b.c.d (SIIT)
  if (g0 === 0x64 && g1 === 0xff9b) {
    // 64:ff9b::/96 translates to the IPv4 address at the end; 64:ff9b:1::/48 is local use.
    return g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 ? embedded(g6, g7) : g2 === 1
  }
  if (g0 === 0x2002) return embedded(g1, g2) // 6to4
  return (
    (g0 & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (g0 & 0xffc0) === 0xfe80 || // fe80::/10 link local
    (g0 & 0xffc0) === 0xfec0 || // fec0::/10 site local
    (g0 & 0xff00) === 0xff00 // ff00::/8 multicast
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
  if (allowed !== null && !allowed.some((p) => url.origin === p.origin && underPath(url, p.path))) {
    return "is not one of this webhook's allowed destinations"
  }
  return url
}

/**
 * The path itself, or below it. Not any path that merely starts the same way:
 * /reply must not let /reply-admin through (D22).
 */
function underPath(url: URL, path: string): boolean {
  if (url.pathname === path) return true
  return url.pathname.startsWith(path.endsWith('/') ? path : `${path}/`)
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
