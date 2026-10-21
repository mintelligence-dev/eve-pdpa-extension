// The real eve runtime, end to end: examples/line-agent under `eve dev`, with
// eve's own mockModel recording every prompt it is sent. The question this
// file answers is whether the text the model actually receives — and what eve
// keeps in the session — is masked.
//
// Needs Node 24 (eve's floor) and the example installed. Without either, or
// when eve cannot start here, every test skips and says why. The server is
// always stopped in afterAll.
import { type ChildProcess, spawn } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer as createHttpServer, type Server } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dashed, EMAIL, PHONE, syntheticId, thaiDigits } from './helpers.js'

const EXAMPLE = fileURLToPath(new URL('../../../examples/line-agent/', import.meta.url))
const EVE_CLI = join(EXAMPLE, 'node_modules/eve/bin/eve.js')
const STARTUP_MS = 45_000
const TURN_MS = 20_000

const ID = syntheticId(8)
const CARD = '4111 1111 1111 1111'
const ORIGINALS = [ID, PHONE, EMAIL, CARD]

function prerequisite(): string | null {
  if (Number(process.versions.node.split('.')[0]) < 24) {
    return `eve needs Node 24; this is ${process.version}`
  }
  if (!existsSync(EVE_CLI)) return 'examples/line-agent is not installed (run pnpm install)'
  return null
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
    })
  })
}

/**
 * Vitest sets NODE_ENV=test. Under it, eve dev (0.80.1) no longer calls the
 * agent's authored model the way it does in development — the recording model
 * writes nothing — so the server gets the environment a developer's shell has.
 */
function withoutTestEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { NODE_ENV: _drop, ...rest } = env
  return rest
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Each original as typed, digits only, and in the other digit script. */
function leaks(text: string): string[] {
  const found: string[] = []
  for (const original of ORIGINALS) {
    const forms = new Set([original, thaiDigits(original)])
    const digits = original.replace(/\D/g, '')
    if (digits.length >= 9) forms.add(digits).add(thaiDigits(digits))
    for (const form of forms) if (text.includes(form)) found.push(form)
  }
  return found
}

let skip: string | null = prerequisite()
let server: ChildProcess | undefined
let base = ''
let log = ''
let dir = ''

// ---- LINE, offline -----------------------------------------------------------
// The example's LINE channel runs with made-up credentials, and its calls to
// api.line.me are sent to this stub instead (PDPA_EXAMPLE_LINE_API_BASE), so
// nothing leaves the machine and the test can read what the bot would post.

const LINE_SECRET = 'synthetic-line-channel-secret-0123'
const LINE_BOT = `U${'b'.repeat(32)}`
// A new synthetic user each run: eve dev keeps sessions in .eve/ between runs
// and leaves an earlier server's conversations dormant, so a fixed user would
// address a conversation the new server refuses to resume.
const LINE_USER = `U${randomBytes(16).toString('hex')}`
let lineApi: Server | undefined
const lineCalls: { method: string; path: string; body: string }[] = []

async function startLineApi(): Promise<string> {
  lineApi = createHttpServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      lineCalls.push({ method: req.method ?? '', path: req.url ?? '', body })
      res.setHeader('content-type', 'application/json')
      if (req.url === '/v2/bot/info') {
        res.end(JSON.stringify({ userId: LINE_BOT, basicId: '@synthetic', displayName: 'bot' }))
      } else if (req.url?.startsWith('/v2/bot/message/')) {
        res.end(JSON.stringify({ sentMessages: [{ id: '1', quoteToken: 'q1' }] }))
      } else {
        res.end('{}')
      }
    })
  })
  const api = lineApi
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve))
  const address = api.address()
  return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
}

let lineEvent = 0
/** A LINE webhook for one 1:1 text message, signed as LINE signs it. */
async function lineMessage(text: string): Promise<Response> {
  lineEvent++
  const body = JSON.stringify({
    destination: LINE_BOT,
    events: [
      {
        type: 'message',
        mode: 'active',
        timestamp: Date.now(),
        source: { type: 'user', userId: LINE_USER },
        webhookEventId: `01SYNTHETIC${String(lineEvent).padStart(15, '0')}`,
        deliveryContext: { isRedelivery: false },
        replyToken: `synthetic-reply-token-${lineEvent}`,
        message: { id: String(1000 + lineEvent), type: 'text', quoteToken: `q${lineEvent}`, text },
      },
    ],
  })
  const signature = createHmac('sha256', LINE_SECRET).update(body).digest('base64')
  return fetch(`${base}/eve/v1/line`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-line-signature': signature },
    body,
  })
}

