import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../src/cli.js'
import type { ScanReport } from '../src/scan.js'

export const dir = mkdtempSync(join(tmpdir(), 'pdpa-cli-'))
let fileNo = 0

export function file(content: string | Uint8Array, ext = '.jsonl'): string {
  const path = join(dir, `f${fileNo++}${ext}`)
  writeFileSync(path, content)
  return path
}

export const jsonl = (...records: unknown[]) => records.map((r) => JSON.stringify(r)).join('\n')

export async function cli(...argv: string[]) {
  let stdout = ''
  let stderr = ''
  const code = await main(argv, {
    stdout: (t) => {
      stdout += t
    },
    stderr: (t) => {
      stderr += t
    },
  })
  return { code, stdout, stderr }
}

export async function report(...argv: string[]): Promise<ScanReport> {
  const { stdout } = await cli(...argv, '--json')
  return JSON.parse(stdout)
}
