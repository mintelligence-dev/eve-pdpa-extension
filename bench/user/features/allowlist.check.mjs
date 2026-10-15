// AL — allowlist: exact ignores formatting, pattern matches the whole value, digests in policy.loaded.
//   bench/user/run features/allowlist.check.mjs
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { allRules, check, makeGuard } from '../lib/kit.mjs'

const shop = (allowlist, rules = allRules({ action: 'redact' })) =>
  makeGuard({ entities: rules, allowlist })
const kept = (g, text) => {
  const r = g.guard.processSync(text, { sessionId: 's' })
  return {
    kept: r.text === text,
    allowlisted: r.findings.length > 0 && r.findings.every((f) => f.allowlisted === true),
    r,
  }
}
const sha = (s) => `sha256:${createHash('sha256').update(s, 'utf8').digest('hex')}`

check('AL1 exact "02-123-4567" lets through 02-123-4567, 021234567 and ๐๒๑๒๓๔๕๖๗', () => {
  const g = shop({ exact: ['02-123-4567'] })
  for (const v of ['02-123-4567', '021234567', '๐๒๑๒๓๔๕๖๗']) {
    const k = kept(g, `ติดต่อร้าน ${v} ค่ะ`)
    assert.ok(k.kept && k.allowlisted, `${v}: ${JSON.stringify(k.r)}`)
  }
})

check(
  'AL2 exact matches every way of writing the value (+66, spaces, brackets, full-width, dots)',
  () => {
    const g = shop({ exact: ['02-123-4567'] })
    const misses = []
    for (const v of [
      '+66 2 123 4567',
      '+6621234567',
      '02 123 4567',
      '(02) 123-4567',
      '０２-１２３-４５６７',
      '02–123–4567',
      'โทร 02.123.4567',
    ]) {
      const k = kept(g, v.startsWith('โทร') ? v : `ติดต่อร้าน ${v} ค่ะ`)
      if (!(k.kept && k.allowlisted)) misses.push(`${v} → ${JSON.stringify(k.r.text)}`)
    }
    assert.deepEqual(misses, [])
  },
)

check('AL2b an exact entry written with brackets still matches the plain number', () => {
  const g = shop({ exact: ['(02) 123-4567'] })
  const k = kept(g, 'ติดต่อร้าน 02-123-4567 ค่ะ')
  assert.ok(k.kept && k.allowlisted, JSON.stringify(k.r.text))
})

check('AL3 exact email matches whatever the capitals', () => {
  const g = shop({ exact: ['support@myshop.co.th'] })
  assert.ok(kept(g, 'เมล Support@MyShop.co.th ค่ะ').kept)
  const g2 = shop({ exact: ['SUPPORT@MYSHOP.CO.TH'] })
  assert.ok(kept(g2, 'เมล support@myshop.co.th ค่ะ').kept)
})

