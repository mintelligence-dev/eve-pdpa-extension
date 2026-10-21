/**
 * withTokenResolution: lets one tool use the real values behind the tokens
 * the model passes it, for one purpose, and keeps every real value out of
 * what the tool hands back. withOutputGuard: only the second half, for a tool
 * that fetches personal data itself and never needs a token resolved.
 *
 * eve records a tool's result as the `action.result` event — streamed to the
 * client, kept in history, read by hooks — as well as giving it to the model.
 * So the result is masked before `execute` returns, not in `toModelOutput`.
 */
import type { Guard } from '@eve-pdpa-extension/core'
import { defineTool, type ToolDefinition } from 'eve/tools'
import { checkGuard } from './content.js'
import { checkSessionKey } from './session.js'
import { currentPdpaSessionId } from './session-state.js'

export interface TokenResolutionOptions {
  /** The agent's core guard: the one its channels issued the tokens with. */
  readonly guard: Guard
  readonly sessionKey: string
  /** Why the tool needs the real value. Must be in the entity's `allowedPurposes`. */
  readonly purpose: string
  /**
   * Input paths to resolve, such as `"phone"` or `"to.number"`. Default: every
   * string in the input. A token anywhere else is passed through as a token.
   */
  readonly fields?: readonly string[]
}

export interface OutputGuardOptions {
  /** The agent's core guard. */
  readonly guard: Guard
  readonly sessionKey: string
}

/** What the tool returns instead of running, when a token cannot be used. */
export interface TokenRefusal {
  readonly ok: false
  readonly reason: 'expired' | 'unknown' | 'not_allowed' | 'unavailable' | 'blocked'
  /** What the model should do next. Never a value. */
  readonly ask: string
}

// Core's spellings of one token (actions/tokenise.ts): with or without the
// brackets, with spaces inside them. Letters only — no detector sees a number.
const TOKEN_IN_TEXT = /\[\s*tok:[bcdfghjkmnpqrstv]{16}\s*\]|tok:[bcdfghjkmnpqrstv]{16}/g

const REFUSALS: Readonly<Record<string, TokenRefusal>> = {
  expired: {
    ok: false,
    reason: 'expired',
    ask: 'The value has expired. Ask the customer for it again.',
  },
  not_found: {
    ok: false,
    reason: 'unknown',
    ask: 'That value is not available. Ask the customer for it again.',
  },
  session_mismatch: {
    ok: false,
    reason: 'unknown',
    ask: 'That value is not available. Ask the customer for it again.',
  },
  purpose_not_allowed: {
    ok: false,
    reason: 'not_allowed',
    ask: 'This tool may not use that value. Do not try again with it.',
  },
  store_unavailable: {
    ok: false,
    reason: 'unavailable',
    ask: 'The value cannot be read right now. Tell the customer to try again in a moment.',
  },
}
const BLOCKED: TokenRefusal = {
  ok: false,
  reason: 'blocked',
  ask: 'The result held data that may not be shown. Tell the customer it cannot be shared here.',
}

type Path = readonly string[]

function pathIn(fields: readonly Path[] | null, path: Path): boolean {
  if (fields === null) return true
  return fields.some((f) => f.length === path.length && f.every((k, i) => k === path[i]))
}

/** Every string in `value` that should be resolved, with where it sits. */
function walk(value: unknown, path: Path, fields: readonly Path[] | null, out: Path[]): void {
  if (typeof value === 'string') {
    if (pathIn(fields, path)) out.push(path)
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, [...path, String(i)], fields, out))
  } else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) walk(v, [...path, k], fields, out)
  }
}

function get(value: unknown, path: Path): unknown {
  return path.reduce<unknown>((v, k) => (v as Record<string, unknown>)?.[k], value)
}

/** A copy of `value` with the string at `path` replaced. The input is never changed. */
function set(value: unknown, path: Path, next: string): unknown {
  if (path.length === 0) return next
  const [head, ...rest] = path as [string, ...string[]]
  if (Array.isArray(value)) {
    const copy = [...value]
    copy[Number(head)] = set(copy[Number(head)], rest, next)
    return copy
  }
  const obj = value as Record<string, unknown>
  return { ...obj, [head]: set(obj[head], rest, next) }
}

/**
 * Every token in the chosen strings, swapped for its real value. The first
 * one that cannot be resolved — expired, another chat's, a purpose the policy
 * does not allow, the store down — refuses the whole call: a tool never runs
 * with half its input real.
 */
async function resolveInput(
  input: unknown,
  guard: Guard,
  options: { purpose: string; sessionId: string; fields: readonly Path[] | null },
): Promise<{ input: unknown } | { refusal: TokenRefusal }> {
  const paths: Path[] = []
  walk(input, [], options.fields, paths)
  let resolved = input
  for (const path of paths) {
    const text = get(input, path) as string
    const tokens = text.match(TOKEN_IN_TEXT)
    if (tokens === null) continue
    let next = text
    for (const token of new Set(tokens)) {
      const r = await guard.resolve(token, {
        purpose: options.purpose,
        sessionId: options.sessionId,
      })
      if (!r.ok) return { refusal: REFUSALS[r.reason] ?? (REFUSALS.not_found as TokenRefusal) }
      next = next.split(token).join(r.value)
    }
    resolved = set(resolved, path, next)
  }
  return { input: resolved }
}

