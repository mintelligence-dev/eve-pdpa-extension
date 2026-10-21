/**
 * guardModel: masks the whole prompt on its way to the model provider — the
 * customer's messages, tool results, connection results, recalled memory,
 * instructions — at core's `prompt` boundary. The last line before data
 * leaves for the provider, for everything the other layers did not see.
 */
import type { Guard } from '@eve-pdpa-extension/core'
import { gateway, type LanguageModel, type LanguageModelMiddleware, wrapLanguageModel } from 'ai'
import { checkGuard } from './content.js'
import { checkSessionKey } from './session.js'
import { storedPdpaSessionId } from './session-state.js'

export interface GuardModelOptions {
  readonly guard: Guard
  readonly sessionKey: string
}

type Params = Parameters<NonNullable<LanguageModelMiddleware['transformParams']>>[0]['params']
type Prompt = Params['prompt']
type Message = Prompt[number]

/** A prompt string the policy blocks still has to say something to the model. */
const WITHHELD = '[ข้อมูลที่ปิดไว้]'

/**
 * Used when no pdpa session id is stored: a model call outside a turn, or an
 * agent without pdpaHook. Tokens issued under it can be resolved by nothing,
 * which is the safe way to be wrong.
 */
const UNBOUND = 'eve_unbound'

type Protect = (text: string) => Promise<string>

function walkJson(value: unknown, protect: Protect): Promise<unknown> {
  if (typeof value === 'string') return protect(value)
  if (Array.isArray(value)) return Promise.all(value.map((v) => walkJson(v, protect)))
  if (typeof value === 'object' && value !== null) {
    return Promise.all(
      Object.entries(value).map(async ([k, v]) => [k, await walkJson(v, protect)] as const),
    ).then(Object.fromEntries)
  }
  return Promise.resolve(value)
}

/** A JSON value scanned as one text, so cue words in keys count; leaf by leaf if that breaks it. */
async function protectJson(value: unknown, protect: Protect): Promise<unknown> {
  const text = JSON.stringify(value)
  if (text === undefined) return value
  const out = await protect(text)
  if (out === WITHHELD) return WITHHELD
  try {
    return JSON.parse(out)
  } catch {
    return walkJson(value, protect)
  }
}

async function protectMessage(message: Message, protect: Protect): Promise<Message> {
  if (message.role === 'system') return { ...message, content: await protect(message.content) }
  const content = await Promise.all(
    (message.content as readonly { type: string }[]).map(async (part): Promise<unknown> => {
      const p = part as Record<string, unknown>
      switch (part.type) {
        case 'text':
        case 'reasoning':
          return { ...p, text: await protect(p.text as string) }
        case 'tool-result': {
          const output = p.output as { type: string; value?: unknown; reason?: string }
          switch (output.type) {
            case 'text':
            case 'error-text':
              return { ...p, output: { ...output, value: await protect(output.value as string) } }
            case 'json':
            case 'error-json':
              return {
                ...p,
                output: { ...output, value: await protectJson(output.value, protect) },
              }
            case 'execution-denied':
              return output.reason === undefined
                ? p
                : { ...p, output: { ...output, reason: await protect(output.reason) } }
            case 'content':
              return {
                ...p,
                output: {
                  ...output,
                  value: await Promise.all(
                    (output.value as { type: string; text?: string }[]).map(async (item) =>
                      item.type === 'text'
                        ? { ...item, text: await protect(item.text ?? '') }
                        : item,
                    ),
                  ),
                },
              }
            default:
              return p
          }
        }
        // Files, tool calls (the model's own words, already masked) and the rest pass as they are.
        default:
          return p
      }
    }),
  )
  return { ...message, content } as Message
}

/**
 * `model` with every text of every prompt put through the guard first. Takes
 * an AI SDK model, or a gateway id such as `"anthropic/claude-opus-5.5"`,
 * which goes through the Vercel AI Gateway provider as eve would route it.
 *
 *   defineAgent({ model: guardModel('anthropic/claude-opus-5.5', { guard, sessionKey }) })
 *
 * Wrap a subagent's model, and a separate compaction model, the same way:
 * each is its own call to a provider. The model's output is not masked here.
 */
export function guardModel(model: LanguageModel, options: GuardModelOptions): LanguageModel {
  checkGuard(options?.guard)
  checkSessionKey(options.sessionKey)
  const { guard } = options
  const base = typeof model === 'string' ? gateway(model) : model

  const middleware: LanguageModelMiddleware = {
    specificationVersion: 'v4',
    async transformParams({ params }) {
      const sessionId = storedPdpaSessionId() ?? UNBOUND
      const protect: Protect = async (text) => {
        if (text.length === 0) return text
        const out = await guard.process(text, { sessionId, boundary: 'prompt' })
        return out.outcome === 'blocked' ? WITHHELD : out.text
      }
      // In order: core chains audit events, and a prompt reads top to bottom.
      const prompt: Message[] = []
      for (const message of params.prompt) prompt.push(await protectMessage(message, protect))
      return { ...params, prompt }
    },
  }
  return wrapLanguageModel({
    model: base as Parameters<typeof wrapLanguageModel>[0]['model'],
    middleware,
  })
}
