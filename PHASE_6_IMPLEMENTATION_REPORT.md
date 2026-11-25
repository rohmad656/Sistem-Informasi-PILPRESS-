> [!NOTE]
> Historical phase snapshot. Wording/data reflects then-current methodology. Final methodology: TOPSIS (multicriteria), Borda (aggregation), SAW (legacy comparison).

# Phase 6 — Implementation Report

Tanggal: 2026-11-20\
Status: **READY WITH LIMITATIONS**\
Referensi: `PHASE_6_AUDIT_REPORT.md`

---

## 1. Ringkasan

Phase 6 menambahkan alat audit, laporan cetak resmi, konteks siklus aktif pada dashboard, empty state penilaian, serta regresi UI/backend. Tidak ada perubahan pada algoritma SAW, Borda, voting, finalisasi keputusan, data historis, atau skema database. Tidak ada tabel baru, tidak ada dummy audit log, tidak ada operasi destruktif pada data produksi.

---

## 2. Perubahan Implementasi

### 2.1 Audit Trail

**Backend**
- `backend/src/App.php`
  - `listAuditLogs()` menerima filter `user_id`, `action`, `date_from`, `date_to` di samping `session_id`, `limit`, `offset`.
  - Filter memakai prepared statement; `LIMIT ? OFFSET ?` di-bind dengan `PDO::PARAM_INT` agar aman pada MySQL native prepares.
  - `ORDER BY al.id DESC` (terbaru lebih dulu); `COUNT(*)` memakai filter sama.
  - Otorisasi via `chair()` → `actor()`: 401 tanpa token, 403 untuk `member`/`voter`.
  - Resolusi sesi memakai `resolveSessionId()` / session resolver resmi, bukan asumsi ID maksimum.
- `backend/public/index.php`: route `GET /api/audit-logs` membaca dan meneruskan `user_id`, `action`, `date_from`, `date_to`.
- Tidak ada kolom baru. Field response: `id`, `session_id`, `user_id`, `action`, `details`, `ip_address`, `created_at`, `user_name`, `user_role`. Tidak ada password/token.

**Frontend**
- `frontend/src/services/api.ts`: `getAuditLogs(...)` dengan `URLSearchParams`.
- `frontend/src/features/audit/AuditLogPage.tsx` (baru): tabel, filter, pagination, refresh, state loading/empty/error, copy khusus Ketua Panel.
- `frontend/src/app/App.tsx`: route `/audit-logs` dibungkus `ProtectedLayout allowedRoles={['chair']}`.
- `frontend/src/components/layout/Layout.tsx`: menu `Log Aktivitas` hanya untuk `chair`.

### 2.2 Berita Acara Keputusan Resmi

- `frontend/src/features/voting/FinalDecisionPage.tsx`
  - Tombol **Cetak Berita Acara** (`window.print()`) hanya saat keputusan final tersedia.
  - `OfficialDecisionReport`: 12 bagian (Identitas Dokumen, Deskripsi Siklus, Dasar Pengambilan Keputusan, Waktu & Status Pengesahan, Susunan Panel DM, Daftar Kriteria, Daftar Kandidat, Hasil SAW, Hasil Borda, Rekapitulasi Suara, Hasil Akhir, Pernyataan & Tanda Tangan).
  - Sumber data read-only; `getElection`/`getCriteria`/`getCandidates` diikat ke `decision.session_id`. Tidak ada mutasi keputusan.
  - Tiga slot tanda tangan DM1/DM2/DM3 dari `statusData.electorate` (fallback DM1 ke `approved_by_name`). Jika tidak ada, placeholder eksplisit `Nama panelis — diisi resmi`. Tidak ada identitas/persetujuan palsu.
- `frontend/src/index.css`: `@page { size: A4; margin: 16mm; }`, `@media print` menyembunyikan sidebar, navbar, tombol, `.no-print`; page-break diatur.
- `frontend/src/components/layout/Layout.tsx`: sidebar, backdrop mobile, top bar diberi kelas `no-print`.

### 2.3 Dashboard — Konteks Siklus Aktif

