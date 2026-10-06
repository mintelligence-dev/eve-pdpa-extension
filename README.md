# thai-pdpa-guard

TypeScript library สำหรับตรวจจับและปิดข้อมูลส่วนบุคคลไทยก่อนถึง AI model, tool, log หรือคนรีวิว
พร้อมตัวเชื่อมกับ eve · Apache-2.0

- สเปกต้นฉบับ (Notion): [PDPA protection (eve dev hook)](https://app.notion.com/p/mintelligence/PDPA-protection-eve-dev-hook-3d194d61b58b806bbde2ce83da8097f5)
- สถานะ: กำลังทำ 0.1 · ยังไม่ publish ขึ้น npm

## ใช้งาน

```ts
import { createGuard, parsePolicy } from '@thai-pdpa-guard/core'

// สร้างครั้งเดียวตอน server เริ่ม · รันฝั่ง server เท่านั้น
const guard = createGuard({
  policy: parsePolicy(policyJson),          // ดูตัวอย่างที่ examples/pdpa-policy.json
  hmacKey: process.env.PDPA_HMAC_KEY,       // ต้องมีถ้า policy ใช้ action hash
  onAudit: (event) => auditLog.write(event),
})

// ข้อความจากลูกค้า → AI  (processSync ก็ได้ ถ้าที่เก็บ token เป็น sync)
const inbound = await guard.process('เบอร์ ๐๙๑-๘๘๘-๗๗๗๗ ค่ะ', {
  sessionId: 'conv_8f2a',     // id ห้องแชทที่ระบบสร้างเอง ไม่ใช่ LINE userId
  ref: 'msg_10293',           // id ข้อความในระบบของแอป ไว้ตามจาก audit กลับมา
  context: lastShopMessage,   // ข้อความล่าสุดของร้าน — ลูกค้าตอบแค่ "123-4-56789-0" หลังร้านถามเลขบัญชี ก็ยังจับได้
})
inbound.text                  // 'เบอร์ [tok:dcpttqrpmdvprnqp] ค่ะ'

// tool ที่ต้องใช้ค่าจริง
const r = await guard.resolve('[tok:dcpttqrpmdvprnqp]', { purpose: 'otp_send', sessionId: 'conv_8f2a' })
r.ok && r.value               // '0918887777'

// คำตอบของ AI → ลูกค้า
(await guard.process(reply, { sessionId: 'conv_8f2a', boundary: 'outbound' })).text
// 'ส่ง OTP ไปที่ xxx-xxx-๗๗๗๗ แล้วค่ะ'
```

### สิ่งที่มีใน 0.1

| ส่วน | |
|---|---|
| ตัวตรวจจับ 6 ตัว | เลขบัตรประชาชน (mod-11) · บัตรเครดิต (Luhn) · อีเมล · LINE user ID · เบอร์โทร · เลขบัญชี |
| action 6 ตัว | `redact` · `mask` · `tokenise` · `hash` · `flag` · `block` |
| policy | `definePolicy` (ใน code) หรือ `parsePolicy` (JSON) · ตรวจทุกช่องตอนโหลด · [`policy.schema.json`](packages/core/schema/policy.schema.json) ให้ editor เตือนตอนพิมพ์ · allowlist แบบ exact และ pattern |
| audit | `policy.loaded` · `scan` · `token.resolve` · ไม่มีค่าจริงอยู่ใน event |
| runtime | Node 18+ · Deno · Bun · Cloudflare Workers · browser · zero dependency · ~23 KB minified |

**ยังไม่จับชื่อคนและที่อยู่** (0.2) · audit event ทุกอันมี `engine.entitiesSupported` กำกับไว้
รายงานที่บอกว่า "ไม่พบชื่อ" จึงไม่ถูกอ่านว่า "ไม่มีชื่ออยู่ในข้อความ"

## ข้อควรรู้ก่อนใช้

> **รัน guard ฝั่ง server เท่านั้น** — `hmacKey` และที่เก็บ token ที่อยู่ในเบราว์เซอร์ ใครก็เปิดดูได้
> และลูกค้าแก้ code ในเบราว์เซอร์ให้ข้ามการตรวจได้

> **token เก็บในหน่วยความจำของ process เดียวเป็นค่าเริ่มต้น** — ถ้าระบบรันหลาย process หรือหลาย pod
> ต้องเสียบ `tokenStore` ที่ใช้ร่วมกัน ไม่อย่างนั้นการแลก token จะได้ `not_found` · ที่เก็บแบบ async
> (เช่น Redis) ใช้กับ `await guard.process()` · `processSync` รับเฉพาะที่เก็บแบบ sync

> **ค่าที่ผ่าน action `hash` ยังนับเป็นข้อมูลส่วนบุคคล ตราบใดที่ key ยังอยู่** — เบอร์มือถือไทยมีราว 10⁸ ค่า
> ใครได้ `hmacKey` ไปจะ hash ได้ครบทุกเบอร์ในไม่กี่นาที · `hash` คือการแฝงข้อมูล (pseudonymisation)
> ไม่ใช่การทำให้ไม่ระบุตัวตน (anonymisation) · key ต้องสุ่มและยาวอย่างน้อย 32 bytes
> (`openssl rand -hex 32`) · ห้ามใช้ key เดียวกันข้ามลูกค้า · เปลี่ยน key แล้ว hash เก่ากับใหม่จะไม่ตรงกัน

> **purpose ไม่ใช่รหัสผ่าน** — tool เป็นคนบอก purpose เอง · กันการใช้ผิดโดยไม่ตั้งใจและทำให้ทุกการขอมีหลักฐาน
> แต่กันคนในที่ตั้งใจโกงไม่ได้ · ต้องคุมด้วยสิทธิ์เข้าถึง server และตรวจ audit

> **Node 18 ต้องส่ง `randomSource` เองถ้าจะใช้ `tokenise`** — Node 18 ไม่มี `globalThis.crypto` และ core
> ใช้ `node:crypto` ไม่ได้เพราะต้องรันบน browser ด้วย · ไม่ส่งแล้ว `createGuard` จะ throw
> `ERR_PDPA_NO_CSPRNG` ตั้งแต่ตอนเริ่ม · Node 20+ ไม่ต้องทำอะไร

## โครง repo

```
packages/core/     @thai-pdpa-guard/core   zero deps · ทุก runtime · < 150 KB
packages/cli/      @thai-pdpa-guard/cli    Node เท่านั้น · ยังเป็นโครง
packages/{policy,ner,ner-model-th,http,mcp,eve}/   มีแต่ README · ยังไม่เริ่ม
examples/          ไฟล์ policy ตัวอย่าง (มีเทสบังคับว่าโหลดผ่าน)
internal/          consumer fixture 3 ตัว พิสูจน์ว่า exports map ใช้ได้จริง
scripts/           gate ที่บังคับข้อจำกัดของ core · smoke test 5 runtime · demo
```

โฟลเดอร์ใน `packages/` ที่มีแต่ `README.md` **ไม่มี `package.json` โดยตั้งใจ** — pnpm จึงมองไม่เห็น
และ CI ไม่รายงานว่า build/test ผ่านสำหรับแพ็กเกจที่ยังไม่มีโค้ด

เอกสารออกแบบและบันทึกการตัดสินใจ (D1–D10) เก็บไว้นอก repo

## พัฒนา

```bash
corepack pnpm install
corepack pnpm exec playwright install chromium   # ครั้งเดียว · ใช้ใน smoke test ของ browser
corepack pnpm verify                             # lint · build · typecheck · test · gates · size · smoke 5 runtime
corepack pnpm demo                               # สร้างหน้า live demo ที่ scripts/demo/out/pdpa-demo.html
```
