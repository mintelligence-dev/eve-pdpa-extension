import type { HookDefinition } from 'eve/hooks'
import extension from '../extension.js'
import { pdpaHook } from '../lib/hook.js'

// Read when the first event arrives: by then the consumer's mount has bound
// the config. Reading it at module load could see an unbound handle.
const hook: HookDefinition<'message.received' | 'session.completed' | 'session.failed'> = pdpaHook(
  () => extension.config,
)

export default hook
