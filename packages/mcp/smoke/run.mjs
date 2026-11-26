// Smoke test of the BUILT program on the running Node: start dist/bin.js the
// way an MCP client does, speak JSON-RPC over stdio, check both tools and that
// no value reaches stdout or stderr. Node builtins only, so it runs on every
// Node the package's engines allow.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url))
// Synthetic only.
const PHONE = '0812345678'
const text = `โทร ${PHONE}`

const messages = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '0' },
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

function check(ok, what) {
  if (!ok) throw new Error(what)
}

const { stdout, stderr, code } = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [BIN], { stdio: ['pipe', 'pipe', 'pipe'] })
  let out = ''
  let err = ''
  const timer = setTimeout(() => {
    child.kill()
    reject(new Error(`no answer in 15 s. stdout: ${out} stderr: ${err}`))
  }, 15_000)
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    out += chunk
    if (out.trim().split('\n').length >= 4) child.stdin.end()
  })
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    err += chunk
  })
  child.on('error', reject)
  child.on('close', (exit) => {
    clearTimeout(timer)
    resolve({ stdout: out, stderr: err, code: exit })
  })
  for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`)
})

const replies = stdout
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))
check(code === 0, `exit ${code}: ${stderr}`)
check(replies.map((r) => r.id).join() === '1,2,3,4', `replies: ${stdout}`)
const tools = replies[1].result.tools
  .map((t) => t.name)
  .sort()
  .join()
check(tools === 'pdpa_redact,pdpa_scan', `tools: ${tools}`)
check(
  replies[2].result.content[0].text === 'โทร [เบอร์โทร]',
  `redact: ${JSON.stringify(replies[2])}`,
)
check(replies[3].result.structuredContent.byType.PHONE === 1, `scan: ${JSON.stringify(replies[3])}`)
check(!stdout.includes(PHONE) && !stderr.includes(PHONE), 'a value reached stdout or stderr')

console.log(
  `mcp smoke ok on node ${process.versions.node}: initialize · tools/list · pdpa_redact · pdpa_scan`,
)
