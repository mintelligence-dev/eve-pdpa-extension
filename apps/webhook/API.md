# API ของ webhook — สำหรับระบบที่เรียกใช้

webhook นี้เป็น **relay ที่ปิดข้อมูลส่วนบุคคลก่อนส่งต่อ** คั่นอยู่ระหว่างแอปแชทกับระบบที่ตอบ (เช่น AI)
**ไม่ใช่ปลายทาง webhook ของ LINE** — backend ของแอปแชทเป็นคนเรียก ด้วย JSON รูปแบบเดียวด้านล่าง

- spec เต็ม: [`openapi.json`](./openapi.json) (OpenAPI 3.1) · import เข้า Postman ได้ (Import → File)
- spec กับเอกสารนี้มีเทสคุมไว้ (`packages/http/test/api-docs.test.ts`) — ถ้าโค้ดเปลี่ยนแต่เอกสารไม่เปลี่ยน เทสพัง

```
แอปแชท ──POST /api/inbound──▶  webhook  ──POST forwardTo (scope: forward)──▶ ระบบที่ตอบ (AI)
แอปแชท ◀──POST replyTo (scope: reply)── webhook ◀──POST /api/outbound──────── ระบบที่ตอบ
tool ของ AI (เช่นระบบ OTP) ──POST /api/resolve──▶ webhook ──▶ ค่าจริง (เฉพาะ purpose ที่อนุญาต)
แอปแชท ──POST /api/end-session──▶ webhook ──▶ ลบ token ทุกตัวของห้องแชท
```

## Endpoint

| endpoint | ใครเรียก | เซ็นด้วย | scope |
|---|---|---|---|
| `POST /api/inbound` | backend ของแอปแชท | `PDPA_SECRET` | `inbound` |
| `POST /api/outbound` | ระบบที่ตอบ | `PDPA_SECRET` | `outbound` |
| `POST /api/resolve` | **โค้ดของ tool** ที่ต้องใช้ค่าจริง (ไม่ใช่ AI) | `PDPA_RESOLVE_SECRET` | `resolve` |
| `POST /api/end-session` | backend ของแอปแชท | `PDPA_SECRET` | `end-session` |

webhook ส่งออก:

| ไปที่ | เซ็นด้วย | scope | ผู้รับต้องตรวจด้วย scope |
|---|---|---|---|
| `forwardTo` (ระบบที่ตอบ) | `PDPA_SECRET` | `forward` | `forward` |
| `replyTo` (แอปแชท) | `PDPA_SECRET` | `reply` | `reply` |

secret ได้จากคนที่ดูแล deployment ทางช่องทางที่ปลอดภัย · **ห้ามใส่ในโค้ด ใน log หรือในแชท**

## ลายเซ็น

ทุก request ต้องมี header สองตัว:

```
x-pdpa-timestamp: 1791281362
x-pdpa-signature: v1=<hex>
```

สูตร (ใช้ได้ทุกภาษา):

```
timestamp = เวลาปัจจุบัน หน่วยวินาที (unix)
message   = timestamp + "." + scope + "." + body
signature = "v1=" + hex( HMAC-SHA256(secret, message) )     ← hex ตัวเล็ก 64 ตัว
```

**จุดที่พลาดบ่อย — ทุกข้อได้ 401**
1. **เซ็น body ตัวเดียวกับที่ส่งจริงทุกไบต์** · แปลง JSON เป็น string ครั้งเดียว แล้วเซ็นและส่ง string นั้น · ถ้าไลบรารี HTTP แปลง JSON ใหม่ตอนส่ง (เว้นวรรค ลำดับ key) ลายเซ็นจะไม่ตรง
2. **UTF-8** · ภาษาไทยต้องเป็น UTF-8 ทั้งตอนเซ็นและตอนส่ง
3. **นาฬิกา** · timestamp ห่างจากเวลาของ webhook เกิน 300 วินาที = หมดอายุ
4. **scope ตรงกับ endpoint** · เซ็น `inbound` แล้วยิง `/api/outbound` ไม่ผ่าน
5. **secret ถูกตัว** · `/api/resolve` ใช้ `PDPA_RESOLVE_SECRET` ไม่ใช่ `PDPA_SECRET`

webhook ตอบ 401 ข้อความเดียวกันทุกกรณี (ไม่บอกว่าผิดข้อไหน) — ไล่เช็คตามลิสต์นี้

### curl + openssl

```bash
BODY='{"sessionId":"conv_8f2a","text":"เบอร์ 091-888-7777 ค่ะ","forwardTo":"https://ai.example.com/inbound"}'
TS=$(date +%s)
SIG=$(printf '%s' "$TS.inbound.$BODY" | openssl dgst -sha256 -hmac "$PDPA_SECRET" -hex | sed 's/^.* //')
curl -X POST "https://<deployment>/api/inbound" \
  -H 'content-type: application/json' \
  -H "x-pdpa-timestamp: $TS" -H "x-pdpa-signature: v1=$SIG" \
  --data-binary "$BODY"
```

