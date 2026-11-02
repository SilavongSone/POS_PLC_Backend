# Deploy PLC POS ຂຶ້ນ server

ທັງລະບົບລັນຢູ່ server ດຽວດ້ວຍ Docker Compose:

| Service | ໜ້າທີ່ |
|---|---|
| `postgres` | ຖານຂໍ້ມູນ PostgreSQL 17 (ຂໍ້ມູນຢູ່ volume `pgdata`) |
| `migrate` | ລັນ migration + seed ຄັ້ງດຽວ ທຸກຄັ້ງທີ່ start (idempotent) ແລ້ວອອກ |
| `api` | Backend NestJS (ຮູບສິນຄ້າຢູ່ volume `uploads`) |
| `web` | Frontend Next.js |
| `caddy` | HTTPS ອັດຕະໂນມັດ (Let's Encrypt) · `https://DOMAIN/api/*` → api, ທີ່ເຫຼືອ → web |
| `backup` | `pg_dump` ທຸກຄືນ 02:00 ເວລາລາວ ເກັບໄວ້ `deploy/backups/` (ຄ່າເລີ່ມຕົ້ນ 14 ມື້) |

Backend ແລະ frontend ເປັນ repo ແຍກກັນ ແລະ build ເປັນ image ແຍກກັນ, ແຕ່ compose ນີ້ build ແລະ ລັນທັງສອງພ້ອມກັນ.

## ສິ່ງທີ່ຕ້ອງມີ

1. **VPS** Ubuntu 22.04/24.04, 2 vCPU / 4 GB RAM ຂຶ້ນໄປ (ແນະນຳ Singapore ໃກ້ລາວ)
2. **Domain** ເຊັ່ນ `pos.plc.la` — ຕັ້ງ DNS **A record** ຊີ້ໄປ IP ຂອງ server
3. ເປີດ port **80** ແລະ **443** (firewall / security group)
4. ອີເມວສຳລັບສົ່ງເມລ (SMTP) ເຊັ່ນ Gmail + App Password

## ຕິດຕັ້ງຄັ້ງທຳອິດ

```bash
# 1. ຕິດຕັ້ງ Docker
curl -fsSL https://get.docker.com | sh

# 2. Clone ທັງສອງ repo ໄວ້ຂ້າງກັນ
sudo mkdir -p /opt/plc-pos && sudo chown $USER /opt/plc-pos && cd /opt/plc-pos
git clone https://github.com/SilavongSone/POS_PLC_Backend.git backend
git clone https://github.com/SilavongSone/POS_PLC_Frontend.git frontend

# 3. ຕັ້ງຄ່າ
cd backend/deploy
cp .env.example .env
nano .env        # ໃສ່ທຸກຄ່າ · ສຸ່ມ secret ດ້ວຍ: openssl rand -base64 48

# 4. Build ແລະ start
docker compose up -d --build
docker compose ps            # api, web, caddy ຕ້ອງເປັນ healthy / running
```

ເປີດ `https://DOMAIN` — ເຂົ້າລະບົບຮ້ານດ້ວຍ `admin` + `SEED_ADMIN_PASSWORD` ແລ້ວ **ປ່ຽນລະຫັດຜ່ານທັນທີ**.
Super Admin: `https://DOMAIN/lo/platform/login` ດ້ວຍ `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD`.

## ອັບເດດເວີຊັນໃໝ່

```bash
cd /opt/plc-pos
git -C backend pull && git -C frontend pull
cd backend/deploy && docker compose up -d --build
```

`migrate` ລັນ migration ໃໝ່ໃຫ້ກ່ອນ `api` start ທຸກຄັ້ງ. ຖ້າປ່ຽນ `DOMAIN` ຫຼື `GOOGLE_CLIENT_ID` ຕ້ອງ build `web` ໃໝ່ (ຄ່າເຫຼົ່ານີ້ຖືກ compile ເຂົ້າໄປໃນເວັບ).

## Backup ແລະ ກູ້ຄືນ

- ໄຟລ໌ຢູ່ `backend/deploy/backups/plc_pos-YYYYMMDD-HHMM.dump` — **ຕ້ອງ copy ອອກນອກ server ເປັນປະຈຳ** (ເຊັ່ນ `rclone` ໄປ Google Drive) ເພາະຖ້າ server ເສຍ backup ໃນເຄື່ອງກໍຫາຍນຳ
- Backup ດຽວນີ້ເລີຍ: `docker compose exec backup sh -c 'pg_dump --format=custom --file=/backups/manual-$(date +%Y%m%d-%H%M).dump'`
- ກູ້ຄືນ (ຂຽນທັບຖານຂໍ້ມູນປັດຈຸບັນ):
  ```bash
  docker compose stop api
  docker compose exec -T backup pg_restore --clean --if-exists --no-owner -d plc_pos < backups/plc_pos-YYYYMMDD-HHMM.dump
  docker compose start api
  ```
- ຮູບສິນຄ້າຢູ່ volume `plc-pos_uploads` — backup ດ້ວຍ `docker run --rm -v plc-pos_uploads:/u -v $PWD:/b alpine tar czf /b/uploads.tgz -C /u .`

## ກວດສຸຂະພາບລະບົບ

- `docker compose ps` · `docker compose logs -f api`
- ຕັ້ງ uptime monitor (ເຊັ່ນ UptimeRobot ຟຣີ) ຍິງ `https://DOMAIN/api/health`

## ລິ້ງທົດລອງຟຣີ (ບໍ່ຕ້ອງມີ server ຫຼື domain)

ລັນທັງລະບົບຢູ່ເຄື່ອງຕົວເອງ ແລ້ວ Cloudflare Quick Tunnel ອອກລິ້ງ HTTPS ສາທາລະນະໃຫ້ (`https://xxxx.trycloudflare.com`) — ເປີດຈາກມືຖືໄດ້ ແລະ ກ້ອງສະແກນໃຊ້ໄດ້:

```bash
cp .env.example .env     # ໃສ່ secret · SEED_DEMO=true ຖ້າຢາກມີສິນຄ້າຕົວຢ່າງ · MAIL_TRANSPORT=log
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml logs cloudflared | grep trycloudflare
```

ສະເພາະທົດສອບ: ໃຊ້ໄດ້ຕອນເຄື່ອງເປີດຢູ່ເທົ່ານັ້ນ, ລິ້ງປ່ຽນທຸກຄັ້ງທີ່ start ໃໝ່, Cloudflare ບໍ່ຮັບປະກັນ uptime. ປິດດ້ວຍ `docker compose -f docker-compose.yml -f docker-compose.tunnel.yml down` (ເພີ່ມ `-v` ເພື່ອລຶບຂໍ້ມູນ).

## ທົດສອບໃນເຄື່ອງ (ກ່ອນຂຶ້ນ server)

ຕັ້ງ `DOMAIN=localhost` ແລະ `MAIL_TRANSPORT=log` ໃນ `.env` ແລ້ວ `docker compose up -d --build`. Caddy ຈະໃຊ້ certificate ຂອງຕົນເອງສຳລັບ localhost (browser ຈະເຕືອນ — ກົດຜ່ານໄດ້). ລຶບຖິ້ມດ້ວຍ `docker compose down -v` (ລຶບຂໍ້ມູນທັງໝົດ).
