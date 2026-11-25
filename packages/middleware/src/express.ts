import type { Boundary, EntityType } from '@eve-pdpa-extension/core'
import { checkFields } from './fields.js'
import { type AdapterOptions, blockedBody, blockedStatus, namesJson } from './options.js'
import { protectBody } from './protect.js'

/** The parts of Express's request and response this needs, so the package does not depend on Express. */
export interface ExpressRequestLike {
  /** `any`, as express.json() gives it, so `req.body.chatId` reads as it does in Express. */
  body?: any
  readonly headers?: Readonly<Record<string, string | string[] | undefined>>
}
export interface ExpressResponseLike {
  status(code: number): this
  json(body: unknown): this
}
export type ExpressNext = (error?: unknown) => void

export interface ExpressOptions<Req extends ExpressRequestLike = ExpressRequestLike>
  extends AdapterOptions<Req> {
  /**
   * The answer when the policy blocks a message. `boundary` says which way it
   * was going. Default 422 for a request and 502 for a reply, with `blockedBy`.
   */
  readonly onBlocked?: (
    blockedBy: readonly EntityType[],
    req: Req,
    res: ExpressResponseLike,
    boundary: Boundary,
  ) => void
}

/** A string body that holds JSON (express.text(), a raw parser): parsed, or undefined. */
function jsonIn(text: string): { json: unknown } | undefined {
  try {
    const json: unknown = JSON.parse(text)
    return typeof json === 'object' && json !== null ? { json } : undefined
  } catch {
    return undefined
  }
}

/**
 * Express middleware. Needs the body parsed first:
 *
 *   app.post('/chat', express.json(), pdpaExpress({ guard }), handler)
 *
 * With `responseFields`, a reply sent with `res.json` — or `res.send` with an
 * object, which Express passes to `res.json` — is checked on the way out. A
 * string sent with `res.send`, `res.jsonp` and a stream are not.
 */
export function pdpaExpress<Req extends ExpressRequestLike>(
  options: ExpressOptions<Req>,
): (req: Req, res: ExpressResponseLike, next: ExpressNext) => void {
  checkFields(options.fields)
  checkFields(options.responseFields)
  return (req, res, next) => {
    let body: unknown = req.body
    let asText = false
    if (body === undefined) {
      // No parser ran. A JSON request means express.json() is missing — say so
      // rather than let the text through unread. Anything else (a form, a file,
      // plain text) is passed through, as protectRequest does.
      if (namesJson(String(req.headers?.['content-type'] ?? ''))) {
        next(new TypeError('pdpaExpress: req.body is empty — put express.json() before it'))
      } else {
        next()
      }
      return
    }
    if (typeof body === 'string') {
      // express.text() under a JSON body sent as text/plain: the handler may
      // still JSON.parse it, so it is checked like any other.
      const read = jsonIn(body)
      if (read === undefined) return next()
      body = read.json
      asText = true
    }

    const sessionId = options.sessionId?.(req, body)
    const ref = options.ref?.(req, body)
    const scope = {
      guard: options.guard,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(ref === undefined ? {} : { ref }),
    }
    const send = res.json.bind(res)
    const block = (blockedBy: readonly EntityType[], boundary: Boundary): void => {
      if (options.onBlocked !== undefined) options.onBlocked(blockedBy, req, res, boundary)
      else send.call(res.status(blockedStatus(boundary)), blockedBody(blockedBy, boundary))
    }

    const fields = options.fields
    Promise.resolve(options.context?.(req, body))
      .then((context) =>
        protectBody(body, {
          ...scope,
          ...(fields === undefined ? {} : { fields }),
          ...(context === undefined ? {} : { context }),
        }),
      )
      .then((r) => {
        if (!r.ok) return block(r.blockedBy, 'inbound')
        if (r.matched === 0) options.onNoMatch?.(req, 'inbound')
        if (r.changed) req.body = asText ? JSON.stringify(r.body) : r.body
        const responseFields = options.responseFields
        if (responseFields !== undefined) {
          res.json = (reply: unknown) => {
            protectBody(reply, { ...scope, fields: responseFields, boundary: 'outbound' })
              .then((out) => {
                if (!out.ok) return block(out.blockedBy, 'outbound')
                if (out.matched === 0) options.onNoMatch?.(req, 'outbound')
                send(out.body)
              })
              .catch(next)
            return res
          }
        }
        next()
      })
      .catch(next)
  }
}
