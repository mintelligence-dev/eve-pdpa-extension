import { describe, expect, it, vi } from 'vitest'
import { guardChatSdk, PdpaBlockedError } from '../extension/lib/guard.js'
import { dashed, EMAIL, expectNoLeak, PHONE, syntheticId } from './helpers.js'

const ID = syntheticId(4)
const CARD = '4111 1111 1111 1111'
const quiet = { onAudit: () => {} }

describe('guardChatSdk', () => {
  it('forwards the masked message and keeps every option, thread included', async () => {
    const send = vi.fn(async (_message: unknown, _options: unknown) => ({ id: 'wrun_1' }))
    const thread = { id: 'line:Cbot:user:Usynthetic', post: vi.fn() }
    const guarded = guardChatSdk(send, quiet)

    const session = await guarded(`เลขบัตร ${dashed(ID)} เมล ${EMAIL}`, {
      thread,
      context: [`โทร ${PHONE}`],
      turnPolicy: 'queue',
    })

    expect(session).toEqual({ id: 'wrun_1' })
    expect(send).toHaveBeenCalledOnce()
    const [message, options] = send.mock.calls[0] ?? []
    expect(message).toBe('เลขบัตร [เลขบัตรประชาชน] เมล [อีเมล]')
    expect(options).toEqual({ thread, context: ['โทร xxx-xxx-7777'], turnPolicy: 'queue' })
    expect((options as { thread: unknown }).thread).toBe(thread)
    expectNoLeak(
      send.mock.calls.map(([m, o]) => [m, { ...(o as object), thread: undefined }]),
      [ID, EMAIL, PHONE],
    )
  })

  it('stops a blocked message: send is not called, onBlock gets the thread', async () => {
    const send = vi.fn(async () => ({ id: 'wrun_1' }))
    const thread = { id: 'line:Cbot:user:Usynthetic' }
    const onBlock = vi.fn()
    const guarded = guardChatSdk(send, { ...quiet, onBlock })

    const sent = guarded(`บัตร ${CARD}`, { thread })

    await expect(sent).rejects.toBeInstanceOf(PdpaBlockedError)
    expect(send).not.toHaveBeenCalled()
    expect(onBlock).toHaveBeenCalledOnce()
    expect(onBlock.mock.calls[0]?.[0]).toEqual({
      reason: expect.stringContaining('เลขบัตรเครดิต'),
      thread,
    })
    expectNoLeak(onBlock.mock.calls[0]?.[0].reason, [CARD])
  })

  it('tells onAudit the thread the message came from', async () => {
    const contexts: unknown[] = []
    const guarded = guardChatSdk(
      vi.fn(async () => ({})),
      {
        onAudit: (_event, ctx) => contexts.push(ctx),
      },
    )
    await guarded('สวัสดี', { thread: { id: 'line:Cbot:user:Usynthetic' } })
    await guarded('สวัสดี', { thread: 'line:Cbot:group:Gsynthetic' })
    expect(contexts).toEqual([
      { source: 'chat-sdk' },
      { source: 'chat-sdk', address: 'line:Cbot:user:Usynthetic' },
      { source: 'chat-sdk', address: 'line:Cbot:group:Gsynthetic' },
    ])
  })

  it('keeps the error safe to log', () => {
    const error = new PdpaBlockedError('ข้อความนี้ไม่ได้ถูกส่งต่อ')
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      name: 'PdpaBlockedError',
      code: 'PDPA_BLOCKED',
      reason: 'ข้อความนี้ไม่ได้ถูกส่งต่อ',
      message: 'ข้อความนี้ไม่ได้ถูกส่งต่อ',
    })
  })
})
