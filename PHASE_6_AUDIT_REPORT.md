> [!NOTE]
> Historical phase snapshot. Wording/data reflects then-current methodology. Final methodology: TOPSIS (multicriteria), Borda (aggregation), SAW (legacy comparison).

# PILPRESS — PHASE 6: AUDIT REPORT & IMPLEMENTATION PLANNING

**Dokumen:** Laporan Audit Menyeluruh & Perencanaan Implementasi Phase 6\
**Proyek:** Sistem Informasi Pendukung Keputusan Pemilihan Calon Presiden (GDSS)\
**Status Audit:** Selesai (Read-Only Analysis)\
**Tanggal Audit:** 20 November 2026\
**Tim Auditor:** Senior Full-Stack Developer, Software Architect, Database Engineer, & QA Engineer\
**Baseline Database Fingerprint:** `184f6823b046ac0b313f569697636cbf90b893a7d8e947d656f41dd2cea52813` (Identik Sebelum & Sesudah)

---

## 1. Executive Summary

Audit menyeluruh sistem **Pilpress** (GDSS Pemilihan Calon Presiden) dilakukan pada kondisi aktual repository setelah Phase 1–5 dinyatakan final secara fungsional. Audit berfokus pada kesiapan produksi, stabilitas sistem, isolasi multi-sesi, keamanan, konsistensi UX/UI antarperan (Ketua Panel, Anggota Panel, Pemilih Publik), serta verifikasi integritas data historis.

### Ringkasan Kondisi Sistem:
- **Phase 1–5 Core Logic**: Berfungsi dengan sangat baik. Algoritma SAW dan agregasi Borda terbukti presisi 100% terhadap model acuan Excel. Voting, evaluasi ambang mayoritas 2/3, putaran revote, pengesahan keputusan, dan siklus multi-sesi telah terverifikasi secara matematis dan relasional.
- **Integritas Database**: Sesi 1 utuh (Status `ratified`, 3 kandidat, 4 kriteria total 100%, 36 penilaian, 1 putaran voting, 3 suara valid, 1 pengesahan konsensus, 3 pemilih sah). Tidak ada perubahan data, duplikasi, maupun mutasi ilegal.
- **Automated Test Coverage**:
  - Backend: **63/63 test cases passed** (100% green).
  - Frontend: **86/86 unit & integration tests passed** (14 file test).
- **Temuan Utama yang Memerlukan Phase 6**:
  1. **Build Failure**: Perintah `npm run build` frontend gagal akibat 2 kesalahan TypeScript strict null check pada file test (`CandidateListPage.test.tsx` dan `CriteriaPage.test.tsx`).
  2. **Audit Trail View**: Aktivitas sensitif dicatat ke tabel `audit_logs` (96 baris log tersimpan), namun belum ada endpoint API maupun antarmuka UI bagi Ketua Panel untuk melihat jejak audit tersebut.
  3. **Laporan & Ekspor**: Belum ada fitur cetak atau ekspor resmi (PDF/Excel/Cetak Berita Acara) untuk keputusan final dan rekapitulasi penilaian GDSS.
  4. **Konteks Sesi Aktif di Dashboard**: Dashboard belum menampilkan judul/siklus pemilihan yang sedang aktif.
  5. **Global Unique Constraint pada Kode Kriteria**: `criteria.code` memiliki constraint `UNIQUE` tingkat tabel global (bukan per `session_id`). Hal ini menyebabkan kode kriteria di sesi baru terpaksa melanjutkan urutan global (`C5..C8`) daripada mengulang penomoran siklus baru (`C1..Cn`).
  6. **Empty States & Form Feedback**: Penilaian pada sesi baru yang belum memiliki kriteria/kandidat difinalisasi belum menampilkan panduan alur kerja yang ramah bagi Anggota Panel.

---

## 2. Kondisi Aktual Sistem

