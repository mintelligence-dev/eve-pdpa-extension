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
  /**
   * Called when a message reaches a turn with personal data still in it: the
   * channel it came through was not wrapped with `withPdpaGuard`. `channel` is
   * the channel's file stem (`"eve"` for eve's HTTP channel); `entities` the
   * kinds found. Never a value. Without it, the hook warns once per channel.
   */
  readonly onUnmasked?: (info: UnmaskedInfo) => void | Promise<void>
  /** Cancel the turn as well, so an unwrapped channel cannot reach the model. Default false. */
  readonly strict?: boolean
}

export interface UnmaskedInfo {
  readonly channel: string
  readonly entities: readonly string[]
}

// Once per channel per process: the point is to be noticed, not to flood the log.
const warned = new Set<string>()

/** The channel a hook's continuation token names, or eve's HTTP channel when there is none. */
function channelOf(token: string | undefined): string {
  return token === undefined ? 'eve' : (token.split(':')[0] ?? 'eve')
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
        onUnmasked: PdpaHookOptions['onUnmasked']
        strict: boolean
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
        onUnmasked: o.onUnmasked,
        strict: o.strict === true,
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
  // Options passed as an object are complete now, so a missing guard or key
  // stops eve from loading the hook instead of surfacing on the first message.
  // A function is the extension's: its config is bound only after load.
  if (typeof options !== 'function') settings()

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
        // A wrapped channel hands eve text with nothing left to find. Anything
        // found here — other than `flag`, which leaves values on purpose — came
        // through a channel nobody wrapped.
        const unmasked = new Set<string>()
        const guard: Guard = {
          ...s.guard,
          process: async (text, opts) => {
            const out = await s.guard.process(text, opts)
            for (const f of out.findings) {
              if (f.allowlisted === true) continue
              seen.push(f.entity)
              if (f.action !== 'flag') unmasked.add(f.entity)
            }
            return out
          },
        }
        const out = await scanDelivery(
          { message },
          { guard, sessionId: id, boundary: 'inbound', files: 'pass', language: s.language },
        )
        let cancel = out.blocked || seen.some((entity) => s.blockOn.has(entity))
        if (unmasked.size > 0) {
          const info: UnmaskedInfo = {
            channel: channelOf(ctx.channel?.continuationToken),
            entities: [...unmasked],
          }
          if (s.onUnmasked !== undefined) {
            await s.onUnmasked(info)
          } else if (!warned.has(info.channel)) {
            warned.add(info.channel)
            console.warn(
              `[@eve-pdpa-extension/eve] a message from channel "${info.channel}" reached eve with personal data in it (${info.entities.join(', ')}). ` +
                `Wrap agent/channels/${info.channel}.ts with withPdpaGuard.`,
            )
          }
          if (s.strict) cancel = true
        }
        if (cancel) ctx.cancel()
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
