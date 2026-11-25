/**
 * Where the text to protect sits in a JSON body, written as a path:
 * `messages[].content` is the `content` of every item of `messages`. `[]`
 * after a name walks every item of an array; a dot steps into an object. A
 * path may start with `[]` when the body itself is an array: `[].text`.
 * `*` steps into every key of an object, in order: `*.msg` is the `msg` of
 * each value of `{"u1":{"msg":"a"},"u2":{"msg":"b"}}`, `data.*` is every string
 * directly under `data`, and `*[]` is every key whose value is an array, then
 * each item (`*[].text`). `*` on an array, a string or null reaches nothing.
 * A broad pattern such as `*.*` also reaches ids and can hide them.
 * Only strings are protected — a number, an object or a missing key at the end
 * of a path is left as it is. A string two paths reach is scanned once.
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

/**
 * Throws the TypeError a bad preset or path would throw on the first request,
 * so an adapter can fail when it is created, at server start, instead.
 */
export function checkFields(fields: Preset | readonly FieldPath[] | undefined): void {
  for (const path of pathsOf(fields)) stepsOf(path)
}

interface Step {
  readonly key: string
  readonly each: boolean
  /** `*`: every key of the object, not one named key. */
  readonly any: boolean
}

function stepsOf(path: FieldPath): Step[] {
  return path.split('.').map((part, at) => {
    const each = part.endsWith('[]')
    const key = each ? part.slice(0, -2) : part
    const any = key === '*'
    // Only the first step may have no name: it is the body itself, an array.
    if (key === '' && !(each && at === 0)) {
      throw new TypeError(`empty step in field path "${path}"`)
    }
    return { key: any ? '' : key, each, any }
  })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Calls `visit` with every string the paths reach in `body`, in the order the
 * paths are given and, within one, in document order. `set` writes a new value
 * in its place. `body` must be a copy the caller owns: it is written to.
 * A string is visited once however many paths reach it: it is told apart by
 * where it sits (its parent and its key), not by the path that found it.
 */
export function eachString(
  body: unknown,
  paths: readonly FieldPath[],
  visit: (value: string, set: (next: string) => void) => void,
): void {
  const seen = new WeakMap<object, Set<string>>()
  const first = (holder: object, key: string): boolean => {
    let keys = seen.get(holder)
    if (keys === undefined) seen.set(holder, (keys = new Set()))
    if (keys.has(key)) return false
    keys.add(key)
    return true
  }
  // A path written twice would walk twice for nothing.
  for (const path of new Set(paths)) {
    const steps = stepsOf(path)
    const walk = (node: unknown, at: number): void => {
      const step = steps[at] as Step
      const last = at === steps.length - 1
      const reach = (child: unknown, holder: object, key: string): void => {
        if (last) {
          if (typeof child === 'string' && first(holder, key)) {
            visit(child, (next) => {
              ;(holder as Record<string, unknown>)[key] = next
            })
          }
        } else {
          walk(child, at + 1)
        }
      }
      const from = (holder: object | null, key: string, value: unknown): void => {
        if (step.each) {
          if (!Array.isArray(value)) return
          value.forEach((item, i) => {
            if (isObject(item) && SKIPPED_ROLES.has(item.role)) return
            reach(item, value, String(i))
          })
        } else {
          reach(value, holder as object, key)
        }
      }
      if (step.any) {
        if (!isObject(node)) return
        for (const key of Object.keys(node)) from(node, key, node[key])
      } else if (step.key === '') {
        from(null, '', node)
      } else if (isObject(node)) {
        from(node, step.key, node[step.key])
      }
    }
    walk(body, 0)
  }
}