| Modul | Status Implementasi | Status Pengujian | Keterangan |
|---|---|---|---|
| **Autentikasi & Akun** | Lengkap | 3 backend / 6 frontend | Login rate-limited, Bearer HMAC-SHA256, registrasi voter publik. |
| **Kriteria (Phase 5)** | Lengkap | 12 backend / 6 frontend | CRUD, validasi 100%, tipe benefit/cost, kunci finalisasi. |
| **Kandidat (Phase 5)** | Lengkap | 12 backend / 9 frontend | Visi, misi, profil, deskripsi, program kerja, verifikasi, kunci finalisasi. |
| **Penilaian (SAW)** | Lengkap | 8 backend / 8 frontend | Matriks 3x4 per DM, formula normalisasi benefit/cost, pembobotan SAW. |
| **Konsensus (Borda)** | Lengkap | 6 backend / 8 frontend | Agregasi poin peringkat Borda, penanganan seri adil. |
| **Voting & Revote** | Lengkap | 13 backend / 26 frontend | Electorate 3 akun resmi, ambang mayoritas 2/3, putaran revote, anti-duplikasi. |
| **Pengesahan Keputusan**| Lengkap | 4 backend / 19 frontend | Catatan alasan pengesahan, riwayat putaran, kunci permanen. |
| **Election Cycle (P4)** | Lengkap | 17 backend / 9 frontend | Multi-sesi, snapshot electorate, validasi lifecycle, riwayat sesi lama. |
| **Audit Logs** | Backend Logger Saja | Teruji via aksi | Tersimpan 96 log, belum ada endpoint baca & halaman UI. |
| **Laporan & Rekapitulasi**| Belum Tersedia | Belum ada | Belum ada ekspor PDF/Cetak Berita Acara Keputusan. |

---

## 3. Audit Backend

### 3.1 Routing & API Structure
- Rute terpusat di `backend/public/index.php` dengan prefix `/api`.
- Penanganan rute mencakup method `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`.
- **Temuan**:
  - `POST /api/assessments/me/finalize` belum menerima parameter `session_id` eksplisit (hanya memfinalisasi sesi aktif default). Meskipun aman karena sesi lama sudah berstatus `ratified`, penambahan parameter `querySessionId()` disarankan demi konsistensi arsitektur.
  - Tidak ada endpoint `GET /api/audit-logs` untuk membaca log audit sistem.

### 3.2 Authentication & Authorization
- Token HMAC-SHA256 stateless berlaku 1 jam (`exp`).
- Fungsi `authenticateToken(PDO $db)` selalu memverifikasi eksistensi dan role terkini dari database (`SELECT id, username, name, role FROM users WHERE id = ?`). Jika akun dinonaktifkan atau role diubah, token langsung tidak berlaku.
- Otorisasi berbasis role diuji ketat di backend melalui helper `chair(?array $user)` dan `actor(?array $user)`. Percobaan akses oleh role yang tidak berwenang menghasilkan HTTP 403 Forbidden.

### 3.3 Request Validation & HTTP Status
- Validasi input menggunakan helper terpusat: `textInput`, `weightInput`, `parseJsonBody`, `querySessionId`.
- Penanganan error terstruktur menggunakan kelas `ApiError` dengan HTTP status yang konsisten:
  - `400`: Format payload bukan JSON valid.
  - `401`: Token tidak valid, kedaluwarsa, atau tanpa token.
  - `403`: Role tidak memiliki hak akses (misal Anggota mencoba membuka voting atau membuat kriteria).
  - `404`: Entitas atau rute tidak ditemukan.
  - `409`: Konflik status bisnis (misal sesi bukan assessment, kriteria sudah difinalisasi, suara duplikat).
  - `422`: Kesalahan validasi format input (bobot melebihi 100%, panjang teks melebihi batas).
  - `500` / `503`: Kegagalan database internal.

### 3.4 Concurrency & Transactions
- Operasi sensitif (`createElectionCycle`, `openVoting`, `vote`, `approveDecision`, `register`) dibungkus dalam blok `transaction(callable $fn)`.
- Menggunakan `SELECT ... FOR UPDATE` (pada MySQL/MariaDB) melalui helper `lockSession(int $sessionId)` untuk mencegah race condition voting dan finalisasi ganda.

### 3.5 Session Resolution
- `getActiveSessionId()` tidak lagi hanya mengandalkan `MAX(id)`, melainkan memvalidasi status terhadap lifecycle resmi (`assessment`, `voting`, `tie_revote`, `voting_completed`, `ratified`). Sesi anomali langsung menghasilkan HTTP 409.
- Seluruh query INSERT data turunan menyertakan kolom `session_id` secara eksplisit.

