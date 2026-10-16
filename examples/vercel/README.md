# ตัวอย่าง: webhook บน Vercel

ตั้ง `@eve-pdpa-extension/http` เป็น webhook คั่นระหว่างแอปแชทกับระบบที่ตอบ (เช่น AI) · ปิดข้อมูลส่วนบุคคลทั้งขาเข้าและขาออก

> ⚠️ **ยัง deploy ไม่ได้** — ตัวอย่างดึง `@eve-pdpa-extension/http` จาก npm ซึ่งยังไม่ได้ปล่อย

```
แอปแชท ──POST /api/inbound──▶  webhook  ──▶ FORWARD_URL (ระบบที่ตอบ)
แอปแชท ◀──────── REPLY_URL ◀── webhook ◀──POST /api/outbound── ระบบที่ตอบ
ระบบส่ง OTP ──POST /api/resolve──▶ webhook ──▶ เบอร์จริง (เฉพาะ purpose otp_send)
แอปแชท ──POST /api/end-session──▶ webhook ──▶ ลบ token ของห้องนั้น
```

## ไฟล์

| ไฟล์ | |
|---|---|
| `policies/default.json` | บอทที่ตอบคำถามทั่วไป · ปิดทุกอย่าง ไม่มี tokenise |
| `policies/otp.json` | บอทที่ส่ง OTP · tokenise แค่เบอร์ แลกได้เฉพาะ `otp_send` |
| `lib/webhook.ts` | สร้าง webhook ครั้งเดียวต่อ cold start · audit ลง `console.log` |
| `api/*.ts` | 4 route · แต่ละไฟล์เรียก handler หนึ่งตัว |
| `vercel.json` | ส่ง `policies/` ไปกับทุก function |

## ตั้งค่า (Vercel → Project → Settings → Environment Variables)

| ตัวแปร | ค่า |
|---|---|
| `PDPA_SECRET` | `openssl rand -hex 32` · ให้แอปแชทและระบบที่ตอบใช้เซ็น request |
| `FORWARD_URL` · `REPLY_URL` | **ไม่บังคับ** · ค่าตั้งต้นเมื่อ request ไม่ได้ระบุ `forwardTo` / `replyTo` |
| `ALLOWED_DESTINATIONS` | **ไม่บังคับ** · URL แบบ https คั่นด้วย `,` · ตั้งแล้ว request ระบุได้เฉพาะปลายทางในรายการ |
| `PDPA_RESOLVE_SECRET` | `openssl rand -hex 32` อีกค่า · ให้เฉพาะระบบที่ต้องใช้ค่าจริง |
| `UPSTASH_REDIS_REST_URL` · `UPSTASH_REDIS_REST_TOKEN` | Vercel → Storage → Upstash Redis · Vercel ใส่ให้เมื่อเชื่อมกับโปรเจกต์ |

ไม่มีบอทไหนต้องใช้ค่าจริง: ลบ `otp` ออกจาก `policies` แล้วลบ `resolveSecret` กับ `tokenStore` ใน `lib/webhook.ts` · ไม่ต้องตั้งสามค่าล่าง ไม่ต้องมี Upstash

**Upstash เก็บค่าจริงไว้จนกว่า token หมดอายุ** · เลือก region ใกล้ที่สุด · การส่งข้อมูลส่วนบุคคลไปเก็บนอกประเทศ ให้ DPO รับรู้

## ส่ง request เข้า

```ts
import { signRequest } from '@eve-pdpa-extension/http'

const body = JSON.stringify({
  policy: 'otp',
  sessionId: 'conv_8f2a',
  ref: 'msg_10293',
  text: 'เบอร์ 091-888-7777 ค่ะ',
  forwardTo: 'https://ai.example.com/inbound',   // ระบบที่ตอบ
  replyTo: 'https://chat.example.com/reply',     // ที่ที่คำตอบต้องไปถึง
})
await fetch('https://<project>.vercel.app/api/inbound', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(await signRequest(process.env.PDPA_SECRET, body)) },
  body,
})
```

- `sessionId` ใช้ id ห้องแชทที่ระบบของคุณออกเอง ห้ามใช้ LINE userId หรือเบอร์ (ตอบ 400)
- ระบบที่ตอบได้รับ `replyTo` ไปด้วย · ส่งคำตอบมาที่ `/api/outbound` พร้อม `policy` `sessionId` และ `replyTo` เดิม
- `forwardTo` / `replyTo` ต้องเป็น https และห้ามเป็นที่อยู่ภายในเครือข่าย · ใครถือ `PDPA_SECRET` ก็ระบุปลายทางได้ จึงควรตั้ง `ALLOWED_DESTINATIONS` ถ้ารู้ปลายทางแล้ว

## ฝั่งที่รับ (`FORWARD_URL` · `REPLY_URL`)

```ts
import { verifyRequest } from '@eve-pdpa-extension/http'

export async function POST(request: Request) {
  const body = await request.text()
  if (!(await verifyRequest(process.env.PDPA_SECRET, request.headers, body))) {
    return new Response('unauthorized', { status: 401 })
  }
  const { policy, sessionId, ref, text, replyTo } = JSON.parse(body)
  // ...
}
```

## บันทึกว่าข้อความไปที่ไหน

ทุกครั้งที่ส่งต่อ `lib/webhook.ts` พิมพ์หนึ่งบรรทัด `{ "type": "webhook.forward", "destination": "https://ai.example.com/inbound", "delivered": true, "status": 200, … }` ลง log ข้าง audit · ไม่มีข้อความแชท · ไม่เก็บ query ของ URL

## audit

ตัวอย่างพิมพ์ audit ลง log ของ Vercel ซึ่งเก็บ 1 ชั่วโมง (Hobby) หรือ 1 วัน (Pro) · **ก่อนใช้กับลูกค้าจริงต้องส่งไปที่ที่เก็บถาวร** เช่น log drain หรือฐานข้อมูล โดยเฉพาะ event `token.resolve` ที่บอกว่าใครแลกค่าจริงไปเพื่ออะไร · audit ไม่มีค่าจริงอยู่เลย