`--data-binary` ส่ง body ตามตัวอักษร · `-d` เฉย ๆ อาจตัดขึ้นบรรทัด

### Python

```python
import hashlib, hmac, json, os, time
import requests

def signed_post(url: str, scope: str, payload: dict, secret: str) -> requests.Response:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ts = str(int(time.time()))
    mac = hmac.new(secret.encode(), f"{ts}.{scope}.".encode() + body, hashlib.sha256).hexdigest()
    return requests.post(url, data=body, headers={
        "content-type": "application/json",
        "x-pdpa-timestamp": ts,
        "x-pdpa-signature": f"v1={mac}",
    }, timeout=15)

signed_post("https://<deployment>/api/inbound", "inbound",
            {"sessionId": "conv_8f2a", "text": "เบอร์ 091-888-7777 ค่ะ",
             "forwardTo": "https://ai.example.com/inbound",
             "replyTo": "https://chat.example.com/reply"},
            os.environ["PDPA_SECRET"])
```

ส่ง `data=body` (bytes ที่เซ็นแล้ว) **ไม่ใช่** `json=payload`

### Node

```ts
import { createHmac } from 'node:crypto'

const body = JSON.stringify({ sessionId: 'conv_8f2a', text: 'เบอร์ 091-888-7777 ค่ะ' })
const ts = String(Math.floor(Date.now() / 1000))
const mac = createHmac('sha256', process.env.PDPA_SECRET!).update(`${ts}.inbound.${body}`).digest('hex')
await fetch('https://<deployment>/api/inbound', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-pdpa-timestamp': ts, 'x-pdpa-signature': `v1=${mac}` },
  body,
})
```

ใน repo นี้ใช้ `signRequest(secret, 'inbound', body)` จาก `@eve-pdpa-extension/http` แทนได้

### Postman

[`postman/`](./postman) มี collection ที่**เซ็นลายเซ็นให้เอง**ทุก request (pre-request script ตามสูตรข้างบน · มีเทสคุมไว้)

1. Postman → Import → `eve-pdpa-webhook.postman_collection.json` และ `eve-pdpa-webhook.postman_environment.json`
2. เลือก environment แล้วกรอกใน Postman (**อย่าแก้ไฟล์แล้ว commit**): `baseUrl` · `pdpaSecret` · `pdpaResolveSecret` · `vercelBypass` (เฉพาะ preview ที่ถูกล็อก — Vercel → Settings → Deployment Protection → Protection Bypass for Automation)
3. แก้ body ได้ตามต้องการ ลายเซ็นคำนวณใหม่ทุกครั้งที่กด Send · ใช้ข้อมูลสังเคราะห์เท่านั้น

## ฝั่งที่รับ (`forwardTo` · `replyTo`)

1. อ่าน body เป็น **text ดิบ** ก่อน · อย่า parse JSON ก่อนตรวจ
2. คำนวณด้วยสูตรเดียวกัน scope = `forward` (ระบบที่ตอบ) หรือ `reply` (แอปแชท)
3. เทียบลายเซ็นแบบเวลาคงที่ และเช็คว่า timestamp ไม่เกิน 300 วินาที
4. ตอบ 2xx เร็ว ๆ · ตอบอย่างอื่น (รวม redirect) = webhook ตอบผู้ส่งเป็น 502 · webhook รอได้ 10 วินาที

```python
def verify(raw: bytes, headers, scope: str, secret: str) -> bool:
    ts = headers.get("x-pdpa-timestamp", "")
    sig = headers.get("x-pdpa-signature", "")
    if not ts.isdigit() or abs(time.time() - int(ts)) > 300:
        return False
    mac = hmac.new(secret.encode(), f"{ts}.{scope}.".encode() + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, f"v1={mac}")
```

ใน Node ใช้ `verifyRequest(secret, 'forward', request.headers, body)` ได้

ระบบที่ตอบได้รับ `{ policy, sessionId, ref?, text, replyTo? }` · ส่งคำตอบไป `/api/outbound` พร้อม `policy` `sessionId` และ `replyTo` เดิม
ข้อความอาจมี `[tok:…]` แทนค่าจริง — ส่งต่อให้ tool ตามที่เห็น อย่าแก้

## ช่องของแต่ละ endpoint

ทุกช่องเป็น string · ช่องที่ไม่อยู่ในตาราง = 400 (`field: "body"`) · เกินความยาว = 400 ระบุชื่อช่อง ไม่บอกค่า

**`/api/inbound`** · `/api/outbound` เหมือนกันแต่ไม่มี `forwardTo`