---

## 4. Audit Frontend

### 4.1 Build Production & TypeScript Compile
- Perintah `npm run build` mengeksekusi `tsc && vite build`.
- **Temuan Kritis**: Terjadi error kompilasi TypeScript pada 2 file pengujian:
  - `src/features/candidates/CandidateListPage.test.tsx` (baris 99): `error TS18047: 'el' is possibly 'null'`.
  - `src/features/criteria/CriteriaPage.test.tsx` (baris 111): `error TS18047: 'el' is possibly 'null'`.
  - Penyebab: Parameter `el` pada custom text matcher testing-library bertipe `Element | null`. Ketika strict null checks diaktifkan pada `tsconfig.json`, pemanggilan `el.textContent` tanpa optional chaining (`el?.textContent`) ditolak compiler.
  - Dampak: Build production gagal, aplikasi tidak dapat dideploy ke server produksi melalui script build standar.

### 4.2 Query Cache & Invalidation
- Menggunakan `@tanstack/react-query` dengan `staleTime` terukur (1–5 menit tergantung tipe data).
- `NewElectionPage` telah diperbaiki untuk meng-invalidate seluruh query relevan (`elections`, `voting`, `decisions`, `assessments`, `results`, `criteria`, `candidates`).
- Perpindahan halaman antar-fase berjalan sinkron tanpa cache tabrakan.

### 4.3 Navigasi & Responsive Layout
- Layout sidebar responsif dengan drawer mobile yang menutup otomatis saat route berganti atau tombol `Escape` ditekan.
- Pembagian menu navigasi berbasis role:
  - **Voter**: Dashboard, Kandidat, Voting, Hasil Voting, Keputusan, Riwayat Pemilihan.
  - **Member**: + Kriteria, Penilaian, Hasil SAW, Hasil Borda.
  - **Chair**: + Pemilihan Baru (jika sesi aktif sudah `ratified`).

### 4.4 Keterbatasan UX Antarhalaman
- **Ketiadaan Session Switcher Global**: Seluruh halaman aplikasi (selain detail read-only di `ElectionHistoryPage`) mengarah langsung ke sesi aktif backend. Pengguna tidak dapat memilih sesi lama untuk melihat matriks penilaian atau grafik SAW/Borda sesi historis pada halaman visual penuh.
- **Header Siklus Pemilihan**: Pengguna tidak melihat label siklus pemilihan aktif pada header utama dashboard.

---

## 5. Audit Database

### 5.1 Struktur Tabel & Relasi
Database `gdss_pemilihan_presiden` memiliki 12 tabel operasional:
1. `decision_sessions` (1 baris)
2. `users` (9 baris: dm1, dm2, dm3, voter1, voter2, test_user, dll.)
3. `criteria` (4 baris)
4. `candidates` (3 baris)
5. `assessments` (36 baris)
6. `assessment_status` (3 baris)
7. `voting_rounds` (1 baris)
8. `votes` (3 baris)
9. `final_decisions` (1 baris)
10. `session_voters` (3 baris)
11. `audit_logs` (96 baris)
12. `login_attempts` (2 baris)

### 5.2 Foreign Keys & Cascading
- Seluruh relasi data turunan terikat ke `decision_sessions(id)` dengan aturan `ON DELETE CASCADE`.
- Jejak audit terikat ke `users(id)` dan `decision_sessions(id)` dengan aturan `ON DELETE SET NULL`.
- Foreign key terverifikasi aktif pada MariaDB dan SQLite memory test.

### 5.3 Analisis Constraint & Indeks
- **Constraint Unik Kriteria**:
  - Kolom `criteria.code` memiliki indeks unik global `UNIQUE KEY (code)`.
  - Pada implementasi backend saat ini, `nextCriterionCode()` mencari kode terbesar dari seluruh tabel `criteria` (`C1..C4` di sesi 1 -> `C5` di sesi 2).
  - Jika sistem di masa mendatang menginginkan format kode kriteria berulang per siklus pemilihan (misal setiap pemilu kriteria dimulai dari C1), constraint unik ini harus diubah menjadi `UNIQUE KEY (session_id, code)`.
