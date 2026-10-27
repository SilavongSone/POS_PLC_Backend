# PLC POS — ออกแบบ SaaS: หลายบริษัท · หลายสาขา · แพ็กเกจ · หลายภาษา

> สถานะ: **ทำครบแล้ว (S1–S7)** · อัปเดตล่าสุด: 2026-10-27 · โค้ดหลักอยู่ที่ `src/tenancy`, `src/platform`, `src/branches`, `src/i18n`, `src/prisma/tenant-extension.ts`
> เอกสารนี้ต่อยอดจาก [`database-design.md`](./database-design.md) (โครงสร้างร้านเดียว) และ [`operations.md`](./operations.md)

## 1. เป้าหมาย

- **ให้เช่าระบบ (SaaS):** บริษัทอื่นสมัครแล้วใช้ระบบเดียวกันได้ โดยข้อมูลของแต่ละบริษัทแยกขาดจากกันทั้งหมด
- **หลายสาขา:** แต่ละบริษัทมีได้หลายสาขา สต็อกแยกตามสาขา และโอนสินค้าข้ามสาขาได้
- **แพ็กเกจ:** มีแพ็กเกจให้เลือก เจ้าของแพลตฟอร์ม (เรา) แก้ราคา, ข้อจำกัด และฟีเจอร์ของแต่ละแพ็กเกจได้ตลอดเวลา และปรับเฉพาะบางบริษัทได้ด้วย
- **หลายภาษา:** ลาว (หลัก), ไทย, อังกฤษ ทั้งข้อความ error, ชื่อสินค้า/หมวดหมู่, ใบเสร็จ และจำนวนเงินเป็นตัวอักษร

## 2. คำศัพท์และบทบาท

| คำ | ความหมาย |
|---|---|
| **Platform** | ตัวระบบทั้งหมด ซึ่งเราเป็นเจ้าของ |
| **Platform admin** | ทีมของเรา: จัดการแพ็กเกจ, บริษัทลูกค้า และการสมัครใช้ · ล็อกอินแยกจากพนักงานร้าน |
| **Tenant (บริษัท/ร้าน)** | ลูกค้าที่เช่าระบบ แต่ละรายมีรหัสบริษัท (`code`) เช่น `plc`, `abc-shop` |
| **Branch (สาขา)** | สาขาของ tenant · เครื่องขาย, กะ, บิล และสต็อก ผูกกับสาขา |
| **Plan (แพ็กเกจ)** | ชุดราคา + ข้อจำกัด (limits) + ฟีเจอร์ (features) |
| **Subscription** | การสมัครใช้แพ็กเกจของ tenant: สถานะ, วันหมดอายุ และการปรับเฉพาะราย (overrides) |

ร้าน PLC เดิมจะกลายเป็น tenant แรก (`code = plc`) ที่มีสาขา `MAIN` · migration ย้ายข้อมูลเดิมทั้งหมดเข้า tenant นี้โดยข้อมูลไม่หาย

## 3. การแยกข้อมูลของแต่ละบริษัท (Tenant isolation)

**รูปแบบที่เลือก:** ฐานข้อมูลเดียว + คอลัมน์ `tenantId` (shared database, shared schema)

| ทางเลือก | ข้อดี | ข้อเสีย | ผล |
|---|---|---|---|
| DB แยกต่อบริษัท | แยกขาดที่สุด | ค่า cloud สูง, migrate/backup ทีละ DB, เปิดบริษัทใหม่ช้า | ไม่เลือก |
| Schema แยกต่อบริษัท | แยกดี | Prisma รองรับไม่ดี, migration ซับซ้อน | ไม่เลือก |
| **`tenantId` ทุกตาราง** | ต้นทุนต่ำ, เปิดบริษัทใหม่ทันที, ขยายง่าย | ต้องคุมให้ทุก query กรอง tenant | **เลือก** + ป้องกัน 4 ชั้นด้านล่าง |

