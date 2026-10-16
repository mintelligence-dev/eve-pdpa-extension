// CX — `context`: the other side's last message, read for cue words only.
//   bench/user/run features/context.check.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parsePolicy } from '@eve-pdpa-extension/core'
import { allRules, check, found, makeGuard, strings } from '../lib/kit.mjs'

const readmePolicy = () => parsePolicy(readFileSync('policies/readme-example.json', 'utf8'))

check('CX1 README: "123-4-56789-0" with no cue stays as is', async () => {
  const { guard } = makeGuard(readmePolicy())
  const r = await guard.process('123-4-56789-0', { sessionId: 'conv_8f2a' })
  assert.equal(r.text, '123-4-56789-0')
})

check('CX2 README: with context "รบกวนขอเลขบัญชีด้วยค่ะ" → "xxx-x-xx789-0"', async () => {
  const { guard } = makeGuard(readmePolicy())
  const r = await guard.process('123-4-56789-0', {
    sessionId: 'conv_8f2a',
    context: 'รบกวนขอเลขบัญชีด้วยค่ะ',
  })
  assert.equal(r.text, 'xxx-x-xx789-0')
  assert.equal(r.findings[0].entity, 'BANK_ACCOUNT')
})

check('CX3 a phone with no leading 0 is found when the context asks for a phone', () => {
  const { guard } = makeGuard({ entities: allRules({ action: 'redact' }) })
  assert.equal(guard.processSync('918887777').text, '918887777')
  assert.equal(guard.processSync('918887777', { context: 'ขอเบอร์ติดต่อหน่อยค่ะ' }).text, '[เบอร์โทร]')
  assert.equal(
    guard.processSync('66918887777', { context: 'รบกวนขอเบอร์โทรด้วยครับ' }).text,
    '[เบอร์โทร]',
  )
})

check('CX4 context is not scanned: values inside it are neither reported nor acted on', () => {
  const { guard, scans } = makeGuard({ entities: allRules({ action: 'redact' }) })
  const r = guard.processSync('โอเคค่ะ', {
    context: 'โทรหาร้านที่ 0918887777 หรือเมล shop.owner@gmail.example นะคะ',
  })
  assert.equal(r.text, 'โอเคค่ะ')
  assert.deepEqual(r.findings, [])
  assert.deepEqual(scans()[0].findings, [])
})

check('CX5 context is not written to audit; the event says contextUsed: true', () => {
  const { guard, events } = makeGuard({ entities: allRules({ action: 'redact' }) })
  const context = 'รบกวนขอเลขบัญชี ของคุณสมหญิง 0918887777 ด้วยค่ะ'
  guard.processSync('123-4-56789-0', { context, ref: 'm1' })
  const scan = events.find((e) => e.type === 'scan')
  assert.equal(scan.contextUsed, true)
  const all = strings(events).join('\n')
  for (const piece of [context, 'รบกวนขอเลขบัญชี', 'สมหญิง', '0918887777'])
    assert.ok(!all.includes(piece), `audit holds ${piece}`)
})

check('CX6 contextUsed is absent when no context was passed', () => {
  const { guard, events } = makeGuard({ entities: allRules({ action: 'redact' }) })
  guard.processSync('สวัสดีค่ะ')
  assert.equal('contextUsed' in events.find((e) => e.type === 'scan'), false)
})

check(
  'CX7 context does not make a value in the message itself disappear or change type for others',
  () => {
    // A phone asked for, answered with a proper mobile: still a phone, whatever the cue.
    const { guard } = makeGuard({ entities: allRules({ action: 'redact' }) })
    const text = 'เบอร์ 091-888-7777 ค่ะ'
    assert.deepEqual(
      found(text, guard.processSync(text, { context: 'ขอเบอร์โทรด้วยค่ะ' })).map((f) => f.entity),
      ['PHONE'],
    )
  },
)
