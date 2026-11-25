# @eve-pdpa-extension/middleware

middleware สำหรับ Express, Hono และ Next.js ที่ปิดข้อมูลส่วนบุคคลไทยใน body ของ request แชท ก่อนถึง handler ของคุณ และตรวจคำตอบแบบ JSON ก่อนส่งออก ใช้ [`@eve-pdpa-extension/core`](https://www.npmjs.com/package/@eve-pdpa-extension/core) อยู่ข้างใน guard และ policy ของคุณเป็นตัวตัดสินว่าจะปิดอะไร ปิดแบบไหน

[English](./README.md)

> ยังไม่ได้ปล่อยบน npm · จะมาใน 0.3

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

ติดตั้งตัวเดียวพอ `createGuard` `definePolicy` `parsePolicy` และ `PdpaError` มากับ package นี้ (จาก core ที่ติดตั้งตามมา) ให้ import จากที่นี่แทน core แอปกับ middleware จะได้ใช้ core ชุดเดียวกัน

ยังต้องสร้าง guard เอง เพราะ policy เป็นของคุณ middleware แค่ต่อ guard เข้ากับ server

```ts
import { createGuard, parsePolicy } from '@eve-pdpa-extension/middleware'
const guard = createGuard({ policy: parsePolicy(policyJson), onAudit: (e) => log(e) })
```

ถ้าต้องใช้อย่างอื่นของ core เช่น token store หรือ `guard.resolve` ให้ติดตั้ง `@eve-pdpa-extension/core` เพิ่ม เวอร์ชันเดียวกับที่ package นี้ใช้ · type ของ core ก็มากับ package นี้ด้วย: `Guard` `GuardOptions` `PolicyInput` `EntityType` `AuditRecord`

ต้องใช้ Node 18.18 ขึ้นไป · ใช้ได้ทั้ง `import` และ `require()` · ตัวที่ build แล้วผ่านการทดสอบบน Node 18.18 ถึง 26, Deno, Bun และ Cloudflare Workers (workerd) · adapter ทดสอบกับ Express 5, Hono 4 และ Next.js 16 · Express 4 ยังไม่ได้ทดสอบ

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

app.post('/chat', pdpaHono({ guard, sessionId: (r, body) => body.chatId }), async (c) => {
  const body = await c.req.json() // ปิดแล้ว
})
```

ฟังก์ชันที่ส่งให้ทุกตัว (`sessionId` `ref` `context` `onBlocked` `onNoMatch`) ได้ `Request` ดิบ (`c.req.raw`) ไม่ใช่ `c` ของ Hono · `sessionId` `ref` และ `context` ได้ body ที่อ่านเป็น JSON แล้วด้วย จึงอ่านรหัสแชทที่ส่งมาใน body ได้ (body ของ `Request` เองอ่านไม่ได้ถ้าไม่ `await`)

วางไว้ก่อนอะไรก็ตามที่อ่าน body ถ้า body ถูกอ่านไปก่อนแล้ว จะเป็น error ไม่ใช่ปล่อยผ่าน: Hono ตอบ 500 ผ่าน `app.onError` และ handler ไม่ทำงาน

### Next.js route handler

handler ได้ request ชนิดเดิมที่เขียนรับไว้ `NextRequest` ยังเป็น `NextRequest` · argument ที่ตามหลัง request เช่น `{ params }` ของ Next ส่งต่อให้ handler ตามเดิม

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

ค่าที่คืนมีสองแบบ

| | |
|---|---|
| `{ ok: true, body, changed, matched }` | `body` คือสำเนาที่ปิดแล้ว ตัวที่ส่งเข้าไปไม่ถูกแก้ · `changed` เป็น `true` ถ้ามีอะไรถูกปิด ถ้าเป็น `false` `body` คือตัวเดิมที่ส่งเข้าไป · `matched` คือจำนวนข้อความที่ `fields` หาเจอ ถ้าเป็น `0` แปลว่าไม่เจอเลย เป็นกรณีเดียวกับที่ adapter แจ้ง `onNoMatch` |
| `{ ok: false, blockedBy }` | policy บล็อกข้อความ · `blockedBy` คือประเภทข้อมูลที่ทำให้ถูกบล็อก เป็นรายการว่างได้ถ้า guard บล็อกโดยไม่ระบุประเภท |

ตัวเลือกของ `protectBody` เป็นค่าธรรมดา ไม่ใช่ฟังก์ชัน

| ตัวเลือก | |
|---|---|
| `guard` | จาก `createGuard` · บังคับ |
| `fields` | ชื่อชุดหรือ path · ค่าเริ่มต้น `chat` |
| `sessionId` | string · บังคับเมื่อ policy ใช้ tokenise |
| `ref` | string · ถูกบันทึกใน audit |
| `context` | string · ข้อความล่าสุดของอีกฝ่าย ดูด้านล่าง |
| `boundary` | `'inbound'` (ค่าเริ่มต้น) สำหรับข้อความที่ลูกค้าส่ง · `'outbound'` สำหรับตรวจคำตอบก่อนส่งออก: token ของแชทนี้จะแสดงเป็นค่าที่ปิดบางส่วน และถ้าถูกบล็อกแปลว่าห้ามส่งคำตอบนั้น |

`context` คือข้อความล่าสุดของอีกฝ่าย เช่น คำถามที่บอทเพิ่งถาม ถ้าบอทถาม `ขอเลขบัญชีค่ะ` แล้วลูกค้าตอบแค่ `123-4-56789-0` ก็จะถูกปิดเป็นเลขบัญชี · ใช้อ่านคำบอกใบ้อย่างเดียว ไม่ถูกแก้ ไม่ถูกบันทึกลง audit · ทุกข้อความใน body ได้ `context` เดียวกัน · adapter รับเป็นฟังก์ชัน ดูที่ตัวเลือก

```ts
const r = await protectBody(req.body, { guard, sessionId: 'conv_8f2a', context: lastBotMessage })
```

## ตัวเลือก

| ตัวเลือก | |
|---|---|
| `guard` | จาก `createGuard` · บังคับ |
| `fields` | ข้อความอยู่ตรงไหนใน request: ชื่อชุดหรือ path · ค่าเริ่มต้น `chat` · ถ้าสะกดชื่อชุดผิดหรือ path ผิด จะ throw ตอนสร้าง middleware คือตอนเปิด server (`protectRequest` และ `protectBody` throw ตอนเรียกครั้งแรก) |
| `responseFields` | ข้อความอยู่ตรงไหนในคำตอบ JSON · ไม่ใส่ = ไม่ตรวจคำตอบ |
| `sessionId` | `(request, body) => string` · บทสนทนา · บังคับเมื่อ policy ใช้ tokenise · ห้ามเป็นเบอร์โทรหรือ LINE userId · `body` คือ request ที่อ่านเป็น JSON แล้ว ก่อนถูกปิด หรือ `undefined` ถ้าไม่ใช่ JSON · ตอนตรวจคำตอบใช้ค่าเดียวกัน |
| `ref` | `(request, body) => string` · id ของ request ในระบบคุณ ถูกบันทึกใน audit ใช้ตามกลับไปหาข้อความได้ |
| `context` | `(request, body) => string \| Promise<string>` · ข้อความล่าสุดของอีกฝ่าย เช่น สิ่งที่บอทถามล่าสุด · `body` คือ request ที่อ่านเป็น JSON แล้ว · ไปดึงจากฐานข้อมูลของคุณได้ · ใช้กับ request อย่างเดียว ไม่ใช้กับคำตอบ · ไม่ถูกบันทึกลง audit |
| `maxBytes` | adapter แบบ web-standard (Hono, Next.js, `protectRequest`) · ขนาด body สูงสุดที่อ่าน (ไบต์) · ใหญ่กว่านี้ตอบ `413` และ handler ไม่ทำงาน · ค่าเริ่มต้น 1 MB · Express ใช้ `limit` ของ `express.json()` แทน |
| `onBlocked` | `(blockedBy, request, boundary) => Response` (Express: `(blockedBy, req, res, boundary)`) · คำตอบเมื่อข้อความถูกบล็อก · `boundary` เป็น `inbound` ถ้าเป็นข้อความลูกค้า `outbound` ถ้าเป็นคำตอบของคุณ · ค่าเริ่มต้น 422 / 502 พร้อม `blockedBy` |
| `onNoMatch` | `(request, boundary) => void` (Express: `(req, boundary)`) · ถูกเรียกเมื่อ `fields` (หรือ `responseFields` ถ้าเป็นคำตอบ) หา string ไม่เจอเลยใน body ที่อ่านเป็น JSON ได้ เพื่อให้รู้ตัวถ้าลืมตั้ง `fields` ให้ตรงกับรูปแบบ body · request ยังไปต่อตามเดิม · body ที่ไม่มีข้อความเลย เช่นการกดปุ่ม ถือว่าปกติ ใช้บันทึก log ไม่ใช่ใช้บล็อก · ไม่เรียกถ้า body ไม่ใช่ JSON หรือถูกบล็อกไปแล้ว · ถ้า throw request จะ error (Express: ส่งให้ `next(error)`) |

**path:** `messages[].content` คือ `content` ของทุกตัวใน `messages` · `[]` คือไล่ทุกตัวใน array · จุดคือเข้าไปใน object · ปิดเฉพาะค่าที่เป็นข้อความ

ถ้าจะเพิ่ม path ของตัวเองต่อจากชุดสำเร็จ ให้เริ่มจาก `PRESETS`

```ts
import { PRESETS, pdpaExpress } from '@eve-pdpa-extension/middleware'
app.use(pdpaExpress({ guard, sessionId, fields: [...PRESETS.chat, 'metadata.note'] }))
```

| ชุด | path |
|---|---|
| `chat` (ค่าเริ่มต้น) | ทุก path ของแชทด้านล่าง |
| `openai` | `messages[].content` · `messages[].content[].text` · `input` · `input[].content` · `input[].content[].text` |
| `anthropic` | `messages[].content` · `messages[].content[].text` |
| `ai-sdk` | `messages[].content` · `messages[].parts[].text` · `prompt` |
| `line` | `events[].message.text` (webhook ของ LINE Messaging API) · ไม่อยู่ใน `chat` |

รายการที่มี `role: 'system'` หรือ `'developer'` ถูกข้าม เพราะเป็นคำสั่งของร้าน ไม่ใช่ข้อความลูกค้า และมักมีเบอร์ร้านอยู่โดยตั้งใจ · ช่อง `system` ชั้นนอกสุด (Anthropic) ไม่อยู่ใน path ไหนเลย · รายการอื่นถูกตรวจหมด รวม `assistant` และ `tool` เพราะคำตอบเก่าของบอทก็ถูกส่งกลับไปให้โมเดลด้วย

## ตอบอะไรกลับไปบ้าง

| status | เมื่อไร | body |
|---|---|---|
| `422` | policy บล็อกข้อความที่ลูกค้าส่ง | `{ error: 'pdpa_blocked', boundary: 'inbound', blockedBy }` |
| `502` | policy บล็อกคำตอบของคุณ | `{ error: 'pdpa_blocked', boundary: 'outbound', blockedBy }` |
| `502` | คำตอบของคุณติดป้าย JSON แต่ไม่ใช่ JSON | `{ error: 'invalid_json', boundary: 'outbound' }` |
| `400` | request ติดป้าย JSON แต่ไม่ใช่ JSON | `{ error: 'invalid_json' }` |
| `413` | body ของ request ใหญ่กว่า `maxBytes` | `{ error: 'payload_too_large' }` |

มีแค่สองกรณีที่ถูกบล็อกที่ผ่าน `onBlocked` · ใน Express `400` และ `413` มาจาก `express.json()` เอง ก่อนถึง middleware นี้

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

webhook ส่งมาแค่ข้อความใหม่ ไม่มีคำถามของบอทก่อนหน้า ให้ส่งคำถามนั้นเป็น `context` จากที่ที่คุณเก็บไว้ ลูกค้าตอบแค่ `123-4-56789-0` หลังบอทถาม "ขอเลขบัญชีค่ะ" ก็จะถูกปิด · ถ้า policy ใช้ tokenise ต้องส่ง `sessionId` ด้วย เป็นรหัสแชทของคุณเองที่หาจาก `source.userId` ห้ามใช้ userId ตรง ๆ

```ts
pdpaExpress({
  guard,
  fields: 'line',
  sessionId: (req, body) => chatIdFor(body.events[0]?.source.userId),
  context: (req, body) => lastBotMessage(body.events[0]?.source.userId),
})
```

## ข้อจำกัดที่รู้อยู่

- **คำตอบแบบ streaming ไม่ถูกตรวจ** · คำตอบที่ส่งทีละคำ (server-sent events) ออกไปตามเดิม · ให้ตรวจด้วย core ตรงจุดที่ประกอบข้อความ
- **คำตอบที่ติดป้าย JSON แต่ไม่ใช่ JSON จะตอบ `502`** · ตรวจไม่ได้จึงไม่ส่งออก · คำตอบที่ไม่มี content type หรือเป็น `text/plain` ถ้าอ่านเป็น JSON ได้จะถูกตรวจ ถ้าอ่านไม่ได้ผ่านไปตามเดิม · type อื่น (HTML, ไฟล์) ผ่านไปตามเดิม
- **path ขึ้นต้นด้วย `[]` ได้** เมื่อ body เป็น array ชั้นนอกสุด: `fields: ['[].text']`
- **`*` คือทุก key ของ object** ใช้กับ key ที่รู้ชื่อล่วงหน้าไม่ได้: `*.msg` อ่าน `{"u1":{"msg":…},"u2":{"msg":…}}` · ถ้าใช้กว้างเช่น `*.*` จะไปถึงเลข id ด้วยและอาจถูกปิด · ข้อความที่หลาย path ชี้ถึงถูกตรวจครั้งเดียว
- **รับแค่ body JSON** · form และไฟล์แนบผ่านไปเฉย ๆ · ข้อความธรรมดาที่ไม่ใช่ JSON ก็ผ่านไปเฉย ๆ · body ที่ติดป้าย JSON แต่อ่านไม่ได้ตอบ 400
- **ข้อความเดียวถูกบล็อก ทั้ง request ถูกบล็อก รวมประวัติแชท** · ไม่มีส่วนไหนถูกส่งต่อ · แอปที่ส่งประวัติทั้งหมดทุกรอบและยังเก็บข้อความที่ถูกบล็อกไว้ในประวัติ (`useChat` เพิ่มข้อความก่อนส่ง) จะถูกบล็อกทุกรอบต่อจากนั้น · เมื่อได้ `422` ให้เอาข้อความนั้นออกจากประวัติที่แอปส่ง
- **อ่านทุกข้อความใน body ทุกครั้ง** · แอปที่ส่งประวัติแชททั้งหมดมาทุกรอบ ข้อความเก่าจะถูกตรวจ (และบันทึก audit) ซ้ำ · ถ้าใช้ `tokenise` ค่าเดิมได้ token เดิมใน session เดียวกัน ข้อความที่ AI เห็นจึงเหมือนเดิม
- **Express:** request ที่เป็น JSON แต่ไม่มี `express.json()` อยู่ก่อน จะ error พร้อมบอกสาเหตุ ส่วน body ที่ไม่ใช่ JSON ผ่านไปเฉย ๆ · ถ้าใช้ `express.text()` ข้อความที่เป็น JSON ถูกตรวจและยังเป็นข้อความเหมือนเดิม · ขาออกตรวจ `res.json` และ `res.send` ที่ส่ง object (Express ส่งต่อให้กัน) ไม่ตรวจ `res.send` ที่ส่ง string, `res.jsonp` และ stream · `onBlocked` ที่เขียนเองแล้วเรียก `res.json` จะผ่านการตรวจขาออกอีกรอบ ไม่มีผลเสีย ไม่ตรวจ `res.send` หรือ stream · ถ้าตั้ง `responseFields` `res.json` จะส่งหลังตรวจเสร็จ ช้ากว่าเดิมนิดหนึ่ง: หลังเรียกทันที `res.headersSent` ยังเป็น `false` · **Hono:** body ที่ถูกอ่านก่อน `pdpaHono` จะเป็น error (500 ผ่าน `app.onError`) และ handler ไม่ทำงาน คำตอบที่ถูกอ่านไปก่อนแล้วตอนตั้ง `responseFields` ก็เป็น error เหมือนกัน
