import type { Detector } from '../types.js'
import { bankAccountDetector } from './bank-account.js'
import { creditCardDetector } from './credit-card.js'
import { emailDetector } from './email.js'
import { lineUserIdDetector } from './line-user-id.js'
import { phoneDetector } from './phone.js'
import { thaiNationalIdDetector } from './thai-national-id.js'

/**
 * The detectors a guard runs when the caller names none — all six entities 0.1
 * claims.
 *
 * The engine derives the audit event's detector list and entitiesSupported from
 * whatever is in this array, so a build can never claim to cover an entity it
 * cannot see.
 */
export const BUILTIN_DETECTORS: readonly Detector[] = [
  thaiNationalIdDetector,
  creditCardDetector,
  emailDetector,
  lineUserIdDetector,
  phoneDetector,
  bankAccountDetector,
]

export {
  bankAccountDetector,
  creditCardDetector,
  emailDetector,
  lineUserIdDetector,
  phoneDetector,
  thaiNationalIdDetector,
}
