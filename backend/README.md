# BACKEND GDSS PEMILIHAN CALON PRESIDEN
Sistem Pendukung Keputusan Kelompok (Group Decision Support System - GDSS) Berbasis Web untuk Pemilihan Calon Presiden menggunakan Metode TOPSIS untuk penilaian multikriteria, Agregasi Borda untuk ranking panel, dan Konsensus Voting Langsung.

---

## 1. Konteks & Deskripsi Project

Project ini merupakan implementasi backend REST API untuk simulasi akademik pengambilan keputusan kelompok dalam menentukan calon presiden terbaik dari 3 kandidat fiktif berdasarkan penilaian 3 Decision Maker (DM):
- **DM1**: Ketua Panel (Role: `chair`)
- **DM2**: Anggota Panel 1 (Role: `member`)
- **DM3**: Anggota Panel 2 (Role: `member`)

### Metode Pengambilan Keputusan
1. **TOPSIS (metode utama)**: Penilaian individual oleh setiap DM terhadap 4 kriteria berbobot (C1: 25, C2: 30, C3: 25, C4: 20). Normalisasi vektor $r_{ij} = x_{ij}/\sqrt{\sum x_{ij}^2}$, matriks terbobot $y_{ij} = (w_j/100)\,r_{ij}$, solusi ideal $A^+$/$A^-$, jarak $D^+$/$D^-$, dan nilai preferensi $C_i = D_i^-/(D_i^+ + D_i^-)$ pada rentang 0–1. Fungsi `calculateSaw()` tetap ada sebagai legacy perbandingan.
2. **Metode Borda**: Agregasi pemeringkatan independen dari ketiga DM yang berasal dari nilai preferensi TOPSIS. Peringkat 1 mendapat 3 poin, Peringkat 2 mendapat 2 poin, dan Peringkat 3 mendapat 1 poin (dengan kebijakan pembagian poin rata-rata jika terjadi nilai seri).
3. **Voting Langsung (Konsensus Utama)**: Konsensus mufakat di mana setiap DM memberikan satu suara rahasia per putaran voting. Keputusan sah jika mencapai mayoritas minimal 2 dari 3 suara (66.67%). Apabila terjadi seri (1-1-1), sistem mewajibkan putaran voting ulang. Hasil mayoritas disahkan secara resmi oleh Ketua Panel.

---

## 2. Struktur Direktori Backend

```
backend/
├── database/
│   ├── schema.sql           # Skema 9 tabel relasional MySQL/MariaDB + audit
│   └── seed.sql             # Data awal 3 DM, 3 kandidat, 4 kriteria & matriks Excel
├── docs/
│   └── source-extraction.json # Ekstraksi data & SHA-256 dokumen acuan asli
├── public/
│   ├── .htaccess            # Konfigurasi Apache mod_rewrite
│   └── index.php            # Entry point REST API & CORS handler
├── src/
│   ├── App.php              # Workflow controller, otorisasi & transaksi DB
│   ├── DecisionService.php  # Engine matematika TOPSIS, Borda, & Voting
│   └── bootstrap.php        # Inisialisasi environment & koneksi PDO
├── tests/
│   ├── run.php              # Automated test 98 kasus (TOPSIS, Borda, voting, kontrak API)
│   └── http_test.php        # Automated test live HTTP web server
├── tools/
│   ├── analyze_sources.py   # Analisis dokumen acuan asli (Excel/PDF/PPTX)
│   └── provision.php        # CLI pembaruan password hash pengguna
├── .env.example             # Template konfigurasi environment
├── .env                     # File konfigurasi lokal aktif
├── API_DOCUMENTATION.md     # Spesifikasi lengkap request/response API JSON
├── FRONTEND_INTEGRATION.md  # Panduan integrasi & kode JavaScript siap pakai
└── README.md                # Dokumentasi instalasi dan operasional
```

---

## 3. Akun Pengguna Demonstrasi

Akun panel bawaan (hasil `seed.sql`) tidak menyertakan password di dokumentasi ini. Tetapkan password lokal sebelum demo:

```bash
php tools/provision.php dm1 <password_baru> chair
php tools/provision.php dm2 <password_baru> member
php tools/provision.php dm3 <password_baru> member
```

| Akun | Username | Jabatan (Role) | Hak Akses Utama |
|---|---|---|---|
| **DM1** | `dm1` | **Ketua Panel** (`chair`) | Buka voting, buka putaran ulang, sahkan keputusan mufakat |
| **DM2** | `dm2` | **Anggota Panel 1** (`member`) | Isi penilaian, lihat TOPSIS pribadi, voting, lihat konsensus |
| **DM3** | `dm3` | **Anggota Panel 2** (`member`) | Isi penilaian, lihat TOPSIS pribadi, voting, lihat konsensus |
| **Pemilih** | registrasi mandiri | **Pemilih Terdaftar** (`voter`) | Voting langsung, lihat kandidat, lihat hasil voting |

