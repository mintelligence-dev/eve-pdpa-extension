import { describe, expect, it, vi } from 'vitest'
import { type BlockInfo, PdpaBlockedError, withPdpaGuard } from '../extension/lib/guard.js'
import { eveLike, fakeArgs, post } from './fakes.js'
import {
  expectNoLeak,
  failingStore,
  MASK,
  makeGuard,
  PHONE,
  SESSION_KEY,
  TOKENISE,
} from './helpers.js'

/** A channel that hands the body to from().send(), standing in for Slack and the rest. */
function channel() {
  return {
    routes: [
      {
        method: 'POST' as const,
        path: '/m',
        handler: async (request: Request, args: ReturnType<typeof fakeArgs>['args']) => {
          const { message } = (await request.json()) as { message: string }
          await args.from('C1:1800.1').send(message, { auth: null })
          return new Response('ok')
        },
      },
    ],
  }
}

describe('a token store that is down, on the way in', () => {
  it('blocks the message with the store reason, tells onBlock, and never sends it', async () => {
    const { guard, audit } = makeGuard(TOKENISE, failingStore())
    const { args, calls } = fakeArgs()
    const blocks: BlockInfo[] = []
    const wrapped = withPdpaGuard(channel(), {
      guard,
      sessionKey: SESSION_KEY,
      channelName: 'slack',
      onBlock: (info) => void blocks.push(info),
    })
    const sent = (wrapped.routes[0]?.handler as never as Function)(
      post({ message: `ขอ OTP ที่ ${PHONE}` }),
      args,
    )
    await expect(sent).rejects.toBeInstanceOf(PdpaBlockedError)
    await expect(sent).rejects.toThrow(/ไม่สำเร็จชั่วคราว/)
    expect(calls).toEqual([])
    expect(blocks).toEqual([
      { reason: expect.stringContaining('ไม่สำเร็จชั่วคราว'), blockedBy: ['PHONE'] },
    ])
    // core tells a store failure from a policy block in the finding.
    expect(audit.at(-1)).toMatchObject({
      type: 'scan',
      outcome: 'blocked',
      findings: [{ failed: 'token_store' }],
    })
    expectNoLeak([blocks, audit], [PHONE])
  })

  it('answers 422 on eve’s HTTP channel, and the model is never reached', async () => {
    const { guard } = makeGuard(TOKENISE, failingStore())
    const { channel: http, seen } = eveLike()
    const onBlock = vi.fn()
    const wrapped = withPdpaGuard(http, {
      guard,
      sessionKey: SESSION_KEY,
      onBlock,
      allowRawTokensInOutput: true,
    })
    const res: Response = await (wrapped.routes[0]?.handler as never as Function)(
      post({ message: `ขอ OTP ที่ ${PHONE}` }, '/eve/v1/session'),
      fakeArgs().args,
    )
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('ไม่สำเร็จชั่วคราว')
    // Created, then reset: no message was ever sent to the session.
    expect(seen.map((s) => s.path)).toEqual(['/eve/v1/session', '/eve/v1/session/wrun_T1/reset'])
    expect(onBlock).toHaveBeenCalledOnce()
  })
})

describe('a tokenising policy on a channel that cannot rewrite replies', () => {
  it('is refused when eve’s HTTP channel is wrapped, with a message that says why', () => {
    const { guard } = makeGuard(TOKENISE)
    expect(() =>
      withPdpaGuard(eveLike().channel, { guard, sessionKey: SESSION_KEY, policy: TOKENISE }),
    ).toThrow(/\[tok:…\].*shown to the person/)
  })

  it('is allowed with allowRawTokensInOutput, and a masking policy needs no flag', () => {
    const { guard } = makeGuard(TOKENISE)
    expect(() =>
      withPdpaGuard(eveLike().channel, {
        guard,
        sessionKey: SESSION_KEY,
        policy: TOKENISE,
        allowRawTokensInOutput: true,
      }),
    ).not.toThrow()
    expect(() =>
      withPdpaGuard(eveLike().channel, {
        guard: makeGuard(MASK).guard,
        sessionKey: SESSION_KEY,
        policy: MASK,
      }),
    ).not.toThrow()
  })

  it('without the policy to check, refuses the first message that would put a token in a reply', async () => {
    const { guard } = makeGuard(TOKENISE)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channel: http, seen } = eveLike()
    const wrapped = withPdpaGuard(http, { guard, sessionKey: SESSION_KEY })
    const res: Response = await (wrapped.routes[0]?.handler as never as Function)(
      post({ message: `ขอ OTP ที่ ${PHONE}` }, '/eve/v1/session'),
      fakeArgs().args,
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, code: 'pdpa_config', error: expect.any(String) })
    expect(seen.map((s) => s.path)).toEqual(['/eve/v1/session', '/eve/v1/session/wrun_T1/reset'])
    expect(errors).toHaveBeenCalledOnce()
    expectNoLeak(errors.mock.calls, [PHONE])
    errors.mockRestore()
  })

  it('does not apply to channels that are not eve’s HTTP channel', () => {
    const { guard } = makeGuard(TOKENISE)
    expect(() =>
      withPdpaGuard(channel(), {
        guard,
        sessionKey: SESSION_KEY,
        channelName: 'slack',
        policy: TOKENISE,
      }),
    ).not.toThrow()
  })
})
