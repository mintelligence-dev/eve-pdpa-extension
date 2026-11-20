import type { Candidate, DetectContext, Detector, NormalisedText } from '../types.js'

/**
 * Spaces and tabs, read as one space.
 *
 * "ชื่อ-นามสกุล:  กานดา  เรืองสุข" (two spaces) and "081  433  1673" are what a
 * customer pastes from a form or types with a double tap. The three detectors
 * that read a phrase, not a number with a fixed shape, each write a single
 * space in their patterns. Rather than put `[ \t]+` into every one of them, the
 * text is squeezed first, run through the detector, and what it found is
 * carried back to the offsets of the text it was given.
 *
 * Line breaks are not squeezed: a name does not go on across a line, and an
 * address is allowed to.
 */
interface Squeezed {
  readonly text: string
  /** Offset in the squeezed text → offset in the original. One longer than the text. */
  readonly back: readonly number[]
}

function squeeze(text: string): Squeezed | null {
  if (!/\t|[ ]{2}/.test(text)) return null
  let out = ''
  const back: number[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i] as string
    if (ch === ' ' || ch === '\t') {
      let j = i
      while (text[j] === ' ' || text[j] === '\t') j++
      back.push(i)
      out += ' '
      i = j
    } else {
      back.push(i)
      out += ch
      i++
    }
  }
  back.push(text.length)
  return { text: out, back }
}

/** A detector that reads runs of spaces and tabs as one space. */
export function squeezing(detector: Detector): Detector {
  return {
    ...detector,
    detect(input: NormalisedText, ctx: DetectContext): Candidate[] {
      const sq = squeeze(input.text)
      if (sq === null) return detector.detect(input, ctx) as Candidate[]
      const found = detector.detect({ ...input, text: sq.text }, ctx) as Candidate[]
      return found.map((c) => ({
        ...c,
        start: sq.back[c.start] as number,
        // The end of the last character, in the original: past any spaces squeezed inside it.
        end: c.end === 0 ? 0 : (sq.back[c.end - 1] as number) + 1,
      }))
    },
  }
}
