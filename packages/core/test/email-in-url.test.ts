import { describe, expect, it } from 'vitest'
import { emailDetector } from '../src/detectors/email.js'
import { normalise } from '../src/normalise.js'
import type { Candidate } from '../src/types.js'

/** What the email detector spans in the text. */
function found(text: string): string[] {
  const n = normalise(text)
  return (emailDetector.detect(n, { sessionId: 's', boundary: 'inbound' }) as Candidate[]).map(
    (c) => n.text.slice(c.start, c.end),
  )
}

describe('a link with an @ in its path is no address (issue, 20 Nov)', () => {
  it('a LINE OA or Instagram handle', () => {
    expect(found('https://line.me/R/ti/p/@cheerball.com')).toEqual([])
    expect(found('https://www.instagram.com/@hangover.project')).toEqual([])
    expect(found('line.me/R/ti/p/@abc.com')).toEqual([])
  })

  it('an address inside a link is spanned from after the last slash', () => {
    expect(found('https://somchai@example.com')).toEqual(['somchai@example.com'])
    expect(found('https://x.com/u?email=a@b.com')).toEqual(['u?email=a@b.com'])
  })
})

describe('a slash ends the local part, as a space does', () => {
  it('an address followed by a slash is found', () => {
    expect(found('somchai@example.com/')).toEqual(['somchai@example.com'])
    expect(found('อีเมล somchai@example.com/โทร 0812345678')).toEqual(['somchai@example.com'])
  })

  it('a slash before the address is not part of it', () => {
    expect(found('a/b@example.com')).toEqual(['b@example.com'])
  })
})

describe('unchanged', () => {
  it('addresses in brackets, after mailto: and after email=', () => {
    expect(found('mailto:somchai@example.com')).toEqual(['somchai@example.com'])
    expect(found('<somchai@example.com>')).toEqual(['somchai@example.com'])
    expect(found('(somchai@example.com)')).toEqual(['somchai@example.com'])
    expect(found('email=somchai@example.com')).toEqual(['somchai@example.com'])
  })
})
