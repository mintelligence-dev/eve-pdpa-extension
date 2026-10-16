// UN — onUnmapped: what happens to entity types the policy does not name.
//   bench/user/run features/unmapped.check.mjs
import assert from 'node:assert/strict'
import { check, makeGuard } from '../lib/kit.mjs'

const TEXT = 'เบอร์ 091-888-7777 เมล somchai.k@gmail.example'

check('UN1 default redact: an unlisted entity is redacted, its finding says unmapped: true', () => {
  const { guard, scans } = makeGuard({ entities: { PHONE: { action: 'redact' } } })
  const r = guard.processSync(TEXT)
  assert.equal(r.text, 'เบอร์ [เบอร์โทร] เมล [อีเมล]')
  const email = r.findings.find((f) => f.entity === 'EMAIL')
  assert.equal(email.unmapped, true)
  assert.equal(email.action, 'redact')
  assert.equal(r.findings.find((f) => f.entity === 'PHONE').unmapped, undefined)
  assert.equal(scans()[0].findings.find((f) => f.entity === 'EMAIL').unmapped, true)
})

check('UN2 flag: left as is, reported unmapped with action flag', () => {
  const { guard } = makeGuard({ entities: { PHONE: { action: 'redact' } }, onUnmapped: 'flag' })
  const r = guard.processSync(TEXT)
  assert.equal(r.text, 'เบอร์ [เบอร์โทร] เมล somchai.k@gmail.example')
  const email = r.findings.find((f) => f.entity === 'EMAIL')
  assert.deepEqual([email.action, email.unmapped], ['flag', true])
})

check('UN3 ignore: left as is, silently', () => {
  const { guard, scans } = makeGuard({
    entities: { PHONE: { action: 'redact' } },
    onUnmapped: 'ignore',
  })
  const r = guard.processSync(TEXT)
  assert.equal(r.text, 'เบอร์ [เบอร์โทร] เมล somchai.k@gmail.example')
  assert.equal(
    r.findings.some((f) => f.entity === 'EMAIL'),
    false,
  )
  assert.equal(
    scans()[0].findings.some((f) => f.entity === 'EMAIL'),
    false,
  )
})

check('UN4 entities: {} with the default protects all six', () => {
  const { guard } = makeGuard({ entities: {} })
  const r = guard.processSync(
    'ID 1-1037-02071-81-1 · 091-888-7777 · a@b.co · เลขบัญชี 123-4-56789-0 · 4111 1111 1111 1111 · U4af4980629f1ae0b2b5c2f7a7b2e9c3d',
  )
  assert.deepEqual(r.findings.map((f) => f.entity).sort(), [
    'BANK_ACCOUNT',
    'CREDIT_CARD',
    'EMAIL',
    'LINE_USER_ID',
    'PHONE',
    'TH_NATIONAL_ID',
  ])
  assert.ok(r.findings.every((f) => f.unmapped === true && f.action === 'redact'))
  assert.ok(!/[0-9]{4}/.test(r.text), r.text)
})