**การป้องกัน 6 ชั้น**
1. **Tenant context:** หลังตรวจ token แล้ว ระบบเก็บ `tenantId` ไว้ใน `AsyncLocalStorage` ประจำ request ทำให้ทุก service รู้ว่ากำลังทำงานให้บริษัทไหน
2. **Prisma extension (กรองอัตโนมัติ):** ทุก query ของตารางที่เป็นของ tenant จะถูกเติม `tenantId` ให้อัตโนมัติ ทั้ง `where` (อ่าน, แก้, ลบ, นับ) และ `data` (สร้าง) · **ถ้าไม่มี tenant context ระบบจะปฏิเสธ query** (fail closed) ยกเว้นงานของ platform ที่เรียกผ่าน `RequestContext.asPlatform()` อย่างชัดเจน · create ที่ซ้อนกัน (nested create) ก็ถูกเติม `tenantId` ด้วย
3. **ตารางลูก:** เช่น รายการในบิล, การชำระเงิน, รายการในใบรับสินค้า ไม่มี `tenantId` ของตัวเอง แต่เข้าถึงผ่านแม่ที่กรอง tenant แล้วเท่านั้น
4. **Raw SQL:** รายงาน, ล็อกแถว และเลขเอกสาร ใส่เงื่อนไข `"tenantId" = $tenant` ด้วยมือทุก query และมี e2e test ยืนยัน · **มีชุด test "cross-tenant"** ที่สร้าง 2 บริษัทแล้วพยายามอ่าน/แก้ข้อมูลข้ามกันทุก endpoint หลัก (`test/saas.e2e-spec.ts`)
5. **ฐานข้อมูล:** ค่าเริ่มต้นของคอลัมน์ `tenantId` คือ `current_setting('app.tenant_id')` ซึ่งปกติว่าง → ถ้ามีโค้ดไหนลืมใส่ `tenantId` การเขียนจะล้มด้วย NOT NULL แทนที่จะเข้าไปผิดบริษัท
6. **ID ที่ client ส่งมา:** ทุก id ที่อ้างถึงแถวอื่น (ลูกค้า, สินค้า, กลุ่ม, สาขา, ประเภทชำระ ฯลฯ) ถูกค้นผ่าน query ที่กรอง tenant ก่อนใช้ จึงอ้างถึงข้อมูลของบริษัทอื่นไม่ได้ (ได้ 404)

**ค่าที่เคยไม่ซ้ำทั้งระบบ จะเปลี่ยนเป็นไม่ซ้ำภายในบริษัท:** SKU, barcode, serial, username, รหัสลูกค้า, เบอร์โทรลูกค้า, เลขเอกสารทุกชนิด, ชื่อกลุ่มผู้ใช้/ประเภทชำระ/VAT/หมวดหมู่/แบรนด์, รหัสเครื่องขาย

**การล็อกอิน:** พนักงานใส่ **รหัสบริษัท + username + รหัสผ่าน/PIN** · JWT มี `tid` (tenant) · refresh token ผูกกับผู้ใช้ จึงผูกกับ tenant ไปด้วย

## 4. หลายสาขา

| เรื่อง | การออกแบบ |
|---|---|
| ตาราง | `Branch` (code, ชื่อ, ที่อยู่, เบอร์โทร, หัวใบเสร็จของสาขา, isActive) |
| เครื่องขาย/กะ/บิล | `Register.branchId` · บิล (`Sale`) บันทึก `branchId` จากเครื่องขาย |
| สต็อก | `BranchStock (branchId, productId, qty)` คือยอดจริงของแต่ละสาขา · `Product.stockQty` = ยอดรวมทุกสาขา (อัปเดตใน transaction เดียวกัน) · `StockMovement.branchId` · serial และล็อตมี `branchId` บอกว่าอยู่สาขาไหน |
| โอนสินค้า | เอกสารใหม่ `TRANSFER` (จากสาขา → ไปสาขา): ออกจากต้นทาง (`TRANSFER_OUT`) และเข้าปลายทาง (`TRANSFER_IN`) ใน transaction เดียว · serial ย้ายสาขา · ล็อตไปพร้อมวันหมดอายุเดิม · ต้นทุนเฉลี่ยไม่เปลี่ยน |
| สิทธิ์ตามสาขา | `UserBranch`: ผู้ใช้ที่ไม่มีรายการ = เข้าได้ทุกสาขา · ถ้ากำหนดไว้ = เปิดกะ/ขาย/รับสินค้าได้เฉพาะสาขานั้น |
| ขายข้ามสาขา | ขายได้เฉพาะของที่อยู่ในสาขาของเครื่องขาย (serial ต้องอยู่สาขานั้น) |
| รายงาน | ทุกรายงานกรอง `?branchId=` ได้ · ค่าเริ่มต้นคือรวมทุกสาขาที่ผู้ใช้มีสิทธิ์ |
| สินค้า, ลูกค้า, ราคา | ใช้ร่วมกันทั้งบริษัท |

