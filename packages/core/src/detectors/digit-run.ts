/**
 * What may sit between two digit groups of one value, for every detector that
 * reads a run of digits: national id, card, phone and bank account.
 *
 * Until 13 Oct each detector kept its own list, and the lists had drifted: a
 * dot was read inside an id and a phone but not a card, a line break inside a
 * card only, an en dash inside a phone only (edge cases, 13 Oct). A customer
 * does not type a card differently from an id, so a separator one detector
 * reads and another does not is a miss waiting for the right message.
 *
 *   a space
 *   any dash: ASCII hyphen, U+2010–U+2015 (what iOS and Word substitute for
 *   one), minus sign U+2212 — with or without one space either side
 *   a dot, with or without one space either side
 *   one line break, for a value pasted from a note or wrapped by a narrow chat
 *   bubble
 *
 * One of each, never two: two spaces or a blank line is where one thing ends.
 *
 * Accepting a separator is not trusting it. A space, a dot and a line break
 * also sit between two unrelated numbers, so each detector still decides what
 * a reading with one in it must prove: the printed grouping for an id and a
 * card; the numbering plan, and a lower score for dots, for a phone; the
 * passbook grouping for an account with a dot or a line break in it.
 *
 * The phone detector adds one of its own, the bracket closing an area code:
 * nothing else is written with one.
 *
 * The ASCII hyphen goes first in the class so it can never be read as a range.
 */
export const SEPARATOR_SOURCE = ' ?[-‐-―−] ?| ?\\. ?| ?\\r?\\n ?| '

/** Digit groups joined by one separator each. Read with matchAll, never exec. */
export const DIGIT_RUN: RegExp = new RegExp(`\\d+(?:(?:${SEPARATOR_SOURCE})\\d+)*`, 'g')

const SEPARATOR: RegExp = new RegExp(SEPARATOR_SOURCE, 'g')

const BARE_DASH = /^[-‐-―−]$/

/** One group of a run, with where it sits in the text. */
export interface Group {
  readonly digits: string
  readonly start: number
  readonly end: number
  /** The separator before this group: '' for the first. */
  readonly before: string
}

export function splitRun(raw: string, offset: number): Group[] {
  const groups: Group[] = []
  let at = 0
  let before = ''
  for (const sep of raw.matchAll(SEPARATOR)) {
    groups.push({
      digits: raw.slice(at, sep.index),
      start: offset + at,
      end: offset + sep.index,
      before,
    })
    at = sep.index + sep[0].length
    before = sep[0]
  }
  groups.push({ digits: raw.slice(at), start: offset + at, end: offset + raw.length, before })
  return groups
}

/**
 * True for a dash with nothing round it: the only separator that joins the
 * groups of one value and nothing else. Nobody joins two numbers with one.
 */
export function isBareDash(separator: string): boolean {
  return BARE_DASH.test(separator)
}

/**
 * A new value may start after this separator: anything but a bare dash. A
 * space, a dot or a line break can end one thing and begin the next ("ข้อ 1.",
 * an amount, a list).
 */
export function opensValue(separator: string): boolean {
  return separator === '' || !isBareDash(separator)
}

/**
 * One past the last group a reading that starts at `from` can take without
 * holding more than `max` digits. Unbounded, the phone detector scored every
 * pair of groups of "0 1 2 3 …": 1.6 s on 2 KB (code review, 13 Oct).
 */
export function readingEnd(
  groups: readonly { readonly digits: string }[],
  from: number,
  max: number,
): number {
  let digits = 0
  let to = from
  while (to < groups.length) {
    digits += (groups[to] as { readonly digits: string }).digits.length
    if (digits > max) break
    to++
  }
  return to
}

/** How many digits groups `from` to `to` hold. */
export function digitsIn(
  groups: readonly { readonly digits: string }[],
  from: number,
  to: number,
): number {
  let digits = 0
  for (let i = from; i < to; i++) digits += (groups[i] as { readonly digits: string }).digits.length
  return digits
}

/** Group sizes, for comparing a reading to a printed grouping. */
export function sizesOf(groups: readonly Group[]): string {
  return groups.map((g) => g.digits.length).join('-')
}