*Catatan Keamanan*: Jangan menuliskan password, `APP_KEY`, atau kredensial database ke dokumentasi publik. Gunakan `php tools/provision.php <username> <password_baru> <role>` untuk mengatur atau mereset password akun panel.

---

## 4. Panduan Instalasi & Menjalankan di XAMPP / Laragon

### Prasyarat
- **PHP 8.1+** (diuji pada PHP 8.3) dengan ekstensi `pdo_mysql`, `mbstring`, `json`
- **MySQL 8.0+ / MariaDB 10.4+**
- **Node.js 18+** dan npm (untuk frontend)
- Laragon atau XAMPP sebagai penyedia MySQL/Apache

### Langkah 1: Persiapan Database MySQL
1. Buka **XAMPP Control Panel** dan klik **Start** pada modul **Apache** dan **MySQL**.
2. Buka browser dan akses **phpMyAdmin** di `http://localhost/phpmyadmin/`.
3. Buat database baru bernama `gdss_pemilihan_presiden` (atau biarkan dieksekusi otomatis oleh script).
4. Klik tab **Import**, pilih file:
   `backend/database/schema.sql` lalu klik **Import**.
5. Ulangi import untuk file data awal:
   `backend/database/seed.sql` lalu klik **Import**.

*Alternatif via Terminal / Command Prompt*:
```bash
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS gdss_pemilihan_presiden CHARACTER SET utf8mb4;"
mysql -u root -p gdss_pemilihan_presiden < database/schema.sql
mysql -u root -p gdss_pemilihan_presiden < database/seed.sql
```

### Langkah 2: Konfigurasi File `.env`
Buka file `.env` di folder `backend/` dan sesuaikan kredensial MySQL XAMPP Anda:
```ini
DB_DSN=mysql:host=127.0.0.1;port=3306;dbname=gdss_pemilihan_presiden;charset=utf8mb4
DB_USER=<user_database_anda>
DB_PASSWORD=<password_database_anda>
APP_KEY=<isi_dengan_random_string_minimal_32_karakter>
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001
```

Salin `.env.example` menjadi `.env`, lalu isi nilainya secara lokal. Jangan commit file `.env`.

### Langkah 3: Menjalankan Server Backend

Anda dapat memilih salah satu dari dua cara berikut:

#### Opsi A: Menggunakan PHP Built-in Server (Paling Cepat & Praktis)
Buka terminal / Command Prompt di folder `backend`, lalu jalankan:
```bash
php -S 127.0.0.1:8080 -t public public/index.php
```
Backend akan aktif dan melayani API di:
`http://127.0.0.1:8080/api`

> Gunakan `127.0.0.1`, bukan `localhost`, pada Windows. `localhost` dapat resolve ke IPv6 `::1` sehingga proxy Vite gagal terhubung.

#### Opsi B: Menggunakan Apache XAMPP
1. Salin atau buat symlink folder `backend` ke dalam direktori `C:\xampp\htdocs\backend`.
2. Pastikan modul `mod_rewrite` di Apache XAMPP aktif (sudah aktif secara default pada file `public/.htaccess`).
3. Endpoint API dapat diakses di:
   `http://localhost/backend/public/api`

### Langkah 4: Menjalankan Frontend (Vite + React)

```bash
cd frontend
npm install
npm run dev
```

Frontend aktif di `http://localhost:3000`. Proxy `/api` diarahkan ke `http://127.0.0.1:8080` (lihat `frontend/vite.config.ts`).

Untuk build produksi:

```bash
npm run typecheck
npm run build
npm run preview
```

### Langkah 5: Alur Demo Singkat
1. Login sebagai `dm1`, isi penilaian, lalu finalisasi.
2. Login `dm2` dan `dm3`, isi penilaian, lalu finalisasi.
3. Ketua membuka voting. Snapshot pemilih dibekukan pada pembukaan putaran pertama.
4. Pemilih terdaftar (registrasi publik) dan panelis memberikan suara.
5. Ketua mengesahkan keputusan mayoritas; riwayat putaran tersimpan permanen.

---

## 5. Catatan Keamanan

- Registrasi publik selalu menghasilkan role `voter`; role `chair`/`member` tidak dapat dipilih dari endpoint publik.
- Token Bearer HMAC-SHA256 berlaku 1 jam dan tidak dicetak ke log.
- Endpoint penilaian, TOPSIS pribadi, Borda, status panel, dan aksi ketua dibatasi di backend berdasarkan role. Endpoint SAW pribadi tetap tersedia sebagai legacy.
- Password disimpan sebagai hash Bcrypt dan tidak pernah dikembalikan oleh API.
- Semua query menggunakan prepared statement PDO.
- `APP_KEY`, `.env`, dan kredensial database tidak boleh di-commit atau ditulis di dokumentasi.
- CORS hanya mengizinkan origin frontend lokal yang terdaftar pada `CORS_ALLOWED_ORIGINS`.
- Snapshot `session_voters` dan tabel `votes` tidak boleh dihapus atau diubah secara manual.

