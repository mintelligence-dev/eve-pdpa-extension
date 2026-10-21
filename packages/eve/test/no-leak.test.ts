// Every public function, fed synthetic personal data under a tokenising policy
// and a masking one. Whatever comes out — audit events, errors and their
// causes, onBlock calls, HTTP answers, what reaches eve, tool results, console
// output — must not hold an original value, the session key or the HMAC key.
import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

const slots = new Map<string, unknown>()
vi.mock('eve/context', () => ({
  defineState: (name: string, initial: () => unknown) => ({
    get: () => (slots.has(name) ? slots.get(name) : initial()),
    update: (fn: (v: unknown) => unknown) => {
      slots.set(name, fn(slots.has(name) ? slots.get(name) : initial()))
    },
  }),
}))

const {
  derivePdpaSessionId,
  guardContent,
  guardModel,
  pdpaHook,
  pdpaSlackRenderer,
  withPdpaGuard,
  withTokenResolution,
} = await import('../extension/lib/guard.js')
const { defineTool } = await import('eve/tools')
const { generateText } = await import('ai')
const { mockModel } = await import('eve/evals')
const { eveLike, fakeArgs, post } = await import('./fakes.js')
const helpers = await import('./helpers.js')
const {
  dashed,
  EMAIL,
  expectNoLeak,
  HMAC_KEY,
  MASK,
  makeGuard,
  PHONE,
  SESSION_KEY,
  syntheticId,
  thaiDigits,
  TOKENISE,
} = helpers

const ID = syntheticId(7)
const CARD = '4111 1111 1111 1111'
const SECRETS = [ID, PHONE, EMAIL, CARD, SESSION_KEY, HMAC_KEY]
const MESSAGES = [
  `เลขบัตร ${dashed(ID)} โทร ${PHONE} เมล ${EMAIL}`,
  `${thaiDigits(dashed(ID))} ${thaiDigits(PHONE)}`,
  `card ${CARD} and ${EMAIL}`,
]

afterEach(() => {
  vi.restoreAllMocks()
})

/** Runs `fn`, keeping what it returns or throws. */
async function keep(seen: unknown[], fn: () => unknown): Promise<void> {
  try {
    seen.push(await fn())
  } catch (error) {
    seen.push(error)
  }
}

