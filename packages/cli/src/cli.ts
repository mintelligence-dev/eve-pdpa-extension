import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { parseArgs } from 'node:util'
import { type CompiledPolicy, PdpaError, parsePolicy, VERSION } from '@thai-pdpa-guard/core'
import { readCsv } from './readers/csv.js'
import { InputError } from './readers/decode.js'
import { readJsonl } from './readers/jsonl.js'
import { LINE_OA_TEXT, lineOaLabel, looksLikeLineOa, readLineOa } from './readers/line-oa.js'
import { formatHuman } from './report.js'
import { type Format, type ReadItem, scan } from './scan.js'
import { describePolicy, validatePolicy } from './validate.js'

/**
 * Exit codes, so a script or CI job can branch without reading the report.
 *
 * scan:
 *   0  every message read, nothing found
 *   1  personal data found
 *   2  could not run: bad arguments, missing file, invalid policy
 *   3  nothing found, but some lines could not be read — "nothing found" must
 *      not be readable as "nothing there"
 *
 * policy validate:
 *   0  valid · 1  invalid · 2  could not run
 */
export const EXIT = { CLEAN: 0, FOUND: 1, USAGE: 2, UNREADABLE: 3 } as const

const USAGE = `thai-pdpa-guard ${VERSION}

Find Thai personal data in chat exports before they reach an AI model.

Usage:
  thai-pdpa-guard scan <file> [options]
  thai-pdpa-guard policy validate <file>

scan options:
  --policy <file>       Also show what this policy would do with each value
  --json                Machine-readable report on stdout
  --format <fmt>        jsonl, csv, tsv or line-oa (default: from the file —
                        a LINE OA chat export is recognised by its first line)
  --text-field <name>   Field or column holding the message (default: text;
                        ข้อความ for LINE OA)
  --id-field <name>     Field or column holding the message id (default: id)
  --encoding <name>     File encoding (default: utf-8). A CSV saved by Thai
                        Excel is usually windows-874
  -h, --help
  -v, --version

The report lists types, counts, line numbers and message ids. It never
contains the personal data itself.

scan exit codes: 0 nothing found · 1 found · 2 could not run · 3 nothing
found but some lines could not be read.

policy validate checks a policy file the way createGuard will load it, and
says what it does with each kind of data. Exit codes: 0 valid · 1 invalid ·
2 could not run.
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
const isFormat = (f: string | undefined): f is Format =>
  f === 'jsonl' || f === 'csv' || f === 'tsv' || f === 'line-oa'

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

  const [command, ...args] = positionals
  if (command === 'policy') return policyCommand(args, io)
  if (command !== 'scan') return usageError(io, `unknown command: ${command}`)
  return scanCommand(args, values, io)
}

async function policyCommand(args: readonly string[], io: Io): Promise<number> {
  const [sub, file, ...rest] = args
  if (sub !== 'validate') return usageError(io, `unknown policy command: ${sub ?? '(none)'}`)
  if (file === undefined) return usageError(io, 'policy validate needs a file')
  if (rest.length > 0)
    return usageError(io, `policy validate takes one file, got ${args.length - 1}`)

  let json: string
  try {
    json = await readFile(file, 'utf8')
  } catch {
    io.stderr(`cannot read ${file}\n`)
    return EXIT.USAGE
  }
  const result = validatePolicy(json)
  if (!result.ok) {
    io.stderr(`${file}  invalid\n  ${result.problem}\n`)
    return EXIT.FOUND
  }
  io.stdout(describePolicy(file, result.policy))
  return EXIT.CLEAN
}

async function scanCommand(
  args: readonly string[],
  values: ReturnType<typeof parse>['values'],
  io: Io,
): Promise<number> {
  const [file, ...rest] = args
  if (file === undefined) return usageError(io, 'scan needs a file')
  if (rest.length > 0) return usageError(io, `scan takes one file, got ${args.length}`)

  const named = values.format ?? FORMATS[extname(file).toLowerCase()]
  if (!isFormat(named)) {
    return usageError(
      io,
      values.format === undefined
        ? `cannot tell the format of ${file} — pass --format jsonl, csv, tsv or line-oa`
        : `unsupported format: ${values.format} (supported: jsonl, csv, tsv, line-oa)`,
    )
  }

  let isFile = false
  try {
    isFile = (await stat(file)).isFile()
  } catch {}
  if (!isFile) {
    io.stderr(`cannot read ${file} — not a file\n`)
    return EXIT.USAGE
  }

  // A LINE OA export is a .csv whose first lines describe the file. Read as a
  // plain CSV, its first line would be taken for the header.
  let format: Format = named
  try {
    if (
      named === 'csv' &&
      values.format === undefined &&
      (await looksLikeLineOa(file, values.encoding))
    ) {
      format = 'line-oa'
    }
  } catch (error) {
    // Left uncaught, Node would exit 1 — the code that means "found personal data".
    io.stderr(`cannot read ${file}: ${whyStopped(error)}\n`)
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
      // The export names each file after the customer's LINE name.
      file: format === 'line-oa' ? lineOaLabel(file) : file,
      format,
      ...(policy === undefined ? {} : { policy }),
    })
  } catch (error) {
    // Left uncaught, Node would exit 1 — the code that means "found personal data".
    io.stderr(`scan stopped: ${whyStopped(error)}\n`)
    return EXIT.USAGE
  }

  io.stdout(values.json === true ? `${JSON.stringify(report, null, 2)}\n` : formatHuman(report))

  if (report.records.withFindings > 0) return EXIT.FOUND
  if (report.records.unreadable > 0) return EXIT.UNREADABLE
  return EXIT.CLEAN
}

export const INTERNAL_ERROR = 'internal error'

/**
 * What to print for an error that stopped the scan. Input, fs and core errors
 * are expected and their messages are safe: an InputError names the problem,
 * an fs error the path, and a core error never carries a value (D2). Anything
 * else is a bug here, and its message is not printed — a SyntaxError from
 * JSON.parse, say, quotes the text it choked on.
 */
function whyStopped(error: unknown): string {
  if (
    error instanceof InputError ||
    error instanceof PdpaError ||
    (error instanceof Error && /^E[A-Z]+$/.test(String((error as NodeJS.ErrnoException).code)))
  ) {
    return error.message
  }
  const name = error instanceof Error ? error.name : typeof error
  return `${INTERNAL_ERROR} (${name}) — please report it to the thai-pdpa-guard maintainers`
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
      // Default depends on the format: see reader().
      'text-field': { type: 'string' },
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
  if (format === 'line-oa') {
    return readLineOa(file, {
      textField: values['text-field'] ?? LINE_OA_TEXT,
      encoding: values.encoding,
    })
  }
  const common = {
    textField: values['text-field'] ?? 'text',
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
