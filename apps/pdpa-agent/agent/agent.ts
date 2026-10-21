import { defineAgent } from 'eve'
import { recordingModel } from './lib/recording-model.js'

// PDPA_TEMPLATE_MOCK_MODEL=1 swaps the real model for one that answers from a
// script and writes down what it was sent — tests and offline demos need no
// API key. Otherwise the model goes through the Vercel AI Gateway.
//
// defaultTools: false — no shell, file or web tools. A customer-service agent
// does not need them, and each one is another way for a value to leave: a
// fetch to a URL the model was talked into, a file written in the sandbox.
export default defineAgent({
  model:
    process.env.PDPA_TEMPLATE_MOCK_MODEL === '1' ? recordingModel() : 'anthropic/claude-opus-5.5',
  defaultTools: false,
})
