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
  // A space where the value was, so the words either side of it are never
  // read as one: "acc" before the number and "ount" after it are not a cue.
  return `${text.slice(from, start)} ${text.slice(end, to)}`.toLowerCase()
}

/**
 * The window, cut short at the nearest digit on either side: the words that
 * can only be about this value, not about a number beside it. "อ้างอิง 1006
 * 4012 8888 8888 1881" — the word is 1006's, and the card is read without it.
 */
export function ownWindow(text: string, start: number, end: number): string {
  let from = start
  while (from > 0 && start - from < BEFORE && !isDigit(text[from - 1])) from--
  let to = end
  while (to < text.length && to - end < AFTER && !isDigit(text[to])) to++
  return `${text.slice(from, start)} ${text.slice(end, to)}`.toLowerCase()
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9'
}

/**
 * A message this short is an answer, not a new subject: the cue it answers can
 * sit in the other side's last message. Longer, and the customer has moved on
 * — "order 8829301847, also what was your account number again" should not
 * borrow a cue from a question two topics back. D10.11.
 */
const ANSWER_LENGTH = 80

/**
 * True when the other side's last message carries one of the cues and this
 * message reads as its answer. `wholeWords` are read as `containsWord` reads
 * them.
 */
export function previousHasCue(
  text: string,
  previous: string | undefined,
  words: readonly string[],
  wholeWords: readonly string[] = [],
): boolean {
  if (!isAnswer(text, previous)) return false
  return containsAny(previous, words) || containsWord(previous, wholeWords)
}

/**
 * True when there is a last message from the other side and `text` is short
 * enough to be its answer. For a caller whose cue is not a word list.
 */
export function isAnswer(text: string, previous: string | undefined): previous is string {
  return previous !== undefined && text.length <= ANSWER_LENGTH
}

export function containsAny(window: string, words: readonly string[]): boolean {
  return words.some((w) => window.includes(w))
}

/**
 * True when one of `words` stands in the window as a word of its own: no
 * ASCII letter touches it on either side.
 *
 * For the short Latin cues a plain substring search cannot be trusted with:
 * "acc" is in "accept", "ref" in "refund" and "prefer" (D20). Thai cues need
 * no edge and could not have one — there is no space to find — so they stay
 * with `containsAny`.
 */
export function containsWord(window: string, words: readonly string[]): boolean {
  for (const w of words) {
    for (let at = window.indexOf(w); at !== -1; at = window.indexOf(w, at + 1)) {
      if (!isAsciiLetter(window[at - 1]) && !isAsciiLetter(window[at + w.length])) return true
    }
  }
  return false
}

/** Where a cue stands in a window: the index of its first character, and of the one after it. */
export type CueAt = readonly [start: number, end: number]

/** Every place `containsAny` or `containsWord` would have found one of the words. */
export function cuesIn(
  window: string,
  words: readonly string[],
  wholeWords: readonly string[] = [],
): CueAt[] {
  const found: CueAt[] = []
  for (const w of words) {
    for (let at = window.indexOf(w); at !== -1; at = window.indexOf(w, at + 1)) {
      found.push([at, at + w.length])
    }
  }
  for (const w of wholeWords) {
    for (let at = window.indexOf(w); at !== -1; at = window.indexOf(w, at + 1)) {
      if (!isAsciiLetter(window[at - 1]) && !isAsciiLetter(window[at + w.length])) {
        found.push([at, at + w.length])
      }
    }
  }
  return found
}

