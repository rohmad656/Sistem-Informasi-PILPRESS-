# DOKUMENTASI REST API GDSS PEMILIHAN CALON PRESIDEN

Dokumentasi ini disusun untuk pengembang frontend yang mengintegrasikan antarmuka pengguna (HTML/CSS/Bootstrap/JavaScript) dengan backend GDSS Pemilihan Calon Presiden.

---

## 1. Konvensi Umum

### Base URL
- **PHP Built-in Server**: `http://localhost:8080/api`
- **XAMPP Apache**: `http://localhost/backend/public/api` (disesuaikan dengan alias/virtualhost atau folder htdocs)

### Format Request & Response
- Seluruh endpoint menerima dan mengembalikan data dalam format `application/json; charset=utf-8`.
- Setiap endpoint yang membutuhkan autentikasi wajib menyertakan header:
  ```http
  Authorization: Bearer <token>
  ```

### Struktur Response JSON Standar
Setiap respons HTTP menggunakan format konsisten:

#### Respons Sukses (HTTP 200 / 201)
```json
{
  "success": true,
  "message": "Deskripsi keberhasilan pemrosesan data",
  "data": { ... } // Objek atau Array data
}
```

#### Respons Gagal (HTTP 4xx / 5xx)
```json
{
  "success": false,
  "message": "Pesan deskripsi kesalahan yang ramah pengguna",
  "data": null
}
```

### Daftar HTTP Status Codes
| Status Code | Arti | Keterangan |
|---|---|---|
| `200 OK` | Berhasil | Permintaan GET, PUT berhasil diproses |
| `201 Created` | Sumber Daya Dibuat | Berhasil membuka voting, memberikan suara, atau mengesahkan keputusan |
| `204 No Content` | Tanpa Konten | Digunakan untuk preflight CORS `OPTIONS` |
| `400 Bad Request` | Payload Tidak Valid | Format JSON salah atau payload bukan objek |
| `401 Unauthorized` | Autentikasi Gagal | Token tidak disertakan, token kedaluwarsa, atau password salah |
| `403 Forbidden` | Akses Terlarang | Tindakan khusus Ketua Panel diakses oleh Anggota Panel |
| `404 Not Found` | Tidak Ditemukan | Endpoint, kandidat, atau data yang dicari tidak ada |
| `409 Conflict` | Konflik Status | Aturan alur dilanggar (misal: vote ganda, voting sebelum penilaian selesai, approve dua kali) |
| `422 Unprocessable` | Validasi Gagal | Nilai di luar rentang 1-5, field wajib kosong, matriks tidak lengkap |
| `429 Too Many Requests` | Terlalu Banyak Percobaan | Pembatasan login (maks 5 kali gagal per 15 menit) |
| `500 Internal Error` | Kesalahan Server | Kegagalan internal backend |
| `503 Service Unavailable` | Database Tidak Tersedia | Koneksi ke database MySQL terputus |

---

## 2. Autentikasi (Authentication)

### 2.1 Login Pengguna
- **Method**: `POST`
- **Endpoint**: `/api/auth/login` (atau `/api/login`)
- **Autentikasi**: Tidak diperlukan (Publik)
- **Request Body**:
  ```json
  {
    "username": "dm1",
    "password": "password123"
  }
  ```
- **Response Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Login berhasil.",
    "data": {
      "token": "eyJzdWIiOjEsInVzZXJuYW1lIjoiZG0xIiwicm9sZSI6ImNoYWlyIiwiZXhwIjoxNzkzNzUyNDAwfQ.signature_hash...",
      "token_type": "Bearer",
      "expires_in": 3600,
      "user": {
        "id": 1,
        "username": "dm1",
        "name": "Ketua Panel",
        "role": "chair"
      }
    }
  }
  ```
- **Respons Gagal (401 Unauthorized)**:
  ```json
  {
    "success": false,
    "message": "Username atau password tidak valid.",
    "data": null
  }
  ```

### 2.2 Profil Pengguna Saat Ini
- **Method**: `GET`
- **Endpoint**: `/api/auth/me` (atau `/api/me`)
- **Autentikasi**: Wajib (`Bearer <token>`)
- **Response Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Profil pengguna berhasil diambil.",
    "data": {
      "id": 1,
      "username": "dm1",
      "name": "Ketua Panel",
      "role": "chair"
    }
  }
  ```

