// A guard that throws. Core throws only on input the gateway already refuses,
// so the guard is replaced here — in its own file, to keep the mock away from
// every other test.
import { definePolicy } from '@eve-pdpa-extension/core'
import { describe, expect, it, vi } from 'vitest'
import { createGateway } from '../src/gateway.js'
import { FORWARD_TO, REPLY_TO, recorder, SECRET, signed } from './helpers.js'

vi.mock('@eve-pdpa-extension/core', async (original) => {
  const core = await original<typeof import('@eve-pdpa-extension/core')>()
  return {
    ...core,
    createGuard: (options: Parameters<typeof core.createGuard>[0]) => ({
      ...core.createGuard(options),
      process: () => Promise.reject(new Error('detector exploded on 0918887777')),
    }),
  }
})

describe('a guard that throws', () => {
  it('is a 500 that sends nothing on and says nothing of the message (D4)', async () => {
    const net = recorder()
    const gateway = createGateway({
      policies: {
        default: definePolicy({ entitySet: '0.1', entities: { PHONE: { action: 'mask' } } }),
      },
      secret: SECRET,
      forwardTo: FORWARD_TO,
      replyTo: REPLY_TO,
      onAudit: () => {},
      fetch: net.fetch,
    })
    const res = await gateway.inbound(await signed({ sessionId: 's1', text: 'เบอร์ 0918887777' }))
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(JSON.parse(text)).toMatchObject({ outcome: 'error' })
    expect(text).not.toContain('0918887777')
    expect(net.sent).toHaveLength(0)
  })
})
