// A fixture agent set up only with createPdpa: the registry item's files are
// written in next to these by easy-agent.test.ts, from r/pdpa.json.
import { appendFileSync } from 'node:fs'
import { defineAgent } from 'eve'
import { mockModel } from 'eve/evals'
import { pdpa } from './lib/pdpa.js'

const TOKEN = /\[tok:[a-z]{16}\]/

// Keeps every prompt it is sent; asks for otp_send when told to, then repeats the token.
export default defineAgent({
  model: pdpa.model(
    mockModel(({ messages, lastUserMessage, toolResults }) => {
      appendFileSync(process.env.PROMPT_FILE as string, `${JSON.stringify(messages)}\n`)
      const token = TOKEN.exec(lastUserMessage ?? '')?.[0] ?? ''
      if (toolResults.length > 0) return `ส่ง OTP ไปที่ ${token} แล้วค่ะ`
      if ((lastUserMessage ?? '').includes('ขอ OTP')) {
        return { toolCalls: [{ name: 'otp_send', input: { phone: token } }] }
      }
      return 'รับทราบค่ะ'
    }),
  ),
  // A wrapped model hides its id from eve's catalog: the README asks for this line too.
  modelContextWindowTokens: 1_000_000,
  defaultTools: false,
})
