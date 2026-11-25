# @eve-pdpa-extension/cli

> ตรวจไฟล์แชทเก่าว่ามีข้อมูลส่วนบุคคลไทยอะไรอยู่บ้าง **โดยไม่ต้องเขียนโค้ด** · ใช้ก่อนเปิดให้ AI อ่านแชท หรือก่อนส่งไฟล์ให้คนอื่น

[![npm](https://img.shields.io/npm/v/@eve-pdpa-extension/cli)](https://www.npmjs.com/package/@eve-pdpa-extension/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/mintelligence-dev/eve-pdpa-extension/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/Node-18.18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)

> **เป็นเครื่องมือทางเทคนิค ไม่ใช่ใบรับรองการปฏิบัติตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล**
> รายงานที่ไม่เจออะไร ไม่ได้แปลว่าไฟล์ไม่มีข้อมูลส่วนบุคคล — ดู [ข้อจำกัด](#ข้อจำกัด)

[English](./README.md)

---

## ทำอะไรได้

1. **อ่านไฟล์แชท** JSONL · CSV · TSV · ไฟล์แชทที่ export จาก LINE Official Account
2. **บอกว่าเจออะไร** กี่ค่า อยู่บรรทัดไหน
3. **ใส่ policy แล้วบอกได้ว่า policy จะปิดหรือ block อะไรบ้าง** และเช็คไฟล์ policy ได้ด้วย `policy validate`
4. **ใช้ใน script หรือ CI ได้** exit code บอกว่าเจอหรือไม่เจอ ดู [ใช้ใน script หรือ CI](#ใช้ใน-script-หรือ-ci)
5. **ใช้ตัวตรวจชุดเดียวกับ** [`@eve-pdpa-extension/core`](https://www.npmjs.com/package/@eve-pdpa-extension/core)

## หลักความปลอดภัย

| กฎ | บังคับใช้อย่างไร |
|---|---|
| รายงานไม่มีข้อมูลส่วนบุคคล | มีแค่ประเภท จำนวน เลขบรรทัด และ message id ไม่มีค่าจริง ค่าที่ปิดแล้ว หรือข้อความรอบๆ · แปะลง ticket หรือส่งต่อได้ · message id ก๊อปมาจากไฟล์ของคุณ จึงควรเช็คว่าไม่ใช่เบอร์โทร |
| ไม่แก้ไฟล์ของคุณ | CLI อ่านอย่างเดียว ไม่มีคำสั่งไหนเขียนไฟล์ |
| ข้อมูลไม่ออกจากเครื่อง | ไม่เรียกเน็ต อ่านไฟล์ในเครื่องแล้วพิมพ์ผลออกทาง terminal |
| รูปแบบไฟล์เปลี่ยนแล้วไม่พลาดแบบเงียบๆ | ถ้าไฟล์ export จาก LINE OA หน้าตาไม่ตรงที่คาด CLI หยุดและบอกว่าหาคอลัมน์ไหนไม่เจอ แทนที่จะตรวจผิดคอลัมน์ · ถ้าไม่เจออะไรแต่มีบรรทัดที่อ่านไม่ได้ exit code เป็น 3 ไม่ใช่ 0 |

## ใช้งาน

ไม่ต้องติดตั้ง (ต้องมี Node.js 18.18 ขึ้นไป):

```bash
npx @eve-pdpa-extension/cli scan chats.csv
```

หรือติดตั้งไว้ใช้บ่อย ๆ:

```bash
npm install -g @eve-pdpa-extension/cli
eve-pdpa scan chats.csv
```

## ตัวอย่าง

ไฟล์ `chats.csv`:

```csv
id,text
m1,สวัสดีครับ สั่งเสื้อไซซ์ M ได้ไหมครับ
m2,เบอร์ 091-888-7777 นะครับ
m3,"โอนเข้าเลขบัญชี 123-4-56789-0
แล้วนะครับ"
m4,จ่ายด้วยบัตร 4111 1111 1111 1111 ได้ไหมคะ
m5,เลขอ้างอิง 9000123456789016 ค่ะ
m6,ติดต่อร้านได้ที่ 02-123-4567 ค่ะ
m7,สั่งเพิ่ม 2 ตัว, ส่งด่วน
```

```
$ eve-pdpa scan chats.csv
eve-pdpa scan  chats.csv
policy   none given — every entity reported, nothing rewritten  (fnv1a64:545936cbd8a59fb3)
messages 6 scanned · 4 with personal data · 1 line unreadable

found
  PHONE         2
  BANK_ACCOUNT  1
  CREDIT_CARD   1

messages with personal data
  line 3  m2  PHONE
  line 4  m3  BANK_ACCOUNT
  line 6  m4  CREDIT_CARD
  line 8  m6  PHONE

below the confidence threshold — found, but the policy does nothing with them
  CREDIT_CARD  1  (confidence 0.6, threshold 0.95)
  line 7  m5  CREDIT_CARD
  lower minConfidence in the policy to act on them

unreadable lines — not scanned
  line 9  3 fields, header has 2
```

อ่านรายงานอย่างไร:

| หัวข้อ | ความหมาย |
|---|---|
| `found` | จำนวนค่าที่เจอแยกตามประเภท |
| `messages with personal data` | ข้อความไหนมีอะไร · **เลขบรรทัดในไฟล์** (ข้อความหลายบรรทัดนับที่บรรทัดแรก) และ id จากคอลัมน์ `id` · ถ้า id เป็นข้อมูลส่วนบุคคลเอง (เบอร์ · LINE userId) จะแสดงเป็น `(id hidden: PHONE)` แทน |
| `below the confidence threshold` | ตัวตรวจเจอ แต่ไม่มั่นใจพอจะนับ เช่นเลขที่ผ่านสูตรบัตรเครดิตแต่ไม่รู้ว่าธนาคารไหน · ส่วนใหญ่ไม่ใช่ข้อมูลส่วนบุคคล แต่ควรเปิดดู |
| `unreadable lines` | บรรทัดที่อ่านไม่ได้และ**ไม่ได้ถูกตรวจ** · ตัวอย่างนี้ m7 มี comma ในข้อความแต่ไม่มีเครื่องหมายคำพูดครอบ คอลัมน์จึงเลื่อน |

### ดูว่า policy จะทำอะไร

```
$ eve-pdpa scan chats.csv --policy pdpa-policy.json
...
found
  PHONE         1
  BANK_ACCOUNT  1
  CREDIT_CARD   2
  (and 1 let through by the allowlist)

the policy would
  tokenise  1
  mask      1
  block     2
  2 messages would be blocked whole
```

เบอร์ร้าน `02-123-4567` อยู่ใน allowlist จึงไม่นับ · policy ตัวนี้ตั้ง `minConfidence: 0.6` ให้บัตรเครดิต เลขอ้างอิงใน m5 จึงถูกนับและจะถูก block ด้วย · ดูวิธีเขียน policy ใน [README ของ core](https://www.npmjs.com/package/@eve-pdpa-extension/core#policy)

### รายงานให้เครื่องอ่าน

```bash
eve-pdpa scan chats.csv --json > report.json
```

### รายงานสำหรับเปิดในเบราว์เซอร์

```bash
eve-pdpa scan chats.csv --html > report.html
```

หน้า HTML ไฟล์เดียวจบ ไว้ส่งให้คนที่ไม่อ่านเทอร์มินัล มีจำนวน เลขบรรทัด และ id ของข้อความ ครบ**ทุกข้อความ**เหมือน JSON ไม่มีข้อมูลส่วนบุคคล ไม่โหลดอะไรจากภายนอก (ไม่มี script รูป หรือลิงก์ และมี content-security policy ห้ามไว้) และ escape ทุกอย่างที่มาจากไฟล์ของคุณ CLI ยังไม่เขียนไฟล์เอง เครื่องหมาย `>` เป็นของคุณ ใช้ `--json` กับ `--html` พร้อมกันไม่ได้

ได้ข้อมูลเดียวกันเป็น JSON และมี**ทุกข้อความ** (แบบคนอ่านแสดง 20 ข้อความแรก)

## ไฟล์ที่อ่านได้

| ชนิด | รู้ได้จาก | ข้อความอยู่ที่ |
|---|---|---|
| JSONL | นามสกุล `.jsonl` `.ndjson` | ฟิลด์ `text` · id ที่ฟิลด์ `id` |
| CSV | นามสกุล `.csv` · ต้องมีแถวหัวตาราง | คอลัมน์ `text` · id ที่คอลัมน์ `id` (ไม่มีก็ได้) |
| TSV | นามสกุล `.tsv` | เหมือน CSV คั่นด้วย tab |
| LINE OA | ไฟล์ `.csv` ที่บรรทัดแรกเป็น `ชื่อบัญชี,…` และมีหัวตาราง `ประเภทผู้ส่ง,…` | คอลัมน์ `ข้อความ` |

ชื่อฟิลด์หรือคอลัมน์ไม่ตรง:

```bash
eve-pdpa scan export.csv --text-field message --id-field msg_id
```

นามสกุลไม่บอกชนิด: `--format jsonl` · `csv` · `tsv` · `line-oa`

### ไฟล์ CSV จาก Excel ภาษาไทย

Excel ภาษาไทยมักบันทึก CSV เป็น windows-874 ไม่ใช่ UTF-8:

```
$ eve-pdpa scan excel.csv
scan stopped: excel.csv is not valid utf-8 — a CSV saved by Thai Excel is usually windows-874: try --encoding windows-874

$ eve-pdpa scan excel.csv --encoding windows-874
```

CLI **หยุดแทนที่จะอ่านต่อแบบเพี้ยน** · ถ้าอ่านผิด encoding ตัวเลขยังอยู่แต่คำไทยหาย คำบอกใบ้อย่าง "เลขบัญชี" หายไปด้วย แล้วเลขบัญชีจะหลุดโดยไม่มีอะไรเตือน

### ไฟล์แชทจาก LINE Official Account

ใน LINE OA Manager ดาวน์โหลดประวัติแชท (ต้องใช้แพ็กเกจที่มีฟีเจอร์นี้) จะได้ไฟล์ .zip ที่มี CSV แยกไฟล์ละ 1 ลูกค้า · **แตก zip ก่อน** แล้วสแกนทีละไฟล์:

```
$ eve-pdpa scan "3_20261001_20261007_สมชาย ตัวอย่าง.csv"
eve-pdpa scan  3_20261001_20261007_….csv
policy   none given — every entity reported, nothing rewritten  (fnv1a64:545936cbd8a59fb3)
messages 3 scanned · 2 with personal data
         from customers 1 of 2 · from the shop 1 of 1

found
  PHONE  2

messages with personal data
  line 6  customer  PHONE
  line 7  shop      PHONE
```

- **ชื่อลูกค้าไม่อยู่ในรายงาน** · LINE ตั้งชื่อไฟล์ตามชื่อ LINE ของลูกค้า รายงานจึงตัดเหลือแค่เลขลำดับกับวันที่ · คอลัมน์ผู้ส่งแสดงแค่ `customer` หรือ `shop`
- **ตรวจทั้งฝั่งลูกค้าและร้าน** · แอดมินก็พิมพ์ข้อมูลลูกค้าได้ เช่นบรรทัด 7 ข้างบน
- **อ่านคำตอบคู่กับคำถามของอีกฝ่าย** · แอดมินถาม "ขอเบอร์ติดต่อหน่อยค่ะ" แล้วลูกค้าตอบแค่ `918887777` (0 หายเพราะ Excel) นับเป็นเบอร์ · ถ้าถามเลขบัญชี คำตอบ 10 หลักอย่าง `0918887777` นับเป็นเลขบัญชี (เลขบัญชียาว 10–12 หลัก `918887777` อย่างเดียวจึงไม่นับ) · JSONL และ CSV ไม่บอกว่าใครพิมพ์บรรทัดไหน จึงอ่านทีละข้อความ
- LINE OA ที่ตั้งเป็นภาษาอื่นมีหัวตารางคนละแบบ · ใช้ `--format line-oa --text-field <ชื่อคอลัมน์ข้อความ>`

## เช็คไฟล์ policy

```
$ eve-pdpa policy validate pdpa-policy.json
pdpa-policy.json  valid  fnv1a64:ee142dc8b1111706

  TH_NATIONAL_ID  redact
  PHONE           tokenise · purposes: otp_send · ttl 300s · reply shows masked value
  EMAIL           hash
  BANK_ACCOUNT    mask · last 4 shown
  CREDIT_CARD     block · minConfidence 0.6
  LINE_USER_ID    redact
  LICENSE_PLATE   not in the policy → redact (onUnmapped)
  DATE_OF_BIRTH   not in the policy → redact (onUnmapped)
  PASSPORT        not in the policy → redact (onUnmapped)
  PROMPTPAY       not in the policy → redact (onUnmapped)
  ADDRESS         not in the policy → redact (onUnmapped)
  PERSON_NAME     not in the policy → redact (onUnmapped)

allowlist   2 exact · 1 pattern (values not shown)
placeholders [เบอร์โทร]

note: uses hash: createGuard needs an hmacKey of at least 32 bytes
note: uses tokenise: every process and resolve call needs a sessionId
```

โหลดด้วยวิธีเดียวกับที่แอปโหลด ผ่านที่นี่คือแอปรับได้ · ผิดจะบอกชื่อช่องที่ผิด เช่น `entities.PHONE.allowedPurposes: required for tokenise` · ค่าใน allowlist บอกแค่จำนวน ไม่แสดงค่า

## ใช้ใน script หรือ CI

ดูผลจาก exit code ได้โดยไม่ต้องอ่านรายงาน:

| `scan` | ความหมาย |
|---|---|
| `0` | อ่านครบทุกบรรทัด ไม่เจออะไร |
| `1` | เจอข้อมูลส่วนบุคคล |
| `2` | รันไม่ได้ · argument ผิด · ไม่มีไฟล์ · policy ผิด · encoding ผิด |
| `3` | ไม่เจอ **แต่มีบรรทัดที่อ่านไม่ได้** · "ไม่เจอ" ไม่ได้แปลว่า "ไม่มี" |

`policy validate`: `0` ถูก · `1` ผิด · `2` รันไม่ได้

```bash
eve-pdpa scan export.jsonl --policy pdpa-policy.json
case $? in
  0) echo "ไม่เจอข้อมูลส่วนบุคคล" ;;
  1) echo "เจอ — ดูรายงานก่อนส่งต่อ" ;;
  3) echo "มีบรรทัดที่ไม่ได้ตรวจ — แก้ไฟล์แล้วสแกนใหม่" ;;
  *) exit 1 ;;
esac
```

## ข้อจำกัด

- ชื่อคนและที่อยู่จับได้เฉพาะที่มีตัวบอก: ชื่อต้องมีคำนำหน้า (นาย นางสาว ดร. ยศ …) คำแนะนำตัว ("ผมชื่อ") ป้ายในฟอร์ม ("ชื่อ-นามสกุล") หรือเป็นคำตอบของคำถามที่ขอชื่อ · ที่อยู่ภาษาไทยหรือภาษาอังกฤษ (Soi, Road, Moo, Subdistrict, District, Bangkok …) ต้องมีส่วนประกอบอย่างน้อยสามชนิด (บ้านเลขที่ ซอย ตำบล อำเภอ จังหวัด รหัสไปรษณีย์) หรือสองชนิดกับคำว่า "ที่อยู่" / address · ชื่อลอย ๆ กลางประโยค ชื่อเล่น และชื่อสถานที่ที่ไม่มีป้ายยังไม่จับ (ต้องใช้ NER)
- ข้อจำกัดของตัวตรวจทั้งหมดเหมือน core เช่น เลขบัญชีต้องมีคำบอกใบ้ · ดู [ข้อจำกัดที่รู้อยู่](https://www.npmjs.com/package/@eve-pdpa-extension/core#known-limitations)
- สแกนทีละไฟล์ · ไม่อ่าน .zip
- รูปแบบไฟล์ LINE OA ได้จาก export ภาษาไทยปี 2025 · ถ้า LINE เปลี่ยนรูปแบบ CLI จะหยุดพร้อมบอกว่าหาคอลัมน์ไม่เจอ ไม่สแกนผิดคอลัมน์เงียบ ๆ
- **ตรวจอย่างเดียว ไม่แก้ไฟล์** · ยังไม่มีคำสั่งสร้างไฟล์ที่ปิดข้อมูลแล้ว

## แจ้งช่องโหว่

แจ้งแบบส่วนตัวผ่าน GitHub ที่แท็บ **Security** ของ repository เลือก **Report a vulnerability** ([ลิงก์ตรง](https://github.com/mintelligence-dev/eve-pdpa-extension/security/advisories/new)) ห้ามเปิดเป็น issue สาธารณะ · ใช้ข้อมูลปลอมในการทำซ้ำ ห้ามส่งข้อมูลส่วนบุคคลจริง

## License

MIT
