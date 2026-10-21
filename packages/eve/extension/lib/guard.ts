// @eve-pdpa-extension/eve/guard — the helpers. The extension mount factory is
// the package's default export; both are built from this one directory.

export type { BlockInfo, GuardableChannel, WithPdpaGuardOptions } from './channel.js'
export { withPdpaGuard } from './channel.js'
export type { ChatSdkBlockInfo, GuardChatSdkOptions } from './chat-sdk.js'
export { guardChatSdk } from './chat-sdk.js'
export type { PdpaExtensionConfig } from './config.js'
export type { GuardAuditContext, GuardOptions, GuardResult, GuardSource } from './content.js'
export { guardContent } from './content.js'
export { PdpaBlockedError } from './errors.js'
export { pdpaBlockHook } from './hook.js'
export { DEFAULT_POLICY } from './policy.js'
