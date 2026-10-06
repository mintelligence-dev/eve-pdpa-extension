# @thai-pdpa-guard/policy

โหลดไฟล์ policy จากดิสก์ แปลง YAML และ validate เต็มรูปแบบด้วย ajv · Node เท่านั้น · **เริ่ม 0.2**

แยกจาก core เพราะการอ่านไฟล์ต้องใช้ `node:fs` (พังบน browser/workerd) และ YAML parser จะเป็น runtime dependency ตัวแรกของ core

**ยังไม่มี `package.json` โดยตั้งใจ** — pnpm จึงมองไม่เห็นโฟลเดอร์นี้ และ CI
ไม่รายงานว่า build/test "ผ่าน" สำหรับแพ็กเกจที่ยังไม่มีโค้ด ติ๊กถูกสีเขียวทุกอัน
ต้องแปลว่ามีของจริงถูกตรวจ

เริ่มทำจริงเมื่อไหร่ ให้เพิ่ม `package.json` — pnpm เห็นทันทีในรอบ install ถัดไป
โดยไม่ต้องแก้ config อะไรเลย
