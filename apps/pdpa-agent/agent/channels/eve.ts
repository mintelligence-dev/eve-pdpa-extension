import { withPdpaGuard } from '@eve-pdpa-extension/eve/guard'
import { localDev, placeholderAuth, vercelOidc } from 'eve/channels/auth'
import { eveChannel } from 'eve/channels/eve'
import { pdpa, policy } from '../lib/guard.js'

// eve's default HTTP channel — what `eve dev`, its terminal UI, `curl` and the
// client SDK talk to — with every message masked before eve reads the request.
//
// allowRawTokensInOutput: this channel streams the model's reply as written,
// so a phone token the model repeats ([tok:…]) reaches the caller unrewritten.
// That is acceptable for local development and tests only. Customers reach the
// agent through Slack, whose replies pdpaSlackRenderer rewrites.
//
// placeholderAuth() turns production traffic away until real auth replaces it.
export default withPdpaGuard(eveChannel({ auth: [vercelOidc(), localDev(), placeholderAuth()] }), {
  ...pdpa,
  policy,
  allowRawTokensInOutput: true,
})
