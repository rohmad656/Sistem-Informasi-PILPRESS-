# PANDUAN INTEGRASI FRONTEND DENGAN BACKEND GDSS

Panduan ini disusun untuk pengembang Frontend agar dapat membangun antarmuka web (HTML5, CSS3, Bootstrap 5, dan JavaScript vanilla/framework) secara cepat, aman, dan tanpa perlu mempelajari source code backend PHP.

---

## 1. Arsitektur & Prinsip Komunikasi

1. **Decoupled Architecture**: Frontend dan Backend terpisah penuh. Backend bertindak murni sebagai REST-style JSON API.
2. **Stateless Authentication**: Login mengembalikan Bearer token HMAC-SHA256 yang disimpan di sisi browser (`sessionStorage` atau `localStorage`).
3. **Role-Based UI Rendering**:
   - `chair` (Ketua Panel): Memiliki tombol aksi kontrol: "Buka Sesi Voting", "Buka Putaran Ulang (jika seri)", dan "Sahkan Keputusan Konsensus".
   - `member` (Anggota Panel 1 & 2): Antarmuka penilaian, melihat TOPSIS/Borda, memberikan 1 suara voting, dan melihat hasil final. Tombol khusus ketua disembunyikan di UI (backend juga memiliki validasi otorisasi 403 Forbidden).

---

## 2. Pengaturan CORS & URL API

Saat mengembangkan frontend di komputer lokal:
- Frontend dijalankan menggunakan Live Server (misal `http://127.0.0.1:5500` atau `http://localhost:3000`).
- Backend PHP berjalan di:
  - Built-in server: `http://localhost:8080/api`
  - XAMPP Apache: `http://localhost/backend/public/api`

Backend secara otomatis mengizinkan request dari origin lokal tersebut. Jika menggunakan port lain, tambahkan origin Anda ke file `.env` di baris `CORS_ALLOWED_ORIGINS`.

---

## 3. Library Klien API JavaScript Siap Pakai (`api.js`)

Salin kode berikut ke dalam file `js/api.js` pada project frontend Anda:

```javascript
/**
 * GDSS Presidential Election API Client
 */
class GdssApi {
  constructor(baseUrl = 'http://localhost:8080/api') {
    this.baseUrl = baseUrl;
  }

  getToken() {
    return sessionStorage.getItem('gdss_token') || localStorage.getItem('gdss_token');
  }

  setToken(token, persistent = false) {
    if (persistent) {
      localStorage.setItem('gdss_token', token);
    } else {
      sessionStorage.setItem('gdss_token', token);
    }
  }

  clearToken() {
    sessionStorage.removeItem('gdss_token');
    localStorage.removeItem('gdss_token');
    sessionStorage.removeItem('gdss_user');
    localStorage.removeItem('gdss_user');
  }

  getUser() {
    const raw = sessionStorage.getItem('gdss_user') || localStorage.getItem('gdss_user');
    return raw ? JSON.parse(raw) : null;
  }

  setUser(user, persistent = false) {
    const raw = JSON.stringify(user);
    if (persistent) {
      localStorage.setItem('gdss_user', raw);
    } else {
      sessionStorage.setItem('gdss_user', raw);
    }
  }

  async request(method, path, body = null) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const options = { method, headers };
    if (body !== null && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(`${this.baseUrl}${path}`, options);
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          this.clearToken();
          // Redirect ke halaman login jika sesi habis
          if (!window.location.pathname.endsWith('login.html')) {
            window.location.href = 'login.html';
          }
        }
        throw new Error(data.message || `Terjadi kesalahan (HTTP ${response.status})`);
      }

      return data;
    } catch (err) {
      console.error(`API Error [${method} ${path}]:`, err);
      throw err;
    }
  }

  // --- Auth Endpoints ---
  async login(username, password) {
    const res = await this.request('POST', '/auth/login', { username, password });
    if (res.success && res.data.token) {
      this.setToken(res.data.token);
      this.setUser(res.data.user);
    }
    return res;
  }

  async getMe() {
    return this.request('GET', '/auth/me');
  }

  async logout() {
    try {
      await this.request('POST', '/auth/logout');
    } finally {
      this.clearToken();
      window.location.href = 'login.html';
    }
  }

  // --- Master Data Endpoints ---
  async getCandidates() {
    return this.request('GET', '/candidates');
  }

  async getCandidate(id) {
    return this.request('GET', `/candidates/${id}`);
  }

  async getCriteria() {
    return this.request('GET', '/criteria');
  }

  // --- Assessment Endpoints ---
  async getMyAssessments() {
    return this.request('GET', '/assessments/me');
  }

  async saveAssessments(items) {
    // items: [{ candidate_id: 1, criterion_id: 1, score: 5 }, ...]
    return this.request('PUT', '/assessments/me', { items });
  }

  async finalizeAssessments() {
    return this.request('POST', '/assessments/me/finalize');
  }

  async getAssessmentsStatus() {
    return this.request('GET', '/assessments/status');
  }

  // --- Results Endpoints ---
  async getTopsisResults(sessionId) {
    const qs = sessionId ? `?session_id=${sessionId}` : '';
    return this.request('GET', `/results/topsis/me${qs}`);
  }

  async getSawResults() {
    return this.request('GET', '/results/saw/me');
  }

  async getBordaResults() {
    return this.request('GET', '/results/borda');
  }

  // --- Voting Endpoints ---
  async getVotingStatus() {
    return this.request('GET', '/voting/status');
  }

  async openVoting() {
    return this.request('POST', '/voting/open');
  }

  async submitVote(candidateId) {
    return this.request('POST', '/voting/vote', { candidate_id: candidateId });
  }

  async getVotingResults() {
    return this.request('GET', '/voting/results');
  }

  async openNextVotingRound() {
    return this.request('POST', '/voting/next-round');
  }

  // --- Consensus Decision Endpoints ---
  async approveDecision(reason) {
    return this.request('POST', '/decisions/approve', { reason });
  }

  async getFinalDecision() {
    return this.request('GET', '/decisions/final');
  }

  async getDecisionsHistory() {
    return this.request('GET', '/decisions/history');
  }
}

// Export untuk penggunaan global
window.api = new GdssApi();
```

