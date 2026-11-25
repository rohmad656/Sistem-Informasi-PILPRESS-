> [!NOTE]
> Historical phase snapshot. Wording/data reflects then-current methodology. Final methodology: TOPSIS (multicriteria), Borda (aggregation), SAW (legacy comparison).

# FINAL QA REPORT — PILPRESS PHASE 6

**Tanggal:** 4 November 2026
**Lingkup:** Final polish & comprehensive quality assurance (Phase 6)
**Status keseluruhan:** CONDITIONALLY READY — QA teknis lulus; uji voting pada data pemilihan nyata belum dijalankan (lihat §20–21).

---

## 1. Executive Summary

Phase 6 melakukan audit menyeluruh terhadap frontend React/Vite, backend PHP native, skema MySQL, dokumentasi, dan test suite. Tidak ada rebuild arsitektur, tidak ada perubahan metodologi SAW/Borda, dan tidak ada operasi destruktif pada database.

Defect yang ditemukan dan diperbaiki:

| # | Defect | Dampak | Perbaikan |
|---|---|---|---|
| 1 | `getAssessmentsStatus()` menghitung seluruh `users`, termasuk `voter` | Voting tidak akan pernah bisa dibuka karena voter tidak pernah finalisasi penilaian | Query dibatasi `role IN ('chair','member')` |
| 2 | `calculateBorda()` mengagregasi seluruh `users`, termasuk `voter` tanpa penilaian | Poin Borda terdistorsi oleh ranking kosong voter | Query dibatasi `role IN ('chair','member')` |
| 3 | `VotingPage` memakai `totalVoters = 3` hardcoded | Jumlah pemilih/partisipasi salah saat electorate bertambah | Memakai `eligible_voters` dari backend |
| 4 | Payload status voting tidak mengekspos eligibility | UI tidak bisa membedakan pemilih terdaftar vs bukan | Field aditif: `eligible_voters`, `required_votes`, `majority_threshold`, `is_eligible` |
| 5 | Literal `\n` di JSX | Karakter stray tampil di UI | Dihapus |
| 6 | Endpoint kandidat, kriteria, hasil voting, keputusan, status penilaian, Borda dapat diakses tanpa token | Kebocoran data & melemahkan otorisasi | Guard autentikasi + role di router |
| 7 | CORS default tidak memuat port Vite 3001 | Preflight dari origin frontend gagal | Default origin 3001 ditambahkan dan digabung dengan konfigurasi env |
| 8 | Emoji tersisa di beberapa halaman | Melanggar aturan UI | Diganti ikon Lucide React |
| 9 | Modal tanpa `role="dialog"`, `aria-modal`, Escape, fokus awal | Aksesibilitas rendah | Atribut ARIA + Escape + fokus |
| 10 | Sidebar selalu 256px di mobile | Layout rusak pada 320px | Drawer off-canvas + tombol menu |
| 11 | Tabel tanpa wrapper overflow | Overflow horizontal di mobile | `overflow-x-auto` + `min-w` |
| 12 | Label form registrasi tidak terhubung ke input | Screen reader tidak akurat | `htmlFor`/`id` + `aria-label` tombol password |
| 13 | Bundle awal ~719 kB memuat Recharts | Waktu muat awal besar | Route-level lazy loading; Recharts di chunk terpisah |
| 14 | README memuat password demo dan `APP_KEY` | Kebocoran rahasia di dokumentasi | Nilai rahasia dihapus; instruksi provisioning |

---

## 2. Final Architecture

| Layer | Teknologi |
|---|---|
| Frontend | React 18.3, Vite 5.4, TypeScript 5.6, Tailwind CSS 3.4, React Router 6.26, TanStack Query 5.59, Recharts 2.13, Lucide React |
| Backend | PHP 8 native, PDO, REST API, HMAC-SHA256 Bearer token (1 jam) |
| Database | MySQL/MariaDB `gdss_pemilihan_presiden` |
| Auth | Token stateless payload+signature, password Bcrypt |
| Environment | Laragon/XAMPP, backend `127.0.0.1:8080`, frontend Vite `localhost:3000` (port aktual dapat bergeser ke 3001) |

Tidak ada backend kedua dan tidak ada perubahan pada `DecisionService` untuk rumus SAW/Borda.

---

## 3. Database Integrity

Read-only inspection pada `gdss_pemilihan_presiden`:

