// What an agent project writes, resolved the strict way (node16) against the
// built package: the mount factory at the package root, the helpers at ./guard.
// A wrong exports map or a declaration that does not line up fails here.
import { createGuard, createMemoryTokenStore, definePolicy } from '@eve-pdpa-extension/core'
import pdpa from '@eve-pdpa-extension/eve'
import {
  type BlockInfo,
  derivePdpaSessionId,
  type EveGuardOptions,
  type GuardResult,
  guardContent,
  guardModel,
  PdpaBlockedError,
  pdpaHook,
  withPdpaGuard,
  withTokenResolution,
} from '@eve-pdpa-extension/eve/guard'
import type { LanguageModel } from 'ai'
import { defineAgent } from 'eve'
import { type Channel, defineChannel, POST } from 'eve/channels'
import { localDev } from 'eve/channels/auth'
import { eveChannel } from 'eve/channels/eve'
import { slackChannel } from 'eve/channels/slack'
import { defineTool } from 'eve/tools'

const policy = definePolicy({
  entitySet: '0.1',
  entities: {
    PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'] },
    CREDIT_CARD: { action: 'block' },
  },
})
const guard = createGuard({ policy, tokenStore: createMemoryTokenStore(), onAudit: () => {} })
const options: EveGuardOptions = {
  guard,
  sessionKey: process.env.PDPA_SESSION_KEY ?? '',
  onBlock: ({ reason, blockedBy }: BlockInfo) => void [reason, blockedBy],
}

// agent/extensions/pdpa.ts
export const mounted: ReturnType<typeof pdpa> = pdpa({ guard, sessionKey: options.sessionKey })

// agent/hooks/pdpa.ts
export const hook = pdpaHook(options)

// agent/channels/*.ts — the wrapped value has the type of the channel it wraps.
export const slack: ReturnType<typeof slackChannel> = withPdpaGuard(slackChannel(), {
  ...options,
  channelName: 'slack',
})

// agent/tools/otp_send.ts
export const otpSend = withTokenResolution(
  defineTool({
    description: 'Send a one-time password.',
    inputSchema: { type: 'object', properties: { phone: { type: 'string' } } },
    async execute(input: { phone: string }) {
      return { sent: input.phone.length > 0 }
    },
  }),
  { ...options, purpose: 'otp_send' },
)

// agent/agent.ts
const model: LanguageModel = guardModel('anthropic/claude-opus-5.5', options)
export const agent = defineAgent({ model, defaultTools: false })
export const http: ReturnType<typeof eveChannel> = withPdpaGuard(
  eveChannel({ auth: [localDev()] }),
  {
    ...options,
    policy,
    allowRawTokensInOutput: true,
  },
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
  { ...options, channelName: 'custom' },
)

export const result: Promise<GuardResult<string>> = derivePdpaSessionId(
  options.sessionKey,
  'custom:t',
).then((sessionId) => guardContent('สวัสดี', { guard, sessionId }))
export const isBlocked = (error: unknown): boolean =>
  error instanceof PdpaBlockedError && error.code === 'PDPA_BLOCKED'

export const refused = (out: Awaited<ReturnType<typeof otpSend.execute>>): boolean =>
  typeof out === 'object' && out !== null && 'ok' in out && out.ok === false
