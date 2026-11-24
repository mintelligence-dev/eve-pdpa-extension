import { defineTool } from 'eve/tools'
import { pdpa } from '../lib/pdpa.js'

// The model only ever sees a token such as [tok:…] in place of the phone
// number. pdpa.tool() swaps the token for the real number on the way in, and
// only because "otp_send" is in the policy's allowedPurposes for PHONE.
export default pdpa.tool(
  defineTool({
    description:
      'Send a one-time password by SMS. Pass the phone number exactly as written in the chat.',
    inputSchema: { type: 'object', properties: { phone: { type: 'string' } }, required: ['phone'] },
    async execute(input: { phone: string }) {
      // A real agent calls its SMS provider here. This example only shows that
      // the tool received the real number, while the model never did.
      console.log(
        `[otp_send] would send an OTP to ${input.phone.slice(0, 3)}xxxx${input.phone.slice(-3)}`,
      )
      return { sent: true }
    },
  }),
  'otp_send',
)