### 2.3 Logout Pengguna
- **Method**: `POST`
- **Endpoint**: `/api/auth/logout` (atau `/api/logout`)
- **Autentikasi**: Wajib (`Bearer <token>`)
- **Response Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Logout berhasil. Sesi token di sisi klien silakan dihapus.",
    "data": null
  }
  ```

---

## 3. Master Data

### 3.1 Daftar Kandidat Presiden
- **Method**: `GET`
- **Endpoint**: `/api/candidates`
- **Autentikasi**: Wajib
- **Response Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Daftar kandidat berhasil diambil.",
    "data": [
      {
        "id": 1,
        "name": "Kandidat A",
        "vision": "Indonesia Maju, Berdaulat, dan Berkeadilan Sosial",
        "mission": "Akselerasi pembangunan SDM unggul...",
        "profile": "Kandidat fiktif A untuk simulasi akademik..."
      },
      {
        "id": 2,
        "name": "Kandidat B",
        "vision": "Transformasi Digital dan Ketahanan Nasional Tangguh",
        "mission": "Percepatan modernisasi birokrasi...",
        "profile": "Kandidat fiktif B untuk simulasi akademik..."
      },
      {
        "id": 3,
        "name": "Kandidat C",
        "vision": "Pemerataan Kesejahteraan dan Demokrasi Partisipatif",
        "mission": "Pemberdayaan masyarakat daerah 3T...",
        "profile": "Kandidat fiktif C untuk simulasi akademik..."
      }
    ]
  }
  ```

### 3.2 Detail Satu Kandidat
- **Method**: `GET`
- **Endpoint**: `/api/candidates/{id}`
- **Autentikasi**: Wajib
- **Response Sukses (200 OK)**: Objek satu kandidat.

### 3.3 Daftar Kriteria Penilaian
- **Method**: `GET`
- **Endpoint**: `/api/criteria`
- **Autentikasi**: Wajib
- **Response Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Daftar kriteria berhasil diambil.",
    "data": [
      { "id": 1, "code": "C1", "name": "Pengalaman kepemimpinan", "weight": 25, "type": "benefit" },
      { "id": 2, "code": "C2", "name": "Kejelasan program kerja", "weight": 30, "type": "benefit" },
      { "id": 3, "code": "C3", "name": "Rekam jejak kegiatan", "weight": 25, "type": "benefit" },
      { "id": 4, "code": "C4", "name": "Kemampuan komunikasi", "weight": 20, "type": "benefit" }
    ]
  }
  ```

---

## 4. Penilaian Individual (Assessments)

### 4.1 Ambil Penilaian Pengguna Saat Ini
- **Method**: `GET`
- **Endpoint**: `/api/assessments/me` (atau `/api/assessments`)
- **Autentikasi**: Wajib
- **Response Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Penilaian pribadi berhasil diambil.",
    "data": {
      "user_id": 1,
      "is_finalized": false,
      "finalized_at": null,
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
  }
  ```

### 4.2 Simpan Draft Penilaian
- **Method**: `PUT`
- **Endpoint**: `/api/assessments/me` (atau `/api/assessments`)
- **Autentikasi**: Wajib
- **Aturan**: Matriks harus lengkap (3 kandidat x 4 kriteria = 12 item). Skor skala 1 - 5.
- **Request Body**:
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
- **Response Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Matriks penilaian berhasil disimpan.",
    "data": {
      "saved_items": 12
    }
  }
  ```

### 4.3 Finalisasi Penilaian (Kunci Nilai)
- **Method**: `POST`
- **Endpoint**: `/api/assessments/me/finalize` (atau `/api/assessments/submit`)
- **Autentikasi**: Wajib
- **Keterangan**: Mengunci penilaian pengguna. Setelah difinalisasi, penilaian tidak dapat diedit lagi.
- **Response Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Penilaian berhasil difinalisasi dan dikunci.",
    "data": {
      "is_finalized": true,
      "finalized_at": "2026-11-02 23:45:00"
    }
  }
  ```

