// I-CP-1..3: an agent set up the new way, under eve's real runtime (0.80.1,
// mock model). The fixture holds only what a person writes — agent.ts, one tool,
// one channel; the registry item's files are written in from r/pdpa.json, the
// way `eve add` writes them. No key and no store are set: createPdpa falls back
// to its development keys and one memory store, as on a developer's machine.
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cannotRunEve, type EveDev, history, startEveDev, until } from './eve-dev.js'
import { dashed, expectNoLeak, PHONE, syntheticId, TOKEN } from './helpers.js'

const PKG = fileURLToPath(new URL('..', import.meta.url))
const FIXTURE = join(PKG, 'test', 'fixtures', 'easy-agent')
const ITEM = join(PKG, 'r', 'pdpa.json')
const built = existsSync(join(PKG, 'dist', 'extension', 'lib', 'guard.mjs')) && existsSync(ITEM)
const skip = cannotRunEve() ?? (built ? null : 'packages/eve is not built (run pnpm build)')
const CARD = '4111 1111 1111 1111'
const ID = syntheticId(9)

let eve: EveDev | undefined
let agent = ''
const files = { outbound: '', tool: '', prompt: '' }

beforeAll(async () => {
  if (skip !== null) return
  // Inside packages/eve, so eve and ai resolve from its node_modules as for any fixture.
  agent = mkdtempSync(join(PKG, 'test', 'fixtures', '.tmp-easy-'))
  cpSync(FIXTURE, agent, { recursive: true })
  const item = JSON.parse(readFileSync(ITEM, 'utf8')) as {
    files: { target: string; content: string }[]
  }
  for (const file of item.files) {
    mkdirSync(dirname(join(agent, file.target)), { recursive: true })
    writeFileSync(join(agent, file.target), file.content)
  }
  mkdirSync(join(agent, 'node_modules', '@eve-pdpa-extension'), { recursive: true })
  symlinkSync(PKG, join(agent, 'node_modules', '@eve-pdpa-extension', 'eve'))
  for (const name of Object.keys(files) as (keyof typeof files)[]) {
    files[name] = join(agent, `${name}.jsonl`)
  }
  eve = await startEveDev(agent, {
    OUTBOUND_FILE: files.outbound,
    TOOL_FILE: files.tool,
    PROMPT_FILE: files.prompt,
  })
}, 60_000)

afterAll(async () => {
  await eve?.stop()
  if (agent !== '') rmSync(agent, { recursive: true, force: true })
}, 20_000)

const lines = (file: string): any[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('{') || l.startsWith('['))
        .map((l) => JSON.parse(l))
    : []

/** The NDJSON audit lines createPdpa wrote to stdout, as eve dev printed them. */
const audit = (): any[] =>
  (eve?.log() ?? '')
    .split('\n')
    .map((l) => l.slice(l.indexOf('{')))
    .filter((l) => l.startsWith('{"'))
    .flatMap((l) => {
      try {
        const e = JSON.parse(l)
        return typeof e.type === 'string' && e.schemaVersion === '1.0' ? [e] : []
      } catch {
        return []
      }
    })

/** Every file eve dev keeps for its sessions, as text. */
function kept(): string {
  const root = join(agent, '.eve', '.workflow-data')
  if (!existsSync(root)) return ''
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else out.push(readFileSync(p, 'utf8'))
    }
  }
  walk(root)
  return out.join('\n')
}

async function say(message: string): Promise<{ status: number; body: any }> {
  if (eve === undefined) throw new Error('eve dev did not start')
  const res = await fetch(`${eve.base}/in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, address: `U${Date.now()}${Math.random()}` }),
  })
  return { status: res.status, body: await res.json() }
}

describe.skipIf(skip !== null)('an agent set up with createPdpa only', () => {
  it('OTP: the reply posts xxx-xxx-7777, the tool gets the number (I-CP-1)', async () => {
    const { body } = await say(`ขอ OTP ที่เบอร์ ${PHONE} ค่ะ`)
    const [reply] = await until('the posted reply', () => {
      const all = lines(files.outbound).filter((e) => e.type === 'message.completed')
      return all.length > 0 && all
    })
    expect(reply.data.message).toBe('ส่ง OTP ไปที่ xxx-xxx-7777 แล้วค่ะ')
    expect(JSON.stringify(reply)).not.toMatch(TOKEN)
    expect(lines(files.tool)).toEqual([{ phone: '0918887777' }])
    await until('the resolve audit line', () =>
      audit().some((e) => e.type === 'token.resolve' && e.outcome === 'allowed'),
    )
    expect(audit()).toContainEqual(
      expect.objectContaining({ type: 'token.resolve', outcome: 'allowed', purpose: 'otp_send' }),
    )
    // The model saw the token, never the number; eve kept the same.
    expect(JSON.stringify(lines(files.prompt))).toMatch(TOKEN)
    expectNoLeak([lines(files.prompt), audit(), lines(files.outbound)], [PHONE])
    expectNoLeak(await history(eve?.base ?? '', body.sessionId), [PHONE])
  }, 60_000)

  it('a card: the turn never starts, nothing is posted (I-CP-2)', async () => {
    const before = lines(files.outbound).length
    const prompts = lines(files.prompt).length
    const { status, body } = await say(`ตัดบัตร ${CARD} ได้เลยค่ะ`)
    expect(status).toBe(422)
    expect(body.blocked).toBeTruthy()
    expect(audit()).toContainEqual(
      expect.objectContaining({ type: 'scan', boundary: 'inbound', outcome: 'blocked' }),
    )
    // Give a turn the time it would take, then check nothing ran.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(lines(files.outbound)).toHaveLength(before)
    expect(lines(files.prompt)).toHaveLength(prompts)
    expectNoLeak([audit(), kept(), eve?.log()], [CARD])
  }, 60_000)

  it('a national id: the model gets [เลขบัตรประชาชน], no digits anywhere (I-CP-3)', async () => {
    const prompts = lines(files.prompt).length
    await say(`เลขบัตรประชาชน ${dashed(ID)} ค่ะ`)
    const seen = await until('the prompt', () => {
      const all = lines(files.prompt)
      return all.length > prompts && all.slice(prompts)
    })
    expect(JSON.stringify(seen)).toContain('[เลขบัตรประชาชน]')
    await until('the posted reply', () =>
      lines(files.outbound).some((e) => e.data?.message === 'รับทราบค่ะ'),
    )
    expectNoLeak(
      [lines(files.prompt), lines(files.outbound), audit(), kept(), eve?.log()],
      [ID, dashed(ID), PHONE],
    )
  }, 60_000)
})
