# PLC POS — ความปลอดภัย ประสิทธิภาพ และการติดตั้งใช้งานจริง

> อัปเดตล่าสุด: 2026-10-27 (เพิ่มหลายบริษัท/SaaS) · คู่กับ [`api-overview.md`](./api-overview.md)

## 1. ตั้งค่าก่อนขึ้น cloud (production)

| ตัวแปร | ค่าแนะนำ | ใช้ทำอะไร |
|---|---|---|
| `NODE_ENV` | `production` | ปิด Swagger อัตโนมัติ (เปิดได้ด้วย `SWAGGER_ENABLED=true`) |
| `JWT_SECRET` | สุ่ม 48 bytes ขึ้นไป (`openssl rand -base64 48`) | ใช้เซ็น token · **ห้ามใช้ค่าตัวอย่าง** |
| `CORS_ORIGINS` | `https://pos.ร้าน.la` | เว็บที่อนุญาตให้เรียก API (คั่นหลายเว็บด้วย `,`) |
| `TRUST_PROXY` | `1` | ใช้เมื่อมี nginx/Caddy/load balancer หน้า API เพื่อให้ได้ IP ลูกค้าที่ถูกต้อง (มีผลกับการจำกัดจำนวนครั้ง) |
| `THROTTLE_LIMIT` | `600` | จำนวน request ต่อนาทีต่อ IP |
| `THROTTLE_AUTH_LIMIT` | `10` | จำนวนครั้งต่อนาทีต่อ IP สำหรับ login, PIN, refresh และอนุมัติ |
| `DATABASE_POOL_MAX` | `10` ต่อ instance | จำนวน connection DB (รวมทุก instance ต้องน้อยกว่า `max_connections`) |
| `DATABASE_STATEMENT_TIMEOUT_MS` | `30000` | SQL ที่รันนานเกินนี้จะถูกยกเลิก |
| `BODY_LIMIT` | `1mb` | ขนาด JSON สูงสุดต่อ request |
| `UPLOAD_DIR` | volume ถาวร เช่น `/data/uploads` | เก็บรูปสินค้า (แยกโฟลเดอร์ตามบริษัท) |
| `DEFAULT_TENANT_CODE` | ว่าง (SaaS) หรือ `plc` (ร้านเดียว) | ล็อกอินโดยไม่ต้องส่งรหัสบริษัท |
| `SIGNUP_ENABLED` | `false` จนพร้อมเปิดขาย | เปิด `POST /api/public/signup` |
| `THROTTLE_SIGNUP_LIMIT` | `3` | จำนวนการสมัครต่อชั่วโมงต่อ IP |
| `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` | อีเมลจริง + รหัสยาว | seed สร้าง platform admin คนแรก (ครั้งเดียว) |
| `SEED_TENANT_CODE` / `SEED_ADMIN_PASSWORD` | `plc` / รหัสยาว | บริษัทและ admin ที่ seed สร้าง |

**ติดตั้งด้วย Docker:** `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build` (PostgreSQL + migrate/seed ครั้งเดียว + API, health check ในตัว) · CI ใน `.github/workflows/ci.yml` ตรวจ migration, format, lint, typecheck, unit, e2e และ build ทุก PR

**รายการตรวจก่อนเปิดใช้:** เปลี่ยนรหัสผ่าน `admin` · ตั้ง PIN ให้ผู้จัดการ · ใช้ HTTPS เท่านั้น · backup DB ทุกวัน (`pg_dump`) และเก็บนอกเครื่อง · ตั้ง uptime monitor ยิง `GET /api/health`

## 2. ความปลอดภัย (มีอยู่ในระบบแล้ว)

