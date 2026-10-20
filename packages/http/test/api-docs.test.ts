// apps/gateway/public/openapi.json and API.md are what other teams build against
// (D23). These tests hold them to the gateway: every field the spec lists is
// accepted and every rule it states is enforced, and a signature computed from
// the recipe in API.md — with node:crypto, not signRequest — gets through.
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createMemoryTokenStore, definePolicy } from '@eve-pdpa-extension/core'
import { describe, expect, it } from 'vitest'
import { createGateway, type Gateway } from '../src/gateway.js'
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
  readFileSync(new URL('../../../apps/gateway/public/openapi.json', import.meta.url), 'utf8'),
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
  '/api/inbound': { scope: 'inbound', secret: SECRET, call: (w: Gateway) => w.inbound },
  '/api/outbound': { scope: 'outbound', secret: SECRET, call: (w: Gateway) => w.outbound },
  '/api/resolve': { scope: 'resolve', secret: RESOLVE_SECRET, call: (w: Gateway) => w.resolve },
  '/api/end-session': { scope: 'end-session', secret: SECRET, call: (w: Gateway) => w.endSession },
} as const
type Route = keyof typeof ROUTES

function setup() {
  const net = recorder()
  const gateway = createGateway({
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
  return { gateway, sent: net.sent }
}

async function call(gateway: Gateway, route: Route, body: unknown, scope?: string) {
  const r = ROUTES[route]
  const text = JSON.stringify(body)
  const res = await r.call(gateway)(
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

describe('openapi.json lists every route the gateway has', () => {
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
      const res = await call(setup().gateway, route, example)
      expect(res.status, JSON.stringify(res.body)).toBe(200)
    })

    it('refuses the same request signed for another scope', async () => {
      const other = ROUTES[route].scope === 'inbound' ? 'outbound' : 'inbound'
      expect((await call(setup().gateway, route, example, other)).status).toBe(401)
    })

    for (const field of body.required ?? []) {
      it(`requires ${field}`, async () => {
        const { [field]: _, ...without } = example
        const res = await call(setup().gateway, route, without)
        expect(res.status).toBe(400)
        expect(res.body.field).toBe(field)
      })
    }

    for (const [field, property] of Object.entries(properties)) {
      const max = resolve(property).maxLength
      if (max === undefined) continue
      it(`refuses ${field} over ${max} characters`, async () => {
        const res = await call(setup().gateway, route, { ...example, [field]: 'a'.repeat(max + 1) })
        expect(res.status).toBe(400)
        expect(res.body.field).toBe(field)
      })
    }

    it('accepts every field it lists', async () => {
      for (const field of Object.keys(properties)) {
        const value = example[field] ?? (field === 'context' ? 'ขอเบอร์ติดต่อค่ะ' : undefined)
        expect(value, `the example has no ${field}: add one`).toBeDefined()
        const res = await call(setup().gateway, route, { ...example, [field]: value })
        expect(res.body.field, field).not.toBe('body')
      }
    })

    it('refuses a field it does not list', async () => {
      const res = await call(setup().gateway, route, { ...example, phone: 'x' })
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
      const { gateway, sent } = setup()
      await call(gateway, route, request(route).example)
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

// D23: the Postman collection teams import. Its pre-request script runs here
// against stand-ins for Postman's pm and CryptoJS, and what it signs must get
// through the gateway.
describe('the Postman collection', () => {
  type Item = { name: string; request: { url: { path: string[] }; body: { raw: string } } }
  const collection = JSON.parse(
    readFileSync(
      new URL(
        '../../../apps/gateway/postman/eve-pdpa-gateway.postman_collection.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { event: { listen: string; script: { exec: string[] } }[]; item: Item[] }
  const script = (collection.event.find((e) => e.listen === 'prerequest')?.script.exec ?? []).join(
    '\n',
  )
  const pathOf = (item: Item) => `/${item.request.url.path.join('/')}` as Route

  /** What Postman's sandbox gives the script, enough of it to sign. */
  function run(item: Item, vars: Record<string, string>) {
    const headers: Record<string, string> = {}
    const pm = {
      request: {
        url: { getPath: () => pathOf(item) },
        body: item.request.body,
        headers: {
          upsert: ({ key, value }: { key: string; value: string }) => (headers[key] = value),
        },
      },
      variables: { get: (k: string) => vars[k], replaceIn: (s: string) => s },
    }
    const CryptoJS = {
      enc: { Hex: 'hex' },
      HmacSHA256: (message: string, key: string) => ({
        toString: () => createHmac('sha256', key).update(message, 'utf8').digest('hex'),
      }),
    }
    new Function('pm', 'CryptoJS', script)(pm, CryptoJS)
    return headers
  }

  it('has one request per route, its body the spec example', () => {
    expect(collection.item.map(pathOf).sort()).toEqual([...routes].sort())
    for (const item of collection.item) {
      expect(JSON.parse(item.request.body.raw)).toEqual(request(pathOf(item)).example)
    }
  })

  for (const item of collection.item) {
    it(`signs "${item.name}" so the gateway takes it`, async () => {
      const headers = run(item, {
        pdpaSecret: SECRET,
        pdpaResolveSecret: RESOLVE_SECRET,
        vercelBypass: 'bypass-value',
      })
      expect(headers['x-vercel-protection-bypass']).toBe('bypass-value')
      const route = pathOf(item)
      const res = await ROUTES[route].call(setup().gateway)(
        new Request(`https://hook.example${route}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: item.request.body.raw,
        }),
      )
      expect(res.status).toBe(200)
    })
  }

  it('stops with a clear message when the secrets are not set', () => {
    expect(() => run(collection.item[0] as Item, {})).toThrow(/pdpaSecret/)
  })
})

// D27: /apidocs signs "Try it out" requests in the browser with Web Crypto.
// Its signer runs here on Node's Web Crypto, and what it signs must get
// through the gateway — the same check the Postman script gets.
describe('the /apidocs page', () => {
  type Signed = {
    request: { url: string; method: string; headers: Record<string, string>; body: unknown }
    note: string
  }
  const load = async () =>
    (await import(
      new URL('../../../apps/gateway/public/apidocs/sign.js', import.meta.url).href
    )) as {
      sign: (
        request: Signed['request'],
        secrets: { secret?: string; resolveSecret?: string },
      ) => Promise<Signed>
    }

  for (const route of routes) {
    it(`signs ${route} so the gateway takes it`, async () => {
      const { sign } = await load()
      const signed = await sign(
        {
          url: `https://eve-pdpa-gateway.vercel.app${route}`,
          method: 'post',
          headers: { 'content-type': 'application/json' },
          // Swagger UI hands over the body as typed into its editor.
          body: JSON.stringify(request(route).example, null, 2),
        },
        { secret: SECRET, resolveSecret: RESOLVE_SECRET },
      )
      expect(signed.note).toContain(ROUTES[route].scope)
      const res = await ROUTES[route].call(setup().gateway)(
        new Request(`https://hook.example${route}`, {
          method: 'POST',
          headers: signed.request.headers,
          body: signed.request.body as string,
        }),
      )
      expect(res.status).toBe(200)
    })
  }

  it('sends a request unsigned, and says so, when its secret is missing', async () => {
    const { sign } = await load()
    const signed = await sign(
      { url: 'https://x/api/resolve', method: 'POST', headers: {}, body: '{}' },
      { secret: SECRET },
    )
    expect(signed.request.headers).toEqual({})
    expect(signed.note).toContain('PDPA_RESOLVE_SECRET')
  })

  it('leaves alone a request to anything but a route', async () => {
    const { sign } = await load()
    const request = { url: 'https://x/openapi.json', method: 'GET', headers: {}, body: undefined }
    expect((await sign(request, { secret: SECRET })).request).toBe(request)
  })
})
