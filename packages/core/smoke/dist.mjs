// Runtime-agnostic smoke test. Runs on Node, Deno, Bun, workerd and browsers
// against the BUILT artifact, not the source.
//
// Rules for this file:
//   - no process, Buffer, Deno, Bun or any other host-specific global
//   - no top-level await of anything host-specific
//   - throw on failure; never call exit (miniflare inlines this file)
//   - run() is async (crypto.subtle is); every harness awaits it
//   - ALL work happens inside run(), never at module top level: workerd forbids
//     generating random values during module evaluation, and module evaluation
//     counts as global scope there no matter when the import happens

import * as core from '../dist/index.js'

// Synthetic, checksum-valid, documented in fixtures/ATTESTATION.md.
const FAKE_ID = '3100500123458'
// A policy that tokenises refuses a call without one. D10.4.
const SESSION = { sessionId: 'conv_a' }

export async function run() {
  const required = [
    'createGuard',
    'definePolicy',
    'parsePolicy',
    'normalise',
    'VERSION',
    'ENTITY_TYPES',
  ]
  for (const k of required) {
    if (!(k in core)) throw new Error(`missing export: ${k}`)
  }

  if (!core.isValidThaiNationalId(FAKE_ID)) throw new Error('checksum helper rejects a valid id')
  if (core.isValidThaiNationalId('3100500123451'))
    throw new Error('checksum helper accepts a bad id')

  // Thai numerals must fold to ASCII on every runtime.
  if (core.normalise('๐๙๑').text !== '091') throw new Error('thai numeral normalisation failed')

  // Invisible characters must be stripped before detection, and offsets must
  // translate back. Both are pure string work, but String.prototype and
  // charCodeAt behaviour is exactly the sort of thing that differs subtly
  // between engines, so it is checked on every runtime rather than only in Node.
  const hidden = core.normalise('310​05001﻿23458')
  if (hidden.text !== '3100500123458') throw new Error('invisible characters were not removed')
  if (core.toOriginalStart(hidden, 3) !== 4) throw new Error('offset translation is wrong')
  if (core.normalise('สวัสดีค่ะ').shifts !== null) {
    throw new Error('Thai combining marks were treated as removable')
  }

  // Full-width forms and the space family fold one-for-one, so offsets must
  // stay aligned. A runtime that disagreed about String.fromCharCode or about
  // charCodeAt on these ranges would show up right here.
  if (core.normalise('ＡＢ＠ｃｏｍ').text !== 'AB@com') throw new Error('full-width folding failed')
  if (core.normalise('091 888').text !== '091 888') throw new Error('NBSP folding failed')
  if (core.normalise('a　b').shifts !== null) throw new Error('space folding moved offsets')

  const events = []
  const guard = core.createGuard({
    policy: core.definePolicy({
      entitySet: '0.1',
      onUnmapped: 'redact',
      entities: { TH_NATIONAL_ID: { action: 'redact' } },
    }),
    onAudit: (e) => events.push(e),
  })

  const out = guard.processSync(`เลขบัตรประชาชน ${FAKE_ID} สั่ง ๕ ชิ้น ราคา ๒๕๐ บาท ครับ`)

  if (out.text.includes(FAKE_ID)) throw new Error('value survived redaction')
  // The customer wrote Thai numerals; they must get Thai numerals back. Only the
  // detected span is rewritten, and it is rewritten on the original text. The
  // control has to be digits no detector claims — an order quantity and a price.
  if (!out.text.includes('๕ ชิ้น')) throw new Error('folded copy was returned to the caller')
  if (!out.text.includes('๒๕๐ บาท')) throw new Error('folded copy was returned to the caller')
  if (!out.text.includes('[เลขบัตรประชาชน]')) throw new Error('placeholder missing')
  // D10.7: policy.loaded when the guard is built, then one scan.
  if (events.length !== 2) throw new Error(`expected 2 audit events, got ${events.length}`)
  if (events[0].type !== 'policy.loaded' || events[1].type !== 'scan') {
    throw new Error(`unexpected audit event order: ${events.map((e) => e.type).join(', ')}`)
  }

  // The product promise, checked per runtime and per commit rather than claimed.
  if (JSON.stringify(events).includes(FAKE_ID)) throw new Error('value leaked into audit event')
  if (typeof events[1].policy.hash !== 'string') throw new Error('audit event has no policy hash')
  if (events[0].policy.hash !== events[1].policy.hash) {
    throw new Error('policy.loaded and scan disagree on the policy hash')
  }

  // A number that fails the checksum must NOT be treated as an id.
  const bad = guard.processSync('เลขบัตรประชาชน 3100500123451 ครับ')
  if (!bad.text.includes('3100500123451')) throw new Error('checksum-invalid number was redacted')

  // D7: the Node 18 contract is tested, not left as a landmine.
  const hasCsprng = typeof globalThis.crypto?.getRandomValues === 'function'
  const tokenisePolicy = core.definePolicy({
    entitySet: '0.1',
    entities: {
      TH_NATIONAL_ID: { action: 'tokenise', ttlSec: 300, allowedPurposes: ['otp_send'] },
    },
  })

  if (hasCsprng) {
    const g2 = core.createGuard({ policy: tokenisePolicy })
    const r2 = g2.processSync(`เลขบัตร ${FAKE_ID}`, SESSION)
    if (r2.text.includes(FAKE_ID)) throw new Error('value survived tokenisation')
    // Letters only, so a second pass through the guard can never find a number in it.
    if (!/\[tok:[bcdfghjkmnpqrstv]{16}\]/.test(r2.text)) throw new Error('token format wrong')
    if (g2.processSync(r2.text, SESSION).text !== r2.text)
      throw new Error('token re-detected on second pass')
    checkResolve(g2, r2.text)
    // D10.4: a tokenising policy will not fall back to one shared session.
    let noSession = null
    try {
      g2.processSync('x')
    } catch (e) {
      noSession = e
    }
    if (noSession?.code !== 'ERR_PDPA_NO_SESSION') {
      throw new Error('expected ERR_PDPA_NO_SESSION without a sessionId')
    }
  } else {
    let threw = null
    try {
      core.createGuard({ policy: tokenisePolicy })
    } catch (e) {
      threw = e
    }
    if (threw?.code !== 'ERR_PDPA_NO_CSPRNG') {
      throw new Error('expected ERR_PDPA_NO_CSPRNG when crypto.getRandomValues is unavailable')
    }
    // ...and it must work once the host supplies a source.
    const g3 = core.createGuard({
      policy: tokenisePolicy,
      randomSource: (n) => {
        const a = new Uint8Array(n)
        for (let i = 0; i < n; i++) a[i] = (i * 37 + 11) & 0xff
        return a
      },
    })
    const r3 = g3.processSync(`เลขบัตร ${FAKE_ID}`, SESSION)
    if (r3.text.includes(FAKE_ID)) {
      throw new Error('value survived tokenisation via randomSource')
    }
    checkResolve(g3, r3.text)
  }

  if (hasCsprng) await checkProcessAsync(tokenisePolicy)

  const hmac = await checkHash()

  return `smoke ok (csprng: ${hasCsprng ? 'host' : 'injected'}, hmac: ${hmac})`
}

