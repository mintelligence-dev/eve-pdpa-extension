# @eve-pdpa-extension/mcp

MCP server ที่มี tool 2 ตัว คือ `pdpa_scan` และ `pdpa_redact` ให้ AI agent (Claude Code, Claude Desktop, Cursor หรือ client MCP ตัวอื่น) หาและปิดข้อมูลส่วนบุคคลไทยก่อนข้อความจะถูกส่งต่อ ใช้ [`@eve-pdpa-extension/core`](https://www.npmjs.com/package/@eve-pdpa-extension/core) อยู่ข้างใน ทำงานในเครื่องคุณทั้งหมด ไม่ส่งอะไรออกไปไหน

[English](./README.md)

> ยังไม่ได้ปล่อยบน npm

## ทำอะไรได้

| tool | agent ส่งอะไรมา | ได้อะไรกลับ |
|---|---|---|
| `pdpa_scan` | ข้อความ | มีข้อมูลส่วนบุคคลอะไร อยู่ตรงไหน มั่นใจแค่ไหน · ไม่คืนค่าจริง ไม่คืนข้อความ |
| `pdpa_redact` | ข้อความ | ข้อความที่ปิดข้อมูลส่วนบุคคลแล้ว ตาม policy ของคุณ |

ตัวอย่าง: สั่ง agent ให้สรุปแชทลูกค้าวันนี้ลง ticket ก่อนข้อความเข้า ticket agent เรียก `pdpa_redact` ticket จะได้ `โทร [เบอร์โทร]` แทนเบอร์จริง

ทั้ง 2 tool รับ `context` ได้ (ไม่บังคับ) คือข้อความก่อนหน้า เช่น คำถามที่บอทถาม ถ้าบอทถาม `ขอเลขบัญชีค่ะ` แล้วลูกค้าตอบแค่ `123-4-56789-0` ก็จะถูกจับเป็นเลขบัญชี · `context` ใช้อ่านคำบอกใบ้อย่างเดียว ไม่ถูกส่งกลับ

## ติดตั้ง

ต้องใช้ Node 20 ขึ้นไป · client เป็นคนเปิด server เอง คุณแค่บอกวิธีเปิด

**Claude Code**

```bash
claude mcp add pdpa -- npx -y @eve-pdpa-extension/mcp
```

**Claude Desktop** (`claude_desktop_config.json`) หรือ **Cursor** (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "pdpa": {
      "command": "npx",
      "args": ["-y", "@eve-pdpa-extension/mcp", "--policy", "/path/to/pdpa-policy.json"]
    }
  }
}
```

## policy

ถ้าไม่ใส่ `--policy` ทุกประเภทจะถูกแทนด้วยป้าย เช่น `โทร 0812345678` → `โทร [เบอร์โทร]` · ถ้าอยากเลือกเองทีละประเภท ใส่ไฟล์ policy (JSON แบบเดียวกับที่ `createGuard` รับ อธิบายไว้ใน [README ของ core](../core/README.th.md))

```json
{
  "entitySet": "0.1",
  "entities": {
    "PHONE": { "action": "mask", "keep": "last4" },
    "CREDIT_CARD": { "action": "block" }
  }
}
```

- `redact` `mask` `flag` ทำงานเหมือนใน core
- `block`: `pdpa_redact` ตอบเป็น error บอกประเภท (`pdpa: blocked by policy (CREDIT_CARD)`) ไม่คืนข้อความ · `pdpa_scan` ยังรายงานค่านั้นตามปกติ พร้อม `action: "block"`
- `hash` ต้องมี key ลับ: ตั้ง `PDPA_HMAC_KEY` ใน environment ของ server (ใส่ `"env": { "PDPA_HMAC_KEY": "…" }` ใน config ของ client) · ไม่มี key server จะไม่เปิด
- `tokenise` ใช้ไม่ได้: server จะไม่เปิด และบอกเหตุผล เพราะ token มีประโยชน์เฉพาะกับ tool ที่แลกกลับเป็นค่าจริงได้ ซึ่ง server นี้ไม่มี

## tool

`pdpa_scan` กับ `{ "text": "โทร 0812345678 หรือ somchai@example.com" }`:

```json
{
  "found": 2,
  "byType": { "PHONE": 1, "EMAIL": 1 },
  "findings": [
    { "entity": "PHONE", "start": 4, "end": 14, "confidence": 0.99, "action": "redact" },
    { "entity": "EMAIL", "start": 20, "end": 39, "confidence": 0.97, "action": "redact" }
  ]
}
```

`start` และ `end` นับเป็นตัวอักษรของข้อความที่ส่งมา · `action` คือสิ่งที่ policy จะทำ scan ไม่แก้อะไร

`pdpa_redact` กับข้อความเดียวกัน: ได้ข้อความ `โทร [เบอร์โทร] หรือ [อีเมล]` และ structured content `{ "text": "…", "byType": { "PHONE": 1, "EMAIL": 1 } }`

แต่ละ tool รับ `text` (และ `context`) ได้ไม่เกิน 20,000 ตัวอักษร ถ้ายาวกว่านั้นให้แบ่งส่ง · ทั้ง 2 ตัวประกาศว่าอ่านอย่างเดียว (read-only)

## ตัวเลือก

| ตัวเลือก | |
|---|---|
| `--policy <file>` | policy ที่ใช้ · ค่าเริ่มต้น: ปิดทุกประเภทด้วยป้าย |
| `--audit <file>` | เขียน audit ต่อท้ายไฟล์นี้ บรรทัดละ 1 JSON · ค่าเริ่มต้น: stderr · ไฟล์ที่สร้างใหม่อ่านได้เฉพาะเจ้าของ (`600`) · ถ้าเขียนไฟล์ไม่ได้ตั้งแต่ตอนเปิด server จะไม่เปิด (exit 2) · ถ้าเขียนไม่ได้ทีหลัง จะมีบรรทัดใน stderr บอกว่า event ไหนหาย |
| `-h`, `--help` · `-v`, `--version` | |

| environment | |
|---|---|
| `PDPA_HMAC_KEY` | key ลับของ policy ที่ใช้ hash · บังคับถ้าใช้ |

audit ไม่มีค่าจริง บันทึกแค่ประเภท ตำแหน่ง และการกระทำ · stdout ใช้คุยกับ client ตามโปรโตคอล MCP อย่างเดียว

## ใช้ในโปรแกรมของคุณเอง

server ถูก export ออกมาแบบยังไม่เชื่อมต่อ สำหรับโปรแกรมที่มี transport ของตัวเอง

```ts
import { createGuard } from '@eve-pdpa-extension/core'
import { createPdpaServer, defaultPolicy } from '@eve-pdpa-extension/mcp'

const server = createPdpaServer({ guard: createGuard({ policy: defaultPolicy(), onAudit: log }) })
await server.connect(transport)
```

## ข้อจำกัดที่รู้อยู่

- **stdio อย่างเดียว** · ยังไม่มีแบบ HTTP
- **ไม่รองรับ `tokenise`** · ดูหัวข้อ policy
- **ข้อความ error เป็นแบบทั่วไป** · ถ้าตรวจข้อความไม่ได้ tool ตอบแค่ `pdpa: the text could not be checked` เพื่อไม่ให้ส่วนไหนของข้อความหลุดไปกับ error
- **agent เป็นคนเลือกว่าจะเรียกเมื่อไร** · tool ปิดเฉพาะข้อความที่ส่งมาให้ ไม่ได้คอยดูว่า agent ส่งอะไรไปที่อื่น · ถ้าอยากปิดทุกข้อความที่ eve agent จัดการ ใช้ [`@eve-pdpa-extension/eve`](../eve/README.th.md)
