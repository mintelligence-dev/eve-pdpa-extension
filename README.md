# thai-pdpa-guard

ตรวจจับและปิดข้อมูลส่วนบุคคลไทยในข้อความ ก่อนส่งต่อให้ AI model, tool, log หรือคนรีวิว · Apache-2.0

*Detect and protect Thai personal data before it reaches an AI model, a tool, a log or a human reviewer.*

- สถานะ: กำลังทำ 0.1 · ยังไม่ publish ขึ้น npm

## แพ็กเกจ

| แพ็กเกจ | ใช้ทำอะไร | วิธีใช้ |
|---|---|---|
| [`@thai-pdpa-guard/core`](packages/core) | ไลบรารีที่แอปเรียกทุกข้อความ · ตรวจ 6 ประเภท · ปิด 6 แบบตาม policy · audit ที่ไม่มีค่าจริง · zero dependency · Node 18.18+ · Deno · Bun · Cloudflare Workers · browser | [ไทย](packages/core/README.th.md) · [English](packages/core/README.md) |
| [`@thai-pdpa-guard/cli`](packages/cli) | ตรวจไฟล์แชทเก่าโดยไม่ต้องเขียนโค้ด · JSONL · CSV · ไฟล์ export จาก LINE OA · `policy validate` | [ไทย](packages/cli/README.th.md) · [English](packages/cli/README.md) |

วิธีใช้ ตัวอย่าง ข้อควรรู้ และข้อจำกัด อยู่ใน README ของแต่ละแพ็กเกจ ซึ่งเป็นหน้าเดียวกับที่ขึ้นบน npm · ไฟล์นี้ไม่เขียนซ้ำ จะได้ไม่มีสองที่ที่ต้องแก้ให้ตรงกัน

> **เป็นเครื่องมือทางเทคนิค ไม่ใช่ใบรับรองการปฏิบัติตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล**

## โครง repo

```
packages/core/       @thai-pdpa-guard/core   zero deps · ทุก runtime · งบขนาด 150 KB
packages/cli/        @thai-pdpa-guard/cli    Node เท่านั้น
packages/{policy,ner,ner-model-th,http,mcp,eve}/   มีแต่ README · ยังไม่เริ่ม (หลัง 0.1)
examples/            ไฟล์ policy ตัวอย่าง (มีเทสบังคับว่าโหลดผ่าน)
bench/               แม่แบบแชทและโปรแกรมวัดความแม่นยำ · ข้อมูลที่สร้างแล้วไม่ขึ้น git
internal/            consumer fixture 3 ตัว พิสูจน์ว่า exports map ใช้ได้จริง
scripts/             gate ที่บังคับข้อจำกัดของ core · smoke test 5 runtime · demo
```

โฟลเดอร์ใน `packages/` ที่มีแต่ `README.md` **ไม่มี `package.json` โดยตั้งใจ** — pnpm จึงมองไม่เห็น
และ CI ไม่รายงานว่า build/test ผ่านสำหรับแพ็กเกจที่ยังไม่มีโค้ด

เอกสารออกแบบและบันทึกการตัดสินใจ (D1–D15) เก็บไว้นอก repo

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