| Tabel | Status |
|---|---|
| `users`, `candidates`, `criteria`, `assessments`, `assessment_status` | ADA |
| `decision_sessions`, `voting_rounds`, `votes`, `final_decisions` | ADA |
| `session_voters` | ADA, PK komposit `(session_id, user_id)` |
| `audit_logs`, `login_attempts` | ADA |

Data aktual:

| Item | Nilai |
|---|---|
| Total user | 8 |
| `dm1` | `chair` |
| `dm2`, `dm3` | `member` |
| `voter1` | `voter` |
| `testuser_1491913741`, `testproxy_1854160100`, `uitestvoter_1093219771` | `voter` (akun uji Phase 5) |
| `qa_voter_1793827344` | `voter` (dibuat saat uji live Phase 6) |
| Assessment records | 36 |
| `assessment_status` | 3 baris, belum finalisasi |
| `votes` | 0 |
| `voting_rounds` | 0 |
| `session_voters` | 0 |
| Status sesi | `assessment`, `current_round = 0` |

**Temuan:** laporan Phase 5 menyebut total 6 user, aktual 7 sebelum Phase 6 (3 panel + 4 voter uji). Phase 6 menambah 1 akun uji live menjadi 8. Tidak ada user dihapus. Tidak ada riwayat voting yang berubah karena memang belum ada voting.

**Rekomendasi pemilik proyek:** putuskan apakah 5 akun voter uji akan dipertahankan atau dinonaktifkan sebelum pemilihan nyata. Jangan hapus user tanpa persetujuan; snapshot electorate akan membekukan daftar saat voting dibuka.

Status: **PASS (integritas) / ATTENTION (akun uji perlu keputusan pemilik)**.

---

## 4. Authentication and Registration

| Uji | Metode | Hasil |
|---|---|---|
| Login chair (`dm1`) | Live API | PASS — role `chair`, token 144 char |
| Login member | Test suite (Test 1, 2) | PASS |
| Login voter | Live API (akun QA baru) | PASS |
| Kredensial salah | Test suite (Test 2) + frontend test | PASS |
| Tanpa token | Live API | PASS — HTTP 401 |
| Registrasi publik | Live API | PASS — HTTP 201, role `voter` |
| Duplikat username | Backend Test 18 | PASS — HTTP 409 |
| Role tidak dapat dipilih saat registrasi | Backend Test 18 + kode | PASS — role dipaksa `voter` |
| Logout | Kode & UI | PASS (token stateless dihapus klien) |
| Token expiry | Kode (`exp` 1 jam, dicek) | PASS (verifikasi kode, bukan clock-mock) |

Catatan: login `voter1` gagal dengan password demo karena password akun tersebut tidak diketahui; pengujian voter memakai akun QA baru.

---

## 5. Role and Permission Verification

| Aksi | Chair | Member | Voter | Bukti |
|---|---|---|---|---|
| Isi/finalisasi penilaian | Ya | Ya | Tidak | Guard `chair/member`; live 403 |
| Lihat SAW pribadi | Ya | Ya | Tidak | Live voter 403 |
| Lihat Borda agregat | Ya | Ya | Tidak | Live voter 403; backend filter |
| Buka voting | Ya | Tidak | Tidak | Test 4; live voter 403 |
| Beri suara | Ya | Ya | Ya (jika snapshot) | Test 20 |
| Buka putaran ulang | Ya | Tidak | Tidak | `chair()` guard |
| Sahkan keputusan | Ya | Tidak | Tidak | Test 13 |
| Lihat status penilaian panel | Ya | Ya | Tidak | Live voter 403 |
| Lihat hasil voting & riwayat | Ya | Ya | Ya | Guard autentikasi |

Status: **PASS**.

---

## 6. Candidate and Criteria Verification

| Uji | Hasil |
|---|---|
| Daftar kandidat (3) | PASS |
| Detail kandidat | PASS (kode + API) |
| Daftar kriteria (4, bobot 25/30/25/20) | PASS |
| Endpoint memerlukan autentikasi | PASS — live 401 tanpa token |
| Tampilan responsif (grid 1/2/3 kolom) | PASS (kode) |
| Error state + tombol refetch | PASS (kode) |

---

## 7. Assessment Verification

