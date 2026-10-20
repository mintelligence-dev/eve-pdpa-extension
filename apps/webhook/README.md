# webhook บน Vercel

webhook ที่ deploy จริง · คั่นระหว่างแอปแชทกับระบบที่ตอบ (เช่น AI) · ปิดข้อมูลส่วนบุคคลทั้งขาเข้าและขาออก

ใช้ `@eve-pdpa-extension/core` และ `@eve-pdpa-extension/http` **จาก repo นี้** (`workspace:*`) · 0.1 ไม่ปล่อย `http` ขึ้น npm

**ระบบที่จะเรียกใช้ webhook อ่าน [`API.md`](./API.md)** — endpoint · ช่อง · สูตรลายเซ็น พร้อมตัวอย่าง curl / Python / Node · spec เต็มอยู่ที่ [`openapi.json`](./openapi.json) · Postman collection ที่เซ็นให้เองอยู่ที่ [`postman/`](./postman) · README นี้เป็นเรื่องการ deploy

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
| `vercel.json` | function รันที่สิงคโปร์ (`sin1`) — Hobby ไม่สนค่านี้ ดูข้อ region ด้านล่าง · install เฉพาะแอปนี้กับแพ็กเกจที่มันใช้ · build core + http ก่อน · ส่ง `policies/` ไปกับทุก function |
| `package.json` · `tsconfig.json` | core + http แบบ `workspace:*` · `pnpm typecheck` ตรวจแอปนี้ด้วย |
| `API.md` · `openapi.json` · `postman/` | สำหรับทีมที่ต่อเข้ามา · test ใน `packages/http` คุมให้ตรงกับ webhook |
| `scripts/smoke.mjs` | ตรวจ deployment ที่ขึ้นแล้ว · ดู [ตรวจ deployment](#ตรวจ-deployment) |
| `public/robots.txt` | ไฟล์ static ที่ preset "Other" ต้องมี · ห้าม bot เก็บทุกหน้า |

## deploy

deploy ขึ้น preview ได้แล้ว (20 ต.ค. · บัญชี Hobby · ลิงก์โปรเจกต์ด้วย `vercel link` จาก root ของ repo ไม่ได้ต่อ Git)

1. Vercel → Add New → Project → เลือก repo (หรือ `vercel link` จาก root ของ repo) · **Root Directory = `apps/webhook`** · ต้องเปิด *Include files outside the Root Directory* (แอปใช้ `packages/core` และ `packages/http`)
2. ไม่ต้องตั้ง Install / Build Command เอง — `vercel.json` สั่งแล้ว:
   - install: `pnpm install --frozen-lockfile --filter @eve-pdpa-extension/webhook...` (แอปนี้กับสิ่งที่มันใช้ ไม่ลง bun / deno / playwright ของทั้ง repo)
   - build: `pnpm --filter @eve-pdpa-extension/webhook^... build` (core + http) · `public/robots.txt` อยู่ใน repo เพราะ preset "Other" ต้องมีโฟลเดอร์ static ที่ไม่ว่าง แม้แอปนี้มีแค่ function
3. **region:** `vercel.json` ตั้ง `sin1` (สิงคโปร์) ไว้ แต่ **บัญชี Hobby ไม่สนค่านี้** — function รันที่สหรัฐ (`iad1`) ข้อความลูกค้าจะถูกประมวลผลที่นั่นก่อนถูกปิด · ต้องตั้ง region ของโปรเจกต์เอง: Settings → Functions → Function Region → Singapore หรือ `vercel api /v9/projects/<project> -X PATCH` ส่ง `{"serverlessFunctionRegion":"sin1"}` แล้ว deploy ใหม่ · ตรวจหลัง deploy ว่าทุก function ขึ้น `[sin1]` (`vercel inspect <url>`) · สร้าง Upstash ที่ Singapore ให้อยู่ที่เดียวกัน · แจ้ง DPO ว่าข้อมูลประมวลผลและเก็บ token ที่สิงคโปร์
4. Node.js 22.x · repo ใช้ pnpm 12 (`packageManager` ใน `package.json` ที่ root) · ถ้า Vercel ใช้ pnpm คนละรุ่น ตั้งตัวแปร `ENABLE_EXPERIMENTAL_COREPACK=1`
5. ตั้งตัวแปรตามตารางด้านล่าง แล้ว deploy

ลองในเครื่องก่อน: รันสองคำสั่งใน `vercel.json` จากโฟลเดอร์นี้ แล้ว `pnpm typecheck`

## ตรวจ deployment

`scripts/smoke.mjs` ยิง request ที่เซ็นแล้ว 7 ครั้งไปที่ deployment ด้วยข้อมูลสมมติ: scope ผิดโดนปฏิเสธ · ข้อความผ่าน policy ทั้งสองแบบ · เลขบัตรโดนบล็อก · resolve อ่าน Upstash ได้ · secret ผิดตัวโดนปฏิเสธ · end-session ลบข้อมูลใน Upstash ได้ · รันในเทอร์มินัลของคุณเอง secret อยู่ใน shell ไม่ถูกพิมพ์ออกมา

```sh
read -s PDPA_SECRET && export PDPA_SECRET
read -s PDPA_RESOLVE_SECRET && export PDPA_RESOLVE_SECRET
read -s VERCEL_BYPASS && export VERCEL_BYPASS   # Settings → Deployment Protection → Protection Bypass for Automation
node apps/webhook/scripts/smoke.mjs https://<deployment>.vercel.app
```

- ข้อสุดท้าย (end-session) ลบ token ที่ข้อ otp เขียนไว้ · ใส่ `--keep` ท้ายคำสั่งเพื่อข้ามข้อนั้น แล้วเปิดดูใน Upstash → Data Browser ได้ภายใน 5 นาที (`pdpa:session:smoke_…` · `pdpa:tok:…`)
- ทุกข้อความส่งต่อไปที่ `/robots.txt` ของ deployment เอง ซึ่งรับ POST ไม่ได้ จึงตอบ 502 `forward_failed` ตามที่ตั้งใจ — ไม่มีข้อความออกไปนอก deployment
- Upstash ต่อไม่ได้: ข้อความ otp โดนบล็อกด้วย `PHONE` · resolve ตอบ `store_unavailable` · end-session ตอบ 500
- ตั้ง `ALLOWED_DESTINATIONS` ไว้: ข้อความโดนปฏิเสธ 400 เพราะ `/robots.txt` ไม่อยู่ในรายการ — ใช้ตอนยังไม่ได้ตั้ง หรือใส่ URL นั้นชั่วคราว

## ตั้งค่า (Vercel → Project → Settings → Environment Variables)

| ตัวแปร | ค่า |
|---|---|
| `PDPA_SECRET` | `openssl rand -hex 32` · ให้แอปแชทและระบบที่ตอบใช้เซ็น request |
| `FORWARD_URL` · `REPLY_URL` | **ไม่บังคับ** · ค่าตั้งต้นเมื่อ request ไม่ได้ระบุ `forwardTo` / `replyTo` |
| `ALLOWED_DESTINATIONS` | **ไม่บังคับ** · URL แบบ https คั่นด้วย `,` · ตั้งแล้ว request ระบุได้เฉพาะปลายทางในรายการ |
| `PDPA_RESOLVE_SECRET` | `openssl rand -hex 32` อีกค่า · ให้เฉพาะระบบที่ต้องใช้ค่าจริง |
| `KV_REST_API_URL` · `KV_REST_API_TOKEN` | Vercel → Storage → Upstash → Upstash for Redis (Singapore · Free) · Vercel ใส่ให้เมื่อเชื่อมกับโปรเจกต์ · ต่อ Upstash เองไม่ผ่าน Vercel ใช้ `UPSTASH_REDIS_REST_URL` · `UPSTASH_REDIS_REST_TOKEN` ได้ · **ไม่ใช่** integration "Redis" (Redis Cloud) ซึ่งไม่มี REST |

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
  headers: { 'content-type': 'application/json', ...(await signRequest(process.env.PDPA_SECRET, 'inbound', body)) },
  body,
})
```

- `sessionId` ใช้ id ห้องแชทที่ระบบของคุณออกเอง · webhook รับทุกค่าและเขียนลง log ตามที่ส่งมา (D25) — ใช้ LINE userId หรือเบอร์ ข้อมูลส่วนบุคคลจะอยู่ใน log
- ระบบที่ตอบได้รับ `replyTo` ไปด้วย · ส่งคำตอบมาที่ `/api/outbound` พร้อม `policy` `sessionId` และ `replyTo` เดิม เซ็นเป็น `'outbound'`
- `forwardTo` / `replyTo` ต้องเป็น https และห้ามเป็นที่อยู่ภายในเครือข่าย · ใครถือ `PDPA_SECRET` ก็ระบุปลายทางได้ จึงควรตั้ง `ALLOWED_DESTINATIONS` ถ้ารู้ปลายทางแล้ว

## ฝั่งที่รับ (`FORWARD_URL` · `REPLY_URL`)

```ts
import { verifyRequest } from '@eve-pdpa-extension/http'

