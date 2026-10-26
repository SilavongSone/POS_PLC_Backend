# PLC POS — ภาพรวม API (สำหรับทำ frontend)

> อัปเดตล่าสุด: 2026-10-26 · Swagger ตัวเต็มอยู่ที่ `GET /api/docs` (JSON: `/api/docs-json`)
> ตารางและกฎธุรกิจดูได้ที่ [`database-design.md`](./database-design.md) · ขอบเขตงานดูได้ที่ [`product-plan.md`](./product-plan.md)

## ข้อตกลงทั่วไป

| เรื่อง | ข้อตกลง |
|---|---|
| Base URL | `/api` · ทุก route ต้องมี `Authorization: Bearer <accessToken>` ยกเว้น login, pin-login, refresh, logout |
| เงิน | ส่งกลับเป็น **string** ทศนิยม (`"1300000"`, `"21800.5"`) ห้ามใช้ float คำนวณยอด · LAK เป็นจำนวนเต็ม · THB/USD มีทศนิยม 2 ตำแหน่ง |
| วันที่ | query `from`/`to` ใช้รูปแบบ `YYYY-MM-DD` ตามเวลา **Asia/Vientiane** (นับรวมทั้งสองวัน) · timestamp เป็น ISO UTC |
| แบ่งหน้า | `?page=1&pageSize=20&q=` → `{ items, total, page, pageSize }` |
| Error | `400` ข้อมูลไม่ถูกต้อง (`errors[]` ระบุ path) · `401` ยังไม่ล็อกอิน/token หมดอายุ · `403` ไม่มีสิทธิ์ · `404` ไม่พบ · `409` ขัดกับสถานะ (สต็อกไม่พอ, ซ้ำ ฯลฯ) · `423` บัญชีถูกล็อก |
| Error code ที่ต้องดักจับ | `APPROVAL_REQUIRED` (403: ต้องให้ผู้จัดการใส่ PIN อนุมัติ) · `NO_OPEN_SHIFT` (404/409: ต้องเปิดกะก่อน) · `CREDIT_LIMIT` (409: เกินวงเงินเชื่อ) |
| เลขเอกสาร | `S-R1-261026-0001` ขาย · `R-` คืน · `DP-` ชำระหนี้ · `GR-`/`GI-`/`ADJ-` สต็อก · `Q-` เสนอราคา · `T-` ซ่อม · `INV-2026-000001` ใบกำกับภาษี · `C00001` ลูกค้า |

## โมดูลและ route

