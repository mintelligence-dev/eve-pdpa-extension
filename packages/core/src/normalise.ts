import type { NormalisedText, OffsetShift } from './types.js'

// Characters removed before detection runs.
//
// Two reasons they matter, and both are real:
//
//   1. They arrive by accident. Text pasted from a web page, a PDF or Word
//      routinely carries zero-width joiners, soft hyphens and a BOM. A national
//      ID split by an invisible character is still a national ID to the person
//      reading it, but no pattern will match it.
//   2. They are the cheapest way to evade a filter on purpose.
//
// This is a deliberate allowlist, not a Unicode category sweep. Thai text is
// full of combining vowels and tone marks (U+0E31, U+0E34-U+0E3A, U+0E47-U+0E4E)
// which are invisible on their own but change the word — removing those would
// corrupt the message. Every entry below is a formatting or control character
// with no rendered form of its own.
//
// Tabs, newlines and carriage returns are kept: they carry real structure.
function isRemovable(code: number): boolean {
  // C0 controls except tab, line feed and carriage return, plus DEL.
  if (code < 0x20) return code !== 0x09 && code !== 0x0a && code !== 0x0d
  if (code === 0x7f) return true
  if (code < 0xad) return false

  return (
    code === 0x00ad || // SOFT HYPHEN
    code === 0x061c || // ARABIC LETTER MARK
    code === 0x180e || // MONGOLIAN VOWEL SEPARATOR
    (code >= 0x200b && code <= 0x200f) || // ZWSP, ZWNJ, ZWJ, LRM, RLM
    (code >= 0x202a && code <= 0x202e) || // bidi embedding and override
    (code >= 0x2060 && code <= 0x2064) || // WORD JOINER and invisible operators
    (code >= 0x2066 && code <= 0x2069) || // bidi isolates
    code === 0xfeff || // ZWNBSP / byte order mark
    (code >= 0xfff9 && code <= 0xfffb) // interlinear annotation
  )
}

// Characters that render as a space but are not U+0020.
//
// More dangerous than the zero-width characters above, because a reviewer
// cannot see the difference. A detector written and tested with an ordinary
// space passes review, then silently misses every message from someone who
// pressed Option+Space on a Mac or pasted from a web page using &nbsp;.
//
// U+200B ZWSP is NOT here — it has no width at all and belongs in isRemovable.
function isSpaceLike(code: number): boolean {
  return (
    code === 0x00a0 || // NO-BREAK SPACE
    code === 0x1680 || // OGHAM SPACE MARK
    (code >= 0x2000 && code <= 0x200a) || // EN QUAD .. HAIR SPACE
    code === 0x202f || // NARROW NO-BREAK SPACE
    code === 0x205f || // MEDIUM MATHEMATICAL SPACE
    code === 0x3000 // IDEOGRAPHIC SPACE
  )
}

/**
 * Folds a character to its ASCII equivalent, or returns -1.
 *
 * Every case here replaces exactly one code unit with exactly one code unit, so
 * offsets stay aligned and no shift entry is needed.
 *
 * Other digit scripts (Arabic-Indic, Devanagari) are deliberately left alone:
 * they do not appear in Thai customer service text, and folding a script we
 * have not tested against means changing text we do not understand.
 *
 * Case is left alone too. Detectors that need it use the `i` flag; folding case
 * across the whole message is riskier than it looks, since some mappings change
 * length (ß to SS) and would break the 1:1 guarantee.
 */
function fold(code: number): number {
  if (code >= 0x0e50 && code <= 0x0e59) return 0x30 + (code - 0x0e50) // Thai digits
  // Full-width forms cover the entire printable ASCII range at a fixed offset,
  // so this catches Ａ-Ｚ and ＠ and ． as well as the digits. Without it
  // ＡＢ@ｇｍａｉｌ．ｃｏｍ walks straight past an email pattern.
  if (code >= 0xff01 && code <= 0xff5e) return code - 0xfee0
  if (isSpaceLike(code)) return 0x20
  return -1
}

