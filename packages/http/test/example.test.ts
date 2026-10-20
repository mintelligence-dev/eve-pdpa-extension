// The policies in apps/gateway are what the deployed gateway runs with. They must
// load, and a gateway must start with them the way lib/gateway.ts starts it.
import { readFileSync } from 'node:fs'
import { createMemoryTokenStore, parsePolicy } from '@eve-pdpa-extension/core'
import { describe, expect, it } from 'vitest'
import { createGateway } from '../src/gateway.js'
import { FORWARD_TO, REPLY_TO, RESOLVE_SECRET, SECRET } from './helpers.js'

const policy = (name: string) =>
  parsePolicy(
    readFileSync(new URL(`../../../apps/gateway/policies/${name}.json`, import.meta.url), 'utf8'),
  )

describe('apps/gateway', () => {
  it('default does not tokenise, otp tokenises only the phone number for otp_send', () => {
    const tokenised = (name: string) =>
      Object.entries(policy(name).entities)
        .filter(([, rule]) => rule?.action === 'tokenise')
        .map(([entity, rule]) => [entity, rule?.allowedPurposes])
    expect(tokenised('default')).toEqual([])
    expect(tokenised('otp')).toEqual([['PHONE', ['otp_send']]])
  })

  it('a gateway starts with both, as lib/gateway.ts builds it', () => {
    expect(() =>
      createGateway({
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