| Uji | Hasil |
|---|---|
| Chair dapat menyimpan penilaian | PASS (test suite) |
| Member dapat menyimpan penilaian | PASS (test suite) |
| Voter ditolak | PASS — live 403 |
| Skor 1–5 divalidasi | PASS (`validateScore`) |
| Wajib tepat 12 entri (3×4) | PASS (Test 5) |
| Penilaian tidak lengkap ditolak 422 | PASS (Test 5) |
| Finalisasi mengunci nilai | PASS (kode + Test 8) |
| Status panel tersinkronisasi | PASS — `total_panelists = 3`, voter dikecualikan |
| Modal finalisasi aksesibel | PASS (role, aria-modal, Escape, klik backdrop) |

Status: **PASS**.

---

## 8. SAW Validation

Diuji pada database SQLite terisolasi (`backend/tests/run.php`), bukan pada data pemilihan aktif.

| DM | Kandidat A | Kandidat B | Kandidat C | Referensi Excel | Hasil |
|---|---|---|---|---|---|
| DM1 | 91.0 | 85.0 | 79.0 | 91 / 85 / 79 | PASS |
| DM2 | 86.0 | 96.0 | 78.0 | 86 / 96 / 78 | PASS |
| DM3 | 95.0 | 76.0 | 85.0 | 95 / 76 / 85 | PASS |

Live API mengembalikan 409 karena assessment live belum difinalisasi — perilaku benar, data tidak diubah.

Status: **PASS (isolated test) / NOT TESTED (live data, sengaja)**.

---

## 9. Borda Validation

| Kandidat | Poin | Persentase | Referensi | Hasil |
|---|---|---|---|---|
| A | 8.0 | 44.44% | 8 / 44.44% | PASS |
| B | 6.0 | 33.33% | 6 / 33.33% | PASS |
| C | 4.0 | 22.22% | 4 / 22.22% | PASS |

Tie-sharing Borda diuji terpisah (Test 16): A=7.5, B=7.5, C=3.0, total 18.0 — PASS.
Test 21 memastikan voter tanpa penilaian tidak masuk agregasi — PASS.

Status: **PASS (isolated test) / NOT TESTED (live data, sengaja)**.

---

## 10. Voting and Revote Validation

| Uji | Hasil |
|---|---|
| Ketua membuka voting setelah semua panel finalisasi | PASS (Test 8, 10) |
| Member/voter tidak dapat membuka voting | PASS (Test 4, live 403) |
| Snapshot dibuat saat putaran pertama dibuka | PASS (kode + Test 19) |
| Snapshot memuat chair + member + voter terdaftar | PASS (Test 20) |
| Snapshot tidak berubah saat revote | PASS (kode: hanya dibuat jika count = 0) |
| Pendaftar setelah snapshot ditolak 403 | PASS (Test 19) |
| Duplikat suara ditolak 409 | PASS (Test 9) |
| Suara di luar electorate ditolak 403 | PASS (Test 19) |
| Ambang mayoritas `ceil(2n/3)` dari snapshot | PASS (kode + payload live) |
| 2-1 menghasilkan mayoritas | PASS (Test 10) |
| 1-1-1 menghasilkan `tie_revote` | PASS (Test 11) |
| Revote menyimpan putaran terpisah | PASS (Test 12) |
| Putaran lama tidak dihapus | PASS (kode, append-only) |
| Status payload memuat jumlah pemilih & ambang | PASS (live) |
| UI memakai angka backend, bukan hardcoded | PASS (frontend test + kode) |
| Uji voting pada data pemilihan nyata | NOT TESTED — sengaja tidak dijalankan agar data tidak berubah |

Status: **PASS (isolated test) / NOT TESTED (live election)**.

---

## 11. Decision Approval Validation

| Uji | Hasil |
|---|---|
| Hanya ketua dapat mengesahkan | PASS (Test 13) |
| Pengesahan hanya setelah mayoritas sah | PASS (kode, 409) |
| Pengesahan ganda ditolak | PASS (Test 15) |
| Hasil final dapat diakses semua DM | PASS (Test 14) |
| Riwayat putaran + keputusan | PASS (kode, guard autentikasi) |
| Modal pengesahan aksesibel + alasan wajib | PASS (kode) |

Status: **PASS (isolated test)**.

---

## 12. UI/UX Audit