- `getActiveElection()` memanggil `GET /elections/active`.
- Banner "Siklus Pemilihan Aktif" menampilkan judul, deskripsi, ID sesi, status, putaran; state loading/error/empty; 404 = belum ada siklus aktif. Sumber dari resolver backend, bukan `max(id)`.

### 2.4 AssessmentInputPage — Empty State

- Matriks/tombol simpan hanya dirender bila kriteria dan kandidat tersedia serta keduanya final.
- Empty state membedakan kriteria/kandidat belum tersedia vs belum difinalisasi. Tidak ada kontrol konfigurasi anggota.

### 2.5 Perbaikan Tipe

- `CandidateListPage.test.tsx`, `CriteriaPage.test.tsx`: `el?.textContent` → `(el?.textContent ?? '')` untuk `TS18047`.

---

## 3. Audit Header Authorization (Laragon/Apache)

- Probe sementara `backend/public/__header_probe.php` dijalankan lalu dihapus.
- `Authorization: Bearer ...` diterima PHP sebagai `HTTP_AUTHORIZATION`; tidak ada `REDIRECT_HTTP_AUTHORIZATION`.
- Kegagalan propagasi tidak berhasil direproduksi; `.htaccess` dikembalikan ke isi semula.

---

## 4. Pengujian Otomatis (final)

| Pemeriksaan | Hasil |
|---|---|
| `php -l src/App.php`, `php -l public/index.php`, `php -l tests/run.php` | 0 syntax error |
| Backend `php tests/run.php` | **66/66 PASS** |
| `npx tsc --noEmit` | PASS |
| Frontend `npm test` | **97/97 PASS** (17 file test) |
| `npm run build` | PASS (Vite build sukses) |

Regression dijalankan ulang setelah QA visual; hasil identik.

---

## 5. Final Visual QA & Acceptance (2026-11-20)

### 5.1 Metode

- Playwright tidak tersedia dan tidak diinstal (tidak ada dependency baru). QA memakai **Chrome headless + Chrome DevTools Protocol (CDP)** langsung dari Node bawaan.
- Backend QA memakai `php -S 127.0.0.1:8080` dengan router khusus yang mengarah ke **salinan SQLite terpisah** (`phase6_qa.sqlite`), sehingga data historis produksi tidak berubah saat QA.
- Frontend dev server: Vite `127.0.0.1:3000`, proxy `/api` → `127.0.0.1:8080`.
- Viewport diuji: **1440×900** (desktop), **768×1024** (tablet), **390×844** (mobile).

### 5.2 Audit Trail

- Halaman dirender benar pada ketiga viewport (`h1` = "Log Aktivitas").
- Tidak ada horizontal overflow pada dokumen (`scrollWidth === clientWidth`) di semua viewport. Tabel audit berada dalam container scrollable pada mobile/tablet (lebar tabel 728 px, lebar dokumen 390/768 px).
- Filter `ID AKTOR`, `AKSI`, `DARI TANGGAL`, `SAMPAI TANGGAL` diterapkan → hanya baris `Ketua Panel` / `auth_login` pada rentang 19–20 Nov 2026 yang tampil.
- Pagination "Berikutnya" menampilkan baris yang berbeda (halaman 2).
- Kolom yang tampil: Waktu, Aktor, Peran, Aksi, Detail, IP. Tidak ada password/token/kredensial di DOM maupun response API.
- State loading/empty/error: tersedia di komponen dan dicakup unit test `AuditLogPage.test.tsx`.

### 5.3 Final Decision / Berita Acara

