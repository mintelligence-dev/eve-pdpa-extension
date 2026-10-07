import type { ReadItem } from '../scan.js'
import { decodedChunks, lines } from './decode.js'

export interface JsonlOptions {
  /** Field holding the message text. */
  readonly textField: string
  /** Field holding the app's own message id, reported instead of the text. */
  readonly idField: string
  readonly encoding: string
}

/**
 * One message per line, as most chat exports and log pipelines write them.
 *
 * A line that cannot be read is reported by number and a reason only — never
 * its content, which is exactly the data being looked for.
 */
export async function* readJsonl(path: string, opts: JsonlOptions): AsyncGenerator<ReadItem> {
  for await (const [line, text] of lines(decodedChunks(path, opts.encoding))) {
    if (text.trim() === '') continue

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      yield { kind: 'bad', line, problem: 'not valid JSON' }
      continue
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      yield { kind: 'bad', line, problem: 'not a JSON object' }
      continue
    }
    const record = parsed as Record<string, unknown>
    const message = record[opts.textField]
    if (typeof message !== 'string') {
      yield { kind: 'bad', line, problem: `no string field "${opts.textField}"` }
      continue
    }
    const id = record[opts.idField]
    yield {
      kind: 'record',
      line,
      id: typeof id === 'string' || typeof id === 'number' ? String(id) : null,
      text: message,
    }
  }
}
