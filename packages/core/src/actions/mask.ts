import type { EntityRule } from '../types.js'
import { SEPARATOR } from './separators.js'

const MASK_CHAR = 'x'

/** Visible characters kept at the end by `keep: 'last4'`, and at the start by `first2last4`. */
const LAST = 4
const FIRST = 2

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

  // `first2last4` also keeps the first two (D20): 0918887777 → 09xxxx7777, as
  // the Notion example has it — the reader sees it is a mobile. Only when at
  // least one character would still be hidden; otherwise everything is.
  const first = keep === 'first2last4' && content > FIRST + LAST ? FIRST : 0
  const last = (keep === 'last4' && content > LAST) || first > 0 ? LAST : 0

  let seen = 0
  let out = ''
  for (const ch of chars) {
    if (SEPARATOR.test(ch)) {
      out += ch
      continue
    }
    out += seen < first || seen >= content - last ? ch : MASK_CHAR
    seen++
  }
  return out
}