- **Constraint Unik Suara**:
  - `votes` memiliki `UNIQUE KEY uq_round_user (round_id, user_id)`. Mencegah secara fisik satu pengguna memilih lebih dari satu kali dalam putaran yang sama.
- **Constraint Unik Penilaian**:
  - `assessments` memiliki `UNIQUE KEY uq_assessment_item (session_id, user_id, candidate_id, criterion_id)`. Mencegah duplikasi skor sel matriks.

### 5.4 Integritas Sesi 1
- Sesi 1 berstatus `ratified` dengan tanggal `2026-11-04 14:11:17` hingga `2026-11-19 13:47:40`.
- 3 suara sah tercatat pada putaran 1 dengan timestamp identik.
- Seluruh 36 sel penilaian dan 4 kriteria dengan bobot total 100% tersimpan aman.

---

## 6. Audit Keamanan

| Parameter | Evaluasi | Status | Catatan / Rekomendasi |
|---|---|---|---|
| **Penyimpanan Password** | `password_hash()` BCRYPT | AMAN | Salt acak otomatis, cost default PHP. |
| **Penyimpanan Token** | Stateless HMAC-SHA256 | AMAN | Ditandatangani rahasia `APP_KEY`, divalidasi ke DB. |
| **Pencegahan SQL Injection** | PDO Prepared Statements | AMAN | Seluruh input parameter diikat via placeholder `?`. |
| **Perlindungan CORS** | Whitelist Origin Terbatas | AMAN | Memeriksa origin terhadap config dan port lokal resmi. |
| **Perlindungan XSS** | React Virtual DOM + JSON | AMAN | Otomatis di-escape oleh React, output JSON dinormalisasi. |
| **Rate Limiting Login** | Tabel `login_attempts` | AMAN | 5 percobaan gagal per 15 menit diblokir. |
| **Rate Limiting Registrasi** | Belum ada limiter | MEDIUM | Perlu ditambahkan pembatasan IP pada endpoint pendaftaran. |
| **Header Web Server** | `.htaccess` Apache | MEDIUM | Perlu memastikan `HTTP_AUTHORIZATION` diteruskan di Apache/Laragon. |

---

## 7. Audit UX/UI

### 7.1 Sudut Pandang Ketua Panel (Chair / DM1)
- **Kelebihan**: Alur kerja dari penilaian, melihat hasil SAW, mengagregasi Borda, membuka voting, mengesahkan keputusan, hingga membuat siklus baru berjalan intuitif. Modal konfirmasi ganda pada tindakan penting (finalisasi kriteria, finalisasi kandidat, buka voting, sahkan keputusan, buat pemilu) sangat baik mencegah kesalahan klik.
- **Kekurangan**:
  - Tidak memiliki akses visual ke Riwayat Audit Log untuk memantau waktu login dan voting panelis.
  - Tidak ada tombol cetak laporan resmi / Berita Acara Keputusan untuk arsip fisik.
  - Pada dashboard tidak tertera nama siklus pemilihan yang sedang berjalan.

### 7.2 Sudut Pandang Anggota Panel (Member / DM2 & DM3)
- **Kelebihan**: Hak akses dibatasi dengan jelas. Anggota hanya melihat data master yang sudah difinalisasi, dapat mengisi matriks penilaian secara interaktif dengan indikator kelengkapan progresif, dan dapat memberikan suara voting secara aman.
- **Kekurangan**:
  - Jika sesi baru dibuat dan kriteria belum disiapkan Ketua, halaman penilaian hanya menampilkan tabel kosong tanpa petunjuk penjelasan yang memadai.

### 7.3 Sudut Pandang Pemilih Publik (Voter)
- **Kelebihan**: Akses terbatas hanya pada data publik (Profil Kandidat, Hasil Voting, Keputusan Final, Riwayat Siklus Pemilihan).
- **Kekurangan**:
  - Pada halaman Voting, pemilih publik dapat melihat antarmuka voting namun menerima pesan bahwa mereka bukan pemilih sah. Sebaiknya pemilih publik langsung diarahkan ke ringkasan status voting publik tanpa tombol pemilihan.

