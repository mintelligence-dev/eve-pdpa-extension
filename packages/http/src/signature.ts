/**
 * Signing the requests that cross the webhook, both ways.
 *
 * The signature covers the timestamp and the body together, so neither can be
 * changed alone, and a request kept and sent again later is refused once the
 * timestamp falls outside the tolerance. HMAC-SHA256 through crypto.subtle,
 * which checks a signature in constant time — no hand-written comparison that
 * could stop at the first differing byte.
 */
import { PdpaHttpError } from './errors.js'

export const TIMESTAMP_HEADER = 'x-pdpa-timestamp'
export const SIGNATURE_HEADER = 'x-pdpa-signature'

/** As core's hmacKey: anything shorter can be guessed. `openssl rand -hex 32`. */
export const MIN_SECRET_BYTES = 32

/** How far a timestamp may be from this machine's clock, either way. */
export const DEFAULT_TOLERANCE_SEC = 300

const SCHEME = 'v1='
const encoder = new TextEncoder()

export type Secret = string | Uint8Array

/** The secret's bytes, after checking it is long enough. `name` is the option, for the error. */
export function secretBytes(secret: Secret, name: string): Uint8Array<ArrayBuffer> {
  const bytes = typeof secret === 'string' ? encoder.encode(secret) : secret
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < MIN_SECRET_BYTES) {
    throw new PdpaHttpError(
      'ERR_PDPA_HTTP_CONFIG',
      `${name} must be at least ${MIN_SECRET_BYTES} bytes — generate one with \`openssl rand -hex 32\``,
    )
  }
  // A copy: the caller's array may sit on a SharedArrayBuffer, and could change after this.
  return new Uint8Array(bytes)
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle
  if (s === undefined) {
    throw new PdpaHttpError(
      'ERR_PDPA_HTTP_NO_WEBCRYPTO',
      'crypto.subtle is not available: run on Node 20 or later, or another runtime with Web Crypto',
    )
  }
  return s
}

/** `${timestamp}.` followed by the body, as bytes — exactly what is signed. */
function signedBytes(timestamp: string, body: string | Uint8Array): Uint8Array<ArrayBuffer> {
  const head = encoder.encode(`${timestamp}.`)
  const tail = typeof body === 'string' ? encoder.encode(body) : body
  const out = new Uint8Array(head.byteLength + tail.byteLength)
  out.set(head, 0)
  out.set(tail, head.byteLength)
  return out
}

function toHex(bytes: ArrayBuffer): string {
  let hex = ''
  for (const b of new Uint8Array(bytes)) hex += b.toString(16).padStart(2, '0')
  return hex
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length !== 64 || !/^[0-9a-f]+$/.test(hex)) return null
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export interface CheckOptions {
  readonly toleranceSec?: number
  /** Milliseconds since the epoch. For tests. */
  readonly now?: number
}

export interface Signer {
  /** The two headers to send with `body`. */
  sign(body: string, now?: number): Promise<Record<string, string>>
  /** true when the headers carry a valid, current signature of `body`. */
  check(headers: Headers, body: string | Uint8Array, options?: CheckOptions): Promise<boolean>
}

/** One secret, its key imported once and reused for every request. */
export function createSigner(secret: Secret, name: string = 'secret'): Signer {
  const raw = secretBytes(secret, name)
  let key: Promise<CryptoKey> | undefined
  const keyFor = (): Promise<CryptoKey> => {
    key ??= subtle().importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ])
    return key
  }

  return {
    async sign(body, now = Date.now()) {
      const timestamp = String(Math.floor(now / 1000))
      const mac = await subtle().sign('HMAC', await keyFor(), signedBytes(timestamp, body))
      return { [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: `${SCHEME}${toHex(mac)}` }
    },

    async check(headers, body, options = {}) {
      const timestamp = headers.get(TIMESTAMP_HEADER)
      const signature = headers.get(SIGNATURE_HEADER)
      if (timestamp === null || signature === null) return false
      if (!/^\d{1,12}$/.test(timestamp) || !signature.startsWith(SCHEME)) return false
      const tolerance = options.toleranceSec ?? DEFAULT_TOLERANCE_SEC
      const now = (options.now ?? Date.now()) / 1000
      if (Math.abs(now - Number(timestamp)) > tolerance) return false
      const mac = fromHex(signature.slice(SCHEME.length))
      if (mac === null) return false
      return subtle().verify('HMAC', await keyFor(), mac, signedBytes(timestamp, body))
    },
  }
}

/**
 * The headers to send with a request to the webhook — for the app that sends
 * messages in, and for the system that sends replies to /outbound.
 */
export function signRequest(
  secret: Secret,
  body: string,
  now?: number,
): Promise<Record<string, string>> {
  return createSigner(secret).sign(body, now)
}

/**
 * Checks a request the webhook sent — for the system at forwardTo or replyTo.
 * Read the body as text first, and pass the text you read.
 */
export function verifyRequest(
  secret: Secret,
  headers: Headers,
  body: string,
  options?: CheckOptions,
): Promise<boolean> {
  return createSigner(secret).check(headers, body, options)
}
