#!/usr/bin/env node
// eve-pdpa-check: is this eve agent set up so personal data cannot get past
// the guard? Reads the agent's files and its environment; changes nothing.
//
//   eve-pdpa-check [--production] [--cwd <dir>]
//
// Exit 0: every check passed (warnings may still print). 1: a check failed.
// 2: the command was used wrong. It prints names, never a value: a key is
// "set" or "not set", nothing more.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const USAGE = `usage: eve-pdpa-check [--production] [--cwd <dir>]

Checks an eve agent for @eve-pdpa-extension/eve:
  channels  every agent/channels/*.ts is wrapped (pdpa.channel or withPdpaGuard)
  model     agent/agent.ts wraps its model (pdpa.model or guardModel)
  hook      a file in agent/hooks/ default-exports pdpa.hook or pdpaHook(...)
  eve       the installed eve is 0.80.x
  keys      with --production: PDPA_HMAC_KEY and PDPA_SESSION_KEY are set
  store     with --production: UPSTASH_REDIS_REST_* or KV_REST_API_* is set

Options:
  --production  also check what production needs (keys, a shared token store)
  --cwd <dir>   the agent project (default: the current directory)
  -h, --help    show this
`

const SUPPORTED_EVE = /^0\.80\.\d+$/

function parseArgs(argv) {
  const out = { production: false, cwd: process.cwd(), help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--production') out.production = true
    else if (arg === '-h' || arg === '--help') out.help = true
    else if (arg === '--cwd') {
      const dir = argv[++i]
      if (dir === undefined || dir.startsWith('-')) return { error: '--cwd needs a directory' }
      out.cwd = dir
    } else if (arg.startsWith('--cwd=')) out.cwd = arg.slice('--cwd='.length)
    else return { error: `unknown option: ${arg}` }
  }
  return out
}

/** The files of a directory with these extensions, sorted; none when it is missing. */
function filesIn(dir, exts = ['.ts', '.mts', '.js', '.mjs']) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return []
  return readdirSync(dir)
    .filter((f) => exts.some((e) => f.endsWith(e)) && !f.endsWith('.d.ts'))
    .sort()
    .map((f) => join(dir, f))
}

