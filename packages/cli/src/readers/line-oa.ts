import { open } from 'node:fs/promises'
import { basename } from 'node:path'
import { TextDecoder } from 'node:util'
import type { ReadItem, Sender } from '../scan.js'
import { rows } from './csv.js'
import { decodedChunks, InputError } from './decode.js'

/**
 * One customer's chat, as LINE Official Account Manager exports it: a zip of
 * CSV files, one per customer, unzipped by the user. Seen in a Thai-language
 * export (2025-09):
 *
 *   ชื่อบัญชี,<shop>                        ← a few lines about the file
 *   ไทม์โซน,'+09:00
 *   วันดาวน์โหลด,2025/09/09 15:23
 *   ประเภทผู้ส่ง,ชื่อผู้ส่ง,วันส่ง,เวลาส่ง,ข้อความ     ← the header
 *   User,<customer name>,2025/09/09,13:23:47,<message>
 *   Account,<staff name>,2025/09/09,13:24:42,<message>
 *
 * The file name is `<n>_<first day>_<last day>_<customer's LINE name>.csv`.
 * No message id. A manager set to another language writes other headers,
 * which nobody here has seen; --text-field names the message column for those.
 */

/** Header names in a Thai-language export. */
export const LINE_OA_TEXT = 'ข้อความ'
const LINE_OA_SENDER = 'ประเภทผู้ส่ง'
/** First cell of a Thai-language export. */
const LINE_OA_FIRST = 'ชื่อบัญชี'

/** The header comes after a few lines about the file; this many rows is plenty. */
const MAX_PREAMBLE_ROWS = 10

const SENDERS: Readonly<Record<string, Sender>> = { User: 'customer', Account: 'shop' }

/** Enough for the lines about the file and the header, whatever the shop is called. */
const SNIFF_BYTES = 2048

/**
 * True when the file starts the way a Thai-language LINE OA export does: the
 * first line names the account, and the export's header follows within the
 * first few lines. Both, because `ชื่อบัญชี` alone is also a common first
 * column in an ordinary Thai CSV — a list of bank accounts — which must stay
 * an ordinary CSV.
 */
export async function looksLikeLineOa(path: string, encoding: string): Promise<boolean> {
  const handle = await open(path, 'r')
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(SNIFF_BYTES), 0, SNIFF_BYTES, 0)
    let head: string
    try {
      // Not fatal: a character cut off at the last byte must not hide the rest.
      head = new TextDecoder(encoding).decode(buffer.subarray(0, bytesRead))
    } catch {
      return false
    }
    const lines = head.split(/\r?\n/).slice(0, MAX_PREAMBLE_ROWS)
    return (
      lines[0]?.startsWith(`${LINE_OA_FIRST},`) === true &&
      lines.slice(1).some((l) => l.startsWith(`${LINE_OA_SENDER},`))
    )
  } finally {
    await handle.close()
  }
}

/**
 * How the report names the file: the export's own number and dates, never the
 * customer's LINE name that ends it. A name the export did not write is shown
 * as given — the user chose it.
 */
export function lineOaLabel(path: string): string {
  const name = basename(path)
  const m = /^(\d+_\d{8}_\d{8})_/.exec(name)
  return m === null ? path : `${m[1]}_….csv`
}

export interface LineOaOptions {
  readonly textField: string
  readonly encoding: string
}

export async function* readLineOa(path: string, opts: LineOaOptions): AsyncGenerator<ReadItem> {
  let textAt = -1
  let senderAt = -1
  let width = 0
  let seen = 0

  for await (const row of rows(decodedChunks(path, opts.encoding), ',')) {
    if (row.unclosed === true) {
      yield { kind: 'bad', line: row.line, problem: 'quoted field never closed' }
      continue
    }
    if (row.fields.every((f) => f.trim() === '')) continue

    if (textAt === -1) {
      // The rows before the header hold the shop's name and the export's
      // settings, not messages: nothing in them is scanned or reported.
      const names = row.fields.map((f) => f.trim())
      const at = names.indexOf(opts.textField)
      if (at !== -1) {
        textAt = at
        senderAt = names.indexOf(LINE_OA_SENDER)
        width = names.length
      } else if (++seen >= MAX_PREAMBLE_ROWS) {
        throw new InputError(
          `no "${opts.textField}" column in the first ${MAX_PREAMBLE_ROWS} rows — ` +
            'if LINE OA Manager is set to another language, pass the message column with --text-field',
        )
      }
      continue
    }

    if (row.fields.length !== width) {
      yield {
        kind: 'bad',
        line: row.line,
        problem: `${row.fields.length} fields, header has ${width}`,
      }
      continue
    }
    const sender = senderAt === -1 ? undefined : SENDERS[(row.fields[senderAt] as string).trim()]
    yield {
      kind: 'record',
      line: row.line,
      id: null,
      text: row.fields[textAt] as string,
      ...(sender === undefined ? {} : { sender }),
    }
  }

  if (textAt === -1) throw new InputError(`no "${opts.textField}" column — the file has no header`)
}