/** What may stand between a label and its value: "ref: 12", "ออเดอร์ #12". */
const LABEL_JOIN = /[ \t:#=.\-]/

/**
 * How many characters stand between the value at `start`..`end` and the
 * nearest cue `locate` finds in its own window (`ownWindow`), or Infinity when
 * there is none.
 *
 * A cue after the value counts only when it is not the label of the number
 * that follows it: in "1234567890 ออเดอร์ 99" the word is 99's. Read the same
 * way on either side, so two kinds of cue can be weighed against each other.
 */
export function cueDistance(
  text: string,
  start: number,
  end: number,
  locate: (window: string) => readonly CueAt[],
): number {
  let from = start
  while (from > 0 && start - from < BEFORE && !isDigit(text[from - 1])) from--
  let to = end
  while (to < text.length && to - end < AFTER && !isDigit(text[to])) to++
  const before = start - from
  // The same window ownWindow reads: a space stands where the value was.
  const window = `${text.slice(from, start)} ${text.slice(end, to)}`.toLowerCase()

  let nearest = Number.POSITIVE_INFINITY
  for (const [s, e] of locate(window)) {
    if (e <= before) {
      nearest = Math.min(nearest, before - e)
    } else if (s > before) {
      let next = end + (e - before - 1)
      while (next < text.length && LABEL_JOIN.test(text[next] as string)) next++
      if (isDigit(text[next])) continue
      nearest = Math.min(nearest, s - before - 1)
    }
  }
  return nearest
}

function isAsciiLetter(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z'))
}

/**
 * The words of a key name that say its value is a point in time. A LINE
 * webhook sends `"timestamp":` with thirteen digits of milliseconds, which
 * pass the id checksum one time in eleven; a tool logs `ts=` and `updated=` the same way
 * (user benchmark, 14 Oct, D20). No one stores a person's id, phone or account
 * under one of these.
 */
const TIME_KEY_WORDS = new Set([
  'timestamp',
  'ts',
  'time',
  'datetime',
  'date',
  'epoch',
  'created',
  'updated',
  'modified',
  'expires',
  'expiry',
])

/** `"key":`, `key=`, `key: ` — a key, then what joins it to its value. */
const KEY_BEFORE = /([A-Za-z][A-Za-z0-9_]*)["']?[ \t]?[:=][ \t]?["']?$/

/** The longest key read: any longer and it is prose, not a field name. */
const KEY_LENGTH = 32

/**
 * True when the value at `start` is written right after a key name that says
 * it is a time: `timestamp`, `ts`, `created_at`, `updatedAt`, `sent_time`.
 * The key is split at underscores and case changes and read a word at a time,
 * so `createdAt` is "created" "at"; "at" counts only after another word.
 */
export function keyedAsTime(text: string, start: number): boolean {
  const m = KEY_BEFORE.exec(text.slice(Math.max(0, start - KEY_LENGTH - 4), start))
  if (m === null) return false
  const words = (m[1] as string)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split('_')
    .filter((w) => w !== '')
  if (words.some((w) => TIME_KEY_WORDS.has(w))) return true
  return words.length > 1 && words[words.length - 1] === 'at'
}

/** What may open a list line before its value: a bullet, a number, spaces. */
const LIST_LEAD = /^[ \t\-*•·>)(.\d]*$/

/**
 * The number of a numbered line, "3. " or "3) ". A reading that starts on it
 * takes the item's number as its first digit: "3. " before an id typed
 * 1-4-5-2-1 was read as thirteen digits starting with the 3, passed the
 * checksum by chance, and left the id's last digit in the clear (user
 * benchmark, 14 Oct).
 */
const ITEM_NUMBER = /^\d{1,2}[.)] /

/**
 * True when the value at `start` opens its line and the line directly above
 * holds the value that ended at `previousEnd`.
 *
 * A list pasted under one heading puts the cue on the first line only:
 * "เบอร์⏎803685274⏎997127246⏎811642252" — the third number is past the
 * window, and the second and third were missed or found by where the window
 * happened to end (user benchmark, 14 Oct, D20). Each line of the list is
 * read as what the line above was read as. Only from a value found with a cue,
 * and only to the next line: a blank line, or a line that opens with a word,
 * is where the list ends. Never to a reading that starts on the item's number.
 */
export function continuesList(text: string, start: number, previousEnd: number): boolean {
  if (previousEnd < 0 || previousEnd > start) return false
  if (ITEM_NUMBER.test(text.slice(start, start + 4))) return false
  // Looked for no further back than a list lead can reach. Searched to the
  // start of the text instead, every reading on a long line with no break in
  // it read the whole line again: 100 KB under one cue took 3.8 s (CI, 16 Oct).
  let lineStart = -1
  // The break itself sits one before the lead, so MAX_LEAD + 1 characters back.
  for (let at = start - 1; at >= Math.max(previousEnd, start - MAX_LEAD - 1); at--) {
    if (text[at] === '\n') {
      lineStart = at + 1
      break
    }
  }
  if (lineStart === -1) return false
  // The line above is the one the last value ended on: no break in between.
  if (text.indexOf('\n', previousEnd) !== lineStart - 1) return false
  return LIST_LEAD.test(text.slice(lineStart, start))
}

/**
 * The longest bullet, number and indent a list line may open with. Anything
 * longer reads as the next line of text, not of the list, and falls back to
 * the cue words around the value. A constant, so the check stays linear.
 */
const MAX_LEAD = 64
