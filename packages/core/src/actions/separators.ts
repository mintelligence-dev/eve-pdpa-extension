/**
 * Characters that shape how a value is written but carry none of it: ASCII
 * hyphen, any Unicode space, invisible format characters, the dash family
 * U+2010–U+2015, minus sign U+2212 and full-width hyphen U+FF0D.
 *
 * One definition for every action, so `mask` keeping a character and the
 * canonical form dropping it can never disagree about what a separator is.
 *
 * The ASCII hyphen goes first in the class so it can never be read as a range —
 * the formatter rewrites the escapes below as literal characters, and a hyphen
 * left between two of them would silently become one.
 */
export const SEPARATOR: RegExp = /[-\s\p{Cf}‐-―−－]/u

/** Same set, for stripping every occurrence. */
export const SEPARATORS: RegExp = new RegExp(SEPARATOR.source, 'gu')
