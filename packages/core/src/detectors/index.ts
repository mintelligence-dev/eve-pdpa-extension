import type { Detector } from '../types.js'
import { bankAccountDetector } from './bank-account.js'
import { creditCardDetector } from './credit-card.js'
import { emailDetector } from './email.js'
import { licensePlateDetector } from './license-plate.js'
import { lineUserIdDetector } from './line-user-id.js'
import { phoneDetector } from './phone.js'
import { promptpayDetector } from './promptpay.js'
import { thaiNationalIdDetector } from './thai-national-id.js'

/**
 * The detectors a guard runs when the caller names none — every entity this
 * release claims.
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
  // The 0.2 detectors, one line each under its own heading, so the branch that
  // adds one merges in any order.
  // License plate.
  licensePlateDetector,
  // Date of birth.
  // Passport.
  // PromptPay.
  promptpayDetector,
]

export {
  bankAccountDetector,
  creditCardDetector,
  emailDetector,
  licensePlateDetector,
  lineUserIdDetector,
  phoneDetector,
  promptpayDetector,
  thaiNationalIdDetector,
}
