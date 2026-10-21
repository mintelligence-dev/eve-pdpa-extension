import type { Guard } from '@eve-pdpa-extension/core'
import type { UserContent } from 'ai'
import { defineHook, type HookDefinition } from 'eve/hooks'
import { checkFiles, checkGuard, type EveGuardOptions, scanDelivery } from './content.js'
import type { Language } from './reason.js'
import { checkSessionKey, derivePdpaSessionId, sessionConversation } from './session.js'
import { storedPdpaSessionId, storePdpaSessionId } from './session-state.js'

export interface PdpaHookOptions extends Omit<EveGuardOptions, 'onBlock'> {
  /**
   * Entity types that cancel the turn even where the policy only masks them —
   * for data the agent should never act on, whichever channel it came through.
   */
  readonly blockOn?: readonly string[]
}

/**
 * The hook every tokenising setup needs, and the second line of defence for
 * any setup.
 *
 * - On the first `message.received` of a session it works out the session's
 *   pdpa id — from eve's `ctx.channel.continuationToken`, or the eve session id
 *   when there is no address — and stores it, so tools, the model middleware
 *   and the Slack renderer can use the id the channel issued tokens under.
 * - It cancels the turn when the recorded message holds data the policy blocks
 *   (or a type in `blockOn`) — a channel nobody wrapped. It cannot mask: eve
 *   has already recorded the message by the time a hook runs.
 * - On `session.completed` and `session.failed` it ends the pdpa session, which
 *   deletes its tokens. eve's `reset` reaches no hook: those tokens expire
 *   with their `ttlSec`.
 *
 * Register it in `agent/hooks/pdpa.ts`, next to the tools that resolve tokens:
 * an agent hook and an agent tool share session state.
 */
export function pdpaHook(
  options: PdpaHookOptions | (() => PdpaHookOptions),
): HookDefinition<'message.received' | 'session.completed' | 'session.failed'> {
  let ready:
    | {
        guard: Guard
        sessionKey: string
        files: 'pass' | 'block'
        language: Language
        blockOn: ReadonlySet<string>
      }
    | undefined
  const settings = () => {
    if (ready === undefined) {
      const o = typeof options === 'function' ? options() : options
      checkGuard(o?.guard)
      checkSessionKey(o.sessionKey)
      ready = {
        guard: o.guard,
        sessionKey: o.sessionKey,
        files: checkFiles(o.files),
        language: o.language ?? 'th',
        blockOn: new Set(o.blockOn ?? []),
      }
    }
    return ready
  }
  const idFor = async (ctx: {
    channel?: { continuationToken?: string }
    session: { id: string }
  }) =>
    storedPdpaSessionId() ??
    (await derivePdpaSessionId(
      settings().sessionKey,
      ctx.channel?.continuationToken ?? sessionConversation(ctx.session.id),
    ))
  const end = async (
    ctx: { channel?: { continuationToken?: string }; session?: { id: string } } | undefined,
  ) => {
    if (ctx?.session === undefined) return
    await settings().guard.endSession(await idFor(ctx as never))
  }

  return defineHook({
    events: {
      async 'message.received'(event, ctx) {
        const s = settings()
        const id = await idFor(ctx)
        storePdpaSessionId(id)
        const parts = event.data.parts
        if (s.files === 'block' && parts?.some((p) => p.type === 'file')) {
          ctx.cancel()
          return
        }
        // `parts` when eve recorded them; otherwise the flattened summary.
        const message: UserContent =
          parts === undefined
            ? event.data.message
            : parts.flatMap((p) =>
                p.type === 'text' ? [{ type: 'text' as const, text: p.text }] : [],
              )
        const seen: string[] = []
        const guard: Guard = {
          ...s.guard,
          process: async (text, opts) => {
            const out = await s.guard.process(text, opts)
            for (const f of out.findings) if (f.allowlisted !== true) seen.push(f.entity)
            return out
          },
        }
        const out = await scanDelivery(
          { message },
          { guard, sessionId: id, boundary: 'inbound', files: 'pass', language: s.language },
        )
        if (out.blocked || seen.some((entity) => s.blockOn.has(entity))) ctx.cancel()
      },
      async 'session.completed'(_event, ctx) {
        await end(ctx)
      },
      async 'session.failed'(_event, ctx) {
        await end(ctx)
      },
    },
  })
}
