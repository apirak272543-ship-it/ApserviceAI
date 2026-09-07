# Social Connections setup

ระบบรุ่นแรกนี้รองรับการเชื่อมต่อ **Facebook Page** และ **TikTok** แบบ OAuth, เก็บ access/refresh token เป็น ciphertext ฝั่ง Supabase Edge Function และสร้าง Content Draft พร้อม Preview เท่านั้น ยังไม่มี endpoint สำหรับเผยแพร่โพสต์จริง

## 1. ใช้ schema

รันไฟล์ `schema.sql`, `agent_schema.sql` และ `social_schema.sql` ใน Supabase SQL Editor ตามลำดับ

`social_schema.sql` สร้างตาราง `social_connections`, `social_oauth_states` และ `content_drafts` พร้อม RLS และ view ที่ไม่เปิดเผยคอลัมน์ token ให้ client

## 2. ตั้งค่า Provider Apps

### Meta

สร้าง Meta App และตั้งค่า Facebook Login จากนั้นเพิ่ม redirect URL นี้ใน OAuth settings:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/social-oauth?action=callback&provider=facebook
```

ต้องขอสิทธิ์ที่จำเป็นสำหรับ Facebook Page เช่น `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` และ `pages_manage_engagement` ตาม use case และ App Review ของ Meta

### TikTok

สร้าง TikTok Developer App, เพิ่ม Content Posting API และตั้งค่า redirect URL:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/social-oauth?action=callback&provider=tiktok
```

ต้องขอ `user.info.basic` และ `video.publish`; TikTok ระบุว่า client ที่ยังไม่ผ่าน audit จะถูกจำกัดการมองเห็นโพสต์ตามนโยบายของ TikTok

## 3. สร้าง encryption key

สร้างคีย์สุ่ม 32 ไบต์แล้ว encode เป็น base64 ตัวอย่าง:

```bash
openssl rand -base64 32
```

เก็บค่าใน Supabase secrets เท่านั้น ห้ามใส่ใน HTML, Git หรือ issue:

```bash
supabase secrets set \
  META_APP_ID="..." \
  META_APP_SECRET="..." \
  TIKTOK_CLIENT_KEY="..." \
  TIKTOK_CLIENT_SECRET="..." \
  SOCIAL_TOKEN_ENCRYPTION_KEY="..." \
  SOCIAL_APP_URL="https://YOUR_PUBLIC_SITE/index.html"
```

Supabase จะมี `SUPABASE_URL`, `SUPABASE_ANON_KEY` และ `SUPABASE_SERVICE_ROLE_KEY` ให้ Edge Function ตามระบบของโปรเจกต์อยู่แล้ว ไม่ควรเขียนค่าเหล่านี้ลง source

## 4. Deploy

```bash
supabase functions deploy social-oauth
```

ถ้าใช้ dashboard ให้สร้าง Edge Function ชื่อ `social-oauth`, วาง `supabase/functions/social-oauth/index.ts` และเพิ่ม secrets ชุดเดียวกัน

## 5. การทำงานของหน้าเว็บ

1. ผู้ใช้ตั้งค่า Supabase URL และ anon key ใน NOVA แล้วปลดล็อกด้วย PIN
2. เปิด **การตั้งค่า → โซเชียลและคอนเทนต์**
3. กดเชื่อมต่อ Facebook หรือ TikTok; หน้าเว็บเรียก Edge Function พร้อม Supabase access token
4. Edge Function สร้าง OAuth state แบบสุ่มและเก็บเฉพาะ hash ของ state
5. Provider redirect กลับไปที่ callback; function แลก code และเข้ารหัส token ด้วย AES-GCM ก่อนเก็บ
6. หน้าเว็บแสดงเฉพาะชื่อบัญชี, provider, scopes และวันหมดอายุ token
7. ผู้ใช้สร้าง Draft, เลือกแพลตฟอร์ม และตรวจ Preview ก่อนบันทึก

## ข้อควรทำก่อนเพิ่มการโพสต์จริง

เพิ่มขั้นตอน explicit approval, ตรวจสิทธิ์/อายุ token, จำกัดชนิดและขนาดสื่อ, idempotency key, audit log, rate-limit และระบบ queue แยกต่างหากก่อนเปิดการเผยแพร่จริง ห้ามนำ ciphertext หรือ token ใด ๆ ไปใส่ใน `localStorage` หรือส่งกลับหน้าเว็บ

เอกสารอ้างอิง: [Meta Pages API Posts](https://developers.facebook.com/documentation/pages-api/posts), [TikTok Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started)