export async function POST(request: Request) {
  const body = await request.text()
  // FORWARD_URL ตรวจ 'forward' · REPLY_URL ตรวจ 'reply' — ลายเซ็นของอีกขาใช้ไม่ได้
  if (!(await verifyRequest(process.env.PDPA_SECRET, 'forward', request.headers, body))) {
    return new Response('unauthorized', { status: 401 })
  }
  const { policy, sessionId, ref, text, replyTo } = JSON.parse(body)
  // ...
}
```

## บันทึกว่าข้อความไปที่ไหน

ทุกครั้งที่ส่งต่อ `lib/webhook.ts` พิมพ์หนึ่งบรรทัด `{ "type": "webhook.forward", "destination": "https://ai.example.com/inbound", "delivered": true, "status": 200, … }` ลง log ข้าง audit · ไม่มีข้อความแชท · ไม่เก็บ query ของ URL

## audit

ตอนนี้ webhook พิมพ์ audit ลง log ของ Vercel ซึ่งเก็บ 1 ชั่วโมง (Hobby) หรือ 1 วัน (Pro) · **ก่อนใช้กับลูกค้าจริงต้องส่งไปที่ที่เก็บถาวร** เช่น log drain หรือฐานข้อมูล โดยเฉพาะ event `token.resolve` ที่บอกว่าใครแลกค่าจริงไปเพื่ออะไร · audit ไม่มีค่าจริงอยู่เลย