---

## 8. Audit Testing

### 8.1 Backend Test Suite (`backend/tests/run.php`)
- Total Test: **63 test cases** (100% Lulus).
- Cakupan Pengujian:
  - Keamanan Autentikasi: Test 1–3, 17–20 (9 test).
  - SAW & Borda Matematika: Test 5–7, 16, 21 (5 test).
  - Voting & Konsensus: Test 8–15, E1–E13 (21 test).
  - Multi-Sesi & Siklus (Phase 4): P4-1 s.d. P4-17 (17 test).
  - Manajemen Kriteria & Kandidat (Phase 5): P5-1 s.d. P5-12 (12 test).
- Waktu eksekusi: ~1.2 detik (sangat cepat, menggunakan SQLite in-memory yang sepenuhnya mencerminkan skema MySQL).

### 8.2 Frontend Test Suite (Vitest)
- Total Test Files: **14 files** (100% Lulus).
- Total Tests: **86 test cases** (100% Lulus).
- Semua komponen vital memiliki pengujian regresi: auth, kriteria, kandidat, penilaian, SAW, Borda, voting, sinkronisasi polling, pengesahan, dan siklus pemilu.

---

## 9. Daftar Temuan Berdasarkan Prioritas

### 9.1 Critical (Blokir Build / Produksi)
| ID | Lokasi | Masalah | Dampak | Rekomendasi Solusi |
|---|---|---|---|---|
| **C-1** | `frontend/src/features/candidates/CandidateListPage.test.tsx` (baris 99) | `el.textContent` tanpa optional chaining pada custom matcher: `error TS18047: 'el' is possibly 'null'`. | Perintah `npm run build` gagal total; CI/CD dan deployment produksi terhenti. | Ubah menjadi `el?.textContent?.includes('Program A') ?? false`. |
| **C-2** | `frontend/src/features/criteria/CriteriaPage.test.tsx` (baris 111) | `el.textContent` tanpa optional chaining pada custom matcher: `error TS18047: 'el' is possibly 'null'`. | Perintah `npm run build` gagal total; CI/CD dan deployment produksi terhenti. | Ubah menjadi `el?.textContent?.includes('Perhatian Bobot') ?? false`. |

### 9.2 High (Integritas Fitur & Fungsionalitas)
| ID | Lokasi | Masalah | Dampak | Rekomendasi Solusi |
|---|---|---|---|---|
| **H-1** | `backend/src/App.php` & `backend/public/index.php` | Tidak ada endpoint API untuk membaca data tabel `audit_logs`. | 96 log aktivitas sensitif di database tidak dapat diakses atau diverifikasi oleh Ketua Panel. | Buat endpoint `GET /api/audit-logs` (khusus role `chair`) dengan filter `session_id`, pagination, dan pencarian aksi. |
| **H-2** | `frontend/src/features` | Belum ada halaman antarmuka Audit Trail Log di frontend. | Ketua Panel tidak memiliki sarana audit visual pada sistem GDSS. | Buat halaman `AuditLogPage.tsx` dan tambahkan menu "Log Aktivitas" pada sidebar Ketua Panel. |
| **H-3** | `frontend/src/features/voting/FinalDecisionPage.tsx` | Belum ada fitur cetak laporan / Berita Acara Keputusan resmi. | Pengambilan keputusan GDSS tidak dapat diekspor ke format dokumen fisik/PDF untuk pengesahan resmi panel. | Tambahkan tombol Cetak / Ekspor Berita Acara (print-optimized stylesheet atau PDF export). |

