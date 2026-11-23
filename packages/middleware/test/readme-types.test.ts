import { describe, expect, it } from 'vitest'
import { pdpaExpress } from '../src/index.js'
import { build } from './helpers.js'

describe('the README examples type-check', () => {
  it('Express: sessionId reads req.body as Express users write it', () => {
    const { guard } = build()
    const mw = pdpaExpress({ guard, sessionId: (req) => req.body.chatId })
    expect(typeof mw).toBe('function')
  })
})
