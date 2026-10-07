import { describe, expect, it } from 'vitest'
import { BUILTIN_DETECTORS } from '../src/detectors/index.js'
import { createEngine } from '../src/engine.js'
import { createGuard } from '../src/guard.js'
import { normalise } from '../src/normalise.js'
import { definePolicy } from '../src/policy.js'

/**
 * One message with tens of thousands of values: a tool returning a customer
 * list, or someone feeding the guard a long message to slow it down.
 *
 * Merging overlaps and rewriting the text both used to cost time in the square
 * of the value count — 5 s for 40,000 phone numbers (found by fuzzing the CLI,
 * 7 Oct). Both are linear now, about 60 ms. The limit is far from either so a
 * slow machine does not fail it, and a return to quadratic does.
 */
const COUNT = 40_000
const TEXT = 'เบอร์ 0918887777 '.repeat(COUNT)
const LIMIT_MS = 2000

describe(`a message with ${COUNT.toLocaleString()} values`, () => {
  it('is merged by the engine in linear time', () => {
    const engine = createEngine(BUILTIN_DETECTORS)
    const t = performance.now()
    const r = engine.runSync(normalise(TEXT), { sessionId: 's', boundary: 'tool_output' })
    expect(performance.now() - t).toBeLessThan(LIMIT_MS)
    expect(r.candidates).toHaveLength(COUNT)
  })

  for (const action of ['redact', 'mask'] as const) {
    it(`is rewritten in linear time under ${action}, every value replaced`, () => {
      const guard = createGuard({
        policy: definePolicy({ entitySet: '0.1', entities: { PHONE: { action } } }),
        onAudit: () => {},
      })
      const t = performance.now()
      const r = guard.processSync(TEXT, { boundary: 'tool_output' })
      expect(performance.now() - t).toBeLessThan(LIMIT_MS)
      expect(r.findings).toHaveLength(COUNT)
      expect(r.text).not.toContain('0918887777')
      expect(
        r.text.startsWith(action === 'redact' ? 'เบอร์ [เบอร์โทร] เบอร์ ' : 'เบอร์ xxxxxxxxxx '),
      ).toBe(true)
    })
  }
})