- 12 heading terdeteksi persis urut (`1. Identitas Dokumen` … `12. Pernyataan Pengesahan & Tanda Tangan`).
- Tombol **Cetak Berita Acara** hadir; unit test memastikan `window.print()` dipanggil.
- 3 slot tanda tangan terisi dari data nyata: `Ketua Panel (DM1)`, `Anggota Panel 1 (DM2)`, `Anggota Panel 2 (DM3)`. Placeholder `Nama panelis — diisi resmi` **tidak muncul** saat data electorate tersedia.
- Isi dokumen bersumber dari data aktual: judul siklus, ID #1, tanggal keputusan 19 Nov 2026 06.47, 4 kriteria (bobot 25/30/25/20), 3 kandidat, SAW 91/85/79, Borda 8/6/4 (44.44%/33.33%/22.22%), suara 2/1/0 (66.67%/33.33%/0%).
- Print media (emulasi CDP): `#app-sidebar` → `display:none`; seluruh `.no-print` (3 elemen) → `display:none`; semua `button` → `display:none`. Elemen `<nav>` berada di dalam sidebar yang tersembunyi sehingga tidak dirender (nilai `display` own-element tetap `block`, namun ancestor `none`).
- PDF A4 berhasil dihasilkan lewat `Page.printToPDF` (`format: 'A4'`, margin 0.5 inci).
- Tidak ada tabel yang overflow di desktop maupun mobile.

### 5.4 Dashboard

- Banner siklus aktif menampilkan nama siklus, deskripsi, `ID Sesi: 1`, `Status: Keputusan Disahkan`, `Putaran: 1`.
- Konsisten untuk `chair`, `member`, dan `voter` (screenshot 09/10/11).
- State loading/error/empty tersedia di komponen dan dicakup unit test `DashboardPage.test.tsx`.

### 5.5 Assessment Input

- Kriteria belum final → pesan: "Kriteria belum tersedia. Ketua Panel perlu menambahkan kriteria penilaian terlebih dahulu." + "Kandidat belum tersedia…" + "Hubungi Ketua Panel…".
- Kandidat belum final (kriteria final) → pesan "Kandidat belum tersedia…".
- Keduanya final → matriks 12 item (3 kandidat × 4 kriteria) tampil normal.
- Role `member` tidak melihat kontrol konfigurasi (`Buat Siklus Baru`, `Log Aktivitas`, tombol kelola kriteria/kandidat tidak ada).
- State loading/error dicakup unit test `AssessmentInputPage.test.tsx`.

### 5.6 Pengujian Role & Akses Langsung

| Role | API `GET /api/audit-logs` | URL langsung `/audit-logs` |
|---|---|---|
| Chair (`dm1`) | **200** | Halaman audit tampil |
| Member (`dm2`) | **403** | Dialihkan ke Dashboard |
| Voter (`voter1`) | **403** | Dialihkan ke Dashboard |
| Tanpa token | **401** | Dialihkan ke halaman Login |

Menu `Log Aktivitas` hanya muncul untuk chair. Proteksi berlaku baik di route maupun di backend, bukan sekadar menyembunyikan menu.

### 5.7 Responsive

- 1440×900, 768×1024, 390×844: `bodyOverflowX: false`, `overflowX: false` untuk semua halaman yang diuji.
- Tabel audit dan tabel berita acara tidak memotong konten; pada mobile tabel berada dalam container scroll.
- Tombol dan navigasi tetap dapat diakses; tipografi terbaca.

### 5.8 Artefak QA

