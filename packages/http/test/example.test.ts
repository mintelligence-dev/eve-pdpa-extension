// The policies in apps/webhook are what the deployed webhook runs with. They must
// load, and a webhook must start with them the way lib/webhook.ts starts it.
import { readFileSync } from 'node:fs'
import { createMemoryTokenStore, parsePolicy } from '@eve-pdpa-extension/core'
import { describe, expect, it } from 'vitest'
import { createWebhook } from '../src/webhook.js'
import { FORWARD_TO, REPLY_TO, RESOLVE_SECRET, SECRET } from './helpers.js'

const policy = (name: string) =>
  parsePolicy(
    readFileSync(new URL(`../../../apps/webhook/policies/${name}.json`, import.meta.url), 'utf8'),
  )

describe('apps/webhook', () => {
  it('default does not tokenise, otp tokenises only the phone number for otp_send', () => {
    const tokenised = (name: string) =>
      Object.entries(policy(name).entities)
        .filter(([, rule]) => rule?.action === 'tokenise')
        .map(([entity, rule]) => [entity, rule?.allowedPurposes])
    expect(tokenised('default')).toEqual([])
    expect(tokenised('otp')).toEqual([['PHONE', ['otp_send']]])
  })

  it('a webhook starts with both, as lib/webhook.ts builds it', () => {
    expect(() =>
      createWebhook({
        policies: { default: policy('default'), otp: policy('otp') },
        secret: SECRET,
        forwardTo: FORWARD_TO,
        replyTo: REPLY_TO,
        resolveSecret: RESOLVE_SECRET,
        tokenStore: createMemoryTokenStore(),
        onAudit: () => {},
      }),
    ).not.toThrow()
  })
})
