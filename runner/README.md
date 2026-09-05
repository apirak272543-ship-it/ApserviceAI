# NOVA Agent Runner

Runner นี้คือเครื่องยนต์ที่รับ task จาก Supabase แล้วให้ Gemini ใช้เครื่องมือใน workspace เช่น อ่าน/เขียน/ลบไฟล์ ค้นหาโค้ด รันคำสั่ง Git และ push การเปลี่ยนแปลง

## ตั้งค่าใน Codespaces

```bash
cd /workspaces/ApserviceAI
python3 -m venv .venv
source .venv/bin/activate
pip install -r runner/requirements.txt
export SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="YOUR_SUPABASE_SERVICE_ROLE_KEY"
export GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
export WORKSPACE="/workspaces/ApserviceAI"
# ตั้งค่าเฉพาะเมื่อ Runner นี้อยู่ใน Codespace และต้องการให้หยุดเองหลังคิวว่าง
export AUTO_STOP_CODESPACE="true"
export CODESPACE_NAME="YOUR_CODESPACE_NAME"
export GITHUB_TOKEN="YOUR_CODESPACE_TOKEN"
python runner/agent_runner.py
```

เก็บค่าเหล่านี้ไว้ใน Codespaces Secrets หรือ environment ของ Codespace เท่านั้น ห้าม commit ลง GitHub:

- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`

Runner ใช้ Supabase service-role key ฝั่งเครื่อง runner เพื่อรับงานจาก queue และเขียน log; หน้าเว็บไม่เคยเห็น key นี้

## สร้างงานทดสอบ

หลังรัน `agent_schema.sql` และเข้าสู่ระบบ NOVA แล้ว ให้สร้าง task ในตาราง `tasks` หรือเพิ่มหน้า task UI ใน NOVA โดยมีข้อมูลอย่างน้อย:

```json
{
  "user_id": "YOUR_AUTH_USER_UUID",
  "title": "ตรวจสอบและแก้ UI",
  "prompt": "อ่านโค้ดหน้าเว็บ ตรวจสอบปัญหา responsive แล้วแก้ พร้อมรัน test หรือ build ที่มีอยู่",
  "repo_owner": "apirak272543-ship-it",
  "repo_name": "ApserviceAI",
  "repo_branch": "main",
  "status": "queued"
}
```

Runner จะรับ task ที่มี `status=queued`, เปลี่ยนเป็น `running`, เรียก Gemini ให้เลือก tools, บันทึก `tool_calls`, แล้วจบเป็น `completed` หรือ `failed`

เมื่อเปิด `AUTO_STOP_CODESPACE=true` Runner จะตรวจว่าคิวไม่มีงาน `queued` หลังจบงาน แล้วเรียก GitHub Codespaces API เพื่อหยุด Codespace อัตโนมัติ การเปิดครั้งถัดไปต้องมีตัวเริ่ม Runner อัตโนมัติใน Codespace หรือผู้ใช้กดเปิดแล้วรัน Runner อีกครั้ง

## Tools ที่มี

- `read_file`
- `write_file`
- `delete_file`
- `search_code`
- `run_command`
- `git_status`
- `git_diff`
- `git_commit`
- `git_push`

เพื่อให้ push ได้ ให้ Codespace มี Git credential ที่อนุญาตรีโพสิทอรีนั้นแล้ว
