import type { Guard, ProcessResult } from '@eve-pdpa-extension/core'
import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { blockedMessage, MAX_TEXT, redactOutput, scanOutput } from './tools.js'

export interface PdpaServerOptions {
  /** A guard from createGuard. Its policy decides what pdpa_redact hides and how. */
  readonly guard: Guard
  /** Reported to the client in initialize. */
  readonly version?: string
}

const input = z.object({
  text: z.string().max(MAX_TEXT).describe('The text to check.'),
  context: z
    .string()
    .max(MAX_TEXT)
    .optional()
    .describe(
      'Optional: the message just before this one, such as the question a bot asked ("ขอเลขบัญชีค่ะ"). Read for cue words only, so a bare reply like "123-4-56789-0" is still found. Never returned.',
    ),
})

const entityCounts = z.record(z.string(), z.number())

const scanSchema = z.object({
  found: z.number(),
  byType: entityCounts,
  findings: z.array(
    z.object({
      entity: z.string(),
      start: z.number(),
      end: z.number(),
      confidence: z.number(),
      action: z.string(),
    }),
  ),
})

const redactSchema = z.object({ text: z.string(), byType: entityCounts })

/** Every tool here only reads what it is given and calls nothing outside. */
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

/**
 * Anything that goes wrong inside the guard. The SDK would pass an error's own
 * message to the client; this one says nothing about the text, whatever threw.
 */
const failed = {
  content: [{ type: 'text' as const, text: 'pdpa: the text could not be checked' }],
  isError: true,
}

/**
 * An MCP server with pdpa_scan and pdpa_redact, not yet connected. bin.ts
 * connects it to stdio; a host that runs its own transport can connect it to
 * that instead.
 */
export function createPdpaServer(options: PdpaServerOptions): McpServer {
  const { guard } = options
  const server = new McpServer({ name: 'eve-pdpa', version: options.version ?? '0.0.0' })

  const run = async (text: string, context: string | undefined): Promise<ProcessResult> =>
    guard.process(text, context === undefined ? {} : { context })

  server.registerTool(
    'pdpa_scan',
    {
      title: 'Find Thai personal data',
      description:
        'Finds Thai personal data in a text — national ID, phone, email, bank account, card, LINE user ID, licence plate, date of birth, passport — and says what each is and where it is (start and end, counted in characters of the text sent). Never returns the values or the text. `action` is what the server’s policy would do with each.',
      inputSchema: input,
      outputSchema: scanSchema,
      annotations,
    },
    async ({ text, context }) => {
      try {
        const output = scanOutput(await run(text, context))
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch {
        return failed
      }
    },
  )

  server.registerTool(
    'pdpa_redact',
    {
      title: 'Hide Thai personal data',
      description:
        'Returns the text with Thai personal data hidden, as the server’s policy says (by default every value is replaced by a label such as [เบอร์โทร]). Call it before passing customer text on — to a log, a ticket, a chat or another tool. If the policy blocks a type, no text comes back: the result is an error naming the types.',
      inputSchema: input,
      outputSchema: redactSchema,
      annotations,
    },
    async ({ text, context }) => {
      let result: ProcessResult
      try {
        result = await run(text, context)
      } catch {
        return failed
      }
      if (result.outcome === 'blocked') {
        const blockedBy = result.blockedBy ?? []
        return {
          content: [{ type: 'text', text: blockedMessage(blockedBy) }],
          structuredContent: { blockedBy: [...blockedBy] },
          isError: true,
        }
      }
      const output = redactOutput(result)
      return { content: [{ type: 'text', text: output.text }], structuredContent: output }
    },
  )

  return server
}
