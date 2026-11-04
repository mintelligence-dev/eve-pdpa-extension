// @eve-pdpa-extension/eve/guard — the helpers. The extension mount factory is
// the package's default export; both are built from this one directory.

export type {
  AuditRecord,
  CompiledPolicy,
  Guard,
  PolicyInput,
  TokenStore,
} from '@eve-pdpa-extension/core'
export type { GuardableChannel, WithPdpaGuardOptions } from './channel.js'
export { withPdpaGuard } from './channel.js'
export type { PdpaExtensionConfig } from './config.js'
export type {
  BlockInfo,
  EveGuardOptions,
  GuardContentOptions,
  GuardResult,
} from './content.js'
export { guardContent } from './content.js'
export type {
  ChannelOptions,
  CreatePdpaOptions,
  Pdpa,
  PolicyJson,
} from './create-pdpa.js'
export { createPdpa } from './create-pdpa.js'
export type { PdpaConfigErrorCode } from './errors.js'
export { PdpaBlockedError, PdpaConfigError } from './errors.js'
export type { PdpaHookOptions, UnmaskedInfo } from './hook.js'
export { pdpaHook } from './hook.js'
export type { GuardModelOptions } from './model.js'
export { guardModel } from './model.js'
export { derivePdpaSessionId } from './session.js'
export type { OutputGuardOptions, TokenRefusal, TokenResolutionOptions } from './tool.js'
export { withOutputGuard, withTokenResolution } from './tool.js'
