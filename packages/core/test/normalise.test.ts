import { describe, expect, it } from 'vitest'
import {
  isValidThaiNationalId,
  normalise,
  toOriginalEnd,
  toOriginalSpan,
  toOriginalStart,
} from '../src/normalise.js'
import { makeThaiId } from './helpers/make-thai-id.js'

const ZWSP = '​'
const BOM = '﻿'
const SOFT_HYPHEN = '­'
const RLO = '‮'

describe('digit folding', () => {
  it('folds Thai numerals to ASCII', () => {
    expect(normalise('๐๑๒๓๔๕๖๗๘๙').text).toBe('0123456789')
  })

  it('folds full-width numerals to ASCII', () => {
    expect(normalise('０９１').text).toBe('091')
  })

  it('leaves the rest of the message alone', () => {
    const input = 'ขอเปลี่ยนเบอร์เป็น ๐๙๑-๘๘๘-๗๗๗๗ ค่ะ'
    expect(normalise(input).text).toBe('ขอเปลี่ยนเบอร์เป็น 091-888-7777 ค่ะ')
  })

  it('keeps offsets aligned when only folding, so no shift table is built', () => {
    const n = normalise('เบอร์ ๐๙๑๘๘๘๗๗๗๗')
    expect(n.shifts).toBeNull()
    expect(n.text).toHaveLength(n.original.length)
  })

  it('returns the very same string object when nothing needs changing', () => {
    const input = 'สวัสดีค่ะ ยินดีให้บริการ'
    const n = normalise(input)
    expect(n.text).toBe(input)
    expect(n.shifts).toBeNull()
  })
})

describe('full-width forms', () => {
  it('folds letters, digits and punctuation across the whole range', () => {
    expect(normalise('ＡＢＣ').text).toBe('ABC')
    expect(normalise('ａｂｃ').text).toBe('abc')
    expect(normalise('０９１').text).toBe('091')
    expect(normalise('＠．－').text).toBe('@.-')
  })

  it('stops an email from walking past a pattern', () => {
    const disguised = 'ｓｕｄａ＠ｇｍａｉｌ．ｃｏｍ'
    const pattern = /[\w.]+@[\w.]+\.\w+/
    expect(pattern.test(disguised)).toBe(false)
    expect(pattern.test(normalise(disguised).text)).toBe(true)
  })

  it('leaves half-width katakana and other forms alone', () => {
    const katakana = 'ｱｲｳ'
    expect(normalise(katakana).text).toBe(katakana)
  })

  it('keeps offsets aligned — folding never moves anything', () => {
    const n = normalise('ＡＢ＠ＣＤ')
    expect(n.shifts).toBeNull()
    expect(n.text).toHaveLength(n.original.length)
  })
})

describe('characters that render as a space', () => {
  const SPACES = [
    ['NBSP', ' '],
    ['narrow NBSP', ' '],
    ['figure space', ' '],
    ['thin space', ' '],
    ['en quad', ' '],
    ['hair space', ' '],
    ['ideographic space', '　'],
    ['ogham space', ' '],
    ['medium mathematical space', ' '],
  ] as const

  for (const [name, ch] of SPACES) {
    it(`folds ${name} to an ordinary space`, () => {
      expect(normalise(`a${ch}b`).text).toBe('a b')
    })
  }

  it('rescues a phone number a pattern would otherwise miss', () => {
    // The kind of pattern someone writes after testing with a normal space.
    const pattern = /0[689][\d -]{8,10}/
    const nbsp = '091 888 7777'
    expect(pattern.test(nbsp)).toBe(false)
    expect(pattern.test(normalise(nbsp).text)).toBe(true)
  })

  it('does not move offsets, since a space replaces a space', () => {
    const n = normalise('091 888 7777')
    expect(n.shifts).toBeNull()
    expect(n.text).toHaveLength(n.original.length)
  })

  it('leaves the zero-width space to the removal path, not this one', () => {
    // U+200B sits between the space range and the removable range on purpose.
    const n = normalise('a​b')
    expect(n.text).toBe('ab')
    expect(n.shifts).not.toBeNull()
  })
})

