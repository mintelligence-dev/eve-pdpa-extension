import * as core from '@eve-pdpa-extension/core'
import { describe, expect, it } from 'vitest'
import * as mw from '../src/index.js'

describe('one install is enough', () => {
  it('a guard is made with what this package exports, the same functions as core', () => {
    expect(mw.createGuard).toBe(core.createGuard)
    expect(mw.definePolicy).toBe(core.definePolicy)
    expect(mw.parsePolicy).toBe(core.parsePolicy)
    expect(mw.PdpaError).toBe(core.PdpaError)
  })

  it('and it works with the middleware', async () => {
    const guard = mw.createGuard({
      policy: mw.definePolicy({ entitySet: '0.1', entities: {} }),
      onAudit: () => {},
    })
    const r = await mw.protectBody({ prompt: 'เบอร์ 0812345678' }, { guard })
    expect(r).toEqual({ ok: true, body: { prompt: 'เบอร์ [เบอร์โทร]' } })
  })
})