### 4.4 Status Finalisasi Penilaian Seluruh Panel
- **Method**: `GET`
- **Endpoint**: `/api/assessments/status` (atau `/api/status`)
- **Autentikasi**: Wajib
- **Response Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Status penilaian seluruh panel berhasil diambil.",
    "data": {
      "all_finalized": true,
      "total_panelists": 3,
      "panel": [
        { "user_id": 1, "username": "dm1", "name": "Ketua Panel", "role": "chair", "is_finalized": true, "finalized_at": "2026-11-02 23:40:00" },
        { "user_id": 2, "username": "dm2", "name": "Anggota Panel 1", "role": "member", "is_finalized": true, "finalized_at": "2026-11-02 23:42:00" },
        { "user_id": 3, "username": "dm3", "name": "Anggota Panel 2", "role": "member", "is_finalized": true, "finalized_at": "2026-11-02 23:45:00" }
      ]
    }
  }
  ```

---

## 5. Hasil Perhitungan (TOPSIS & Borda)

### 5.1 Hasil TOPSIS Pribadi DM (Metode Utama)
- **Method**: `GET`
- **Endpoint**: `/api/results/topsis/me` (atau `/api/results/topsis`)
- **Autentikasi**: Wajib (Pengguna harus sudah memfinalisasi penilaiannya)
- **Role**: Ketua Panel (`chair`) atau Anggota Panel (`member`)
- **Response Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Perhitungan TOPSIS pribadi berhasil diambil.",
    "data": {
      "dm_user_id": 1,
      "dm_name": "Ketua Panel",
      "rankings": [
        {
          "candidate_id": 1,
          "candidate_name": "Kandidat A",
          "final_score": 0.6566794889285266,
          "d_plus": 0.042405726193936205,
          "d_minus": 0.08111071056538126,
          "rank": 1,
          "breakdown": {
            "1": { "criterion_id": 1, "code": "C1", "raw_score": 5, "sum_squares": 7.0710678118654755, "normalized": 0.707107, "weight": 25, "norm_weight": 0.25, "weighted_normalized": 0.176777, "ideal_positive": 0.176777, "ideal_negative": 0.106066 },
            "2": { "criterion_id": 2, "code": "C2", "raw_score": 5, "sum_squares": 7.54983443527075, "normalized": 0.662266, "weight": 30, "norm_weight": 0.3, "weighted_normalized": 0.19868, "ideal_positive": 0.19868, "ideal_negative": 0.158944 },
            "3": { "criterion_id": 3, "code": "C3", "raw_score": 4, "sum_squares": 7.54983443527075, "normalized": 0.529813, "weight": 25, "norm_weight": 0.25, "weighted_normalized": 0.132453, "ideal_positive": 0.165567, "ideal_negative": 0.132453 },
            "4": { "criterion_id": 4, "code": "C4", "raw_score": 4, "sum_squares": 7.54983443527075, "normalized": 0.529813, "weight": 20, "norm_weight": 0.2, "weighted_normalized": 0.105963, "ideal_positive": 0.132453, "ideal_negative": 0.105963 }
          }
        },
        {
          "candidate_id": 2,
          "candidate_name": "Kandidat B",
          "final_score": 0.4491049380756443,
          "d_plus": 0.05941970846769583,
          "d_minus": 0.04844059483604816,
          "rank": 2,
          "breakdown": { ... }
        },
        {
          "candidate_id": 3,
          "candidate_name": "Kandidat C",
          "final_score": 0.23216997623453964,
          "d_plus": 0.0876095805063078,
          "d_minus": 0.026490647141300866,
          "rank": 3,
          "breakdown": { ... }
        }
      ]
    }
  }
  ```

**Catatan metodologi**:
- `final_score` (nilai preferensi TOPSIS) berada pada rentang **0–1**. Semakin mendekati 1, semakin baik alternatifnya.
- Backend menjaga **presisi penuh** (float PHP 64-bit). Frontend menampilkan 6 angka desimal (`toFixed(6)`).
- `final_score` **bukan** persentase voting; skor TOPSIS dan suara voting adalah dua informasi berbeda.
- Skor yang dikirim ke Borda adalah `final_score` presisi penuh, **tidak dibulatkan** sebelum agregasi.