### 9.3 Medium (UX & Konsistensi Sistem)
| ID | Lokasi | Masalah | Dampak | Rekomendasi Solusi |
|---|---|---|---|---|
| **M-1** | `frontend/src/features/dashboard/DashboardPage.tsx` | Dashboard tidak menampilkan identitas / nama siklus pemilihan yang sedang aktif. | Pengguna tidak dapat langsung mengetahui pemilihan mana yang sedang berlangsung saat membuka aplikasi. | Tampilkan banner/kartu informasi sesi pemilihan aktif (Judul Pemilu, Deskripsi, Status Siklus). |
| **M-2** | `backend/public/index.php` (baris 283) | `POST /api/assessments/me/finalize` tidak meneruskan `querySessionId()`. | Inkonsistensi arsitektur terhadap prinsip parameter sesi eksplisit. | Teruskan `querySessionId()` ke method `finalizeAssessmentsMe($currentUser, querySessionId())`. |
| **M-3** | `frontend/src/features/assessments/AssessmentInputPage.tsx` | Tampilan tabel penilaian kosong tanpa pesan pemandu jika kriteria/kandidat belum difinalisasi. | Anggota Panel bingung mengapa tidak ada baris penilaian yang muncul pada siklus baru. | Tampilkan empty state informatif jika kriteria/kandidat belum disiapkan. |
| **M-4** | `backend/public/.htaccess` | Belum ada direktif eksplisit untuk mempertahankan header `Authorization` pada mode FastCGI Apache. | Berpotensi menyebabkan error 401 palsu pada konfigurasi Laragon/Apache tertentu. | Tambahkan `RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]` pada `.htaccess`. |

### 9.4 Low (Penyempurnaan & Optimasi)
| ID | Lokasi | Masalah | Dampak | Rekomendasi Solusi |
|---|---|---|---|---|
| **L-1** | `backend/src/App.php` (baris 475) | `nextCriterionCode()` mencari kode terbesar dari seluruh tabel, bukan per sesi. | Kode kriteria berlanjut secara global (`C5..C8`) di sesi baru. | Dokumentasikan sebagai spesifikasi global sequence atau ubah constraint jika disyaratkan. |
| **L-2** | `backend/src/App.php` (baris 304) | Endpoint pendaftaran `register()` belum memiliki rate limiting berbasis IP. | Risiko spam registrasi akun voter massal. | Terapkan rate limiter IP pada pendaftaran akun voter publik. |

---

## 10. Rekomendasi Implementasi Phase 6

Berdasarkan audit di atas, Phase 6 dirancang sebagai **Production Hardening, Audit Trail Viewer, Official Report Generation, & UX Refinement**.

### Paket Pekerjaan Phase 6 (Usulan):
1. **Paket 1: Build & Type Safety Fix (Mandatory / Blocker)**
   - Perbaiki 2 error TypeScript pada `CandidateListPage.test.tsx` dan `CriteriaPage.test.tsx`.
   - Pastikan `npm run build` sukses 100%.
2. **Paket 2: Audit Trail Log Module (Feature Completion)**
   - Backend: Method `App::listAuditLogs(?array $user, ?int $sessionId, int $limit, int $offset)` + endpoint `GET /api/audit-logs`.
   - Frontend: Komponen `AuditLogPage.tsx` dengan filter event, pencarian pengguna, dan tabel timestamp lengkap.
   - Hak akses: Terbatas hanya untuk Ketua Panel (`chair`).
3. **Paket 3: Official Decision Report & Print View (Feature Completion)**
   - Frontend: Tampilan Berita Acara Pengesahan Keputusan Final terstandarisasi dengan layout cetak resmi (`@media print` clean report layout).
   - Memuat: Nomor Siklus, Tanggal Pengesahan, Nama Pemenang, Rekap Perolehan Suara, Persentase Mayoritas, Alasan Pengesahan Ketua Panel, dan Tanda Tangan 3 Anggota Panel.
4. **Paket 4: Dashboard & Session Context Enhancement (UX Refinement)**
   - Tambahkan banner Siklus Pemilihan Aktif pada Dashboard dengan status lifecycle yang jelas.
   - Tambahkan empty state informatif pada `AssessmentInputPage` ketika kandidat/kriteria sesi baru belum siap.
5. **Paket 5: Server Config Hardening**
   - Tambahkan rule `HTTP_AUTHORIZATION` pada `.htaccess` untuk kompatibilitas Laragon.
   - Tambahkan `querySessionId()` pada route `POST /api/assessments/me/finalize`.

---

## 11. Risiko dan Dampak Perubahan