| ด้าน | วิธีที่ใช้ |
|---|---|
| แยกข้อมูลบริษัท | ทุก query ถูกกรองด้วย `tenantId` อัตโนมัติ (Prisma extension) และปฏิเสธถ้าไม่รู้บริษัท · raw SQL กรองเอง · DB ปฏิเสธการเขียนที่ไม่มี `tenantId` · id ที่ client ส่งมาถูกตรวจว่าเป็นของบริษัทเดียวกัน · มี e2e ข้ามบริษัท · token ของ platform admin ใช้กับ API ร้านไม่ได้และกลับกัน |
| แพ็กเกจ | บริษัทที่ถูกระงับเข้าไม่ได้ · หมดอายุเกิน 7 วันอ่านได้อย่างเดียว · ฟีเจอร์และ limit ตรวจที่ server |
| ยืนยันตัวตน | JWT อายุ 15 นาที + refresh token แบบหมุนเวียน (ใช้ token เก่าซ้ำ → ออกจากระบบทุกเครื่อง) · เก็บเฉพาะค่า hash ของ token · ลบ token ที่หมดอายุอัตโนมัติ |
| รหัสผ่าน/PIN | argon2 · ล็อกบัญชี 15 นาทีเมื่อผิด 5 ครั้ง · error เหมือนกันทั้งกรณีไม่มีผู้ใช้และรหัสผิด |
| เดารหัส | จำกัด 10 ครั้งต่อนาทีต่อ IP สำหรับ login/PIN/refresh/อนุมัติ และ 600 request ต่อนาทีต่อ IP สำหรับทั้งระบบ (ตอบ `429` พร้อม `Retry-After`) |
| สิทธิ์ | ทุก route ต้องล็อกอิน · ตรวจสิทธิ์รายการต่อรายการ · โหลดสิทธิ์ใหม่ทุก request · ซ่อนต้นทุนถ้าไม่มี `product.viewCost` · approval token ใช้แทน login ไม่ได้ |
| HTTP headers | helmet: HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, Referrer-Policy · ไม่ส่ง `X-Powered-By` |
| CORS | เปิดเฉพาะ origin ที่กำหนด · method และ header ที่อนุญาตกำหนดตายตัว |
| ข้อมูลที่ส่งเข้ามา | ตรวจด้วย zod ทุก route · จำกัด JSON 1 MB · `pageSize` สูงสุด 100 · รูปต้องเป็น JPEG/PNG/WebP จริง (ตรวจจากเนื้อไฟล์) ≤ 5 MB |
| SQL | Prisma และ query แบบมี parameter ทั้งหมด (ไม่มีการต่อ string) · statement timeout |
| ตรวจสอบย้อนหลัง | AuditLog: void, แก้ราคา, ส่วนลด, พิมพ์ซ้ำ, คืนสินค้า, ตั้งค่า, ผู้ใช้, สต็อก ฯลฯ · ไม่บันทึก token ลง log |
| ความถูกต้องของเงินและสต็อก | ใช้ Decimal ไม่ใช้ float · ล็อกแถวสินค้า/บิล (`FOR UPDATE`) กันขาย serial ซ้ำหรือสต็อกติดลบ · ทุกการเปลี่ยนสต็อกอยู่ใน transaction เดียวกับ ledger |

## 3. ประสิทธิภาพ

### สิ่งที่ปรับแล้ว
- **Index 38 ตัว:** foreign key ทุกตัวที่ใช้ join และคอลัมน์ที่กรองบ่อย เช่น `SaleItem.saleId`, `Sale(status, createdAt)` · มีบันทึกใน schema จึงไม่หายตอน migrate
- **ค้นหาข้อความเร็ว (pg_trgm):** ชื่อสินค้า, SKU, barcode, รุ่น, ชื่อลูกค้า, เบอร์โทร
- **รายงานยอดขาย:** join ต้นทุนครั้งเดียวแทนการ query ทีละบิล
- **ตัด query ซ้ำ (N+1):** หนี้ลูกค้าในหน้ารายชื่อ และจำนวนรายการในบิล/ใบรับ/ใบเสนอราคา นับเฉพาะหน้าที่แสดง
- **Cache 10 วินาที:** ค่าตั้งร้าน, อัตราแลกเปลี่ยน และ VAT ค่าเริ่มต้น (ล้างทันทีเมื่อมีการแก้)
- **อื่น ๆ:** gzip, connection pool, statement timeout, แบ่งหน้าทุกรายการ/รายงานที่อาจยาว (สูงสุด 100 แถวต่อหน้า พร้อมยอดรวมทั้งหมด)

