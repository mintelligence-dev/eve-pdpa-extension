# @eve-pdpa-extension/eve

Adapter สำหรับ [eve](https://eve.dev) — durable AI agent framework ของ Vercel OSS

**เริ่มทำได้แล้ว** — แบบละเอียดอยู่ใน `eve-integration.th.md` ซึ่งเก็บไว้นอก repo
(อ่าน public docs ของ eve ครั้งแรก 18 กันยายน 2026 · อัปเดต 16 ตุลาคม 2026 เป็นแบบตัวห่อกลาง)

## ใช้อย่างไร

ไม่ต้องแก้ eve และไม่ต้องเขียน channel ใหม่ — ห่อ channel ที่มีอยู่แล้วในโปรเจกต์บอท

```ts
// agent/channels/slack.ts
import { slackChannel } from 'eve/channels/slack'
import { protectChannel } from '@eve-pdpa-extension/eve'

export default protectChannel(slackChannel(), { guard })
```

ยังเป็นแบบ ยังไม่มีโค้ด

## ต้อง ship สามอย่าง

```
protectChannel   ขาเข้า — ห่อ from(address).send() ครั้งเดียว ใช้ได้ทุก channel
ตัวห่อขาออก       ทีละตระกูล channel — Slack renderers · Chat SDK / Telegram events
audit hook       ส่ง audit event ออก — ต่อกับ onAudit ของ D3
```

### ขาเข้า — จุดเดียว

เอกสาร eve ระบุว่า channel Slack, Teams, Telegram และ Chat SDK ส่งทุกข้อความเข้า eve ผ่าน
`from(address).send()` และให้ห่อ route ของ channel ที่มีอยู่ได้ (*Wrap an existing channel's
routes*) · ห่อ `send` ตรงนั้น ข้อความถูกปิดก่อน eve บันทึกอะไรทั้งสิ้น

### ขาออก — ไม่มีจุดกลาง

แต่ละ channel ส่งคำตอบด้วยกลไกของตัวเอง

| channel | วิธี | สถานะ |
|---|---|---|
| Slack | `renderers` — `next({ ...event, message })` ด้วยข้อความที่ปิดแล้ว | ✅ เอกสาร eve ยกตัวอย่าง redaction เอง |
| Chat SDK | `events['message.completed']` · ต้องปิด streaming ด้วย ไม่อย่างนั้นข้อความไปถึงผู้ใช้ทีละท่อนก่อนตรวจ | ⚠️ ต้องลอง |
| Telegram | `events['message.completed']` | ⚠️ ต้องลอง |
| Teams | | ❓ |

## 🔴 `agent/hooks/` ใช้ปกป้องข้อมูลไม่ได้

เอกสาร eve ระบุเอง

> "Handlers are observe-only. They cannot inject model context."
> "Return values are ignored."
> "Hooks always run after the event is durably recorded"

**ข้อมูลถูกบันทึกลง durable stream ไปแล้วก่อน hook จะได้แตะ** — redact ทีหลังไม่ช่วยอะไร

hook ยังใช้ได้ แต่ใช้กับ **audit เท่านั้น** ซึ่งตรงกับที่มันออกแบบมาพอดี · แจกเป็น
[eve Extension](https://eve.dev/docs/extensions) ได้

## LINE

eve **ยังไม่มี LINE channel** · ถ้า LINE ทำเป็น Chat SDK adapter ต่อเข้า eve ผ่าน
`chatSdkChannel` ตัวห่อครอบได้ทันทีโดยไม่ต้องแก้ไฟล์ channel นั้น

## ยังไม่ทำ

**ยังไม่มี `package.json` โดยตั้งใจ** — pnpm จึงมองไม่เห็นโฟลเดอร์นี้ และ CI ไม่รายงานว่า
build/test "ผ่าน" สำหรับแพ็กเกจที่ยังไม่มีโค้ด

เริ่มทำจริงเมื่อไหร่ ให้เพิ่ม `package.json` — pnpm เห็นทันทีในรอบ install ถัดไป

## หมายเหตุ

- eve เป็น **beta** ตามที่เอกสารระบุเอง → pin version ตามที่ตาราง risk ในสเปกกำหนด · `eve` เป็น `peerDependencies`
- eve ต้องการ **Node 24** — แพ็กเกจนี้ตาม · core ยังรองรับ Node 18.18
- `onError` ค่าตั้งต้นเป็น `block` ตาม D4
