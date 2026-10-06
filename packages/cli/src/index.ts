#!/usr/bin/env node
import { VERSION } from '@thai-pdpa-guard/core'

const USAGE = `thai-pdpa-guard ${VERSION}

Usage:
  thai-pdpa-guard --version
  thai-pdpa-guard --help

Scanning (scan, redact, report, policy validate) lands with the detectors in
weeks 5-10. This binary exists now so the workspace wiring and the packaging
gates are proven end to end.
`

export function run(argv: readonly string[]): number {
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${VERSION}\n`)
    return 0
  }
  process.stdout.write(USAGE)
  return argv.includes('--help') || argv.includes('-h') ? 0 : 2
}

process.exitCode = run(process.argv.slice(2))