### ผลวัด (ข้อมูล: สินค้า 10,000 · ลูกค้า 5,000 · บิล 50,000 · 1 instance บนเครื่อง 4 cores)

ก่อนแก้ = โค้ด commit `7a3eed9` บนฐานข้อมูลเดียวกันโดยไม่มี index ใหม่ · หลังแก้ = โค้ดปัจจุบัน

| Endpoint | ก่อน | หลัง | หลังทำ SaaS (2026-10-27) |
|---|---|---|---|
| รายงานยอดขาย 1 เดือน (รายวัน) | **29,088 ms** | **42 ms** | 67 ms |
| รายงานยอดขาย 1 ปี (รายเดือน) | **> 120,000 ms** (timeout) | **297 ms** | 405 ms |
| รายการบิลขาย (20 รายการ) | 27 req/s · p50 353 ms | 250 req/s · p50 39 ms | 186 req/s · p50 52 ms |
| รายชื่อลูกค้า + ยอดหนี้ | 146 req/s · p50 67 ms | 295 req/s · p50 32 ms | 255 req/s · p50 38 ms |
| ค้นหาลูกค้า | 133 req/s · p50 73 ms | 216 req/s · p50 45 ms | 179 req/s · p50 54 ms |
| ค้นหาสินค้า "model 77" | 150 req/s · p50 65 ms | 251 req/s · p50 38 ms | 202 req/s · p50 48 ms |
| สแกนบาร์โค้ด | 270 req/s · p50 36 ms | 258 req/s · p50 36 ms | 192 req/s · p50 50 ms |
| ค้นหาสินค้า "printer" (ตรง 17% ของสินค้าทั้งหมด) | 121 req/s | 115 req/s | 98 req/s · p99 201 ms |

**หลังทำ SaaS ช้าลงประมาณ 15–30%** ต่อ instance: ส่วนกรอง `tenantId` ใน Prisma แทบไม่มีต้นทุน (วัดได้ ~0.03 ms ต่อ query) แต่ทุก request ทำงานเพิ่ม: โหลดสาขาที่ผู้ใช้เข้าได้, ตรวจสถานะแพ็กเกจ (cache 30 วินาที), แปลชื่อตามภาษา และ request context · ทุก endpoint ยังผ่านเป้า < 300 ms ต่อการสแกน/ค้นหา และเพิ่ม instance ได้เมื่อมีหลายบริษัท

ทั้งหมดผ่านเป้า < 300 ms ต่อการสแกนหรือค้นหา (p99 ที่ 10 connection พร้อมกันยังต่ำกว่า 180 ms) · วัดซ้ำได้ด้วย `scripts/bench/run.sh`

### เมื่อร้านโตขึ้น
- **หลาย instance:** API ไม่เก็บ state (stateless) จึงรันหลายตัวหลัง load balancer ได้
- **cache 10 วินาที:** ค่าที่แก้บน instance หนึ่งจะเห็นบน instance อื่นภายใน 10 วินาที
- **ตัวนับ rate limit:** เก็บในหน่วยความจำของแต่ละ instance ถ้าต้องการนับรวมทุก instance ให้เปลี่ยน storage ของ throttler เป็น Redis
- **รูปสินค้า:** ถ้ามีหลาย instance ให้ใช้ volume ร่วมกัน หรือย้ายไป object storage
- **PostgreSQL:** เปิด `pg_stat_statements` เพื่อหา query ช้า

## 4. การทดสอบ
- `pnpm test`: 58 unit test
- `pnpm test:e2e`: 118 API test รวมชุดความปลอดภัย (headers, CORS, body limit, gzip, page cap, rate limit) และชุดหลายบริษัท (แยกข้อมูล, สาขา, แพ็กเกจ, ระงับบัญชี, สมัครเอง)
- `scripts/bench/run.sh`: วัดประสิทธิภาพ (ดูวิธีเตรียมข้อมูลที่หัวไฟล์)
