import type { AuditEvent } from '@eve-pdpa-extension/core'
import { describe, expect, it } from 'vitest'
import { derivePdpaSessionId, guardContent } from '../extension/lib/guard.js'
import { expectNoLeak, makeGuard, PHONE, SESSION_KEY } from './helpers.js'

const LINE_THREAD = `line:line:Cbot:user:U${'0'.repeat(31)}7`
const SLACK_THREAD = 'slack:C0123ABC:1800000000.000100'

describe('derivePdpaSessionId', () => {
  it('gives the same id for the same key and conversation, in a fixed shape', async () => {
    const a = await derivePdpaSessionId(SESSION_KEY, SLACK_THREAD)
    const b = await derivePdpaSessionId(SESSION_KEY, SLACK_THREAD)
    expect(a).toBe(b)
    expect(a).toMatch(/^eve_[a-z2-7]{26}$/)
  })

  it('differs across addresses, channels and keys', async () => {
    const ids = await Promise.all([
      derivePdpaSessionId(SESSION_KEY, 'slack:C0123ABC:1800000000.000100'),
      derivePdpaSessionId(SESSION_KEY, 'slack:C0123ABC:1800000000.000200'),
      derivePdpaSessionId(SESSION_KEY, 'teams:C0123ABC:1800000000.000100'),
      derivePdpaSessionId('c3'.repeat(32), 'slack:C0123ABC:1800000000.000100'),
      derivePdpaSessionId(SESSION_KEY, 'session:wrun_01SYNTHETIC'),
    ])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('reveals neither the address nor the key', async () => {
    const id = await derivePdpaSessionId(SESSION_KEY, LINE_THREAD)
    for (const part of ['line', 'Cbot', '0000000', SESSION_KEY.slice(0, 8)]) {
      expect(id.slice(4)).not.toContain(part)
    }
  })

  it('refuses a short key without echoing it', async () => {
    const short = 'not-a-real-secret'
    await expect(derivePdpaSessionId(short, SLACK_THREAD)).rejects.toThrow(/at least 32 bytes/)
    await derivePdpaSessionId(short, SLACK_THREAD).catch((error: unknown) =>
      expectNoLeak(error, [short]),
    )
    await expect(derivePdpaSessionId(SESSION_KEY, '')).rejects.toThrow(TypeError)
  })

  it('is the only session id audit sees', async () => {
    const { guard, audit } = makeGuard()
    const sessionId = await derivePdpaSessionId(SESSION_KEY, LINE_THREAD)
    await guardContent(`เบอร์ ${PHONE}`, { guard, sessionId })
    const scans = audit.filter((e): e is AuditEvent => e.type === 'scan')
    expect(scans.map((e) => e.sessionId)).toEqual([sessionId])
    expect(JSON.stringify(audit)).not.toContain('Cbot')
    expectNoLeak(audit, [PHONE, SESSION_KEY])
  })
})