---
### 5.2 Hasil SAW Pribadi DM (Legacy — Perbandingan Sementara)
- **Method**: `GET`
- **Endpoint**: `/api/results/saw/me` (atau `/api/results/saw`)
- **Autentikasi**: Wajib (Pengguna harus sudah memfinalisasi penilaiannya)
- **Response Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Perhitungan SAW pribadi berhasil diambil.",
    "data": {
      "dm_user_id": 1,
      "dm_name": "Ketua Panel",
      "rankings": [
        {
          "candidate_id": 1,
          "candidate_name": "Kandidat A",
          "final_score": 91.0,
          "rank": 1,
          "breakdown": {
            "1": { "criterion_id": 1, "code": "C1", "raw_score": 5, "best_value": 5, "normalized": 1.0, "weight": 25, "weighted_score": 25.0 },
            "2": { "criterion_id": 2, "code": "C2", "raw_score": 5, "best_value": 5, "normalized": 1.0, "weight": 30, "weighted_score": 30.0 },
            "3": { "criterion_id": 3, "code": "C3", "raw_score": 4, "best_value": 5, "normalized": 0.8, "weight": 25, "weighted_score": 20.0 },
            "4": { "criterion_id": 4, "code": "C4", "raw_score": 4, "best_value": 5, "normalized": 0.8, "weight": 20, "weighted_score": 16.0 }
          }
        },
        {
          "candidate_id": 2,
          "candidate_name": "Kandidat B",
          "final_score": 85.0,
          "rank": 2,
          "breakdown": { ... }
        },
        {
          "candidate_id": 3,
          "candidate_name": "Kandidat C",
          "final_score": 79.0,
          "rank": 3,
          "breakdown": { ... }
        }
      ]
    }
  }
  ```

### 5.2 Hasil Agregasi Borda
- **Method**: `GET`
- **Endpoint**: `/api/results/borda`
- **Autentikasi**: Wajib (Ketiga DM harus sudah memfinalisasi penilaian)
- **Response Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Agregasi metode Borda berhasil dihitung.",
    "data": {
      "total_points_distributed": 18.0,
      "rankings": [
        {
          "candidate_id": 1,
          "candidate_name": "Kandidat A",
          "borda_points": 8.0,
          "borda_value": 0.4444,
          "percentage": 44.44,
          "rank": 1
        },
        {
          "candidate_id": 2,
          "candidate_name": "Kandidat B",
          "borda_points": 6.0,
          "borda_value": 0.3333,
          "percentage": 33.33,
          "rank": 2
        },
        {
          "candidate_id": 3,
          "candidate_name": "Kandidat C",
          "borda_points": 4.0,
          "borda_value": 0.2222,
          "percentage": 22.22,
          "rank": 3
        }
      ],
      "dm_breakdown": {
        "1": { "1": { "score": 0.6566794889285266, "rank_position": 1, "is_tied": false, "points": 3 }, "2": { "score": 0.4491049380756443, "rank_position": 2, "is_tied": false, "points": 2 }, "3": { "score": 0.23216997623453964, "rank_position": 3, "is_tied": false, "points": 1 } },
        "2": { "2": { "score": 0.7746739877407759, "rank_position": 1, "is_tied": false, "points": 3 }, "1": { "score": 0.5921444800427011, "rank_position": 2, "is_tied": false, "points": 2 }, "3": { "score": 0.2253262315407482, "rank_position": 3, "is_tied": false, "points": 1 } },
        "3": { "1": { "score": 0.6983249999999999, "rank_position": 1, "is_tied": false, "points": 3 }, "3": { "score": 0.424859377134598, "rank_position": 2, "is_tied": false, "points": 2 }, "2": { "score": 0.0, "rank_position": 3, "is_tied": false, "points": 1 } }
      }
    }
  }
  ```

---

## 6. Konsensus Voting Langsung

