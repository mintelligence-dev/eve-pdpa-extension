import { type AuditRecord, definePolicy } from '@eve-pdpa-extension/core'
import { describe, expect, it, vi } from 'vitest'
import extension from '../extension/extension.js'
import extensionHook from '../extension/hooks/pdpa.js'
import { configSchema } from '../extension/lib/config.js'
import { DEFAULT_POLICY, type GuardAuditContext, pdpaBlockHook } from '../extension/lib/guard.js'
import { dashed, EMAIL, expectNoLeak, PHONE, syntheticId } from './helpers.js'

const ID = syntheticId(6)
const CARD = '4111 1111 1111 1111'

type Part = { type: 'text'; text: string } | { type: 'file'; mediaType: string; filename?: string }

/** A `message.received` event and hook context, shaped as eve 0.80.1 passes them. */
function received(message: string, parts?: Part[]) {
  const event = {
    type: 'message.received' as const,
    data: { message, ...(parts === undefined ? {} : { parts }), sequence: 1, turnId: 'turn_1' },
    meta: { id: 'evt_1', at: '2026-10-19T00:00:00.000Z' },
  }
  const ctx = {
    cancel: vi.fn(),
    agent: { name: 'line-agent' },
    channel: { kind: 'channel:line', continuationToken: 'line:Cbot:user:Usynthetic' },
    session: { id: 'wrun_1' },
  }
  return { event, ctx }
}

type Handler = (event: unknown, ctx: unknown) => void | Promise<void>
const handlerOf = (hook: { events?: Record<string, unknown> }): Handler =>
  hook.events?.['message.received'] as Handler

describe('pdpaBlockHook', () => {
  it('cancels the turn once when the message holds data the policy blocks', async () => {
    const { event, ctx } = received(`บัตร ${CARD} ครับ`)
    await handlerOf(pdpaBlockHook({ onAudit: () => {} }))(event, ctx)
    expect(ctx.cancel).toHaveBeenCalledOnce()
  })

  it('lets a clean message, or one the policy only masks, run', async () => {
    const hook = handlerOf(pdpaBlockHook({ onAudit: () => {} }))
    for (const text of ['สวัสดีค่ะ', `เลขบัตร ${dashed(ID)} โทร ${PHONE}`]) {
      const { event, ctx } = received(text)
      await hook(event, ctx)
      expect(ctx.cancel).not.toHaveBeenCalled()
    }
  })

  it('scans the text parts when eve recorded parts', async () => {
    const hook = handlerOf(pdpaBlockHook({ onAudit: () => {} }))
    const { event, ctx } = received('[file: card.png (image/png)]', [
      { type: 'text', text: `บัตร ${CARD}` },
      { type: 'file', mediaType: 'image/png', filename: 'card.png' },
    ])
    await hook(event, ctx)
    expect(ctx.cancel).toHaveBeenCalledOnce()
  })

  it('cancels a message with a file when files is "block"', async () => {
    const hook = handlerOf(pdpaBlockHook({ files: 'block', onAudit: () => {} }))
    const { event, ctx } = received('ดูไฟล์นี้', [
      { type: 'text', text: 'ดูไฟล์นี้' },
      { type: 'file', mediaType: 'application/pdf' },
    ])
    await hook(event, ctx)
    expect(ctx.cancel).toHaveBeenCalledOnce()
  })

  it('audits each message with source "hook" and the conversation address, no values', async () => {
    const events: AuditRecord[] = []
    const contexts: GuardAuditContext[] = []
    const hook = handlerOf(
      pdpaBlockHook({
        onAudit: (e, ctx) => {
          events.push(e)
          contexts.push(ctx)
        },
      }),
    )
    const { event, ctx } = received(`เลขบัตร ${dashed(ID)} เมล ${EMAIL} บัตร ${CARD}`)
    await hook(event, ctx)
    expect(events.map((e) => e.type)).toEqual(['policy.loaded', 'scan'])
    expect(contexts[1]).toEqual({ source: 'hook', address: 'line:Cbot:user:Usynthetic' })
    expect(events[1]).toMatchObject({ outcome: 'blocked', boundary: 'inbound' })
    expectNoLeak(events, [ID, EMAIL, CARD])
  })
})

describe('the extension', () => {
  const validate = (value: unknown) => configSchema['~standard'].validate(value)

  it('defaults to DEFAULT_POLICY', () => {
    expect(validate(undefined)).toEqual({ value: { policy: DEFAULT_POLICY } })
    expect(validate({})).toEqual({ value: { policy: DEFAULT_POLICY } })
  })

  it('compiles a policy given as plain JSON', () => {
    const policy = { entitySet: '0.1', entities: { PHONE: { action: 'redact' } } }
    const out = validate({ policy, files: 'block' }) as { value: { policy: { hash: string } } }
    expect(out.value.policy.hash).toBe(definePolicy(policy as never).hash)
    expect(out.value).toMatchObject({ files: 'block' })
  })

  it('names the field that is wrong, never a value', () => {
    expect(validate({ polcy: {} })).toEqual({
      issues: [{ path: ['polcy'], message: 'unknown field — check the spelling' }],
    })
    const bad = validate({
      policy: { entitySet: '0.1', entities: { PHONE: { action: 'erase' } } },
      files: 'drop',
      onAudit: 'console',
    }) as { issues: { path: string[]; message: string }[] }
    expect(bad.issues.map((i) => i.path[0])).toEqual(['policy', 'files', 'onAudit'])
    expect(bad.issues[0]?.message).toMatch(/^entities\.PHONE\.action: expected one of/)
  })

  it('refuses tokenise, and hash without a key, at the mount', () => {
    const tokenise = validate({
      policy: {
        entitySet: '0.1',
        entities: { PHONE: { action: 'tokenise', allowedPurposes: ['otp'] } },
      },
    }) as { issues: { path: string[]; message: string }[] }
    expect(tokenise.issues[0]?.message).toMatch(/tokenise is not supported/)
    const hash = validate({
      policy: { entitySet: '0.1', entities: { EMAIL: { action: 'hash' } } },
    }) as { issues: { path: string[]; message: string }[] }
    expect(hash.issues[0]?.path).toEqual(['hmacKey'])
    expect(
      validate({
        policy: { entitySet: '0.1', entities: { EMAIL: { action: 'hash' } } },
        hmacKey: 'k'.repeat(64),
      }),
    ).toHaveProperty('value')
  })

  it('binds the mount config, and its hook reads it on the first message', async () => {
    const audit: AuditRecord[] = []
    expect(() => extension({ policy: { entitySet: '0.1', entities: { X: {} } } } as never)).toThrow(
      /^Invalid extension config: policy: entities\.X: unknown entity type/,
    )
    extension({
      policy: { entitySet: '0.1', entities: { PHONE: { action: 'block' } } },
      onAudit: (e) => {
        audit.push(e)
      },
    })
    const { event, ctx } = received(`โทร ${PHONE}`)
    await (extensionHook.events?.['message.received'] as Handler)(event, ctx)
    expect(ctx.cancel).toHaveBeenCalledOnce()
    expect(audit.at(-1)).toMatchObject({ type: 'scan', outcome: 'blocked' })
    expectNoLeak(audit, [PHONE])
  })
})
