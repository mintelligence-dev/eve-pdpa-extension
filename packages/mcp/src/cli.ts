import { appendFileSync, readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import {
  type AuditRecord,
  type CompiledPolicy,
  createGuard,
  type Guard,
  type GuardOptions,
  parsePolicy,
} from '@eve-pdpa-extension/core'
import { defaultPolicy, policyProblem } from './policy.js'

/** A new audit file is readable by its owner only. */
const AUDIT_MODE = 0o600

/** An fs error's code, such as ENOENT or EACCES, and nothing from the message. */
function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'unknown error'
}

export const USAGE = `eve-pdpa-mcp — an MCP server with pdpa_scan and pdpa_redact, over stdio

Usage:
  eve-pdpa-mcp [--policy <file>] [--audit <file>]

Options:
  --policy <file>   The policy to apply (JSON, as for createGuard). Without it,
                    every type of personal data is redacted.
  --audit <file>    Append audit events here, one JSON line each. Without it
                    they go to stderr. They never hold a value.
  -h, --help
  -v, --version

Environment:
  PDPA_HMAC_KEY     The secret for a policy that hashes. Required if it does.

An MCP client starts this program itself; see the README for its config.
`

export type Prepared =
  | { readonly ok: true; readonly guard: Guard; readonly version: string }
  | { readonly ok: false; readonly code: number; readonly message: string }

export interface CliIo {
  readonly env: Readonly<Record<string, string | undefined>>
  /** Where audit lines go when no --audit file is given. */
  readonly stderr: (text: string) => void
}

/** This package's version, from its package.json. */
export function packageVersion(): string {
  const pkg: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const version = (pkg as { version?: unknown }).version
  return typeof version === 'string' ? version : '0.0.0'
}

/**
 * Everything before the server starts: the arguments, the policy, the audit.
 * Returns the guard to serve, or the exit code and the reason not to start.
 */
export function prepare(args: readonly string[], io: CliIo): Prepared {
  let values: { policy?: string; audit?: string; help?: boolean; version?: boolean }
  try {
    values = parseArgs({
      args: [...args],
      options: {
        policy: { type: 'string' },
        audit: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
      strict: true,
      allowPositionals: false,
    }).values
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    return { ok: false, code: 2, message: `${why}\n\n${USAGE}` }
  }
  const version = packageVersion()
  if (values.help === true) return { ok: false, code: 0, message: USAGE }
  if (values.version === true) return { ok: false, code: 0, message: `${version}\n` }

  let policy: CompiledPolicy
  if (values.policy === undefined) {
    policy = defaultPolicy()
  } else {
    try {
      policy = parsePolicy(readFileSync(values.policy, 'utf8'))
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error)
      return { ok: false, code: 2, message: `policy ${values.policy}: ${why}\n` }
    }
  }

  const hmacKey = io.env.PDPA_HMAC_KEY
  const problem = policyProblem(policy, { hmacKey })
  if (problem !== undefined) return { ok: false, code: 2, message: `eve-pdpa-mcp: ${problem}\n` }

  const auditFile = values.audit
  if (auditFile !== undefined) {
    // Fail at start, not silently later: audit kept for compliance that is
    // never written is worse than a server that does not start.
    try {
      appendFileSync(auditFile, '', { mode: AUDIT_MODE })
    } catch (error) {
      return { ok: false, code: 2, message: `audit ${auditFile}: ${errorCode(error)}\n` }
    }
  }
  const onAudit =
    auditFile === undefined
      ? (event: AuditRecord) => io.stderr(`${JSON.stringify(event)}\n`)
      : (event: AuditRecord) =>
          appendFileSync(auditFile, `${JSON.stringify(event)}\n`, { mode: AUDIT_MODE })
  // Core catches a sink that throws (the file was removed, the disk is full)
  // and tells us here. The error's code only: never its message.
  const onError: GuardOptions['onError'] = (error, context) =>
    io.stderr(
      `eve-pdpa-mcp: the ${context.eventType} audit event was not written (${errorCode(error)})\n`,
    )

  try {
    const guard = createGuard({
      policy,
      onAudit,
      onError,
      ...(hmacKey === undefined || hmacKey === '' ? {} : { hmacKey }),
    })
    return { ok: true, guard, version }
  } catch (error) {
    // createGuard's own messages name the setting, never a value.
    const why = error instanceof Error ? error.message : String(error)
    return { ok: false, code: 2, message: `eve-pdpa-mcp: ${why}\n` }
  }
}