describe('invisible characters', () => {
  it('removes the characters that break a number apart', () => {
    expect(normalise(`310${ZWSP}05001${BOM}23458`).text).toBe('3100500123458')
    expect(normalise(`abc${SOFT_HYPHEN}def`).text).toBe('abcdef')
    expect(normalise(`x${RLO}y`).text).toBe('xy')
  })

  it('keeps Thai combining vowels and tone marks — removing them corrupts the word', () => {
    // สวัสดี carries U+0E31 and U+0E35, which are invisible on their own.
    const input = 'สวัสดีค่ะ'
    expect(normalise(input).text).toBe(input)
    expect(normalise(input).shifts).toBeNull()
  })

  it('keeps tab, newline and carriage return', () => {
    const input = 'a\tb\nc\rd'
    expect(normalise(input).text).toBe(input)
  })

  it('removes other C0 controls, which never occur in real chat text', () => {
    expect(normalise('abc').text).toBe('abc')
  })

  it('makes a hidden national ID detectable again', () => {
    const id = makeThaiId()
    const hidden = id.slice(0, 5) + ZWSP + id.slice(5)
    expect(isValidThaiNationalId(hidden)).toBe(false)
    expect(isValidThaiNationalId(normalise(hidden).text)).toBe(true)
  })
})

describe('offset translation', () => {
  it('is the identity when nothing was removed', () => {
    const n = normalise('เลขบัตร ๐๙๑')
    expect(toOriginalSpan(n, 3, 7)).toEqual([3, 7])
  })

  it('shifts past a removed character', () => {
    //  index: 0=A 1=ZWSP 2=B
    const n = normalise(`A${ZWSP}B`)
    expect(n.text).toBe('AB')
    expect(toOriginalStart(n, 0)).toBe(0)
    expect(toOriginalStart(n, 1)).toBe(2)
    expect(toOriginalSpan(n, 0, 2)).toEqual([0, 3])
  })

  it('does not swallow a removed character sitting after the match', () => {
    const n = normalise(`AB${ZWSP}`)
    expect(n.text).toBe('AB')
    // The match is "AB" at original [0,2). Translating `end` directly would
    // give 3 and delete the trailing ZWSP along with it.
    expect(toOriginalSpan(n, 0, 2)).toEqual([0, 2])
  })

  it('handles several removals in a row', () => {
    const n = normalise(`A${ZWSP}${ZWSP}${BOM}B`)
    expect(n.text).toBe('AB')
    expect(toOriginalStart(n, 1)).toBe(4)
  })

  it('handles a removal before the very first character', () => {
    const n = normalise(`${BOM}AB`)
    expect(n.text).toBe('AB')
    expect(toOriginalSpan(n, 0, 2)).toEqual([1, 3])
  })

  it('clamps a zero-length end', () => {
    const n = normalise(`${BOM}AB`)
    expect(toOriginalEnd(n, 0)).toBe(0)
  })

  it('round-trips every position of a message full of removals', () => {
    const original = `ก${ZWSP}ข${BOM}ค${SOFT_HYPHEN}ง${ZWSP}จ`
    const n = normalise(original)
    expect(n.text).toBe('กขคงจ')
    for (let i = 0; i < n.text.length; i++) {
      expect(original[toOriginalStart(n, i)]).toBe(n.text[i])
    }
  })
})

describe('the original text is what gets rewritten', () => {
  it('keeps the original alongside the folded copy', () => {
    const input = 'เบอร์ ๐๙๑-๘๘๘-๗๗๗๗'
    const n = normalise(input)
    expect(n.original).toBe(input)
    expect(n.text).not.toBe(input)
  })
})

describe('Thai national ID checksum', () => {
  it('accepts generated ids', () => {
    for (let i = 0; i < 300; i++) expect(isValidThaiNationalId(makeThaiId())).toBe(true)
  })

  it('rejects the wrong length, non-digits, and a bad check digit', () => {
    expect(isValidThaiNationalId('310050012345')).toBe(false)
    expect(isValidThaiNationalId('31005001234a8')).toBe(false)
    expect(isValidThaiNationalId('3100500123451')).toBe(false)
  })

  it('cannot detect an error in digit 3, whose weight is 11', () => {
    const id = '3100500123458'
    for (let d = 0; d <= 9; d++) {
      const mutated = `${id.slice(0, 2)}${d}${id.slice(3)}`
      expect(isValidThaiNationalId(mutated), `digit 3 = ${d}`).toBe(true)
    }
  })

  it('detects a single-digit error everywhere else', () => {
    const id = '3100500123458'
    let caught = 0
    let tried = 0
    for (let p = 0; p < 13; p++) {
      if (p === 2) continue
      for (let d = 0; d <= 9; d++) {
        if (Number(id[p]) === d) continue
        tried++
        if (!isValidThaiNationalId(`${id.slice(0, p)}${d}${id.slice(p + 1)}`)) caught++
      }
    }
    // Not 100%: folding 11 possible remainders into 10 digits collapses two of
    // them onto the same check digit. Documented in bench/README.md.
    expect(caught / tried).toBeGreaterThan(0.95)
  })
})
