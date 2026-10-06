import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as core from '../src/index.js'
import { VERSION } from '../src/version.js'

describe('public surface', () => {
  it('exports everything the smoke tests and consumers rely on', () => {
    for (const name of [
      'createGuard',
      'definePolicy',
      'parsePolicy',
      'normalise',
      'isValidThaiNationalId',
      'PdpaError',
      'VERSION',
      'ENTITY_TYPES',
      'ACTIONS',
      'createMemoryTokenStore',
    ]) {
      expect(core, `missing export: ${name}`).toHaveProperty(name)
    }
  })

  it('has no default export — it breaks require() interop', () => {
    expect('default' in core).toBe(false)
  })

  it('keeps VERSION in step with package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(VERSION).toBe(pkg.version)
  })

  it('declares exactly the 0.1 entity set', () => {
    expect([...core.ENTITY_TYPES]).toEqual([
      'TH_NATIONAL_ID',
      'PHONE',
      'EMAIL',
      'BANK_ACCOUNT',
      'CREDIT_CARD',
      'LINE_USER_ID',
    ])
  })
})
