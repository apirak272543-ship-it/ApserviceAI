# Modern Web Guidance Reference

โฟลเดอร์นี้เก็บสำเนา `SKILL.md` ของ [GoogleChrome/modern-web-guidance-src](https://github.com/GoogleChrome/modern-web-guidance-src) เพื่อใช้เป็น reference ภายใน repository `ApserviceAI` สำหรับงาน HTML, CSS และ client-side JavaScript

## หลักการใช้งาน

ก่อนพัฒนา frontend feature ใหม่ ให้ค้นหา use case ที่เกี่ยวข้องก่อน แล้วอ่านคำแนะนำฉบับเต็มของ guide ที่พบ จากนั้นตรวจ implementation เทียบกับแนวทางและ fallback ที่ระบุไว้ โดยไม่เพิ่ม dependency ขนาดใหญ่หาก native web platform เพียงพอ

คำสั่ง upstream ที่อ้างอิงใน skill คือ:

```sh
pnpx modern-web-guidance@latest search "<action-oriented query>"
pnpx -y modern-web-guidance@latest retrieve "<guide-id>"
```

ไฟล์ `SKILL.md` ที่อยู่ในโฟลเดอร์นี้เป็น reference แบบ pinned ตาม source commit ที่บันทึกไว้ใน `SOURCE_COMMIT` ส่วนการเรียกใช้ package ควรใช้เวอร์ชันล่าสุดตามคำแนะนำ upstream เมื่อมี network และ dependency policy อนุญาต

## ขอบเขต

Reference นี้ใช้กับงาน frontend และ browser APIs เท่านั้น ไม่ใช่ข้อกำหนดสำหรับ backend, SQL, CI/CD หรือ Git workflow และไม่ได้คัดลอก dependency หรือ runtime ของ repository ต้นทางเข้ามาในแอป

## Source

- Repository: https://github.com/GoogleChrome/modern-web-guidance-src
- Skill path: `guides/modern-web-guidance/SKILL.md`
- Source revision: ดูไฟล์ `SOURCE_COMMIT`


## Local verification

The local `index.html` was opened after the accessibility update. The skip link, PIN dialog, labeled search field, labeled composer controls, `role="log"` message list, and settings dialog landmark all rendered without markup/runtime failure in the browser preview.
