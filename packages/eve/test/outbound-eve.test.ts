// The outbound side under eve's real runtime (0.80.1, mock model). withPdpaGuard
// masks what a channel posts by wrapping the handlers on its `adapter`, which
// eve does not document: if a release of eve changes that, this test fails.
//
// The fixture channel writes what a built-in channel would post to a file. The
// model repeats the token it read, and asks for a tool call that needs approval.
// The session's own history still holds tokens: eve keeps what the model wrote,
// and only what is posted is masked.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cannotRunEve, type EveDev, history, startEveDev, until } from './eve-dev.js'
import { expectNoLeak, PHONE, SESSION_KEY, TOKEN } from './helpers.js'

const AGENT = fileURLToPath(new URL('./fixtures/outbound-agent/', import.meta.url))
// The fixture imports the package by name, which resolves to its build.
const built = existsSync(fileURLToPath(new URL('../dist/extension/lib/guard.mjs', import.meta.url)))
const skip = cannotRunEve() ?? (built ? null : 'packages/eve is not built (run pnpm build)')
let eve: EveDev | undefined
let dir = ''
let file = ''
// The fixture is its own eve project, so it reaches this package the way an agent
// does: through node_modules. The link is made here and removed after.
const LINK = join(AGENT, 'node_modules/@eve-pdpa-extension/eve')

beforeAll(async () => {
  if (skip !== null) return
  dir = mkdtempSync(join(tmpdir(), 'pdpa-outbound-'))
  rmSync(join(AGENT, 'node_modules'), { recursive: true, force: true })
  mkdirSync(join(AGENT, 'node_modules/@eve-pdpa-extension'), { recursive: true })
  symlinkSync(fileURLToPath(new URL('..', import.meta.url)), LINK)
  file = join(dir, 'posted.jsonl')
  eve = await startEveDev(AGENT, { OUTBOUND_FILE: file, PDPA_SESSION_KEY: SESSION_KEY })
}, 60_000)

afterAll(async () => {
  await eve?.stop()
  if (dir) rmSync(dir, { recursive: true, force: true })
  rmSync(join(AGENT, 'node_modules'), { recursive: true, force: true })
  rmSync(join(AGENT, '.eve'), { recursive: true, force: true })
}, 20_000)

const posted = (type: string): any[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('{'))
        .map((l) => JSON.parse(l))
        .filter((e) => e.type === type)
    : []

async function say(message: string): Promise<string> {
  if (eve === undefined) throw new Error('eve dev did not start')
  const res = await fetch(`${eve.base}/in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, address: `U${Date.now()}${Math.random()}` }),
  })
  return ((await res.json()) as { sessionId: string }).sessionId
}

describe.skipIf(skip !== null)('outbound under the real runtime', () => {
  it('posts the masked display of a token the model repeats', async () => {
    const sessionId = await say(`โทรหา ${PHONE} ค่ะ`)
    const [reply] = await until('the posted reply', () => {
      const all = posted('message.completed')
      return all.length > 0 && all
    })
    expect(reply.data.message).toBe('ส่ง OTP ไปที่ xxx-xxx-7777 แล้วค่ะ')
    expect(JSON.stringify(reply)).not.toMatch(TOKEN)
    expectNoLeak(reply, [PHONE])
    // What eve kept is what the model wrote: the token. Only the post is masked.
    const kept = JSON.stringify(await history(eve?.base ?? '', sessionId))
    expect(kept).toMatch(TOKEN)
    expectNoLeak(kept, [PHONE])
  }, 60_000)

  it('posts an approval request with its tool input masked', async () => {
    await say(`ขอ OTP ที่เบอร์ ${PHONE}`)
    const [asked] = await until('the posted approval request', () => {
      const all = posted('input.requested')
      return all.length > 0 && all
    })
    const [request] = asked.data.requests
    expect(request.kind).toBe('tool-approval')
    expect(request.action.input).toEqual({ phone: 'xxx-xxx-7777' })
    expect(JSON.stringify(asked)).not.toMatch(TOKEN)
    expectNoLeak(asked, [PHONE])
  }, 60_000)
})
