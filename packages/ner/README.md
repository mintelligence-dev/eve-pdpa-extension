# @eve-pdpa-extension/ner

Adapter that calls a NER model; no model bytes live here. Node only. **Planned for 0.3 — not started.** No model has been chosen, and NER itself is not confirmed: every candidate's licence has to be audited first.

There is **no `package.json` here on purpose**: pnpm does not see the folder, so CI never reports a green build for a package with no code. Add a `package.json` when work starts and pnpm picks it up on the next install.

---

## ภาษาไทย

Adapter เรียกโมเดล NER — ไม่มี model bytes อยู่ในนี้ · Node เท่านั้น · **เริ่ม 0.3**

ยังไม่เลือกโมเดล และยังไม่ยืนยันว่าจะใช้ NER — ต้อง audit licence ทุก candidate ก่อน

**ยังไม่มี `package.json` โดยตั้งใจ** — pnpm จึงมองไม่เห็นโฟลเดอร์นี้ และ CI
ไม่รายงานว่า build/test "ผ่าน" สำหรับแพ็กเกจที่ยังไม่มีโค้ด ติ๊กถูกสีเขียวทุกอัน
ต้องแปลว่ามีของจริงถูกตรวจ

เริ่มทำจริงเมื่อไหร่ ให้เพิ่ม `package.json` — pnpm เห็นทันทีในรอบ install ถัดไป
โดยไม่ต้องแก้ config อะไรเลย
