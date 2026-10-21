// What an agent project writes, resolved the strict way (node16) against the
// built package: the mount factory at the package root, the helpers at ./guard.
// A wrong exports map or a declaration that does not line up fails here.
import pdpa from '@eve-pdpa-extension/eve'
import {
  DEFAULT_POLICY,
  type GuardOptions,
  type GuardResult,
  guardChatSdk,
  guardContent,
  PdpaBlockedError,
  pdpaBlockHook,
  withPdpaGuard,
} from '@eve-pdpa-extension/eve/guard'
import type { UserContent } from 'ai'
import { type Channel, defineChannel, POST } from 'eve/channels'
import { localDev } from 'eve/channels/auth'
import { eveChannel } from 'eve/channels/eve'
import { slackChannel } from 'eve/channels/slack'
import type { HookDefinition } from 'eve/hooks'

// agent/extensions/pdpa.ts
export const mounted: ReturnType<typeof pdpa> = pdpa({
  policy: {
    entitySet: '0.1',
    entities: { PHONE: { action: 'mask', keep: 'last4' }, CREDIT_CARD: { action: 'block' } },
  },
  onAudit: (event, ctx) => void [event.type, ctx.source],
})

const options: GuardOptions = { policy: DEFAULT_POLICY, files: 'block', onAudit: () => {} }

// agent/channels/*.ts — the wrapped value has the type of the channel it wraps.
export const slack: ReturnType<typeof slackChannel> = withPdpaGuard(slackChannel(), options)
export const http: ReturnType<typeof eveChannel> = withPdpaGuard(
  eveChannel({ auth: [localDev()] }),
  { onBlock: ({ reason }) => void reason },
)
export const custom: Channel = withPdpaGuard(
  defineChannel({
    routes: [
      POST('/m', async (request, { from }) => {
        const body = (await request.json()) as { message: string }
        await from('t').send(body.message, { auth: null })
        return new Response('ok')
      }),
    ],
  }),
)

// A Chat SDK bridge's send keeps its own signature.
declare const send: (
  message: string | UserContent,
  options: { thread: { id: string } },
) => Promise<{ id: string }>
export const guardedSend: typeof send = guardChatSdk(send, {
  onBlock: ({ reason, thread }) => void [reason, thread],
})

export const hook: HookDefinition<'message.received'> = pdpaBlockHook(options)

const result: GuardResult<string> = guardContent('สวัสดี', options)
export const text: string = result.blocked ? result.reason : result.content
export const isBlocked = (error: unknown): boolean =>
  error instanceof PdpaBlockedError && error.code === 'PDPA_BLOCKED'