Disimpan di `C:\Users\WINDOWS\AppData\Local\Temp\opencode\qa-shots\` (di luar repo):

- `01-audit-desktop.png`, `02-audit-mobile.png`, `03-audit-tablet.png`
- `04-audit-filters.png`, `05-audit-pagination.png`
- `06-decision-desktop.png`, `07-decision-print-A4.pdf`, `08-decision-mobile.png`
- `09-dashboard-chair.png`, `10-dashboard-member.png`, `11-dashboard-voter.png`
- `12-assessment-member.png`, `13-member-audit-denied.png`, `14-voter-audit-denied.png`, `15-unauth-audit-denied.png`
- `16-assessment-criteria-not-final.png`, `17-assessment-candidates-not-final.png`, `18-assessment-normal.png`, `19-assessment-error.png`
- `qa-results.json`

### 5.9 Keterbatasan QA

- Agen tidak memiliki kemampuan melihat gambar, sehingga screenshot/PDF **tidak diperiksa secara visual oleh agen**. Pemeriksaan memakai pemeriksaan DOM terukur (lebar tabel, overflow, computed style, teks, jumlah heading) dan JSON hasil. Disarankan review manual terhadap artefak di atas sebelum rilis.
- Print preview tidak dibuka manual di UI Chrome; diverifikasi lewat emulasi media `print` + ekspor PDF A4 via CDP.
- Playwright tidak tersedia; CDP dipakai sebagai pengganti tanpa instalasi dependency.

---

## 6. Integritas Database Sesi 1

Snapshot akhir memakai skrip yang sama (`phase6_snapshot.php`):

| Tabel | Count | Hash SHA-256 akhir | Status vs baseline |
|---|---:|---|---|
| `decision_sessions` | 1 | `48e9fefe0c64c33a8f3dc285c10c01521b0e32314b0290f61ceca842d41031a2` | SAMA |
| `criteria` | 4 | `2396d08fa8b799b1a756b7eeb6105cdc887cbc405b3c1e0d2c611b1140bf5e5c` | SAMA |
| `candidates` | 3 | `3077da0dcaf613e911ca4d364c4ae7a09e35c8ee5d4da0bbeb5dfe00da97e056` | SAMA |
| `assessments` | 36 | `fa5d28875b74883d3e7dff426efbadc115b46ef8f70848c9944b4b1e65cf5d35` | SAMA |
| `assessment_status` | 3 | `23a9649e38c112fe0953ca7924c12834e667b121cff8687e16ef38a4298e74f8` | SAMA |
| `voting_rounds` | 1 | `9b9ff17ab4f3c2086927529a3f5a1d1db8d1058bbdfd441c4d870546c88594ad` | SAMA |
| `votes` | 3 | `662e762d7f5567d4d87aca4b72f900828166cf440d92489fb8779d0d0ecc8f23` | SAMA |
| `final_decisions` | 1 | `15a525556e0dae95f947a087bf9280415598f8d8d8afd6d7028ffa2a90210723` | SAMA |
| `session_voters` | 3 | `41b6074a07a825047d783ac1707e0cf369b8b26763a63e4fe2204492ca31d035` | SAMA |
| `audit_logs` (sesi 1) | 95 | `0c3b58225a36c2ce374298d610a052984b39a2f2d39cd918f8ba0668943a72d6` | +5 entri `auth_login` |

- Combined hash saat implementasi selesai: `fe9f9f36f49611d0b355b9f8f6dd1ca7eba547ecf96bde2f9d9a4597fbbff224`.
- Combined hash akhir setelah QA: `b20210648d171ba0466e94bdbc799d243de4ed8e59018bd6eab9fe96a9c62fd0`.
- Total `audit_logs` semua sesi: 96 → 101 (+5 entri `auth_login` dari percobaan login QA yang sempat diarahkan ke server lama sebelum server QA terisolasi aktif).
- Seluruh tabel data bisnis (SAW, Borda, voting, keputusan, histori) **tidak berubah** — count dan hash identik dengan baseline. Entri audit bersifat append-only dan merupakan hasil login nyata, bukan data dummy. **Tidak ada penghapusan/operasi destruktif** dilakukan untuk "mengembalikan" angka audit; menghapus log audit nyata justru melanggar syarat integritas.
- Fingerprint baseline di `PHASE_6_AUDIT_REPORT.md` (`184f6823…`) berasal dari script berbeda dan tidak direproduksi skrip lokal; perbandingan memakai skrip yang sama sehingga valid.

---

## 7. Batasan & Follow-up

- Review manual disarankan untuk screenshot dan PDF A4 di folder artefak QA (lihat 5.8).
- `.htaccess` sengaja tidak diubah; bila di lingkungan Apache/Laragon lain header `Authorization` hilang, terapkan `RewriteCond %{HTTP:Authorization} ^(.+)$` + `RewriteRule ^ - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]` sebagai tindakan terpisah.

---

## 8. Keputusan Akhir

**READY WITH LIMITATIONS** — seluruh pengujian otomatis dan QA berbasis DOM/CDP berhasil; keterbatasan hanya pada tidak tersedianya Playwright dan tidak dilakukannya inspeksi visual manusia terhadap screenshot/PDF (lihat 5.9). Tidak ada bug atau regresi yang ditemukan.

Status Phase 6: **FINAL dengan keterbatasan terdokumentasi**.
