import { describe, expect, it } from 'vitest'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import { ENTITY_TYPES } from '../src/types.js'

// One long run of digits and separators, the shape every number in it is read
// in. Asking whether each number was in a link walked the whole run again, and
// the link pattern itself read the run once per position: 100,000 characters
// took 5 to 14 seconds (security review of the MCP server, 26 Nov). Now each
// run is read once.
const LENGTH = 100_000
// Generous: CI runs the suite under coverage, about ten times slower ("1 "
// took 1,640 ms there, 170 ms without). The quadratic version took 4,900 to
// 14,000 ms without coverage.
const LIMIT_MS = 4_000

const RUNS = [
  '1-2345-67890-12-',
  '1-2345-67890-12.',
  '1-1017-00203-45-1-',
  '4111-1111-1111-1111-',
  '4111111111111111/',
  '1 ',
  '1.',
]

const guard = createGuard({
  policy: definePolicy({
    entitySet: '0.1',
    entities: Object.fromEntries(ENTITY_TYPES.map((e) => [e, { action: 'redact' }])),
  }),
  onAudit: () => {},
})

describe(`a text of ${LENGTH.toLocaleString()} characters in one long run`, () => {
  for (const unit of RUNS) {
    it(`${JSON.stringify(unit)} repeated is read in linear time`, () => {
      const text = unit.repeat(Math.ceil(LENGTH / unit.length)).slice(0, LENGTH)
      const t = performance.now()
      guard.processSync(text, { boundary: 'tool_output' })
      expect(performance.now() - t).toBeLessThan(LIMIT_MS)
    })
  }
})
