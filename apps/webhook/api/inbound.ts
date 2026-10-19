import { webhook } from '../lib/webhook.js'

export function POST(request: Request): Promise<Response> {
  return webhook.inbound(request)
}
