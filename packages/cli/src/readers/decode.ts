import { createReadStream } from 'node:fs'
import { TextDecoder } from 'node:util'

/** A file the scan cannot read at all. Its message names the problem, never the content. */
export class InputError extends Error {
  override readonly name = 'InputError'
}

/**
 * The file as text, chunk by chunk, so a transcript larger than memory still scans.
 *
 * Decoding is strict. A file in the wrong encoding would otherwise decode to
 * replacement characters: the digits survive, the Thai cue words around them
 * do not, and a bank account that needs "เลขบัญชี" next to it to be found is
 * missed with nothing to say why. Thai Excel saves "CSV" as windows-874, so
 * that is the one the error suggests.
 *
 * A UTF-8 BOM, which Excel writes at the start of "CSV UTF-8", is dropped by
 * the decoder.
 */
export async function* decodedChunks(path: string, encoding: string): AsyncGenerator<string> {
  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(encoding, { fatal: true })
  } catch {
    throw new InputError(`unknown encoding: ${encoding}`)
  }
  const wrong = () =>
    new InputError(
      `${path} is not valid ${encoding}` +
        (encoding.toLowerCase().replace('-', '') === 'utf8'
          ? ' — a CSV saved by Thai Excel is usually windows-874: try --encoding windows-874'
          : ''),
    )
  for await (const chunk of createReadStream(path)) {
    let text: string
    try {
      text = decoder.decode(chunk as Uint8Array, { stream: true })
    } catch {
      throw wrong()
    }
    if (text !== '') yield text
  }
  let tail: string
  try {
    tail = decoder.decode()
  } catch {
    throw wrong()
  }
  if (tail !== '') yield tail
}

/** Lines of text with their 1-based numbers. `\r\n` and `\n` both end a line. */
export async function* lines(chunks: AsyncIterable<string>): AsyncGenerator<[number, string]> {
  let pending = ''
  let line = 0
  for await (const chunk of chunks) {
    pending += chunk
    let start = 0
    let nl = pending.indexOf('\n', start)
    while (nl !== -1) {
      const end = nl > start && pending.charCodeAt(nl - 1) === 13 ? nl - 1 : nl
      yield [++line, pending.slice(start, end)]
      start = nl + 1
      nl = pending.indexOf('\n', start)
    }
    pending = pending.slice(start)
  }
  if (pending !== '') yield [++line, pending.endsWith('\r') ? pending.slice(0, -1) : pending]
}
