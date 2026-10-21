import { guardModel } from '@eve-pdpa-extension/eve/guard'
import { defineAgent } from 'eve'
import { pdpa } from './lib/guard.js'
import { recordingModel } from './lib/recording-model.js'

// guardModel puts every prompt through the guard before it leaves for the
// provider — customer messages, tool results, anything the other layers did
// not see. A subagent or a separate compaction model needs wrapping too.
//
// PDPA_TEMPLATE_MOCK_MODEL=1 swaps the real model for one that answers from a
// script and writes down what it was sent: tests and offline demos need no
// API key. Otherwise the model goes through the Vercel AI Gateway (on Vercel,
// OIDC; locally, AI_GATEWAY_API_KEY or /login in eve dev).
//
// defaultTools: false — no shell, file or web tools. A customer-service agent
// needs none, and each is another way for a value to leave: a fetch to a URL
// the model was talked into, a file written in the sandbox.
const mock = process.env.PDPA_TEMPLATE_MOCK_MODEL === '1'

export default defineAgent({
  model: guardModel(mock ? recordingModel() : 'anthropic/claude-opus-5.5', pdpa),
  // eve finds a model's context window in the AI Gateway catalog by its id. A
  // wrapped model reports "gateway/<id>", which the catalog does not list, so
  // the window is given here: set it to the model you choose. 200k is what eve
  // itself records for Claude Opus; the mock's window is its own 1M.
  modelContextWindowTokens: mock ? 1_000_000 : 200_000,
  defaultTools: false,
})
