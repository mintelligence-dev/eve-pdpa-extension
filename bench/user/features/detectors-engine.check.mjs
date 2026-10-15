// DE — the detector and engine API from the types: built-in set, custom detectors, async and
// failing detectors, createEngine, DetectContext.previous, the checksum helpers.
//   bench/user/run features/detectors-engine.check.mjs
import assert from 'node:assert/strict'
import {
  BUILTIN_DETECTORS,
  bankAccountDetector,
  createEngine,
  creditCardDetector,
  ENTITY_TYPES,
  emailDetector,
  isValidLuhn,
  isValidThaiNationalId,
  lineUserIdDetector,
  normalise,
  phoneDetector,
  thaiNationalIdDetector,
} from '@thai-pdpa-guard/core'
import { allRules, check, makeGuard } from '../lib/kit.mjs'

const ctx = { sessionId: 's', boundary: 'inbound' }

check('DE1 BUILTIN_DETECTORS: six detectors with unique ids, covering exactly ENTITY_TYPES', () => {
  assert.equal(BUILTIN_DETECTORS.length, 6)
  assert.equal(new Set(BUILTIN_DETECTORS.map((d) => d.id)).size, 6)
  assert.deepEqual(
    [...new Set(BUILTIN_DETECTORS.flatMap((d) => d.entities))].sort(),
    [...ENTITY_TYPES].sort(),
  )
})

check(
  'DE2 each exported detector has id, entities and detect(normalise(text), ctx) → candidates',
  () => {
    const cases = [
      [phoneDetector, 'เบอร์ 091-888-7777', 'PHONE'],
      [emailDetector, 'เมล a.b@gmail.com', 'EMAIL'],
      [bankAccountDetector, 'เลขบัญชี 123-4-56789-0', 'BANK_ACCOUNT'],
      [creditCardDetector, 'บัตร 4111 1111 1111 1111', 'CREDIT_CARD'],
      [lineUserIdDetector, 'U4af4980629f1ae0b2b5c2f7a7b2e9c3d', 'LINE_USER_ID'],
      [thaiNationalIdDetector, 'เลขบัตร 1-1037-02071-81-1', 'TH_NATIONAL_ID'],
    ]
    for (const [d, text, entity] of cases) {
      assert.equal(typeof d.id, 'string')
      assert.ok(d.entities.includes(entity))
      const out = d.detect(normalise(text), ctx)
      assert.ok(Array.isArray(out) && out.length === 1, `${d.id}: ${JSON.stringify(out)}`)
      const c = out[0]
      assert.equal(c.entity, entity)
      assert.equal(c.detector, d.id)
      assert.ok(c.start >= 0 && c.end > c.start && c.confidence > 0 && c.confidence <= 1)
    }
  },
)

check('DE3 detectors: [] detects nothing and says so in entitiesSupported', () => {
  const { guard, scans } = makeGuard(
    { entities: allRules({ action: 'redact' }) },
    { detectors: [] },
  )
  assert.equal(guard.processSync('เบอร์ 0918887777').text, 'เบอร์ 0918887777')
  assert.deepEqual(scans()[0].engine.entitiesSupported, [])
  assert.deepEqual(scans()[0].engine.detectors, [])
})

check('DE4 detectors: [phoneDetector] looks for phones only', () => {
  const { guard, scans } = makeGuard(
    { entities: allRules({ action: 'redact' }) },
    { detectors: [phoneDetector] },
  )
  assert.equal(guard.processSync('เบอร์ 0918887777 เมล a@b.co').text, 'เบอร์ [เบอร์โทร] เมล a@b.co')
  assert.deepEqual(scans()[0].engine.entitiesSupported, ['PHONE'])
})