/** A token must come back as the real value for an allowed purpose, and only then. */
function checkResolve(guard, text) {
  const token = /\[tok:[bcdfghjkmnpqrstv]{16}\]/.exec(text)?.[0]
  if (token === undefined) throw new Error('no token to resolve')

  const ok = guard.resolveSync(token, { ...SESSION, purpose: 'otp_send' })
  if (!ok.ok || ok.value !== FAKE_ID) throw new Error('token did not resolve to its value')

  const denied = guard.resolveSync(token, { ...SESSION, purpose: 'marketing' })
  if (denied.ok || denied.reason !== 'purpose_not_allowed')
    throw new Error('wrong purpose was not refused')

  const other = guard.resolveSync(token, { purpose: 'otp_send', sessionId: 'someone-else' })
  if (other.ok || other.reason !== 'session_mismatch')
    throw new Error('other session was not refused')

  guard.endSession(SESSION.sessionId)
  if (guard.resolveSync(token, { ...SESSION, purpose: 'otp_send' }).ok)
    throw new Error('endSession left the token')
}

/**
 * guard.process() against an async token store — the shape a Redis or KV store
 * has. Promise scheduling is exactly what differs between runtimes, so the
 * async path is proved on each one, not only on Node.
 */
async function checkProcessAsync(policy) {
  const inner = core.createMemoryTokenStore()
  const store = {
    sync: false,
    set: async (id, rec) => inner.set(id, rec),
    get: async (id) => inner.get(id),
    delete: async (id) => inner.delete(id),
    clearSession: async (sid) => inner.clearSession(sid),
  }
  const guard = core.createGuard({ policy, tokenStore: store })

  let refused = false
  try {
    guard.processSync(`เลขบัตร ${FAKE_ID}`)
  } catch (e) {
    refused = e?.code === 'ERR_PDPA_ASYNC_STORE'
  }
  if (!refused) throw new Error('processSync accepted an async token store')

  const r = await guard.process(`เลขบัตร ${FAKE_ID}`, { sessionId: 'conv_a' })
  const token = /\[tok:[bcdfghjkmnpqrstv]{16}\]/.exec(r.text)?.[0]
  if (token === undefined || r.text.includes(FAKE_ID)) throw new Error('process did not tokenise')
  const back = await guard.resolve(token, { purpose: 'otp_send', sessionId: 'conv_a' })
  if (!back.ok || back.value !== FAKE_ID) throw new Error('async token did not resolve')
  const out = await guard.process(`ยืนยัน ${token}`, { sessionId: 'conv_a', boundary: 'outbound' })
  if (out.text.includes('tok:') || out.text.includes(FAKE_ID)) {
    throw new Error('outbound reply was not rendered')
  }
}

