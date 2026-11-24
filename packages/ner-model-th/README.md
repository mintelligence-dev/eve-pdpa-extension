# @eve-pdpa-extension/ner-model-th

The model artifact, or a fetcher for it. **Planned for 0.3 — not started.** Kept apart from `ner` because the adapter changes often and the model rarely does; a patch should not force a download of hundreds of MB.

There is **no `package.json` here on purpose**: pnpm does not see the folder, so CI never reports a green build for a package with no code. Add a `package.json` when work starts and pnpm picks it up on the next install.

---

## ภาษาไทย

ตัว model artifact หรือ fetcher · **เริ่ม 0.3**

แยกจาก `ner` เพราะ adapter แก้บ่อยจาก bug fix ส่วนโมเดลนิ่งกว่ามาก ไม่ควรบังคับให้ดาวน์โหลดใหม่หลักร้อย MB ทุก patch

**ยังไม่มี `package.json` โดยตั้งใจ** — pnpm จึงมองไม่เห็นโฟลเดอร์นี้ และ CI
ไม่รายงานว่า build/test "ผ่าน" สำหรับแพ็กเกจที่ยังไม่มีโค้ด ติ๊กถูกสีเขียวทุกอัน
ต้องแปลว่ามีของจริงถูกตรวจ

เริ่มทำจริงเมื่อไหร่ ให้เพิ่ม `package.json` — pnpm เห็นทันทีในรอบ install ถัดไป
โดยไม่ต้องแก้ config อะไรเลย
