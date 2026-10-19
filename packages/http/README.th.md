# @eve-pdpa-extension/http

webhook ที่ตั้งคั่นระหว่างแอปแชทกับระบบที่ตอบ (AI model หรือ helpdesk) และปิดข้อมูลส่วนบุคคลไทย**ทั้งสองขา**: ในข้อความของลูกค้าก่อนระบบที่ตอบจะได้อ่าน และในคำตอบก่อนถึงลูกค้า

- แอปไหนก็ได้ที่ส่ง HTTP POST ได้ · ฝั่งที่ส่งไม่ต้องติดตั้ง SDK
- ทุก request ลงลายเซ็น (HMAC-SHA256 พร้อม timestamp) · webhook เซ็นสิ่งที่ส่งต่อด้วย ฝั่งที่รับจึงตรวจได้เหมือนกัน
- ผู้ส่งบอกเองว่าข้อความไปที่ไหน (`forwardTo` · `replyTo`) · ทุกครั้งที่ส่งต่อแจ้งไปที่ `onForward` จึงมีบันทึกว่าข้อมูลไปที่ไหน
- บอทแต่ละตัวได้ **ชุดกฎที่มีชื่อ** · request เลือกได้แค่จากชุดกฎที่คุณรีวิวแล้ว เขียนกฎเองไม่ได้
- `tokenise` เป็นตัวเลือก: ค่าที่ระบบที่ตอบต้องใช้ เช่นเบอร์สำหรับส่ง OTP แลกกลับได้ที่ `/resolve` เฉพาะ purpose ที่อนุญาต และทุกครั้งถูกบันทึก audit
- ใช้แค่มาตรฐานเว็บ (`Request` · `Response` · `fetch` · `crypto.subtle`) · Vercel (Node และ Edge) · Next.js · Hono · Deno · Bun · Cloudflare Workers · Node 20+
- การตรวจและการปิดข้อมูลมาจาก [`@eve-pdpa-extension/core`](https://www.npmjs.com/package/@eve-pdpa-extension/core)

> **เป็นเครื่องมือทางเทคนิค ไม่ใช่ใบรับรองการปฏิบัติตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล**

[English](./README.md)

---

## อยู่ตรงไหนของระบบ

```
แอปแชท ──POST /inbound──▶  webhook (guard)  ──POST──▶  forwardTo (ระบบที่ตอบ)
แอปแชท ◀──POST──────────── webhook (guard)  ◀──POST /outbound──  ระบบที่ตอบ
              (replyTo)                                  ส่ง replyTo กลับมาพร้อมคำตอบ
ระบบส่ง OTP ──POST /resolve──▶ webhook ──▶ ค่าจริง เฉพาะ purpose ที่อนุญาต
แอปแชท ──POST /end-session──▶ webhook ──▶ ลบ token ทุกตัวของห้องนั้น
```

ระบบที่ตอบต้องส่งคำตอบผ่าน `/outbound` แทนการส่งตรงกลับแอป ไม่อย่างนั้นค่าที่ model พิมพ์ออกมาเอง หรือ token ที่มันพูดซ้ำ จะถึงลูกค้าโดยไม่มีใครตรวจ

## ติดตั้ง

**0.1 ยังไม่ขึ้น npm** · webhook deploy จาก repo นี้ — ดู [`apps/webhook`](https://github.com/mintelligence-dev/eve-pdpa-extension/tree/main/apps/webhook) ซึ่งใช้ `core` กับ `http` จาก workspace · โค้ดด้านล่างคือสิ่งที่แอปนั้นรัน

## เริ่มใช้

```ts
import { parsePolicy } from '@eve-pdpa-extension/core'
import { createUpstashTokenStore, createWebhook } from '@eve-pdpa-extension/http'

const webhook = createWebhook({
  policies: {
    default: parsePolicy(defaultPolicyJson),   // บอทตอบคำถาม: ไม่มี tokenise
    otp: parsePolicy(otpPolicyJson),           // บอทส่ง OTP: tokenise เบอร์ สำหรับ otp_send
  },
  secret: process.env.PDPA_SECRET,             // ≥ 32 bytes · openssl rand -hex 32
  onAudit: (event) => console.log(JSON.stringify(event)),
  onForward: (record) => console.log(JSON.stringify(record)),   // ข้อความแต่ละข้อความไปที่ไหน

  // ต้องมีเพราะมีชุดกฎที่ tokenise
  resolveSecret: process.env.PDPA_RESOLVE_SECRET,
  tokenStore: createUpstashTokenStore({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  }),
})

// ผูก handler แต่ละตัวกับ route · บน Vercel เช่น api/inbound.ts:
export function POST(request: Request) {
  return webhook.inbound(request)
}
// webhook.outbound · webhook.resolve · webhook.endSession — แบบเดียวกัน
```

webhook ที่ deploy จริงคือ [`apps/webhook`](https://github.com/mintelligence-dev/eve-pdpa-extension/tree/main/apps/webhook)

## ส่งข้อความเข้า

```ts
import { signRequest } from '@eve-pdpa-extension/http'

const body = JSON.stringify({
  policy: 'otp',
  sessionId: 'conv_8f2a',
  ref: 'msg_10293',
  text: 'เบอร์ 091-888-7777 ค่ะ',
  forwardTo: 'https://ai.example.com/inbound',     // ระบบที่ตอบ
  replyTo: 'https://chat.example.com/reply',       // ที่ที่คำตอบต้องไปถึงลูกค้า
})
await fetch(WEBHOOK_URL + '/inbound', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(await signRequest(PDPA_SECRET, 'inbound', body)) },
  body,
})
```

| ช่อง | บังคับ | |
|---|---|---|
| `policy` | | ชื่อจาก `policies` · ไม่ส่ง = `default` |
| `sessionId` | ✅ | id ห้องแชทที่ระบบคุณออกเอง · 1–256 ตัวอักษร · **ถ้าเป็นข้อมูลส่วนบุคคล (LINE userId · เบอร์) จะถูกปฏิเสธ** เพราะถูกเขียนลงทุก audit event |
| `ref` | | id ข้อความในระบบคุณ · 1–256 ตัวอักษร · ตรวจแบบเดียวกัน |
| `text` | ✅ | ข้อความ |
| `context` | | ข้อความล่าสุดของอีกฝ่าย อ่านแค่คำบอกใบ้ (*"ขอเลขบัญชีด้วยค่ะ"*) · ไม่ถูกส่งต่อ |
| `forwardTo` | | ส่งข้อความที่ปิดแล้วไปที่ไหน · ไม่ส่ง = ใช้ตัวเลือก `forwardTo` · ต้องมีอย่างใดอย่างหนึ่ง |
| `replyTo` | | คำตอบต้องไปที่ไหน · ส่งต่อให้ `forwardTo` แล้วระบบที่ตอบส่งคืนมาพร้อมคำตอบที่ `/outbound` |

ช่องอื่นถูกปฏิเสธ ค่าที่อยู่ในช่องที่ webhook ไม่ได้อ่านจะได้ไม่ถูกเข้าใจว่าตรวจแล้ว

ฝั่งที่รับได้แบบนี้ เซ็นด้วย secret เดียวกัน: `{ "policy": "otp", "sessionId": "conv_8f2a", "ref": "msg_10293", "text": "เบอร์ [tok:…] ค่ะ", "replyTo": "https://chat.example.com/reply" }` · ส่งคำตอบไปที่ `/outbound` ด้วย `policy` `sessionId` และ `replyTo` เดิม เซ็นเป็น `outbound` · ตรวจของที่ได้รับด้วย `verifyRequest`:

```ts
import { verifyRequest } from '@eve-pdpa-extension/http'

const body = await request.text()
if (!(await verifyRequest(PDPA_SECRET, 'forward', request.headers, body))) return new Response(null, { status: 401 })
```

**ลายเซ็นทุกอันระบุว่าเซ็นไว้ใช้กับอะไร** · เซ็นไว้กับอย่างอื่นจะถูกปฏิเสธ:

| scope | ใครเซ็น | ใครตรวจ |
|---|---|---|
| `inbound` · `outbound` · `end-session` | แอปแชท · ระบบที่ตอบ · แอปแชท ด้วย `secret` | webhook |
| `resolve` | ระบบที่ต้องใช้ค่าจริง ด้วย `resolveSecret` | webhook |
| `forward` | webhook ตอนส่งไป `forwardTo` | ระบบที่ตอบ |
| `reply` | webhook ตอนส่งไป `replyTo` | แอปแชท |

secret ตัวเดียวเซ็นทั้งขาไปและขากลับ ถ้าไม่มี scope ข้อความที่ webhook ส่งต่อจะเป็น request `/outbound` ที่ถูกต้องด้วย ใครได้รับไปก็ส่งกลับมาได้ภายในเวลาที่ยอม แล้วมันจะถูกส่งไปหาลูกค้า · request ที่ถูกดักไว้ยังส่งซ้ำไปที่ route เดิมได้ภายในเวลาที่ยอม — ใช้ `ref` ตัดตัวซ้ำ

## ปลายทางที่ส่งได้

`forwardTo` หรือ `replyTo` ใน request ต้องเป็น **https** · ห้ามมีชื่อผู้ใช้หรือรหัสผ่านใน URL · ห้ามเป็นที่อยู่ภายในเครือข่าย (`localhost` · `127.0.0.1` · `10.x` · `192.168.x` · `169.254.169.254` · `::1` …) เพราะ webhook เซ็นสิ่งที่ส่งออก และไม่ควรยิง POST ที่เซ็นแล้วเข้าระบบภายใน · ตัวเลือก `forwardTo` และ `replyTo` เป็นสิ่งที่คุณตั้งเอง ไม่ถูกจำกัด

- **ไม่ตาม redirect** · ปลายทางที่ตอบ 3xx นับว่าส่งไม่สำเร็จ (502) · ถ้าตามไป POST ที่เซ็นแล้วจะข้ามการตรวจทั้งหมดข้างบน
- **ปลายทางที่มีข้อมูลส่วนตัวอยู่ใน URL ถูกปฏิเสธ** (400) · เบอร์หรือ LINE userId ใน path หรือ query จะไปถึงระบบที่ตอบและลง log โดยไม่ถูกปิด · ใส่ที่อยู่ของระบบ ไม่ใช่ของคน

> **secret เป็นตัวกำหนดว่าใครระบุปลายทางได้** · ใครได้ secret ไปก็สั่งให้ webhook ส่งข้อความที่เซ็นแล้วไปที่ไหนก็ได้ที่เป็น public · เก็บ secret ให้ดีเท่ากับรหัสผ่าน และถ้ารู้ว่าข้อความควรไปที่ไหน ให้ล็อกไว้:
>
> ```ts
> allowedDestinations: ['https://ai.example.com/', 'https://chat.example.com/reply']
> ```
>
> ปลายทางต้องมี origin เดียวกับรายการใดรายการหนึ่ง และ path ต้องเป็น path นั้นหรืออยู่ใต้มัน — `/reply` ให้ `/reply/line` ผ่าน แต่ไม่ให้ `/reply-admin` · ถ้าไม่มีรายการนี้ ชื่อโดเมนที่ชี้ไปที่อยู่ภายในจะกันไม่ได้ เพราะ webhook ไม่ได้ค้น DNS

`onForward` ได้รับทุกครั้งที่ส่งต่อ ไม่ว่าสำเร็จหรือไม่: `{ at, boundary, policy, sessionId, ref, destination, destinationFrom, delivered, status }` · `destination` มีแค่ origin กับ path ไม่เก็บ query เพราะอาจมี token อยู่

## คำตอบ

| status | body | ความหมาย |
|---|---|---|
| 200 | `{ "outcome": "processed" }` | ปิดแล้ว ส่งต่อแล้ว |
| 200 | `{ "outcome": "blocked", "blockedBy": ["CREDIT_CARD"] }` | ไม่ส่งต่อ · บอกลูกค้า เช่น *"กรุณาอย่าส่งเลขบัตรในแชท"* |
| 400 | `{ "error": "invalid_request", "field", "message" }` | request ผิด · บอกชื่อช่อง ไม่บอกค่า |
| 401 | | ลายเซ็นหาย ผิด หรือหมดเวลา · ตอบแบบเดียวกันทั้งสามกรณี |
| 405 · 413 | | ไม่ใช่ POST · body เกิน `maxBodyBytes` (64 KiB) |
| 500 | `{ "outcome": "error" }` | guard ทำงานไม่ได้ · **ไม่มีอะไรถูกส่งต่อ** · ส่งใหม่ |
| 502 | `{ "outcome": "forward_failed" }` | ปิดแล้ว แต่ `forwardTo` / `replyTo` ไม่รับ · ส่งใหม่ |

## แลก token: `/resolve`

เซ็นด้วย **`resolveSecret`** ไม่ใช่ `secret` · แอปที่ส่งข้อความเข้าได้ เอาค่าจริงออกไม่ได้

```json
{ "policy": "otp", "token": "[tok:…]", "sessionId": "conv_8f2a", "purpose": "otp_send", "caller": "otp-service", "ref": "call_77" }
```

→ `{ "ok": true, "value": "0918887777" }` หรือ `{ "ok": false, "reason": "purpose_not_allowed" }` (`not_found` · `session_mismatch` · `expired` · `purpose_not_allowed` · `store_unavailable`) · ทุกครั้งไม่ว่าได้หรือไม่ได้ เป็น audit event `token.resolve`

**โค้ดของ tool เป็นคนเรียก `/resolve` ไม่ใช่ AI** · AI เห็น `[tok:…]` ในข้อความแล้วใส่ใน tool call · tool แลกค่า ใช้ค่า แล้วตอบ AI ว่า "ส่งแล้ว" ไม่ใช่ตัวเบอร์

```ts
async function sendOtp({ phone }: { phone: string }, sessionId: string) {
  const body = JSON.stringify({ policy: 'otp', token: phone, sessionId, purpose: 'otp_send', caller: 'otp-service' })
  const res = await fetch(`${WEBHOOK_URL}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await signRequest(PDPA_RESOLVE_SECRET, 'resolve', body)) },
    body,
  })
  const r = await res.json()
  if (!r.ok) return 'ส่งรหัสไม่ได้ ให้ขอเบอร์จากลูกค้าอีกครั้ง'
  await sms.send(r.value, code)
  return 'ส่งรหัสแล้ว'
}
```

- บอก AI ใน system prompt และคำอธิบายพารามิเตอร์ของ tool ให้ส่ง `[tok:…]` ต่อตามที่เห็น · `token` มาแบบที่ AI คัดลอกได้ — วงเล็บหาย มี quote มีช่องว่างข้างใน — แต่ต้องเป็น token ตัวเดียว
- **OTP:** ยืนยันตัวตน ให้ส่งไปเบอร์ที่ลงทะเบียนไว้ ไม่ใช่เบอร์ที่พิมพ์ในแชท · tool ต้องจำกัดจำนวนครั้งที่ส่งเอง ไม่มีอะไรในแพ็กเกจนี้กันแชทที่ขอรหัสซ้ำรัว ๆ

`/end-session` ส่ง `{ "sessionId": "conv_8f2a" }` ลบ token ทุกตัวของห้องนั้น · ทั้งสอง route ตอบ 404 ถ้าไม่มีชุดกฎไหน tokenise

## token บน serverless: `createUpstashTokenStore`

บน serverless แต่ละ request อาจรันคนละเครื่อง และเครื่องที่ว่างถูกปิด · token ที่เก็บในหน่วยความจำหายก่อน `/resolve` จะมาถาม · **ชุดกฎที่ tokenise จึงต้องมี `tokenStore` ที่ทุกเครื่องใช้ร่วมกัน** ไม่อย่างนั้น `createWebhook` throw · `createUpstashTokenStore` คุยกับ [Upstash Redis](https://upstash.com) ผ่าน REST ด้วย `fetch` ไม่ต้องเปิด connection ค้าง ไม่เพิ่ม dependency

- **Redis มีค่าจริงอยู่จนกว่า token หมดอายุ** · ตั้ง `ttlSec` สั้นที่สุดเท่าที่งานรับได้ · เลือก region ใกล้ที่สุด และให้ DPO รับรู้ถ้าข้อมูลไปเก็บนอกประเทศ · เก็บ REST token ดีเท่ากับ `resolveSecret`
- Upstash ล่มหรือช้า (timeout 2 วินาที) core ไม่ปล่อยค่าจริงออกไป: ข้อความถูก block · `/resolve` ตอบ `store_unavailable` · token ในคำตอบกลายเป็นข้อความที่ปิดไว้

## audit

`onAudit` บังคับส่ง · ส่ง `() => {}` ถ้าตั้งใจทิ้ง · event มีตำแหน่ง ประเภท และ id ไม่มีค่าจริง · ถ้าคืน Promise webhook รอให้เสร็จก่อนตอบ เพราะ serverless อาจหยุด function ทันทีที่ส่งคำตอบ · รอนานสุด `auditWaitMs` (5 วินาที) เกินแล้วงานเขียนยังทำต่อ แต่ไม่รออีก งานเขียนที่ค้างตัวเดียวจึงไม่ทำให้ทุก request บนเครื่องเดียวกันค้างตาม

Vercel เก็บ log ของ function 1 ชั่วโมง (Hobby) หรือ 1 วัน (Pro) · **ก่อนใช้กับลูกค้าจริงต้องส่ง audit ไปที่ที่เก็บถาวร** เช่น log drain หรือฐานข้อมูล โดยเฉพาะ event `token.resolve`

## ตัวเลือก

| ตัวเลือก | |
|---|---|
| `policies` | `{ ชื่อ: CompiledPolicy }` · ชื่อใช้ตัวอักษร ตัวเลข `_` และ `-` |
| `secret` | ≥ 32 bytes · `/inbound` `/outbound` `/end-session` และสิ่งที่ส่งต่อ |
| `forwardTo` · `replyTo` | ค่าตั้งต้นเมื่อ request ไม่ได้ระบุ · URL แบบ http(s) · ไม่บังคับ |
| `allowedDestinations` | จำกัดปลายทางที่ request ระบุได้ · URL แบบ https · ปิดเป็นค่าตั้งต้น |
| `onAudit` | บังคับ |
| `onForward` | ได้รับทุกครั้งที่ส่งต่อ · webhook รอให้เสร็จก่อนตอบ เหมือน `onAudit` |
| `resolveSecret` · `tokenStore` | บังคับเมื่อมีชุดกฎที่ tokenise · `resolveSecret` ห้ามซ้ำ `secret` |
| `hmacKey` | สำหรับชุดกฎที่ใช้ `hash` |
| `onError` | เหมือนของ core: ความผิดพลาดที่ core จัดการแทนการ throw |
| `toleranceSec` | อายุลายเซ็นที่ยอมรับ ทั้งเก่าและใหม่ · ค่าตั้งต้น 300 |
| `maxBodyBytes` | ค่าตั้งต้น 65 536 |
| `forwardTimeoutMs` | ค่าตั้งต้น 10 000 |
| `auditWaitMs` | รอ Promise ของ `onAudit` / `onForward` นานสุดก่อนตอบ · ค่าเริ่มต้น 5 000 |

ตั้งค่าผิดตอนเริ่ม throw `PdpaHttpError` ที่มี `code: 'ERR_PDPA_HTTP_CONFIG'` · runtime ที่ไม่มี Web Crypto ได้ `'ERR_PDPA_HTTP_NO_WEBCRYPTO'`

## ข้อจำกัด

- ข้อจำกัดของตัวตรวจใน core ใช้กับที่นี่ทั้งหมด · ดู [Known limitations](https://www.npmjs.com/package/@eve-pdpa-extension/core#known-limitations)
- รูปแบบ JSON แบบเดียว · ยังไม่มี adapter ที่รับ webhook ของ LINE หรือ Slack ตรง ๆ
- ข้อความอย่างเดียว · ไฟล์แนบไม่อยู่ในรูปแบบ

## แจ้งช่องโหว่

**อย่าเปิด issue สาธารณะ** · อีเมลไปที่ **kunlachat@m-intelligence.tech** หัวเรื่องขึ้นต้นด้วย `[eve-pdpa-extension security]` · ใช้ค่าที่แต่งขึ้นในการทำซ้ำ ห้ามส่งข้อมูลส่วนบุคคลจริง

## License

Apache-2.0
