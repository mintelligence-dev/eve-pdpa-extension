import { appendFileSync } from 'node:fs'
import { defineTool } from 'eve/tools'
import { pdpa } from '../lib/pdpa.js'

// Sends nothing: it writes the input it was given, which should be the real number.
export default pdpa.tool(
  defineTool({
    description: 'Send an OTP by SMS.',
    inputSchema: { type: 'object', properties: { phone: { type: 'string' } }, required: ['phone'] },
    async execute(input: { phone: string }) {
      appendFileSync(process.env.TOOL_FILE as string, `${JSON.stringify(input)}\n`)
      return { sent: true }
    },
  }),
  'otp_send',
)
