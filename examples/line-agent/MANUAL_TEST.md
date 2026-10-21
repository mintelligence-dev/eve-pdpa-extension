# ทดสอบกับ LINE จริง (ทำมือ)

เทสต์อัตโนมัติรันเส้นทาง LINE แบบ offline (webhook ที่ลงลายเซ็นเอง + LINE API ปลอม) · ขั้นตอนนี้ไว้ลองกับ LINE OA จริงก่อนใช้งาน · **ใช้บัญชีทดสอบ และพิมพ์แต่ข้อมูลสมมติ** ห้ามใช้ข้อมูลลูกค้าจริง

## 1. เตรียม LINE channel

1. เข้า [LINE Developers console](https://developers.line.biz/console/) → เลือก (หรือสร้าง) provider → สร้าง channel แบบ **Messaging API** สำหรับทดสอบ
2. แท็บ **Basic settings** → คัดลอก **Channel secret**
3. แท็บ **Messaging API** → **Channel access token (long-lived)** → กด Issue แล้วคัดลอก
4. ในแท็บเดียวกัน ปิด **Auto-reply messages** และ **Greeting messages** (ที่ LINE Official Account Manager) ไม่อย่างนั้น LINE จะตอบซ้อนกับบอท

## 2. ตั้งค่าและรัน agent

```bash
cd examples/line-agent
cp .env.example .env.local
# แก้ .env.local: ใส่ LINE_CHANNEL_ACCESS_TOKEN และ LINE_CHANNEL_SECRET
#                 ใส่ PDPA_EXAMPLE_MOCK_MODEL=1 ถ้ายังไม่อยากใช้โมเดลจริง
corepack pnpm dev            # หรือ dev:mock
```

## 3. เปิด URL สาธารณะ

LINE ส่ง webhook ได้เฉพาะ https สาธารณะ · เปิด tunnel ไปที่ port 2000 ด้วยเครื่องมือที่ทีมใช้ เช่น

```bash
cloudflared tunnel --url http://localhost:2000
# หรือ: ngrok http 2000
```

จะได้ URL เช่น `https://<random>.trycloudflare.com`

## 4. ตั้ง webhook ที่ LINE

แท็บ **Messaging API** → **Webhook settings**

- Webhook URL: `https://<tunnel>/eve/v1/line`
- กด **Verify** → ต้องขึ้น Success
- เปิด **Use webhook**

## 5. ส่งข้อความทดสอบ

แอดบอทเป็นเพื่อนด้วยบัญชี LINE ทดสอบ (สแกน QR ในแท็บ Messaging API) แล้วส่งทีละข้อความ:

| ส่ง | ต้องเห็น |
|---|---|
| `สวัสดีค่ะ` | บอทตอบ (โหมด mock: `(โมเดลทดสอบ) ข้อความที่โมเดลได้รับ: สวัสดีค่ะ`) |
| `เลขบัตร 2-3570-37506-24-2 โทร 091-888-7777` | คำตอบมี `[เลขบัตรประชาชน]` และ `xxx-xxx-7777` · **ไม่มีเลขเต็ม** |
| `เมล somchai@example.com` | คำตอบมี `[อีเมล]` |
| `บัตร 4111 1111 1111 1111` | บอทตอบ `ข้อความนี้ไม่ได้ถูกส่งต่อ เพราะมีเลขบัตรเครดิต …` และโมเดลไม่ถูกเรียก |

## 6. ตรวจว่าไม่มีค่าจริงหลุด

- terminal ที่รัน `eve dev`: audit event (JSON ทีละบรรทัด) ต้องไม่มีเลขบัตร เบอร์ หรืออีเมลเต็ม
- ประวัติ session: ดู session id ได้จาก terminal UI แล้ว
  ```bash
  curl -s "http://127.0.0.1:2000/eve/v1/session/<sessionId>/stream?follow=false" | grep -c "091-888-7777"
  # ต้องได้ 0
  ```
- โหมด mock ตั้ง `PDPA_EXAMPLE_RECORD_FILE=/tmp/prompts.jsonl` แล้ว `grep -c 091-888-7777 /tmp/prompts.jsonl` ต้องได้ 0

## หมายเหตุ

- ปิด `eve dev` แล้วเปิดใหม่ บทสนทนา LINE เดิมจะค้าง (eve ไม่ resume run ของ server รอบก่อนเอง) · ใช้ `eve dev --resume` หรือรอให้ session เดิมหมดอายุ
- `createMemoryState()` ลืม subscription เมื่อ restart · ใช้จริงให้เปลี่ยนเป็น state adapter ที่เก็บถาวร
- ทดสอบเสร็จ ปิด **Use webhook** หรือลบ channel ทดสอบ และ revoke access token
