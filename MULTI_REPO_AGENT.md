# Autonomous Multi-Repository Agent

ระบบนี้ใช้ `ApserviceAI` เป็นรีโพสิทอรีกลางสำหรับเก็บ Runner และ Workflow แต่ Agent สามารถค้นหาและทำงานกับรีโพสิทอรีอื่นที่ GitHub Token เข้าถึงได้

## การทำงาน

1. NOVA ส่ง `enqueue_task` ไปยัง Supabase Edge Function โดย `owner` และ `repo` จะระบุหรือปล่อยว่างก็ได้
2. Edge Function บันทึกงานลง `public.tasks` และส่ง `repository_dispatch` ชนิด `nova_task` ไปยังรีโพกลาง
3. GitHub Actions เปิด Runner และส่ง `GH_PAT` ให้ Runner
4. หากงานไม่ระบุรีโพ Runner เรียก GitHub API ดูรายการรีโพที่ Token เข้าถึงได้ แล้วให้โมเดลเลือกรีโพที่ตรงกับเป้าหมาย
5. Runner clone รีโพนั้นลง Workspace แยก, อ่าน/แก้ไข/ทดสอบ, commit และ push กลับรีโพเป้าหมาย
6. ผลลัพธ์ถูกบันทึกกลับ Supabase พร้อมชื่อรีโพและ Workspace

## Secrets ที่ต้องตั้งใน GitHub Actions

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`
- `GH_PAT`: Fine-grained PAT ที่มีสิทธิ์กับรีโพทั้งหมดที่อนุญาตให้ Agent ทำงาน โดยอย่างน้อยต้องมี Metadata read และ Contents read/write; เพิ่ม Actions write หากให้ Agent dispatch workflow ของรีโพอื่น

`GITHUB_TOKEN` ของ Actions ใช้เป็น fallback สำหรับรีโพกลางเท่านั้น และไม่ควรถือว่าสามารถเข้าถึงรีโพทั้งหมดได้

## ขอบเขตความปลอดภัย

Agent ทำงานได้เฉพาะรีโพที่ `GH_PAT` เข้าถึงได้ ห้ามใส่ Service Role Key หรือ Gemini Key ลงในรีโพหรือ APK ระบบไม่ลบรีโพ ไม่เปลี่ยนสิทธิ์สมาชิก และทำงานใน Workspace ชั่วคราวแยกตาม task

คำสั่งที่เหมาะสม เช่น:

> ตรวจสอบโปรเจกต์แอปมือถือทั้งหมดของฉัน แล้วเลือกรีโพที่เกี่ยวข้องที่สุด แก้ปัญหา Login ทดสอบ และรายงานชื่อรีโพกับ Commit
