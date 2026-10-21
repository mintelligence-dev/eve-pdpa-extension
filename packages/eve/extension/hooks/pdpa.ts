import type { HookDefinition } from 'eve/hooks'
import extension from '../extension.js'
import { createBlockHook } from '../lib/hook.js'

// Read when the first message arrives: by then the consumer's mount has bound
// the config. Reading it at module load could see the defaults instead.
const hook: HookDefinition<'message.received'> = createBlockHook(() => extension.config)

export default hook