---

## 4. Alur Kerja Aplikasi (Step-by-Step UI Flow)

Frontend dapat dibagi menjadi tahapan alur berikut:

```
[1. Login] 
    │
    ▼
[2. Form Penilaian Multikriteria (Grid 3 x 4)] ── Simpan Draft (PUT) ── Finalisasi (POST)
    │
    ▼
[3. Tampilan Hasil TOPSIS Pribadi]
    │
    ▼
[4. Status Panel & Hasil Agregasi Borda] (Aktif setelah 3 DM finalisasi)
    │
    ▼
[5. Sesi Voting Langsung]
    │  ├─ Ketua Panel: Klik tombol "Buka Sesi Voting"
    │  └─ Setiap DM: Pilih 1 Kandidat (Kandidat A, B, atau C) lalu submit
    ▼
[6. Evaluasi Hasil Voting]
    │  ├─ Jika Seri (1-1-1): Tampilkan Banner Putaran Ulang (Ketua klik Buka Putaran Ulang)
    │  └─ Jika Mayoritas (2 dari 3 suara): Tampilkan status "Siap Disahkan"
    ▼
[7. Pengesahan Konsensus Final]
    │  └─ Ketua Panel mengisi formulir alasan & klik "Sahkan Keputusan"
    ▼
[8. Sertifikat Keputusan Final Terpilih]
       Seluruh DM dapat melihat pengesahan resmi, persentase suara, dan alasan pengesahan
```

---

## 5. Contoh Payload & Panduan Komponen UI

### A. Komponen Penilaian (Grid Matriks 3 x 4)
Buat tabel dengan 3 baris (Kandidat A, B, C) dan 4 kolom kriteria (C1..C4). Setiap sel berisi dropdown `<select>` atau `<input type="number" min="1" max="5">`.

Format payload untuk `PUT /api/assessments/me`:
```json
{
  "items": [
    { "candidate_id": 1, "criterion_id": 1, "score": 5 },
    { "candidate_id": 1, "criterion_id": 2, "score": 5 },
    { "candidate_id": 1, "criterion_id": 3, "score": 4 },
    { "candidate_id": 1, "criterion_id": 4, "score": 4 },
    { "candidate_id": 2, "criterion_id": 1, "score": 4 },
    { "candidate_id": 2, "criterion_id": 2, "score": 4 },
    { "candidate_id": 2, "criterion_id": 3, "score": 5 },
    { "candidate_id": 2, "criterion_id": 4, "score": 4 },
    { "candidate_id": 3, "criterion_id": 1, "score": 3 },
    { "candidate_id": 3, "criterion_id": 2, "score": 4 },
    { "candidate_id": 3, "criterion_id": 3, "score": 4 },
    { "candidate_id": 3, "criterion_id": 4, "score": 5 }
  ]
}
```

### B. Komponen Voting
Tampilkan kartu kandidat dengan tombol radio atau tombol "Pilih Kandidat".
Ketika tombol diklik:
```javascript
const candidateId = 1; // ID Kandidat yang dipilih
try {
  const res = await api.submitVote(candidateId);
  alert('Suara Anda berhasil dicatat!');
  loadVotingResults();
} catch (err) {
  alert(err.message);
}
```

### C. Komponen Pengesahan Ketua
Hanya tampilkan jika `user.role === 'chair'` dan `votingStatus.can_chair_approve === true`:
```html
<div class="card p-4 shadow-sm" id="approvalCard">
  <h5>Pengesahan Keputusan Konsensus</h5>
  <p>Kandidat terpilih: <strong id="winnerName">Kandidat A</strong> (Mayoritas 66.67%)</p>
  <textarea id="approvalReason" class="form-control mb-3" rows="3" placeholder="Tuliskan berita acara / alasan pengesahan mufakat..."></textarea>
  <button class="btn btn-success" onclick="handleApprove()">Sahkan Keputusan Resmi</button>
</div>
```

---

## 6. Akun Demonstrasi untuk Pengujian UI

| Akun | Username | Password | Jabatan / Role | Hak Akses Khusus |
|---|---|---|---|---|
| DM1 | `dm1` | `password123` | Ketua Panel (`chair`) | Buka voting, buka putaran ulang, sahkan hasil konsensus |
| DM2 | `dm2` | `password123` | Anggota Panel 1 (`member`) | Penilaian, voting, melihat hasil |
| DM3 | `dm3` | `password123` | Anggota Panel 2 (`member`) | Penilaian, voting, melihat hasil |