| Item | Hasil |
|---|---|
| Palet navy `#1A2332`, red `#C92A2A`, gold `#F59E0B`, canvas `#F8F9FA`, surface `#FFFFFF` | PASS (Tailwind config) |
| Font Plus Jakarta Sans | PASS |
| Lucide React konsisten | PASS |
| Emoji UI dihapus | PASS — pemindaian karakter Unicode dekoratif bersih |
| Tombol, form, badge, card, modal konsisten | PASS (inspeksi kode) |
| Gradient dekoratif berlebihan | Tidak ditemukan; gradient hanya pada header status |
| Spacing & tipografi | PASS (inspeksi kode) |

Catatan: verifikasi visual akhir di browser tetap diperlukan (lihat §20).

---

## 13. Accessibility Audit

| Item | Hasil |
|---|---|
| Label form terhubung (`htmlFor`/`id`) | PASS — login, registrasi, alasan pengesahan |
| `aria-label` pada tombol ikon (menu, sidebar, show password) | PASS |
| `aria-pressed` pada tombol skor & show password | PASS |
| Modal `role="dialog"`, `aria-modal`, `aria-labelledby` | PASS |
| Escape menutup modal/drawer | PASS |
| Fokus awal ke dialog | PASS |
| `aria-current="page"` pada navigasi | PASS |
| `focus:ring-2` pada kontrol utama | PASS |
| Kontras warna | PASS (inspeksi kode; belum diukur dengan alat) |
| Uji screen reader nyata | NOT TESTED |
| Audit WCAG 2.2 AA penuh | NOT TESTED — tidak diklaim |

---

## 14. Responsive Test Results

Perbaikan layout diterapkan: sidebar menjadi drawer di bawah `md`, tabel memakai `overflow-x-auto` + `min-w`, header menggunakan `flex-wrap`, konten `min-w-0`.

| Breakpoint | Status |
|---|---|
| 320 / 375 / 390 / 430 px | PASS (kode) / NOT TESTED (browser) |
| 768 / 1024 px | PASS (kode) / NOT TESTED (browser) |
| 1280 / 1440 / 1920 px | PASS (kode) / NOT TESTED (browser) |

Tidak ada browser automation (Playwright) di lingkungan ini; pengujian visual aktual Chrome/Edge belum dijalankan.

---

## 15. Performance Measurements

| Metrik | Sebelum | Sesudah |
|---|---|---|
| Bundle JS awal | ~719 kB | **223.42 kB** (gzip 70.39 kB) |
| Chunk halaman | Satu bundle besar | Route-level lazy chunks (15.34 kB, 22.13 kB, dst.) |
| Recharts | Dimuat di bundle awal | Hanya dimuat pada halaman chart (Saw/Borda/VotingResults) |
| CSS | 27.85 kB | 29.55 kB (gzip 5.67 kB) |
| Build | Sukses | Sukses (9.19 s) |

Optimasi dilakukan dengan `React.lazy` + `Suspense`; tidak ada fitur yang dihapus. Polling 5 detik pada halaman hasil voting dipertahankan.

---

## 16. Security Findings

| Item | Hasil |
|---|---|
| Registrasi tidak dapat memilih role chair/member | PASS |
| Password hash tidak pernah diekspos API | PASS |
| Bearer token tidak dicetak ke log | PASS (inspeksi kode) |
| Aksi ketua dilindungi backend | PASS |
| Voter tidak dapat mengakses penilaian/SAW/Borda/status panel | PASS — live 403 |
| Voter tidak dapat membuka voting/revote | PASS — live 403 |
| Duplikat voting ditolak backend | PASS |
| Eligibility snapshot ditegakkan | PASS |
| CORS hanya origin terdaftar (default + env), preflight 3001 | PASS — live header `Access-Control-Allow-Origin: http://localhost:3001` |
| Query memakai prepared PDO | PASS |
| Error tidak mengekspos rahasia | PASS |
| `.env` tidak di-commit | PASS (tidak ada commit) |
| Dokumentasi tidak memuat password/APP_KEY | PASS (setelah perbaikan README) |

Catatan: `npm audit` melaporkan 8 advisory pada rantai dev/build (5 moderate, 1 high, 2 critical). Tidak ada dependency runtime baru selain dev-test. Perlu ditinjau sebelum produksi.

---

## 17. Backend Test Results

```text
php -l src/App.php              -> No syntax errors
php -l src/DecisionService.php  -> No syntax errors
php -l public/index.php         -> No syntax errors
php -l tests/run.php            -> No syntax errors
php tests/run.php               -> Total Lulus: 21, Total Gagal: 0
```