/** Source without comments, so a wrapper mentioned in a comment does not count. */
function code(file) {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

/**
 * KEY=value lines of the .env files eve loads, merged under process.env.
 * Only whether a name has a value is used; values are never printed.
 */
function environment(cwd) {
  const env = {}
  for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    const file = join(cwd, name)
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
      if (m === null) continue
      const value = m[2].trim().replace(/^(['"])(.*)\1$/, '$2')
      env[m[1]] = value
    }
  }
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  return env
}

const isSet = (env, name) => typeof env[name] === 'string' && env[name] !== ''

function run(opts) {
  const cwd = opts.cwd
  const agent = join(cwd, 'agent')
  const results = []
  const pass = (check, detail) => results.push({ level: 'ok', check, detail })
  const fail = (check, detail) => results.push({ level: 'fail', check, detail })
  const warn = (check, detail) => results.push({ level: 'warn', check, detail })
  const rel = (f) => relative(cwd, f)

  if (!existsSync(agent)) {
    fail('agent', `no agent/ directory in ${cwd} — run from the eve project, or pass --cwd`)
    return results
  }

  // channels
  const channels = filesIn(join(agent, 'channels'))
  if (channels.length === 0) {
    pass('channels', 'no files in agent/channels/')
  }
  for (const file of channels) {
    const src = code(file)
    const wrapped = /\bpdpa\.channel\s*\(|\bwithPdpaGuard\s*\(/.test(src)
    if (wrapped) pass('channels', `${rel(file)} is wrapped`)
    else
      fail(
        'channels',
        `${rel(file)} is not wrapped: export default pdpa.channel(<channel>, '<file stem>') — eve add --overwrite replaces eve.ts`,
      )
  }

  // model and defaultTools
  const agentFile = ['agent.ts', 'agent.mts', 'agent.js', 'agent.mjs']
    .map((f) => join(agent, f))
    .find((f) => existsSync(f))
  if (agentFile === undefined) {
    fail('model', 'no agent/agent.ts')
  } else {
    const src = code(agentFile)
    if (/\bpdpa\.model\s*\(|\bguardModel\s*\(/.test(src))
      pass('model', `${rel(agentFile)} wraps its model`)
    else fail('model', `${rel(agentFile)} does not wrap its model: model: pdpa.model('<model id>')`)
    if (!/\bdefaultTools\s*:\s*false\b/.test(src)) {
      warn(
        'defaultTools',
        `${rel(agentFile)} keeps eve's default tools (bash, files, web fetch): they can send what the model reads to places no wrapper watches — set defaultTools: false unless you need them`,
      )
    }
  }

  // hook
  const hooks = filesIn(join(agent, 'hooks')).filter((f) =>
    /export\s+default\s+pdpa\.hook\b|\bpdpaHook\s*\(/.test(code(f)),
  )
  if (hooks.length > 0) pass('hook', `${rel(hooks[0])} registers the pdpa hook`)
  else fail('hook', 'no file in agent/hooks/ default-exports the hook: export default pdpa.hook')

  // eve version
  const evePkg = join(cwd, 'node_modules', 'eve', 'package.json')
  if (!existsSync(evePkg)) {
    fail('eve', 'eve is not installed in node_modules — install dependencies first')
  } else {
    let version = 'unknown'
    try {
      version = String(JSON.parse(readFileSync(evePkg, 'utf8')).version)
    } catch {}
    if (SUPPORTED_EVE.test(version)) pass('eve', `eve ${version}`)
    else
      fail(
        'eve',
        `eve ${version} is installed; @eve-pdpa-extension/eve supports eve 0.80.x — another eve can post replies this package does not mask`,
      )
  }

  // what production needs
  if (opts.production) {
    const env = environment(cwd)
    for (const name of ['PDPA_HMAC_KEY', 'PDPA_SESSION_KEY']) {
      if (isSet(env, name)) pass('keys', `${name} is set`)
      else fail('keys', `${name} is not set (openssl rand -hex 32)`)
    }
    const upstash = isSet(env, 'UPSTASH_REDIS_REST_URL') && isSet(env, 'UPSTASH_REDIS_REST_TOKEN')
    const kv = isSet(env, 'KV_REST_API_URL') && isSet(env, 'KV_REST_API_TOKEN')
    if (upstash) pass('store', 'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set')
    else if (kv) pass('store', 'KV_REST_API_URL and KV_REST_API_TOKEN are set')
    else
      fail(
        'store',
        'no shared token store: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL and KV_REST_API_TOKEN) — on Vercel, add Upstash from the Marketplace',
      )
  }
  return results
}

const opts = parseArgs(process.argv.slice(2))
if ('error' in opts) {
  process.stderr.write(`eve-pdpa-check: ${opts.error}\n\n${USAGE}`)
  process.exit(2)
}
if (opts.help) {
  process.stdout.write(USAGE)
  process.exit(0)
}
if (!existsSync(opts.cwd)) {
  process.stderr.write(`eve-pdpa-check: --cwd ${opts.cwd} does not exist\n`)
  process.exit(2)
}

const results = run(opts)
const mark = { ok: '✓', fail: '✗', warn: '!' }
for (const r of results)
  process.stdout.write(`${mark[r.level]} ${r.check.padEnd(12)} ${r.detail}\n`)
const failed = results.filter((r) => r.level === 'fail').length
const warned = results.filter((r) => r.level === 'warn').length
process.stdout.write(
  failed > 0
    ? `\neve-pdpa-check: ${failed} problem${failed === 1 ? '' : 's'} found\n`
    : `\neve-pdpa-check: ok${warned > 0 ? ` (${warned} warning${warned === 1 ? '' : 's'})` : ''}${opts.production ? '' : ' — add --production to check keys and the token store'}\n`,
)
process.exit(failed > 0 ? 1 : 0)
