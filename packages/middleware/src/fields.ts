/**
 * Where the text to protect sits in a JSON body, written as a path:
 * `messages[].content` is the `content` of every item of `messages`. `[]`
 * after a name walks every item of an array; a dot steps into an object.
 * Only strings are protected — a number, an object or a missing key at the end
 * of a path is left as it is.
 */
export type FieldPath = string

/**
 * Ready-made sets of paths for the request bodies chat apps send.
 *
 *   chat       every shape below: the default
 *   openai     Chat Completions: content as a string or as parts with text
 *   anthropic  Messages: the same two shapes
 *   ai-sdk     Vercel AI SDK: v4 messages with content, v5 with parts, and
 *              useCompletion's prompt
 *
 * A system prompt is left out: it is the shop's own text, not the customer's.
 */
export type Preset = 'chat' | 'openai' | 'anthropic' | 'ai-sdk'

export const PRESETS: Readonly<Record<Preset, readonly FieldPath[]>> = {
  openai: ['messages[].content', 'messages[].content[].text'],
  anthropic: ['messages[].content', 'messages[].content[].text'],
  'ai-sdk': ['messages[].content', 'messages[].parts[].text', 'prompt'],
  chat: ['messages[].content', 'messages[].content[].text', 'messages[].parts[].text', 'prompt'],
}

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
  return path.split('.').map((part) => {
    const each = part.endsWith('[]')
    const key = each ? part.slice(0, -2) : part
    if (key === '') throw new TypeError(`empty step in field path "${path}"`)
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
  for (const path of paths) {
    const steps = stepsOf(path)
    const walk = (node: unknown, at: number): void => {
      if (!isObject(node)) return
      const step = steps[at] as Step
      const value = node[step.key]
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
          reach(item, (next) => {
            value[i] = next
          })
        })
      } else {
        reach(value, (next) => {
          node[step.key] = next
        })
      }
    }
    walk(body, 0)
  }
}
