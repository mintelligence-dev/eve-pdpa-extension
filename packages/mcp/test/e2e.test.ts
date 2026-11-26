// The built program, started the way an MCP client starts it: over stdio,
// with every byte it writes kept. Needs `pnpm build` first, as CI and
// `pnpm verify` do.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { beforeAll, describe, expect, it } from 'vitest'
import { MAX_TEXT } from '../src/tools.js'
import { EMAIL, PHONE, textOf } from './helpers.js'

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url))

beforeAll(() => {
  if (!existsSync(BIN)) throw new Error(`${BIN} not found — run pnpm build first`)
})

/**
 * Starts the program, sends these messages (an object as JSON, a string as the
 * raw line), closes stdin once every request has an answer, keeps all output.
 */
function exchange(
  messages: readonly (object | string)[],
  args: readonly string[] = [],
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const expected = messages.filter((m) => typeof m === 'object' && 'id' in m).length
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
      // Close stdin once every request has its answer: the server then exits.
      // Count finished lines only: a chunk can end halfway through one.
      if (stdout.split('\n').length - 1 >= expected) child.stdin.end()
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ stdout, stderr, code }))
    for (const m of messages)
      child.stdin.write(`${typeof m === 'string' ? m : JSON.stringify(m)}\n`)
  })
}

const text = `โทร ${PHONE} หรือ ${EMAIL}`
const session = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'e2e', version: '0' },
    },
  },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'pdpa_redact', arguments: { text } },
  },
  {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'pdpa_scan', arguments: { text } },
  },
]

describe('the built program over stdio', () => {
  it('stdout is JSON-RPC only, and no value is in it or in stderr', async () => {
    const { stdout, stderr } = await exchange(session)
    const lines = stdout.trim().split('\n')
    const replies = lines.map((l) => JSON.parse(l) as { id: number; result?: unknown })
    expect(replies.map((r) => r.id)).toEqual([1, 2, 3, 4])
    expect(JSON.stringify(replies[2]?.result)).toContain('โทร [เบอร์โทร] หรือ [อีเมล]')
    for (const out of [stdout, stderr]) {
      expect(out).not.toContain(PHONE)
      expect(out).not.toContain(EMAIL)
    }
    // stderr holds the audit, one JSON line per event.
    const audit = stderr.trim().split('\n')
    expect(audit.length).toBeGreaterThan(0)
    for (const line of audit) expect(() => JSON.parse(line)).not.toThrow()
  })

  it('no value comes back on any error path, and stdout stays JSON-RPC only', async () => {
    const call = (id: number, name: string, args: unknown) => ({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    })
    const { stdout, stderr } = await exchange([
      session[0] as object,
      session[1] as object,
      // A line that is not JSON: dropped, no answer.
      `{"jsonrpc":"2.0","id":99,"method":"tools/call","params":{"text":"${PHONE}"`,
      call(10, 'pdpa_scan', { text: { nested: PHONE } }),
      call(11, 'pdpa_redact', { text: [PHONE, EMAIL] }),
      call(12, 'pdpa_scan', { context: PHONE }),
      call(13, 'pdpa_redact', { text: 'x', extra: PHONE }),
      call(14, 'no_such_tool', { text: `โทร ${PHONE}` }),
      call(15, 'pdpa_scan', `โทร ${PHONE}`),
      call(16, 'pdpa_redact', { text: `${PHONE} ${'ก'.repeat(MAX_TEXT)}` }),
    ])
    const replies = stdout
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { id: number; jsonrpc: string })
    // Answers can come in any order: a protocol error is answered before a tool runs.
    expect(replies.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 10, 11, 12, 13, 14, 15, 16])
    for (const r of replies) expect(r.jsonrpc).toBe('2.0')
    for (const out of [stdout, stderr]) {
      expect(out).not.toContain(PHONE)
      expect(out).not.toContain(EMAIL)
    }
  })

  it('works with the official MCP client over stdio', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN],
      stderr: 'pipe',
    })
    const client = new Client({ name: 'e2e', version: '0' })
    await client.connect(transport)
    try {
      expect(client.getServerVersion()?.name).toBe('eve-pdpa')
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name).sort()).toEqual(['pdpa_redact', 'pdpa_scan'])
      const result = await client.callTool({ name: 'pdpa_redact', arguments: { text } })
      expect(textOf(result)).toBe('โทร [เบอร์โทร] หรือ [อีเมล]')
    } finally {
      await client.close()
    }
  })

  it('refuses to start on a policy that tokenises: exit 2, the reason on stderr, nothing on stdout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdpa-mcp-e2e-'))
    const policy = join(dir, 'policy.json')
    writeFileSync(
      policy,
      JSON.stringify({
        entitySet: '0.1',
        entities: { PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'] } },
      }),
    )
    const r = spawnSync(process.execPath, [BIN, '--policy', policy], { encoding: 'utf8' })
    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
    expect(r.stderr).toMatch(/tokenises PHONE/)
  })

  it('--version prints the version on stdout', () => {
    const r = spawnSync(process.execPath, [BIN, '--version'], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/^\d+\.\d+\.\d+\n$/)
  })
})