| โมดูล | Route หลัก | สิทธิ์ |
|---|---|---|
| Auth | `POST /auth/login`, `/auth/pin-login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `POST /auth/change-password`, `PUT /auth/pin`, `POST /auth/approve` | — |
| ผู้ใช้/กลุ่ม | `/users` (CRUD, reset-password, pin, unlock), `/user-groups`, `/user-groups/permissions` | `users.manage` |
| ตั้งค่า | `GET/PATCH /settings`, `/tax-rates` (+`/:id/default`), `/exchange-rates` (`/current`), `/payment-types`, `/registers` | อ่าน: ทุกคน · แก้: `settings.manage` (อัตราแลกเปลี่ยน: `exchangeRate.manage`) |
| แคตตาล็อก | `/categories` (`?tree=true`), `/brands`, `/products` (search, `/lookup?code=`, `/bulk-price`, `PUT /prices`, `/:id/images`, `/:id/bundle-items`), `/promotions` | อ่าน: `catalog.view` · แก้: `product.manage` |
| สต็อก | `/suppliers`, `/stock-documents` (draft → `/post` → `/cancel`), `/stock/movements`, `/stock/serials`, `/stock/serials/:serial/history`, `/stock/lots/expiring` | `stock.receive` / `stock.issue` / `stock.adjust` |
| ลูกค้า | `/customers` (`?withDebt=true`), `/customers/:id/debts` | `customer.manage` / `debt.receive` |
| กะ | `POST /shifts/open`, `GET /shifts/current`, `/shifts/:id/report` (Z-report), `/shifts/:id/close`, `/shifts/:id/cash-movements` | `shift.operate` (`cash.move`) |
| ขาย | `POST /sales/quote`, `POST /sales`, `/sales/:id/receipt`, `/sales/:id/printed`, `/sales/:id/void`, `/sales/:id/tax-invoice`, `/held-bills`, `/tax-invoices` | `sale.create`, `sale.hold`, `sale.reprint`, `taxInvoice.issue` |
| คืนสินค้า | `POST /sales/:id/returns`, `/returns` | `return.create` (หรือขออนุมัติ) |
| หนี้ | `POST /debt-payments`, `GET /debt-payments` | `debt.receive` |
| รายจ่าย | `/expense-categories`, `/expenses` | `expense.manage` |
| ใบเสนอราคา | `/quotations` (+ `/status`, `/convert`) | `quotation.manage` |
| ซ่อม | `/service-tickets` (+ `/lines`, `/status`, `/deliver`) | `repair.receive` / `repair.manage` |
| รายงาน | `/reports/dashboard`, `sales-summary`, `best-sellers`, `stock-value`, `stock-documents`, `debt-payments`, `debt-aging`, `expenses`, `voided-sales`, `customer-purchases`, `repairs` | `report.view` (ต้นทุน/กำไรต้องมี `product.viewCost` ด้วย) |

## ลำดับการทำงานที่ frontend ต้องใช้

### 1. เริ่มงานที่เครื่องขาย
1. เครื่องจำ `registerId` ของตัวเอง (Admin เลือกครั้งแรกจาก `GET /registers`)
2. แคชเชียร์ล็อกอินด้วย `POST /auth/pin-login` → เก็บ `accessToken` (15 นาที) + `refreshToken` · เมื่อได้ 401 ให้เรียก `POST /auth/refresh` แล้วยิงซ้ำ
3. `GET /shifts/current` → ถ้าได้ `null` ให้เปิดกะด้วย `POST /shifts/open { registerId, openingCash: { LAK, THB, USD } }`

### 2. ขาย
1. สแกน → `GET /products/lookup?code=` (รองรับบาร์โค้ด, SKU และ serial) → ถ้าได้ `serial` ให้ใส่ลงบรรทัดนั้นเลย
2. ทุกครั้งที่ตะกร้าเปลี่ยน → `POST /sales/quote` ได้ราคาจริง, โปรโมชั่น, VAT, ยอดรวม และ `needsApproval`
3. ถ้ามีการแก้ราคาหรือให้ส่วนลด และผู้ใช้ไม่มีสิทธิ์ → เปิดหน้าต่างให้ผู้จัดการใส่ username + PIN → `POST /auth/approve { permission }` → ได้ `approvalToken` (อายุ 2 นาที) → ส่งใน `approvals: { 'price.override': token }`
4. `POST /sales { registerId, customerId?, items[{productId, quantity, serials?, componentSerials?, unitPriceLak?, discountLak?}], discountLak, payments[{paymentTypeId, currency, amount, reference?}], heldBillId? }`
5. `GET /sales/:id/receipt` → ส่งให้ print bridge (ESC/POS) → `POST /sales/:id/printed`

### 3. ยกเลิกบิล, คืนสินค้า, ใบกำกับภาษี
- ยกเลิกบิลได้เฉพาะบิลของกะที่ยังเปิดอยู่: `POST /sales/:id/void { reason, approvalToken? }`
- หลังปิดกะแล้วให้ใช้คืนสินค้า: `POST /sales/:id/returns { reason, paymentTypeId, items[{saleItemId, quantity, serials?, restock}] }`
- ใบกำกับภาษี: `POST /sales/:id/tax-invoice` → `GET /tax-invoices/:id` (ข้อมูลสำหรับพิมพ์ A4 พร้อมจำนวนเงินเป็นตัวอักษรภาษาลาว)

### 4. ปิดกะ
`GET /shifts/:id/report` (ดูยอดเงินที่ควรมี) → นับเงินจริง → `POST /shifts/:id/close { closingCash }` → ได้ Z-report พร้อมส่วนต่าง

### 5. รับสินค้าเข้า
`POST /stock-documents { type: 'RECEIVE', supplierId, currency, items[{productId, quantity, unitCost, serials?, lotNo?, expiryDate?}] }` → ตรวจทาน → `POST /stock-documents/:id/post`

### 6. ซ่อม
รับเครื่อง `POST /service-tickets { customerId, serial | deviceName, problem }` → ใส่ค่าใช้จ่าย `PUT /:id/lines` → เปลี่ยนสถานะ `POST /:id/status { READY }` → ส่งมอบ `POST /:id/deliver { registerId, payments }` (ถ้าอยู่ในประกันจะไม่เก็บเงิน)

## กลุ่มสิทธิ์เริ่มต้น

| กลุ่ม | สิทธิ์ |
|---|---|
| Admin | `*` |
| Manager | ทุกสิทธิ์ ยกเว้น `settings.manage`, `users.manage` |
| Cashier | `catalog.view`, `sale.create`, `sale.hold`, `sale.reprint`, `taxInvoice.issue`, `customer.manage`, `debt.receive`, `shift.operate`, `cash.move`, `repair.receive` |
| Viewer | `catalog.view` |

## การทดสอบ

- `pnpm test`: unit test (เงิน, VAT, คำนวณราคา, ตัวเลขเป็นคำภาษาลาว, สิทธิ์, เวลา)
- `pnpm test:e2e`: 90 test ที่ยิง API จริงกับฐานข้อมูล `<db>_test` (migrate + seed ให้อัตโนมัติ และไม่ลบข้อมูล)