/**
 * The hand-written SHA-256 and HMAC, checked against the runtime's own native
 * implementation on every runtime that has one. 32-bit integer arithmetic is
 * exactly where engines could disagree, so agreement here is evidence the
 * vitest run on Node alone cannot give.
 */
async function checkHash() {
  const key = 'a3f1c9e07b2d4f6a8c1e3b5d7f9a0c2e4b6d8f1a3c5e7b9d0f2a4c6e8b1d3f5a'
  const guard = core.createGuard({
    policy: core.definePolicy({ entitySet: '0.1', entities: { PHONE: { action: 'hash' } } }),
    hmacKey: key,
  })

  const out = guard.processSync('เบอร์ 0918887777').text
  if (out.includes('0918887777')) throw new Error('value survived hashing')
  if (!/^เบอร์ \[PHONE:[bcdfghjkmnpqrstv]{16}\]$/.test(out))
    throw new Error(`hash format wrong: ${out}`)
  if (guard.processSync(out).text !== out) throw new Error('hash re-detected on second pass')
  if (guard.processSync('เบอร์ ๐๙๑-๘๘๘-๗๗๗๗').text !== out) {
    throw new Error('the same number written differently hashed differently')
  }

  let missingKey = null
  try {
    core.createGuard({
      policy: core.definePolicy({ entitySet: '0.1', entities: { PHONE: { action: 'hash' } } }),
    })
  } catch (e) {
    missingKey = e
  }
  if (missingKey?.code !== 'ERR_PDPA_HMAC_KEY')
    throw new Error('expected ERR_PDPA_HMAC_KEY without a key')

  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) return 'no native reference on this runtime'

  const enc = new TextEncoder()
  const native = await subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(await subtle.sign('HMAC', native, enc.encode('PHONE\u00000918887777')))
  const letters = 'bcdfghjkmnpqrstv'
  let want = ''
  for (const b of mac.subarray(0, 8)) want += letters[b >> 4] + letters[b & 0xf]
  if (out !== `เบอร์ [PHONE:${want}]`) {
    throw new Error(`hand-written HMAC disagrees with crypto.subtle: ${out} vs ${want}`)
  }
  return 'matches crypto.subtle'
}
