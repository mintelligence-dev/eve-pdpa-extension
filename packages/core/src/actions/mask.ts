import type { EntityRule } from '../types.js'
import { SEPARATOR } from './separators.js'

const MASK_CHAR = 'x'

/** Visible characters kept when `keep: 'last4'` is set. */
const LAST = 4

/**
 * Hides a value while keeping what the policy explicitly allows.
 *
 * With no `keep`, nothing survives but the separators. Leaving the last four
 * digits visible by default would reveal part of the value to a policy that
 * never asked for it — D8.1.
 *
 * Separators are kept so the result still reads as a phone number or a card:
 * `4111 1111 1111 1111` becomes `xxxx xxxx xxxx 1111`, not a run of nineteen
 * x. What counts as a separator is read off the ORIGINAL text, so a no-break
 * space or an invisible character the customer typed stays where it was.
 *
 * `last4` counts characters that are not separators, from the end. When the
 * span has four or fewer such characters, keeping four would reveal the whole
 * value, so everything is masked instead.
 *
 * Works on the original, so kept digits stay in whatever script the customer
 * used: ๐๙๑๘๘๘๗๗๗๗ keeps ๗๗๗๗, not 7777.
 */
export function maskValue(span: string, keep: EntityRule['keep']): string {
  // Iterate by code point so a character outside the BMP is masked once, not twice.
  const chars = Array.from(span)
  const content = chars.filter((ch) => !SEPARATOR.test(ch)).length

  let reveal = 0
  if (keep === 'last4' && content > LAST) reveal = LAST

  let hideUntil = content - reveal
  let out = ''
  for (const ch of chars) {
    if (SEPARATOR.test(ch)) {
      out += ch
    } else if (hideUntil > 0) {
      out += MASK_CHAR
      hideUntil--
    } else {
      out += ch
    }
  }
  return out
}