## 5. แพ็กเกจและการสมัครใช้

### 5.1 Plan (แก้ได้โดย platform admin)
```
Plan { code, nameI18n {lo,th,en}, descriptionI18n, priceMonthlyLak, priceYearlyLak,
       limits { maxBranches, maxRegisters, maxUsers, maxProducts, maxSalesPerMonth },   // null = ไม่จำกัด
       features [ ... ],  trialDays, isPublic, isActive, sortOrder }
```

**ฟีเจอร์ที่เปิด/ปิดได้ (feature flags)**

| key | เปิดอะไร |
|---|---|
| `multiCurrency` | รับ THB/USD, ราคาสินค้าเป็น USD/THB |
| `creditSales` | ขายเชื่อ + ชำระหนี้ |
| `promotions` | โปรโมชั่น |
| `bundles` | ชุดสินค้า |
| `quotations` | ใบเสนอราคา |
| `repairs` | ระบบซ่อม/เคลม |
| `taxInvoices` | ใบกำกับภาษี |
| `expenses` | รายจ่าย |
| `lots` | สินค้ามีวันหมดอายุ (ล็อต) |
| `stockTransfers` | โอนสินค้าข้ามสาขา |
| `advancedReports` | กำไร, สินค้าขายดี, ลูกหนี้ตามอายุหนี้, มูลค่าสต็อก |
| `auditLog` | ดูประวัติการทำงาน (audit log) |

**แพ็กเกจเริ่มต้น** (ราคาตัวอย่าง แก้ได้)

| | Free | Starter | Business | Enterprise |
|---|---|---|---|---|
| ราคา/เดือน | 0 | 199,000 ₭ | 499,000 ₭ | 1,490,000 ₭ |
| สาขา / เครื่องขาย / ผู้ใช้ | 1 / 1 / 2 | 1 / 2 / 5 | 3 / 6 / 20 | ไม่จำกัด |
| สินค้า | 200 | 2,000 | 20,000 | ไม่จำกัด |
| บิล/เดือน | 300 | ไม่จำกัด | ไม่จำกัด | ไม่จำกัด |
| ฟีเจอร์ | พื้นฐาน | + multiCurrency, creditSales, expenses, taxInvoices | + promotions, bundles, quotations, repairs, lots, stockTransfers, advancedReports | ทั้งหมด + auditLog |

### 5.2 Subscription
```
Subscription { tenantId, planId, status, trialEndsAt, currentPeriodEnd,
               overrides { limits?, featuresAdd?, featuresRemove? }, note }
status: TRIAL | ACTIVE | PAST_DUE | SUSPENDED | CANCELLED
```
- **สิทธิ์ที่ใช้งานจริง (entitlements)** = plan + overrides เฉพาะบริษัท · cache ไว้ 30 วินาที และล้างทันทีเมื่อแก้
- **บังคับใช้:**
  - `@RequireFeature('repairs')` ที่ controller → ถ้าไม่มีฟีเจอร์ตอบ `403 FEATURE_NOT_IN_PLAN`
  - limit ตรวจตอนสร้าง (สาขา, เครื่องขาย, ผู้ใช้, สินค้า, บิลต่อเดือน) → เกินตอบ `403 PLAN_LIMIT_REACHED` พร้อม `limit` และ `used`
- **หมดอายุ:**
  - trial หมด หรือเลย `currentPeriodEnd` → ยังใช้ได้อีก 7 วัน (grace period)
  - หลังจากนั้นเป็น **อ่านอย่างเดียว**: GET ได้, เขียนไม่ได้ (`402 SUBSCRIPTION_INACTIVE`)
  - `SUSPENDED` / `CANCELLED` → ล็อกอินไม่ได้ (`403 TENANT_SUSPENDED`)
