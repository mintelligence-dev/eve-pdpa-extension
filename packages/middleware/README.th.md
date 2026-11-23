# @eve-pdpa-extension/middleware

middleware สำหรับ Express, Hono และ Next.js ที่ปิดข้อมูลส่วนบุคคลไทยใน body ของ request แชท ก่อนถึง handler ของคุณ และตรวจคำตอบแบบ JSON ก่อนส่งออก ใช้ [`@eve-pdpa-extension/core`](https://www.npmjs.com/package/@eve-pdpa-extension/core) อยู่ข้างใน guard และ policy ของคุณเป็นตัวตัดสินว่าจะปิดอะไร ปิดแบบไหน

[English](./README.md)

> ยังไม่ได้ปล่อยบน npm · เป็นส่วนของ 0.2

## ทำอะไรได้

1. อ่าน body JSON ของทุก request แล้วหาข้อความของลูกค้า เช่น `messages[].content` และรูปแบบอื่นที่แอปแชทส่งกัน
2. ส่งแต่ละข้อความเข้า guard แล้วใส่ข้อความที่ปิดแล้วกลับ เช่น `เบอร์ 0812345678` → `เบอร์ [tok:…]` หรือ `เบอร์ [เบอร์โทร]` ตาม policy
3. ส่ง body ที่ปิดแล้วต่อให้ handler ของคุณ โดยไม่ต้องแก้ handler
4. ถ้า policy บล็อกข้อความ จะตอบ `422 { error: 'pdpa_blocked', blockedBy: [...] }` และ handler ไม่ถูกเรียก
5. ถ้าตั้ง `responseFields` จะตรวจคำตอบแบบ JSON ด้วยวิธีเดียวกันก่อนส่งออก

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

## ตัวเลือก

| ตัวเลือก | |
|---|---|
| `guard` | จาก `createGuard` · บังคับ |
| `fields` | ข้อความอยู่ตรงไหนใน request: ชื่อชุดหรือ path · ค่าเริ่มต้น `chat` |
| `responseFields` | ข้อความอยู่ตรงไหนในคำตอบ JSON · ไม่ใส่ = ไม่ตรวจคำตอบ |
| `sessionId` | `(request) => string` · บทสนทนา · บังคับเมื่อ policy ใช้ tokenise · ห้ามเป็นเบอร์โทรหรือ LINE userId |
| `ref` | `(request) => string` · id ของ request ในระบบคุณ ถูกบันทึกใน audit ใช้ตามกลับไปหาข้อความได้ |
| `onBlocked` | คำตอบเมื่อข้อความถูกบล็อก · ค่าเริ่มต้น 422 พร้อม `blockedBy` |

**path:** `messages[].content` คือ `content` ของทุกตัวใน `messages` · `[]` คือไล่ทุกตัวใน array · จุดคือเข้าไปใน object · ปิดเฉพาะค่าที่เป็นข้อความ

| ชุด | path |
|---|---|
| `chat` (ค่าเริ่มต้น) | ทุก path ด้านล่าง |
| `openai` · `anthropic` | `messages[].content` · `messages[].content[].text` |
| `ai-sdk` | `messages[].content` · `messages[].parts[].text` · `prompt` |

system prompt ไม่ถูกอ่าน เพราะเป็นข้อความของร้าน ไม่ใช่ของลูกค้า

## ข้อจำกัดที่รู้อยู่

- **คำตอบแบบ streaming ไม่ถูกตรวจ** · คำตอบที่ส่งทีละคำ (server-sent events) ออกไปตามเดิม · ให้ตรวจด้วย core ตรงจุดที่ประกอบข้อความ
- **รับแค่ body JSON** · form และไฟล์แนบผ่านไปเฉย ๆ · JSON ที่อ่านไม่ได้ตอบ 400
- **อ่านทุกข้อความใน body ทุกครั้ง** · แอปที่ส่งประวัติแชททั้งหมดมาทุกรอบ ข้อความเก่าจะถูกตรวจ (และบันทึก audit) ซ้ำ · ถ้าใช้ `tokenise` ค่าเดิมได้ token เดิมใน session เดียวกัน ข้อความที่ AI เห็นจึงเหมือนเดิม
- **Express:** ตรวจขาออกเฉพาะ `res.json` ไม่ตรวจ `res.send` หรือ stream · **Hono:** body ที่ถูกอ่านก่อน `pdpaHono` จะเป็นแบบที่ยังไม่ได้ปิด
