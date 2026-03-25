# TMAT Auth Proxy Service

Node.js + Fastify auth proxy untuk TMAT Monitoring. Service ini menangani login user dari database TMAT, menyimpan session di cookie `HttpOnly`, lalu meneruskan request ke backend upstream dengan `X-API-KEY` yang sesuai scope user.

## Fitur Utama

- Login, session, dan logout berbasis JWT cookie `HttpOnly`
- Revocation token logout melalui Redis blocklist
- Role-based access untuk `admin`, `perusahaan`, dan `pemda`
- Layer scope `pemda`:
  - `pemda provinsi` berdasarkan `provinsi_id`
  - `pemda kabupaten/kota` berdasarkan `kabupaten_id`
- Proxy upstream untuk endpoint TMAT:
  - `/proxy/perusahaan`
  - `/proxy/perusahaan/:id`
  - `/proxy/device`
  - `/proxy/realtime_all`
  - `/proxy/realtime_device`
  - `/proxy/map`
- API key diambil dari database dan di-cache di Redis
- Endpoint `device` dan `realtime` yang sensitif terhadap scope memakai query MySQL langsung agar filter perusahaan/provinsi/kabupaten tidak bergantung pada backoffice

## Role dan Scope

- `admin`
  - akses global
  - memakai API key admin-tier
- `perusahaan`
  - hanya dapat melihat data milik `id_perusahaan` sendiri
  - query `id_perusahaan` dari client akan dioverride oleh server
  - memakai API key perusahaan dari database
- `pemda`
  - memakai group role `pemda` dari database
  - scope ditentukan dari data user:
    - jika `kabupaten_id` ada, maka scope efektif = `pemda_kabupaten`
    - jika `kabupaten_id` kosong dan `provinsi_id` ada, maka scope efektif = `pemda_provinsi`
  - untuk endpoint data dari database, filter wilayah diterapkan langsung di SQL
  - untuk endpoint upstream lain, memakai API key admin-tier

## Arsitektur Singkat

- MySQL
  - `users`, `users_groups`, `master_perusahaan` untuk auth dan profile user
  - `api_keys` untuk API key upstream
- Redis
  - blocklist token logout
  - cache API key
- Fastify service
  - `POST /auth/login`
  - `GET /auth/me`
  - `GET /auth/debug-session`
  - `POST /auth/logout`
  - `/proxy/*`

Dokumen teknis yang lebih detail tersedia di:
- [Auth Feature Implementation - TMAT Monitoring.md](/C:/work/lokal/pakhamka/gis-kemenlh/proxy-server/Auth%20Feature%20Implementation%20-%20TMAT%20Monitoring.md)
- [PRD Node.js Auth Proxy Server - TMAT Monitoring.md](/C:/work/lokal/pakhamka/gis-kemenlh/proxy-server/PRD%20Node.js%20Auth%20Proxy%20Server%20-%20TMAT%20Monitoring.md)
- [openapi.yaml](/C:/work/lokal/pakhamka/gis-kemenlh/proxy-server/openapi.yaml)

## Menjalankan Lokal

### 1. Prasyarat

- Node.js 18+
- MySQL aktif dan bisa diakses dari mesin lokal
- Redis aktif

### 2. Install dependency

```bash
npm install
```

### 3. Siapkan environment

Salin template environment lalu isi nilainya sesuai environment Anda:

```bash
cp .env.example .env
```

Catatan:
- jangan commit `.env`
- password yang mengandung `#` atau karakter spesial perlu dibungkus kutip, misalnya `DB_PASSWORD="..."`.

### 4. Jalankan dev server

```bash
npm run dev
```

Service akan berjalan di `http://localhost:4000`.

## Smoke Test PowerShell

Gunakan `-UseBasicParsing` agar PowerShell tidak menampilkan warning parser HTML.

### Login

```powershell
$body = @{ username = 'user@example.com'; password = 'your-password' } | ConvertTo-Json
Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:4000/auth/login' -Method POST -ContentType 'application/json' -Body $body -SessionVariable s
```

### Cek user login

```powershell
Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:4000/auth/me' -WebSession $s
```

### Cek scope efektif

```powershell
Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:4000/auth/debug-session' -WebSession $s
```

### Akses proxy

```powershell
Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:4000/proxy/perusahaan' -WebSession $s
Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:4000/proxy/device' -WebSession $s
Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:4000/proxy/realtime_all' -WebSession $s
```

### Logout

```powershell
Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:4000/auth/logout' -Method POST -WebSession $s
```

`POST /auth/logout` bersifat idempotent, jadi tanpa cookie pun tetap mengembalikan `200`.

## Database Seed

Project menyediakan script seed di [database/seed.js](/C:/work/lokal/pakhamka/gis-kemenlh/proxy-server/database/seed.js).

Seed ini:
- memakai `bcryptjs`
- mengikuti group role dari environment:
  - `ROLE_ADMIN_GROUP_ID`
  - `ROLE_PERUSAHAAN_GROUP_ID`
  - `ROLE_PEMDA_PROV_GROUP_ID`
  - `ROLE_PEMDA_KAB_GROUP_ID`
  - atau fallback legacy `ROLE_PEMDA_GROUP_ID`
- membuat contoh user:
  - `admin`
  - `perusahaan`
  - `pemda provinsi`
  - `pemda kabupaten`

Jalankan:

```bash
node database/seed.js
```

Default password untuk user seed:

```txt
123456
```

## Build dan Test

```bash
npm run build
npm run lint
npm test -- --run
```

## Catatan Implementasi

- `/proxy/perusahaan` pada backend nyata tetap membutuhkan API key, jadi endpoint ini tidak dianggap public.
- `/proxy/device`, `/proxy/realtime_all`, dan `/proxy/realtime_device` memakai query SQL langsung ke database TMAT agar filter perusahaan/provinsi/kabupaten konsisten.
- `/auth/logout` diimplementasikan idempotent.
- `/auth/me` dan `/auth/login` mengembalikan profile user yang konsisten, termasuk `name` dan `pemdaScopeLevel`.
- Untuk user `pemda`, layer kota/kabupaten diimplementasikan memakai `kabupaten_id` karena itu yang tersedia di schema database.
