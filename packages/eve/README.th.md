# @eve-pdpa-extension/eve

ปกป้องข้อมูลส่วนบุคคลไทยใน agent ที่สร้างด้วย [eve](https://eve.dev) ทุกจุดที่ข้อมูลรั่วได้: ข้อความลูกค้าก่อน eve บันทึก · tool ที่ต้องใช้ค่าจริง · prompt ก่อนออกไปหา provider ของโมเดล · และคำตอบบน Slack

> **mount extension อย่างเดียวไม่ได้ปิดข้อมูลอะไรเลย** · eve เรียก hook *หลัง* บันทึกข้อความไปแล้ว และ hook เปลี่ยนสิ่งที่โมเดลอ่านไม่ได้ · การปิดข้อมูลเกิดตรงที่แพ็กเกจนี้ห่อ channel, tool และ model ของคุณ — ดู[4 ชั้น](#4-ชั้น) · extension ทำได้แค่ block และ audit

- ใช้ [`@eve-pdpa-extension/core`](../core): เลขบัตรประชาชน · เบอร์โทร · อีเมล · เลขบัญชี · บัตรเครดิต · LINE user ID · audit event ที่**ไม่มีค่าจริงอยู่ข้างใน**
- **Tokenise**: เบอร์โทรกลายเป็น `[tok:…]` ให้โมเดลเห็น · tool ที่คุณเลือกแลกกลับเป็นเบอร์จริงได้ เฉพาะ purpose ที่อนุญาต เฉพาะแชตนั้น และก่อนหมดอายุ
- Node 24 ขึ้นไป · ทดสอบกับ eve **0.80.1** (ยัง beta — รันเทสต์ก่อนเปลี่ยนรุ่น)

> **เป็นเครื่องมือทางเทคนิค ไม่ใช่ใบรับรองการปฏิบัติตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล**

> **0.1.0 ยังไม่ขึ้น npm** (`"private": true`) · ตัวอย่างที่ต่อครบและรันได้จริงอยู่ที่ [`apps/pdpa-agent`](../../apps/pdpa-agent)

[English](./README.md)

---

## 4 ชั้น

| ชั้น | ตัวช่วย | ปกป้องอะไร |
|---|---|---|
| Channel | `withPdpaGuard(channel, …)` | ข้อความขาเข้า — ก่อน eve บันทึก ก่อน hook เห็น ก่อนโมเดลอ่าน |
| Tool | `withTokenResolution(tool, …)` | ให้ tool ตัวเดียวได้ค่าจริงหลัง token ตาม purpose เดียว · ปิดสิ่งที่ tool ส่งกลับ |
| Model | `guardModel(model, …)` | prompt ทุกครั้งก่อนไปหา provider: ผลจาก tool · connection · memory ที่ดึงกลับมา · ประวัติแชต |
| คำตอบ Slack | `pdpaSlackRenderer(…)` | คำตอบ: token แสดงเป็น `xxx-xxx-7777` · token ที่ไม่รู้จักหรือของแชตอื่นเป็น `[ข้อมูลที่ปิดไว้]` |

และ **`pdpaHook(…)`** ใน `agent/hooks/` — จำเป็นเมื่อใช้ tokenise · เก็บ session id ที่ชั้นอื่นต้องใช้ · ยกเลิก turn ที่ข้อความมีข้อมูลที่ policy สั่ง block (channel ที่ลืมห่อ) · ลบ token ของแชตเมื่อ session จบ

ขาออกปกป้องได้**เฉพาะ Slack** ใน 0.1 · channel อื่นปิดได้แค่ขาเข้า

## เริ่มใช้

guard เป็นของคุณ — policy, key, token store และที่เก็บ audit อยู่ใน `createGuard` ของ core ทั้งหมด:

```ts
// agent/lib/guard.ts
import { createGuard, createMemoryTokenStore, definePolicy } from '@eve-pdpa-extension/core'

export const policy = definePolicy({
  entitySet: '0.1',
  entities: {
    PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'], ttlSec: 300, display: 'mask' },
    TH_NATIONAL_ID: { action: 'redact' },
    CREDIT_CARD: { action: 'block', minConfidence: 0.6 },
  },
})

export const guard = createGuard({
  policy,
  tokenStore: createMemoryTokenStore(),   // production ใช้ store ที่แชร์กันได้ เช่น Upstash
  onAudit: (event) => console.log(JSON.stringify(event)),
})

// openssl rand -hex 32 — ใช้ key เดียวกันทั้ง deployment
export const pdpa = { guard, sessionKey: process.env.PDPA_SESSION_KEY ?? '' }
```

```ts
// agent/channels/slack.ts
import { pdpaSlackRenderer, withPdpaGuard } from '@eve-pdpa-extension/eve/guard'
import { slackChannel } from 'eve/channels/slack'
import { pdpa } from '../lib/guard.js'

export default withPdpaGuard(slackChannel({ renderers: [pdpaSlackRenderer(pdpa)] }), {
  ...pdpa,
  channelName: 'slack',   // ชื่อไฟล์นี้ (ไม่มีนามสกุล)
})
```

```ts
// agent/hooks/pdpa.ts
import { pdpaHook } from '@eve-pdpa-extension/eve/guard'
import { pdpa } from '../lib/guard.js'

export default pdpaHook(pdpa)
```

```ts
// agent/tools/otp_send.ts
import { withTokenResolution } from '@eve-pdpa-extension/eve/guard'
import { defineTool } from 'eve/tools'
import { pdpa } from '../lib/guard.js'

export default withTokenResolution(
  defineTool({
    description: 'Send an OTP by SMS. Pass the phone number as written in the chat.',
    inputSchema: { type: 'object', properties: { phone: { type: 'string' } }, required: ['phone'] },
    async execute(input: { phone: string }) {
      // ตรงนี้ input.phone คือเบอร์จริง และมีแค่ตรงนี้ที่เห็น
      return { sent: true, to: input.phone }
    },
  }),
  { ...pdpa, purpose: 'otp_send' },
)
```

```ts
// agent/agent.ts
import { guardModel } from '@eve-pdpa-extension/eve/guard'
import { defineAgent } from 'eve'
import { pdpa } from './lib/guard.js'

export default defineAgent({
  model: guardModel('anthropic/claude-opus-5.5', pdpa),
  modelContextWindowTokens: 200_000,   // โมเดลที่ห่อแล้ว eve หาใน catalog ไม่เจอ ต้องบอกเอง
  defaultTools: false,
})
```

ลูกค้าพิมพ์ `ขอ OTP ที่เบอร์ 091-888-7777` · สิ่งที่ eve บันทึกและโมเดลอ่านคือ `ขอ OTP ที่เบอร์ [tok:pmkjhrpmbrqfnbqc]` · `otp_send` ได้ `0918887777` · ผลจาก tool กลับไปหาโมเดลเป็น `[tok:…]` · คำตอบบน Slack เป็น `ส่ง OTP ไปที่ xxx-xxx-7777 แล้วค่ะ`

---

## `withPdpaGuard(channel, options)`

คืน channel ชุดใหม่ที่ทุกข้อความขาเข้าถูกปิดก่อน · route คง method, path, transport เดิม และ field อื่นทั้งหมด — adapter, events, renderers, ข้อมูลตอน build — ส่งต่อตามเดิม

| ครอบคลุม | อย่างไร |
|---|---|
| `from(address).send()` — Slack, Teams, Telegram, Chat SDK bridge, channel ที่เขียนเอง | ปิดข้อความ `context` และ `title` |
| `attachSession(id).send()` · `to(channel, target).send()` · `ctx.from().send()` ใน `receive` · WebSocket route | เหมือนกัน |
| HTTP channel ของ eve: `POST /eve/v1/session` และ `POST /eve/v1/session/:sessionId` | `message` และ `clientContext` ใน JSON body · ข้อความบน route สร้าง session จะถูกส่งเป็นข้อความแรกของ session ที่สร้างขึ้นก่อนหน้านั้นทันที token จึงเป็นของ session นั้น |
| `respond()` — คำตอบของการอนุมัติและคำถาม | **ไม่ตรวจ** |

ตัวเลือก: `guard` · `sessionKey` · `channelName` (ต้องใส่ ยกเว้น HTTP channel ของ eve) · `files` (`'pass'` ค่าตั้งต้น หรือ `'block'`) · `onBlock({ reason, blockedBy })` · `language` (`'th'` ค่าตั้งต้น) · `policy` และ `allowRawTokensInOutput` (ดูข้างล่าง)

ข้อความที่ถูก block จะไม่ถูกส่ง: `onBlock` ทำงาน แล้ว send จะ throw `PdpaBlockedError` (channel ของ eve จับไว้และเขียน log) · บน route HTTP ของ eve ตอบ `422 { ok: false, code: "pdpa_blocked", error }` · token store ล่มก็ block เหมือนกัน แต่ใช้ข้อความบอกเหตุผลอีกแบบ

**token ในคำตอบ** · HTTP channel ของ eve stream คำตอบตามที่โมเดลเขียน `[tok:…]` ที่โมเดลพิมพ์ซ้ำจึงไปถึงผู้เรียก · ห่อ channel นี้ด้วย `policy` ที่มี tokenise จะ throw เว้นแต่ตั้ง `allowRawTokensInOutput: true` — ใช้ในเครื่องเท่านั้น · guard ของ core ไม่เปิดให้อ่าน policy จึงต้องส่ง `policy` มาเพื่อตรวจตอนห่อ · ถ้าไม่ส่ง ข้อความแรกที่จะถูก tokenise บน channel นี้จะถูกปฏิเสธด้วย `500 pdpa_config`

## `withTokenResolution(tool, { guard, sessionKey, purpose, fields? })`

ใน `execute`: token ทุกตัวใน input (หรือเฉพาะ `fields` เช่น `['phone']`) ถูกแลกด้วย `guard.resolve(token, { purpose, sessionId })` · `execute` เดิมทำงานกับค่าจริง · ผลลัพธ์ผ่าน guard ที่ `tool_output` ก่อนคืน — eve stream และเก็บผลของ tool ไว้ จึงต้องปิดตรงนี้ ไม่ใช่แค่ตอนส่งให้โมเดล

ถ้า token ใช้ไม่ได้ — หมดอายุ · เป็นของแชตอื่น · purpose ไม่ได้รับอนุญาต · store ล่ม — `execute` เดิม**ไม่ถูกเรียก** · โมเดลได้ `{ ok: false, reason, ask }` เช่น `{ ok: false, reason: 'expired', ask: 'The value has expired. Ask the customer for it again.' }` · description, schema, approval และ label คงเดิม · tool แบบ generator ยังเป็น generator

## `guardModel(model, { guard, sessionKey })`

ห่อโมเดลของ AI SDK (หรือ gateway id ที่เป็น string) ด้วย `wrapLanguageModel` · ข้อความทุกส่วนของทุก prompt ผ่าน guard ที่ `prompt` รวมผลจาก tool · ข้อความที่ policy สั่ง block กลายเป็น `[ข้อมูลที่ปิดไว้]`

- **ต้องห่อโมเดลของ subagent และโมเดลสำหรับ compaction แยกด้วย** — แต่ละตัวเรียก provider เอง
- **ตัวนี้ไม่ได้ปิดสิ่งที่โมเดลตอบ** — เป็นหน้าที่ของ Slack renderer บน Slack
- ตั้ง `modelContextWindowTokens` ให้ agent: eve หาขนาด context จาก id ของโมเดล แต่โมเดล gateway ที่ห่อแล้วรายงานตัวเป็น `gateway/<id>`
- หลัง deploy บน Vercel ให้ตรวจว่าโมเดลที่ห่อแล้วยังยืนยันตัวตนผ่าน OIDC ได้: ส่ง 1 ข้อความ แล้วดูว่าได้คำตอบ และมี `scan` ที่ `boundary: "prompt"`

## `pdpaSlackRenderer({ guard, sessionKey })`

Slack renderer สำหรับ `message.completed`: คำตอบผ่าน guard ที่ `outbound` · token แสดงในรูปที่ปิดบางส่วน · token ที่ไม่รู้จักหรือของแชตอื่นเป็น `[ข้อมูลที่ปิดไว้]` · คำตอบที่ policy สั่ง block ถูกแทนด้วยข้อความแจ้ง · ข้อความที่โมเดลพิมพ์ก่อนเรียก tool ก็ถูกปิดด้วย (Slack แสดงเป็นสถานะของ thread) · คำถาม การอนุมัติ และการ sign-in ใช้ค่าตั้งต้นของ eve

## `pdpaHook({ guard, sessionKey, files?, blockOn? })`

ลงทะเบียนใน `agent/hooks/pdpa.ts` · ตอน `message.received` เก็บ pdpa id ของ session (tool มองไม่เห็น address ของ channel) และยกเลิก turn เมื่อข้อความมีข้อมูลที่ policy สั่ง block หรือประเภทที่อยู่ใน `blockOn` · ตอน `session.completed` และ `session.failed` เรียก `guard.endSession` · `reset` ของ eve ไม่ส่ง event ให้ hook — token เหล่านั้นหมดอายุตาม `ttlSec`

default export ของแพ็กเกจ mount hook ตัวเดียวกันเป็น extension — `pdpa({ guard, sessionKey })` ใน `agent/extensions/pdpa.ts` — สำหรับ setup ที่ไม่ใช้ tokenise · ถ้าใช้ tokenise ให้ลงทะเบียน hook ใน `agent/hooks/` เพื่อให้ใช้ session state ร่วมกับ tool ได้

## Session id

core เขียน `sessionId` ลงทุก audit event และใช้แยก token ของแต่ละแชต และเตือนว่าอย่าใช้ id ของแพลตฟอร์ม · ทุกชั้นจึงคำนวณเอง:

```text
"eve_" + base32(HMAC-SHA256(sessionKey, conversation)).slice(0, 26)
conversation = "<channelName>:<address>"   หรือ   "session:<eve session id>"  (HTTP channel ของ eve)
```

`derivePdpaSessionId(sessionKey, conversation)` export ไว้ให้โค้ดของคุณใช้ เช่น tool ที่เรียก `guard.resolve` เอง

## `guardContent(content, { guard, sessionId, boundary?, files? })`

ฟังก์ชันข้างใต้: ปิดข้อมูลใน string หรือ `UserContent` ของ AI SDK แบบ async · คืน `{ blocked: false, content }` หรือ `{ blocked: true, reason, blockedBy }`

## ข้อจำกัดที่ควรรู้

- **ขาออกปกป้องได้เฉพาะ Slack** · Teams, Telegram, Discord, channel ที่เขียนเอง และ HTTP channel ของ eve (รวมหน้าเว็บที่ใช้ `useEveAgent`) ส่งคำตอบตามที่โมเดลเขียน
- **`respond()` ไม่ถูกตรวจ** — คำตอบแบบมีโครงสร้างของการอนุมัติและคำถาม ซึ่งมีข้อความอิสระได้
- **token ที่ออกระหว่างส่งต่องานด้วย `to()` แลกกลับไม่ได้** ใน session ของ channel ปลายทาง
- **subagent** มี session state ของตัวเอง: tool ใน subagent แลก token ของ agent แม่ไม่ได้
- **route สร้าง session ของ eve**: request ที่มีข้อความพร้อม `callback` หรือ `operationId` ถูกปฏิเสธ (`400 pdpa_unsupported`) — ให้สร้าง session ก่อนแล้วค่อยส่งข้อความ
- **ตรวจทีละ text part** · ไม่ตรวจเนื้อหาไฟล์และชื่อไฟล์ (ใช้ `files: 'block'` เพื่อหยุดข้อความแบบนี้)
- **ยังไม่ตรวจชื่อและที่อยู่** (core)
- เลขบัตรประชาชนที่บังเอิญผ่าน checksum ของบัตรเครดิตและอยู่ในช่วงเลขผู้ออกบัตร core จะอ่านเป็นบัตรเครดิต — ถูก block ภายใต้ policy ที่ block บัตร
- route HTTP ของ eve ถูกจำด้วย method และ path · รันเทสต์ก่อนเปลี่ยนรุ่น eve

## สิ่งที่ต้องมี

Node 24 ขึ้นไป · eve 0.80.1 (ทดสอบแล้ว) · AI SDK 7 (`ai` เป็น peer เหมือนของ eve)

## แจ้งช่องโหว่

**อย่าเปิด issue สาธารณะ** · อีเมลไปที่ **kunlachat@m-intelligence.tech** หัวเรื่องขึ้นต้นด้วย `[eve-pdpa-extension security]` · ทำซ้ำด้วยค่าสมมติ ห้ามส่งข้อมูลส่วนบุคคลจริง

## License

Apache-2.0
