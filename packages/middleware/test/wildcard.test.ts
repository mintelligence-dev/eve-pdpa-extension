import { describe, expect, it } from 'vitest'
import { eachString } from '../src/fields.js'
import { protectBody } from '../src/index.js'
import { build, PHONE, TOKENISE } from './helpers.js'

function seen(body: unknown, paths: string[]): string[] {
  const out: string[] = []
  eachString(body, paths, (v) => out.push(v))
  return out
}

describe('wildcard step *', () => {
  it('*.msg reaches the msg of every key, in order', () => {
    const body = { u1: { msg: 'a' }, u2: { msg: 'b' }, u3: { other: 'c' }, u4: 'd' }
    expect(seen(body, ['*.msg'])).toEqual(['a', 'b'])
  })

  it('data.* reaches every string directly under data, not deeper', () => {
    const body = { data: { x: 'a', y: 2, z: { deep: 'no' }, w: 'b' } }
    expect(seen(body, ['data.*'])).toEqual(['a', 'b'])
  })

  it('*[].text is every array under any key, then each item', () => {
    const body = { c1: [{ text: 'a' }, { text: 'b' }], c2: { text: 'no' }, c3: [{ text: 'c' }] }
    expect(seen(body, ['*[].text'])).toEqual(['a', 'b', 'c'])
  })

  it('* on an array, a string or null reaches nothing', () => {
    expect(seen(['a', 'b'], ['*'])).toEqual([])
    expect(seen('a', ['*'])).toEqual([])
    expect(seen(null, ['*'])).toEqual([])
    expect(seen({ k: ['a'], n: null, s: 'x' }, ['k.*', 'n.*', 's.*', '*.*'])).toEqual([])
  })

  it('an item with role system or developer is skipped under *[]', () => {
    const body = {
      a: [
        { role: 'system', text: 'no' },
        { role: 'user', text: 'yes' },
        { role: 'developer', text: 'no' },
      ],
    }
    expect(seen(body, ['*[].text'])).toEqual(['yes'])
  })

  it('a.*.b walks nested objects', () => {
    const body = { a: { p: { b: 'x' }, q: { b: 'y', c: 'no' }, r: 'no' } }
    expect(seen(body, ['a.*.b'])).toEqual(['x', 'y'])
  })

  it('an empty step is still an error', () => {
    expect(() => seen({}, ['a.[]'])).toThrow(/empty step/)
    expect(() => seen({}, ['a..b'])).toThrow(/empty step/)
  })

  it('set writes into the right place', () => {
    const body = { u1: { msg: 'a' }, u2: { msg: 'b' } }
    eachString(body, ['*.msg'], (v, set) => set(v.toUpperCase()))
    expect(body).toEqual({ u1: { msg: 'A' }, u2: { msg: 'B' } })
  })

  it('a string reached by two paths is visited once', () => {
    expect(seen({ u1: { msg: 'a' }, u2: { msg: 'b' } }, ['*.msg', 'u1.msg', '*.*'])).toEqual([
      'a',
      'b',
    ])
    expect(seen({ k: ['a'] }, ['*[]', '*[]', 'k[]'])).toEqual(['a'])
  })

  it('overlapping paths give one audit event per string', async () => {
    const { guard, events } = build({ PHONE: TOKENISE })
    const body = { u1: { msg: `โทร ${PHONE}` }, u2: { msg: 'สวัสดี' } }
    const r = await protectBody(body, { guard, sessionId: 's1', fields: ['*.msg', 'u1.msg'] })
    expect(r).toMatchObject({ ok: true, changed: true, matched: 2 })
    expect(events.filter((e) => e.type === 'scan')).toHaveLength(2)
  })
})
