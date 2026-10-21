import { pdpaHook } from '@eve-pdpa-extension/eve/guard'
import { pdpa } from '../lib/guard.js'

// Registered here, not through the package's extension mount: an agent hook
// and an agent tool share session state, which is how otp_send learns the
// session id its tokens were issued under. The hook also cancels a turn whose
// message the policy blocks, and deletes a session's tokens when it ends.
export default pdpaHook(pdpa)
