// apps/webhook/openapi.json and API.md are what other teams build against
// (D23). These tests hold them to the webhook: every field the spec lists is
// accepted and every rule it states is enforced, and a signature computed from
// the recipe in API.md — with node:crypto, not signRequest — gets through.
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createMemoryTokenStore, definePolicy } from '@eve-pdpa-extension/core'
import { describe, expect, it } from 'vitest'
import { createWebhook, type Webhook } from '../src/webhook.js'
import { FORWARD_TO, REPLY_TO, RESOLVE_SECRET, recorder, SECRET, type Sent } from './helpers.js'

type Schema = {
  $ref?: string
  type?: string
  required?: string[]
  properties?: Record<string, Schema>
  maxLength?: number
}
type Spec = {
  paths: Record<
    string,
    {
      post: {
        requestBody: {
          content: { 'application/json': { schema: Schema; example: Record<string, string> } }
        }
      }
    }
  >
  webhooks: Record<
    string,
    { post: { requestBody: { content: { 'application/json': { schema: Schema } } } } }
  >
  components: { schemas: Record<string, Schema> }
}

const spec = JSON.parse(
  readFileSync(new URL('../../../apps/webhook/openapi.json', import.meta.url), 'utf8'),
) as Spec

/** A schema with its $ref followed, once: the spec never nests refs deeper than that. */
function resolve(schema: Schema): Schema {
  if (schema.$ref === undefined) return schema
  const name = schema.$ref.replace('#/components/schemas/', '')
  return { ...(spec.components.schemas[name] as Schema), ...schema, $ref: undefined }
}

/** The recipe in API.md, written out independently of signRequest. */
function sign(secret: string, scope: string, body: string, now = Date.now()) {
  const timestamp = String(Math.floor(now / 1000))
  const mac = createHmac('sha256', secret).update(`${timestamp}.${scope}.${body}`).digest('hex')
  return { 'x-pdpa-timestamp': timestamp, 'x-pdpa-signature': `v1=${mac}` }
}

const ROUTES = {
  '/api/inbound': { scope: 'inbound', secret: SECRET, call: (w: Webhook) => w.inbound },
  '/api/outbound': { scope: 'outbound', secret: SECRET, call: (w: Webhook) => w.outbound },
  '/api/resolve': { scope: 'resolve', secret: RESOLVE_SECRET, call: (w: Webhook) => w.resolve },
  '/api/end-session': { scope: 'end-session', secret: SECRET, call: (w: Webhook) => w.endSession },
} as const
type Route = keyof typeof ROUTES

function setup() {
  const net = recorder()
  const webhook = createWebhook({
    policies: {
      default: definePolicy({ entitySet: '0.1', entities: { PHONE: { action: 'mask' } } }),
      otp: definePolicy({
        entitySet: '0.1',
        entities: { PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'] } },
      }),
    },
    secret: SECRET,
    resolveSecret: RESOLVE_SECRET,
    tokenStore: createMemoryTokenStore(),
    forwardTo: FORWARD_TO,
    replyTo: REPLY_TO,
    onAudit: () => {},
    fetch: net.fetch,
  })
  return { webhook, sent: net.sent }
}

async function call(webhook: Webhook, route: Route, body: unknown, scope?: string) {
  const r = ROUTES[route]
  const text = JSON.stringify(body)
  const res = await r.call(webhook)(
    new Request(`https://hook.example${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...sign(r.secret, scope ?? r.scope, text) },
      body: text,
    }),
  )
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

const request = (route: Route) => spec.paths[route].post.requestBody.content['application/json']
const routes = Object.keys(ROUTES) as Route[]

describe('openapi.json lists every route the webhook has', () => {
  it('and no other', () => {
    expect(Object.keys(spec.paths).sort()).toEqual([...routes].sort())
  })
})

for (const route of routes) {
  describe(`openapi.json ${route}`, () => {
    const { schema, example } = request(route)
    const body = resolve(schema)
    const properties = body.properties ?? {}

    it('takes its example, signed by the recipe in API.md', async () => {
      const res = await call(setup().webhook, route, example)
      expect(res.status, JSON.stringify(res.body)).toBe(200)
    })

    it('refuses the same request signed for another scope', async () => {
      const other = ROUTES[route].scope === 'inbound' ? 'outbound' : 'inbound'
      expect((await call(setup().webhook, route, example, other)).status).toBe(401)
    })

    for (const field of body.required ?? []) {
      it(`requires ${field}`, async () => {
        const { [field]: _, ...without } = example
        const res = await call(setup().webhook, route, without)
        expect(res.status).toBe(400)
        expect(res.body.field).toBe(field)
      })
    }

    for (const [field, property] of Object.entries(properties)) {
      const max = resolve(property).maxLength
      if (max === undefined) continue
      it(`refuses ${field} over ${max} characters`, async () => {
        const res = await call(setup().webhook, route, { ...example, [field]: 'a'.repeat(max + 1) })
        expect(res.status).toBe(400)
        expect(res.body.field).toBe(field)
      })
    }

    it('accepts every field it lists', async () => {
      for (const field of Object.keys(properties)) {
        const value = example[field] ?? (field === 'context' ? 'ขอเบอร์ติดต่อค่ะ' : undefined)
        expect(value, `the example has no ${field}: add one`).toBeDefined()
        const res = await call(setup().webhook, route, { ...example, [field]: value })
        expect(res.body.field, field).not.toBe('body')
      }
    })

    it('refuses a field it does not list', async () => {
      const res = await call(setup().webhook, route, { ...example, phone: 'x' })
      expect(res.status).toBe(400)
      expect(res.body.field).toBe('body')
    })
  })
}

describe('openapi.json webhooks', () => {
  for (const [name, route, scope] of [
    ['forward', '/api/inbound', 'forward'],
    ['reply', '/api/outbound', 'reply'],
  ] as const) {
    it(`${name}: what is sent matches the spec, signed by the recipe for ${scope}`, async () => {
      const { webhook, sent } = setup()
      await call(webhook, route, request(route).example)
      const out = sent[0] as Sent
      const schema = resolve(
        spec.webhooks[name]?.post.requestBody.content['application/json'].schema as Schema,
      )
      const body = JSON.parse(out.body) as Record<string, unknown>
      for (const field of schema.required ?? []) expect(body, field).toHaveProperty(field)
      expect(Object.keys(body).every((k) => k in (schema.properties ?? {}))).toBe(true)

      // The receiver's check from API.md: same recipe, its own scope.
      const timestamp = out.headers.get('x-pdpa-timestamp') as string
      const expected = sign(SECRET, scope, out.body, Number(timestamp) * 1000)['x-pdpa-signature']
      expect(out.headers.get('x-pdpa-signature')).toBe(expected)
    })
  }
})
