// Are audit eventIds unique? Within one guard, across guards, with a fixed randomSource.
//   bench/user/run examples/probe-eventid.mjs
import { createGuard, definePolicy } from '@thai-pdpa-guard/core'

const policy = definePolicy({
  entitySet: '0.1',
  entities: { PHONE: { action: 'tokenise', allowedPurposes: ['p'] } },
})
const dupes = (events) => {
  const seen = new Map()
  for (const e of events) seen.set(e.eventId, [...(seen.get(e.eventId) ?? []), e.type])
  return [...seen].filter(([, v]) => v.length > 1)
}
{
  const events = []
  const g = createGuard({ policy, onAudit: (e) => events.push(e) })
  for (let i = 0; i < 20000; i++) g.processSync('เบอร์ 0918887777', { sessionId: `s${i % 50}` })
  console.log('one guard, 20,001 events, duplicate ids:', dupes(events).length)
}
{
  const events = []
  for (let i = 0; i < 2000; i++) createGuard({ policy, onAudit: (e) => events.push(e) })
  console.log('2,000 guards, policy.loaded ids, duplicates:', dupes(events).length)
}
{
  const events = []
  const fixed = (n) => new Uint8Array(n).fill(7)
  const g1 = createGuard({ policy, randomSource: fixed, onAudit: (e) => events.push(e) })
  g1.processSync('เบอร์ 0918887777', { sessionId: 's' })
  const g2 = createGuard({ policy, randomSource: fixed, onAudit: (e) => events.push(e) })
  g2.processSync('เบอร์ 0918887777', { sessionId: 's' })
  console.log(
    'two guards with the same randomSource:',
    JSON.stringify(dupes(events)),
    JSON.stringify(events.map((e) => [e.type, e.eventId])),
  )
}
{
  const events = []
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
  const g = createGuard({ policy, tokenStore: failing, onAudit: (e) => events.push(e) })
  g.processSync('เบอร์ 0918887777', { sessionId: 's' })
  g.processSync('เบอร์ 0918887777', { sessionId: 's' })
  g.processSync('[tok:bbbbbbbbbbbbbbbb]', { sessionId: 's', boundary: 'outbound' })
  console.log('failing store:', JSON.stringify(events.map((e) => [e.type, e.eventId])))
}
