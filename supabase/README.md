# GitHub Agent via Supabase Edge Function

ฟังก์ชัน `github-agent` ใช้ Supabase Auth เป็นตัวล็อกอิน และใช้ GitHub token ที่เก็บเป็น Supabase Secret เพื่ออ่าน/ค้นหา/แก้ไขไฟล์ และสั่ง GitHub Actions

## 1. สร้าง GitHub token

สร้าง Fine-grained Personal Access Token โดยจำกัดเฉพาะรีโพสิทอรีที่ต้องการ เช่น `ApserviceAI` และกำหนดสิทธิ์ขั้นต่ำ:

- Contents: Read and write
- Metadata: Read-only
- Actions: Read-only (และ Actions: write เฉพาะเมื่อจำเป็นต้อง dispatch workflow)

อย่าใส่ token ใน `index.html` และอย่า commit ลง GitHub

## 2. Deploy Function

ติดตั้ง Supabase CLI แล้วล็อกอิน จากนั้นรันจาก root ของรีโพสิทอรี:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set GITHUB_TOKEN=YOUR_GITHUB_TOKEN
supabase functions deploy github-agent --no-verify-jwt
```

ฟังก์ชันตรวจสอบ Supabase JWT ภายในโค้ดเอง จึงใช้ `--no-verify-jwt` เพื่อให้ส่ง Authorization header เข้า function ได้

## 3. สิ่งที่ทำได้

ส่ง POST ไปยัง:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/github-agent
```

พร้อม header:

```text
Authorization: Bearer SUPABASE_ACCESS_TOKEN
Content-Type: application/json
```

ตัวอย่าง body:

```json
{
  "owner": "apirak272543-ship-it",
  "repo": "ApserviceAI",
  "branch": "main",
  "action": "read_file",
  "path": "index.html"
}
```

รองรับ action:

- `list_files`
- `read_file`
- `search_code`
- `write_file`
- `run_workflow`
- `runs`

`write_file` จะอัปเดตไฟล์บน branch ที่ระบุโดยตรง และควรใช้ branch แยกสำหรับงานจริง

## 4. Database/Auth

รัน `schema.sql` ใน Supabase SQL Editor ก่อนใช้ประวัติแชต จากนั้นสร้างผู้ใช้ในหน้า NOVA Chat และเข้าสู่ระบบ

## หมายเหตุ

GitHub token ต้องเก็บใน Supabase Secrets เท่านั้น การเปิดฟังก์ชันโดยไม่ตั้ง `GITHUB_TOKEN` จะตอบข้อผิดพลาดทันทีและไม่ทำการเปลี่ยนแปลงใด ๆ
