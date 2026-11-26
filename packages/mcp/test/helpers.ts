import {
  type AuditRecord,
  createGuard,
  definePolicy,
  type Guard,
  type PolicyInput,
} from '@eve-pdpa-extension/core'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { defaultPolicy } from '../src/policy.js'
import { createPdpaServer } from '../src/server.js'

// Synthetic values only, as in every other package's tests.
export const PHONE = '0812345678'
export const EMAIL = 'somchai@example.com'
export const CARD = '4111 1111 1111 1111'

/** A guard and the audit events it wrote. Default policy unless entities are given. */
export function build(entities?: PolicyInput['entities']): {
  guard: Guard
  events: AuditRecord[]
} {
  const events: AuditRecord[] = []
  const policy =
    entities === undefined ? defaultPolicy() : definePolicy({ entitySet: '0.1', entities })
  return { guard: createGuard({ policy, onAudit: (e) => events.push(e) }), events }
}

/** The official MCP client, connected in memory to a server around `guard`. */
export async function connect(guard: Guard): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await createPdpaServer({ guard, version: '0.0.0-test' }).connect(serverSide)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientSide)
  return client
}

/** The text of a tool result's first content block. */
export function textOf(result: { content?: unknown }): string {
  const block = (result.content as { type: string; text?: string }[] | undefined)?.[0]
  return block?.type === 'text' ? (block.text ?? '') : ''
}