- **ผู้ดูแลของบริษัทดูได้เอง:** `GET /subscription` แสดงแพ็กเกจ, สถานะ, ฟีเจอร์ และการใช้งานเทียบกับ limit
- การเก็บเงินค่าแพ็กเกจยังทำนอกระบบ: platform admin เป็นคนต่ออายุ (`currentPeriodEnd`) ระบบจ่ายเงินออนไลน์จะทำภายหลัง

### 5.3 Platform admin API (`/api/platform/*`, ล็อกอินแยก)
- `POST /platform/auth/login`: token ชนิด `platform` ใช้กับ API ร้านไม่ได้ และกลับกันก็ใช้ไม่ได้
- `/platform/plans`: CRUD แพ็กเกจ, แก้ราคา, limits และ features
- `/platform/tenants`:
  - สร้างบริษัท (พร้อม owner, สาขาแรก, เครื่องขาย และข้อมูลเริ่มต้น)
  - ค้นหา, ดูการใช้งาน
  - เปลี่ยนแพ็กเกจ/สถานะ/วันหมดอายุ/overrides
  - ระงับ/เปิด
- `/platform/stats`: จำนวนบริษัทตามแพ็กเกจ/สถานะ, รายได้ต่อเดือน (MRR)
- ทุกการกระทำบันทึกลง AuditLog (`tenantId` = บริษัทที่ถูกแก้)

### 5.4 สมัครใช้เอง (เปิด/ปิดได้ด้วย `SIGNUP_ENABLED`)
- `GET /public/plans`: แพ็กเกจที่เปิดให้เห็น
- `POST /public/signup`: สร้างบริษัทแบบ TRIAL ตาม `trialDays` ของแพ็กเกจ · จำกัด 3 ครั้งต่อชั่วโมงต่อ IP

## 6. หลายภาษา (i18n)

| เรื่อง | วิธีทำ |
|---|---|
| ภาษา | `lo` (ค่าเริ่มต้น), `th`, `en` |
| เลือกภาษาต่อ request | `?lang=` → ภาษาที่ผู้ใช้ตั้งไว้ (`User.language`) → `Accept-Language` → ภาษาเริ่มต้นของบริษัท (`app.defaultLanguage`) |
| ข้อความ error | ทุก error มี `code` (ไม่เปลี่ยนตามภาษา) + `message` ตามภาษาที่เลือก + `params` · ข้อความแปลอยู่ใน `src/i18n/messages/{lo,th,en}.ts` |
| validation (zod) | แปลตามชนิดของปัญหา (`too_small`, `invalid_type` ฯลฯ) |
| ข้อมูลหลายภาษา | `nameI18n` / `descriptionI18n` (`{lo, th, en}`) ใน Category, Product, PaymentType, ExpenseCategory, Promotion, Plan · response ส่ง `name` ตามภาษาที่เลือก (ถ้าไม่มีใช้ `name` หลัก) และส่ง `nameI18n` มาด้วยสำหรับหน้าแก้ไข |
| ใบเสร็จ/ใบกำกับ/ใบเสนอราคา | ชื่อสินค้าตามภาษาที่ขอ · จำนวนเงินเป็นตัวอักษรทั้ง 3 ภาษา (ລາວ / ไทย / English) |

## 7. ปรับปรุงเพิ่มเติม (ทำพร้อมกัน)
- **Idempotency-Key** สำหรับ `POST /sales`, `/debt-payments`, `/sales/:id/returns`: ถ้าเน็ตหลุดแล้วกดส่งซ้ำ จะไม่เกิดบิลซ้ำ
- **`X-Request-Id`** ในทุก response และใน log ใช้ตามหาปัญหา
- **`GET /audit-logs`** สำหรับผู้ดูแลของบริษัท (ฟีเจอร์ `auditLog`)
- **CI (GitHub Actions):** lint, build, unit และ e2e บน PostgreSQL ทุก push
- **Dockerfile สำหรับ production** และ `docker-compose.prod.yml`

