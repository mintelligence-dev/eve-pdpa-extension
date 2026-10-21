// If this test starts failing, eve now lets hooks modify input — revisit
// moving masking into the extension.
//
// A fixture agent registers a hook that tries to rewrite the user's message on
// message.received. The model must still receive the original. That is why
// this package masks in the channel and only blocks and audits in hooks.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cannotRunEve, type EveDev, settled, startEveDev } from './eve-dev.js'
import { PHONE } from './helpers.js'

const AGENT = fileURLToPath(new URL('./fixtures/canary-agent/', import.meta.url))
const skip = cannotRunEve()
let eve: EveDev | undefined
let dir = ''

beforeAll(async () => {
  if (skip !== null) return
  dir = mkdtempSync(join(tmpdir(), 'pdpa-canary-'))
  eve = await startEveDev(AGENT, { CANARY_RECORD_FILE: join(dir, 'prompts.jsonl') })
}, 60_000)

afterAll(async () => {
  await eve?.stop()
  if (dir) rmSync(dir, { recursive: true, force: true })
}, 20_000)

describe.skipIf(skip !== null)('hook canary', () => {
  it('a hook cannot change what the model receives', async () => {
    if (eve === undefined) throw new Error('eve dev did not start')
    // A synthetic value, unmasked on purpose: nothing here wraps the channel.
    const res = await fetch(`${eve.base}/eve/v1/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: `โทร ${PHONE} ค่ะ` }),
    })
    const { sessionId } = (await res.json()) as { sessionId: string }
    await settled(eve.base, sessionId)
    const file = join(dir, 'prompts.jsonl')
    expect(existsSync(file)).toBe(true)
    const prompt = readFileSync(file, 'utf8')
    expect(prompt).toContain(`โทร ${PHONE} ค่ะ`)
    expect(prompt).not.toContain('REWRITTEN BY HOOK')
  }, 60_000)
})
