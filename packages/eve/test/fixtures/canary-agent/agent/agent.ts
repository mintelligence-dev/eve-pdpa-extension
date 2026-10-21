import { appendFileSync } from 'node:fs'
import { defineAgent } from 'eve'
import { mockModel } from 'eve/evals'

// Records every prompt it is sent to CANARY_RECORD_FILE.
export default defineAgent({
  model: mockModel(({ messages }) => {
    const file = process.env.CANARY_RECORD_FILE
    if (file) appendFileSync(file, `${JSON.stringify(messages)}\n`)
    return 'ok'
  }),
  defaultTools: false,
})
