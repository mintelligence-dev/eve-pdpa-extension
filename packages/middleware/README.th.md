# @eve-pdpa-extension/middleware

middleware สำหรับ Express, Hono และ Next.js ที่ปิดข้อมูลส่วนบุคคลไทยใน body ของ request แชท ก่อนถึง handler ของคุณ และตรวจคำตอบแบบ JSON ก่อนส่งออก ใช้ [`@eve-pdpa-extension/core`](https://www.npmjs.com/package/@eve-pdpa-extension/core) อยู่ข้างใน guard และ policy ของคุณเป็นตัวตัดสินว่าจะปิดอะไร ปิดแบบไหน

[English](./README.md)

> ยังไม่ได้ปล่อยบน npm · เป็นส่วนของ 0.2

## ทำอะไรได้

1. อ่าน body JSON ของทุก request แล้วหาข้อความของลูกค้า เช่น `messages[].content` `input` ของ Responses API และรูปแบบอื่นตามชุดด้านล่าง · อ่าน JSON ได้แม้ส่งมาเป็น `text/plain` หรือไม่มี content type (`fetch` ที่ส่ง body เป็น string จะเป็นแบบนี้)
2. ส่งแต่ละข้อความเข้า guard แล้วใส่ข้อความที่ปิดแล้วกลับ เช่น `เบอร์ 0812345678` → `เบอร์ [tok:…]` หรือ `เบอร์ [เบอร์โทร]` ตาม policy
3. ส่ง body ที่ปิดแล้วต่อให้ handler ของคุณ โดยไม่ต้องแก้ handler
4. ถ้า policy บล็อกข้อความ จะตอบ `422 { error: 'pdpa_blocked', boundary: 'inbound', blockedBy: [...] }` และ handler ไม่ถูกเรียก
5. ถ้าตั้ง `responseFields` จะตรวจคำตอบแบบ JSON ด้วยวิธีเดียวกันก่อนส่งออก · คำตอบที่ถูกบล็อกตอบ `502` พร้อม `boundary: 'outbound'`
6. ถ้าไม่มีอะไรต้องปิด handler ได้ request เดิมทุก byte

## วิธีใช้

```bash
npm install @eve-pdpa-extension/middleware
```

ติดตั้งตัวเดียวพอ `createGuard` `definePolicy` และ `parsePolicy` มากับ package นี้ (จาก core ที่ติดตั้งตามมา) ให้ import จากที่นี่แทน core แอปกับ middleware จะได้ใช้ core ชุดเดียวกัน

ยังต้องสร้าง guard เอง เพราะ policy เป็นของคุณ middleware แค่ต่อ guard เข้ากับ server

```ts
import { createGuard, parsePolicy } from '@eve-pdpa-extension/middleware'
const guard = createGuard({ policy: parsePolicy(policyJson), onAudit: (e) => log(e) })
```

ถ้าต้องใช้อย่างอื่นของ core เช่น token store หรือ `guard.resolve` ให้ติดตั้ง `@eve-pdpa-extension/core` เพิ่ม เวอร์ชันเดียวกับที่ package นี้ใช้

### Express

```ts
import { pdpaExpress } from '@eve-pdpa-extension/middleware'

app.post(
  '/chat',
  express.json(), // ต้องอ่าน body ก่อน
  pdpaExpress({ guard, sessionId: (req) => req.body.chatId }),
  chatHandler,
)
```

### Hono

```ts
import { pdpaHono } from '@eve-pdpa-extension/middleware'

app.post('/chat', pdpaHono({ guard, sessionId: (r) => r.headers.get('x-chat-id') ?? undefined }), async (c) => {
  const body = await c.req.json() // ปิดแล้ว
})
```

วางไว้ก่อนอะไรก็ตามที่อ่าน body

### Next.js route handler

handler ได้ request ชนิดเดิมที่เขียนรับไว้ `NextRequest` ยังเป็น `NextRequest`

```ts
import { withPdpa } from '@eve-pdpa-extension/middleware'

export const POST = withPdpa(handler, { guard, responseFields: ['reply'] })
```

### runtime อื่นที่ใช้ Request มาตรฐานเว็บ

Deno · Bun · Cloudflare Workers · Remix · SvelteKit · Astro หรืออะไรก็ได้ที่ให้ `Request` มา

```ts
import { protectRequest, protectResponse } from '@eve-pdpa-extension/middleware'

const r = await protectRequest(request, { guard })
if (!r.ok) return r.response
const response = await handler(r.request)
return protectResponse(response, r.request, { guard, responseFields: ['reply'] })
```

### framework อื่น

`protectBody` รับ JSON ที่อ่านแล้ว คืน JSON ที่ปิดแล้ว ใช้กับ Fastify · Koa · NestJS · worker ของคิวได้

```ts
import { protectBody } from '@eve-pdpa-extension/middleware'

const r = await protectBody(req.body, { guard, sessionId: 'conv_8f2a' })
if (!r.ok) return reply.code(422).send({ blockedBy: r.blockedBy })
req.body = r.body
```

`context` คือข้อความล่าสุดของอีกฝ่าย เช่น คำถามที่บอทเพิ่งถาม ถ้าบอทถาม `ขอเลขบัญชีค่ะ` แล้วลูกค้าตอบแค่ `123-4-56789-0` ก็จะถูกปิดเป็นเลขบัญชี · ใช้อ่านคำบอกใบ้อย่างเดียว ไม่ถูกแก้ ไม่ถูกบันทึกลง audit · ทุกข้อความใน body ได้ `context` เดียวกัน · adapter รับเป็นฟังก์ชัน ดูที่ตัวเลือก

```ts
const r = await protectBody(req.body, { guard, sessionId: 'conv_8f2a', context: lastBotMessage })
```

## ตัวเลือก

| ตัวเลือก | |
|---|---|
| `guard` | จาก `createGuard` · บังคับ |
| `fields` | ข้อความอยู่ตรงไหนใน request: ชื่อชุดหรือ path · ค่าเริ่มต้น `chat` |
| `responseFields` | ข้อความอยู่ตรงไหนในคำตอบ JSON · ไม่ใส่ = ไม่ตรวจคำตอบ |
| `sessionId` | `(request) => string` · บทสนทนา · บังคับเมื่อ policy ใช้ tokenise · ห้ามเป็นเบอร์โทรหรือ LINE userId |
| `ref` | `(request) => string` · id ของ request ในระบบคุณ ถูกบันทึกใน audit ใช้ตามกลับไปหาข้อความได้ |
| `context` | `(request, body) => string \| Promise<string>` · ข้อความล่าสุดของอีกฝ่าย เช่น สิ่งที่บอทถามล่าสุด · `body` คือ request ที่อ่านเป็น JSON แล้ว · ไปดึงจากฐานข้อมูลของคุณได้ · ใช้กับ request อย่างเดียว ไม่ใช้กับคำตอบ · ไม่ถูกบันทึกลง audit |
| `onBlocked` | `(blockedBy, request, boundary) => Response` (Express: `(blockedBy, req, res, boundary)`) · คำตอบเมื่อข้อความถูกบล็อก · `boundary` เป็น `inbound` ถ้าเป็นข้อความลูกค้า `outbound` ถ้าเป็นคำตอบของคุณ · ค่าเริ่มต้น 422 / 502 พร้อม `blockedBy` |

**path:** `messages[].content` คือ `content` ของทุกตัวใน `messages` · `[]` คือไล่ทุกตัวใน array · จุดคือเข้าไปใน object · ปิดเฉพาะค่าที่เป็นข้อความ

| ชุด | path |
|---|---|
| `chat` (ค่าเริ่มต้น) | ทุก path ของแชทด้านล่าง |
| `openai` | `messages[].content` · `messages[].content[].text` · `input` · `input[].content` · `input[].content[].text` |
| `anthropic` | `messages[].content` · `messages[].content[].text` |
| `ai-sdk` | `messages[].content` · `messages[].parts[].text` · `prompt` |
| `line` | `events[].message.text` (webhook ของ LINE Messaging API) · ไม่อยู่ใน `chat` |

รายการที่มี `role: 'system'` หรือ `'developer'` ถูกข้าม เพราะเป็นคำสั่งของร้าน ไม่ใช่ข้อความลูกค้า และมักมีเบอร์ร้านอยู่โดยตั้งใจ · ช่อง `system` ชั้นนอกสุด (Anthropic) ไม่อยู่ใน path ไหนเลย

## webhook ที่มีลายเซ็น (LINE)

ลายเซ็นของ body เช่น `x-line-signature` ของ LINE ใช้พิสูจน์ว่า request มาจาก LINE จริง ลายเซ็นคำนวณจาก body ดิบ จึง**ต้องตรวจก่อน middleware นี้เสมอ** ห้ามตรวจหลัง เพราะพอเบอร์ถูกแทนแล้ว body จะไม่ตรงกับลายเซ็น

```ts
// Express: middleware ของ LINE ตรวจลายเซ็นและอ่าน body ให้
import { middleware as line } from '@line/bot-sdk'
app.post('/webhook', line({ channelSecret }), pdpaExpress({ guard, fields: 'line' }), handler)

// มาตรฐานเว็บ: ตรวจก่อน แล้วค่อยปิด
if (!validateSignature(await request.clone().text(), channelSecret, request.headers.get('x-line-signature'))) {
  return new Response('bad signature', { status: 401 })
}
const r = await protectRequest(request, { guard, fields: 'line' })
```

request ที่ไม่มีอะไรต้องปิดผ่านไปแบบไม่เปลี่ยน ถ้าวางลำดับผิด ลายเซ็นจะพังเฉพาะข้อความที่มีข้อมูลส่วนบุคคล ซึ่งเป็นตอนที่สังเกตยากที่สุด จึงต้องตรวจก่อน


webhook ส่งมาแค่ข้อความใหม่ ไม่มีคำถามของบอทก่อนหน้า ให้ส่งคำถามนั้นเป็น `context` จากที่ที่คุณเก็บไว้ ลูกค้าตอบแค่ `123-4-56789-0` หลังบอทถาม "ขอเลขบัญชีค่ะ" ก็จะถูกปิด:

```ts
pdpaExpress({
  guard,
  fields: 'line',
  context: (req) => lastBotMessage(req.body.events[0]?.source.userId),
})
```

## ข้อจำกัดที่รู้อยู่

- **คำตอบแบบ streaming ไม่ถูกตรวจ** · คำตอบที่ส่งทีละคำ (server-sent events) ออกไปตามเดิม · ให้ตรวจด้วย core ตรงจุดที่ประกอบข้อความ
- **รับแค่ body JSON** · form และไฟล์แนบผ่านไปเฉย ๆ · ข้อความธรรมดาที่ไม่ใช่ JSON ก็ผ่านไปเฉย ๆ · body ที่ติดป้าย JSON แต่อ่านไม่ได้ตอบ 400
- **อ่านทุกข้อความใน body ทุกครั้ง** · แอปที่ส่งประวัติแชททั้งหมดมาทุกรอบ ข้อความเก่าจะถูกตรวจ (และบันทึก audit) ซ้ำ · ถ้าใช้ `tokenise` ค่าเดิมได้ token เดิมใน session เดียวกัน ข้อความที่ AI เห็นจึงเหมือนเดิม
- **Express:** request ที่เป็น JSON แต่ไม่มี `express.json()` อยู่ก่อน จะ error พร้อมบอกสาเหตุ ส่วน body ที่ไม่ใช่ JSON ผ่านไปเฉย ๆ · ถ้าใช้ `express.text()` ข้อความที่เป็น JSON ถูกตรวจและยังเป็นข้อความเหมือนเดิม · ขาออกตรวจ `res.json` และ `res.send` ที่ส่ง object (Express ส่งต่อให้กัน) ไม่ตรวจ `res.send` ที่ส่ง string, `res.jsonp` และ stream · `onBlocked` ที่เขียนเองแล้วเรียก `res.json` จะผ่านการตรวจขาออกอีกรอบ ไม่มีผลเสีย ไม่ตรวจ `res.send` หรือ stream · **Hono:** body ที่ถูกอ่านก่อน `pdpaHono` จะเป็นแบบที่ยังไม่ได้ปิด
