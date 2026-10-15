// HS — the hash action: key rules, stability, and "recognise the same person".
//   bench/user/run features/hash.check.mjs
import assert from 'node:assert/strict'
import { createGuard, definePolicy } from '@thai-pdpa-guard/core'
import { allRules, check, expectCode, KEY } from '../lib/kit.mjs'

const policy = definePolicy({ entitySet: '0.1', entities: allRules({ action: 'hash' }) })
const make = (hmacKey) => createGuard({ policy, hmacKey, onAudit: () => {} })
const H = /\[([A-Z_]+):([a-z]{16})\]/
const hashOf = (g, text) => H.exec(g.processSync(text).text)?.[2]

check('HS1 a policy that hashes and no hmacKey → createGuard throws ERR_PDPA_HMAC_KEY', () => {
  expectCode(() => make(undefined), 'ERR_PDPA_HMAC_KEY')
  expectCode(() => createGuard({ policy, onAudit: () => {} }), 'ERR_PDPA_HMAC_KEY')
})

check(
  'HS2 a key shorter than 32 bytes (string or Uint8Array) is refused; 32 bytes is enough',
  () => {
    expectCode(() => make('x'.repeat(31)), 'ERR_PDPA_HMAC_KEY')
    expectCode(() => make(new Uint8Array(31).fill(1)), 'ERR_PDPA_HMAC_KEY')
    expectCode(() => make(''), 'ERR_PDPA_HMAC_KEY')
    make('x'.repeat(32))
    make(new Uint8Array(32).fill(1))
  },
)

check('HS3 a string key counts as its UTF-8 bytes', () => {
  make('ก'.repeat(11)) // 11 characters, 33 bytes
  expectCode(() => make('ก'.repeat(10)), 'ERR_PDPA_HMAC_KEY') // 30 bytes
})

check('HS4 no key is needed when the policy does not hash', () => {
  createGuard({
    policy: definePolicy({ entitySet: '0.1', entities: allRules({ action: 'redact' }) }),
    onAudit: () => {},
  })
  createGuard({ policy: definePolicy({ entitySet: '0.1', entities: {} }), onAudit: () => {} })
})

check(
  'HS5 the same value always gives the same result, also in another guard with the same key',
  () => {
    const a = make(KEY)
    const b = make(KEY)
    assert.equal(hashOf(a, 'เบอร์ 0918887777'), hashOf(a, 'เบอร์ 0918887777'))
    assert.equal(hashOf(a, 'เบอร์ 0918887777'), hashOf(b, 'โทร 0918887777 ค่ะ'))
  },
)

check('HS6 one person written differently gives one hash ("recognise the same person")', (t) => {
  const g = make(KEY)
  const groups = {
    phone: [
      'เบอร์ 0918887777',
      'เบอร์ 091-888-7777',
      'เบอร์ ๐๙๑-๘๘๘-๗๗๗๗',
      'เบอร์ +66 91 888 7777',
      'เบอร์ ０９１８８８７７７７',
    ],
    email: ['เมล somchai.k@gmail.com', 'เมล Somchai.K@Gmail.com'],
    id: ['เลขบัตร 1103702071811', 'เลขบัตร 1-1037-02071-81-1', 'เลขบัตร 1 1037 02071 81 1'],
    card: ['บัตร 4111111111111111', 'บัตร 4111 1111 1111 1111', 'บัตร 4111-1111-1111-1111'],
  }
  const split = []
  for (const [k, texts] of Object.entries(groups)) {
    const hashes = texts.map((x) => hashOf(g, x))
    t.diagnostic(`${k}: ${hashes.join(' ')}`)
    if (new Set(hashes).size !== 1) split.push(k)
  }
  assert.deepEqual(split, [])
})

check('HS7 after a key change, hashes no longer match', () => {
  assert.notEqual(
    hashOf(make(KEY), 'เบอร์ 0918887777'),
    hashOf(make(`${KEY}-rotated`), 'เบอร์ 0918887777'),
  )
})

check('HS8 different values give different hashes, in the form [ENTITY:<16 letters>]', () => {
  const g = make(KEY)
  const seen = new Set()
  for (let i = 0; i < 200; i++) {
    const text = `เบอร์ 08${String(i).padStart(8, '0')}`
    const m = H.exec(g.processSync(text).text)
    assert.equal(m[1], 'PHONE')
    seen.add(m[2])
  }
  assert.equal(seen.size, 200)
})