## 8. ขอบเขตที่ยังไม่ทำ (บันทึกไว้)
- ~~จ่ายค่าแพ็กเกจออนไลน์~~ และ ~~ราคาสินค้าแยกตามสาขา~~ → ทำในรอบที่ 2 (§11)
- **สกุลเงินหลักอื่นนอกจาก LAK:** ไม่ทำ · ทุกยอดเงินในระบบเก็บเป็น `*Lak` (ใบเสร็จ, รายงาน, ต้นทุน, หนี้) การเปลี่ยนสกุลหลักต่อบริษัทต้องแก้ทุกตาราง/รายงาน ขณะที่ลูกค้าเป้าหมายคือร้านในลาว · ขายเป็น THB/USD ได้อยู่แล้วผ่านราคาสินค้าและการรับเงินหลายสกุล
- **Row-Level Security ของ PostgreSQL:** ยังไม่เปิด · RLS ต้องตั้ง `app.tenant_id` ในทุก transaction ของ connection pool ทำให้ทุก query ต้องห่อเป็น transaction (+2 round trip ต่อ query · ยังไม่ได้วัด แต่ query สั้นซึ่งเป็นส่วนใหญ่ของ API จะช้าลงชัดเจน) · ตอนนี้มีการป้องกัน 6 ชั้น (§3) และ test ข้ามบริษัท · ถ้าวันหนึ่งต้องผ่าน audit ที่บังคับ RLS ให้ทำพร้อมแยก DB role ของ API ออกจากเจ้าของตาราง
- **ESC/POS ที่ server:** ไม่ทำ · เครื่องพิมพ์ใบเสร็จส่วนใหญ่ไม่มีตัวอักษรลาวใน code page ต้องพิมพ์เป็นรูป (raster) ซึ่งต้องใช้ฟอนต์ลาวตอนวาด → ให้ frontend วาดใบเสร็จ (มีฟอนต์ลาวอยู่แล้ว) แล้วพิมพ์ผ่าน browser / print bridge ในร้าน · ลิ้นชักเงินเปิดผ่าน driver ของเครื่องพิมพ์ ("open cash drawer before printing")

## 9. รายละเอียดที่ตัดสินใจระหว่างพัฒนา
- **ID ของข้อมูลเดิม:** migration ย้ายข้อมูลเดิมเข้า tenant `tenant_plc` (รหัส `plc`), สาขา `branch_plc_main` (รหัส `MAIN`), แพ็กเกจ Enterprise สถานะ ACTIVE ไม่มีวันหมดอายุ · `BranchStock` เติมจาก `Product.stockQty`
- **ติดตั้งแบบบริษัทเดียว:** ตั้ง `DEFAULT_TENANT_CODE=plc` แล้ว login ไม่ต้องส่ง `tenantCode`
- **เลือกสาขาอัตโนมัติ:** งานหลังร้าน (ใบรับ/เบิก/ปรับ/โอน, ใบซ่อม, เครื่องขาย) ส่ง `branchId` หรือไม่ส่งก็ได้ถ้าผู้ใช้เข้าได้สาขาเดียว · ถ้ามีหลายสาขาแล้วไม่ส่ง → `400 BRANCH_REQUIRED`
- **บิลขาย** ใช้สาขาของเครื่องขาย · **คืนสินค้า/ยกเลิกบิล** คืนสต็อกเข้าสาขาที่ขาย · **ชำระหนี้** บันทึกสาขาของกะที่รับเงิน
- **`StockMovement.balanceAfter`** = ยอดคงเหลือของ **สาขา** หลังเคลื่อนไหว (`Product.stockQty` = รวมทุกสาขา)
- **ยกเลิกใบโอนที่ post แล้ว** = โอนกลับ ต้องมีของเหลือที่สาขาปลายทาง
- **limit ตรวจตอนสร้าง/เปิดใช้งานใหม่** (สาขา, เครื่องขาย, ผู้ใช้, สินค้า, บิลต่อเดือน) · ของที่มีอยู่แล้วเกิน limit หลังลดแพ็กเกจยังใช้ได้ แต่สร้างเพิ่มไม่ได้
- **cache:** ค่าตั้งร้าน/อัตราแลกเปลี่ยน/VAT แยกต่อบริษัท · entitlements cache 30 วินาที ล้างทันทีเมื่อ platform แก้
- **รูปสินค้าใหม่** เก็บใน `uploads/products/<tenantId>/`
- **บั๊กที่พบและแก้:** zod 4 ใส่ค่า default ใน `.partial()` ทำให้ PATCH รีเซ็ตฟิลด์ที่ไม่ได้ส่ง (เช่น `isActive`) → ใช้ `patchOf()` สำหรับ schema แก้ไขทุกตัว

