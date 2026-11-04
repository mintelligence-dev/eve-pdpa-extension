// The registry item `eve add` installs: built into r/ from registry/, read by
// eve's own registry parser (the shadcn schema eve 0.80.1 bundles), and its
// files type-checked in a project laid out the way `eve init` 0.80.1 lays one out.
import { execFile, execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const PKG = fileURLToPath(new URL('..', import.meta.url))
const ROOT = join(PKG, '..', '..')
const R = join(PKG, 'r')
const EVE_BIN = join(PKG, 'node_modules', '.bin', 'eve')
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')

interface ItemFile {
  path: string
  type: string
  target: string
  content?: string
}
interface Item {
  name: string
  type: string
  dependencies: string[]
  envVars: Record<string, string>
  files: ItemFile[]
}

/** `eve init` 0.80.1's tsconfig.json and package.json, as it writes them. */
const TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'esnext',
    moduleResolution: 'bundler',
    types: ['node', 'eve/workflow-modules'],
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ['agent/**/*.ts', 'evals/**/*.ts'],
}
const PACKAGE = {
  name: 'demo',
  version: '0.0.0',
  type: 'module',
  imports: { '#*': './agent/*', '#evals/*': './evals/*' },
  dependencies: { ai: '^7.0.137', eve: '^0.80.1' },
  devDependencies: { '@types/node': '24.x' },
}
/** agent/agent.ts after the README's edit (CONTRACT §6). */
const AGENT = `import { defineAgent } from "eve";
import { pdpa } from "./lib/pdpa.js";

export default defineAgent({
  model: pdpa.model("openai/gpt-6-luna-fast"),
  modelContextWindowTokens: 400_000,
  reasoning: "high",
  defaultTools: false,
});
`

/** eve's CLI, without blocking: the registry server runs in this process. */
async function eve(args: string[]): Promise<{ status: number; out: string }> {
  try {
    const { stdout, stderr } = await promisify(execFile)(EVE_BIN, args, { cwd: project })
    return { status: 0, out: `${stdout}${stderr}` }
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string }
    return { status: e.code ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

let server: Server
let base = ''
let project = ''
const read = <T>(name: string): T => JSON.parse(readFileSync(join(R, name), 'utf8')) as T

/** node_modules/<name> → where the workspace installed it, as an install would place it. */
function link(dir: string, name: string, target: string): void {
  const at = join(dir, 'node_modules', name)
  mkdirSync(dirname(at), { recursive: true })
  symlinkSync(realpathSync(target), at, 'dir')
}

beforeAll(() => {
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-eve-registry.mjs')], {
    stdio: 'ignore',
  })
  project = mkdtempSync(join(tmpdir(), 'pdpa-registry-'))
  writeFileSync(join(project, 'tsconfig.json'), JSON.stringify(TSCONFIG, null, 2))
  writeFileSync(join(project, 'package.json'), JSON.stringify(PACKAGE, null, 2))
  mkdirSync(join(project, 'agent'), { recursive: true })
  writeFileSync(join(project, 'agent', 'agent.ts'), AGENT)
  link(project, 'eve', join(PKG, 'node_modules', 'eve'))
  link(project, 'ai', join(PKG, 'node_modules', 'ai'))
  link(project, '@types/node', join(PKG, 'node_modules', '@types', 'node'))
  link(project, '@eve-pdpa-extension/eve', PKG)

  server = createServer((req, res) => {
    const file = join(R, new URL(req.url ?? '/', 'http://x').pathname.replace(/^\/r\//, ''))
    if (!file.startsWith(R) || !existsSync(file)) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(readFileSync(file))
  })
  return new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      resolve()
    }),
  )
})

afterAll(() => {
  server?.close()
  if (project !== '') rmSync(project, { recursive: true, force: true })
})

describe('the registry item (U-REG-1)', () => {
  it('builds r/registry.json and r/pdpa.json, with every file inlined', () => {
    const catalog = read<{ items: Item[] }>('registry.json')
    expect(catalog.items.map((i) => i.name)).toEqual(['pdpa'])
    const item = read<Item>('pdpa.json')
    expect(item).toMatchObject({ name: 'pdpa', type: 'registry:item' })
    expect(item.envVars).toEqual({ PDPA_HMAC_KEY: '', PDPA_SESSION_KEY: '' })
    expect(item.files.map((f) => f.target).sort()).toEqual([
      'agent/channels/eve.ts',
      'agent/hooks/pdpa.ts',
      'agent/lib/pdpa.ts',
      'policies/pdpa-policy.json',
    ])
    for (const file of item.files) {
      expect(file.type).toBe('registry:file')
      expect(file.content?.length, file.target).toBeGreaterThan(0)
    }
  })

  it("is read by eve's own registry parser, item and catalog", async () => {
    const view = await eve(['registry', 'view', `${base}/r/pdpa.json`])
    expect(view.status, view.out).toBe(0)
    expect(view.out).toContain('agent/channels/eve.ts')
    const list = await eve(['registry', 'list', '--registry', `${base}/r/registry.json`])
    expect(list.status, list.out).toBe(0)
    expect(list.out).toContain(`${base}/r/pdpa.json`)
  }, 60_000)

  it('imports from @eve-pdpa-extension/eve and eve only — pnpm does not hoist core', () => {
    for (const file of read<Item>('pdpa.json').files) {
      const specifiers = [...(file.content ?? '').matchAll(/from\s+["']([^"'.][^"']*)["']/g)].map(
        (m) => m[1],
      )
      for (const s of specifiers)
        expect(s, file.target).toMatch(/^(@eve-pdpa-extension\/eve\/|eve\/)/)
    }
  })

  it('carries a policy core accepts', async () => {
    const { definePolicy } = await import('@eve-pdpa-extension/core')
    const policy = read<Item>('pdpa.json').files.find(
      (f) => f.target === 'policies/pdpa-policy.json',
    )
    expect(() => definePolicy(JSON.parse(policy?.content ?? '{}'))).not.toThrow()
  })
})

describe('the files type-check in an eve init project (U-REG-2)', () => {
  it('tsc --noEmit passes with the item written in and agent.ts edited as the README says', () => {
    for (const file of read<Item>('pdpa.json').files) {
      const at = join(project, file.target)
      mkdirSync(dirname(at), { recursive: true })
      writeFileSync(at, file.content ?? '')
    }
    const tsc = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json', '--noEmit'], {
      cwd: project,
      encoding: 'utf8',
    })
    expect(tsc.status, tsc.stdout).toBe(0)
  }, 60_000)
})

describe('the version (U-REG-3)', () => {
  it('pins the package it was built from, exactly', () => {
    const { version } = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'))
    expect(read<Item>('pdpa.json').dependencies).toEqual([`@eve-pdpa-extension/eve@${version}`])
    expect(read<{ items: Item[] }>('registry.json').items[0]?.dependencies).toEqual([
      `@eve-pdpa-extension/eve@${version}`,
    ])
  })
})
