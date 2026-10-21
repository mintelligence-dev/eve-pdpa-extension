import pdpa from '@eve-pdpa-extension/eve'
import { pdpaOptions } from '../lib/pdpa.js'

// The extension adds one hook: if a message the policy blocks still reaches a
// turn — through a channel nobody wrapped — the turn is cancelled before the
// model runs. It cannot mask; the channel wrappers do that.
export default pdpa({ onAudit: pdpaOptions.onAudit })
