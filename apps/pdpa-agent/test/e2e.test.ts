// The template under eve's real runtime (`eve dev`, mock model): every layer
// of @eve-pdpa-extension/eve at once. A customer asks for an OTP; the model
// must read a token, otp_send must resolve it, and nothing eve keeps — the
// prompt, the session history, audit, the server log — may hold the number.
//
// The Slack reply path is covered in packages/eve (slack.test.ts): it needs a
// signed Slack event and Slack's API, which this test does not fake.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cannotRunEve,
  type EveDev,
  history,
  settled,
  startEveDev,
  until,
} from '../../../packages/eve/test/eve-dev.js'
import { thaiDigits } from '../../../packages/eve/test/helpers.js'

const AGENT = fileURLToPath(new URL('..', import.meta.url))
const DIST = fileURLToPath(
  new URL('../../../packages/eve/dist/extension/lib/guard.mjs', import.meta.url),
)

// Synthetic values and test-only secrets.
const PHONE = '091-888-7777'
const CARD = '4111 1111 1111 1111'
const SESSION_KEY = 'e2e-session-key-0123456789abcdef0123'
const HMAC_KEY = 'e2e-hmac-key-0123456789abcdef0123456789'
const SECRETS = [PHONE, '0918887777', thaiDigits(PHONE), CARD, SESSION_KEY, HMAC_KEY]
const TOKEN = /\[tok:[a-z]{16}\]/

const skip =
  cannotRunEve() ?? (existsSync(DIST) ? null : 'packages/eve is not built (run pnpm build)')
let eve: EveDev | undefined
let dir = ''

const leaks = (text: string) => SECRETS.filter((s) => text.includes(s))
const lines = (file: string) =>
  existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []
const prompts = () => lines(join(dir, 'prompts.jsonl'))
const audit = () => lines(join(dir, 'audit.jsonl')).map((l) => JSON.parse(l))

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${eve?.base}${path}`, {
    method: 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  })
}

beforeAll(async () => {
  if (skip !== null) return
  dir = mkdtempSync(join(tmpdir(), 'pdpa-template-'))
  eve = await startEveDev(AGENT, {
    PDPA_TEMPLATE_MOCK_MODEL: '1',
    PDPA_TEMPLATE_RECORD_FILE: join(dir, 'prompts.jsonl'),
    PDPA_TEMPLATE_AUDIT_FILE: join(dir, 'audit.jsonl'),
    PDPA_SESSION_KEY: SESSION_KEY,
    PDPA_HMAC_KEY: HMAC_KEY,
  })
}, 60_000)

afterAll(async () => {
  await eve?.stop()
  if (dir) rmSync(dir, { recursive: true, force: true })
}, 20_000)

describe.skipIf(skip !== null)('pdpa-agent template, end to end', () => {
  it('an OTP request: token to the model, number to otp_send, nothing real kept', async () => {
    const res = await post('/eve/v1/session', { message: `ขอ OTP ที่เบอร์ ${PHONE} ค่ะ` })
    expect(res.status).toBe(202)
    const { sessionId } = (await res.json()) as { sessionId: string }
    const events = await settled(eve?.base ?? '', sessionId)

    // What eve recorded and what the model read: a token, never the number.
    const received = events.find((e) => e.type === 'message.received')
    expect(received?.data?.message).toMatch(TOKEN)
    const token = (received?.data?.message as string).match(TOKEN)?.[0]
    expect(prompts().join('\n')).toContain(token)

    // The model called otp_send with the token; the tool's recorded result is masked.
    const call = events.find((e) => e.type === 'actions.requested')
    expect(call?.data?.actions?.[0]).toMatchObject({
      toolName: 'otp_send',
      input: { phone: token },
    })
    const result = events.find((e) => e.type === 'action.result')
    expect(result?.data?.result?.output).toMatchObject({ sent: true })

    // Every layer used the same pdpa session id, and the resolve was allowed.
    const records = audit()
    const resolves = records.filter((e) => e.type === 'token.resolve')
    expect(resolves).toMatchObject([{ outcome: 'allowed', purpose: 'otp_send' }])
    const ids = new Set(records.filter((e) => e.type !== 'policy.loaded').map((e) => e.sessionId))
    expect(ids.size).toBe(1)
    const boundaries = new Set(records.filter((e) => e.type === 'scan').map((e) => e.boundary))
    expect([...boundaries].sort()).toEqual(['inbound', 'prompt', 'tool_output'])

    expect(leaks(JSON.stringify(events))).toEqual([])
  }, 60_000)

  it('a follow-up in Thai digits is masked in the same session', async () => {
    const created = await post('/eve/v1/session', { message: 'สวัสดีค่ะ' })
    const { sessionId } = (await created.json()) as { sessionId: string }
    await settled(eve?.base ?? '', sessionId)
    const res = await post(`/eve/v1/session/${sessionId}`, {
      message: `เบอร์ใหม่ ${thaiDigits(PHONE)} ค่ะ`,
    })
    expect(res.status).toBe(202)
    const events = await settled(eve?.base ?? '', sessionId, 2)
    const received = events.filter((e) => e.type === 'message.received').at(-1)
    expect(received?.data?.message).toMatch(/^เบอร์ใหม่ \[tok:[a-z]{16}\] ค่ะ$/)
    expect(leaks(JSON.stringify(events))).toEqual([])
  }, 60_000)

  it('a card number is refused with 422 and never reaches the model', async () => {
    const before = prompts().length
    const res = await post('/eve/v1/session', { message: `บัตร ${CARD} ค่ะ` })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, code: 'pdpa_blocked' })
    expect(leaks(JSON.stringify(body))).toEqual([])
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    expect(prompts().length).toBe(before)
  }, 60_000)

  it('keeps every original and every secret out of prompts, audit and the server log', async () => {
    await until('audit to be written', () => audit().length > 0)
    expect(leaks(prompts().join('\n'))).toEqual([])
    expect(leaks(JSON.stringify(audit()))).toEqual([])
    expect(leaks(eve?.log() ?? '')).toEqual([])
  }, 60_000)
})
