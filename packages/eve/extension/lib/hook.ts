import type { UserContent } from 'ai'
import { defineHook, type HookDefinition } from 'eve/hooks'
import { type ContentGuard, createContentGuard, type GuardOptions } from './content.js'

/**
 * The extension's hook reads its options from the mount, which may not have
 * run yet when the hook module loads; so the options are a function, called
 * on the first message.
 */
export function createBlockHook(
  resolveOptions: () => GuardOptions,
): HookDefinition<'message.received'> {
  let guard: ContentGuard | undefined
  return defineHook({
    events: {
      'message.received'(event, ctx) {
        guard ??= createContentGuard(resolveOptions(), 'hook')
        const parts = event.data.parts
        if (guard.files === 'block' && parts?.some((p) => p.type === 'file')) {
          ctx.cancel()
          return
        }
        // `parts` when eve recorded them; otherwise the flattened summary,
        // which also names any file: `[file: name (type)]`.
        const message: UserContent =
          parts === undefined
            ? event.data.message
            : parts.flatMap((p) =>
                p.type === 'text' ? [{ type: 'text' as const, text: p.text }] : [],
              )
        const address = ctx.channel.continuationToken
        const out = guard.deliver({ message }, address)
        if (out.blocked) ctx.cancel()
      },
    },
  })
}

/**
 * Defence in depth, not protection: a hook runs after eve has durably recorded
 * the message, and cannot change what the model reads. Masking happens in the
 * channel — `withPdpaGuard` or `guardChatSdk`.
 *
 * What the hook adds: when a message the policy blocks reaches a turn anyway —
 * a channel nobody wrapped — it cancels the turn before the model runs, and
 * every message is scanned again for audit (`source: "hook"`).
 */
export function pdpaBlockHook(options: GuardOptions = {}): HookDefinition<'message.received'> {
  return createBlockHook(() => options)
}