/**
 * The tool's result through the guard at `tool_output`. Scanned as one JSON
 * text, so a cue word in a key still helps a detector; read back into the
 * same shape. A result that holds data the policy blocks becomes a refusal.
 */
async function protectOutput(output: unknown, guard: Guard, sessionId: string): Promise<unknown> {
  if (
    output === undefined ||
    output === null ||
    typeof output === 'number' ||
    typeof output === 'boolean'
  ) {
    return output
  }
  const asText = typeof output === 'string'
  const text = asText ? output : JSON.stringify(output)
  if (text === undefined) return output
  const out = await guard.process(text, { sessionId, boundary: 'tool_output' })
  if (out.outcome === 'blocked') return BLOCKED
  if (asText) return out.text
  try {
    return JSON.parse(out.text)
  } catch {
    // A replacement broke the JSON: scan each string where it sits instead.
    const paths: Path[] = []
    walk(output, [], null, paths)
    let safe: unknown = output
    for (const path of paths) {
      const one = await guard.process(get(output, path) as string, {
        sessionId,
        boundary: 'tool_output',
      })
      if (one.outcome === 'blocked') return BLOCKED
      safe = set(safe, path, one.text)
    }
    return safe
  }
}

/**
 * The tool with an `execute` that runs `before` on the input — which may
 * refuse the call — then the original, and masks every result it returns or
 * yields. Everything else about the tool is kept.
 */
function wrapExecute<TInput, TOutput>(
  tool: ToolDefinition<TInput, TOutput>,
  guard: Guard,
  sessionKey: string,
  before: (
    input: TInput,
    sessionId: string,
  ) => Promise<{ input: unknown } | { refusal: TokenRefusal }>,
): ToolDefinition<TInput, TOutput | TokenRefusal> {
  if (typeof tool?.execute !== 'function') throw new TypeError('tool: expected a tool with execute')
  const original = tool.execute

  const prepare = async (input: TInput, ctx: Parameters<typeof original>[1]) => {
    const sessionId = await currentPdpaSessionId(sessionKey, ctx.session.id)
    return { sessionId, resolved: await before(input, sessionId) }
  }

  // A generator tool streams snapshots and ends with its result: it has to stay
  // a generator, so eve sees an AsyncIterable and not a Promise of one.
  const execute: ToolDefinition<TInput, TOutput | TokenRefusal>['execute'] =
    original.constructor.name === 'AsyncGeneratorFunction'
      ? async function* (input, ctx) {
          const { sessionId, resolved } = await prepare(input, ctx)
          if ('refusal' in resolved) {
            yield resolved.refusal
            return
          }
          const items = original.call(tool, resolved.input as TInput, ctx) as AsyncIterable<TOutput>
          for await (const item of items)
            yield (await protectOutput(item, guard, sessionId)) as TOutput
        }
      : async (input, ctx) => {
          const { sessionId, resolved } = await prepare(input, ctx)
          if ('refusal' in resolved) return resolved.refusal
          const result = await original.call(tool, resolved.input as TInput, ctx)
          return (await protectOutput(result, guard, sessionId)) as TOutput
        }

  return defineTool({ ...tool, execute } as ToolDefinition<TInput, TOutput | TokenRefusal>)
}

/**
 * Returns the tool with an `execute` that resolves tokens in its input for
 * `purpose`, runs the original with the real values, and masks what it
 * returns. Description, schemas, approval and label are kept.
 *
 * If a token cannot be used, the original `execute` is not called; the model
 * gets a `TokenRefusal` it can act on — usually, ask the customer again.
 */
export function withTokenResolution<TInput, TOutput>(
  tool: ToolDefinition<TInput, TOutput>,
  options: TokenResolutionOptions,
): ToolDefinition<TInput, TOutput | TokenRefusal> {
  checkGuard(options?.guard)
  checkSessionKey(options.sessionKey)
  if (typeof options.purpose !== 'string' || options.purpose.length === 0) {
    throw new TypeError('purpose: expected the purpose this tool resolves tokens for')
  }
  const { guard, purpose } = options
  const fields = options.fields === undefined ? null : options.fields.map((f) => f.split('.'))
  return wrapExecute(tool, guard, options.sessionKey, (input, sessionId) =>
    resolveInput(input, guard, { purpose, sessionId, fields }),
  )
}

/**
 * Returns the tool with an `execute` that masks what the original returns, at
 * `tool_output`, before eve records or streams it. The input is passed as it
 * is: tokens stay tokens. For a tool that reads personal data from elsewhere —
 * a CRM, a database — and needs no real value from the chat.
 *
 * A result that holds data the policy blocks becomes a `TokenRefusal` with
 * `reason: 'blocked'`.
 */
export function withOutputGuard<TInput, TOutput>(
  tool: ToolDefinition<TInput, TOutput>,
  options: OutputGuardOptions,
): ToolDefinition<TInput, TOutput | TokenRefusal> {
  checkGuard(options?.guard)
  checkSessionKey(options.sessionKey)
  return wrapExecute(tool, options.guard, options.sessionKey, async (input) => ({ input }))
}
