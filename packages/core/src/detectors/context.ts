/**
 * The words around a candidate.
 *
 * Two of the six 0.1 entities have no checksum and no shape of their own: a
 * phone number and a bank account are both a run of ten digits. What separates
 * them from an order number is the sentence they sit in. This is the fourth
 * detection layer the spec names — patterns, dictionaries, context, validators.
 *
 * Thai is written without spaces, so there is no word to tokenise and no \b to
 * anchor on. A plain substring search over a window of characters is not a
 * shortcut here, it is the only thing that works without a word segmenter,
 * which core does not have and will not ship at this size.
 */

/** Characters of context to read on each side. */
const BEFORE = 24
const AFTER = 12

/**
 * Lowercased, so callers list their English cues in one case and their Thai
 * cues unchanged — Thai has no case to fold.
 */
export function contextWindow(text: string, start: number, end: number): string {
  const from = Math.max(0, start - BEFORE)
  const to = Math.min(text.length, end + AFTER)
  return (text.slice(from, start) + text.slice(end, to)).toLowerCase()
}

export function containsAny(window: string, words: readonly string[]): boolean {
  return words.some((w) => window.includes(w))
}
