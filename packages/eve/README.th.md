# @eve-pdpa-extension/eve

ปิดข้อมูลส่วนบุคคลไทยใน channel ของ agent ที่สร้างด้วย [eve](https://eve.dev) — ก่อน eve บันทึกข้อความ ก่อน hook ใดได้เห็น และก่อนโมเดลได้อ่าน

- ห่อได้ทุก channel ของ eve: HTTP channel ของ eve เอง · Slack · Teams · Telegram · Chat SDK bridge (LINE และอื่น ๆ) · `defineChannel` ที่เขียนเอง
- ปิดด้วย [`@eve-pdpa-extension/core`](../core): เลขบัตรประชาชน · เบอร์โทร · อีเมล · เลขบัญชี · บัตรเครดิต · LINE user ID
- ข้อความที่ policy สั่ง block จะไม่ถูกส่งให้ eve เลย · ทุกครั้งที่ตรวจมี audit event ที่**ไม่มีค่าจริงอยู่ข้างใน**
- Node 24 ขึ้นไป · ทดสอบกับ eve **0.80.1** — eve ยังเป็น beta และ API เปลี่ยนบ่อย · ดู[สิ่งที่ต้องมี](#สิ่งที่ต้องมี)

> **เป็นเครื่องมือทางเทคนิค ไม่ใช่ใบรับรองการปฏิบัติตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล**
> การใช้แพ็กเกจนี้ไม่ได้ทำให้ agent ของคุณปฏิบัติตามกฎหมายครบถ้วนโดยอัตโนมัติ

> **0.1.0 ยังไม่ขึ้น npm** · แพ็กเกจตั้ง `"private": true` ไว้จนกว่าจะออก release · ระหว่างนี้ใช้จาก workspace ของ repo นี้ — ดู [`examples/line-agent`](../../examples/line-agent)

[English](./README.md)

---

## ปิดข้อมูลตรงไหน

```
ลูกค้า ──▶ channel ──▶ [ ปิดตรงนี้ ] ──▶ eve บันทึกข้อความ ──▶ hook ──▶ โมเดล
                        withPdpaGuard
                        guardChatSdk
```

**ใช้ hook ของ eve ทำงานนี้ไม่ได้** · เอกสาร eve ระบุว่า hook ทำงาน*หลัง* eve บันทึก event ลงที่เก็บถาวรแล้ว ดูได้อย่างเดียว และเปลี่ยนสิ่งที่โมเดลอ่านไม่ได้ · จุดเดียวที่ยังแก้ข้อความขาเข้าได้คือใน channel ตอนที่ส่งให้ eve ด้วย `send()` · แพ็กเกจนี้จึงห่อ channel และมี hook ให้เป็นด่านที่สองเท่านั้น: ยกเลิก turn ที่ข้อความมีข้อมูลที่ policy สั่ง block เผื่อมี channel ไหนลืมห่อ

## ติดตั้ง

```bash
npm install @eve-pdpa-extension/eve
```

`eve` เป็น peer dependency · ใช้ eve ตัวที่ agent ของคุณติดตั้งไว้

## เริ่มใช้

**1. HTTP channel ของ eve** — route ที่ `eve dev`, `curl`, client SDK และ `useEveAgent` คุยด้วย · สร้างไฟล์ `agent/channels/eve.ts` เพื่อแทนตัว default ด้วยตัวที่ห่อแล้ว:

```ts
// agent/channels/eve.ts
import { withPdpaGuard } from '@eve-pdpa-extension/eve/guard'
import { localDev, placeholderAuth, vercelOidc } from 'eve/channels/auth'
import { eveChannel } from 'eve/channels/eve'

export default withPdpaGuard(eveChannel({ auth: [vercelOidc(), localDev(), placeholderAuth()] }), {
  onAudit: (event) => console.log(JSON.stringify(event)),   // ระบบจริงเขียนลงที่เก็บ audit ของคุณ
})
```

**2. channel อื่น** — ห่อค่าที่เดิมจะ export ออกไป (`onAudit` ข้างล่างคือที่เก็บ audit แบบในข้อ 1)

```ts
// agent/channels/slack.ts
import { withPdpaGuard } from '@eve-pdpa-extension/eve/guard'
import { slackChannel } from 'eve/channels/slack'

export default withPdpaGuard(slackChannel(), { onAudit })
```

**3. Chat SDK bridge** (LINE, WhatsApp, อีเมล ฯลฯ) — ห่อ `send` ที่ `chatSdkChannel` คืนมา:

```ts
// agent/channels/line.ts
import { createMemoryState } from '@chat-adapter/state-memory'
import { guardChatSdk, PdpaBlockedError } from '@eve-pdpa-extension/eve/guard'
import type { Thread } from 'chat'
import { createLineAdapter } from 'chat-adapter-line'
import { chatSdkChannel } from 'eve/channels/chat-sdk'

const { bot, channel, send } = chatSdkChannel({
  userName: 'my-shop',
  adapters: { line: createLineAdapter() },
  state: createMemoryState(),
  streaming: false,
})

const guardedSend = guardChatSdk(send, {
  onAudit,
  // บอกลูกค้าว่าทำไมไม่มีคำตอบ · reason บอกแค่ประเภทข้อมูล ไม่มีตัวข้อมูล
  onBlock: async ({ reason, thread }) => {
    await (thread as Thread).post(reason)
  },
})

bot.onDirectMessage(async (thread, message) => {
  try {
    await guardedSend(message.text, { thread })
  } catch (error) {
    if (!(error instanceof PdpaBlockedError)) throw error
  }
})

export default channel
```

**4. extension** (ไม่บังคับ · ด่านที่สอง) — mount ไว้เพื่อยกเลิก turn ที่ข้อความมีข้อมูลที่ policy สั่ง block:

```ts
// agent/extensions/pdpa.ts
import pdpa from '@eve-pdpa-extension/eve'

export default pdpa({ onAudit })   // หรือ pdpa({ policy, onAudit })
```

agent ที่รันได้จริงและมีครบทั้ง 4 ข้อ อยู่ที่ [`examples/line-agent`](../../examples/line-agent)

### ผลลัพธ์

ลูกค้าพิมพ์:

```
เลขบัตร 2-3570-37506-24-2 โทร 091-888-7777 เมล somchai@example.com
```

สิ่งที่ eve บันทึก hook เห็น และโมเดลอ่าน (ตาม [policy ตั้งต้น](#default_policy)):

```
เลขบัตร [เลขบัตรประชาชน] โทร xxx-xxx-7777 เมล [อีเมล]
```

ข้อความที่มีเลขบัตรเครดิตจะไม่ถูกส่งให้ eve เลย

---

## `withPdpaGuard(channel, options?)`

คืน channel ชุดใหม่ที่ทุกข้อความขาเข้าถูกปิดก่อน · ทุก route คง method, path และ transport เดิม · field อื่นของ channel ทั้งหมด — adapter, events, ข้อมูลตอน build เช่น app manifest ของ Slack — ส่งต่อตามเดิม

ครอบคลุมอะไรบ้าง:

| operation | สิ่งที่ถูกปิด |
|---|---|
| `from(address).send(message, options)` — ช่องทางที่ channel สำเร็จรูปของ eve และ Chat SDK bridge ใช้ | ตัวข้อความ · `options.context` · `options.title` |
| `attachSession(id).send(...)` · `to(channel, target).send(...)` | เหมือนกัน |
| `receive(input, ctx)` — งานที่ channel อื่นส่ง**เข้ามา**ที่ channel นี้ | `ctx.from(...).send(...)` เหมือนข้างบน |
| WebSocket route (`WS(...)`) | hook ที่ route คืนมาจะส่งผ่าน operation ที่ห่อแล้ว |
| route HTTP ของ eve: `POST /eve/v1/session` และ `POST /eve/v1/session/:sessionId` | `message` และ `clientContext` ใน JSON body ก่อน eve อ่าน ¹ |
| `respond(...)` — คำตอบของ prompt อนุมัติหรือคำถาม | **ไม่ตรวจ** ส่งต่อตามเดิม |

¹ ใน eve 0.80.1 การสร้าง session ผ่าน HTTP ไม่ได้วิ่งผ่าน `from().send()` · ถ้าห่อแค่ operation จะพลาดข้อความแรกของทุก session · สำหรับ 2 route นี้ตัวห่อจึงปิดข้อมูลใน request body เอง ตามสัญญา HTTP ที่ eve เปิดเผยไว้

**เมื่อ policy สั่ง block** ข้อความจะไม่ถูกส่ง: เรียก `onBlock({ address, reason })` ก่อน แล้ว

- route HTTP ของ eve ตอบ `422` เป็น `{ "ok": false, "code": "pdpa_blocked", "error": "<reason>" }`
- ที่อื่น `send()` จะ throw `PdpaBlockedError` · channel สำเร็จรูปของ eve จับ error นี้แล้วเขียน log (Slack เขียน `delivery failed`) · ลูกค้าจะไม่ได้ยินอะไรเลย ถ้า `onBlock` ไม่บอก

## `guardChatSdk(send, options?)`

ห่อ `send` ที่ `chatSdkChannel` คืนมา · signature เหมือน `send` เดิม · ปิดทั้งข้อความ และ `context` หรือ `title` ที่ส่งมาด้วย · ถ้าถูก block จะเรียก `onBlock({ reason, thread })` แล้ว throw `PdpaBlockedError` โดยไม่เรียก `send`

กับ Chat SDK channel ให้ใช้ `guardChatSdk(send)` **หรือ** `withPdpaGuard(channel)` **อย่างใดอย่างหนึ่ง** · ใช้ทั้งคู่ ข้อความจะถูกตรวจสองรอบ และ audit จะมี 2 event ต่อข้อความเดียว

## `guardContent(content, options?)`

ฟังก์ชันที่อยู่ข้างใต้ทุกตัว · ทำงานแบบ sync · รับ string หรือ `UserContent` ของ AI SDK แล้วคืน

```text
| { blocked: false; content; events }   // content: string ใหม่ หรือ array ใหม่ที่ text part ถูกปิดแล้ว
| { blocked: true;  reason;  events }   // reason: แสดงให้ลูกค้าเห็นได้
```

- text part ถูกปิดตามลำดับเดิม · part รูปภาพและไฟล์ส่งต่อเป็น object เดิม หรือทำให้ทั้งข้อความถูก block ถ้าตั้ง `files: 'block'`
- text part ใดถูก block ส่วนเดียว ทั้งข้อความถูก block
- ไม่แก้ input · ถ้าไม่มีอะไรต้องปิด array ที่ส่งเข้ามาจะได้คืนเป็นตัวเดิม
- core guard ข้างใต้ถูกสร้างครั้งเดียวต่อ `options` 1 object — ส่ง object เดิมทุกครั้ง อย่าเขียน `{ ... }` ใหม่ในทุก call

## `pdpaBlockHook(options?)` และ extension

`pdpaBlockHook` คืน hook ของ eve ที่ฟัง `message.received` · ถ้าข้อความที่บันทึกแล้วมีข้อมูลที่ policy สั่ง block จะเรียก `ctx.cancel()` ให้ turn จบก่อนโมเดลทำงาน · ทุกข้อความยังถูกตรวจอีกรอบเพื่อ audit (`source: 'hook'`)

hook **ไม่ปิดข้อมูล** — ตอนที่ทำงาน eve บันทึกข้อความไปแล้ว · ใช้เสริมตัวห่อ channel เสมอ ห้ามใช้แทน

default export ของแพ็กเกจ mount hook นี้เป็น extension · config:

| field | ความหมาย |
|---|---|
| `policy` | policy ในรูปที่ `definePolicy` ของ core รับ (JSON ของไฟล์ policy ที่ parse แล้ว) · ค่าตั้งต้น: [`DEFAULT_POLICY`](#default_policy) |
| `hmacKey` | สำหรับ policy ที่ใช้ `hash` |
| `files` | `'block'` ยกเลิก turn ที่ข้อความมีไฟล์ · ค่าตั้งต้น `'pass'` |
| `onAudit` · `onError` | เหมือนใน[ตัวเลือก](#ตัวเลือก) |

config ผิดจะ error ตอน mount โดยบอกชื่อ field ไม่บอกค่า: `Invalid extension config: policy: entities.PHONE.action: expected one of …`

## ตัวเลือก

ใช้ร่วมกันทุกฟังก์ชันข้างบน

| ตัวเลือก | ค่าตั้งต้น | ความหมาย |
|---|---|---|
| `policy` | `DEFAULT_POLICY` | จาก `definePolicy` หรือ `parsePolicy` ของ core |
| `hmacKey` | — | สำหรับ policy ที่ใช้ `hash` · อย่างน้อย 32 byte (`openssl rand -hex 32`) |
| `files` | `'pass'` | `'pass'`: part รูปภาพและไฟล์ผ่านไปตามเดิม ไม่ถูกตรวจ · `'block'`: ทำให้ข้อความถูก block |
| `onAudit(event, ctx)` | ทิ้ง พร้อมเตือน 1 ครั้ง | audit event ทุกตัวจาก core · `ctx.source` เป็น `'channel'` `'chat-sdk'` `'hook'` หรือ `'direct'` · `ctx.address` คือ id บทสนทนาของแพลตฟอร์ม |
| `onError(error, ctx)` | — | แจ้งความผิดพลาดที่ core จับไว้แทนการ throw เช่น `onAudit` ที่ throw |
| `onBlock(info)` | — | เฉพาะ `withPdpaGuard` และ `guardChatSdk` · เรียก 1 ครั้งต่อข้อความที่ถูก block · ถ้า throw จะกลายเป็น `cause` ของ `PdpaBlockedError` |
| `detectors` | ชุดในตัวของ core | แทน detector ของ core ทั้งชุด เหมือน `createGuard` ของ core |

policy ที่ใช้ `tokenise` จะถูกปฏิเสธตอนสร้างตัวห่อ — ดู[ข้อจำกัด](#ข้อจำกัดที่ควรรู้)

### `DEFAULT_POLICY`

core ไม่มี policy ตั้งต้น แพ็กเกจนี้จึงมีให้ · ไม่มี `tokenise` และ `hash` จึงไม่ต้องมี key หรือที่เก็บ token:

| ประเภท | action | โมเดลเห็น |
|---|---|---|
| `TH_NATIONAL_ID` | `redact` | `[เลขบัตรประชาชน]` |
| `PHONE` | `mask` เก็บ 4 ตัวท้าย | `xxx-xxx-7777` |
| `EMAIL` | `redact` | `[อีเมล]` |
| `BANK_ACCOUNT` | `mask` เก็บ 4 ตัวท้าย | `xxx-x-xx789-0` |
| `LINE_USER_ID` | `redact` | `[LINE ID]` |
| `CREDIT_CARD` | `block` ตั้งแต่ confidence 0.6 | ไม่เห็นอะไร — ข้อความถูกหยุด |

เขียน policy เองด้วย `definePolicy` ของ core — ดู [README ของ core](../core/README.th.md#policy)

## Audit

`onAudit` ได้ event ของ core ตามเดิม — `policy.loaded` 1 ครั้งตอนสร้างตัวห่อแต่ละตัว แล้ว `scan` 1 ครั้งต่อ string ที่ตรวจ (ตัวข้อความ และ `context` แต่ละรายการกับ `title` ถ้ามี) · event มีแค่ตำแหน่งและประเภท ไม่มีค่าจริง · โครงสร้างตาม `audit-event.schema.json` ของ core

> **`ctx.address` มักเป็นข้อมูลส่วนบุคคลเอง** — thread id ของ LINE มี LINE user id ของลูกค้าอยู่ข้างใน · address ของ Twilio คือเบอร์โทร
> ให้ hash ก่อนเก็บรวมกับ audit หรือไม่เก็บเลย

scan event มี `sessionId: "anonymous"` · ตัวห่อไม่รู้ session id ที่ปลอดภัยพอจะเขียนลง log

## Error ที่ควรรู้

| error | เกิดเมื่อ |
|---|---|
| `PdpaBlockedError` (`code: 'PDPA_BLOCKED'`) | `send` ที่ห่อไว้ถูกหยุด · `reason` และ `message` บอกแค่ประเภทข้อมูล |
| `PdpaError` `ERR_PDPA_INVALID_POLICY` | throw ตอนสร้างตัวห่อ: policy ไม่ได้มาจาก `definePolicy`/`parsePolicy` หรือใช้ `tokenise` |
| `PdpaError` `ERR_PDPA_HMAC_KEY` | throw ตอนสร้างตัวห่อ: policy ใช้ `hash` แต่ไม่มี `hmacKey` หรือสั้นกว่า 32 byte |
| `TypeError` | ข้อความ part `context` หรือ `title` มีรูปแบบที่อ่านไม่ได้ · ถูกปฏิเสธ ไม่ปล่อยผ่านโดยไม่ตรวจ · บน route HTTP ของ eve จะตอบ `400` |

## ข้อจำกัดที่ควรรู้

- **ปิดเฉพาะขาเข้า** · คำตอบของโมเดล ข้อความที่ stream และข้อความขาออกไม่ถูกปิด
- **ไม่ตรวจ input/output ของ tool, ผลจาก connection MCP และ OpenAPI และ memory ที่ดึงกลับมา**
- **ปฏิเสธ `tokenise`** · ยังไม่มีทางให้ tool แลก token กลับเป็นค่าจริง · token จะไปถึงโมเดลเป็นตัวแทนที่ไม่มีใครแลกคืนได้ · `redact` `mask` `hash` `flag` `block` ใช้ได้
- **ไม่ตรวจเนื้อหาไฟล์และรูปภาพ และไม่ตรวจชื่อไฟล์** · ใช้ `files: 'block'` เพื่อหยุดข้อความแบบนี้แทน
- **`respond()` ผ่านไปตามเดิม** · คำตอบ prompt อนุมัติหรือคำถามที่ส่งเป็น structured input response — ซึ่งมีข้อความอิสระได้ — ไม่ถูกตรวจ · ส่วนข้อความที่ลูกค้าพิมพ์ตอบเองวิ่งผ่าน `send()` และถูกปิด
- **บน HTTP channel ของ eve `context` และ `title` ที่ `onMessage` ของคุณคืนมาไม่ถูกตรวจ** — ข้อความที่ `onMessage` ได้รับถูกปิดไปแล้ว อะไรที่คัดลอกจากข้อความจึงถูกปิดด้วย · route ระหว่าง agent ของ eve (`/eve/v1/callback/…`, `/eve/v1/task-input/…`) ไม่ถูกตรวจ
- **ตรวจทีละ text part** — เลขที่ถูกแยกอยู่ 2 part จะหาไม่เจอ
- **เลขบัตรประชาชนที่บังเอิญผ่าน checksum ของบัตรเครดิตและอยู่ในช่วงเลขของผู้ออกบัตร core จะอ่านเป็นบัตรเครดิต** · ภายใต้ `DEFAULT_POLICY` ข้อความจึงถูก block แทนการ redact — core เลือก action ที่เข้มกว่าเมื่อประเภทซ้อนกัน
- **route HTTP ของ eve ถูกจำด้วย method และ path** (`POST /eve/v1/session`, `POST /eve/v1/session/:sessionId`) · ถ้า eve รุ่นหลังย้าย route ให้รัน integration test ของแพ็กเกจนี้ก่อนอัปเกรด
- ยังไม่ตรวจชื่อและที่อยู่ — ดูข้อจำกัดของ core

## สิ่งที่ต้องมี

- **Node 24 ขึ้นไป** — ขั้นต่ำของ eve เอง (core รองรับ Node 18.18 แต่แพ็กเกจนี้ไม่)
- **eve**: ทดสอบกับ **0.80.1** · eve ยังเป็น beta · รันเทสต์ของแพ็กเกจนี้ก่อนเปลี่ยนไปใช้ eve รุ่นใหม่
- AI SDK 7 (`ai`) ซึ่ง eve ต้องใช้อยู่แล้ว

## แจ้งช่องโหว่

**อย่าเปิด issue สาธารณะ** · อีเมลไปที่ **kunlachat@m-intelligence.tech** หัวเรื่องขึ้นต้นด้วย `[eve-pdpa-extension security]` · ทำซ้ำด้วยค่าสมมติ ห้ามส่งข้อมูลส่วนบุคคลจริง

## License

Apache-2.0
