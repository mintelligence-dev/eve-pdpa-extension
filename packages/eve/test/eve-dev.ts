// Starts `eve dev` for an agent directory, headless, on a free port, and stops
// it. Shared by the tests that need eve's real runtime.
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

export const EVE_CLI = fileURLToPath(new URL('../node_modules/eve/bin/eve.js', import.meta.url))
const STARTUP_MS = 45_000

/** Why eve cannot run here, or null. */
export function cannotRunEve(): string | null {
  if (Number(process.versions.node.split('.')[0]) < 24)
    return `eve needs Node 24; this is ${process.version}`
  if (!existsSync(EVE_CLI)) return 'eve is not installed (run pnpm install)'
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface EveDev {
  readonly base: string
  log(): string
  stop(): Promise<void>
}

/**
 * Vitest sets NODE_ENV=test. Under it, eve dev (0.80.1) does not call the
 * agent's authored model the way it does in development, so the server gets
 * the environment a developer's shell has.
 */
function withoutTestEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { NODE_ENV: _drop, ...rest } = env
  return rest
}

/** Resolves once /eve/v1/health answers; rejects with the log tail if it never does. */
export async function startEveDev(cwd: string, env: Record<string, string>): Promise<EveDev> {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  let log = ''
  const child: ChildProcess = spawn(
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
      cwd,
      env: { ...withoutTestEnv(process.env), EVE_TELEMETRY_DISABLED: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  child.stdout?.on('data', (chunk) => {
    log += chunk
  })
  child.stderr?.on('data', (chunk) => {
    log += chunk
  })
  const stop = async () => {
    if (child.exitCode !== null) return
    // eve dev stops its runtime child on SIGTERM. SIGKILL if it hangs.
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill('SIGTERM')
    await Promise.race([exited, sleep(10_000)])
    if (child.exitCode === null) child.kill('SIGKILL')
  }
  const deadline = Date.now() + STARTUP_MS
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      if ((await fetch(`${base}/eve/v1/health`)).ok) return { base, log: () => log, stop }
    } catch {}
    await sleep(250)
  }
  await stop()
  throw new Error(`eve dev did not start (exit ${child.exitCode ?? 'none'}): ${log.slice(-800)}`)
}

/** The session's recorded history, up to the durable tail. */
export async function history(
  base: string,
  sessionId: string,
): Promise<{ type: string; data?: any }[]> {
  const text = await (await fetch(`${base}/eve/v1/session/${sessionId}/stream?follow=false`)).text()
  return text
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line))
}

/** Waits until the session has parked `turns` times. */
export async function settled(base: string, sessionId: string, turns = 1, ms = 20_000) {
  const deadline = Date.now() + ms
  for (;;) {
    const events = await history(base, sessionId)
    if (events.filter((e) => e.type === 'session.waiting').length >= turns) return events
    if (events.some((e) => e.type === 'session.failed')) throw new Error('session failed')
    if (Date.now() > deadline) throw new Error(`turn did not settle in ${ms} ms`)
    await sleep(200)
  }
}

export async function until<T>(
  what: string,
  check: () => T | undefined | false,
  ms = 20_000,
): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(200)
  }
}
