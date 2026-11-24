import { protectRequest, protectResponse, type WebOptions } from './web.js'

/**
 * The part of Hono's context this needs: the raw Request, replaceable, and the
 * Response once the handler has set it. Declared here so the package does not
 * depend on Hono.
 */
export interface HonoContextLike {
  readonly req: { raw: Request }
  res: Response
}

/**
 * Hono middleware:
 *
 *   app.post('/chat', pdpaHono({ guard }), async (c) => { const body = await c.req.json() … })
 *
 * Put it before anything that reads the body. A body read before this runs
 * cannot be checked, so it is an error — a 500 through Hono's error handler
 * (`app.onError`) — and the handler does not run.
 */
export function pdpaHono(
  options: WebOptions,
): (c: HonoContextLike, next: () => Promise<void>) => Promise<Response | undefined> {
  return async (c, next) => {
    const r = await protectRequest(c.req.raw, options)
    if (!r.ok) return r.response
    c.req.raw = r.request
    await next()
    if (options.responseFields !== undefined)
      c.res = await protectResponse(c.res, r.request, options)
    return undefined
  }
}