## 10. ลำดับการพัฒนา (ทำครบแล้ว)
| # | งาน |
|---|---|
| S1 | Schema: Tenant, Branch, BranchStock, UserBranch, Plan, Subscription, PlatformAdmin, IdempotencyKey + `tenantId`/`branchId` + unique ภายในบริษัท + migration ย้ายข้อมูลเดิมเข้า tenant `plc` |
| S2 | Tenant context + Prisma extension (fail closed) + ล็อกอินด้วยรหัสบริษัท + แก้ raw SQL |
| S3 | สต็อกแยกสาขา + โอนสินค้า + ขาย/คืน/ซ่อมตามสาขา + สิทธิ์ตามสาขา |
| S4 | แพ็กเกจ, subscription, ฟีเจอร์/limit guard, platform admin API, สมัครใช้เอง, ระบบตั้งค่าเริ่มต้นของบริษัทใหม่ |
| S5 | หลายภาษา: error codes, validation, ข้อมูลหลายภาษา, จำนวนเงินเป็นตัวอักษร 3 ภาษา |
| S6 | Idempotency, request id, audit-log API, CI, Docker |
| S7 | ชุด test cross-tenant, เอกสาร และวัดประสิทธิภาพซ้ำ |

## 11. รอบที่ 2 (2026-10-28): ยืนยันอีเมล, Google, ราคาตามสาขา, จ่ายค่าแพ็กเกจ

### 11.1 ส่งอีเมล
- `MAIL_TRANSPORT=smtp` (production) ใช้ได้กับ Gmail (`smtp.gmail.com:465` + App Password), Google Workspace, SES ฯลฯ · `log` (dev: เขียนลง log) · `memory` (test)
- ข้อความ 3 ภาษาตามภาษาของ request · ลิงก์ในอีเมลชี้ไปหน้าเว็บ `APP_URL`
- เก็บเฉพาะค่า hash ของรหัส/โทเค็น · รหัสยืนยันมีอายุจำกัดและลองผิดได้ไม่เกิน 5 ครั้ง

### 11.2 สมัครร้านใหม่ = ต้องยืนยันอีเมลก่อน
1. `POST /public/signup` → ตรวจรหัสบริษัท/แพ็กเกจ → เก็บคำขอ (`SignupRequest`, รหัสผ่านเก็บเป็น hash) → ส่ง **รหัส 6 หลัก + ลิงก์** ไปอีเมล (อายุ 30 นาที) → ตอบ `{ requestId }` · **ยังไม่สร้างบริษัท**
2. `POST /public/signup/verify { requestId, code }` → สร้างบริษัท + เจ้าของ (อีเมลยืนยันแล้ว) → ได้ token เข้าใช้ทันที
3. `POST /public/signup/resend { requestId }` (จำกัดความถี่)
- **สมัครด้วย Google:** `POST /public/signup/google { idToken, code, name, planCode }` → Google ยืนยันอีเมลให้แล้ว จึงสร้างบริษัททันที เจ้าของผูกบัญชี Google (`googleSub`) และไม่มีรหัสผ่าน (ตั้งได้ภายหลังด้วย "ลืมรหัสผ่าน")