describe('no original value or secret leaves the package', () => {
  for (const [name, policy] of [
    ['tokenising', TOKENISE],
    ['masking', MASK],
  ] as const) {
    it(`through the channel, HTTP, content and hook paths (${name} policy)`, async () => {
      slots.clear()
      const consoles = (['log', 'warn', 'error', 'info'] as const).map((m) => vi.spyOn(console, m))
      const { guard, audit } = makeGuard(policy)
      const seen: unknown[] = []
      const onBlock = async (info: unknown) => {
        seen.push(info)
        throw new Error('notice failed')
      }
      const { args, calls } = fakeArgs()
      const channel = withPdpaGuard(
        {
          routes: [
            {
              method: 'POST' as const,
              path: '/m',
              handler: async (request: Request, a: typeof args) => {
                const { message } = (await request.json()) as { message: string }
                await a.from('C1').send(message, { auth: null, context: [message], title: message })
                await a
                  .attachSession('wrun_1')
                  .send([{ type: 'text', text: message }], { auth: null })
                await a.to('x', {}).send(message, { auth: null })
                return new Response('ok')
              },
            },
          ],
          receive: async (input: { message: string }, ctx: { from: typeof args.from }) =>
            ctx.from('C2').send(input.message, { auth: null }) as never,
        },
        { guard, sessionKey: SESSION_KEY, channelName: 'custom', onBlock },
      )
      const http = withPdpaGuard(eveLike().channel, {
        guard,
        sessionKey: SESSION_KEY,
        onBlock,
        allowRawTokensInOutput: true,
      })
      const hook = pdpaHook({ guard, sessionKey: SESSION_KEY }).events?.['message.received'] as (
        e: unknown,
        c: unknown,
      ) => Promise<void>
      const sessionId = await derivePdpaSessionId(SESSION_KEY, 'custom:C1')

      for (const message of MESSAGES) {
        const body = { message, clientContext: { note: message } }
        await keep(seen, () => guardContent(message, { guard, sessionId }))
        await keep(seen, () =>
          guardContent([{ type: 'text', text: message }], { guard, sessionId }),
        )
        await keep(seen, () => (channel.routes[0]?.handler as never as Function)(post(body), args))
        await keep(seen, async () => {
          const res: Response = await (http.routes[0]?.handler as never as Function)(
            post(body, '/eve/v1/session'),
            fakeArgs().args,
          )
          return [res.status, await res.text()]
        })
        await keep(seen, () => channel.receive?.({ message }, { from: args.from } as never))
        await keep(seen, () =>
          hook(
            { type: 'message.received', data: { message, sequence: 1, turnId: 't' } },
            { cancel: () => {}, channel: {}, session: { id: 'wrun_1' } },
          ),
        )
      }

      expect(seen.length).toBeGreaterThan(20)
      expectNoLeak([seen, calls, audit], SECRETS)
      expectNoLeak(
        consoles.flatMap((spy) => spy.mock.calls),
        SECRETS,
      )
    })
  }

  it('through the tool, model and Slack layers (tokenising policy)', async () => {
    slots.clear()
    const consoles = (['log', 'warn', 'error', 'info'] as const).map((m) => vi.spyOn(console, m))
    const { guard, audit } = makeGuard(TOKENISE)
    const opts = { guard, sessionKey: SESSION_KEY }
    const sessionId = await derivePdpaSessionId(SESSION_KEY, 'slack:C9:1')
    slots.set('eve-pdpa-extension.session', { id: sessionId })
    const seen: unknown[] = []
    const ctx = { session: { id: 'wrun_9' }, callId: 'c', toolName: 't', messages: [] } as never

    for (const message of MESSAGES) {
      const masked = await guardContent(message, { guard, sessionId })
      seen.push(masked)
      const text = masked.blocked ? '' : masked.content
      // A tool that echoes everything it is given, real values included.
      const echo = withTokenResolution(
        defineTool({
          description: 'echo',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
          async execute(input: { text: string }) {
            return { echoed: input.text, again: `${input.text} ${message}` }
          },
        }),
        { ...opts, purpose: 'otp_send' },
      )
      await keep(seen, () => echo.execute({ text }, ctx))
      const prompts: unknown[] = []
      await keep(seen, () =>
        generateText({
          model: guardModel(
            mockModel(({ messages }) => {
              prompts.push(messages)
              return 'ok'
            }),
            opts,
          ),
          messages: [
            { role: 'user', content: message },
            {
              role: 'assistant',
              content: [{ type: 'tool-call', toolCallId: 'x', toolName: 'crm', input: {} }],
            },
            {
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolCallId: 'x',
                  toolName: 'crm',
                  output: { type: 'json', value: { note: message } },
                },
              ],
            },
          ],
        }).then((r) => r.text),
      )
      seen.push(prompts)
      const next = vi.fn(async () => {})
      await (pdpaSlackRenderer(opts).events?.['message.completed'] as Function)(
        {
          message: `${text} / ${message}`,
          finishReason: 'stop',
          sequence: 1,
          stepIndex: 0,
          turnId: 't',
        },
        {},
        { session: { id: 'wrun_9' } },
        next,
      )
      seen.push(next.mock.calls)
    }

    expect(seen.length).toBeGreaterThan(10)
    expectNoLeak([seen, audit], SECRETS)
    expectNoLeak(
      consoles.flatMap((spy) => spy.mock.calls),
      SECRETS,
    )
  })

  it('has no console.log in the library, and one console.error with a fixed text', () => {
    const dir = new URL('../extension/lib/', import.meta.url)
    const all = readdirSync(dir)
      .map((f) => readFileSync(new URL(f, dir), 'utf8'))
      .join('\n')
    expect(all).not.toMatch(/console\.(log|info|debug|warn)/)
    expect(all.match(/console\.error/g)).toHaveLength(1)
  })
})