/** Text the bot sent to LINE (reply or push) after the `since`-th recorded call. */
function linePosts(since: number): string[] {
  return lineCalls
    .slice(since)
    .filter((c) => c.path === '/v2/bot/message/reply' || c.path === '/v2/bot/message/push')
    .flatMap((c) => (JSON.parse(c.body).messages ?? []).map((m: { text?: string }) => m.text ?? ''))
}

async function until<T>(what: string, check: () => T | undefined | false): Promise<T> {
  const deadline = Date.now() + TURN_MS
  for (;;) {
    const value = check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(200)
  }
}

/** Lines the recording model wrote: one JSON array of prompt messages per model call. */
function prompts(): { role: string; text: string }[][] {
  const file = join(dir, 'prompts.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

/** The session's recorded history, up to the durable tail. */
async function history(sessionId: string): Promise<{ type: string; data?: any }[]> {
  const res = await fetch(`${base}/eve/v1/session/${sessionId}/stream?follow=false`)
  const text = await res.text()
  return text
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line))
}

/** Waits until the session has parked after `turns` completed turns. */
async function settled(sessionId: string, turns: number): Promise<{ type: string; data?: any }[]> {
  const deadline = Date.now() + TURN_MS
  for (;;) {
    const events = await history(sessionId)
    const done = events.filter((e) => e.type === 'session.waiting').length
    if (done >= turns) return events
    if (events.some((e) => e.type === 'session.failed')) {
      throw new Error(`session failed: ${JSON.stringify(events.at(-1))}`)
    }
    if (Date.now() > deadline) throw new Error(`turn did not settle in ${TURN_MS} ms`)
    await sleep(200)
  }
}

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  })
}

