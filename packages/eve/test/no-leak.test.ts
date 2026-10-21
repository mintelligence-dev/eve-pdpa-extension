// Every public function, fed synthetic personal data under a policy that masks
// some kinds and blocks others. Whatever comes out — audit events, errors and
// their causes, onBlock calls, HTTP answers, what reaches eve, console output —
// must not hold an original value.
import { readdirSync, readFileSync } from 'node:fs'
import { definePolicy } from '@eve-pdpa-extension/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type GuardOptions,
  guardChatSdk,
  guardContent,
  pdpaBlockHook,
  withPdpaGuard,
} from '../extension/lib/guard.js'
import { dashed, EMAIL, expectNoLeak, PHONE, syntheticId, thaiDigits } from './helpers.js'

const ID = syntheticId(7)
const CARD = '4111 1111 1111 1111'
const ORIGINALS = [ID, PHONE, EMAIL, CARD]

const MASKS = definePolicy({
  entitySet: '0.1',
  entities: {
    TH_NATIONAL_ID: { action: 'redact' },
    PHONE: { action: 'mask' },
    EMAIL: { action: 'redact' },
  },
})
const BLOCKS = definePolicy({
  entitySet: '0.1',
  placeholderLanguage: 'en',
  entities: { TH_NATIONAL_ID: { action: 'block' }, CREDIT_CARD: { action: 'block' } },
})

const MESSAGES = [
  `เลขบัตร ${dashed(ID)} โทร ${PHONE} เมล ${EMAIL}`,
  `${thaiDigits(dashed(ID))} ${thaiDigits(PHONE)}`,
  `card ${CARD} and ${EMAIL}`,
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe('no original value leaves the package', () => {
  for (const policy of [MASKS, BLOCKS]) {
    it(`through any public function (${policy === MASKS ? 'masking' : 'blocking'} policy)`, async () => {
      const console = [
        vi.spyOn(globalThis.console, 'log'),
        vi.spyOn(globalThis.console, 'warn'),
        vi.spyOn(globalThis.console, 'error'),
        vi.spyOn(globalThis.console, 'info'),
      ]
      const seen: unknown[] = []
      const options: GuardOptions & { onBlock: (info: unknown) => Promise<void> } = {
        policy,
        onAudit: (event, ctx) => void seen.push(event, ctx),
        onBlock: async (info) => {
          seen.push(info)
          throw new Error('notice failed')
        },
      }
      const keep = async (run: () => unknown): Promise<void> => {
        try {
          seen.push(await run())
        } catch (error) {
          seen.push(error)
        }
      }
      const handle = {
        send: async (message: unknown, opts: unknown) => {
          seen.push(message, opts)
          return { id: 'wrun_1' }
        },
      }
      const args = {
        from: () => handle,
        attachSession: () => handle,
        to: () => handle,
      }
      const channel = withPdpaGuard(
        {
          routes: [
            {
              method: 'POST' as const,
              path: '/m',
              handler: async (request: Request, a: typeof args) => {
                const { message } = (await request.json()) as { message: string }
                await a.from().send(message, { auth: null, context: [message], title: message })
                await a.attachSession().send([{ type: 'text', text: message }], { auth: null })
                await a.to().send(message, { auth: null })
                return new Response('ok')
              },
            },
            {
              method: 'POST' as const,
              path: '/eve/v1/session',
              handler: async (request: Request) => {
                seen.push(await request.text())
                return new Response('ok')
              },
            },
          ],
          receive: async (input: { message: string }, ctx: { from: typeof args.from }) =>
            ctx.from().send(input.message, { auth: null }) as never,
        },
        options,
      )
      const chat = guardChatSdk(handle.send, options)
      const hook = pdpaBlockHook(options).events?.['message.received'] as (
        e: unknown,
        c: unknown,
      ) => void

      for (const message of MESSAGES) {
        const body = JSON.stringify({ message, clientContext: { note: message } })
        const req = (path: string) =>
          new Request(`http://127.0.0.1${path}`, { method: 'POST', body })
        await keep(() => guardContent(message, options))
        await keep(() => guardContent([{ type: 'text', text: message }], options))
        await keep(() => (channel.routes[0]?.handler as never as Function)(req('/m'), args))
        await keep(async () => {
          const res: Response = await (channel.routes[1]?.handler as never as Function)(
            req('/eve/v1/session'),
            args,
          )
          return [res.status, await res.text()]
        })
        await keep(() => channel.receive?.({ message }, { from: args.from } as never))
        await keep(() => chat(message, { thread: { id: 'T1' }, context: [message] }))
        await keep(() =>
          hook(
            { type: 'message.received', data: { message, sequence: 1, turnId: 't' } },
            { cancel: () => {}, channel: {}, session: { id: 'wrun_1' } },
          ),
        )
      }

      expect(seen.length).toBeGreaterThan(30)
      expectNoLeak(seen, ORIGINALS)
      expectNoLeak(
        console.flatMap((spy) => spy.mock.calls),
        ORIGINALS,
      )
    })
  }

  it('has no console.log in the library, and one fixed console.warn', () => {
    const dir = new URL('../extension/lib/', import.meta.url)
    const sources = readdirSync(dir).map((f) => readFileSync(new URL(f, dir), 'utf8'))
    const all = sources.join('\n')
    expect(all).not.toMatch(/console\.(log|info|debug|error)/)
    expect(all.match(/console\.warn/g)).toHaveLength(1)
  })
})
