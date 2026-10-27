import { withTokenResolution } from '@eve-pdpa-extension/eve/guard'
import { defineTool } from 'eve/tools'
import { always } from 'eve/tools/approval'
import { pdpa } from '../lib/guard.js'

export default withTokenResolution(
  defineTool({
    description: 'Send an OTP by SMS.',
    inputSchema: { type: 'object', properties: { phone: { type: 'string' } }, required: ['phone'] },
    approval: always(),
    async execute(input: { phone: string }) {
      return { sent: true, to: input.phone }
    },
  }),
  { ...pdpa, purpose: 'otp_send' },
)
