import type { UserContent } from 'ai'
import { createContentGuard, type GuardOptions } from './content.js'
import { PdpaBlockedError } from './errors.js'

export interface ChatSdkBlockInfo {
  /** Kinds of data only. Safe to post back to the thread. */
  readonly reason: string
  /** The `thread` the handler passed to `send`, to reply on. */
  readonly thread?: unknown
}

export interface GuardChatSdkOptions extends GuardOptions {
  /**
   * Called once for each message the policy stops, before `PdpaBlockedError`
   * is thrown. Post a notice to `thread` here. A throw from here becomes the
   * `cause` of the error.
   */
  readonly onBlock?: (info: ChatSdkBlockInfo) => void | Promise<void>
}

function threadAddress(options: unknown): string | undefined {
  if (typeof options !== 'object' || options === null) return undefined
  const thread = (options as { readonly thread?: unknown }).thread
  if (typeof thread === 'string') return thread
  if (typeof thread === 'object' && thread !== null) {
    const id = (thread as { readonly id?: unknown }).id
    if (typeof id === 'string') return id
  }
  return undefined
}

/**
 * Wraps the `send` that `chatSdkChannel` returns: the message, and any
 * `context` or `title` passed with it, are masked before eve gets them. A
 * message the policy stops is never sent — `onBlock` is called, then
 * `PdpaBlockedError` is thrown from the handler.
 *
 * Use this or `withPdpaGuard(channel)`, not both: each would scan the message,
 * and audit would get two events for one message.
 */
export function guardChatSdk<S extends (message: string | UserContent, options: any) => any>(
  send: S,
  options: GuardChatSdkOptions = {},
): S {
  const guard = createContentGuard(options, 'chat-sdk')
  const onBlock = options.onBlock
  const guarded = async (message: string | UserContent, sendOptions: any): Promise<unknown> => {
    const out = guard.deliver(
      { message, context: sendOptions?.context, title: sendOptions?.title },
      threadAddress(sendOptions),
    )
    if (out.blocked) {
      let cause: { readonly cause: unknown } | undefined
      if (onBlock !== undefined) {
        try {
          await onBlock({ reason: out.reason, thread: sendOptions?.thread })
        } catch (error) {
          cause = { cause: error }
        }
      }
      throw new PdpaBlockedError(out.reason, cause)
    }
    const masked =
      typeof sendOptions === 'object' && sendOptions !== null
        ? {
            ...sendOptions,
            ...(out.context === undefined ? {} : { context: out.context }),
            ...(out.title === undefined ? {} : { title: out.title }),
          }
        : sendOptions
    return send(out.message, masked)
  }
  return guarded as S
}
