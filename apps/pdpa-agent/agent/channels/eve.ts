import { withPdpaGuard } from '@eve-pdpa-extension/eve/guard'
import { localDev, placeholderAuth, vercelOidc } from 'eve/channels/auth'
import { eveChannel } from 'eve/channels/eve'
import { pdpaOptions } from '../lib/pdpa.js'

// eve's default HTTP channel — the one `eve dev`, `curl` and the client SDK
// talk to — with every message masked before eve reads the request.
// placeholderAuth() turns production traffic away until real auth replaces it.
export default withPdpaGuard(
  eveChannel({ auth: [vercelOidc(), localDev(), placeholderAuth()] }),
  pdpaOptions,
)