---

## 6. Menjalankan Automated Tests

Backend dilengkapi dengan pengujian otomatis 100% lulus:

### 1. Menjalankan Unit & Workflow Tests (21 Skenario Spesifikasi)
```bash
php tests/run.php
```
*Menguji*:
1. Login berhasil
2. Login password salah
3. Akses tanpa token ditolak (401)
4. Anggota dilarang akses aksi ketua (403)
5. Penilaian tidak lengkap tidak bisa difinalisasi (422)
6. Skor TOPSIS Session 1 sesuai referensi (DM1: 0.656679/0.449105/0.232170, DM2: 0.592144/0.774674/0.225326, DM3: 0.698325/0.000000/0.424859); skor SAW lama tetap diuji sebagai legacy
7. Agregasi Borda presisi sesuai Excel (A: 8 poin / 44.44%, B: 6 poin / 33.33%, C: 4 poin / 22.22%)
8. Voting tidak dapat dibuka sebelum seluruh DM selesai menilai
9. DM dilarang memberikan suara ganda pada putaran yang sama (409)
10. Sebaran suara mayoritas 2-1 menghasilkan kandidat mayoritas
11. Sebaran suara 1-1-1 menghasilkan status tie_revote
12. Putaran voting ulang menyimpan data terpisah dari putaran 1
13. Anggota dilarang mengesahkan keputusan (403)
14. Hasil final dapat diakses semua DM
15. Pengesahan dilarang dilakukan dua kali
16. Pembagian poin rata-rata (average points sharing) pada ranking Borda yang seri
17. Pemilih publik tidak dihitung dalam status penilaian panel
18. Registrasi publik memaksa role `voter` dan menolak username duplikat
19. Snapshot electorate dibekukan; pendaftar setelah voting dibuka ditolak (403)
20. Voter yang terdaftar sebelum voting dibuka dapat memberikan suara
21. Agregasi Borda mengabaikan voter tanpa penilaian

### 2. Menjalankan Live HTTP Integration Tests (16 HTTP Server Tests)
```bash
php tests/http_test.php
```
*Menguji live web server, validasi CORS preflight OPTIONS, Bearer Token authorization header, serta seluruh endpoint API.*

### 3. Menjalankan Frontend Tests (Vitest + React Testing Library)
```bash
cd ../frontend
npm test
```
*Menguji*: validasi login, error autentikasi, registrasi pemilih, konfirmasi password, proteksi rute berbasis role, serta status voting dan eligibility pemilih.

### 4. Typecheck & Production Build Frontend
```bash
cd ../frontend
npm run typecheck
npm run build
```

---

## 7. Verifikasi Kesesuaian Hasil

> Angka SAW pada tabel pertama adalah **baseline historis** sebelum migrasi metodologi. Metode aktif saat ini adalah TOPSIS; verifikasi TOPSIS Session 1 menghasilkan DM1 `0.656679 / 0.449105 / 0.232170`, DM2 `0.592144 / 0.774674 / 0.225326`, DM3 `0.698325 / 0.000000 / 0.424859`, dan agregasi Borda tetap A=8, B=6, C=4.

| Objek Perhitungan | Kandidat A | Kandidat B | Kandidat C | Status Verifikasi |
|---|---|---|---|---|
| **SAW DM1 (Ketua Panel)** | **91.0** | **85.0** | **79.0** | Tepat sesuai Excel |
| **SAW DM2 (Anggota 1)** | **86.0** | **96.0** | **78.0** | Tepat sesuai Excel |
| **SAW DM3 (Anggota 2)** | **95.0** | **76.0** | **85.0** | Tepat sesuai Excel |
| **Poin Metode Borda** | **8.0 Poin** | **6.0 Poin** | **4.0 Poin** | Tepat sesuai Excel |
| **Persentase Nilai Borda** | **44.44%** | **33.33%** | **22.22%** | Tepat sesuai Excel |
| **Voting Langsung (2-1-0)** | **2 Suara (66.67%)** | **1 Suara (33.33%)** | **0 Suara (0%)** | **Mayoritas Kandidat A** |

---

## 8. Referensi Integrasi Frontend

Silakan baca dokumen pendukung:
- [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md): Rincian lengkap endpoint, request/response JSON, dan HTTP status code.
- [`FRONTEND_INTEGRATION.md`](FRONTEND_INTEGRATION.md): Panduan integrasi frontend, state machine antarmuka, dan library JavaScript siap pakai (`api.js`).
