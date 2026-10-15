# @eve-pdpa-extension/eve

Adapter สำหรับ [eve](https://eve.dev) — durable AI agent framework ของ Vercel OSS

**เริ่มทำได้แล้ว** (เดิมเขียนว่ายังเริ่มไม่ได้ เพราะยังไม่ยืนยัน hook API) — ค้น public docs
เมื่อ 18 กันยายน 2026 ได้คำตอบครบ รายละเอียดอยู่ในเอกสารออกแบบ `eve-integration.th.md`
ซึ่งเก็บไว้นอก repo

## ต้อง ship สองอย่าง ไม่ใช่อย่างเดียว

```
channel wrapper   ปกป้องข้อมูล — inbound + outbound
audit hook        ส่ง audit event ออก — ต่อกับ onAudit ของ D3
```

## 🔴 `agent/hooks/` ใช้ปกป้องข้อมูลไม่ได้

เอกสาร eve ระบุเอง

> "Handlers are observe-only. They cannot inject model context."
> "Return values are ignored."
> "Hooks always run after the event is durably recorded"

**ข้อมูลถูกบันทึกลง durable stream ไปแล้วก่อน hook จะได้แตะ** — redact ทีหลังไม่ช่วยอะไร

hook ยังใช้ได้ แต่ใช้กับ **audit เท่านั้น** ซึ่งตรงกับที่มันออกแบบมาพอดี

## ✅ จุดที่ถูกต้องคือ `agent/channels/`

```ts
POST('/line/webhook', async (request, { from, params }) => {
  const body = await request.json()

  // ก่อน send() คือก่อนที่ eve จะบันทึกอะไรทั้งสิ้น
  const safe = guard.processSync(body.message, { boundary: 'inbound' })
  if (safe.outcome === 'blocked') return new Response('blocked', { status: 422 })

  await from(params.threadId).send(safe.text, { auth: null })
})
```

`block` ของ D4 ทำได้สะอาดกว่าที่ออกแบบไว้ — คืน HTTP response ไปเลย ไม่มี session
ถูกสร้าง ไม่มี event ถูกบันทึก

## ประสานกับงาน LINE channel

eve **ไม่มี LINE channel ให้** (ตรวจ sitemap แล้ว) ทีมกำลังเขียน custom channel อยู่ตาม
Notion "Mini Project — LINE Channel integrations for vercel chat-sdk and eve.dev"

**ไฟล์นั้นคือที่เดียวกับที่ PDPA protection ต้องไปอยู่** — สองงานนี้ต้องคุยกัน

## ยังไม่ทำ

**ยังไม่มี `package.json` โดยตั้งใจ** — pnpm จึงมองไม่เห็นโฟลเดอร์นี้ และ CI ไม่รายงานว่า
build/test "ผ่าน" สำหรับแพ็กเกจที่ยังไม่มีโค้ด

เริ่มทำจริงเมื่อไหร่ ให้เพิ่ม `package.json` — pnpm เห็นทันทีในรอบ install ถัดไป

## หมายเหตุ

eve เป็น **beta** ตามที่เอกสารระบุเอง → pin version ตามที่ตาราง risk ในสเปกกำหนด
