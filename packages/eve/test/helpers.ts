import {
  type AuditRecord,
  type CompiledPolicy,
  createGuard,
  createMemoryTokenStore,
  definePolicy,
  type Guard,
  type TokenStore,
} from '@eve-pdpa-extension/core'
import { expect } from 'vitest'
import { makeThaiId } from '../../core/test/helpers/make-thai-id.js'

// Synthetic values only (CONTRIBUTING.md). Ids come from core's generator with
// a fixed seed, so every run sees the same numbers and none was typed by hand.

/** A small LCG: the same seed gives the same digits on every machine. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/**
 * Seed 3 gives an id that also passes the card checksum in an issuer's range,
 * which core reads as a credit card and blocks (it settles an overlap toward
 * the stricter action). Tests that want a masked id avoid it.
 */
export function syntheticId(seed: number): string {
  return makeThaiId(seeded(seed))
}

/** 1-2345-67890-12-3, the way the card prints it. */
export function dashed(id: string): string {
  return `${id.slice(0, 1)}-${id.slice(1, 5)}-${id.slice(5, 10)}-${id.slice(10, 12)}-${id.slice(12)}`
}

export function thaiDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => '๐๑๒๓๔๕๖๗๘๙'[Number(d)] ?? d)
}

export const PHONE = '091-888-7777'
export const EMAIL = 'somchai@example.com'

/**
 * Every way an original could show up again: as typed, digits only, and in
 * the other digit script. JSON.stringify reaches into nested events, parts,
 * error messages and causes alike.
 */
export function expectNoLeak(value: unknown, originals: readonly string[]): void {
  const seen = JSON.stringify(value, (_key, v: unknown) =>
    v instanceof Error ? { name: v.name, message: v.message, cause: v.cause } : v,
  )
  for (const original of originals) {
    const forms = new Set([original, thaiDigits(original)])
    const digits = original.replace(/\D/g, '')
    if (digits.length >= 9) forms.add(digits).add(thaiDigits(digits))
    for (const form of forms) expect(seen, `leaked ${form}`).not.toContain(form)
  }
}

// ---- guards ----------------------------------------------------------------

/** 64 hex characters, as `openssl rand -hex 32` makes. Synthetic. */
export const SESSION_KEY = 'a1'.repeat(32)
export const HMAC_KEY = 'b2'.repeat(32)

/** The template's policy: phones become tokens for OTP, cards stop the message. */
export const TOKENISE: CompiledPolicy = definePolicy({
  entitySet: '0.1',
  onUnmapped: 'redact',
  placeholderLanguage: 'th',
  entities: {
    PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'], ttlSec: 300, display: 'mask' },
    TH_NATIONAL_ID: { action: 'redact' },
    CREDIT_CARD: { action: 'block', minConfidence: 0.6 },
    EMAIL: { action: 'hash' },
    BANK_ACCOUNT: { action: 'mask', keep: 'last4' },
    LINE_USER_ID: { action: 'redact' },
  },
})

/** Masks only: no token store, no key. */
export const MASK: CompiledPolicy = definePolicy({
  entitySet: '0.1',
  onUnmapped: 'redact',
  entities: {
    PHONE: { action: 'mask', keep: 'last4' },
    TH_NATIONAL_ID: { action: 'redact' },
    EMAIL: { action: 'redact' },
    CREDIT_CARD: { action: 'block', minConfidence: 0.6 },
  },
})

export interface TestGuard {
  readonly guard: Guard
  readonly audit: AuditRecord[]
  readonly store: TokenStore
}

export function makeGuard(
  policy: CompiledPolicy = TOKENISE,
  store: TokenStore = createMemoryTokenStore(),
): TestGuard {
  const audit: AuditRecord[] = []
  const guard = createGuard({
    policy,
    hmacKey: HMAC_KEY,
    tokenStore: store,
    onAudit: (event) => {
      audit.push(event)
    },
  })
  return { guard, audit, store }
}

/** A token store that is down: every call rejects. */
export function failingStore(): TokenStore {
  const down = () => Promise.reject(new Error('store down'))
  return { sync: false, set: down, get: down, delete: down, clearSession: down }
}

export const TOKEN = /\[tok:[a-z]{16}\]/
