import type { EntityType } from '@eve-pdpa-extension/core'
import { type AdapterOptions, BLOCKED_STATUS, blockedBody } from './options.js'
import { protectBody } from './protect.js'

/** The parts of Express's request and response this needs, so the package does not depend on Express. */
export interface ExpressRequestLike {
  /** `any`, as express.json() gives it, so `req.body.chatId` reads as it does in Express. */
  body?: any
}
export interface ExpressResponseLike {
  status(code: number): this
  json(body: unknown): this
}
export type ExpressNext = (error?: unknown) => void

export interface ExpressOptions<Req extends ExpressRequestLike = ExpressRequestLike>
  extends AdapterOptions<Req> {
  /** The answer when the policy blocks a message. Default 422 with `blockedBy`. */
  readonly onBlocked?: (
    blockedBy: readonly EntityType[],
    req: Req,
    res: ExpressResponseLike,
  ) => void
}

/**
 * Express middleware. Needs the body parsed first:
 *
 *   app.post('/chat', express.json(), pdpaExpress({ guard }), handler)
 *
 * With `responseFields`, `res.json` is checked on the way out too. A reply sent
 * another way — `res.send`, a stream — is not.
 */
export function pdpaExpress<Req extends ExpressRequestLike>(
  options: ExpressOptions<Req>,
): (req: Req, res: ExpressResponseLike, next: ExpressNext) => void {
  return (req, res, next) => {
    if (req.body === undefined) {
      next(new TypeError('pdpaExpress: req.body is empty — put express.json() before it'))
      return
    }
    const sessionId = options.sessionId?.(req)
    const ref = options.ref?.(req)
    const scope = {
      guard: options.guard,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(ref === undefined ? {} : { ref }),
    }
    const send = res.json.bind(res)
    const block = (blockedBy: readonly EntityType[]): void => {
      if (options.onBlocked !== undefined) options.onBlocked(blockedBy, req, res)
      else send.call(res.status(BLOCKED_STATUS), blockedBody(blockedBy))
    }

    protectBody(req.body, {
      ...scope,
      ...(options.fields === undefined ? {} : { fields: options.fields }),
    })
      .then((r) => {
        if (!r.ok) return block(r.blockedBy)
        req.body = r.body
        const responseFields = options.responseFields
        if (responseFields !== undefined) {
          res.json = (body: unknown) => {
            protectBody(body, { ...scope, fields: responseFields, boundary: 'outbound' })
              .then((out) => (out.ok ? send(out.body) : block(out.blockedBy)))
              .catch(next)
            return res
          }
        }
        next()
      })
      .catch(next)
  }
}