beforeAll(async () => {
  if (skip !== null) return
  dir = mkdtempSync(join(tmpdir(), 'pdpa-eve-'))
  const lineBase = await startLineApi()
  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  server = spawn(
    process.execPath,
    [
      EVE_CLI,
      'dev',
      '--no-ui',
      '--no-default-extensions',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      cwd: EXAMPLE,
      env: {
        ...withoutTestEnv(process.env),
        EVE_TELEMETRY_DISABLED: '1',
        PDPA_EXAMPLE_MOCK_MODEL: '1',
        PDPA_EXAMPLE_RECORD_FILE: join(dir, 'prompts.jsonl'),
        PDPA_EXAMPLE_AUDIT_FILE: join(dir, 'audit.jsonl'),
        LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-line-access-token',
        LINE_CHANNEL_SECRET: LINE_SECRET,
        PDPA_EXAMPLE_LINE_API_BASE: lineBase,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  server.stdout?.on('data', (chunk) => {
    log += chunk
  })
  server.stderr?.on('data', (chunk) => {
    log += chunk
  })
  const deadline = Date.now() + STARTUP_MS
  while (Date.now() < deadline) {
    if (server.exitCode !== null) break
    try {
      const res = await fetch(`${base}/eve/v1/health`)
      if (res.ok) return
    } catch {}
    await sleep(250)
  }
  skip = `eve dev did not start here (exit ${server.exitCode ?? 'none'}): ${log.slice(-800)}`
  console.warn(`[eve integration] skipped: ${skip}`)
}, STARTUP_MS + 10_000)

afterAll(async () => {
  if (server !== undefined && server.exitCode === null) {
    // eve dev stops its runtime child on SIGTERM. SIGKILL if it hangs.
    const exited = new Promise((resolve) => server?.once('exit', resolve))
    server.kill('SIGTERM')
    await Promise.race([exited, sleep(10_000)])
    if (server.exitCode === null) server.kill('SIGKILL')
  }
  await new Promise((resolve) => (lineApi ? lineApi.close(resolve) : resolve(undefined)))
  if (dir) rmSync(dir, { recursive: true, force: true })
}, 20_000)

if (skip !== null) console.warn(`[eve integration] skipped: ${skip}`)

describe('eve runtime — the model reads masked text only', () => {
  it('masks the first message of a session and its clientContext', async (ctx) => {
    if (skip !== null) ctx.skip()
    const res = await post('/eve/v1/session', {
      message: `เลขบัตร ${dashed(ID)} โทร ${PHONE} เมล ${EMAIL}`,
      clientContext: { customer: `ติดต่อ ${PHONE}` },
    })
    expect(res.status).toBe(202)
    const { sessionId } = (await res.json()) as { sessionId: string }
    const events = await settled(sessionId, 1)

    const prompt = prompts().at(-1) ?? []
    const user = prompt.filter((m) => m.role === 'user').map((m) => m.text)
    expect(user.join('\n')).toContain('เลขบัตร [เลขบัตรประชาชน] โทร xxx-xxx-7777 เมล [อีเมล]')
    expect(user.join('\n')).toContain('ติดต่อ xxx-xxx-7777')
    expect(leaks(JSON.stringify(prompt))).toEqual([])

    const received = events.find((e) => e.type === 'message.received')
    expect(received?.data?.message).toBe('เลขบัตร [เลขบัตรประชาชน] โทร xxx-xxx-7777 เมล [อีเมล]')
    expect(leaks(JSON.stringify(events))).toEqual([])
  }, 60_000)

  it('masks a follow-up sent to an existing session', async (ctx) => {
    if (skip !== null) ctx.skip()
    const created = await post('/eve/v1/session')
    const { sessionId } = (await created.json()) as { sessionId: string }
    let res: Response
    // eve answers 409 session_not_ready until the new session's inbox is up.
    for (let i = 0; ; i++) {
      res = await post(`/eve/v1/session/${sessionId}`, {
        message: [{ type: 'text', text: `เบอร์ใหม่ ${thaiDigits(PHONE)} ค่ะ` }],
      })
      if (res.status !== 409 || i > 40) break
      await sleep(250)
    }
    expect(res.status).toBe(202)
    const events = await settled(sessionId, 1)
    const prompt = prompts().at(-1) ?? []
    expect(JSON.stringify(prompt)).toContain('เบอร์ใหม่ xxx-xxx-๗๗๗๗ ค่ะ')
    expect(leaks(JSON.stringify([prompt, events]))).toEqual([])
  }, 60_000)

  it('answers 422 to a blocked message, and the model is never called', async (ctx) => {
    if (skip !== null) ctx.skip()
    const before = prompts().length
    const res = await post('/eve/v1/session', { message: `บัตร ${CARD} ค่ะ` })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, code: 'pdpa_blocked' })
    expect(leaks(JSON.stringify(body))).toEqual([])
    await sleep(1_000)
    expect(prompts().length).toBe(before)
  }, 60_000)
})

describe('eve runtime — LINE through the Chat SDK bridge', () => {
  it('masks a 1:1 LINE message before the model, and the reply carries no original', async (ctx) => {
    if (skip !== null) ctx.skip()
    const before = prompts().length
    const calls = lineCalls.length
    const res = await lineMessage(`สวัสดีค่ะ เลขบัตร ${dashed(ID)} เบอร์ ${PHONE}`)
    expect(res.status).toBe(200)

    const prompt = await until('the model call', () => prompts()[before])
    expect(JSON.stringify(prompt)).toContain('เลขบัตร [เลขบัตรประชาชน] เบอร์ xxx-xxx-7777')
    expect(leaks(JSON.stringify(prompt))).toEqual([])

    const posted = await until(
      'the reply to LINE',
      () => linePosts(calls).length > 0 && linePosts(calls),
    )
    expect(posted.join('\n')).toContain('[เลขบัตรประชาชน]')
    expect(leaks(JSON.stringify(lineCalls))).toEqual([])
  }, 60_000)

  it('answers a blocked LINE message with the reason, and the model is never called', async (ctx) => {
    if (skip !== null) ctx.skip()
    const before = prompts().length
    const calls = lineCalls.length
    expect((await lineMessage(`บัตร ${CARD} ค่ะ`)).status).toBe(200)

    const posted = await until(
      'the notice to LINE',
      () => linePosts(calls).length > 0 && linePosts(calls),
    )
    expect(posted).toEqual([expect.stringContaining('เลขบัตรเครดิต')])
    await sleep(1_000)
    expect(prompts().length).toBe(before)
    expect(leaks(JSON.stringify(lineCalls))).toEqual([])
  }, 60_000)

  it('refuses a webhook with a wrong signature', async (ctx) => {
    if (skip !== null) ctx.skip()
    const res = await fetch(`${base}/eve/v1/line`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-line-signature': 'bm9wZQ==' },
      body: JSON.stringify({ destination: LINE_BOT, events: [] }),
    })
    expect(res.status).toBe(401)
  }, 60_000)
})

// Last, so it reads the audit of every test above.
describe('eve runtime — audit and logs', () => {
  it('keeps every original out of audit and the server log', async (ctx) => {
    if (skip !== null) ctx.skip()
    const audit = readFileSync(join(dir, 'audit.jsonl'), 'utf8')
    const sources = new Set(
      audit
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line).source),
    )
    // The HTTP channel wrapper, the LINE send wrapper and the extension's hook all scanned.
    expect([...sources].sort()).toEqual(['channel', 'chat-sdk', 'hook'])
    expect(leaks(audit)).toEqual([])
    expect(leaks(log)).toEqual([])
  }, 60_000)
})