check(
  'DE5 an async detector is skipped by processSync (skippedDetectors) and run by process',
  async () => {
    const shopId = {
      id: 'shop-member-no',
      entities: ['PHONE'],
      detect: async (input) => {
        const i = input.text.indexOf('MB-')
        return i < 0
          ? []
          : [
              {
                entity: 'PHONE',
                start: i,
                end: i + 11,
                confidence: 0.99,
                detector: 'shop-member-no',
              },
            ]
      },
    }
    const { guard, scans } = makeGuard(
      { entities: allRules({ action: 'redact' }) },
      { detectors: [...BUILTIN_DETECTORS, shopId] },
    )
    const a = guard.processSync('รหัส MB-00918273')
    assert.deepEqual(a.skippedDetectors, ['shop-member-no'])
    assert.deepEqual(scans()[0].skippedDetectors, ['shop-member-no'])
    assert.equal(a.text, 'รหัส MB-00918273')
    const b = await guard.process('รหัส MB-00918273')
    assert.deepEqual(b.skippedDetectors, [])
    assert.equal(b.text, 'รหัส [เบอร์โทร]')
  },
)

check('DE6 a detector that throws is listed in degradedDetectors and the scan goes on', () => {
  const broken = {
    id: 'broken',
    entities: ['EMAIL'],
    detect() {
      throw new Error('regex blew up on 0918887777')
    },
  }
  const { guard, scans } = makeGuard(
    { entities: allRules({ action: 'redact' }) },
    { detectors: [...BUILTIN_DETECTORS, broken] },
  )
  const r = guard.processSync('เบอร์ 0918887777')
  assert.equal(r.text, 'เบอร์ [เบอร์โทร]')
  assert.deepEqual(scans()[0].degradedDetectors, ['broken'])
  assert.ok(
    !JSON.stringify(scans()[0]).includes('0918887777'),
    'the detector error text reached audit',
  )
})

check(
  'DE7 createEngine: detectorIds, entitiesSupported, runSync → ordered non-overlapping candidates and raw',
  () => {
    const engine = createEngine(BUILTIN_DETECTORS)
    assert.deepEqual(
      engine.detectorIds,
      BUILTIN_DETECTORS.map((d) => d.id),
    )
    assert.deepEqual([...engine.entitiesSupported].sort(), [...ENTITY_TYPES].sort())
    const res = engine.runSync(
      normalise('เมล 0918887777@gmail.com และ ID 1-1037-02071-81-1 โทร 02-123-4567'),
      ctx,
    )
    assert.ok(res.raw.length >= res.candidates.length)
    for (let i = 1; i < res.candidates.length; i++)
      assert.ok(res.candidates[i - 1].end <= res.candidates[i].start, 'ordered, non-overlapping')
    const email = res.candidates.find((c) => c.entity === 'EMAIL')
    assert.ok(email, 'the longest (the email) wins over the phone inside it')
    assert.deepEqual(res.degradedDetectors, [])
    assert.deepEqual(res.skippedDetectors, [])
  },
)

check(
  'DE8 DetectContext.previous is the context, lower-cased; sessionId and boundary are passed',
  () => {
    let seen
    const spy = {
      id: 'spy',
      entities: ['EMAIL'],
      detect(_input, c) {
        seen = c
        return []
      },
    }
    const { guard } = makeGuard({ entities: allRules({ action: 'redact' }) }, { detectors: [spy] })
    guard.processSync('x', { sessionId: 'S1', boundary: 'tool_output', context: 'ขอ E-MAIL หน่อย' })
    assert.deepEqual(
      { ...seen },
      { sessionId: 'S1', boundary: 'tool_output', previous: 'ขอ e-mail หน่อย' },
    )
  },
)

check('DE9 isValidLuhn and isValidThaiNationalId, incl. the documented digit-3 property', () => {
  assert.equal(isValidLuhn('4111111111111111'), true)
  assert.equal(isValidLuhn('4111111111111112'), false)
  assert.equal(isValidThaiNationalId('1103702071811'), true)
  assert.equal(isValidThaiNationalId('1103702071812'), false)
  // "digit 3 carries weight 11, and 11 mod 11 is 0, so an error in that one position is never detected"
  assert.equal(isValidThaiNationalId('1173702071811'), true)
})
