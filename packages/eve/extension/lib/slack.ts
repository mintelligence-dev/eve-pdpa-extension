import type { Guard } from '@eve-pdpa-extension/core'
import { defineSlackRenderer, type SlackRenderer } from 'eve/channels/slack'
import { checkGuard } from './content.js'
import { type Language, outboundBlockedReason } from './reason.js'
import { checkSessionKey } from './session.js'
import { currentPdpaSessionId } from './session-state.js'

export interface SlackRendererOptions {
  readonly guard: Guard
  readonly sessionKey: string
  /** Language of the notice that replaces a reply the policy blocks. Default `th`. */
  readonly language?: Language
}

/**
 * The outbound side, for Slack — the one channel in 0.1 whose replies can be
 * rewritten before they are posted. Every finished assistant message goes
 * through the guard at `outbound`: a token becomes its display form
 * (`xxx-xxx-7777`), a token from another chat or one the guard does not hold
 * becomes `[ข้อมูลที่ปิดไว้]`, and a reply that holds data the policy blocks
 * is replaced by a notice.
 *
 * That includes the narration the model writes before a tool call
 * (`finishReason: "tool-calls"`), which Slack shows as the thread status.
 * Everything else — questions, approvals, sign-ins — runs eve's default.
 *
 *   slackChannel({ renderers: [pdpaSlackRenderer({ guard, sessionKey })] })
 */
export function pdpaSlackRenderer(options: SlackRendererOptions): SlackRenderer {
  checkGuard(options?.guard)
  checkSessionKey(options.sessionKey)
  const { guard, sessionKey } = options
  const language: Language = options.language ?? 'th'
  return defineSlackRenderer({
    events: {
      async 'message.completed'(event, _channel, ctx, next) {
        if (!event.message) return next()
        const sessionId = await currentPdpaSessionId(sessionKey, ctx.session.id)
        const out = await guard.process(event.message, { sessionId, boundary: 'outbound' })
        const message = out.outcome === 'blocked' ? outboundBlockedReason(language) : out.text
        return next({ ...event, message })
      },
    },
  })
}
