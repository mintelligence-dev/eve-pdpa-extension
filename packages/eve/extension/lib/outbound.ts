/**
 * The outbound side, for every channel at once. eve's built-in channels post
 * what the model wrote from handlers on their `adapter`, one per event type
 * (`message.completed`, `input.requested`, ...). withPdpaGuard replaces each
 * of those that a channel has with one that masks the text of the event first
 * and then calls the channel's own handler with the masked copy: a token
 * becomes its display form (`xxx-xxx-7777`), a token from another chat or one
 * the guard does not hold becomes `[ข้อมูลที่ปิดไว้]`, and text that holds data
 * the policy blocks is replaced by a notice.
 *
 * What the channel then does — post, update a card, set a status — is eve's.
 * Only a handler the channel already has is wrapped: an event it does not
 * handle posts nothing, and nothing needs masking.
 *
 * `adapter` is not in eve's documentation (0.80.1). packages/eve/test/outbound-eve.test.ts
 * runs it under the real runtime — a handler built by defineChannel needs eve's
 * context, so it cannot run in a unit test — and a release of eve that changes
 * it fails there.
 *
 * A handler that throws is logged and dropped by eve: if the guard cannot
 * answer — the token store is down — nothing is posted.
 */
import type { Guard } from '@eve-pdpa-extension/core'
import { type Language, outboundBlockedReason } from './reason.js'
import { currentPdpaSessionId } from './session-state.js'

export interface OutboundOptions {
  readonly guard: Guard
  readonly sessionKey: string
  readonly language: Language
}

type Mask = (text: string) => Promise<string>
type Rewrite = (data: any, mask: Mask) => Promise<any>
type Handler = (data: any, ctx: any) => unknown

const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null

/** One at a time, in order: the audit trail reads in the order the person would. */
async function each<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (const item of items) out.push(await fn(item))
  return out
}

/** Every string inside `value`, masked; the shape stays. */
async function strings(value: unknown, mask: Mask): Promise<unknown> {
  if (typeof value === 'string') return value === '' ? value : mask(value)
  if (Array.isArray(value)) return each(value, (v) => strings(v, mask))
  if (isObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = await strings(v, mask)
    return out
  }
  return value
}

/** `data[field]`, masked, when it is text. */
const text =
  (field: string): Rewrite =>
  async (data, mask) =>
    typeof data?.[field] === 'string' && data[field] !== ''
      ? { ...data, [field]: await mask(data[field]) }
      : data

/** The label a tool shows while it runs: it can be built from the tool's input. */
const presentation: Rewrite = async (data, mask) => {
  if (!isObject(data?.presentation)) return data
  const next: Record<string, unknown> = {}
  for (const [callId, p] of Object.entries(data.presentation)) {
    next[callId] =
      isObject(p) && typeof p.label === 'string' && p.label !== ''
        ? { ...p, label: await mask(p.label) }
        : p
  }
  return { ...data, presentation: next }
}

/** A question or an approval: what is asked, the choices, and the input of the call it gates. */
async function request(r: unknown, mask: Mask): Promise<unknown> {
  if (!isObject(r)) return r
  const next: Record<string, unknown> = { ...r }
  if (typeof r.prompt === 'string' && r.prompt !== '') next.prompt = await mask(r.prompt)
  if (Array.isArray(r.options)) {
    next.options = await each(r.options, async (o) => {
      if (!isObject(o)) return o
      const choice: Record<string, unknown> = { ...o }
      if (typeof o.label === 'string' && o.label !== '') choice.label = await mask(o.label)
      if (typeof o.description === 'string' && o.description !== '') {
        choice.description = await mask(o.description)
      }
      return choice
    })
  }
  if (isObject(r.action) && r.action.input !== undefined) {
    next.action = { ...r.action, input: await strings(r.action.input, mask) }
  }
  return next
}

const REWRITES: Readonly<Record<string, Rewrite>> = {
  'message.completed': text('message'),
  'reasoning.completed': text('reasoning'),
  'input.requested': async (data, mask) =>
    Array.isArray(data?.requests)
      ? { ...data, requests: await each(data.requests, (r) => request(r, mask)) }
      : data,
  // What was answered: a typed answer is shown back on the card.
  'input.resolved': async (data, mask) =>
    Array.isArray(data?.resolutions)
      ? {
          ...data,
          resolutions: await each(data.resolutions, async (r) =>
            isObject(r) && isObject(r.response) && typeof r.response.text === 'string'
              ? { ...r, response: { ...r.response, text: await mask(r.response.text) } }
              : r,
          ),
        }
      : data,
  'actions.requested': presentation,
  'action.partial': presentation,
  'action.result': presentation,
}

/**
 * The adapter with a masking handler in place of each handler of an event
 * that carries text. Every other key is copied as it is.
 */
export function guardAdapter<A extends object>(adapter: A, options: OutboundOptions): A {
  const { guard, sessionKey, language } = options
  const source = adapter as Record<string, unknown>
  const guarded: Record<string, unknown> = { ...source }
  let wrapped = false
  for (const [type, rewrite] of Object.entries(REWRITES)) {
    const original = source[type]
    if (typeof original !== 'function') continue
    wrapped = true
    guarded[type] = async (data: unknown, ctx: any) => {
      const sessionId = await currentPdpaSessionId(sessionKey, ctx.session.id)
      const mask: Mask = async (value) => {
        const out = await guard.process(value, { sessionId, boundary: 'outbound' })
        return out.outcome === 'blocked' ? outboundBlockedReason(language) : out.text
      }
      return (original as Handler).call(adapter, await rewrite(data, mask), ctx)
    }
  }
  // Nothing here posts text: hand back the channel's own adapter.
  return wrapped ? (guarded as A) : adapter
}
