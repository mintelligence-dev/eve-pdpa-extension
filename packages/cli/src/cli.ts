import { access, readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { parseArgs } from 'node:util'
import { type CompiledPolicy, PdpaError, parsePolicy, VERSION } from '@thai-pdpa-guard/core'
import { readCsv } from './readers/csv.js'
import { readJsonl } from './readers/jsonl.js'
import { formatHuman } from './report.js'
import { type Format, type ReadItem, scan } from './scan.js'

/**
 * Exit codes, so a script or CI job can branch without reading the report:
 *
 *   0  every message read, nothing found
 *   1  personal data found
 *   2  could not run: bad arguments, missing file, invalid policy
 *   3  nothing found, but some lines could not be read — "nothing found" must
 *      not be readable as "nothing there"
 */
export const EXIT = { CLEAN: 0, FOUND: 1, USAGE: 2, UNREADABLE: 3 } as const

const USAGE = `thai-pdpa-guard ${VERSION}

Find Thai personal data in chat exports before they reach an AI model.

Usage:
  thai-pdpa-guard scan <file> [options]

Options:
  --policy <file>       Also show what this policy would do with each value
  --json                Machine-readable report on stdout
  --format <fmt>        jsonl, csv or tsv (default: from the file extension)
  --text-field <name>   Field or column holding the message (default: text)
  --id-field <name>     Field or column holding the message id (default: id)
  --encoding <name>     File encoding (default: utf-8). A CSV saved by Thai
                        Excel is usually windows-874
  -h, --help
  -v, --version

The report lists types, counts, line numbers and message ids. It never
contains the personal data itself.

Exit codes: 0 nothing found · 1 found · 2 could not run · 3 nothing found
but some lines could not be read.
`

export interface Io {
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
}

const FORMATS: Readonly<Record<string, Format>> = {
  '.jsonl': 'jsonl',
  '.ndjson': 'jsonl',
  '.csv': 'csv',
  '.tsv': 'tsv',
}
const isFormat = (f: string | undefined): f is Format => f === 'jsonl' || f === 'csv' || f === 'tsv'

export async function main(argv: readonly string[], io: Io): Promise<number> {
  let parsed: ReturnType<typeof parse>
  try {
    parsed = parse(argv)
  } catch (error) {
    io.stderr(`${(error as Error).message}\n\n${USAGE}`)
    return EXIT.USAGE
  }
  const { values, positionals } = parsed

  if (values.version === true) {
    io.stdout(`${VERSION}\n`)
    return EXIT.CLEAN
  }
  if (values.help === true || positionals.length === 0) {
    ;(values.help === true ? io.stdout : io.stderr)(USAGE)
    return values.help === true ? EXIT.CLEAN : EXIT.USAGE
  }

  const [command, file, ...rest] = positionals
  if (command !== 'scan') return usageError(io, `unknown command: ${command}`)
  if (file === undefined) return usageError(io, 'scan needs a file')
  if (rest.length > 0) return usageError(io, `scan takes one file, got ${positionals.length - 1}`)

  const format = values.format ?? FORMATS[extname(file).toLowerCase()]
  if (!isFormat(format)) {
    return usageError(
      io,
      values.format === undefined
        ? `cannot tell the format of ${file} — pass --format jsonl, csv or tsv`
        : `unsupported format: ${values.format} (supported: jsonl, csv, tsv)`,
    )
  }

  try {
    await access(file)
  } catch {
    io.stderr(`cannot read ${file}\n`)
    return EXIT.USAGE
  }

  let policy: CompiledPolicy | undefined
  if (values.policy !== undefined) {
    try {
      policy = parsePolicy(await readFile(values.policy, 'utf8'))
    } catch (error) {
      // PdpaError messages name the field, never a value (D2), so they are safe to print.
      const why = error instanceof PdpaError ? error.message : 'cannot read the file'
      io.stderr(`policy ${values.policy}: ${why}\n`)
      return EXIT.USAGE
    }
  }

  let report: Awaited<ReturnType<typeof scan>>
  try {
    report = await scan(reader(file, format, values), {
      file,
      format,
      ...(policy === undefined ? {} : { policy }),
    })
  } catch (error) {
    // Left uncaught, Node would exit 1 — the code that means "found personal data".
    // fs errors name the path; core errors never carry a value.
    io.stderr(`scan stopped: ${(error as Error).message}\n`)
    return EXIT.USAGE
  }

  io.stdout(values.json === true ? `${JSON.stringify(report, null, 2)}\n` : formatHuman(report))

  if (report.records.withFindings > 0) return EXIT.FOUND
  if (report.records.unreadable > 0) return EXIT.UNREADABLE
  return EXIT.CLEAN
}

function parse(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      policy: { type: 'string' },
      json: { type: 'boolean' },
      format: { type: 'string' },
      'text-field': { type: 'string', default: 'text' },
      // No default here: a CSV id column the user named must exist; the default may not.
      'id-field': { type: 'string' },
      encoding: { type: 'string', default: 'utf-8' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })
}

function reader(
  file: string,
  format: Format,
  values: ReturnType<typeof parse>['values'],
): AsyncIterable<ReadItem> {
  const common = {
    textField: values['text-field'],
    idField: values['id-field'] ?? 'id',
    encoding: values.encoding,
  }
  if (format === 'jsonl') return readJsonl(file, common)
  return readCsv(file, {
    ...common,
    idRequired: values['id-field'] !== undefined,
    delimiter: format === 'tsv' ? '\t' : ',',
  })
}

function usageError(io: Io, message: string): number {
  io.stderr(`${message}\n\n${USAGE}`)
  return EXIT.USAGE
}
