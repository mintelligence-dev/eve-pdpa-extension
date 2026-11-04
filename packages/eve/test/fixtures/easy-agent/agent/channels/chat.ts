import { appendFileSync } from 'node:fs'
import { PdpaBlockedError } from '@eve-pdpa-extension/eve/guard'
import { defineChannel, POST } from 'eve/channels'
import { pdpa } from '../lib/pdpa.js'

// Posts nothing anywhere: it writes what a built-in channel would post to a file.
const post = (type: string) => (data: unknown) =>
  appendFileSync(process.env.OUTBOUND_FILE as string, `${JSON.stringify({ type, data })}\n`)

export default pdpa.channel(
  defineChannel({
    routes: [
      POST('/in', async (request, { from }) => {
        const body = (await request.json()) as { message: string; address: string }
        try {
          const session = await from(body.address).send(body.message, { auth: null })
          return Response.json({ sessionId: session.id })
        } catch (error) {
          if (error instanceof PdpaBlockedError) {
            return Response.json({ blocked: error.reason }, { status: 422 })
          }
          throw error
        }
      }),
    ],
    events: {
      'message.completed': post('message.completed'),
    },
  }),
  'chat',
)
