import type { Guard } from '@eve-pdpa-extension/core'
import type { TelegramChannelEvents } from 'eve/channels/telegram'
import { checkGuard } from './content.js'
import { type Language, outboundBlockedReason } from './reason.js'
import { checkSessionKey } from './session.js'
import { currentPdpaSessionId } from './session-state.js'

export interface TelegramEventsOptions {
  readonly guard: Guard
  readonly sessionKey: string
  /** Language of the notice that replaces a reply the policy blocks. Default `th`. */
  readonly language?: Language
}

/**
 * The outbound side, for Telegram. eve's Telegram channel has no renderers:
 * an entry in `events` replaces the built-in handler. This one does what the
 * built-in `message.completed` does — post the finished reply as plain text,
 * skipping the narration before a tool call — after the reply has gone
 * through the guard at `outbound`: a token becomes its display form
 * (`xxx-xxx-7777`), a token from another chat or one the guard does not hold
 * becomes `[ข้อมูลที่ปิดไว้]`, and a reply that holds data the policy blocks
 * is replaced by a notice.
 *
 * Every other event — questions, approvals, sign-ins, errors — keeps eve's
 * default.
 *
 *   telegramChannel({ events: pdpaTelegramEvents({ guard, sessionKey }) })
 */
export function pdpaTelegramEvents(
  options: TelegramEventsOptions,
): Pick<TelegramChannelEvents, 'message.completed'> {
  checkGuard(options?.guard)
  checkSessionKey(options.sessionKey)
  const { guard, sessionKey } = options
  const language: Language = options.language ?? 'th'
  return {
    async 'message.completed'(event, channel, ctx) {
      if (event.finishReason === 'tool-calls' || !event.message) return
      const sessionId = await currentPdpaSessionId(sessionKey, ctx.session.id)
      const out = await guard.process(event.message, { sessionId, boundary: 'outbound' })
      await channel.telegram.post(
        out.outcome === 'blocked' ? outboundBlockedReason(language) : out.text,
      )
    },
  }
}
