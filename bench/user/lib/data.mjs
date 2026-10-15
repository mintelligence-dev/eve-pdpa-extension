// Loads the benchmark conversations and turns the inline markup into plain text + labels.
//
//   [[PHONE:081-234-5678]]   personal data of that entity
//   [[~ORDER:SO2510-0042]]   a look-alike that is NOT personal data (decoy)
import { existsSync, readdirSync, readFileSync } from 'node:fs'

export const ENTITIES = [
  'TH_NATIONAL_ID',
  'PHONE',
  'EMAIL',
  'BANK_ACCOUNT',
  'CREDIT_CARD',
  'LINE_USER_ID',
]
const MARK = /\[\[(~?)([A-Z_]+):([\s\S]*?)\]\]/g

/** Strips the markup. Labels carry [start, end) into the plain text, in UTF-16 units. */
export function parseMarked(marked) {
  let plain = ''
  let last = 0
  const labels = []
  for (const m of marked.matchAll(MARK)) {
    plain += marked.slice(last, m.index)
    const start = plain.length
    plain += m[3]
    labels.push({ decoy: m[1] === '~', type: m[2], value: m[3], start, end: plain.length })
    last = m.index + m[0].length
  }
  plain += marked.slice(last)
  if (plain.includes('[[') && /\[\[~?[A-Z_]+:/.test(plain))
    throw new Error(`unclosed markup in: ${marked.slice(0, 80)}`)
  return { plain, labels }
}

/** The other side for context: customer ↔ shop; a tool's other side is the last message not from a tool. */
function otherSide(from) {
  if (from === 'customer') return (t) => t.from === 'shop'
  if (from === 'shop') return (t) => t.from === 'customer'
  return (t) => t.from !== 'tool'
}
export const BOUNDARY = { customer: 'inbound', shop: 'outbound', tool: 'tool_output' }

/** Every message of a set, with its plain text, labels, boundary and context. */
export function loadSet(set) {
  const dir = `data/${set}`
  if (!existsSync(dir)) return []
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
  const conversations = []
  for (const file of files) {
    const json = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'))
    for (const conv of json.conversations) {
      const turns = conv.turns.map((t, i) => {
        if (!['customer', 'shop', 'tool'].includes(t.from))
          throw new Error(`${conv.id} turn ${i}: from must be customer|shop|tool`)
        const { plain, labels } = parseMarked(t.text)
        return { index: i, from: t.from, marked: t.text, plain, labels, boundary: BOUNDARY[t.from] }
      })
      for (const t of turns) {
        const isOther = otherSide(t.from)
        const prev = turns.slice(0, t.index).reverse().find(isOther)
        t.context = prev ? prev.plain : undefined
      }
      conversations.push({
        id: conv.id,
        topic: file.replace(/\.json$/, ''),
        file: `${dir}/${file}`,
        turns,
      })
    }
  }
  return conversations
}
