# NOVA Chat: direct execution architecture

เวอร์ชันนี้ไม่ใช้ Supabase เป็นคิวงาน ไม่สร้าง task และไม่พึ่ง GitHub Actions, repository dispatch หรือ Runner ภายนอก

## การทำงานหลัก

- แชตและประวัติแชตทำงานใน browser และเก็บใน IndexedDB เป็นหลัก
- หากเปิดใช้งาน Supabase ให้ใช้เฉพาะตาราง `chat_histories` สำหรับซิงก์ประวัติแชตของผู้ใช้
- GitHub เชื่อมต่อจาก browser โดยตรงผ่าน GitHub REST API ด้วย Fine-grained Personal Access Token ที่ผู้ใช้กรอกเอง
- การอ่านไฟล์, ค้นหาโค้ด, แก้ไฟล์ และ commit เรียก GitHub API ทันทีใน session เดียว ไม่ผ่าน queue, Edge Function, Actions หรือ agent กลาง
- การแก้ไขจะถูก stage ใน Workspace ของ browser ก่อน ผู้ใช้เห็นรายการไฟล์และ Preview แล้วจึงกดส่งออก/commit หรือสั่ง AI ให้ publish หลังตรวจสอบ
- token GitHub ถูกเก็บใน localStorage ของ browser ตามการตั้งค่าของผู้ใช้ ห้ามนำออกไปใส่ใน repository หรือส่งออกไฟล์ JSON

## Supabase schema ที่จำเป็นสำหรับแชต

รันเฉพาะ `schema.sql` หากต้องการซิงก์ประวัติแชต โดย schema นี้สร้างเพียง `public.chat_histories` และมี RLS แยกตาม `auth.uid()`

ระบบสามารถทำงานแบบ local-only ได้เช่นกัน เพียงไม่ตั้งค่า Supabase URL/anon key

## GitHub setup

1. สร้าง Fine-grained Personal Access Token บน GitHub
2. จำกัด repository ให้เหลือเฉพาะ repository ที่ต้องการ
3. ให้สิทธิ์ `Contents: Read and write` และ `Metadata: Read-only`
4. เปิด NOVA Settings > ข้อมูล > GitHub
5. กรอก token, owner, repository และ branch
6. กดทดสอบการเชื่อมต่อ

ไม่ต้อง deploy Supabase Edge Function และไม่ต้องตั้งค่า `GITHUB_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` หรือ GitHub Actions secret สำหรับการทำงานหลัก

## สิ่งที่ถอดออกจากสถาปัตยกรรมหลัก

ฟีเจอร์ต่อไปนี้ไม่ถูกเรียกจาก `index.html` อีกต่อไป:

- `enqueue_task`
- ตาราง tasks, executions, test_results, commits และ tool_calls
- repository dispatch
- GitHub Actions workflow dispatch และ workflow run polling
- Supabase Edge Function สำหรับ GitHub agent

การอ่านไฟล์จาก GitHub จะดึงสำเนามาไว้ใน Workspace; `github_write_file` แก้เฉพาะสำเนา Preview และ `github_publish_workspace` เท่านั้นที่ส่งไฟล์ไป commit จริง

ไฟล์ legacy ที่เกี่ยวกับ agent queue ถูกนำออกจาก repository เพื่อไม่ให้เกิดความสับสนกับเส้นทาง direct execution

## ความปลอดภัย

Direct browser execution ทำให้ token อยู่ในอุปกรณ์ของผู้ใช้ จึงควรใช้ Fine-grained token, จำกัด repository, ไม่ใช้บนเครื่องสาธารณะ และ revoke token เมื่อเลิกใช้งาน การ commit หรือการเปลี่ยนแปลงบน GitHub เป็นการเปลี่ยนแปลงภายนอกจริง ผู้ใช้ควรตรวจสอบเนื้อหาก่อนสั่งให้ AI เขียนไฟล์

## Social Connections

ส่วน Facebook/TikTok เป็นฟีเจอร์เสริมแยกจาก GitHub direct execution และมีการตั้งค่า OAuth ของตัวเองตาม `SOCIAL_SETUP.md` หากไม่ใช้ฟีเจอร์นี้ ไม่จำเป็นต้อง deploy `social-oauth` หรือรัน `social_schema.sql`
