import { withTokenResolution } from '@eve-pdpa-extension/eve/guard'
import { defineTool } from 'eve/tools'
import { pdpa } from '../lib/guard.js'

/**
 * Demo: sends nothing. In a real agent this is where the SMS provider is
 * called with the real number — the only place in the agent that ever holds
 * it. The model passes the token it read; withTokenResolution exchanges it
 * for the number under the `otp_send` purpose the policy allows, and masks
 * what the tool returns.
 */
export default withTokenResolution(
  defineTool({
    description:
      'Send a one-time password (OTP) by SMS to the customer’s phone number. Pass the phone number exactly as it appears in the conversation, token and all.',
    inputSchema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'The phone number, as written in the chat' },
      },
      required: ['phone'],
      additionalProperties: false,
    },
    label: { start: () => 'Sending the OTP', complete: () => 'OTP sent' },
    async execute(input: { phone: string }) {
      // A real sender goes here. Never log `input.phone`: it is the real number.
      return { sent: true, to: input.phone, expiresInMinutes: 5 }
    },
  }),
  { ...pdpa, purpose: 'otp_send' },
)
