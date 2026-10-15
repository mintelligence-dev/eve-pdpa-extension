import { toNationalForm } from '../detectors/phone.js'
import type { EntityType } from '../types.js'
import { SEPARATORS } from './separators.js'

/**
 * The one form of a value that every way of writing it collapses to.
 *
 * `hash`, the allowlist and token reuse all ask the same question — "is this the
 * same value as that one?" — and must answer it the same way. If they did not,
 * the customer who wrote 091-888-7777 on Monday and ๐๙๑๘๘๘๗๗๗๗ on Tuesday would
 * count as two people in analytics, get two different tokens in one session,
 * and slip past an allowlist entry written as 0918887777. D8.
 *
 * `folded` MUST be the span read from the normalised text, not the original.
 * Normalise has already turned Thai and full-width digits into ASCII and removed
 * invisible characters; this function does not repeat that work, and passing
 * the original would give Thai-numeral input a different canonical form.
 *
 * Never returned to the caller and never written to an audit event. It is the
 * real value with the formatting taken off, and is exactly as sensitive.
 */
export function canonicalValue(entity: EntityType, folded: string): string {
  switch (entity) {
    case 'EMAIL':
      // Case only. Stripping separators here would turn my-shop.example into
      // myshop.example, a different domain that could belong to anyone. Local
      // parts are case-sensitive in theory and never in practice.
      return folded.toLowerCase()

    case 'LINE_USER_ID':
      // Fixed shape, no separators, and the case is part of the id: U + lowercase hex.
      return folded

    case 'PHONE':
      // +66 91 888 7777 and 091-888-7777 are one number.
      return toNationalForm(folded.replace(SEPARATORS, ''))

    case 'TH_NATIONAL_ID':
    case 'CREDIT_CARD':
    case 'BANK_ACCOUNT':
      // Digits are all these values are. Every non-digit in the span is a
      // separator the detector read past, and a dot is one since 13 Oct
      // (`detectors/digit-run.ts`) without being a separator anywhere else:
      // `mask` keeps a separator, and keeping the dots in an email would be wrong.
      return folded.replace(/\D/g, '')
  }
}
