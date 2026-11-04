# @eve-pdpa-extension/eve

ปิดข้อมูลส่วนบุคคลไทยใน agent ที่สร้างด้วย [eve](https://eve.dev) ก่อนที่ข้อมูลจะไปถึงโมเดล ถูกบันทึก หรือถูกส่งกลับไปให้ลูกค้า

```text
ลูกค้าพิมพ์          ขอ OTP ที่เบอร์ 091-888-7777
eve บันทึก / โมเดลอ่าน  ขอ OTP ที่เบอร์ [tok:pmkjhrpmbrqfnbqc]
tool otp_send ได้     0918887777                     ← ค่าจริง เห็นแค่ใน tool นี้
คำตอบที่ลูกค้าเห็น   ส่ง OTP ไปที่ xxx-xxx-7777 แล้วค่ะ
```

- ใช้ตัวตรวจจากแพ็กเกจ [`@eve-pdpa-extension/core`](../core) ได้แก่ เลขบัตรประชาชน, เบอร์โทร, อีเมล, เลขบัญชี, บัตรเครดิต และ LINE user ID
- audit event **ไม่มีค่าจริงอยู่ข้างใน**
- ใช้กับ Node 24 ขึ้นไป ทดสอบกับ eve **0.80.1** (eve ยังเป็น beta ให้รันเทสต์ทุกครั้งก่อนเปลี่ยนรุ่น)

> **เป็นเครื่องมือทางเทคนิค ไม่ใช่ใบรับรองการปฏิบัติตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล**

[English](./README.md)

---

## ทำงานยังไง

ข้อมูลรั่วได้หลายจุดใน agent แพ็กเกจนี้จึงมีตัวห่อให้ทุกจุด แต่ละตัวห่อคนละส่วนของ agent

```text
ลูกค้า ◀──▶ channel ── withPdpaGuard ── ปิดข้อความขาเข้าก่อน eve บันทึก
                                       และปิดคำตอบกับคำถามขาออก
                   │
                   ▼
               pdpaHook ──────────── เก็บ session · ยกเลิกข้อความต้องห้าม · เตือนถ้าลืมห่อ channel
                   │
                   ▼
              guardModel ─────────── ปิด prompt ทั้งก้อนก่อนส่งให้ผู้ให้บริการโมเดล
                   │
                   ▼
         withTokenResolution ─────── ให้ tool ที่อนุญาตได้ค่าจริงหลัง token
          withOutputGuard ────────── ปิดผลของ tool ที่ดึงข้อมูลส่วนบุคคลมาเอง
```

| ตัวช่วย | ห่ออะไร | ถ้าไม่ใส่ |
|---|---|---|
| `withPdpaGuard` | channel ทั้งสองทาง | ขาเข้า: eve บันทึกค่าจริง และโมเดลเห็นค่าจริง · ขาออก: ลูกค้าเห็น `[tok:…]` ดิบๆ ในคำตอบ |
| `pdpaHook` | hook ของ agent | tool แลก token ที่ออกบน channel ที่มี address (Slack, Telegram, …) ไม่ได้ เพราะไม่รู้ว่าเป็นแชตไหน (HTTP channel ของ eve ยังใช้ได้) |
| `guardModel` | โมเดล | ผลจาก tool ที่ไม่ได้ห่อ connection และ memory จะส่งค่าจริงไปหาผู้ให้บริการโมเดล |
| `withTokenResolution` | tool ที่ต้องใช้ค่าจริง | tool ได้ `[tok:…]` แทนเบอร์จริง เลยทำงานไม่ได้ |
| `withOutputGuard` | tool ที่ดึงข้อมูลส่วนบุคคลมาเอง เช่น CRM | eve บันทึกและ stream ผลของ tool พร้อมค่าจริง |

> **mount เป็น extension อย่างเดียวไม่ได้ปิดข้อมูลเลย** eve เรียก hook *หลัง* บันทึกข้อความไปแล้ว และ hook เปลี่ยนสิ่งที่โมเดลอ่านไม่ได้ การปิดข้อมูลเกิดตรงที่คุณห่อ channel, tool และ model เอง

---

## ติดตั้งใน 3 ขั้น

เริ่มจาก agent ที่สร้างด้วย `eve init`: เพิ่ม item · แก้ `agent/agent.ts` · ตั้ง key 2 ตัว

<!-- pdpa-install -->
```bash
eve add https://cdn.jsdelivr.net/npm/@eve-pdpa-extension/eve@0.1.1/r/pdpa.json --overwrite
# แล้วใส่ค่า key 2 ตัวที่ eve add เขียนชื่อไว้ใน .env.local ตัวละ `openssl rand -hex 32`:
# PDPA_HMAC_KEY=...
# PDPA_SESSION_KEY=...
```

```ts title="agent/agent.ts"
import { defineAgent } from "eve";
import { pdpa } from "./lib/pdpa.js";

export default defineAgent({
  model: pdpa.model("openai/gpt-6-luna-fast"),
  modelContextWindowTokens: 1_050_000,
  reasoning: "high",
  defaultTools: false,
});
```
<!-- /pdpa-install -->

**1. `eve add` เขียนไฟล์ 4 ไฟล์** และเพิ่ม `@eve-pdpa-extension/eve` ลงใน `package.json`

| ไฟล์ | คืออะไร |
|---|---|
| `policies/pdpa-policy.json` | ข้อมูลแต่ละประเภทจะถูกทำอะไร: เบอร์โทรเป็น token ให้ `otp_send` ใช้ · เลขบัตรประชาชนถูกปิด · เลขบัตรเครดิตทำให้ข้อความไม่ถูกส่งต่อ … แก้ให้เข้ากับงานได้ |
| `agent/lib/pdpa.ts` | `createPdpa({ policy })`: guard พร้อม key และ token store ที่อ่านจาก env |
| `agent/hooks/pdpa.ts` | `export default pdpa.hook`: ผูกแต่ละแชตเข้ากับ token ของแชตนั้น |
| `agent/channels/eve.ts` | HTTP channel ของ eve ที่ห่อแล้ว **`--overwrite` ทับไฟล์ที่ `eve init` สร้างไว้** และทับไฟล์ไหนก็ตามใน 4 ไฟล์นี้ที่คุณแก้ไว้ด้วย ถ้าไม่ใส่ eve add จะข้ามไฟล์นี้ไปเงียบๆ แล้ว channel ก็ยังไม่ถูกห่อ |

**2. ใน `agent/agent.ts`** แก้ 4 บรรทัด: import `pdpa` · ห่อ model เดิมด้วย `pdpa.model(…)` · ใส่ `modelContextWindowTokens` (model ที่ห่อแล้ว eve จะหา id ใน catalog ไม่เจอ ให้ใส่ context window ของ model ที่ใช้) · ปิด default tools ของ eve (bash, ไฟล์, web fetch) ซึ่งส่งสิ่งที่โมเดลอ่านออกไปในที่ที่ไม่มี wrapper ไหนดูอยู่ได้

**3. key** เป็นค่าลับอะไรก็ได้ 2 ตัว ยาวอย่างน้อย 32 bytes ถ้าไม่ตั้ง `eve dev` จะใช้ key สำหรับ dev และบอกครั้งเดียว ส่วน production จะไม่ยอมเริ่ม

**ตรวจ** `eve-pdpa-check` อ่านโปรเจกต์แล้วบอกว่าขาดอะไร บอกแค่ชื่อ ไม่พิมพ์ค่า

```bash
npx eve-pdpa-check                # channel, model, hook, รุ่นของ eve
npx eve-pdpa-check --production   # ตรวจ key ทั้งสองตัว และ token store ที่ใช้ร่วมกันด้วย
```

ถ้า jsDelivr ล่ม ไฟล์เดียวกันอยู่ที่ `https://unpkg.com/@eve-pdpa-extension/eve@0.1.1/r/pdpa.json`

### ขึ้น Vercel

1. เพิ่ม **Upstash for Redis** ให้โปรเจกต์จาก Vercel Marketplace จะได้ `KV_REST_API_URL` และ `KV_REST_API_TOKEN` (หรือตั้ง `UPSTASH_REDIS_REST_URL` และ `UPSTASH_REDIS_REST_TOKEN` เอง) token เก็บไว้ที่นั่น function ทุกตัวจึงแลก token ได้ · key ขึ้นต้นด้วย `pdpa-eve:`
2. ตั้ง `PDPA_HMAC_KEY` และ `PDPA_SESSION_KEY` ให้ Production เป็นค่าใหม่ ไม่ใช่ค่าใน `.env.local`

ถ้า `VERCEL_ENV` เป็น `production` แล้วขาด key หรือ store `createPdpa` จะ throw ตอน agent โหลด พร้อมบอกชื่อตัวแปร ที่อื่นจะใช้ key สำหรับ dev และ memory store ซึ่งเห็นได้แค่เครื่องเดียว

### tool ที่ต้องใช้ค่าจริง

```ts
// agent/tools/otp_send.ts
import { defineTool } from "eve/tools";
import { pdpa } from "../lib/pdpa.js";

export default pdpa.tool(
  defineTool({
    description: "Send an OTP by SMS. Pass the phone number as written in the chat.",
    inputSchema: { type: "object", properties: { phone: { type: "string" } }, required: ["phone"] },
    async execute(input: { phone: string }) {
      // ตรงนี้ input.phone เป็นเบอร์จริง และเป็นที่เดียวที่เห็น
      return { sent: true, to: input.phone };
    },
  }),
  "otp_send", // ต้องอยู่ใน allowedPurposes ของ PHONE ใน policy
);
```

### channel อื่น

ห่อทุกไฟล์ใน `agent/channels/` แบบเดียวกัน พร้อมชื่อไฟล์ (ไม่มีนามสกุล)

```ts
// agent/channels/telegram.ts
import { telegramChannel } from "eve/channels/telegram";
import { pdpa } from "../lib/pdpa.js";

export default pdpa.channel(telegramChannel(), "telegram");
```

---

## ตั้งเองทีละขั้น

สิ่งที่ `createPdpa` ทำให้ แยกเป็นทีละ wrapper ยังใช้ได้เหมือนเดิม และ `pdpa.channel`, `pdpa.model`, `pdpa.tool`, `pdpa.hook` ก็เรียกพวกนี้ตรงๆ

### 1. สร้าง guard และ policy

ไฟล์นี้เป็นที่เดียวที่ตัดสินว่าข้อมูลแต่ละประเภทจะถูกทำอะไร ทุกขั้นถัดไปจะ import `pdpa` จากไฟล์นี้

```ts
// agent/lib/guard.ts
import { createGuard, createMemoryTokenStore, definePolicy } from '@eve-pdpa-extension/core'

export const policy = definePolicy({
  entitySet: '0.1',
  entities: {
    PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'], ttlSec: 300, display: 'mask' },
    TH_NATIONAL_ID: { action: 'redact' },
    CREDIT_CARD: { action: 'block', minConfidence: 0.6 },
  },
})

export const guard = createGuard({
  policy,
  tokenStore: createMemoryTokenStore(),   // production ใช้ store ที่แชร์กันได้ เช่น Upstash
  onAudit: (event) => console.log(JSON.stringify(event)),
})

// สร้างด้วย openssl rand -hex 32 และใช้ key เดียวกันทั้ง deployment
export const pdpa = { guard, sessionKey: process.env.PDPA_SESSION_KEY ?? '' }
```

**action ที่เลือกได้**

| action | โมเดลเห็น | ใช้เมื่อ |
|---|---|---|
| `redact` | `[ข้อมูลที่ปิดไว้]` | ไม่มีใครต้องใช้ค่านี้เลย |
| `mask` | `xxx-xxx-7777` | ลูกค้าต้องดูว่าเป็นเบอร์ไหน แต่ไม่ต้องเห็นทั้งหมด |
| `tokenise` | `[tok:…]` | มี tool ที่ต้องใช้ค่าจริง เช่นส่ง OTP |
| `hash` | `[PHONE:nmdfpsvvprsnpfgc]` ค่าเดิมได้ผลเดิมทุกครั้ง | ต้องรู้ว่าเป็นคนเดิมไหม โดยไม่ต้องรู้ค่าจริง (ต้องใส่ `hmacKey` ใน `createGuard`) |
| `flag` | ค่าจริง (แค่บันทึกใน audit) | ตั้งใจให้ผ่าน แต่อยากรู้ว่าเจอ |
| `block` | ไม่มีอะไรเลย ข้อความถูกปฏิเสธ | ข้อมูลที่ไม่ควรรับไว้เลย เช่นเลขบัตรเครดิต |

**`allowedPurposes` คืออะไร** ใช้กับ `tokenise` เท่านั้น เป็นรายการ "เหตุผล" ที่อนุญาตให้แลก token กลับเป็นค่าจริงได้ ชื่อตั้งเองได้ทั้งหมด เช่น `'otp_send'` หรือ `'callback'` แล้วไปใส่ชื่อเดียวกันใน tool ที่ขั้น 4 ถ้าชื่อไม่ตรงกัน tool จะโดนปฏิเสธทุกครั้ง

### 2. ห่อ channel

```ts
// agent/channels/slack.ts
import { withPdpaGuard } from '@eve-pdpa-extension/eve/guard'
import { slackChannel } from 'eve/channels/slack'
import { pdpa } from '../lib/guard.js'

export default withPdpaGuard(slackChannel(), {
  ...pdpa,
  channelName: 'slack',   // ต้องตรงกับชื่อไฟล์นี้ (ไม่มีนามสกุล)
})
```

ห่อทุกไฟล์ใน `agent/channels/` ไม่ว่าจะเป็น Slack, Telegram, Teams, Discord หรือ channel ที่เขียนเอง เขียนแบบเดียวกันทุกตัวและปิดทั้งสองทาง ไฟล์ไหนลืมห่อ ข้อความที่ผ่าน channel นั้นจะเข้าไปถึง eve พร้อมค่าจริง และ token ที่โมเดลเขียนจะถูกโพสต์ออกไปตามที่เขียน

### 3. ลงทะเบียน hook

```ts
// agent/hooks/pdpa.ts
import { pdpaHook } from '@eve-pdpa-extension/eve/guard'
import { pdpa } from '../lib/guard.js'

export default pdpaHook(pdpa)
```

tool มองไม่เห็นว่าข้อความมาจากแชตไหน hook ตัวนี้จะจำไว้ให้ ถ้าใช้ `tokenise` ต้องมี hook นี้เสมอ

### 4. ห่อ tool ที่ยุ่งกับข้อมูลส่วนบุคคล

tool ที่ต้องใช้ค่าจริงจากแชต ให้ห่อด้วย `withTokenResolution`

```ts
// agent/tools/otp_send.ts
import { withTokenResolution } from '@eve-pdpa-extension/eve/guard'
import { defineTool } from 'eve/tools'
import { pdpa } from '../lib/guard.js'

export default withTokenResolution(
  defineTool({
    description: 'Send an OTP by SMS. Pass the phone number as written in the chat.',
    inputSchema: { type: 'object', properties: { phone: { type: 'string' } }, required: ['phone'] },
    async execute(input: { phone: string }) {
      // ตรงนี้ input.phone คือเบอร์จริง และมีแค่ตรงนี้ที่เห็น
      return { sent: true, to: input.phone }
    },
  }),
  { ...pdpa, purpose: 'otp_send' },   // ต้องอยู่ใน allowedPurposes ของขั้น 1
)
```

tool ที่ดึงข้อมูลส่วนบุคคลมาจากที่อื่นเอง เช่น CRM หรือฐานข้อมูล ให้ห่อด้วย `withOutputGuard` ตัวนี้ไม่ต้องใส่ `purpose` เพราะไม่ได้แลก token

```ts
// agent/tools/crm_lookup.ts
import { withOutputGuard } from '@eve-pdpa-extension/eve/guard'
import { defineTool } from 'eve/tools'
import { pdpa } from '../lib/guard.js'

export default withOutputGuard(
  defineTool({
    description: 'Look up a customer by their customer number.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async execute(input: { id: string }) {
      // ดึงข้อมูลลูกค้าจากที่อื่น: ผลที่คืนมาถูกปิดข้อมูลก่อน eve เก็บ
      return { id: input.id, phone: '091-888-7777' }
    },
  }),
  pdpa,
)
```

ต้องห่อเพราะ eve เก็บและ stream ผลของ tool ไว้ตามที่ได้มา ส่วน `guardModel` ปิดให้แค่ตอนส่งให้โมเดล tool ที่ไม่ได้ยุ่งกับข้อมูลส่วนบุคคลไม่ต้องห่อ

### 5. ห่อโมเดล

```ts
// agent/agent.ts
import { guardModel } from '@eve-pdpa-extension/eve/guard'
import { defineAgent } from 'eve'
import { pdpa } from './lib/guard.js'

export default defineAgent({
  model: guardModel('anthropic/claude-opus-5.5', pdpa),
  modelContextWindowTokens: 200_000,   // โมเดลที่ห่อแล้ว eve หาใน catalog ไม่เจอ ต้องบอกเอง
  defaultTools: false,
})
```

เป็นด่านสุดท้ายก่อนข้อมูลออกนอกระบบ ปิดทุกอย่างที่ขั้นก่อนหน้าไม่ได้ปิดไว้ เช่นผลจาก tool ที่ไม่ได้ห่อ หรือข้อมูลที่ดึงมาจาก connection

---

## อ้างอิง

### `createPdpa(options)`

```ts
import { createPdpa } from '@eve-pdpa-extension/eve/guard'
```

| Option | ค่าตั้งต้น |
|---|---|
| `policy` | ต้องใส่: policy JSON ที่ import มา (`with { type: 'json' }`) หรือผลของ `definePolicy` |
| `hmacKey`, `sessionKey` | env `PDPA_HMAC_KEY`, `PDPA_SESSION_KEY` · นอก production ใช้ค่าสำหรับ dev |
| `tokenStore` | Upstash จาก env `UPSTASH_REDIS_REST_*` หรือ `KV_REST_API_*` · นอก production ใช้ memory store ตัวเดียวทั้ง process |
| `upstash.prefix` | `'pdpa-eve:'` ใส่ไว้หน้าทุก key ที่เขียน |
| `onAudit` | เขียน NDJSON ลง stdout บรรทัดละ 1 event · event ไม่มีค่าจริงเลย |
| `production` | `process.env.VERCEL_ENV === 'production'` (ไม่อ่าน `NODE_ENV` เพราะเครื่องมือ build ตั้งค่านี้เอง) |
| `env` | `process.env` · ส่งของตัวเองมาเพื่อไม่ให้อ่านที่อื่น |

คืนค่า `{ guard, sessionKey, policy, channel, model, tool, hook }`

| | เท่ากับ |
|---|---|
| `pdpa.channel(channel, name, options?)` | `withPdpaGuard(channel, { guard, sessionKey, policy, channelName: name, ...options })` · ไม่ใส่ `name` ได้เฉพาะ HTTP channel ของ eve |
| `pdpa.model(model)` | `guardModel(model, { guard, sessionKey })` |
| `pdpa.tool(tool, purpose)` | `withTokenResolution(tool, { guard, sessionKey, purpose })` |
| `pdpa.hook` | `pdpaHook({ guard, sessionKey })` |

**Error** เป็น `PdpaConfigError` throw ตอน agent โหลด ข้อความบอกว่าต้องตั้งอะไร ไม่มีค่าจริง

| `code` | เมื่อ |
|---|---|
| `ERR_PDPA_EVE_HMAC_KEY`, `ERR_PDPA_EVE_SESSION_KEY` | production ไม่มี key หรือ key สั้นกว่า 32 bytes (ทุกที่) |
| `ERR_PDPA_EVE_STORE` | production ไม่มี token store หรือตั้ง URL กับ token ไว้แค่ตัวเดียว |
| `ERR_PDPA_EVE_PURPOSE` | `pdpa.tool` ด้วย purpose ที่ไม่มี entity ไหนใน policy อนุญาต |
| `ERR_PDPA_EVE_ADAPTER` | channel ของ eve รุ่นที่แพ็กเกจนี้ปิดข้อมูลขาออกไม่ได้ (ข้างล่าง) |

### `eve-pdpa-check [--production] [--cwd <dir>]`

| ตรวจ | ไม่ผ่านเมื่อ |
|---|---|
| channels | ไฟล์ใน `agent/channels/` ไม่ได้ห่อด้วย `pdpa.channel(` หรือ `withPdpaGuard(` |
| model | `agent/agent.ts` ไม่มี `pdpa.model(` หรือ `guardModel(` |
| hook | ไม่มีไฟล์ใน `agent/hooks/` ที่ default export เป็น `pdpa.hook` หรือ `pdpaHook(…)` |
| eve | eve ที่ติดตั้งไม่ใช่ 0.80.x |
| keys, store | ใช้ `--production` แล้วไม่ได้ตั้ง key หรือ token store ที่ใช้ร่วมกัน (ใน env หรือไฟล์ `.env`) |
| defaultTools | เตือนอย่างเดียว เมื่อ `agent/agent.ts` ไม่ได้ตั้ง `defaultTools: false` |

exit 0 = ผ่าน · 1 = เจอปัญหา · 2 = ใช้คำสั่งผิด

### `withPdpaGuard(channel, options)`

คืน channel ชุดใหม่ที่ปิดข้อมูลในทุกข้อความขาเข้าก่อน และปิดคำตอบก่อน channel โพสต์ (ดูข้างล่าง) ส่วน route, events, renderers และ field อื่นคงไว้ตามเดิม

| ตัวเลือก | ค่า |
|---|---|
| `guard`, `sessionKey` | จาก `pdpa` ในขั้น 1 |
| `channelName` | ชื่อไฟล์ของ channel (ต้องใส่ ยกเว้น HTTP channel ของ eve) |
| `files` | `'pass'` (ค่าตั้งต้น) ปล่อยไฟล์ผ่าน หรือ `'block'` ปฏิเสธข้อความที่มีไฟล์ |
| `onBlock({ reason, blockedBy })` | เรียกเมื่อข้อความถูก block เช่นใช้ส่งข้อความแจ้งลูกค้า |
| `language` | ภาษาของข้อความแจ้ง `'th'` (ค่าตั้งต้น) |
| `outbound` | `true` (ค่าตั้งต้น) ปิดสิ่งที่ channel โพสต์ · `false` ปล่อย handler ของ channel ไว้ตามเดิม |
| `policy`, `allowRawTokensInOutput` | ใช้กับ HTTP channel ของ eve (ดูข้างล่าง) |

**ตรวจตรงไหนบ้าง**

| ทางเข้า | ตรวจอะไร |
|---|---|
| `from(address).send()` ซึ่ง Slack, Teams, Telegram, Chat SDK bridge และ channel ที่เขียนเองใช้ | ข้อความ, `context` และ `title` |
| `attachSession(id).send()`, `to(channel, target).send()`, `ctx.from().send()` ใน `receive` และ WebSocket route | เหมือนกัน |
| `respond()` ของ handle เดียวกัน ที่ใช้ตอบการอนุมัติและคำถาม | คำตอบที่พิมพ์เองหรือหมายเหตุตอนกด cancel (`text`) และ `context` ส่วนการกดปุ่ม (`requestId`, `optionId`) ส่งผ่านตามเดิม |
| HTTP channel ของ eve: `POST /eve/v1/session` และ `POST /eve/v1/session/:sessionId` | `message`, `inputResponses[].text` และ `clientContext` ใน JSON body |

**เมื่อข้อความถูก block** ข้อความนั้นจะไม่ถูกส่งต่อ `onBlock` จะทำงาน แล้ว send จะ throw `PdpaBlockedError` (channel ของ eve จับไว้และเขียน log) ถ้าเป็น HTTP route ของ eve จะตอบ `422 { ok: false, code: "pdpa_blocked", error }` ถ้า token store ล่มก็ block เหมือนกัน แต่บอกเหตุผลอีกแบบ คำตอบของคำถามหรือการอนุมัติที่ถูก block ก็ทำแบบเดียวกัน และคำขอนั้นยังรอคำตอบอยู่ ผู้ใช้ตอบใหม่ได้

**ปิดอะไรบ้างตอนขาออก** channel ของ eve โพสต์ข้อความจาก handler ซึ่งมีหนึ่งตัวต่อหนึ่งชนิด event `withPdpaGuard` จะปิดข้อความใน event (boundary `outbound`) ของทุก handler ที่ channel มี แล้วเรียก handler เดิมของ channel ด้วยข้อความที่ปิดแล้ว channel จึงโพสต์เหมือนตอนไม่มี guard ทุกอย่าง

| event | ปิดอะไร |
|---|---|
| `message.completed` | คำตอบ และข้อความที่โมเดลพิมพ์ก่อนเรียก tool (Slack แสดงเป็นสถานะของ thread) |
| `input.requested` | คำถาม ตัวเลือก และ input ของ tool ที่รออนุมัติ |
| `input.resolved` | คำตอบที่พิมพ์เองซึ่งแสดงกลับบนการ์ด |
| `actions.requested`, `action.partial`, `action.result` | label ที่ tool แสดงตอนทำงาน (ถ้า label สร้างจาก input ของ tool จะโชว์ token) |
| `reasoning.completed` | ความคิดของโมเดลที่จบแล้ว |

token ที่รู้จักแสดงในรูปที่ตั้งไว้ใน `display` เช่น `xxx-xxx-7777` · token ที่ไม่รู้จักหรือเป็นของแชตอื่นกลายเป็น `[ข้อมูลที่ปิดไว้]` · ข้อความที่ policy สั่ง block ถูกแทนด้วยข้อความแจ้ง (ตาม `language`) · ถ้า guard ตอบไม่ได้ เช่น token store ล่ม จะไม่โพสต์อะไรเลย ส่วนที่ eve เก็บและ stream ไม่เปลี่ยน ประวัติของ session ยังมี token อยู่

handler เหล่านี้อยู่ใน `adapter` ของ channel ซึ่ง eve ไม่ได้เขียนไว้ในเอกสาร (0.80.1) เทสต์ของแพ็กเกจรันมันบน eve จริง ถ้า eve รุ่นไหนเปลี่ยนโครงนี้ เทสต์จะล้ม ส่วน channel ที่ adapter ส่งออกผ่าน event ที่ eve 0.80.x ไม่มีเลย เช่น `interaction.opened` และ `interaction.settled` ของ eve 1.0.0-rc.1 จะ throw `ERR_PDPA_EVE_ADAPTER` ตอนห่อ แทนที่จะส่งคำตอบออกไปโดยไม่ได้ปิดข้อมูล

**HTTP channel ของ eve กับ token** channel นี้ stream คำตอบออกไปตามที่โมเดลเขียน ถ้าโมเดลพิมพ์ `[tok:…]` ซ้ำ ผู้เรียกจะเห็น token นั้น ดังนั้นการห่อ channel นี้ด้วย policy ที่มี `tokenise` จะ throw เว้นแต่ตั้ง `allowRawTokensInOutput: true` ซึ่งควรใช้ในเครื่องเท่านั้น

guard ของ core ไม่เปิดให้อ่าน policy จึงต้องส่ง `policy` เข้ามาด้วยเพื่อตรวจตั้งแต่ตอนห่อ ถ้าไม่ส่ง ข้อความแรกที่จะถูก tokenise บน channel นี้จะถูกปฏิเสธด้วย `500 pdpa_config`

### `withTokenResolution(tool, { guard, sessionKey, purpose, fields? })`

ตอน tool ถูกเรียก:
1. แลก token ทุกตัวใน input (หรือเฉพาะ field ที่ระบุใน `fields` เช่น `['phone']`) เป็นค่าจริงด้วย `guard.resolve(token, { purpose, sessionId })`
2. เรียก `execute` เดิมด้วยค่าจริง
3. ปิดข้อมูลในผลลัพธ์ (boundary `tool_output`) ก่อนคืน เพราะ eve stream และเก็บผลของ tool ไว้ด้วย ไม่ได้แค่ส่งให้โมเดล

ถ้า token ใช้ไม่ได้ `execute` เดิม**จะไม่ถูกเรียก** โมเดลได้คำตอบแบบนี้แทน เพื่อให้ถามลูกค้าใหม่

| เหตุผล | ตัวอย่าง |
|---|---|
| หมดอายุ (เกิน `ttlSec`) | `{ ok: false, reason: 'expired', ask: 'The value has expired. Ask the customer for it again.' }` |
| เป็น token ของแชตอื่น | `{ ok: false, reason: …, ask: … }` |
| `purpose` ไม่อยู่ใน `allowedPurposes` | เหมือนกัน |
| token store ล่ม | เหมือนกัน |

description, schema, approval และ label ของ tool คงเดิม tool แบบ generator ก็ยังเป็น generator

### `withOutputGuard(tool, { guard, sessionKey })`

ตอน tool ถูกเรียก จะเรียก `execute` เดิมด้วย input ตามที่ได้มา (token ยังเป็น token ไม่มีการแลก) แล้วปิดข้อมูลในผลลัพธ์ (boundary `tool_output`) ก่อนคืน เหมือนข้อ 3 ของ `withTokenResolution`

- ผลที่มีข้อมูลที่ policy สั่ง block จะกลายเป็น `{ ok: false, reason: 'blocked', ask }`
- description, schema, approval และ label ของ tool คงเดิม tool แบบ generator ก็ยังเป็น generator และทุกค่าที่ yield ถูกปิดทีละค่า
- tool ที่ต้องทั้งแลก token และดึงข้อมูลเอง ใช้ `withTokenResolution` ตัวเดียวพอ เพราะปิดผลลัพธ์ให้อยู่แล้ว

### `guardModel(model, { guard, sessionKey })`

ห่อโมเดลของ AI SDK (หรือ gateway id ที่เป็น string) ด้วย `wrapLanguageModel` ทุกข้อความในทุก prompt จะผ่าน guard (boundary `prompt`) รวมถึงผลจาก tool ส่วนข้อความที่ policy สั่ง block จะกลายเป็น `[ข้อมูลที่ปิดไว้]`

- **ห่อโมเดลของ subagent และโมเดลที่ใช้ทำ compaction ด้วย** เพราะแต่ละตัวเรียกผู้ให้บริการโมเดลแยกกัน
- **ไม่ได้ปิดคำตอบของโมเดล** งานนั้นเป็นของ `withPdpaGuard` ที่ channel
- **ต้องตั้ง `modelContextWindowTokens`** เพราะ eve หาขนาด context จาก id ของโมเดล แต่โมเดลที่ห่อแล้วรายงานตัวเป็น `gateway/<id>`
- **หลัง deploy บน Vercel** ให้เช็กว่าโมเดลที่ห่อแล้วยังยืนยันตัวตนด้วย OIDC ได้ วิธีเช็กคือส่ง 1 ข้อความ แล้วดูว่าได้คำตอบ และมี audit event `scan` ที่ `boundary: "prompt"`

### `pdpaHook({ guard, sessionKey, files?, blockOn?, onUnmasked?, strict? })`

ลงทะเบียนใน `agent/hooks/pdpa.ts` ระบบจะตรวจ option ตั้งแต่ตอนสร้าง hook ถ้าไม่มี guard หรือ `sessionKey` eve จะโหลด hook ไม่ขึ้นตั้งแต่เริ่ม ไม่ต้องรอให้มีข้อความแรกเข้ามา

| event | hook ทำอะไร |
|---|---|
| `message.received` | เก็บ pdpa id ของ session ไว้ให้ tool, model และ channel ใช้ และยกเลิก turn ถ้าข้อความมีข้อมูลที่ policy สั่ง block หรือมีประเภทที่อยู่ใน `blockOn` |
| `session.completed`, `session.failed` | เรียก `guard.endSession` เพื่อลบ token ของแชตนั้น |
| `reset` ของ eve | ไม่ส่ง event มาให้ hook token พวกนั้นจะหมดอายุเองตาม `ttlSec` |

**channel ที่ลืมห่อ** channel ที่ห่อแล้วจะส่งข้อความที่ปิดข้อมูลแล้วให้ eve ถ้า hook ยังเจอข้อมูลส่วนบุคคลในข้อความที่ eve บันทึก แปลว่าข้อความนั้นมาทาง channel ที่ไม่ได้ห่อ (ข้อมูลที่ตั้งเป็น `flag` ไม่นับ เพราะตั้งใจปล่อยผ่าน) เมื่อเจอ hook จะทำอย่างนี้

- ถ้าตั้ง `onUnmasked` ไว้ จะเรียก `onUnmasked({ channel, entities })`
- ถ้าไม่ได้ตั้ง จะเตือนใน log ครั้งเดียวต่อ channel: `Wrap agent/channels/<channel>.ts with withPdpaGuard`
- ถ้าตั้ง `strict: true` จะยกเลิก turn ด้วย โมเดลจึงไม่ได้อ่านข้อความนั้น แต่ eve บันทึกไปแล้ว

ทั้งการเรียก `onUnmasked` และข้อความเตือน มีแค่ชื่อ channel กับประเภทข้อมูล ไม่มีค่าจริง

**mount เป็น extension** default export ของแพ็กเกจจะ mount hook ตัวเดียวกันเป็น extension: `pdpa({ guard, sessionKey })` ใน `agent/extensions/pdpa.ts` ใช้ได้เฉพาะ setup ที่ไม่ใช้ tokenise ถ้าใช้ tokenise ต้องลงทะเบียน hook ใน `agent/hooks/` เพื่อให้ hook ใช้ session state ร่วมกับ tool ได้

### Session id

core ใช้ `sessionId` แยก token ของแต่ละแชต และเขียนลงทุก audit event core ยังเตือนว่าอย่าใช้ id ของแพลตฟอร์มตรงๆ ทุกชั้นในแพ็กเกจนี้จึงคำนวณ id เองด้วยสูตรเดียวกัน

```text
"eve_" + base32(HMAC-SHA256(sessionKey, conversation)).slice(0, 26)
conversation = "<channelName>:<address>"   หรือ   "session:<eve session id>"  (HTTP channel ของ eve)
```

ถ้าโค้ดของคุณต้องการ id นี้ เช่น tool ที่เรียก `guard.resolve` เอง ให้ใช้ `derivePdpaSessionId(sessionKey, conversation)`

### `guardContent(content, { guard, sessionId, boundary?, files? })`

ฟังก์ชันที่ทุกชั้นใช้อยู่ข้างใต้ ปิดข้อมูลใน string หรือ `UserContent` ของ AI SDK แบบ async คืนค่า `{ blocked: false, content }` หรือ `{ blocked: true, reason, blockedBy }`

---

## ข้อจำกัดที่ควรรู้

- **HTTP channel ของ eve ไม่ถูกปิดตอนขาออก** channel นี้ stream ทุก event ตามที่โมเดลเขียน หน้าเว็บที่ใช้ `useEveAgent` และ client อื่นของ `/eve/v1/session/:id/stream` จึงเห็น token ตามที่เขียน ส่วน channel อื่น ทั้งของ eve และที่เขียนเอง ถูกปิดตรงที่โพสต์
- **ชิ้นข้อความที่ stream ไม่ถูกปิด** Slack ใช้ `message.appended` แค่นับตัวอักษร ไม่ได้โพสต์ แต่ `reasoning.appended` อาจแสดงความคิดของโมเดลบางส่วนเป็นสถานะของ thread จนกว่าความคิดที่จบแล้ว (ปิดแล้ว) จะมาแทน token ในนั้นเป็นแค่ token ไม่ใช่ค่าจริง
- **การเตือน channel ที่ลืมห่อเห็นแค่ข้อความ** `pdpaHook` ไม่ได้รับ event ของคำตอบคำถามหรือการอนุมัติ คำตอบที่มาทาง channel ที่ไม่ได้ห่อจึงไม่ถูกเตือน
- **token ที่ออกระหว่างส่งต่องานด้วย `to()` แลกกลับไม่ได้** ใน session ของ channel ปลายทาง
- **subagent มี session state ของตัวเอง** tool ใน subagent แลก token ของ agent หลักไม่ได้
- **route สร้าง session ของ eve** request ที่มีข้อความพร้อม `callback` หรือ `operationId` จะถูกปฏิเสธ (`400 pdpa_unsupported`) ให้สร้าง session ก่อนแล้วค่อยส่งข้อความ
- **ตรวจทีละ text part** ไม่ตรวจเนื้อหาไฟล์และชื่อไฟล์ ถ้าไม่อยากรับไฟล์เลยให้ใช้ `files: 'block'`
- **ยังไม่ตรวจชื่อและที่อยู่** (เป็นข้อจำกัดของ core)
- **เลขบัตรประชาชนบางเลขถูกอ่านเป็นบัตรเครดิต** ถ้าบังเอิญผ่าน checksum ของบัตรเครดิตและอยู่ในช่วงเลขผู้ออกบัตร ภายใต้ policy ที่ block บัตรเครดิต ข้อความนั้นจะถูก block
- **HTTP route ของ eve ถูกจำด้วย method และ path** ให้รันเทสต์ทุกครั้งก่อนเปลี่ยนรุ่น eve

## สิ่งที่ต้องมี

- Node 24 ขึ้นไป
- eve 0.80.1 (รุ่นที่ทดสอบแล้ว)
- AI SDK 7 (`ai` เป็น peer dependency เหมือนของ eve)

## แจ้งช่องโหว่

อีเมลไปที่ **kunlachat@m-intelligence.tech** หัวเรื่องขึ้นต้นด้วย `[eve-pdpa-extension security]` ใช้ค่าสมมติในการทำซ้ำ ห้ามส่งข้อมูลส่วนบุคคลจริง

## License

Apache-2.0
