// AU — audit events: one per call, the shipped schema, and no raw value anywhere.
//   bench/user/run features/audit.check.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ACTIONS,
  BUILTIN_DETECTORS,
  createMemoryTokenStore,
  ENTITY_TYPES,
  parsePolicy,
  VERSION,
} from '@thai-pdpa-guard/core'
import { loadSet } from '../lib/data.mjs'
import { allRules, check, makeGuard, schemaErrors, sleep, strings } from '../lib/kit.mjs'
import { onlyDigits, phoneNational } from '../lib/values.mjs'

const TOK = /\[tok:([bcdfghjkmnpqrstv]{16})\]/g

check(
  'AU1 policy.loaded is emitted once, at createGuard, before any scan, with the full rules',
  () => {
    const { guard, events } = makeGuard(
      parsePolicy(readFileSync('policies/readme-example.json', 'utf8')),
    )
    assert.equal(events.length, 1)
    assert.equal(events[0].type, 'policy.loaded')
    assert.deepEqual(
      events[0].policy.entities,
      JSON.parse(readFileSync('policies/readme-example.json', 'utf8')).entities,
    )
    assert.equal(events[0].policy.onUnmapped, 'redact')
    assert.equal(events[0].policy.placeholderLanguage, 'th')
    guard.processSync('เบอร์ 0918887777', { sessionId: 's' })
    assert.equal(events.filter((e) => e.type === 'policy.loaded').length, 1)
  },
)

check('AU2 one scan event per process/processSync call, also when nothing is found', async () => {
  const { guard, scans } = makeGuard({ entities: allRules({ action: 'redact' }) })
  guard.processSync('สวัสดีค่ะ')
  await guard.process('เบอร์ 0918887777')
  guard.processSync('')
  await guard.process('ขอบคุณค่ะ', { boundary: 'outbound' })
  assert.equal(scans().length, 4)
})

