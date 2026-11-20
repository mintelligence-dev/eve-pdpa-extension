# eve-pdpa-extension

> ตรวจจับและปิดข้อมูลส่วนบุคคลไทยในข้อความ ก่อนส่งต่อให้ AI model, AI agent, tool, log หรือคนรีวิว  
> Detect and protect Thai personal data before it reaches an AI model, an AI agent, a tool, a log or a human reviewer.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![core](https://img.shields.io/npm/v/@eve-pdpa-extension/core?label=core)](https://www.npmjs.com/package/@eve-pdpa-extension/core)
[![cli](https://img.shields.io/npm/v/@eve-pdpa-extension/cli?label=cli)](https://www.npmjs.com/package/@eve-pdpa-extension/cli)
[![eve](https://img.shields.io/npm/v/@eve-pdpa-extension/eve?label=eve)](https://www.npmjs.com/package/@eve-pdpa-extension/eve)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

> **เป็นเครื่องมือทางเทคนิค ไม่ใช่ใบรับรองการปฏิบัติตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล**  
> **This is a technical tool, not a certification of compliance with Thailand's PDPA.**

---

## ภาษาไทย

### ทำอะไรได้

1. **ตรวจ** เลขบัตรประชาชน · เบอร์โทร · อีเมล
   · เลขบัญชี
   · บัตรเครดิต · LINE user ID
   · พร้อมเพย์ · ที่อยู่ · ชื่อบุคคล
   ทั้งเลขไทยและเลขอารบิก
2. **ปิดตาม policy** เลือกได้ต่อประเภท `redact` · `mask` · `tokenise` · `hash` · `flag` · `block` เช่น AI เห็น `[tok:…]` แต่ tool ส่ง OTP ได้เบอร์จริง และลูกค้าเห็น `xxx-xxx-7777`
3. **บันทึก audit** ทุกครั้งที่ตรวจ โดยไม่มีค่าจริงอยู่ใน audit
4. **ตรวจไฟล์แชทเก่า** โดยไม่ต้องเขียนโค้ด รองรับ JSONL · CSV · ไฟล์ export จาก LINE OA
5. **ห่อ agent ที่สร้างด้วย [eve](https://eve.dev)** ครบ 4 ชั้น ได้แก่ ขาเข้า · tool · prompt · ขาออกของทุก channel ติดตั้ง 3 ขั้นด้วย `eve add`

### แพ็กเกจ

| แพ็กเกจ | ใช้ทำอะไร | วิธีใช้ |
|---|---|---|
| [`@eve-pdpa-extension/core`](packages/core) | ไลบรารีที่แอปเรียกทุกข้อความ · zero dependency · Node 18.18+ · Deno · Bun · Cloudflare Workers · browser | [ไทย](packages/core/README.th.md) · [English](packages/core/README.md) |
| [`@eve-pdpa-extension/cli`](packages/cli) | ตรวจไฟล์แชทเก่า · `policy validate` | [ไทย](packages/cli/README.th.md) · [English](packages/cli/README.md) |
| [`@eve-pdpa-extension/eve`](packages/eve) | adapter สำหรับ eve · `eve-pdpa-check` ตรวจว่าลืมห่ออะไร · Node 24+ · ทดสอบกับ eve 0.80.1 | [ไทย](packages/eve/README.th.md) · [English](packages/eve/README.md) |

README ของแต่ละแพ็กเกจเป็นหน้าเดียวกับที่ขึ้นบน npm และมีรายละเอียดครบ ไฟล์นี้สรุปไว้สั้นๆ

### หลักความปลอดภัย

| กฎ | บังคับใช้อย่างไร |
|---|---|
| audit ไม่มีค่าจริง | audit event เก็บแค่ประเภท ตำแหน่ง และ action ไม่เก็บข้อความที่ตรวจเจอ · ส่วน `sessionId` และ `ref` ถูกเก็บตามที่ส่งมา จึงไม่ควรใช้เบอร์หรือ LINE userId เป็นค่าพวกนี้ |
| tool ได้ค่าจริงเฉพาะที่อนุญาต | `guard.resolve()` แลก token ได้เฉพาะ purpose ที่อยู่ใน `allowedPurposes` ของ policy และ token หมดอายุตาม `ttlSec` (สูงสุด 3600 วินาที) ใน eve มีแค่ tool ที่ห่อด้วย `withTokenResolution` ที่แลกได้ |
| ลูกค้าไม่เห็น token | ขาออก (`boundary: 'outbound'`) แปลง token เป็นค่าที่ปิดแล้ว เช่น `xxx-xxx-7777` |
| ข้อความที่ถูก block ไม่หลุด | `block` คืน `text: ''` เสมอ ถึงจะลืมเช็ค `outcome` ข้อความก็ไม่ถูกส่งต่อ |
| core ไม่มีทางรั่วออกเน็ต | ไม่มี dependency ไม่ใช้ `node:` builtin และไม่เรียก network บังคับด้วย `pnpm gates` และ smoke test บน Deno ที่ไม่ให้ permission ใดๆ |
| ไม่มีข้อมูลจริงใน repo | ทุกไฟล์ใน `fixtures/` ต้องลงชื่อใน `fixtures/ATTESTATION.md` ว่าเป็นข้อมูลสังเคราะห์ (`pnpm gate:attestation`) |

### เริ่มใช้งาน

```bash
npm install @eve-pdpa-extension/core            # ไลบรารี
npx @eve-pdpa-extension/cli scan chats.csv      # ตรวจไฟล์แชทเก่า ไม่ต้องเขียนโค้ด
```

- **ใช้ในแอป:** ต้องมีไฟล์ policy และ `PDPA_HMAC_KEY` (สร้างด้วย `openssl rand -hex 32`) ดู[เริ่มใช้ของ core](packages/core/README.th.md#เริ่มใช้)
- **ตรวจไฟล์เก่า:** ใช้ CLI ตามข้างบน ดู [README ของ cli](packages/cli/README.th.md)
- **agent ที่สร้างด้วย eve:** ติดตั้ง 3 ขั้นด้วย `eve add` ดู [README ของ eve](packages/eve/README.th.md#ติดตั้งใน-3-ขั้น)
- รัน guard **ฝั่ง server เท่านั้น** เพราะ key และ token ที่อยู่ในเบราว์เซอร์ ใครก็อ่านได้

### ใช้ในโค้ด

```ts
import { readFileSync } from 'node:fs'
import { createGuard, parsePolicy } from '@eve-pdpa-extension/core'

const guard = createGuard({
  policy: parsePolicy(readFileSync('pdpa-policy.json', 'utf8')),
  hmacKey: process.env.PDPA_HMAC_KEY,
  onAudit: (event) => console.log(JSON.stringify(event)),
})

const inbound = await guard.process('เบอร์ ๐๙๑-๘๘๘-๗๗๗๗ ค่ะ', { sessionId: 'conv_8f2a' })
inbound.text   // 'เบอร์ [tok:rfdbkfrtnsmbvpsh] ค่ะ'   ← สิ่งที่ AI เห็น
```

ตัวอย่างเต็ม (แลก token ใน tool และปิดขาออก) อยู่ใน [README ของ core](packages/core/README.th.md#เริ่มใช้)

### คำสั่ง

| คำสั่ง | |
|---|---|
| `corepack pnpm install` | ติดตั้ง dependency ของ repo |
| `corepack pnpm exec playwright install chromium` | ครั้งเดียว · ใช้ใน smoke test ของ browser |
| `corepack pnpm verify` | lint · build · typecheck · test · gates · size · smoke 5 runtime · ตัวอย่างใน README |
| `corepack pnpm demo` | สร้างหน้า live demo ที่ `scripts/demo/out/pdpa-demo.html` |
| `node bench/generate.mjs --holdout` | สร้างชุด holdout (ชุดที่ไม่ได้ใช้ปรับตัวตรวจ) จาก seed · ต้อง `pnpm build` ก่อน |
| `node bench/evaluate.mjs --holdout --context` | วัดความแม่นยำ · เขียนรายงานที่ `bench/out/` |

### ข้อจำกัดที่ควรรู้

- ชื่อคนและที่อยู่จับได้เฉพาะที่มีตัวบอก: ชื่อต้องมีคำนำหน้า (นาย นางสาว ดร. ยศ …) คำแนะนำตัว ("ผมชื่อ") ป้ายในฟอร์ม ("ชื่อ-นามสกุล") หรือเป็นคำตอบของคำถามที่ขอชื่อ · ที่อยู่ภาษาไทยหรือภาษาอังกฤษ (Soi, Road, Moo, Subdistrict, District, Bangkok …) ต้องมีส่วนประกอบอย่างน้อยสามชนิด (บ้านเลขที่ ซอย ตำบล อำเภอ จังหวัด รหัสไปรษณีย์) หรือสองชนิดกับคำว่า "ที่อยู่" / address · ชื่อลอย ๆ กลางประโยค ชื่อเล่น และชื่อสถานที่ที่ไม่มีป้ายยังไม่จับ (ต้องใช้ NER)
- เลขบัญชี เบอร์ที่ไม่มี 0 นำหน้า และประเภทที่เขียนว่า "ต้องมีคำบอกใบ้" ด้านบน ต้องมีคำบอกใบ้ เช่น "เลขบัญชี" "เบอร์" หรือส่ง `context`
- eve: HTTP channel ของ eve ยังไม่ถูกปิดตอนขาออก และ eve 1.0.0-rc.1 ยังไม่รองรับ
- ตัวเลขความแม่นยำวัดจากข้อมูลสังเคราะห์ จึงเป็นค่าสูงสุดที่ทำได้ ไม่ใช่ค่าที่จะเจอจริง

รายการเต็มอยู่ในหัวข้อข้อจำกัดของ [core](packages/core/README.th.md#ข้อจำกัดที่รู้อยู่) และ [eve](packages/eve/README.th.md#ข้อจำกัดที่ควรรู้)

### ร่วมพัฒนา

ยินดีรับ issue และ pull request ก่อนส่ง PR ให้รัน `corepack pnpm verify` ให้ผ่าน **ห้าม commit ข้อมูลส่วนบุคคลจริง** ทั้งในเทสต์ fixture issue และ commit message ดูกฎทั้งหมดใน [CONTRIBUTING.md](CONTRIBUTING.md) · แจ้งช่องโหว่ตาม [SECURITY.md](SECURITY.md)

### สัญญาอนุญาต

เผยแพร่ภายใต้ [Apache License 2.0](LICENSE) · Copyright 2026 The eve-pdpa-extension contributors ([NOTICE](NOTICE))  
นำไปใช้ แก้ไข และใช้เชิงพาณิชย์ได้ ต้องคงข้อความลิขสิทธิ์ สัญญาอนุญาต และไฟล์ NOTICE ไว้ และระบุไฟล์ที่แก้ไข ซอฟต์แวร์นี้ให้ "ตามสภาพ" ไม่มีการรับประกันใดๆ

---

## English

### What it does

1. **Detects:** Thai national ID · phone number · email
   · bank account
   · credit card · LINE user ID
   · PromptPay ID · address · person name
   — in Thai or Arabic digits.
2. **Protects them per your policy:** `redact` · `mask` · `tokenise` · `hash` · `flag` · `block`, chosen per type. For example, the AI sees `[tok:…]`, the OTP tool gets the real number, and the customer sees `xxx-xxx-7777`.
3. **Audits every scan**, and an audit event never contains the real value.
4. **Scans old chat exports** without writing code: JSONL · CSV · LINE OA exports.
5. **Guards [eve](https://eve.dev) agents** at all 4 layers: inbound · tools · prompt · outbound on every channel. Installs in 3 steps with `eve add`.

### Packages

| Package | What it is for | Docs |
|---|---|---|
| [`@eve-pdpa-extension/core`](packages/core) | The library your app calls on every message · zero dependencies · Node 18.18+ · Deno · Bun · Cloudflare Workers · browsers | [English](packages/core/README.md) · [ไทย](packages/core/README.th.md) |
| [`@eve-pdpa-extension/cli`](packages/cli) | Scan old chat exports · `policy validate` | [English](packages/cli/README.md) · [ไทย](packages/cli/README.th.md) |
| [`@eve-pdpa-extension/eve`](packages/eve) | Adapter for eve · `eve-pdpa-check` finds what you forgot to wrap · Node 24+ · tested with eve 0.80.1 | [English](packages/eve/README.md) · [ไทย](packages/eve/README.th.md) |

Each package README is the page shown on npm and has the full details. This file is a summary.

### Safeguards

| Rule | How it is enforced |
|---|---|
| No real values in audit | An audit event records the type, position and action, never the matched text. `sessionId` and `ref` are stored as you pass them, so do not use a phone number or LINE userId for them. |
| Real values only where allowed | `guard.resolve()` exchanges a token only for a purpose listed in the policy's `allowedPurposes`, and tokens expire after `ttlSec` (at most 3600 s). In eve, only tools wrapped with `withTokenResolution` can resolve. |
| Customers never see tokens | Outbound (`boundary: 'outbound'`) turns tokens into masked values such as `xxx-xxx-7777`. |
| Blocked text does not leak | `block` always returns `text: ''`, so forgetting to check `outcome` still sends nothing. |
| core cannot reach the network | No dependencies, no `node:` builtins, no network calls. Enforced by `pnpm gates` and a Deno smoke test run with no permissions. |
| No real data in the repo | Every file under `fixtures/` must be listed in `fixtures/ATTESTATION.md` as synthetic (`pnpm gate:attestation`). |

### Getting started

```bash
npm install @eve-pdpa-extension/core            # the library
npx @eve-pdpa-extension/cli scan chats.csv      # scan old chats, no code
```

- **In your app:** you need a policy file and a `PDPA_HMAC_KEY` (`openssl rand -hex 32`). See core's [Quick start](packages/core/README.md#quick-start).
- **Old chat exports:** use the CLI above. See the [cli README](packages/cli/README.md).
- **eve agents:** install in 3 steps with `eve add`. See the [eve README](packages/eve/README.md#install-in-3-steps).
- Run the guard **on the server only**: anyone can read a key or a token that is in the browser.

### Using it in code

See the code sample in the Thai section, or the full flow (resolving a token in a tool, masking the reply) in core's [Quick start](packages/core/README.md#quick-start).

### Commands

| Command | |
|---|---|
| `corepack pnpm install` | Install the repo's dependencies |
| `corepack pnpm exec playwright install chromium` | Once · used by the browser smoke test |
| `corepack pnpm verify` | lint · build · typecheck · test · gates · size · smoke on 5 runtimes · README examples |
| `corepack pnpm demo` | Build the live demo page at `scripts/demo/out/pdpa-demo.html` |
| `node bench/generate.mjs --holdout` | Generate the holdout set (never used to tune the detectors) from a seed · run `pnpm build` first |
| `node bench/evaluate.mjs --holdout --context` | Measure accuracy · writes a report to `bench/out/` |

### Known limitations

- Names and addresses are found only when something points to them: a name needs a title (นาย, นางสาว, a rank, Mr, Dr …), an introduction ("ผมชื่อ", "my name is"), a form label ("ชื่อ-นามสกุล"), or to be the answer to a question that asked for one · an address, in Thai or in English (Soi, Road, Moo, Subdistrict, District, Bangkok …), must hold three kinds of part (house number, soi, tambon, amphoe, province, postcode), or two with a word such as "ที่อยู่" or "address" · a bare name in the middle of a sentence, a nickname, and a place named with no labels are not found (that needs NER)
- Bank accounts, phone numbers without a leading 0, and the types marked "with a cue word" above, need a cue such as "เลขบัญชี" or "เบอร์", or pass `context`.
- eve: eve's HTTP channel is not masked on the way out, and eve 1.0.0-rc.1 is not supported yet.
- Accuracy figures come from synthetic data, so they are an upper bound, not what you will see in production.

The full lists are under Known limitations in the [core](packages/core/README.md#known-limitations) and [eve](packages/eve/README.md#known-limitations) READMEs.

### Project layout

```
packages/core/       @eve-pdpa-extension/core   zero deps · every runtime · 150 KB size budget
packages/cli/        @eve-pdpa-extension/cli    Node only
packages/eve/        @eve-pdpa-extension/eve    eve adapter: channel · tool · model · outbound · hook · Node 24+
packages/http/       @eve-pdpa-extension/http   gateway · not on npm in 0.1 · deployed with a Deploy to Vercel button
packages/{policy,ner,ner-model-th,mcp}/   README only · not started (after 0.1)

examples/            example policy files
bench/               chat templates and the accuracy harness · generated data stays out of git
internal/            4 consumer fixtures proving the exports map works
scripts/             gates enforcing core's constraints · smoke tests on 5 runtimes · demo
```

### Tech stack

TypeScript 5 · pnpm workspaces · tsdown · Vitest · Biome · size-limit · Playwright · smoke tests on Node, Deno, Bun, workerd and Chromium

### Contributing

Issues and pull requests are welcome. Make sure `corepack pnpm verify` passes before opening a PR. **Never commit real personal data**, not in tests, fixtures, issues or commit messages. See [CONTRIBUTING.md](CONTRIBUTING.md) for all the rules, and [SECURITY.md](SECURITY.md) to report a vulnerability.

### License

Released under the [Apache License 2.0](LICENSE). Copyright 2026 The eve-pdpa-extension contributors (see [NOTICE](NOTICE)).
