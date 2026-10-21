import { appendFileSync } from 'node:fs'
import { mockModel } from 'eve/evals'

const TOKEN = /\[tok:[a-z]{16}\]/

/**
 * eve's deterministic fixture model, plus a record of every prompt it gets.
 *
 * `messages` is the prompt as the model receives it — after guardModel —
 * system prompt, history, tool results and the new message. Set
 * PDPA_TEMPLATE_RECORD_FILE to an absolute path to keep one JSON line per
 * model call.
 *
 * Its script: asked for an OTP with a token in the message, it calls
 * otp_send with that token, then confirms; otherwise it repeats what it read.
 */
export function recordingModel(): ReturnType<typeof mockModel> {
  const file = process.env.PDPA_TEMPLATE_RECORD_FILE
  return mockModel(({ messages, lastUserMessage, toolResults }) => {
    if (file) appendFileSync(file, `${JSON.stringify(messages)}\n`)
    const token = lastUserMessage?.match(TOKEN)?.[0]
    if (token !== undefined && lastUserMessage?.includes('OTP') && toolResults.length === 0) {
      return { toolCalls: [{ name: 'otp_send', input: { phone: token } }] }
    }
    if (token !== undefined && toolResults.length > 0) {
      return `ส่งรหัส OTP ไปที่ ${token} แล้วค่ะ`
    }
    return `(โมเดลทดสอบ) ข้อความที่โมเดลได้รับ: ${lastUserMessage ?? ''}`
  })
}