### 11.3 ผู้ใช้และอีเมล
- `User.email` (ไม่ซ้ำภายในบริษัท, ไม่บังคับ: แคชเชียร์ที่ใช้แค่ PIN ไม่ต้องมี) + `emailVerifiedAt` + `googleSub`
- สร้าง/แก้ผู้ใช้แล้วใส่อีเมล → ระบบส่งลิงก์ยืนยัน · `POST /auth/verify-email { token }` · `POST /auth/resend-verification`
- **ลืมรหัสผ่าน:** `POST /auth/forgot-password { tenantCode?, email }` (ตอบเหมือนกันเสมอ ไม่บอกว่ามีอีเมลนี้หรือไม่) → ลิงก์อายุ 1 ชั่วโมง → `POST /auth/reset-password { token, newPassword }` (ปลดล็อกบัญชีและออกจากระบบทุกเครื่อง) · ใช้ได้เฉพาะอีเมลที่ยืนยันแล้ว
- **เข้าระบบด้วย Google:** `POST /auth/google { idToken, tenantCode? }` → หาผู้ใช้ที่ผูก Google แล้ว หรืออีเมลยืนยันแล้วตรงกัน (ผูกให้อัตโนมัติ) · ไม่ส่งรหัสบริษัทได้ ถ้าอีเมลอยู่หลายบริษัทจะตอบ `409 TENANT_REQUIRED` พร้อมรายชื่อบริษัท · `POST /auth/google/link` ผูกบัญชีตัวเอง
- ตรวจ ID token ด้วยกุญแจของ Google (`google-auth-library`) และ `aud` = `GOOGLE_CLIENT_ID`

### 11.4 ราคาตามสาขา
- ตาราง `BranchPrice (branchId, productId, retailPrice, wholesalePrice?)` ในสกุลเงินเดียวกับราคาหลักของสินค้า · ไม่มีแถว = ใช้ราคาหลัก · `wholesalePrice` ว่าง = ใช้ราคาส่งหลัก
- `PUT /products/:id/branch-prices { items: [{ branchId, retailPrice, wholesalePrice? }] }` (แทนที่ทั้งชุด, สิทธิ์ `product.manage`)
- ขาย/ใบเสนอราคา/ใบซ่อม ใช้ราคาของสาขาเครื่องขายอัตโนมัติ · `GET /products?branchId=`, `/products/lookup?branchId=`, `/products/:id?branchId=` คืนราคาที่ใช้จริงของสาขานั้น (`branchPrice: true`) · รายละเอียดสินค้าแสดงราคาทุกสาขา (`branchPrices`)

### 11.5 จ่ายค่าแพ็กเกจ
- ตาราง `BillingInvoice (tenantId, number, planId, months, amountLak, status PENDING/PAID/CANCELLED, method, reference, paidAt)`
- ร้าน: `POST /billing/checkout { planCode, months: 1 | 12 }` → ใบแจ้งหนี้ + วิธีจ่าย (เลขบัญชีจาก `BILLING_BANK_INFO`, ลิงก์จ่ายออนไลน์จาก `BILLING_PAY_URL` ถ้าตั้งไว้) · `GET /billing/invoices` · `POST /billing/invoices/:id/cancel` · ใช้ได้แม้แพ็กเกจหมดอายุ (อ่านอย่างเดียว) เพื่อให้ต่ออายุเองได้
- **ยืนยันการจ่าย 2 ทาง:** (1) platform admin กด `POST /platform/invoices/:id/mark-paid` หลังเห็นเงินเข้า (2) payment gateway เรียก `POST /public/billing/webhook` พร้อมลายเซ็น `X-Signature: sha256=<HMAC-SHA256(body, BILLING_WEBHOOK_SECRET)>` และยอดต้องตรงกับใบแจ้งหนี้ · ทำซ้ำได้ไม่ต่ออายุซ้ำ
- จ่ายแล้ว → เปลี่ยนเป็นแพ็กเกจที่ซื้อ, สถานะ ACTIVE, `currentPeriodEnd` = max(วันนี้, วันหมดอายุเดิม) + จำนวนเดือน · ส่งอีเมลใบเสร็จถ้าบริษัทมีอีเมล
- ยังไม่ผูกกับ gateway เจ้าใดเจ้าหนึ่ง (BCEL OnePay ฯลฯ ต้องมีสัญญาและ API key ของร้าน) · webhook ที่มีลายเซ็นเป็นจุดต่อสำหรับ adapter ของ gateway
