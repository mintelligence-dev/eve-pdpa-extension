// What a guard is made with, so installing this package alone is enough: with
// pnpm or Yarn PnP a dependency's dependency cannot be imported by name.
export type {
  AuditRecord,
  EntityType,
  Guard,
  GuardOptions,
  PolicyInput,
} from '@eve-pdpa-extension/core'
export { createGuard, definePolicy, PdpaError, parsePolicy } from '@eve-pdpa-extension/core'
export type {
  ExpressNext,
  ExpressOptions,
  ExpressRequestLike,
  ExpressResponseLike,
} from './express.js'
export { pdpaExpress } from './express.js'
export type { FieldPath, Preset } from './fields.js'
export { PRESETS } from './fields.js'
export type { HonoContextLike } from './hono.js'
export { pdpaHono } from './hono.js'
export type { AdapterOptions } from './options.js'
export type { ProtectOptions, ProtectResult } from './protect.js'
export { protectBody } from './protect.js'
export type { ProtectRequestResult, WebOptions } from './web.js'
export { protectRequest, protectResponse, withPdpa } from './web.js'