Test 1–16 lama tetap lulus; Test 17–21 baru mencakup:
17. Voter tidak dihitung dalam status penilaian panel
18. Registrasi memaksa role `voter` + duplikat ditolak
19. Snapshot beku + pendaftar setelahnya ditolak 403
20. Voter dalam snapshot dapat memilih
21. Borda mengabaikan voter tanpa penilaian

Status: **PASS (21/21)**.

---

## 18. Frontend Test Results

Infrastruktur baru: Vitest 2.1.9 + React Testing Library 16 + jest-dom + user-event + jsdom. Dipilih karena belum ada test runner frontend dan stack React 18 kompatibel.

```text
npm test  -> Test Files 4 passed (4), Tests 12 passed (12)
```

Cakupan:
- Login: validasi kosong, pemanggilan kredensial, error backend.
- Registrasi: konfirmasi password tidak cocok, pemanggilan API, duplikat username.
- ProtectedRoute: redirect tanpa sesi, izin role sesuai, voter ditolak dari rute panel.
- Voting: jumlah pemilih/ambang dari backend, notice ineligible, state sudah memilih.

```text
npx tsc --noEmit -> exit 0
```

Status: **PASS (12/12, typecheck bersih)**.

---

## 19. Production Build

```text
npm run build -> built in 9.19s
dist/index.html                 0.80 kB (gzip 0.47 kB)
dist/assets/index-*.css        29.55 kB (gzip 5.67 kB)
dist/assets/index-*.js        223.42 kB (gzip 70.39 kB)
```

Tidak ada error build. Status: **PASS**.

Verifikasi integrasi live tambahan: Vite dev server berhasil melayani aplikasi (port 3002 karena 3000/3001 sedang terpakai) dan proxy `/api` meneruskan request ke backend `127.0.0.1:8080` (respons 401 untuk request tanpa token, sesuai harapan).

---

## 20. Known Limitations

1. **Voting live belum diuji** pada data pemilihan aktif. Snapshot kosong dan penilaian live belum finalisasi. Pengujian end-to-end voting dilakukan pada database SQLite terisolasi agar data asli tidak berubah.
2. **Browser visual test belum dijalankan** (Chrome/Edge, semua breakpoint). Verifikasi responsif berbasis inspeksi kode.
3. **WCAG 2.2 AA belum diaudit penuh** dengan screen reader/axe.
4. **Akun uji voter** (5 akun) masih ada di database. Pemilik proyek harus memutuskan sebelum pemilihan nyata.
5. **`npm audit`** melaporkan advisory pada toolchain dev; belum ada remediasi yang dilakukan untuk menghindari perubahan dependency di luar lingkup.
6. **Live SAW/Borda** mengembalikan 409 selama penilaian belum finalisasi; ini perilaku yang benar, bukan defect.
7. Tidak ada commit/push yang dilakukan.

---

## 21. Release Readiness Decision

| Kriteria | Status |
|---|---|
| Login semua role | PASS |
| Registrasi & role voter | PASS |
| Halaman kandidat & kriteria | PASS |
| Penilaian simpan/finalisasi | PASS |
| SAW sesuai Excel | PASS (isolated) |
| Borda sesuai Excel | PASS (isolated) |
| Direct voting | PASS (isolated) |
| Eligibility voter | PASS |
| Duplikat voting ditolak backend | PASS |
| Revote menyimpan putaran lama | PASS (isolated) |
| Pengesahan ketua | PASS (isolated) |
| Riwayat keputusan | PASS |
| Layout responsif | PASS (kode) / NOT TESTED (browser) |
| Emoji dekoratif | PASS (bersih) |
| PHP syntax | PASS |
| Backend tests | PASS 21/21 |
| TypeScript | PASS |
| Production build | PASS |
| Integrasi live | PASS (auth, registrasi, guard, CORS) |
| Voting pada data nyata | NOT TESTED (sengaja) |

**Keputusan:** **CONDITIONALLY READY FOR RELEASE.**
Kode lulus QA teknis dan seluruh automated test. Sebelum pemilihan nyata, pemilik proyek harus:
1. Menentukan nasib akun voter uji.
2. Menjalankan satu siklus UAT voting end-to-end di database uji terpisah.
3. Melakukan verifikasi visual browser pada breakpoint yang ditargetkan.

Tidak ada commit atau push yang dilakukan. Menunggu review pemilik proyek.
