import { createMemoryState } from '@chat-adapter/state-memory'
import { guardChatSdk, PdpaBlockedError } from '@eve-pdpa-extension/eve/guard'
import type { Message, Thread } from 'chat'
import { createLineAdapter } from 'chat-adapter-line'
import { disableRoute } from 'eve/channels'
import { chatSdkChannel, messageToUserContent } from 'eve/channels/chat-sdk'
import { routeLineApiForTests } from '../lib/offline-line.js'
import { pdpaOptions } from '../lib/pdpa.js'

/**
 * LINE through the Chat SDK bridge and the community LINE adapter, at
 * POST /eve/v1/line. Every message goes through guardChatSdk before eve sees
 * it; a message the policy stops is answered with the reason, which names the
 * kind of data and never the data.
 *
 * Without LINE credentials the route is switched off, so the agent still
 * starts for a curl-only demo.
 */
function lineChannel() {
  routeLineApiForTests()
  const { bot, channel, send } = chatSdkChannel({
    userName: 'ร้านตัวอย่าง',
    adapters: { line: createLineAdapter() },
    // Fine for local runs. In production use a durable Chat SDK state adapter,
    // so subscriptions and webhook dedupe survive a restart.
    state: createMemoryState(),
    // LINE cannot edit a sent message: post each reply once, when it is done.
    streaming: false,
  })

  const guardedSend = guardChatSdk(send, {
    ...pdpaOptions,
    onBlock: async ({ reason, thread }) => {
      await (thread as Thread).post(reason)
    },
  })

  async function forward(thread: Thread, message: Message): Promise<void> {
    try {
      await guardedSend(messageToUserContent(message), { thread })
    } catch (error) {
      // Already answered in onBlock. Anything else is a real failure.
      if (!(error instanceof PdpaBlockedError)) throw error
    }
  }

  // 1:1 chats arrive as direct messages; in groups the bot answers mentions,
  // then every message in a thread it has joined.
  bot.onDirectMessage(forward)
  bot.onNewMention(async (thread, message) => {
    await thread.subscribe()
    await forward(thread, message)
  })
  bot.onSubscribedMessage(forward)

  return channel
}

const configured = Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_CHANNEL_SECRET)

export default configured ? lineChannel() : disableRoute()
