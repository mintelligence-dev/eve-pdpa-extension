import { appendFileSync } from 'node:fs'
import { withPdpaGuard } from '@eve-pdpa-extension/eve/guard'
import { defineChannel, POST } from 'eve/channels'
import { pdpa } from '../lib/guard.js'

// Posts nothing anywhere: it writes what a built-in channel would post to a file.
const post = (type: string) => (data: unknown) =>
  appendFileSync(process.env.OUTBOUND_FILE as string, `${JSON.stringify({ type, data })}\n`)

export default withPdpaGuard(
  defineChannel({
    routes: [
      POST('/in', async (request, { from }) => {
        const body = (await request.json()) as { message: string; address: string }
        const session = await from(body.address).send(body.message, { auth: null })
        return Response.json({ sessionId: session.id })
      }),
    ],
    events: {
      'message.completed': post('message.completed'),
      'input.requested': post('input.requested'),
    },
  }),
  { ...pdpa, channelName: 'chat' },
)
