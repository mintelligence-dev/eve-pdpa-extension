import { defineExtension, type ExtensionHandle } from 'eve/extension'
import { configSchema } from './lib/config.js'

/**
 * The mount factory consumers call from `agent/extensions/<name>.ts`:
 *
 *   import pdpa from '@eve-pdpa-extension/eve'
 *   export default pdpa({ policy })
 *
 * It contributes one hook, `hooks/pdpa.ts`. Masking is done by the channel
 * wrappers in `@eve-pdpa-extension/eve/guard`, which a mount cannot install.
 */
const extension: ExtensionHandle<typeof configSchema> = defineExtension({ config: configSchema })

export default extension