| Aksi yang Direncanakan | Potensi Risiko | Tingkat Risiko | Mitigasi |
|---|---|---|---|
| Perbaikan TypeScript Test Matcher | Tidak ada (hanya penambahan optional chaining pada test) | Rendah | Jalankan Vitest untuk verifikasi test tetap lolos. |
| Penambahan Endpoint `GET /api/audit-logs` | Penurunan performa jika log sangat besar | Rendah | Gunakan pagination (`LIMIT`, `OFFSET`) dan indeks `idx_audit_session`. |
| Penambahan Halaman `AuditLogPage.tsx` | Bundle size bertambah sedikit | Rendah | Gunakan `React.lazy()` route-level code splitting seperti halaman lainnya. |
| Penambahan Print Layout Berita Acara | Format cetak terpotong di browser tertentu | Rendah | Gunakan CSS print styling standar (`print:hidden`, `print:block`, page breaks). |
| Penambahan Banner Sesi di Dashboard | Kueri tambahan saat load dashboard | Sangat Rendah | Gunakan cache query yang sudah tersedia (`useQuery` TanStack). |
| Data Sesi 1 | **TIDAK ADA PERUBAHAN** | Nol | Seluruh perubahan read-only dan penambahan route baru. Tidak ada DDL/DML ke data sesi 1. |

---

## 12. Acceptance Criteria Phase 6

1. **Build Acceptance**:
   - `npm run build` pada frontend berjalan sukses tanpa error TypeScript maupun warning fatal.
   - `php -l` pada backend tidak menghasilkan syntax error.
2. **Audit Trail Acceptance**:
   - Ketua Panel dapat membuka menu "Log Aktivitas" dan melihat seluruh 96+ riwayat aksi dengan waktu, pengguna, aksi, IP, dan detail kejadian.
   - Anggota Panel dan Pemilih Publik menerima 403 Forbidden jika mencoba mengakses endpoint audit log.
3. **Official Report Acceptance**:
   - Pada halaman Keputusan Final, tersedia tombol "Cetak Berita Acara".
   - Tampilan cetak rapi, bersih dari elemen navigasi/sidebar, dan siap dicetak atau disimpan sebagai PDF.
4. **Dashboard Context Acceptance**:
   - Dashboard menampilkan judul siklus pemilihan yang sedang aktif dan badge status siklusnya.
5. **Integritas Sesi 1 Acceptance**:
   - Seluruh data Sesi 1 (4 kriteria, 3 kandidat, 36 assessment, 1 voting round, 3 votes, 1 decision) tetap 100% identik sebelum dan sesudah pengerjaan.
   - Fingerprint database tetap cocok.

---

## 13. Rencana Regression Testing

1. **Automated Backend Regression**:
   - Jalankan seluruh 63 test backend eksisting + tambahkan minimal 4 test baru untuk audit log endpoint dan otorisasi.
   - Target: 67/67 PASS.
2. **Automated Frontend Regression**:
   - Jalankan seluruh 86 unit/integration test eksisting + tambahkan test baru untuk komponen AuditLog dan Print Report.
   - Target: >90 tests PASS.
3. **Database Fingerprint Comparison**:
   - Jalankan script fingerprint PHP sebelum dan sesudah pengerjaan untuk membuktikan 0 mutasi data sesi 1.
4. **Manual End-to-End Walkthrough**:
   - Login sebagai `dm1` (Ketua), periksa Dashboard banner -> periksa Log Aktivitas -> buka Keputusan Final -> uji cetak Berita Acara.
   - Login sebagai `dm2` (Anggota), pastikan menu Log Aktivitas tidak muncul.

---

## 14. Kesimpulan Kesiapan Implementasi

Sistem Pilpress telah memiliki pondasi arsitektur yang solid, algoritma GDSS yang presisi, serta integritas data yang teruji. Masalah yang ditemukan tidak bersifat merusak logika bisnis inti, melainkan terkait **kelengkapan alat audit, pelaporan resmi, penyempurnaan UI/UX, dan perbaikan type checking build**.

**Rekomendasi Final**:
Phase 6 **SIAP DIIMPLEMENTASIKAN** segera setelah mendapatkan persetujuan terhadap lingkup pekerjaan dan rencana di atas.

---
*Dokumen ini disusun tanpa melakukan perubahan source code, skema database, maupun data produksi.*
