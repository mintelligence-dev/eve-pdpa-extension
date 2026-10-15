// The README quick start, as a new user would first run it.
// Only change: the key comes from a fixed test string, because the sandbox has no PDPA_HMAC_KEY.
//
//   bench/user/run examples/readme-quickstart.mjs
import { readFileSync } from 'node:fs'
import { createGuard, parsePolicy } from '@thai-pdpa-guard/core'

const events = []
const guard = createGuard({
  policy: parsePolicy(readFileSync('policies/readme-example.json', 'utf8')),
  hmacKey: process.env.PDPA_HMAC_KEY ?? 'test-key-0123456789abcdef0123456789abcdef',
  onAudit: (event) => events.push(event),
})

// 1. Customer message → before it goes to the AI
const inbound = await guard.process('เบอร์ ๐๙๑-๘๘๘-๗๗๗๗ ค่ะ', {
  sessionId: 'conv_8f2a',
  ref: 'msg_10293',
})
console.log('1. inbound.text      ', JSON.stringify(inbound.text))
console.log('   inbound.findings  ', JSON.stringify(inbound.findings))

// 2. The tool exchanges the token
const token = `[tok:${inbound.findings[0]?.tokenId}]`
const r = await guard.resolve(token, { purpose: 'otp_send', sessionId: 'conv_8f2a' })
console.log('2. resolve           ', JSON.stringify(r))

// 3. The AI's reply → before it reaches the customer
const out = await guard.process(`ส่ง OTP ไปที่ ${token} แล้วค่ะ`, {
  sessionId: 'conv_8f2a',
  boundary: 'outbound',
})
console.log('3. out.text          ', JSON.stringify(out.text))

// context example
const a = await guard.process('123-4-56789-0', { sessionId: 'conv_8f2a' })
const b = await guard.process('123-4-56789-0', {
  sessionId: 'conv_8f2a',
  context: 'รบกวนขอเลขบัญชีด้วยค่ะ',
})
console.log('context: without     ', JSON.stringify(a.text))
console.log('context: with        ', JSON.stringify(b.text))

console.log('\naudit events:')
for (const e of events) console.log(JSON.stringify(e))
