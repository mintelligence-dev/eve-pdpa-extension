/**
 * True when nothing on either side of the span belongs to the same token.
 *
 * Every detector here matches a run in the middle of free text, and a regex on
 * its own will happily take the tail of a longer string: the last 16 digits of
 * a 20-digit order number pass Luhn as readily as a card does. Thai is written
 * without spaces, so \b cannot be relied on either — it fires between any Thai
 * letter and any ASCII one. Each detector says for itself which characters
 * count as part of its token.
 */
export function isIsolated(
  text: string,
  start: number,
  end: number,
  belongs: (ch: string) => boolean,
): boolean {
  const before = start > 0 ? text[start - 1] : undefined
  const after = end < text.length ? text[end] : undefined
  if (before !== undefined && belongs(before)) return false
  if (after !== undefined && belongs(after)) return false
  return true
}

export function isAsciiDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

export function isAsciiLetter(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
}
