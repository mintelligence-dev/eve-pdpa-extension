# eve-pdpa-extension

ตรวจจับและปิดข้อมูลส่วนบุคคลไทยในข้อความ ก่อนส่งต่อให้ AI model, tool, log หรือคนรีวิว · Apache-2.0

*Detect and protect Thai personal data before it reaches an AI model, a tool, a log or a human reviewer.*

- สถานะ: 0.1.0 — release แรก

## แพ็กเกจ

| แพ็กเกจ | ใช้ทำอะไร | วิธีใช้ |
|---|---|---|
| [`@eve-pdpa-extension/core`](packages/core) | ไลบรารีที่แอปเรียกทุกข้อความ · ตรวจ 6 ประเภท · ปิด 6 แบบตาม policy · audit ที่ไม่มีค่าจริง · zero dependency · Node 18.18+ · Deno · Bun · Cloudflare Workers · browser | [ไทย](packages/core/README.th.md) · [English](packages/core/README.md) |
| [`@eve-pdpa-extension/cli`](packages/cli) | ตรวจไฟล์แชทเก่าโดยไม่ต้องเขียนโค้ด · JSONL · CSV · ไฟล์ export จาก LINE OA · `policy validate` | [ไทย](packages/cli/README.th.md) · [English](packages/cli/README.md) |
| [`@eve-pdpa-extension/http`](packages/http) | gateway ที่ลงลายเซ็น ตั้งคั่นระหว่างแอปแชทกับ AI · ปิดข้อมูลทั้งขาเข้าและขาออก · แลก token เป็นค่าจริงตาม purpose · Upstash Redis สำหรับ serverless · Node 20+ · Vercel · Deno · Bun · Cloudflare Workers · ยังไม่ขึ้น npm · deploy ด้วยปุ่มใน [eve-pdpa-gateway](https://github.com/kurachatsarakarn/eve-pdpa-gateway) | [ไทย](packages/http/README.th.md) · [English](packages/http/README.md) |
| [`@eve-pdpa-extension/eve`](packages/eve) | ปิดข้อมูลใน agent ที่สร้างด้วย eve ครบ 4 ชั้น: channel ขาเข้า · tool ที่แลก token เป็นค่าจริงตาม purpose · prompt ก่อนถึงโมเดล · คำตอบ Slack · hook ยกเลิก turn ที่ต้อง block · Node 24+ · ยังไม่ขึ้น npm | [ไทย](packages/eve/README.th.md) · [English](packages/eve/README.md) |

วิธีใช้ ตัวอย่าง ข้อควรรู้ และข้อจำกัด อยู่ใน README ของแต่ละแพ็กเกจ ซึ่งเป็นหน้าเดียวกับที่ขึ้นบน npm · ไฟล์นี้ไม่เขียนซ้ำ จะได้ไม่มีสองที่ที่ต้องแก้ให้ตรงกัน

> **เป็นเครื่องมือทางเทคนิค ไม่ใช่ใบรับรองการปฏิบัติตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล**

## โครง repo

```
packages/core/       @eve-pdpa-extension/core   zero deps · ทุก runtime · งบขนาด 150 KB
packages/cli/        @eve-pdpa-extension/cli    Node เท่านั้น
packages/http/       @eve-pdpa-extension/http   gateway · web standard เท่านั้น · Node 20+ · docs/ = API ของ gateway ที่ deploy
packages/eve/        @eve-pdpa-extension/eve    adapter สำหรับ eve: channel · tool · model · Slack renderer · hook · Node 24+ · ยังเป็น private
packages/{policy,ner,ner-model-th,mcp}/   มีแต่ README · ยังไม่เริ่ม (หลัง 0.1)
apps/pdpa-agent/     template agent ของ eve ที่ต่อ packages/eve ครบทุกชั้น · tokenise เบอร์สำหรับ OTP · Slack · รันในเครื่องด้วยโมเดลจำลอง · deploy เอง
examples/            ไฟล์ policy ตัวอย่าง
bench/               แม่แบบแชทและโปรแกรมวัดความแม่นยำ · ข้อมูลที่สร้างแล้วไม่ขึ้น git
internal/            consumer fixture 4 ตัว พิสูจน์ว่า exports map ใช้ได้จริง
scripts/             gate ที่บังคับข้อจำกัดของ core · smoke test 5 runtime · demo
```



## พัฒนา

```bash
corepack pnpm install
corepack pnpm exec playwright install chromium   # ครั้งเดียว · ใช้ใน smoke test ของ browser
corepack pnpm verify                             # lint · build · typecheck · test · gates · size · smoke 5 runtime
corepack pnpm demo                               # สร้างหน้า live demo ที่ scripts/demo/out/pdpa-demo.html
```

benchmark:

```bash
corepack pnpm build
node bench/generate.mjs --holdout                # สร้างชุด holdout (ชุดที่ไม่ได้ใช้ปรับตัวตรวจ) จาก seed
node bench/evaluate.mjs --holdout --context      # วัดตามนิยาม D5 · เขียนรายงานที่ bench/out/
```

กฎของการร่วมพัฒนา โดยเฉพาะ **ห้าม commit ข้อมูลส่วนบุคคลจริง** อยู่ใน [CONTRIBUTING.md](CONTRIBUTING.md) ·
แจ้งช่องโหว่ตาม [SECURITY.md](SECURITY.md)