function needsWork(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    // Fast reject for plain ASCII, which is most of what a mixed Thai/English
    // message is made of once you exclude the Thai letters themselves.
    if (code >= 0x20 && code < 0x7f) continue
    if (isRemovable(code) || fold(code) !== -1) return true
  }
  return false
}

/**
 * Prepares text for detection.
 *
 * Three groups are folded to ASCII one-for-one (Thai digits, full-width forms,
 * every character that renders as a space), and one group is removed entirely
 * (zero-width and control characters). Only the removals move offsets.
 *
 * Separators inside a candidate (the dashes in 3-1005-00123-45-8) are NOT
 * stripped here. Doing that globally would destroy the message; it belongs to
 * whichever detector matched the run, which strips them from its own match only.
 *
 * Detection reads `text`. Redaction rewrites `original`. Offsets found in the
 * former are translated with `toOriginalSpan` before anything acts on them.
 */
export function normalise(text: string): NormalisedText {
  if (!needsWork(text)) return { text, original: text, shifts: null }

  let out = ''
  let dropped = 0
  const shifts: OffsetShift[] = []

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)

    if (isRemovable(code)) {
      dropped++
      // Record against the NEXT normalised index, which is the first one this
      // removal affects. A run of removals collapses into a single entry.
      const at = out.length
      const last = shifts[shifts.length - 1]
      if (last !== undefined && last.at === at) {
        shifts[shifts.length - 1] = { at, dropped }
      } else {
        shifts.push({ at, dropped })
      }
      continue
    }

    // Surrogate halves match neither test and pass through unchanged, so
    // characters outside the BMP (emoji) survive intact.
    const folded = fold(code)
    out += folded === -1 ? text[i] : String.fromCharCode(folded)
  }

  // Folding alone keeps the two strings in step; only removals need a table.
  return { text: out, original: text, shifts: shifts.length > 0 ? shifts : null }
}

/** Total characters removed before a given normalised index. */
function droppedBefore(shifts: readonly OffsetShift[], index: number): number {
  let lo = 0
  let hi = shifts.length - 1
  let best = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const shift = shifts[mid]
    if (shift === undefined) break
    if (shift.at <= index) {
      best = shift.dropped
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

/** Normalised index -> index of the same character in the original. */
export function toOriginalStart(norm: NormalisedText, index: number): number {
  if (norm.shifts === null) return index
  return index + droppedBefore(norm.shifts, index)
}

/**
 * Normalised exclusive end -> exclusive end in the original.
 *
 * Deliberately anchored to the LAST included character rather than translating
 * `end` directly. Translating `end` would swallow any removed characters that
 * sit immediately after the match. With a zero-width space at original index 2:
 *
 *   original length 3, normalised "AB"
 *   span [0,2) is "AB" and must map to [0,2), not [0,3)
 */
export function toOriginalEnd(norm: NormalisedText, index: number): number {
  if (norm.shifts === null) return index
  if (index <= 0) return 0
  return toOriginalStart(norm, index - 1) + 1
}

/** Translates a half-open span found in the normalised text back to the original. */
export function toOriginalSpan(
  norm: NormalisedText,
  start: number,
  end: number,
): readonly [number, number] {
  if (norm.shifts === null) return [start, end]
  return [toOriginalStart(norm, start), toOriginalEnd(norm, end)]
}

/**
 * Weighted mod-11 check digit.
 *
 * Two properties worth knowing, both verified by test:
 *   - digit 3 carries weight 11, and 11 mod 11 is 0, so an error in that one
 *     position is never detected
 *   - a random 13-digit run passes with probability 1/10, so the checksum
 *     removes 90% of false positives and context words must do the rest
 */
export function isValidThaiNationalId(digits: string): boolean {
  if (digits.length !== 13) return false
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const code = digits.charCodeAt(i) - 48
    if (code < 0 || code > 9) return false
    sum += code * (13 - i)
  }
  const last = digits.charCodeAt(12) - 48
  if (last < 0 || last > 9) return false
  return (11 - (sum % 11)) % 10 === last
}
