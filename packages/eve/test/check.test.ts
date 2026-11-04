// eve-pdpa-check against agent projects built in a temporary directory: one
// set up right, and one for each way of getting it wrong.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const BIN = new URL('../bin/eve-pdpa-check.mjs', import.meta.url).pathname
const HMAC = `e2e-hmac-${'b2'.repeat(16)}`
const SESSION = `e2e-session-${'a1'.repeat(16)}`
const UPSTASH_TOKEN = 'e2e-upstash-rest-token'

const GOOD: Record<string, string> = {
  'agent/agent.ts': `import { defineAgent } from "eve";
import { pdpa } from "./lib/pdpa.js";

export default defineAgent({
  model: pdpa.model("openai/gpt-6-luna-fast"),
  modelContextWindowTokens: 400_000,
  reasoning: "high",
  defaultTools: false,
});
`,
  'agent/lib/pdpa.ts': `import { createPdpa } from '@eve-pdpa-extension/eve/guard'
import policy from '../../policies/pdpa-policy.json' with { type: 'json' }

export const pdpa = createPdpa({ policy })
`,
  'agent/hooks/pdpa.ts': `import { pdpa } from '../lib/pdpa.js'

export default pdpa.hook
`,
  'agent/channels/eve.ts': `import { eveChannel } from 'eve/channels/eve'
import { pdpa } from '../lib/pdpa.js'

export default pdpa.channel(eveChannel({ auth: [] }), { allowRawTokensInOutput: true })
`,
  'agent/channels/telegram.ts': `import { telegramChannel } from 'eve/channels/telegram'
import { withPdpaGuard } from '@eve-pdpa-extension/eve/guard'
import { pdpa } from '../lib/pdpa.js'

export default withPdpaGuard(telegramChannel({}), { ...pdpa, channelName: 'telegram' })
`,
  'node_modules/eve/package.json': '{ "name": "eve", "version": "0.80.1" }',
}

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A project from GOOD with some files replaced (a string) or removed (null). */
function project(changes: Record<string, string | null> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'pdpa-check-'))
  dirs.push(dir)
  for (const [path, content] of Object.entries({ ...GOOD, ...changes })) {
    if (content === null) continue
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

function check(dir: string, args: string[] = [], env: Record<string, string> = {}) {
  // Only what the test gives: none of the machine's own variables.
  const r = spawnSync(process.execPath, [BIN, '--cwd', dir, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...env },
  })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}

const PROD_ENV = {
  PDPA_HMAC_KEY: HMAC,
  PDPA_SESSION_KEY: SESSION,
  UPSTASH_REDIS_REST_URL: 'https://e2e-example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: UPSTASH_TOKEN,
}

describe('eve-pdpa-check', () => {
  it('passes a project set up right, and prints no value (U-CHK-1)', () => {
    const r = check(project(), ['--production'], PROD_ENV)
    expect(r.out).toContain('eve-pdpa-check: ok')
    expect(r.code).toBe(0)
    for (const value of Object.values(PROD_ENV)) expect(r.out).not.toContain(value)
    expect(check(project()).code).toBe(0)
  })

  it('names a channel that is not wrapped (U-CHK-2)', () => {
    const r = check(
      project({
        'agent/channels/eve.ts': `import { eveChannel } from 'eve/channels/eve'
// pdpa.channel( is only mentioned here
export default eveChannel({ auth: [] })
`,
      }),
    )
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/✗ channels\s+agent\/channels\/eve\.ts is not wrapped/)
  })

  it('fails a model that is not wrapped (U-CHK-3)', () => {
    const r = check(
      project({
        'agent/agent.ts': `import { defineAgent } from "eve";

export default defineAgent({
  model: "openai/gpt-6-luna-fast",
  reasoning: "high",
  defaultTools: false,
});
`,
      }),
    )
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/✗ model/)
  })

  it('fails without the hook (U-CHK-4)', () => {
    expect(check(project({ 'agent/hooks/pdpa.ts': null })).code).toBe(1)
    const other = check(project({ 'agent/hooks/pdpa.ts': 'export default {}\n' }))
    expect(other.code).toBe(1)
    expect(other.out).toMatch(/✗ hook/)
  })

  it('with --production, names a missing key and prints no value (U-CHK-5)', () => {
    const { PDPA_SESSION_KEY: _, ...env } = PROD_ENV
    const r = check(project(), ['--production'], env)
    expect(r.code).toBe(1)
    expect(r.out).toContain('PDPA_SESSION_KEY is not set')
    expect(r.out).toContain('PDPA_HMAC_KEY is set')
    for (const value of Object.values(env)) expect(r.out).not.toContain(value)
  })

  it('reads keys from .env.local too, and counts KEY= as not set', () => {
    const dir = project({
      '.env.local': `PDPA_HMAC_KEY=${HMAC}\nPDPA_SESSION_KEY=\nKV_REST_API_URL=https://e2e-kv.upstash.io\nKV_REST_API_TOKEN=${UPSTASH_TOKEN}\n`,
    })
    const r = check(dir, ['--production'])
    expect(r.code).toBe(1)
    expect(r.out).toContain('PDPA_SESSION_KEY is not set')
    expect(r.out).toContain('KV_REST_API_URL and KV_REST_API_TOKEN are set')
    expect(r.out).not.toContain(HMAC)
    expect(r.out).not.toContain(UPSTASH_TOKEN)
  })

  it('with --production, fails without a store (U-CHK-6)', () => {
    const r = check(project(), ['--production'], {
      PDPA_HMAC_KEY: HMAC,
      PDPA_SESSION_KEY: SESSION,
      UPSTASH_REDIS_REST_URL: 'https://e2e-example.upstash.io',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/✗ store/)
    expect(r.out).toContain('UPSTASH_REDIS_REST_TOKEN')
  })

  it('fails eve 1.0.0-rc.1, and eve not installed (U-CHK-7)', () => {
    const rc = check(
      project({ 'node_modules/eve/package.json': '{ "name": "eve", "version": "1.0.0-rc.1" }' }),
    )
    expect(rc.code).toBe(1)
    expect(rc.out).toContain('eve 1.0.0-rc.1 is installed')
    expect(check(project({ 'node_modules/eve/package.json': null })).code).toBe(1)
  })

  it('only warns when defaultTools is not false (U-CHK-8)', () => {
    const r = check(
      project({
        'agent/agent.ts': `import { defineAgent } from "eve";
import { pdpa } from "./lib/pdpa.js";

export default defineAgent({
  model: pdpa.model("openai/gpt-6-luna-fast"),
});
`,
      }),
    )
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/! defaultTools/)
    expect(r.out).toContain('(1 warning)')
  })

  it('exits 2 when used wrong', () => {
    expect(check(project(), ['--prod']).code).toBe(2)
    expect(spawnSync(process.execPath, [BIN, '--cwd'], { encoding: 'utf8' }).status).toBe(2)
    expect(spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' }).status).toBe(0)
  })
})
