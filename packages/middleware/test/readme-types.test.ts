import { describe, expect, it } from 'vitest'
import { pdpaExpress, pdpaHono, withPdpa } from '../src/index.js'
import { build } from './helpers.js'

describe('the README examples type-check', () => {
  it('Express: sessionId reads req.body as Express users write it', () => {
    const { guard } = build()
    const mw = pdpaExpress({ guard, sessionId: (req) => req.body.chatId })
    expect(typeof mw).toBe('function')
  })

  it('Hono and Next.js: sessionId reads the chat id from the body, with no cast', () => {
    const { guard } = build()
    expect(typeof pdpaHono({ guard, sessionId: (_r, body) => body.chatId })).toBe('function')
    const POST = withPdpa(async () => new Response(), {
      guard,
      sessionId: (_r, body) => body?.chatId,
    })
    expect(typeof POST).toBe('function')
  })
})
