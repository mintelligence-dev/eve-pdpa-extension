/**
 * Where the text to protect sits in a JSON body, written as a path:
 * `messages[].content` is the `content` of every item of `messages`. `[]`
 * after a name walks every item of an array; a dot steps into an object. A
 * path may start with `[]` when the body itself is an array: `[].text`.
 * Only strings are protected — a number, an object or a missing key at the end
 * of a path is left as it is.
 */
export type FieldPath = string

/**
 * Ready-made sets of paths for the request bodies chat apps send.
 *
 *   chat       every chat shape below: the default
 *   openai     Chat Completions (content as a string or as parts) and the
 *              Responses API (`input` as a string or as items)
 *   anthropic  Messages: content as a string or as blocks with text
 *   ai-sdk     Vercel AI SDK: v4 messages with content, v5 with parts, and
 *              useCompletion's prompt
 *   line       a LINE Messaging API webhook: each event's message text
 *
 * An item whose `role` is `system` or `developer` is skipped wherever a path
 * walks an array: it is the shop's own instruction, not the customer's text,
 * and it often carries the shop's own number on purpose.
 */
export type Preset = 'chat' | 'openai' | 'anthropic' | 'ai-sdk' | 'line'

const OPENAI: readonly FieldPath[] = [
  'messages[].content',
  'messages[].content[].text',
  'input',
  'input[].content',
  'input[].content[].text',
]
const ANTHROPIC: readonly FieldPath[] = ['messages[].content', 'messages[].content[].text']
const AI_SDK: readonly FieldPath[] = ['messages[].content', 'messages[].parts[].text', 'prompt']

export const PRESETS: Readonly<Record<Preset, readonly FieldPath[]>> = {
  openai: OPENAI,
  anthropic: ANTHROPIC,
  'ai-sdk': AI_SDK,
  chat: [...new Set([...OPENAI, ...ANTHROPIC, ...AI_SDK])],
  line: ['events[].message.text'],
}

/** Array items written by the shop, not the customer. */
const SKIPPED_ROLES: ReadonlySet<unknown> = new Set(['system', 'developer'])

/** A preset by name, or the paths as given. */
export function pathsOf(fields: Preset | readonly FieldPath[] | undefined): readonly FieldPath[] {
  if (fields === undefined) return PRESETS.chat
  if (typeof fields === 'string') {
    if (!Object.hasOwn(PRESETS, fields)) throw new TypeError(`unknown fields preset "${fields}"`)
    return PRESETS[fields]
  }
  return fields
}

interface Step {
  readonly key: string
  readonly each: boolean
}

function stepsOf(path: FieldPath): Step[] {
  return path.split('.').map((part, at) => {
    const each = part.endsWith('[]')
    const key = each ? part.slice(0, -2) : part
    // Only the first step may have no name: it is the body itself, an array.
    if (key === '' && !(each && at === 0)) {
      throw new TypeError(`empty step in field path "${path}"`)
    }
    return { key, each }
  })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Calls `visit` with every string the paths reach in `body`, in the order the
 * paths are given and, within one, in document order. `set` writes a new value
 * in its place. `body` must be a copy the caller owns: it is written to.
 */
export function eachString(
  body: unknown,
  paths: readonly FieldPath[],
  visit: (value: string, set: (next: string) => void) => void,
): void {
  // A path written twice would give one string two scans and two audit events.
  for (const path of new Set(paths)) {
    const steps = stepsOf(path)
    const walk = (node: unknown, at: number): void => {
      const step = steps[at] as Step
      const root = step.key === ''
      if (!root && !isObject(node)) return
      const value = root ? node : (node as Record<string, unknown>)[step.key]
      const last = at === steps.length - 1
      const reach = (child: unknown, set: (next: string) => void): void => {
        if (last) {
          if (typeof child === 'string') visit(child, set)
        } else {
          walk(child, at + 1)
        }
      }
      if (step.each) {
        if (!Array.isArray(value)) return
        value.forEach((item, i) => {
          if (isObject(item) && SKIPPED_ROLES.has(item.role)) return
          reach(item, (next) => {
            value[i] = next
          })
        })
      } else {
        reach(value, (next) => {
          ;(node as Record<string, unknown>)[step.key] = next
        })
      }
    }
    walk(body, 0)
  }
}
