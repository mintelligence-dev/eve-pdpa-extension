# @thai-pdpa-guard/core

ตรวจจับและปิดข้อมูลส่วนบุคคลไทยในข้อความ ก่อนส่งต่อให้ AI model, tool, log หรือคนรีวิว

- เลขบัตรประชาชน · เบอร์โทร · อีเมล · เลขบัญชี · บัตรเครดิต · LINE user ID
- ปิดได้ 6 แบบ ตาม policy ที่กำหนด · ทุกครั้งที่ตรวจมี audit event ที่**ไม่มีค่าจริงอยู่ข้างใน**
- ไม่มี dependency · ~26 KB minified · ใช้ได้กับ Node 18.18+ · Deno · Bun · Cloudflare Workers · browser

> **เป็นเครื่องมือทางเทคนิค ไม่ใช่ใบรับรองการปฏิบัติตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล**
> การใช้ไลบรารีนี้ไม่ได้ทำให้ระบบของคุณปฏิบัติตามกฎหมายครบถ้วนโดยอัตโนมัติ

[English](./README.md)

---

## ติดตั้ง

```bash
npm install @thai-pdpa-guard/core
```

## เริ่มใช้

ต้องมี 2 อย่างก่อน:
1. ไฟล์ policy · ก๊อปตัวอย่างจากหัวข้อ [policy](#policy) ไปเป็น `pdpa-policy.json`
2. key สำหรับ action `hash` (ตัวอย่าง policy ใช้กับอีเมล) · สร้างด้วย `openssl rand -hex 32` แล้วเก็บเป็น `PDPA_HMAC_KEY` · ไม่มี key แล้ว policy ใช้ `hash` → `createGuard` จะ throw `ERR_PDPA_HMAC_KEY`

```ts
import { readFileSync } from 'node:fs'
import { createGuard, parsePolicy } from '@thai-pdpa-guard/core'

// สร้างครั้งเดียวตอน server เริ่ม · รันฝั่ง server เท่านั้น
const guard = createGuard({
  policy: parsePolicy(readFileSync('pdpa-policy.json', 'utf8')),
  hmacKey: process.env.PDPA_HMAC_KEY,
  onAudit: (event) => console.log(JSON.stringify(event)),   // ระบบจริงเขียนลงที่เก็บ audit ของคุณ
})

// 1. ข้อความจากลูกค้า → ก่อนส่งให้ AI
const inbound = await guard.process('เบอร์ ๐๙๑-๘๘๘-๗๗๗๗ ค่ะ', {
  sessionId: 'conv_8f2a',   // id ห้องแชท · ต้องส่งถ้า policy ใช้ tokenise
  ref: 'msg_10293',         // id ข้อความในระบบของคุณ · ใช้ตามจาก audit กลับมา
})
inbound.text   // 'เบอร์ [tok:rfdbkfrtnsmbvpsh] ค่ะ'   ← AI เห็นแค่นี้ · token สุ่มใหม่ทุกครั้ง

// 2. AI เรียก tool ส่ง OTP พร้อม token ที่เห็น · tool แลกเป็นค่าจริง
//    ในระบบจริง token มาจาก tool call ของ AI · ตัวอย่างนี้หยิบจากขั้นที่ 1 ให้รันต่อกันได้
const token = `[tok:${inbound.findings[0]?.tokenId}]`
const r = await guard.resolve(token, { purpose: 'otp_send', sessionId: 'conv_8f2a' })
r.ok && r.value   // '0918887777'

// 3. คำตอบของ AI → ก่อนส่งถึงลูกค้า
const out = await guard.process(`ส่ง OTP ไปที่ ${token} แล้วค่ะ`, {
  sessionId: 'conv_8f2a',
  boundary: 'outbound',
})
out.text   // 'ส่ง OTP ไปที่ xxx-xxx-๗๗๗๗ แล้วค่ะ'   ← ลูกค้าไม่เห็น token
```

- `process` คืน Promise · ถ้าที่เก็บ token เป็นแบบ sync (ค่าเริ่มต้น) ใช้ `processSync` ได้
- ข้อความที่ส่งกลับมา**คงรูปเดิมของลูกค้า** เลขไทยยังเป็นเลขไทย ตัวอักษรที่ไม่ใช่ข้อมูลส่วนบุคคลไม่ถูกแตะ

### `context` — ลูกค้าตอบแค่ตัวเลข

เลขบัญชีไม่มี check digit ตัวตรวจต้องเห็นคำบอกใบ้อย่าง "เลขบัญชี" ถึงจะจับ ถ้าร้านถามแล้วลูกค้าตอบแค่ตัวเลข ให้ส่งข้อความล่าสุดของร้านมาเป็น `context`:

```ts
await guard.process('123-4-56789-0', { sessionId: 'conv_8f2a' })
// text: '123-4-56789-0'   ← ไม่มีคำบอกใบ้ จึงไม่จับ

await guard.process('123-4-56789-0', { sessionId: 'conv_8f2a', context: 'รบกวนขอเลขบัญชีด้วยค่ะ' })
// text: 'xxx-x-xx789-0'
```

`context` ใช้อ่านคำบอกใบ้เท่านั้น ไม่ถูกตรวจหาข้อมูล ไม่ถูกแก้ และไม่ถูกเขียนลง audit

### `boundary` — ข้อความอยู่ตรงไหนของระบบ

| ค่า | ใช้กับ |
|---|---|
| `inbound` (ค่าเริ่มต้น) | ข้อความจากลูกค้า |
| `prompt` | prompt ที่ประกอบแล้วก่อนส่งให้ model |
| `tool_input` · `tool_output` | สิ่งที่ส่งให้ tool และที่ tool คืนกลับมา |
| `outbound` | คำตอบที่จะส่งถึงลูกค้า · **token ถูกแปลงเป็นค่าที่ปิดไว้** · token ของห้องอื่น หรือ token ที่ guard ไม่รู้จัก (หมดอายุ · ถูกลบ · แต่งขึ้นในรูปแบบเดียวกัน) กลายเป็น `[ข้อมูลที่ปิดไว้]` · ข้อความที่แค่คล้าย token แต่รูปแบบไม่ตรง เช่น `[tok:abc]` จะถูกส่งไปตามที่เขียน |

---

## policy

ไฟล์ JSON ที่บอกว่าข้อมูลแต่ละประเภทต้องทำอะไร:

```json
{
  "$schema": "./node_modules/@thai-pdpa-guard/core/schema/policy.schema.json",
  "entitySet": "0.1",
  "onUnmapped": "redact",
  "placeholderLanguage": "th",
  "entities": {
    "PHONE": { "action": "tokenise", "allowedPurposes": ["otp_send"], "ttlSec": 300, "display": "mask" },
    "TH_NATIONAL_ID": { "action": "redact" },
    "BANK_ACCOUNT": { "action": "mask", "keep": "last4" },
    "EMAIL": { "action": "hash" },
    "CREDIT_CARD": { "action": "block", "minConfidence": 0.6 },
    "LINE_USER_ID": { "action": "redact" }
  },
  "allowlist": {
    "exact": ["support@myshop.co.th", "02-123-4567"],
    "pattern": [".*@myshop\\.co\\.th"]
  }
}
```

- `$schema` ทำให้ VS Code และ editor อื่นเติมคำและเตือนตอนพิมพ์
- `parsePolicy` ตรวจทุกช่องตอนโหลด **ช่องที่สะกดผิดคือ error** ไม่ถูกข้ามเงียบ ๆ
- เช็คไฟล์ก่อนใช้จริงได้ด้วย `npx @thai-pdpa-guard/cli policy validate pdpa-policy.json`
- เขียนใน code แทนไฟล์ได้ด้วย `definePolicy({ ... })`

| ช่อง | ความหมาย |
|---|---|
| `entitySet` | ชุดประเภทข้อมูลที่ policy นี้เขียนไว้ (`"0.1"`) · บังคับ |
| `entities.<ประเภท>.action` | ทำอะไรกับข้อมูลประเภทนั้น · ดูหัวข้อถัดไป |
| `minConfidence` | ค่าที่ตัวตรวจมั่นใจต่ำกว่านี้จะไม่ถูกทำอะไร · ค่าเริ่มต้น `0.95` |
| `onUnmapped` | ประเภทที่ไม่ได้เขียนไว้ใน `entities` · `redact` (ค่าเริ่มต้น) · `flag` · `ignore` · ข้อมูลประเภทใหม่ในเวอร์ชันหน้าจะถูกปิดไว้ก่อนจนกว่าคุณจะเขียนกฎ |
| `allowlist` | ค่าที่ปล่อยผ่าน เช่นเบอร์และอีเมลของร้านเอง · `exact` เทียบแบบไม่สนรูปแบบ (`02-123-4567` = `021234567` = `๐๒๑๒๓๔๕๖๗`) · `pattern` ต้องตรงทั้งค่า |
| `placeholderLanguage` | `th` → `[เบอร์โทร]` · `en` → `[phone]` |

## action ทั้ง 6

ผลของข้อความ `เบอร์ 091-888-7777 ค่ะ`:

| action | ผล | ใช้เมื่อ |
|---|---|---|
| `redact` | `เบอร์ [เบอร์โทร] ค่ะ` | AI ไม่จำเป็นต้องรู้ค่า |
| `mask` | `เบอร์ xxx-xxx-xxxx ค่ะ` | อยากให้เห็นว่ามีเบอร์ แต่ไม่เห็นตัวเลข |
| `mask` + `keep: "last4"` | `เบอร์ xxx-xxx-7777 ค่ะ` | ให้ลูกค้ายืนยันได้ว่าเป็นเบอร์ไหน |
| `tokenise` | `เบอร์ [tok:ppfcrdqbdkttndvp] ค่ะ` | tool ต้องใช้ค่าจริงทีหลัง · แลกคืนได้เฉพาะ `allowedPurposes` · หมดอายุตาม `ttlSec` (สูงสุด 3600) |
| `hash` | `เบอร์ [PHONE:nmdfpsvvprsnpfgc] ค่ะ` | ต้องรู้ว่าเป็นคนเดิมโดยไม่รู้ค่า เช่นนับลูกค้าซ้ำ · ค่าเดียวกันได้ผลเดียวกันเสมอ · ต้องมี `hmacKey` |
| `flag` | `เบอร์ 091-888-7777 ค่ะ` | **ค่าถึง AI ตามที่พิมพ์** · แค่บันทึกใน audit |
| `block` | ข้อความว่าง · `outcome: 'blocked'` · `blockedBy: ['PHONE']` | ข้อมูลที่ห้ามส่งต่อเลย เช่นบัตรเครดิต |

ข้อความที่ถูก `block` คืน `text: ''` เสมอ ลืมเช็ค `outcome` ก็ไม่หลุด ใช้ `blockedBy` เลือกคำตอบให้ลูกค้าได้

## audit

ทุกครั้งที่ guard ทำงาน จะเรียก `onAudit` พร้อม event 1 ตัว:

| type | เมื่อไหร่ |
|---|---|
| `policy.loaded` | ครั้งเดียวตอนสร้าง guard · กฎฉบับเต็มที่ `policy.hash` หมายถึง · ค่าใน allowlist ถูกเก็บเป็น SHA-256 |
| `scan` | ทุกครั้งที่เรียก `process` / `processSync` · เจออะไร ตำแหน่งไหน ทำอะไรไป |
| `token.resolve` | ทุกครั้งที่ขอแลก token ทั้งที่ได้และถูกปฏิเสธ · purpose ที่ขอ · ใครขอ |

```json
{
  "schemaVersion": "1.0",
  "type": "scan",
  "sessionId": "conv_8f2a",
  "ref": "msg_10293",
  "boundary": "inbound",
  "policy": { "hash": "fnv1a64:ee142dc8b1111706", "entitySet": "0.1" },
  "findings": [
    { "entity": "PHONE", "start": 6, "end": 18, "confidence": 0.99, "detector": "phone",
      "action": "tokenise", "tokenId": "rfdbkfrtnsmbvpsh", "ttlSec": 300, "allowedPurposes": ["otp_send"] }
  ],
  "outcome": "processed"
}
```
(ตัดบางช่องออกให้สั้น · หน้าตาเต็มอยู่ใน `@thai-pdpa-guard/core/schema/audit-event.schema.json` ใช้ตรวจ event ในระบบ log ของคุณได้)

- เขียนเป็น NDJSON (1 event ต่อ 1 บรรทัด) ได้เลย
- `onAudit` เป็นแบบ sync · ถ้าปลายทางเป็น async ให้เก็บเข้า buffer ก่อน · ถ้า `onAudit` พัง ข้อความยังผ่าน แต่ถูกนับใน `guard.stats.auditSinkErrors` และส่งให้ `onError(error, { source: 'audit_sink' })`
- ไม่ส่ง `onAudit` → event ถูกทิ้ง และมีคำเตือนครั้งเดียว · ตั้งใจทิ้งให้ส่ง `onAudit: () => {}`

> **เก็บ audit log แยกจาก log ข้อความ** — event ไม่มีค่าจริง แต่ `start`/`end` บวกกับข้อความต้นฉบับ
> ได้ค่าจริงกลับมาทันที ถ้าสองอย่างอยู่ในที่เดียวกัน คนที่เปิดได้ก็ประกอบกลับได้

> **`sessionId` และ `ref` ถูกเขียนลง audit ตามที่คุณส่งมา** — ถ้าใช้ LINE userId หรือเบอร์โทรเป็น `sessionId`
> audit log ก็มีข้อมูลส่วนบุคคล ต้องเก็บและกำหนดระยะเวลาเก็บแบบข้อมูลส่วนบุคคล · ถ้าไม่ต้องการ
> ให้ใช้ id ที่ระบบสร้างเอง เช่น `conv_8f2a`

## ระบบที่รันหลาย process

token เก็บในหน่วยความจำของ process เดียวเป็นค่าเริ่มต้น ถ้ารันหลาย process หรือหลาย pod ต้องใช้ที่เก็บร่วมกัน ตัวอย่างกับ Redis ([node-redis](https://github.com/redis/node-redis) v4):

```ts
import { createGuard, type TokenStore } from '@thai-pdpa-guard/core'
import { createClient } from 'redis'

const redis = await createClient({ url: process.env.REDIS_URL }).connect()

const tokenStore: TokenStore = {
  sync: false,
  async set(id, rec) {
    const session = `pdpa:session:${rec.sessionId}`
    await redis.set(`pdpa:tok:${id}`, JSON.stringify(rec), { PXAT: rec.expiresAt })
    await redis.sAdd(session, id)
    // รายชื่อ token ของห้องต้องอยู่นานเท่า token ที่อายุยาวที่สุด ไม่อย่างนั้น endSession จะลบไม่ครบ
    // GT ยืดอายุได้อย่างเดียว ไม่หด · NX ตั้งครั้งแรก · ต้องใช้ Redis 7+
    if (!(await redis.pExpireAt(session, rec.expiresAt, 'GT'))) await redis.pExpireAt(session, rec.expiresAt, 'NX')
  },
  async get(id) {
    const raw = await redis.get(`pdpa:tok:${id}`)
    return raw === null ? undefined : JSON.parse(raw)
  },
  async delete(id) {
    await redis.del(`pdpa:tok:${id}`)
  },
  async clearSession(sessionId) {
    const ids = await redis.sMembers(`pdpa:session:${sessionId}`)
    await redis.del([...ids.map((id) => `pdpa:tok:${id}`), `pdpa:session:${sessionId}`])
  },
}

const guard = createGuard({ policy, tokenStore, onAudit })
await guard.process(text, { sessionId })   // ที่เก็บแบบ async ต้องใช้ process ไม่ใช่ processSync
```

- ต้องใช้ Redis 7 ขึ้นไป (`PEXPIREAT … GT`)
- Redis เก็บ**ค่าจริง**ไว้จนหมดอายุ · ต้องปิดการเข้าถึงจากภายนอก และไม่เปิด persistence ถ้าไม่จำเป็น
- เรียก `guard.endSession(sessionId)` เมื่อจบบทสนทนา เพื่อลบ token ของห้องนั้นทันที
- **ถ้าที่เก็บ token ใช้ไม่ได้** (Redis ล่ม · ที่เก็บในหน่วยความจำเต็ม 10,000 token) guard ไม่ปล่อยค่าจริงผ่าน และไม่ throw:
  - ข้อความที่ต้อง tokenise ถูก **block** · finding ใน audit มี `failed: 'token_store'` แยกออกจาก block ที่ policy สั่ง
  - `resolve` คืน `{ ok: false, reason: 'store_unavailable' }` และบันทึก audit เหมือนทุกครั้ง
  - token ในคำตอบขาออกกลายเป็น `[ข้อมูลที่ปิดไว้]` · audit บันทึกเป็น `unavailable`
  - ทุกครั้งเรียก `onError(error, { source: 'token_store' })` และนับใน `guard.stats.tokenStoreErrors` · **ให้ health check ดูค่านี้** ถ้าเพิ่มขึ้น แปลว่าที่เก็บมีปัญหาและข้อความกำลังถูก block

## error ที่ควรรู้

ทุกตัวเป็น `PdpaError` เช็คได้ที่ `error.code` · ข้อความ error ไม่มีค่าจริงอยู่ข้างใน

| code | เกิดเมื่อ |
|---|---|
| `ERR_PDPA_INVALID_POLICY` | policy ผิด · บอกชื่อช่องที่ผิด |
| `ERR_PDPA_HMAC_KEY` | policy ใช้ `hash` แต่ไม่มี `hmacKey` หรือสั้นกว่า 32 bytes · เกิดตอน `createGuard` |
| `ERR_PDPA_NO_SESSION` | policy ใช้ `tokenise` แต่ไม่ได้ส่ง `sessionId` |
| `ERR_PDPA_ASYNC_STORE` | เรียก `processSync` / `resolveSync` กับที่เก็บ token แบบ async **ใน policy ที่ใช้ tokenise** · policy ที่ไม่มี tokenise ไม่ได้ใช้ที่เก็บ token เลย จึงไม่ error |
| `ERR_PDPA_NO_CSPRNG` | runtime ไม่มีตัวสุ่มที่ปลอดภัย (Node 18) · ดูด้านล่าง |

## ข้อควรรู้ก่อนใช้

> **รัน guard ฝั่ง server เท่านั้น** — `hmacKey` และ token ที่อยู่ในเบราว์เซอร์ ใครก็เปิดดูได้
> และผู้ใช้แก้ code ในเบราว์เซอร์ให้ข้ามการตรวจได้

> **ค่าที่ผ่าน `hash` ยังนับเป็นข้อมูลส่วนบุคคล ตราบใดที่ key ยังอยู่** — เบอร์มือถือไทยมีราว 10⁸ ค่า
> ใครได้ `hmacKey` ไปจะ hash ได้ครบทุกเบอร์ในไม่กี่นาที · `hash` คือการแฝงข้อมูล (pseudonymisation)
> ไม่ใช่การทำให้ไม่ระบุตัวตน (anonymisation) · key ต้องสุ่มและยาวอย่างน้อย 32 bytes
> (`openssl rand -hex 32`) · เปลี่ยน key แล้ว hash เก่ากับใหม่จะไม่ตรงกัน

> **purpose ไม่ใช่รหัสผ่าน** — โค้ดที่ถือ guard ระบุ purpose อะไรก็ได้ · ช่วยกันการใช้ผิดโดยไม่ตั้งใจ
> และทำให้ทุกการขอมีหลักฐานใน audit · แต่กันคนในที่ตั้งใจโกงไม่ได้

> **Node 18 ต้องส่ง `randomSource` เองถ้าใช้ `tokenise`** — Node 18 ไม่มี `globalThis.crypto`
> · ส่ง `randomSource: (n) => randomFillSync(new Uint8Array(n))` (`import { randomFillSync } from 'node:crypto'`)
> · ต้องเป็นตัวสุ่มที่ปลอดภัย ห้ามใช้ `Math.random()` · Node 20+ ไม่ต้องทำอะไร

## ข้อจำกัดที่รู้อยู่

- **ยังไม่จับชื่อคนและที่อยู่** (วางแผนไว้ 0.2) · audit event มี `engine.entitiesSupported` บอกว่าตรวจอะไรบ้าง รายงานที่ไม่เจอชื่อจึงไม่ได้แปลว่าไม่มีชื่อ
- **เลขบัญชีต้องมีคำบอกใบ้** เช่น "เลขบัญชี" "โอนเข้า" หรือส่ง `context` · เลข 10 หลักเปล่า ๆ แยกจากเลขออเดอร์ไม่ได้
- **เบอร์โทรที่อยู่ในเลขพัสดุถูกจับด้วย** เช่น `TH0956318274` · ตั้งใจไม่แก้ เพราะถ้ายอมให้ตัวอักษรหน้าตัวเลขทำให้ไม่จับ ใครก็ซ่อนเบอร์จริงได้ด้วยการพิมพ์ `x0918887777`
- **บัตรเครดิตที่ไม่รู้จักธนาคาร** ได้ confidence 0.6 ต่ำกว่าค่าเริ่มต้น 0.95 · ถ้าต้องการปิดด้วย ตั้ง `minConfidence: 0.6`
- **ค่า confidence และคำบอกใบ้ตั้งจากเหตุผล** ยังไม่ได้ปรับจากข้อมูลจริงของลูกค้า

## ความแม่นยำ

วัดตามนิยามที่เข้มงวด: จับได้ไม่ครบทั้งค่า (เช่นปิด 12 จาก 13 หลัก) นับเป็น**จับไม่ได้** ไม่ใช่ครึ่งคะแนน

ชุด holdout 3,380 ข้อความ ซึ่งไม่ได้ใช้ปรับตัวตรวจ:

| ประเภท | จำนวนค่า | precision | recall | recall เมื่อส่ง `context` |
|---|---|---|---|---|
| เลขบัตรประชาชน | 25 | 100% | 100% | 100% |
| เบอร์โทร | 160 | 98.2% | 100% | 100% |
| อีเมล | 65 | 100% | 100% | 100% |
| เลขบัญชี | 50 | 100% | 80% | 100% |
| บัตรเครดิต | 15 | 100% | 100% | 100% |
| LINE user ID | 5 | 100% | 100% | 100% |

> **อ่านตัวเลขนี้ด้วยความระวัง** — ข้อความทั้งหมดเป็นข้อมูลสังเคราะห์ วัดได้เฉพาะรูปแบบที่เราคิดออก
> ข้อมูลจริงมีรูปแบบที่คิดไม่ถึงเสมอ **ตัวเลขทุกตัวเป็นขอบบน** ไม่ใช่สิ่งที่จะได้ใน production
> และบางประเภทมีตัวอย่างน้อย (LINE user ID 5 ค่า)

## CLI

ตรวจไฟล์แชทเก่าได้โดยไม่ต้องเขียนโค้ด (JSONL · CSV · ไฟล์ export จาก LINE OA):

```bash
npx @thai-pdpa-guard/cli scan chats.csv --policy pdpa-policy.json
```

ดู [`@thai-pdpa-guard/cli`](https://www.npmjs.com/package/@thai-pdpa-guard/cli)

## แจ้งช่องโหว่

**อย่าเปิด issue สาธารณะ** · ส่งอีเมลถึง **kunlachat@m-intelligence.tech** หัวเรื่องขึ้นต้นด้วย `[thai-pdpa-guard security]` · ใช้ข้อมูลปลอมในการทำซ้ำ ห้ามส่งข้อมูลส่วนบุคคลจริง

## License

Apache-2.0
