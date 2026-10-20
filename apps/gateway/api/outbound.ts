import { gateway } from '../lib/gateway.js'

export function POST(request: Request): Promise<Response> {
  return gateway.outbound(request)
}