| ช่อง | บังคับ | กติกา |
|---|---|---|
| `policy` | | ชื่อชุดกฎ (≤ 64) · ไม่ส่ง = `default` · deployment นี้มี `default` (ไม่ tokenise) และ `otp` (เบอร์เป็น token แลกได้เฉพาะ `otp_send`) |
| `sessionId` | ✅ | id ห้องแชทของระบบคุณ (≤ 256) · **ห้ามเป็น LINE userId หรือเบอร์** — ถูกเขียนลง audit · เป็นข้อมูลส่วนบุคคล = 400 |
| `ref` | | id ข้อความของระบบคุณ (≤ 256) · ตรวจแบบเดียวกับ `sessionId` |
| `text` | ✅ | ข้อความ |
| `context` | | ข้อความล่าสุดของอีกฝ่าย ใช้ดูคำบอกใบ้ (*"ขอเบอร์ค่ะ"*) · ไม่ถูกส่งต่อ |
| `forwardTo` | (inbound) | ปลายทาง (≤ 2048) · https · ไม่ใช่ที่อยู่ภายใน · ไม่มีข้อมูลส่วนบุคคลใน URL · ไม่ส่ง = ค่าตั้งต้นของ deployment |
| `replyTo` | | ที่ที่คำตอบต้องไปถึง (≤ 2048) · กติกาเดียวกัน · inbound ส่งต่อให้ระบบที่ตอบ |

**`/api/resolve`**

| ช่อง | บังคับ | กติกา |
|---|---|---|
| `policy` | | ชุดกฎที่ tokenise (`otp`) |
| `token` | ✅ | `[tok:…]` ตามที่ AI คัดลอกมา (ไม่มีวงเล็บ · มี quote ก็ได้) · token ตัวเดียว |
| `sessionId` | ✅ | ห้องแชทเดียวกับตอนออก token |
| `purpose` | ✅ | เหตุผลที่ต้องใช้ค่าจริง (≤ 128) เช่น `otp_send` |
| `caller` | | ใครขอ (≤ 128) เช่น `otp-service` · ลง audit |
| `ref` | | |

**`/api/end-session`** · `sessionId` ✅ เท่านั้น

## คำตอบ

| status | body | ทำอะไรต่อ |
|---|---|---|
| 200 | `{ "outcome": "processed" }` | ส่งต่อแล้ว |
| 200 | `{ "outcome": "blocked", "blockedBy": ["CREDIT_CARD"] }` | ไม่ได้ส่งต่อ · บอกลูกค้า เช่น "กรุณาอย่าส่งเลขบัตรในแชท" |
| 200 | `{ "ok": true, "value": "0918887777" }` · `{ "ok": false, "reason": "…" }` | `/api/resolve` · reason: `not_found` `session_mismatch` `expired` `purpose_not_allowed` `store_unavailable` |
| 200 | `{ "ok": true }` | `/api/end-session` |
| 400 | `{ "error": "invalid_request", "field", "message" }` | แก้ request ตาม `field` |
| 401 | `{ "error": "unauthorized", … }` | ไล่ลิสต์ "จุดที่พลาดบ่อย" |
| 404 | `{ "error": "not_found", … }` | `/api/resolve` · `/api/end-session` เมื่อไม่มีชุดกฎที่ tokenise |
| 405 · 413 | | ไม่ใช่ POST · body เกิน 64 KiB |
| 500 | | ตรวจไม่ได้ · **ไม่ได้ส่งต่อ** · ส่งใหม่ |
| 502 | `{ "outcome": "forward_failed", … }` | ปิดข้อมูลแล้วแต่ปลายทางไม่รับ · ส่งใหม่ |

ส่งซ้ำได้อย่างปลอดภัยเมื่อได้ 500 · 502 · ใช้ `ref` เดิม ให้ปลายทางตัดตัวซ้ำได้ (request ที่ถูกดักไว้ก็ยิงซ้ำได้ภายใน 300 วินาที — ปลายทางควรตัดซ้ำด้วย `ref` อยู่แล้ว)

## token และ `/api/resolve`

- บอก AI ใน system prompt และคำอธิบายของ tool ว่าข้อมูลลูกค้าแสดงเป็น `[tok:…]` ให้ส่งต่อตามที่เห็น ห้ามเดาค่าจริง
- โค้ดของ tool แลก token ที่ `/api/resolve` ใช้ค่า แล้วตอบ AI ว่า "ส่งแล้ว" — **ไม่ส่งค่าจริงกลับให้ AI · ไม่ log ค่าจริง**
- token อยู่ได้ 5 นาที · หมดอายุ = `expired` → ให้ tool บอก AI ให้ขอค่าจากลูกค้าใหม่
- OTP ยืนยันตัวตน ให้ส่งไปเบอร์ที่ลงทะเบียนไว้ ไม่ใช่เบอร์ในแชท · tool ต้องจำกัดจำนวนครั้งที่ส่งเอง
