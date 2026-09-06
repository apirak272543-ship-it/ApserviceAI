# GitHub Agent via Supabase Edge Function

ฟังก์ชัน `github-agent` ใช้ Supabase Auth เป็นตัวล็อกอิน และใช้ GitHub token ที่เก็บเป็น Supabase Secret เพื่ออ่าน/ค้นหา/แก้ไขไฟล์ และสั่ง GitHub Actions

## Secrets ที่ต้องมีใน Supabase

- `GITHUB_TOKEN`: Fine-grained token จำกัดเฉพาะรีโพสิทอรีที่ต้องการ โดยต้องมี Contents: Read and write, Metadata: Read-only และ Actions: Read and write เพื่อส่ง `repository_dispatch`
- `SUPABASE_SERVICE_ROLE_KEY`: ใช้ภายใน Edge Function เท่านั้น ห้ามใส่ในหน้าเว็บหรือ APK

## Deploy Function

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set GITHUB_TOKEN=YOUR_GITHUB_TOKEN SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
supabase functions deploy github-agent --no-verify-jwt
```

ฟังก์ชันตรวจสอบ Supabase JWT ภายในโค้ดเอง จึงใช้ `--no-verify-jwt` เพื่อให้ส่ง Authorization header เข้า function ได้

## ส่งงานทันที

หน้า NOVA และ APK เรียก action `enqueue_task` ไปยัง Edge Function ฟังก์ชันจะบันทึกงานลง `tasks` แล้วส่ง GitHub `repository_dispatch` event ชื่อ `nova_task` ทำให้ Workflow เริ่มทันที ไม่ต้องรอ cron 5 นาที

```json
{
  "owner": "apirak272543-ship-it",
  "repo": "ApserviceAI",
  "branch": "main",
  "action": "enqueue_task",
  "title": "ตรวจสอบโปรเจกต์",
  "prompt": "อ่านและตรวจสอบโปรเจกต์ โดยไม่ลบข้อมูล"
}
```

## Actions ที่รองรับ

- `enqueue_task`
- `list_files`
- `read_file`
- `search_code`
- `write_file`
- `run_workflow`
- `runs`
- `codespace_status`
- `codespace_start`
- `codespace_stop`

`write_file` จะอัปเดตไฟล์บน branch ที่ระบุโดยตรง และควรใช้ branch แยกสำหรับงานจริง
