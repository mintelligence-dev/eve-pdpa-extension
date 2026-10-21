import { appendFileSync } from 'node:fs'
import { mockModel } from 'eve/evals'

/**
 * eve's deterministic fixture model, plus a record of every prompt it gets.
 *
 * `messages` is the whole prompt as the model receives it — system prompt,
 * history, the new message — so a test can check that no original value is
 * in any of it. Set PDPA_TEMPLATE_RECORD_FILE to an absolute path to keep one
 * JSON line per model call.
 *
 * The reply repeats what the model read, so `curl` shows the masked message.
 */
export function recordingModel(): ReturnType<typeof mockModel> {
  const file = process.env.PDPA_TEMPLATE_RECORD_FILE
  return mockModel(({ messages, lastUserMessage }) => {
    if (file) appendFileSync(file, `${JSON.stringify(messages)}\n`)
    return `(โมเดลทดสอบ) ข้อความที่โมเดลได้รับ: ${lastUserMessage ?? ''}`
  })
}
