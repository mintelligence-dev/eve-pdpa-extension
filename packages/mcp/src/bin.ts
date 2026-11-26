#!/usr/bin/env node
// stdout carries the MCP protocol and nothing else: every message for a person
// goes to stderr, and so do audit events unless --audit names a file.
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { prepare } from './cli.js'
import { createPdpaServer } from './server.js'

const prepared = prepare(process.argv.slice(2), {
  env: process.env,
  stderr: (text) => process.stderr.write(text),
})

if (!prepared.ok) {
  // --help and --version are answers a person asked for: stdout, exit 0.
  if (prepared.code === 0) process.stdout.write(prepared.message)
  else process.stderr.write(prepared.message)
  process.exitCode = prepared.code
} else {
  const server = createPdpaServer({ guard: prepared.guard, version: prepared.version })
  await server.connect(new StdioServerTransport())
}
