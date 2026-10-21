import { defineAgent } from 'eve'
import { recordingModel } from './lib/recording-model.js'

// PDPA_EXAMPLE_MOCK_MODEL=1 swaps the real model for one that answers from a
// script and writes down what it was sent — tests and offline demos need no
// API key. Otherwise the model goes through the Vercel AI Gateway.
export default defineAgent({
  model:
    process.env.PDPA_EXAMPLE_MOCK_MODEL === '1' ? recordingModel() : 'anthropic/claude-opus-5.5',
})