/** Exercises every event variant the docs describe, and returns all events. */
async function everyVariant() {
  const all = []
  const keep = (x) => all.push(...x.events)
  // tokenise, allowlist, unmapped, block, context, ref, every boundary, rendered of each kind, resolve reasons
  const a = makeGuard({
    entities: {
      PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'], ttlSec: 1 },
      EMAIL: { action: 'hash' },
      CREDIT_CARD: { action: 'block' },
    },
    allowlist: { exact: ['02-123-4567'], pattern: ['.*@myshop\\.co\\.th'] },
  })
  const g = a.guard
  const t1 = g
    .processSync('เบอร์ 0918887777 ร้าน 02-123-4567 เมล a@b.co', {
      sessionId: 's1',
      ref: 'm1',
      context: 'ขอเบอร์ค่ะ',
    })
    .text.match(TOK)[0]
  const t2 = g.processSync('อีกเบอร์ 0811111111', { sessionId: 's2' }).text.match(TOK)[0]
  g.processSync('ID 1-1037-02071-81-1', { sessionId: 's1' }) // unmapped → redact
  g.processSync('บัตร 4111 1111 1111 1111', { sessionId: 's1' }) // blocked
  for (const boundary of ['prompt', 'tool_input', 'tool_output'])
    g.processSync(`x ${t1}`, { sessionId: 's1', boundary })
  const hashed = g.processSync('เมล somchai@gmail.com', { sessionId: 's1' }).text.slice(4)
  g.processSync(`${t1} ${t2} [tok:bbbbbbbbbbbbbbbb] ${hashed}`, {
    sessionId: 's1',
    boundary: 'outbound',
  })
  await g.resolve(t1, { purpose: 'otp_send', sessionId: 's1', caller: 'tool', ref: 'c1' })
  await g.resolve(t1, { purpose: 'other', sessionId: 's1' })
  await g.resolve(t2, { purpose: 'otp_send', sessionId: 's1' })
  await g.resolve('[tok:bbbbbbbbbbbbbbbb]', { purpose: 'otp_send', sessionId: 's1' })
  await g.resolve('0918887777', { purpose: 'otp_send', sessionId: 's1' })
  await sleep(1150)
  await g.resolve(t1, { purpose: 'otp_send', sessionId: 's1' })
  keep(a)
  // a token store that fails: failed: 'token_store', store_unavailable, unavailable
  const failing = {
    sync: true,
    set() {
      throw new Error('down')
    },
    get() {
      throw new Error('down')
    },
    delete() {},
    clearSession() {},
  }
  const b = makeGuard(
    { entities: { PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'] } } },
    { tokenStore: failing },
  )
  b.guard.processSync('เบอร์ 0918887777', { sessionId: 's' })
  await b.guard.resolve('[tok:bbbbbbbbbbbbbbbb]', { purpose: 'otp_send', sessionId: 's' })
  b.guard.processSync('[tok:bbbbbbbbbbbbbbbb]', { sessionId: 's', boundary: 'outbound' })
  keep(b)
  // skipped and degraded detectors
  const slow = { id: 'slow-async', entities: ['PHONE'], detect: async () => [] }
  const broken = {
    id: 'broken',
    entities: ['EMAIL'],
    detect() {
      throw new Error('boom')
    },
  }
  const c = makeGuard(
    { entities: allRules({ action: 'redact' }) },
    { detectors: [...BUILTIN_DETECTORS, slow, broken] },
  )
  c.guard.processSync('เบอร์ 0918887777')
  await c.guard.process('เบอร์ 0918887777')
  keep(c)
  // a memory store that is full
  const d = makeGuard(
    { entities: { PHONE: { action: 'tokenise', allowedPurposes: ['p'] } } },
    { tokenStore: createMemoryTokenStore({ maxTokens: 1 }) },
  )
  d.guard.processSync('เบอร์ 0918887777', { sessionId: 's' })
  d.guard.processSync('เบอร์ 0811111111', { sessionId: 's' })
  keep(d)
  return all
}

check(
  'AU3 every event — all three types and every variant the docs describe — validates against the shipped schema',
  async (t) => {
    const events = await everyVariant()
    const types = new Set(events.map((e) => e.type))
    assert.deepEqual([...types].sort(), ['policy.loaded', 'scan', 'token.resolve'])
    const reasons = new Set(
      events.filter((e) => e.type === 'token.resolve').map((e) => e.reason ?? e.outcome),
    )
    const rendered = new Set(
      events.flatMap((e) => e.rendered ?? []).map((r) => `${r.kind}:${r.as}`),
    )
    t.diagnostic(
      `${events.length} events · resolve outcomes ${[...reasons].join(', ')} · rendered ${[...rendered].join(', ')}`,
    )
    const bad = events.map((e) => [e.type, schemaErrors(e)]).filter(([, errs]) => errs.length)
    assert.deepEqual(bad, [])
    for (const want of [
      'allowed',
      'purpose_not_allowed',
      'session_mismatch',
      'not_found',
      'expired',
      'store_unavailable',
    ])
      assert.ok(reasons.has(want), `no resolve event with ${want}`)
    for (const want of [
      'token:masked',
      'token:foreign',
      'token:unknown',
      'token:unavailable',
      'hash:placeholder',
    ])
      assert.ok(rendered.has(want), `no rendered ${want}`)
  },
)

/** All the ways a labelled value could appear in a log line. */
function forms(label) {
  const v = label.value
  const out = new Set([v, v.toLowerCase(), v.trim()])
  const d = onlyDigits(v)
  if (d.length >= 8) out.add(d)
  if (label.type === 'PHONE') out.add(phoneNational(v))
  return [...out].filter((s) => s.length >= 6)
}

check(
  'AU4 no raw value in any audit event — all benchmark messages, every action, outbound and resolve too',
  async (t) => {
    const messages = [...loadSet('open'), ...loadSet('holdout')].flatMap((c) =>
      c.turns.map((turn) => ({ ...turn, conv: c.id })),
    )
    const values = messages.flatMap((m) => m.labels.filter((l) => !l.decoy))
    const leaks = []
    let events = 0
    const rules = [
      { action: 'redact' },
      { action: 'mask' },
      { action: 'mask', keep: 'last4' },
      { action: 'tokenise', allowedPurposes: ['p'] },
      { action: 'hash' },
      { action: 'flag' },
      { action: 'block' },
    ]
    for (const rule of rules) {
      const x = makeGuard({
        entities: allRules(rule),
        allowlist: { exact: ['support@myshop.co.th'] },
      })
      for (const m of messages) {
        const r = await x.guard.process(m.plain, {
          sessionId: m.conv,
          boundary: m.boundary,
          ref: `${m.conv}#${m.index}`,
          ...(m.context ? { context: m.context } : {}),
        })
        if (rule.action === 'tokenise') {
          for (const tok of r.text.match(TOK) ?? []) {
            await x.guard.process(`ส่งไปที่ ${tok} แล้วค่ะ`, { sessionId: m.conv, boundary: 'outbound' })
            await x.guard.resolve(tok, { purpose: 'p', sessionId: m.conv })
          }
          for (const l of m.labels.filter((l) => !l.decoy))
            await x.guard.resolve(l.value, { purpose: 'p', sessionId: m.conv })
        }
      }
      const hay = strings(x.events).join('\n')
      const hayLower = hay.toLowerCase()
      events += x.events.length
      for (const l of values)
        for (const f of forms(l))
          if (hay.includes(f) || hayLower.includes(f.toLowerCase()))
            leaks.push(`${rule.action}${rule.keep ? '+last4' : ''}: ${l.type} ${JSON.stringify(f)}`)
    }
    t.diagnostic(
      `${messages.length} messages × ${rules.length} rules, ${values.length} labelled values, ${events} events checked`,
    )
    assert.deepEqual([...new Set(leaks)], [])
  },
)

check(
  'AU5 sessionId and ref are written exactly as passed; sessionId is "anonymous" when none is passed',
  () => {
    const { guard, scans } = makeGuard({ entities: allRules({ action: 'redact' }) })
    guard.processSync('hi', { sessionId: 'แชท#42 🌸', ref: 'msg/ไทย/0001' })
    guard.processSync('hi')
    assert.deepEqual([scans()[0].sessionId, scans()[0].ref], ['แชท#42 🌸', 'msg/ไทย/0001'])
    assert.equal(scans()[1].sessionId, 'anonymous')
    assert.equal('ref' in scans()[1], false)
  },
)

check(
  'AU6 the README scan example: start 6, end 18, confidence 0.99, detector phone, tokenise fields',
  async () => {
    const { guard, scans } = makeGuard(
      parsePolicy(readFileSync('policies/readme-example.json', 'utf8')),
    )
    await guard.process('เบอร์ ๐๙๑-๘๘๘-๗๗๗๗ ค่ะ', { sessionId: 'conv_8f2a', ref: 'msg_10293' })
    const e = scans()[0]
    assert.equal(e.schemaVersion, '1.0')
    assert.deepEqual(
      [e.type, e.sessionId, e.ref, e.boundary, e.outcome],
      ['scan', 'conv_8f2a', 'msg_10293', 'inbound', 'processed'],
    )
    assert.deepEqual(e.policy, { hash: 'fnv1a64:ee142dc8b1111706', entitySet: '0.1' })
    const { tokenId, ...rest } = e.findings[0]
    assert.deepEqual(rest, {
      entity: 'PHONE',
      start: 6,
      end: 18,
      confidence: 0.99,
      detector: 'phone',
      action: 'tokenise',
      ttlSec: 300,
      allowedPurposes: ['otp_send'],
    })
    assert.match(tokenId, /^[bcdfghjkmnpqrstv]{16}$/)
  },
)

check('AU7 engine: version = VERSION, the detectors, entitiesSupported, nerAvailable false', () => {
  const { guard, scans, events } = makeGuard({ entities: allRules({ action: 'redact' }) })
  guard.processSync('hi')
  for (const e of [events[0], scans()[0]]) {
    assert.equal(e.engine.version, VERSION)
    assert.deepEqual(
      e.engine.detectors,
      BUILTIN_DETECTORS.map((d) => d.id),
    )
    assert.deepEqual([...e.engine.entitiesSupported].sort(), [...ENTITY_TYPES].sort())
    assert.equal(e.engine.nerAvailable, false)
  }
})

check('AU8 input.chars is the length in UTF-16 code units', () => {
  const { guard, scans } = makeGuard({ entities: allRules({ action: 'redact' }) })
  const text = '👨‍👩‍👧 เบอร์ ๐๙๑​8887777'
  guard.processSync(text)
  assert.equal(scans()[0].input.chars, text.length)
})

check(
  'AU9 at is UTC ISO with milliseconds, prevHash null, durationMs ≥ 0 (eventId uniqueness: AU9b)',
  async (t) => {
    const events = await everyVariant()
    const byId = new Map()
    for (const e of events) byId.set(e.eventId, [...(byId.get(e.eventId) ?? []), e])
    for (const [id, list] of byId)
      if (list.length > 1)
        t.diagnostic(
          `eventId ${id} shared by: ${list.map((e) => `${e.type}${e.type === 'scan' ? `(${e.boundary}, ${e.outcome})` : ''}`).join(' | ')}`,
        )
    for (const e of events) {
      assert.match(e.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      assert.equal(e.prevHash, null)
      if (e.type === 'scan') assert.ok(e.durationMs >= 0)
    }
  },
)

check(
  'AU9b eventIds stay distinct under a policy that does not tokenise ("unique enough to tell two events apart")',
  (t) => {
    const seen = new Map()
    for (const entities of [
      { PHONE: { action: 'redact' } },
      { PHONE: { action: 'hash' } },
      { EMAIL: { action: 'mask' } },
    ]) {
      for (let i = 0; i < 20; i++) {
        const x = makeGuard({ entities })
        x.guard.processSync('เบอร์ 0918887777')
        x.guard.processSync('เบอร์ 0811111111')
        for (const e of x.events) seen.set(e.eventId, (seen.get(e.eventId) ?? 0) + 1)
      }
    }
    const total = [...seen.values()].reduce((a, b) => a + b, 0)
    t.diagnostic(
      `${total} events, ${seen.size} distinct eventIds; e.g. ${[...seen.keys()].slice(0, 3).join(', ')}`,
    )
    assert.equal(seen.size, total)
  },
)

check('AU10 every event is plain JSON on one line (NDJSON)', async () => {
  for (const e of await everyVariant()) {
    const line = JSON.stringify(e)
    assert.ok(!line.includes('\n'))
    assert.deepEqual(JSON.parse(line), e)
  }
})

check(
  'AU11 a process call that throws is still on record (README: a scan event for every call; schema: outcome "error")',
  (t) => {
    const { guard, events } = makeGuard({
      entities: { PHONE: { action: 'tokenise', allowedPurposes: ['p'] } },
    })
    try {
      guard.processSync('เบอร์ 0918887777')
    } catch {}
    const scans = events.filter((e) => e.type === 'scan')
    t.diagnostic(
      `a call that threw ERR_PDPA_NO_SESSION left ${scans.length} scan event(s)${scans.length ? ` with outcome ${scans[0].outcome}` : ''}; outcome "error" was never seen in any check`,
    )
    for (const e of scans) assert.deepEqual(schemaErrors(e), [])
    assert.equal(scans.length, 1, 'no audit trace of a refused call')
  },
)

check(
  'AU12 a ref the schema does not allow (over 256 characters, or empty) is refused with a PdpaError, or kept valid',
  (t) => {
    const { guard, scans } = makeGuard({ entities: allRules({ action: 'redact' }) })
    const notPdpa = []
    for (const ref of ['r'.repeat(300), '']) {
      try {
        guard.processSync('เบอร์ 0918887777', { ref })
        t.diagnostic(
          `${ref.length} chars → event ref ${JSON.stringify(scans().at(-1).ref)?.slice(0, 20)}…`,
        )
      } catch (e) {
        t.diagnostic(
          `${ref.length} chars → throws ${e.constructor.name} ${e.code ?? ''}: ${e.message}`,
        )
        if (e.constructor.name !== 'PdpaError')
          notPdpa.push(`${ref.length} chars → ${e.constructor.name}`)
        assert.ok(!String(e.message).includes('0918887777'))
      }
    }
    assert.deepEqual(
      scans()
        .map(schemaErrors)
        .filter((x) => x.length),
      [],
      'an emitted event does not match the shipped schema',
    )
    assert.deepEqual(notPdpa, [], 'README: "All are PdpaError"')
  },
)
