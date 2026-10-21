# apps/pdpa-agent

agent แอดมินร้านออนไลน์ภาษาไทยที่สร้างด้วย [eve](https://eve.dev) และต่อ [`@eve-pdpa-extension/eve`](../../packages/eve) ไว้ครบทุกชั้น: ข้อมูลส่วนบุคคลของลูกค้าถูกปิดก่อน eve บันทึก · เบอร์โทรกลายเป็น token ที่โมเดลส่งต่อให้ tool ได้ · มีแต่ tool ที่เห็นเบอร์จริง · คำตอบบน Slack แสดงเบอร์แบบปิดบางส่วน — เป็นแบบตั้งต้นให้คัดลอกไปใช้ · ตั้งเป็น private ไม่ publish · deploy เองตามขั้นตอนข้างล่าง

> **ไม่ใช่คำแนะนำทางกฎหมาย และไม่ใช่ใบรับรองการปฏิบัติตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล** เป็นจุดเริ่มต้นทางเทคนิคเท่านั้น

[English](./README.md)

## เริ่มใช้ — ในเครื่อง ไม่ต้องมี API key

ต้องใช้ **Node 24** · สั่งที่ root ของ repo:

```bash
corepack pnpm install
corepack pnpm build                 # agent ใช้ packages/eve และ packages/http ตัวที่ build แล้ว
cd apps/pdpa-agent
corepack pnpm dev:mock              # eve dev กับโมเดลจำลองที่ตอบตามสคริปต์ ที่ http://127.0.0.1:2000
```

ขอ OTP ด้วยเบอร์สมมติ:

```bash
curl -s -X POST http://127.0.0.1:2000/eve/v1/session \
  -H 'content-type: application/json' \
  -d '{"message":"ขอ OTP ที่เบอร์ 091-888-7777 ค่ะ"}'
# {"ok":true,"sessionId":"wrun_…","status":"accepted"}

curl -s "http://127.0.0.1:2000/eve/v1/session/<sessionId>/stream?follow=false"
```

ดูใน stream ว่า token ถูกแลกเป็นค่าจริงอย่างไร:

| event | เห็นอะไร |
|---|---|
| `message.received` | `ขอ OTP ที่เบอร์ [tok:…] ค่ะ` — eve บันทึก token ไม่ใช่เบอร์ |
| `actions.requested` | โมเดลเรียก `otp_send` ด้วย `{ "phone": "[tok:…]" }` |
| `action.result` | `{ "sent": true, "to": "[tok:…]" }` — tool ได้เบอร์จริง แต่ผลที่ส่งกลับถูกปิดอีกครั้ง |
| `message.completed` | คำตอบของโมเดล · **บน HTTP channel นี้ยังมี token ดิบอยู่** — ดู[4 ชั้น](#4-ชั้น) |

audit ออกทาง stdout เป็น NDJSON: `scan` ที่ `inbound` `prompt` `tool_output` และ `token.resolve` 1 รายการที่ `outcome: "allowed"` `purpose: "otp_send"` — ทั้งหมดใช้ session id ที่สร้างจาก key ตัวเดียวกัน ไม่มีเบอร์อยู่ในนั้นเลย

ส่งเลขบัตรเครดิตมา ระบบจะปฏิเสธก่อนถึง eve: `curl … -d '{"message":"บัตร 4111 1111 1111 1111"}'` ได้ `422`

## 4 ชั้น

| ชั้น | ไฟล์ | ปกป้องอะไร |
|---|---|---|
| **Channel** | `agent/channels/eve.ts` · `agent/channels/slack.ts` — `withPdpaGuard` | ข้อความขาเข้า ก่อน eve บันทึก ก่อน hook เห็น ก่อนโมเดลอ่าน · เบอร์เป็น token · เลขบัตรประชาชน redact · อีเมล hash · บัตรเครดิต block |
| **Tool** | `agent/tools/otp_send.ts` — `withTokenResolution` | แลก token เป็นเบอร์จริงให้ `otp_send` เท่านั้น เฉพาะแชตนี้ ก่อนหมดอายุ · ปิดสิ่งที่ tool ส่งกลับ |
| **Model** | `agent/agent.ts` — `guardModel` | prompt ทุกครั้งก่อนออกไปหา provider: ผลจาก tool ประวัติแชต และอะไรที่ชั้นอื่นพลาด |
| **คำตอบ Slack** | `agent/channels/slack.ts` — `pdpaSlackRenderer` | คำตอบ: token กลายเป็น `xxx-xxx-7777` · token ของแชตอื่นกลายเป็น `[ข้อมูลที่ปิดไว้]` |

และ `agent/hooks/pdpa.ts` (`pdpaHook`): เก็บ session id ที่ tool ต้องใช้ · ยกเลิก turn ที่ข้อความมีข้อมูลที่ policy สั่ง block · ลบ token ของแชตเมื่อ session จบ · **ไม่ปิดข้อมูล** — eve บันทึกข้อความไปก่อน hook จะทำงาน

**HTTP channel ของ eve แก้คำตอบไม่ได้** · `[tok:…]` ที่โมเดลพิมพ์จะไปถึงผู้เรียกตามนั้น · `channels/eve.ts` จึงตั้ง `allowRawTokensInOutput: true` ไว้สำหรับใช้ในเครื่องเท่านั้น (eve dev · terminal UI · เทสต์) · ลูกค้าจริงคุยผ่าน Slack

`defaultTools: false` ใน `agent/agent.ts` ปิด tool shell ไฟล์ และเว็บของ eve · agent ตอบลูกค้าไม่ต้องใช้ และแต่ละตัวคือช่องทางที่ข้อมูลจะรั่วออกได้อีกทาง

## สิ่งที่ยังไม่มี

- การปิดข้อมูลขาออกบน channel อื่นนอกจาก Slack — Teams · Telegram · Discord · channel ที่เขียนเอง ปิดได้แค่ขาเข้า
- หน้าเว็บที่ stream คำตอบ (`useEveAgent`): HTTP channel ของ eve stream คำตอบตามที่โมเดลเขียน
- ชื่อและที่อยู่: core ยังตรวจไม่ได้
- LINE

## ขอบเขตของระบบ

- **template ไม่เก็บค่าจริงไว้ที่ไหนเลย** · ค่าจริงอยู่แค่ใน token store และอยู่แค่ถึง `ttlSec` (300 วินาที) หรือจน session จบ
- **Upstash เก็บเบอร์โทรจริง**จนกว่าจะหมดอายุ · ให้ใช้กับโปรเจกต์นี้เท่านั้น และไม่เปิด persistence ถ้าไม่จำเป็น
- `PDPA_HMAC_KEY` และ `PDPA_SESSION_KEY` เป็นความลับระดับ production · ใครได้ HMAC key ไปสามารถไล่เดาอีเมลกลับจาก hash ได้ · session key ผูก audit เข้ากับบทสนทนา
- audit มีแค่ตำแหน่ง ประเภท และ session id ที่สร้างขึ้น — แต่ก็ยังควรเก็บแยกจาก log ข้อความ

## Observability

channel ใช้ audience ค่าตั้งต้นของ eve — ผู้เรียก HTTP แบบไม่ระบุตัวเป็น `unknown` · Slack ตัดสินเป็นรายบทสนทนา — eve จึงเก็บ trace ใน preview และ production **แค่ metadata** · อย่าตั้ง `audience: "public"` ให้ channel เหล่านี้ · ข้อความขาเข้าถูกปิดก่อน trace จะเห็นอยู่แล้ว ส่วนนี้เป็นด่านเสริมสำหรับ argument ของ tool ผลจาก tool และคำตอบของโมเดล · ถ้าเพิ่มปลายทาง trace (`agent/instrumentation/*.ts`) ให้ตั้ง `tracePolicy` เป็น `recordInputs: false` และ `recordOutputs: false` เว้นแต่จำเป็นต้องเห็นเนื้อหาจริง ๆ — เอกสาร eve: `node_modules/eve/docs/guides/instrumentation/instrumentation.mdx` หัวข้อ *Control inputs and outputs*

## deploy เอง

ใน repo นี้ไม่มีอะไร deploy ให้อัตโนมัติ · เมื่อพร้อม:

1. **Upstash**: สร้าง Redis database (Vercel Marketplace → Upstash หรือ upstash.com) · env var ใส่ในโปรเจกต์ ใช้ได้ทั้ง `UPSTASH_REDIS_REST_*` และ `KV_REST_API_*`
2. **ความลับ**: `openssl rand -hex 32` สองครั้ง → `PDPA_HMAC_KEY` · `PDPA_SESSION_KEY`
3. **Slack app**: สร้างที่ api.slack.com/apps · ตั้ง `SLACK_BOT_TOKEN` และ `SLACK_SIGNING_SECRET` · ชี้ Event Subscriptions ไปที่ `https://<โดเมน>/eve/v1/slack` — เอกสาร eve: `node_modules/eve/docs/channels/slack.mdx`
4. **โปรเจกต์ Vercel** จาก repo นี้:
   - Root Directory: `apps/pdpa-agent`
   - เปิด *Include files outside the root directory in the Build Step* ไว้: agent ใช้ `packages/eve` `packages/http` `packages/core` จาก monorepo นี้
   - Build Command: `corepack pnpm --dir ../.. build && eve build` — `dist/` ของแพ็กเกจไม่อยู่ใน git จึงต้อง build ก่อน
   - Function region: `sin1` (สิงคโปร์) ใกล้ผู้ใช้ไทยที่สุด — ตัวเดียวกับ `apps/webhook`
   - Environment variables: ทุกตัวใน `.env.example` ยกเว้นสวิตช์เทสต์ `PDPA_TEMPLATE_*` · บน Vercel ไม่ต้องใช้ `AI_GATEWAY_API_KEY` เพราะ AI Gateway ใช้ OIDC token ของโปรเจกต์
5. **เปลี่ยน `placeholderAuth()`** ใน `agent/channels/eve.ts` เป็น auth ของคุณเอง — ตัวนี้ปฏิเสธทุก request ใน production โดยตั้งใจ — หรือเอา HTTP channel ออก
6. **deploy** ด้วย `eve deploy` (เอกสาร eve: `node_modules/eve/docs/guides/deployment/vercel.mdx`)
7. **ตรวจ `guardModel` หลัง deploy ครั้งแรก**: ส่งข้อความ 1 ข้อความ แล้วดูว่า audit มี `scan` ที่ `boundary: "prompt"` และได้คำตอบจากโมเดลจริง — แปลว่าโมเดลที่ห่อไว้ยืนยันตัวตนผ่าน OIDC ได้

<!-- TODO ปุ่ม "Deploy with Vercel": ดูเหตุผลใน README.md -->

## เทสต์

```bash
corepack pnpm --filter ./apps/pdpa-agent test
```

`test/e2e.test.ts` รัน agent ด้วย `eve dev` กับโมเดลจำลอง ตรวจขั้นตอน OTP · ข้อความตามมา · บัตรเครดิตที่ถูก block · และว่าไม่มีค่าจริงหรือความลับใดไปถึง prompt ประวัติ audit หรือ log ของ server · `test/store.test.ts` ตรวจกติกาตอนเริ่ม: production ห้ามใช้ store ในหน่วยความจำ และห้ามขาดความลับ
