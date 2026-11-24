import { defineAgent } from 'eve'
import { pdpa } from './lib/pdpa.js'

export default defineAgent({
  // Every prompt passes through the PDPA guard before the model reads it.
  model: pdpa.model('anthropic/claude-haiku-5.5'),
  // A wrapped model hides its id from eve's model catalog, so say how large
  // its context window is. Use your own model's figure if you change it.
  modelContextWindowTokens: 200_000,
  // eve's default tools (bash, files, web fetch) can send what the model reads
  // to places no wrapper watches. This agent only has the tools it defines.
  defaultTools: false,
})
