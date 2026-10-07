import type { ReadItem } from '../scan.js'
import { decodedChunks, InputError } from './decode.js'

export interface CsvOptions {
  /** Column holding the message text, by its header name. */
  readonly textField: string
  /** Column holding the app's own message id. Optional unless `idRequired`. */
  readonly idField: string
  /** The user named the id column, so its absence is an error rather than "no ids". */
  readonly idRequired: boolean
  readonly delimiter: ',' | '\t'
  readonly encoding: string
}

interface Row {
  /** Line the row starts on: a quoted field can run over several. */
  readonly line: number
  readonly fields: readonly string[]
  /** The file ended inside a quoted field. */
  readonly unclosed?: true
}

/**
 * RFC 4180 rows, as Excel, Google Sheets and most exports write them: quoted
 * fields may hold the delimiter, line breaks and doubled quotes. A quote in
 * the middle of an unquoted field is kept as a character, as Excel does.
 *
 * Written here rather than taken from a package: it is small, and every
 * dependency of a tool that reads customer data is one more thing to audit.
 */
async function* rows(chunks: AsyncIterable<string>, delimiter: string): AsyncGenerator<Row> {
  let fields: string[] = []
  let field = ''
  let quoted = false
  // Just saw a quote inside a quoted field: either an escaped quote or the end.
  let quoteSeen = false
  let atFieldStart = true
  let line = 1
  let rowLine = 1

  for await (const chunk of chunks) {
    const done: Row[] = []
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i] as string
      if (quoted) {
        if (quoteSeen) {
          quoteSeen = false
          if (ch === '"') {
            field += '"'
            continue
          }
          quoted = false
          // The closing quote is behind us; read ch as unquoted text below.
        } else if (ch === '"') {
          quoteSeen = true
          continue
        } else {
          if (ch === '\n') line++
          field += ch
          continue
        }
      }
      if (ch === '"' && atFieldStart) {
        quoted = true
        atFieldStart = false
      } else if (ch === delimiter) {
        fields.push(field)
        field = ''
        atFieldStart = true
      } else if (ch === '\n') {
        fields.push(field)
        done.push({ line: rowLine, fields })
        fields = []
        field = ''
        atFieldStart = true
        rowLine = ++line
      } else if (ch !== '\r') {
        field += ch
        atFieldStart = false
      }
    }
    yield* done
  }

  if (quoted && !quoteSeen) {
    yield { line: rowLine, fields: [], unclosed: true }
  } else if (fields.length > 0 || field !== '' || !atFieldStart) {
    fields.push(field)
    yield { line: rowLine, fields }
  }
}

/** A row that is only a line break, or a run of empty fields from a spreadsheet's trailing rows. */
const isBlank = (fields: readonly string[]) => fields.every((f) => f.trim() === '')

/**
 * One message per row, found by header name.
 *
 * The header is required: guessing a column by position would scan the wrong
 * one silently. A row whose field count differs from the header's is reported
 * and skipped rather than read, because a stray delimiter shifts every column
 * after it and the text column would then hold something else.
 */
export async function* readCsv(path: string, opts: CsvOptions): AsyncGenerator<ReadItem> {
  let textAt = -1
  let idAt = -1
  let width = 0
  let header = true

  for await (const row of rows(decodedChunks(path, opts.encoding), opts.delimiter)) {
    if (row.unclosed === true) {
      yield { kind: 'bad', line: row.line, problem: 'quoted field never closed' }
      continue
    }
    if (isBlank(row.fields)) continue

    if (header) {
      header = false
      const names = row.fields.map((f) => f.trim())
      textAt = names.indexOf(opts.textField)
      idAt = names.indexOf(opts.idField)
      width = names.length
      // Header names are column labels, not customer data, so listing them is safe.
      if (textAt === -1) {
        throw new InputError(
          `no column "${opts.textField}" in the header — columns are: ${names.join(', ')} (choose one with --text-field)`,
        )
      }
      if (idAt === -1 && opts.idRequired) {
        throw new InputError(
          `no column "${opts.idField}" in the header — columns are: ${names.join(', ')}`,
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
    const id = idAt === -1 ? '' : (row.fields[idAt] as string).trim()
    yield {
      kind: 'record',
      line: row.line,
      id: id === '' ? null : id,
      text: row.fields[textAt] as string,
    }
  }

  if (header) throw new InputError('the file is empty — a CSV needs a header row')
}