check(
  'AL4 an allowlisted value is left as is and reported allowlisted, with the rule action and no token',
  () => {
    const g = makeGuard({
      entities: { PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'] } },
      allowlist: { exact: ['02-123-4567'] },
    })
    const r = g.guard.processSync('ติดต่อร้าน 02-123-4567 ค่ะ', { sessionId: 's' })
    assert.equal(r.text, 'ติดต่อร้าน 02-123-4567 ค่ะ')
    assert.deepEqual(
      [r.findings[0].allowlisted, r.findings[0].action, r.findings[0].tokenId],
      [true, 'tokenise', undefined],
    )
    assert.equal(g.scans()[0].findings[0].allowlisted, true)
  },
)

check('AL5 pattern must match the whole value — anchors are added', () => {
  const g = shop({ pattern: ['myshop'] })
  assert.equal(g.guard.processSync('เมล sales@myshop.co.th').text, 'เมล [อีเมล]')
  const g2 = shop({ pattern: ['.*@myshop\\.co\\.th'] })
  assert.ok(kept(g2, 'เมล sales@myshop.co.th').kept)
  const g3 = shop({ pattern: ['02123'] })
  assert.equal(g3.guard.processSync('โทร 021234567').text, 'โทร [เบอร์โทร]')
})

check(
  'AL6 pattern is tested after formatting is removed (emails lower-cased, numbers digits only)',
  () => {
    assert.ok(
      kept(shop({ pattern: ['021234567'] }), 'โทร 02-123-4567').kept,
      'digits-only pattern vs dashed number',
    )
    assert.ok(
      kept(shop({ pattern: ['0212345\\d\\d'] }), 'โทร ๐๒-๑๒๓-๔๕๖๗').kept,
      'Thai digits folded before the pattern',
    )
    assert.ok(
      kept(shop({ pattern: ['.*@myshop\\.co\\.th'] }), 'เมล SALES@MYSHOP.CO.TH').kept,
      'email lower-cased before the pattern',
    )
  },
)

check('AL7 the allowlist applies to every entity', () => {
  const values = {
    TH_NATIONAL_ID: ['1-1037-02071-81-1', 'เลขบัตร 1103702071811'],
    BANK_ACCOUNT: ['123-4-56789-0', 'เลขบัญชี 1234567890'],
    CREDIT_CARD: ['4111 1111 1111 1111', 'บัตร 4111-1111-1111-1111'],
    LINE_USER_ID: ['U4af4980629f1ae0b2b5c2f7a7b2e9c3d', 'userId U4af4980629f1ae0b2b5c2f7a7b2e9c3d'],
  }
  for (const [e, [entry, text]] of Object.entries(values)) {
    const k = kept(shop({ exact: [entry] }), text)
    assert.ok(k.kept && k.allowlisted, `${e}: ${JSON.stringify(k.r)}`)
  }
})

check('AL8 a real value next to an allowlisted one is still protected', () => {
  const g = shop({ exact: ['02-123-4567', 'support@myshop.co.th'] })
  const r = g.guard.processSync(
    'ร้าน 02-123-4567 support@myshop.co.th หรือมือถือคุณนก 0918887777 nok@gmail.com',
  )
  assert.equal(r.text, 'ร้าน 02-123-4567 support@myshop.co.th หรือมือถือคุณนก [เบอร์โทร] [อีเมล]')
})

// Rule (audit-event.schema.json, policy.loaded.allowlist.exact): fold Thai and full-width digits to ASCII,
// lower-case it if it contains @, leave it as is if it is a LINE user id, otherwise remove spaces and
// hyphens and turn a leading +66 into 0.
check(
  'AL9 policy.loaded holds sha256 of phone, email and LINE id entries in the documented canonical form, never the value',
  () => {
    const entries = [
      '02-123-4567',
      '๐๒-๑๒๓-๔๕๖๗',
      '+66 2 123 4567',
      'Support@MyShop.co.th',
      'U4af4980629f1ae0b2b5c2f7a7b2e9c3d',
      '091 888 7777',
    ]
    const g = shop({ exact: entries })
    const loaded = g.events[0]
    const expected = [
      '021234567',
      '021234567',
      '021234567',
      'support@myshop.co.th',
      'U4af4980629f1ae0b2b5c2f7a7b2e9c3d',
      '0918887777',
    ].map(sha)
    assert.deepEqual(loaded.policy.allowlist.exact, expected)
    const text = JSON.stringify(loaded)
    for (const v of [...entries, '021234567', 'myshop'])
      assert.ok(!text.includes(v), `policy.loaded holds ${v}`)
  },
)

check(
  'AL9b the documented rule also reproduces the digest of national id, account, card and upper-case LINE id entries',
  (t) => {
    const entries = {
      '1-1037-02071-81-1': '1103702071811',
      1103702071811: '1103702071811',
      '123-4-56789-0': '1234567890',
      '4111 1111 1111 1111': '4111111111111111',
      U4AF4980629F1AE0B2B5C2F7A7B2E9C3D: 'U4AF4980629F1AE0B2B5C2F7A7B2E9C3D',
    }
    const off = []
    for (const [entry, canonical] of Object.entries(entries)) {
      const got = shop({ exact: [entry] }).events[0].policy.allowlist.exact[0]
      if (got !== sha(canonical))
        off.push(`${entry} → ${got} is not sha256(${JSON.stringify(canonical)})`)
    }
    for (const o of off) t.diagnostic(o)
    t.diagnostic(
      'allowlistDigestForm, which the types name as the reference, is not exported (EX7), so a log reader cannot check these entries',
    )
    assert.deepEqual(off, [])
    const g = shop({ exact: Object.keys(entries) })
    for (const v of Object.keys(entries))
      assert.ok(!JSON.stringify(g.events[0]).includes(v), `policy.loaded holds ${v}`)
  },
)

check('AL10 policy.loaded holds sha256 of each pattern exactly as written', () => {
  const patterns = ['.*@myshop\\.co\\.th', '0918887777|0812345678']
  const g = shop({ pattern: patterns })
  assert.deepEqual(g.events[0].policy.allowlist.pattern, patterns.map(sha))
  assert.ok(!JSON.stringify(g.events[0]).includes('0918887777'))
})
