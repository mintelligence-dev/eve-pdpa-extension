import type { Candidate, Detector, NormalisedText } from '../types.js'
import { isAsciiDigit, isAsciiLetter, isIsolated } from './boundary.js'

/**
 * A deliberate subset of RFC 5322, not the whole grammar.
 *
 * The full grammar accepts things no customer ever types and that a redactor
 * cannot safely span — quoted local parts with embedded spaces, nested
 * comments, folding whitespace, address lists. Matching them would widen every
 * span far past the address itself. What is left out, and why it is safe to
 * leave out here:
 *
 *   quoted local part   "john doe"@example.com   — contains spaces; a greedy
 *                                                  span would swallow the
 *                                                  surrounding sentence
 *   IP-literal domain   user@[192.0.2.1]         — an address, not a mailbox
 *                                                  anyone types in chat
 *   comments            user(note)@example.com   — legal, never seen in the wild
 *   raw IDN             ผู้ใช้@ตัวอย่าง.ไทย          — see the note below
 *
 * A miss here is an FN, and the benchmark must report it rather than hide it
 * (D5). Written down so the number has a cause on record.
 *
 * Thai IDN is the one worth revisiting: .ไทย domains exist, and this pattern
 * sees only the punycode form. Left out of 0.1 because folding Unicode labels
 * belongs with the NFC work that normalise also deferred.
 */
const LOCAL_SYMBOLS = "!#$%&'*+/=?^_`{|}~-"
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?'
/** Everything after the @. Sticky: tried only where an @ was found. */
const DOMAIN = new RegExp(`(?:${LABEL}\\.)+[A-Za-z]{2,63}`, 'y')

/** One character of a dot-atom local part: atext. */
function isLocalChar(ch: string | undefined): boolean {
  if (ch === undefined) return false
  return isAsciiLetter(ch) || isAsciiDigit(ch) || LOCAL_SYMBOLS.includes(ch)
}

/**
 * Where the local part that ends at the @ in `at` starts, or `at` when there is
 * none: atext runs joined by single dots, never starting or ending with one.
 * Never walks back past `floor`, the end of the last address matched, so two
 * addresses cannot share characters.
 */
function localStart(text: string, at: number, floor: number): number {
  let start = at
  while (start > floor) {
    const ch = text[start - 1]
    if (isLocalChar(ch)) start--
    else if (ch === '.' && start < at && start - 2 >= floor && isLocalChar(text[start - 2])) start--
    else break
  }
  return start
}

/**
 * File extensions that are not top-level domains, and never have been.
 *
 * An image saved for a high-density screen is named banner@2x.png, which is an
 * address by the pattern above (edge cases, 13 Oct). No mailbox can live under
 * a TLD the root zone does not have, so a match ending in one of these is a
 * filename. Only extensions a customer sends in chat are listed, and each was
 * checked against the IANA root zone list of 12 Oct 2026: zip, mov, app and
 * the ccTLDs that look like extensions (ai, md, py, rs, sh) are real TLDs and
 * stay out of the list.
 */
const FILE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'heic',
  'heif',
  'bmp',
  'svg',
  'tif',
  'tiff',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'csv',
])

/**
 * A key written in front of the address with nothing between: `email=…`,
 * `mail=…`, `e-mail=…`. `=` and `-` are atext, so the local part read back from
 * the @ took the key in: "email=somchai@example.com" was spanned from the "e",
 * and a token replaced the key with the address (user benchmark, 14 Oct,
 * D20 item 26). The span starts after it. A colon ends a local part already;
 * it is listed so the rule reads the same for both ways a key is joined.
 *
 * Only these three words, and only where the local part starts with one: a
 * key with any other name, "contact_email=", is left as it was, because no
 * other part of what atext allows is changed here.
 */
const KEY_PREFIX = /^(?:e-?mail|mail)[=:]/i

function isFilename(match: string): boolean {
  const tld = match.slice(match.lastIndexOf('.') + 1).toLowerCase()
  return FILE_EXTENSIONS.has(tld)
}

/** Anything that could be part of the same address, on either side. */
function belongsToAddress(ch: string): boolean {
  return isLocalChar(ch) || ch === '.' || ch === '@'
}

export const emailDetector: Detector = {
  id: 'email',
  entities: ['EMAIL'],

  detect(input: NormalisedText): Candidate[] {
    const found: Candidate[] = []
    const text = input.text

    // Anchored on the @, not scanned for. A pattern that starts with the local
    // part tries every position of a long run of letters or digits and reads
    // the rest of the run from each: 50,000 digits took 1.1 s here alone, and
    // 200,000 took 19 s (code review, 14 Oct). Each @ now reads back over its
    // own local part and forward over its own domain, and a message without
    // one costs a single indexOf. Matches what the one regex matched: the
    // leftmost start, the longest domain, and a search that resumes after the
    // last match whether or not the match was kept.
    let floor = 0
    for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
      const start = localStart(text, at, floor)
      if (start === at) continue
      DOMAIN.lastIndex = at + 1
      if (DOMAIN.exec(text) === null) continue
      const end = DOMAIN.lastIndex
      floor = end

      // The TLD is greedy over letters, so only a digit, a hyphen or a further
      // dotted label can follow — each of which means the run was cut short and
      // this is not the whole address. A full stop, or an ellipsis, with nothing
      // of the run after it ends the sentence instead, and stays out of the span.
      let tail = end
      while (text[tail] === '.') tail++
      if (!isIsolated(text, start, tail, belongsToAddress)) continue
      if (isFilename(text.slice(start, end))) continue
      // After the isolation check, which reads the run whole: the key is part
      // of what was typed, only not part of the address.
      const key = KEY_PREFIX.exec(text.slice(start, at))
      const from = key === null ? start : start + key[0].length
      if (from === at) continue

      found.push({
        entity: 'EMAIL',
        start: from,
        end,
        // Nothing else in Thai customer text takes this shape, but an address
        // can still belong to the shop rather than the customer. That is a
        // policy allowlist question, not a detection one.
        confidence: 0.97,
        detector: 'email',
      })
    }

    return found
  },
}