### 6.1 Status Sesi Voting
- **Method**: `GET`
- **Endpoint**: `/api/voting/status`
- **Autentikasi**: Wajib
- **Response Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Status sesi voting berhasil diambil.",
    "data": {
      "session_status": "voting",
      "current_round": 1,
      "is_voting_open": true,
      "has_voted_this_round": false,
      "votes_cast_in_round": 2,
      "evaluation": { ... },
      "ratified_decision": null,
      "can_chair_open": false,
      "can_chair_approve": false
    }
  }
  ```

### 6.2 Buka Sesi Voting Putaran Pertama (Khusus Ketua Panel)
- **Method**: `POST`
- **Endpoint**: `/api/voting/open` (atau `/api/rounds`)
- **Autentikasi**: Wajib (Role: `chair`)
- **Response Sukses (201 Created)**:
  ```json
  {
    "success": true,
    "message": "Sesi voting putaran 1 berhasil dibuka.",
    "data": {
      "round_number": 1,
      "status": "open",
      "message": "Sesi voting putaran 1 berhasil dibuka."
    }
  }
  ```

### 6.3 Berikan Suara Voting
- **Method**: `POST`
- **Endpoint**: `/api/voting/vote` (atau `/api/votes`)
- **Autentikasi**: Wajib
- **Aturan**: 1 suara per DM per putaran. Suara tidak dapat diubah setelah dikirim.
- **Request Body**:
  ```json
  {
    "candidate_id": 1
  }
  ```
- **Response Sukses (201 Created)**:
  ```json
  {
    "success": true,
    "message": "Suara voting Anda berhasil dicatat.",
    "data": {
      "round_number": 1,
      "has_voted": true,
      "votes_cast_in_round": 3,
      "round_completed": true,
      "evaluation": {
        "status": "majority",
        "is_completed": true,
        "requires_revote": false,
        "total_votes_cast": 3,
        "winner": {
          "candidate_id": 1,
          "candidate_name": "Kandidat A",
          "votes": 2,
          "percentage": 66.67
        },
        "tallies": [
          { "candidate_id": 1, "candidate_name": "Kandidat A", "votes": 2, "percentage": 66.67 },
          { "candidate_id": 2, "candidate_name": "Kandidat B", "votes": 1, "percentage": 33.33 },
          { "candidate_id": 3, "candidate_name": "Kandidat C", "votes": 0, "percentage": 0.0 }
        ]
      }
    }
  }
  ```

### 6.4 Hasil Perolehan Suara Putaran Terkini
- **Method**: `GET`
- **Endpoint**: `/api/voting/results`
- **Autentikasi**: Wajib

### 6.5 Buka Putaran Ulang Jika Seri (Khusus Ketua Panel)
- **Method**: `POST`
- **Endpoint**: `/api/voting/next-round`
- **Autentikasi**: Wajib (Role: `chair`)
- **Keterangan**: Hanya dapat dipanggil jika putaran sebelumnya berakhir `tie_revote` (1-1-1).

---

## 7. Pengesahan Keputusan Final (Decisions)

### 7.1 Sahkan Keputusan Mayoritas (Khusus Ketua Panel)
- **Method**: `POST`
- **Endpoint**: `/api/decisions/approve` (atau `/api/decision`)
- **Autentikasi**: Wajib (Role: `chair`)
- **Request Body**:
  ```json
  {
    "reason": "Konsensus panel mufakat menetapkan Kandidat A berdasarkan visi Indonesia Maju dan mayoritas voting 66.67%."
  }
  ```
- **Response Sukses (201 Created)**:
  ```json
  {
    "success": true,
    "message": "Keputusan konsensus mayoritas berhasil disahkan oleh Ketua Panel.",
    "data": {
      "session_id": 1,
      "round_number": 1,
      "candidate_id": 1,
      "candidate_name": "Kandidat A",
      "total_votes": 2,
      "percentage": 66.67,
      "approved_by": "Ketua Panel",
      "reason": "Konsensus panel mufakat...",
      "approved_at": "2026-11-02 23:55:00"
    }
  }
  ```

### 7.2 Lihat Keputusan Final
- **Method**: `GET`
- **Endpoint**: `/api/decisions/final`
- **Autentikasi**: Wajib (Dapat diakses oleh seluruh anggota panel)
- **Response Sukses (200 OK)**: Objek keputusan yang telah disahkan.

### 7.3 Riwayat Putaran Voting & Keputusan
- **Method**: `GET`
- **Endpoint**: `/api/decisions/history`
- **Autentikasi**: Wajib
