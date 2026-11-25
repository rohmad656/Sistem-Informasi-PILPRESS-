<?php
declare(strict_types=1);

namespace Gdss;

use PDO;
use RuntimeException;
use InvalidArgumentException;

/**
 * Exception khusus untuk kesalahan HTTP API yang aman dikembalikan ke klien
 */
final class ApiError extends RuntimeException
{
    public function __construct(public int $httpStatus, string $message)
    {
        parent::__construct($message);
    }
}

/**
 * Controller Layanan Utama Aplikasi GDSS Pemilihan Calon Presiden
 */
final class App
{
    /**
     * Electorate resmi Pilpress: hanya tiga panelis terverifikasi.
     * Kunci = username akun, nilai = role yang wajib cocok di database.
     * Identitas diverifikasi langsung dari tabel users, bukan pola LIKE.
     */
    private const OFFICIAL_ELECTORATE = [
        'dm1' => 'chair',
        'dm2' => 'member',
        'dm3' => 'member',
    ];

    private DecisionService $calc;

    public function __construct(private PDO $db)
    {
        $this->calc = new DecisionService();
    }

    private function one(string $sql, array $args = []): ?array
    {
        $stmt = $this->db->prepare($sql);
        $stmt->execute($args);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    private function all(string $sql, array $args = []): array
    {
        $stmt = $this->db->prepare($sql);
        $stmt->execute($args);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    private function exec(string $sql, array $args = []): void
    {
        $stmt = $this->db->prepare($sql);
        $stmt->execute($args);
    }

    private function bad(bool $condition, int $status, string $message): void
    {
        if ($condition) {
            throw new ApiError($status, $message);
        }
    }

    /** Status resmi lifecycle sesi. Di luar daftar ini bukan sesi aktif yang sah. */
    private const LIFECYCLE_STATUSES = ['assessment', 'voting', 'tie_revote', 'voting_completed', 'ratified'];

    /**
     * Sesi aktif = sesi terakhir yang dibuat (id terbesar) DAN statusnya termasuk
     * lifecycle resmi. Baris berstatus tidak dikenal ditolak, tidak diam-diam
     * dianggap aktif, dan tidak dipakai sebagai sasaran operasi tulis.
     */
    public function getActiveSessionId(): int
    {
        $row = $this->one('SELECT id, status FROM decision_sessions ORDER BY id DESC LIMIT 1');
        $this->bad($row === null, 404, 'Belum ada sesi pemilihan yang tersedia.');
        $this->bad(
            !in_array((string)$row['status'], self::LIFECYCLE_STATUSES, true),
            409,
            'Sesi pemilihan terakhir berstatus di luar lifecycle resmi dan tidak dapat dijadikan sesi aktif.'
        );
        return (int)$row['id'];
    }

    /**
     * Resolusi aktif untuk pembacaan histori. Null bila tidak ada sesi valid,
     * agar sesi lama tetap dapat dibaca walau ada baris anomali di id terbesar.
     */
    private function activeSessionIdOrNull(): ?int
    {
        $row = $this->one('SELECT id, status FROM decision_sessions ORDER BY id DESC LIMIT 1');
        if ($row === null || !in_array((string)$row['status'], self::LIFECYCLE_STATUSES, true)) {
            return null;
        }
        return (int)$row['id'];
    }

    /** Pakai session_id eksplisit bila diberikan, selain itu resolusi sesi aktif. */
    private function resolveSessionId(?int $sessionId): int
    {
        return $sessionId ?? $this->getActiveSessionId();
    }

    public function actor(?array $user): array
    {
        $this->bad($user === null, 401, 'Autentikasi diperlukan. Silakan sertakan token Bearer yang valid.');
        return $user;
    }

    public function chair(?array $user): array
    {
        $u = $this->actor($user);
        $this->bad($u['role'] !== 'chair', 403, 'Akses ditolak. Tindakan ini hanya boleh dilakukan oleh Ketua Panel.');
        return $u;
    }

    private function lockSession(int $sessionId): array
    {
        $driver = $this->db->getAttribute(PDO::ATTR_DRIVER_NAME);
        $sql = ($driver === 'mysql')
            ? 'SELECT * FROM decision_sessions WHERE id = ? FOR UPDATE'
            : 'SELECT * FROM decision_sessions WHERE id = ?';
        return $this->one($sql, [$sessionId]) ?? throw new ApiError(404, 'Sesi keputusan tidak ditemukan.');
    }

    private function audit(?int $userId, string $action, string $details, ?int $sessionId = null, ?string $ip = null): void
    {
        // Tanpa session_id eksplisit, pakai sesi aktif. Login boleh terjadi sebelum
        // ada sesi sama sekali -> audit tetap ditulis dengan session_id NULL.
        if ($sessionId === null) {
            try {
                $sessionId = $this->getActiveSessionId();
            } catch (ApiError) {
                $sessionId = null;
            }
        }
        $this->exec(
            'INSERT INTO audit_logs (session_id, user_id, action, details, ip_address) VALUES (?, ?, ?, ?, ?)',
            [$sessionId, $userId, $action, $details, $ip]
        );
    }

    public function listAuditLogs(?array $user, ?int $sessionId = null, int $limit = 50, int $offset = 0, ?int $userId = null, ?string $action = null, ?string $dateFrom = null, ?string $dateTo = null): array
    {
        $this->chair($user);
        $sid = $this->resolveSessionId($sessionId);

        $where = ['al.session_id = ?'];
        $params = [$sid];

        if ($userId !== null) {
            $where[] = 'al.user_id = ?';
            $params[] = $userId;
        }
        if ($action !== null && $action !== '') {
            $where[] = 'al.action = ?';
            $params[] = $action;
        }
        if ($dateFrom !== null && $dateFrom !== '') {
            $where[] = 'al.created_at >= ?';
            $params[] = $dateFrom;
        }
        if ($dateTo !== null && $dateTo !== '') {
            $where[] = 'al.created_at <= ?';
            $params[] = $dateTo;
        }

        $whereSql = implode(' AND ', $where);

        $sql = "SELECT al.id, al.session_id, al.user_id, al.action, al.details, al.ip_address, al.created_at, u.name as user_name, u.role as user_role
                FROM audit_logs al
                LEFT JOIN users u ON al.user_id = u.id
                WHERE {$whereSql}
                ORDER BY al.id DESC
                LIMIT ? OFFSET ?";
        $params[] = $limit;
        $params[] = $offset;

        // Binding eksplisit sebagai INTEGER menjaga LIMIT/OFFSET tetap valid pada MySQL native prepares.
        $stmt = $this->db->prepare($sql);
        $last = count($params) - 1;
        foreach ($params as $index => $value) {
            $stmt->bindValue($index + 1, $value, $index >= $last - 1 ? PDO::PARAM_INT : PDO::PARAM_STR);
        }
        $stmt->execute();
        $logs = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $countSql = "SELECT COUNT(*) as c FROM audit_logs al WHERE {$whereSql}";
        $totalRow = $this->one($countSql, array_slice($params, 0, -2));
        $total = (int)($totalRow['c'] ?? 0);

        return [
            'logs' => $logs,
            'total' => $total,
            'limit' => $limit,
            'offset' => $offset
        ];
    }

    private function transaction(callable $fn): mixed
    {
        $this->db->beginTransaction();
        try {
            $result = $fn();
            $this->db->commit();
            return $result;
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    /**
     * Verifikasi identitas electorate resmi langsung dari tabel users.
     * Gagal (409) jika akun tidak lengkap atau role tidak sesuai.
     *
     * @return array<int, array{id:int, username:string, role:string}>
     */
    private function officialElectorate(): array
    {
        $usernames = array_keys(self::OFFICIAL_ELECTORATE);
        $placeholders = implode(', ', array_fill(0, count($usernames), '?'));

        $rows = $this->all(
            "SELECT id, username, role FROM users WHERE username IN ({$placeholders}) ORDER BY id",
            $usernames
        );

        $this->bad(
            count($rows) !== count(self::OFFICIAL_ELECTORATE),
            409,
            'Electorate resmi tidak lengkap. Diperlukan akun dm1, dm2, dan dm3 di database.'
        );

        foreach ($rows as $row) {
            $expectedRole = self::OFFICIAL_ELECTORATE[$row['username']] ?? null;
            $this->bad(
                $expectedRole === null || $row['role'] !== $expectedRole,
                409,
                'Role akun electorate tidak valid: ' . $row['username']
            );
        }

        return array_map(fn(array $r) => [
            'id' => (int)$r['id'],
            'username' => $r['username'],
            'role' => $r['role'],
        ], $rows);
    }

    /**
     * Selaraskan snapshot session_voters dengan electorate resmi.
     * Hanya menyentuh tabel session_voters; votes dan status sesi tidak diubah.
     * Dipanggil di dalam transaksi pemanggil.
     *
     * @return array{added:int, removed:int, electorate:array<int,int>}
     */
    private function reconcileElectorateRows(int $sessionId): array
    {
        $session = $this->one('SELECT id FROM decision_sessions WHERE id = ?', [$sessionId]);
        $this->bad($session === null, 404, 'Sesi keputusan tidak ditemukan.');

        $electorate = $this->officialElectorate();
        $officialIds = array_column($electorate, 'id');

        $existing = $this->all(
            'SELECT user_id FROM session_voters WHERE session_id = ?',
            [$sessionId]
        );
        $existingIds = array_map(fn(array $r) => (int)$r['user_id'], $existing);

        $removed = 0;
        foreach ($existingIds as $existingId) {
            if (!in_array($existingId, $officialIds, true)) {
                $this->exec(
                    'DELETE FROM session_voters WHERE session_id = ? AND user_id = ?',
                    [$sessionId, $existingId]
                );
                $removed++;
            }
        }

        $added = 0;
        foreach ($officialIds as $officialId) {
            if (!in_array($officialId, $existingIds, true)) {
                $this->exec(
                    'INSERT INTO session_voters (session_id, user_id) VALUES (?, ?)',
                    [$sessionId, $officialId]
                );
                $added++;
            }
        }

        $finalIds = array_map(
            fn(array $r) => (int)$r['user_id'],
            $this->all('SELECT user_id FROM session_voters WHERE session_id = ? ORDER BY user_id', [$sessionId])
        );

        $expected = $officialIds;
        sort($expected);
        $sortedFinal = $finalIds;
        sort($sortedFinal);
        $this->bad(
            $sortedFinal !== $expected,
            500,
            'Rekonsiliasi electorate gagal: snapshot akhir tidak sesuai electorate resmi.'
        );

        return [
            'added' => $added,
            'removed' => $removed,
            'electorate' => $finalIds,
        ];
    }

    /**
     * Rekonsiliasi electorate dalam transaksi sendiri (untuk CLI / tooling).
     *
     * @return array{added:int, removed:int, electorate:array<int,int>}
     */
    public function reconcileElectorate(?int $sessionId = null): array
    {
        $sessionId = $this->resolveSessionId($sessionId);
        return $this->transaction(fn() => $this->reconcileElectorateRows($sessionId));
    }

    /**
     * Autentikasi Pengguna & Penanganan Rate Limiting
     */
    public function login(string $username, string $password, string $ip): array
    {
        $username = trim($username);
        $this->bad($username === '' || $password === '', 422, 'Username dan password wajib diisi.');

        $bucket = hash('sha256', strtolower($username) . '|' . $ip);
        $attempt = $this->one('SELECT attempts, started_at FROM login_attempts WHERE bucket = ?', [$bucket]);

        $now = time();
        if ($attempt !== null) {
            $elapsed = $now - (int)$attempt['started_at'];
            if ($elapsed < 900 && (int)$attempt['attempts'] >= 5) {
                throw new ApiError(429, 'Terlalu banyak percobaan login gagal. Silakan coba kembali setelah 15 menit.');
            }
        }

        $user = $this->one('SELECT id, username, name, role, password_hash FROM users WHERE username = ?', [$username]);
        if (!$user || !password_verify($password, $user['password_hash'])) {
            $count = ($attempt && ($now - (int)$attempt['started_at'] < 900)) ? (int)$attempt['attempts'] + 1 : 1;
            $startTime = ($attempt && ($now - (int)$attempt['started_at'] < 900)) ? (int)$attempt['started_at'] : $now;

            if ($attempt !== null) {
                $this->exec('UPDATE login_attempts SET attempts = ?, started_at = ? WHERE bucket = ?', [$count, $startTime, $bucket]);
            } else {
                $this->exec('INSERT INTO login_attempts (bucket, attempts, started_at) VALUES (?, ?, ?)', [$bucket, $count, $startTime]);
            }
            throw new ApiError(401, 'Username atau password tidak valid.');
        }

        if ($attempt !== null) {
            $this->exec('DELETE FROM login_attempts WHERE bucket = ?', [$bucket]);
        }

        $this->audit((int)$user['id'], 'auth_login', 'Login berhasil', null, $ip);

        return [
            'id' => (int)$user['id'],
            'username' => $user['username'],
            'name' => $user['name'],
            'role' => $user['role'],
        ];
    }

    /**
     * Registrasi Pengguna Baru (Pemilih Publik)
     */
    public function register(string $name, string $username, string $password, string $ip): array
    {
        $name = trim($name);
        $username = trim($username);

        $this->bad($name === '', 422, 'Nama lengkap wajib diisi.');
        $this->bad($username === '', 422, 'Username wajib diisi.');
        $this->bad($password === '', 422, 'Password wajib diisi.');

        // Validasi format username: 3-50 karakter, alphanumeric dan underscore saja
        $this->bad(
            strlen($username) < 3 || strlen($username) > 50 || !preg_match('/^[a-z0-9_]+$/i', $username),
            422,
            'Username harus 3-50 karakter, hanya berisi huruf, angka, dan underscore.'
        );

        // Validasi panjang password: minimal 6 karakter
        $this->bad(
            strlen($password) < 6,
            422,
            'Password minimal 6 karakter.'
        );

        // Cek username sudah terdaftar
        $existing = $this->one('SELECT id FROM users WHERE username = ?', [$username]);
        $this->bad($existing !== null, 409, 'Username sudah terdaftar. Gunakan username lain.');

        // Hash password menggunakan bcrypt (kompatibel dengan login yang ada)
        $passwordHash = password_hash($password, PASSWORD_BCRYPT);

        return $this->transaction(function () use ($name, $username, $passwordHash, $ip) {
            $this->exec(
                'INSERT INTO users (name, username, role, password_hash) VALUES (?, ?, "voter", ?)',
                [$name, $username, $passwordHash]
            );

            $userId = (int)$this->db->lastInsertId();
            $this->audit($userId, 'auth_register', 'Akun baru terdaftar sebagai pemilih', null, $ip);

            return [
                'id' => $userId,
                'username' => $username,
                'name' => $name,
                'role' => 'voter',
                'message' => 'Pendaftaran berhasil. Silakan login dengan akun Anda.',
            ];
        });
    }

    /** Chair mengelola master data; peran lain hanya memakai data yang sudah final. */
    private function isMasterManager(?array $user): bool
    {
        return $user !== null && ($user['role'] ?? null) === 'chair';
    }

    /**
     * Master Data: Daftar Kandidat per sesi.
     * Chair melihat semua; peran lain hanya yang sudah difinalisasi.
     */
    public function listCandidates(?array $user = null, ?int $sessionId = null): array
    {
        $sid = $this->resolveSessionId($sessionId);
        $filter = $this->isMasterManager($user) ? '' : ' AND is_finalized = 1';
        return $this->all(
            'SELECT id, session_id, name, description, vision, mission, work_program, profile,
                    is_finalized, created_at
             FROM candidates WHERE session_id = ?' . $filter . ' ORDER BY id',
            [$sid]
        );
    }

    /** Master Data: Detail kandidat — tetap terikat pada sesi. */
    public function getCandidate(int $id, ?array $user = null, ?int $sessionId = null): array
    {
        $sid = $this->resolveSessionId($sessionId);
        $candidate = $this->one(
            'SELECT id, session_id, name, description, vision, mission, work_program, profile,
                    is_finalized, created_at
             FROM candidates WHERE id = ? AND session_id = ?',
            [$id, $sid]
        );
        $this->bad($candidate === null, 404, 'Kandidat tidak ditemukan pada sesi ini.');
        $this->bad(
            !$this->isMasterManager($user) && !(bool)($candidate['is_finalized'] ?? 0),
            404,
            'Kandidat tidak ditemukan pada sesi ini.'
        );
        return $candidate;
    }

    /** Master Data: Daftar kriteria per sesi (chair semua, peran lain yang final saja). */
    public function listCriteria(?array $user = null, ?int $sessionId = null): array
    {
        $sid = $this->resolveSessionId($sessionId);
        $filter = $this->isMasterManager($user) ? '' : ' AND is_finalized = 1';
        return $this->all(
            'SELECT id, session_id, code, name, description, weight, type, is_finalized, created_at
             FROM criteria WHERE session_id = ?' . $filter . ' ORDER BY id',
            [$sid]
        );
    }

    /* ---------- Phase 5: helper master data ---------- */

    private function textInput(mixed $value, int $max, string $label): ?string
    {
        if ($value === null) {
            return null;
        }
        $text = trim((string)$value);
        if ($text === '') {
            return null;
        }
        $this->bad(mb_strlen($text) > $max, 422, $label . ' maksimal ' . $max . ' karakter.');
        return $text;
    }

    private function weightInput(mixed $value): int
    {
        $valid = is_int($value) || (is_string($value) && ctype_digit($value));
        $this->bad(!$valid, 422, 'Bobot harus bilangan bulat antara 1 sampai 100.');
        $weight = (int)$value;
        $this->bad($weight < 1 || $weight > 100, 422, 'Bobot harus bilangan bulat antara 1 sampai 100.');
        return $weight;
    }

    private function criteriaTotal(int $sessionId): int
    {
        return (int)$this->one(
            'SELECT COALESCE(SUM(weight), 0) AS n FROM criteria WHERE session_id = ?',
            [$sessionId]
        )['n'];
    }

    /** Cek seluruh kriteria & kandidat sesi sudah difinalisasi (minimal satu tiap jenis). */
    private function masterFinalized(int $sessionId): bool
    {
        foreach (['criteria', 'candidates'] as $table) {
            $row = $this->one(
                "SELECT COUNT(*) AS total, COALESCE(SUM(is_finalized), 0) AS fin FROM {$table} WHERE session_id = ?",
                [$sessionId]
            );
            if ((int)$row['total'] < 1 || (int)$row['total'] !== (int)$row['fin']) {
                return false;
            }
        }
        return true;
    }

    private function nextCriterionCode(): string
    {
        $max = 0;
        foreach ($this->all('SELECT code FROM criteria') as $row) {
            if (preg_match('/^C([0-9]+)$/', (string)$row['code'], $m)) {
                $max = max($max, (int)$m[1]);
            }
        }
        return 'C' . ($max + 1);
    }

    /** Cek pemakaian master data oleh penilaian/voting/keputusan. */
    private function masterUsed(string $table, int $id, int $sessionId): bool
    {
        $column = $table === 'criteria' ? 'criterion_id' : 'candidate_id';
        $st = $this->one(
            "SELECT COUNT(*) AS n FROM assessments WHERE session_id = ? AND {$column} = ?",
            [$sessionId, $id]
        );
        if ((int)$st['n'] > 0) {
            return true;
        }
        if ($table === 'candidates') {
            foreach (['votes', 'final_decisions'] as $other) {
                $st = $this->one(
                    "SELECT COUNT(*) AS n FROM {$other} WHERE session_id = ? AND candidate_id = ?",
                    [$sessionId, $id]
                );
                if ((int)$st['n'] > 0) {
                    return true;
                }
            }
        }
        return false;
    }

    /** Guard umum pengelolaan master data: chair, sesi assessment, belum final/pakai. */
    private function masterGuard(?array $user, ?int $sessionId, ?string $table = null, ?int $id = null): array
    {
        $u = $this->chair($user);
        $sid = $this->resolveSessionId($sessionId);
        $session = $this->one('SELECT status FROM decision_sessions WHERE id = ?', [$sid]);
        $this->bad($session === null, 404, 'Sesi pemilihan tidak ditemukan.');
        $this->bad(
            $session['status'] !== 'assessment',
            409,
            'Master data hanya dapat dikelola sebelum proses penilaian dimulai.'
        );
        if ($table !== null && $id !== null) {
            $row = $this->one("SELECT is_finalized FROM {$table} WHERE id = ? AND session_id = ?", [$id, $sid]);
            $this->bad($row === null, 404, 'Data tidak ditemukan pada sesi ini.');
            $this->bad((bool)($row['is_finalized'] ?? 0), 409, 'Data sudah difinalisasi dan tidak dapat diubah.');
            $this->bad(
                $this->masterUsed($table, $id, $sid),
                409,
                'Data sudah dipakai penilaian/voting dan tidak dapat diubah.'
            );
        }
        return [$u, $sid];
    }

    /* ---------- Phase 5: Criteria management ---------- */

    public function getCriteriaSummary(?array $user, ?int $sessionId = null): array
    {
        $u = $this->actor($user);
        $sid = $this->resolveSessionId($sessionId);
        $rows = $this->all('SELECT weight, is_finalized FROM criteria WHERE session_id = ?', [$sid]);
        $total = 0;
        $finalized = count($rows) > 0;
        foreach ($rows as $row) {
            $total += (int)$row['weight'];
            $finalized = $finalized && (bool)($row['is_finalized'] ?? 0);
        }
        $session = $this->one('SELECT status FROM decision_sessions WHERE id = ?', [$sid]);
        $editable = ($session['status'] ?? null) === 'assessment' && !$finalized;
        return [
            'session_id' => $sid,
            'count' => count($rows),
            'total_weight' => $total,
            'is_complete' => count($rows) > 0 && $total === 100,
            'is_finalized' => $finalized,
            'can_manage' => $this->isMasterManager($u) && $editable,
            'can_finalize' => $this->isMasterManager($u) && $editable && count($rows) > 0 && $total === 100,
        ];
    }

    public function createCriterion(?array $user, array $body, ?string $ip = null, ?int $sessionId = null): array
    {
        [$u, $sid] = $this->masterGuard($user, $sessionId);
        $name = $this->textInput($body['name'] ?? null, 120, 'Nama kriteria');
        $this->bad($name === null, 422, 'Nama kriteria wajib diisi.');
        $description = $this->textInput($body['description'] ?? null, 1000, 'Deskripsi kriteria');
        $weight = $this->weightInput($body['weight'] ?? null);
        $type = (string)($body['type'] ?? 'benefit');
        $this->bad(!in_array($type, ['benefit', 'cost'], true), 422, 'Tipe kriteria harus benefit atau cost.');
        $this->bad($this->criteriaTotal($sid) + $weight > 100, 422, 'Total bobot tidak boleh melebihi 100%.');

        $code = $this->nextCriterionCode();
        $this->exec(
            'INSERT INTO criteria (session_id, code, name, description, weight, type, is_finalized) VALUES (?, ?, ?, ?, ?, ?, 0)',
            [$sid, $code, $name, $description, $weight, $type]
        );
        $id = (int)$this->db->lastInsertId();
        $this->audit((int)$u['id'], 'criterion_create', "Kriteria {$code} \"{$name}\" ditambahkan ({$weight}%, {$type}).", $sid, $ip);
        return ['id' => $id, 'code' => $code, 'message' => 'Kriteria berhasil ditambahkan.'];
    }

    public function updateCriterion(?array $user, int $id, array $body, ?string $ip = null, ?int $sessionId = null): array
    {
        [$u, $sid] = $this->masterGuard($user, $sessionId, 'criteria', $id);
        $current = $this->one('SELECT * FROM criteria WHERE id = ? AND session_id = ?', [$id, $sid]);
        $name = $this->textInput($body['name'] ?? null, 120, 'Nama kriteria');
        $this->bad($name === null, 422, 'Nama kriteria wajib diisi.');
        $description = $this->textInput($body['description'] ?? null, 1000, 'Deskripsi kriteria');
        $weight = $this->weightInput($body['weight'] ?? null);
        $type = (string)($body['type'] ?? $current['type']);
        $this->bad(!in_array($type, ['benefit', 'cost'], true), 422, 'Tipe kriteria harus benefit atau cost.');
        $newTotal = $this->criteriaTotal($sid) - (int)$current['weight'] + $weight;
        $this->bad($newTotal > 100, 422, 'Total bobot tidak boleh melebihi 100%.');

        $this->exec(
            'UPDATE criteria SET name = ?, description = ?, weight = ?, type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND session_id = ?',
            [$name, $description, $weight, $type, $id, $sid]
        );
        $this->audit((int)$u['id'], 'criterion_update', "Kriteria #{$id} diperbarui menjadi {$weight}% ({$type}).", $sid, $ip);
        return ['id' => $id, 'message' => 'Kriteria berhasil diperbarui.'];
    }

    public function deleteCriterion(?array $user, int $id, ?string $ip = null, ?int $sessionId = null): array
    {
        [$u, $sid] = $this->masterGuard($user, $sessionId, 'criteria', $id);
        $this->exec('DELETE FROM criteria WHERE id = ? AND session_id = ?', [$id, $sid]);
        $this->audit((int)$u['id'], 'criterion_delete', "Kriteria #{$id} dihapus.", $sid, $ip);
        return ['id' => $id, 'message' => 'Kriteria berhasil dihapus.'];
    }

    public function finalizeCriteria(?array $user, ?string $ip = null, ?int $sessionId = null): array
    {
        [$u, $sid] = $this->masterGuard($user, $sessionId);
        $rows = $this->all('SELECT weight, is_finalized FROM criteria WHERE session_id = ?', [$sid]);
        $this->bad(count($rows) < 1, 422, 'Minimal harus ada satu kriteria sebelum finalisasi.');
        $this->bad((bool)$rows[0]['is_finalized'], 409, 'Kriteria sudah difinalisasi.');
        $total = array_sum(array_column($rows, 'weight'));
        $this->bad($total !== 100, 422, 'Total bobot harus tepat 100% sebelum finalisasi.');
        $used = (int)$this->one('SELECT COUNT(*) AS n FROM assessments WHERE session_id = ?', [$sid])['n'];
        $this->bad($used > 0, 409, 'Kriteria sudah dipakai penilaian dan tidak dapat difinalisasi ulang.');
        $this->exec('UPDATE criteria SET is_finalized = 1, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?', [$sid]);
        $this->audit((int)$u['id'], 'criteria_finalize', "Kriteria sesi #{$sid} difinalisasi (total 100%).", $sid, $ip);
        return ['session_id' => $sid, 'count' => count($rows), 'message' => 'Kriteria berhasil difinalisasi.'];
    }

    /* ---------- Phase 5: Candidate nomination ---------- */

    public function createCandidate(?array $user, array $body, ?string $ip = null, ?int $sessionId = null): array
    {
        [$u, $sid] = $this->masterGuard($user, $sessionId);
        $name = $this->textInput($body['name'] ?? null, 100, 'Nama kandidat');
        $this->bad($name === null, 422, 'Nama kandidat wajib diisi.');
        $profile = $this->textInput($body['profile'] ?? null, 2000, 'Profil kandidat');
        $description = $this->textInput($body['description'] ?? null, 2000, 'Deskripsi kandidat');
        $vision = $this->textInput($body['vision'] ?? null, 2000, 'Visi kandidat');
        $mission = $this->textInput($body['mission'] ?? null, 2000, 'Misi kandidat');
        $program = $this->textInput($body['work_program'] ?? null, 2000, 'Program kerja kandidat');

        $this->exec(
            'INSERT INTO candidates (session_id, name, description, vision, mission, work_program, profile, is_finalized) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
            [$sid, $name, $description, $vision, $mission, $program, $profile]
        );
        $id = (int)$this->db->lastInsertId();
        $this->audit((int)$u['id'], 'candidate_create', "Kandidat \"{$name}\" diajukan.", $sid, $ip);
        return ['id' => $id, 'message' => 'Kandidat berhasil diajukan.'];
    }

    public function updateCandidate(?array $user, int $id, array $body, ?string $ip = null, ?int $sessionId = null): array
    {
        [$u, $sid] = $this->masterGuard($user, $sessionId, 'candidates', $id);
        $name = $this->textInput($body['name'] ?? null, 100, 'Nama kandidat');
        $this->bad($name === null, 422, 'Nama kandidat wajib diisi.');
        $profile = $this->textInput($body['profile'] ?? null, 2000, 'Profil kandidat');
        $description = $this->textInput($body['description'] ?? null, 2000, 'Deskripsi kandidat');
        $vision = $this->textInput($body['vision'] ?? null, 2000, 'Visi kandidat');
        $mission = $this->textInput($body['mission'] ?? null, 2000, 'Misi kandidat');
        $program = $this->textInput($body['work_program'] ?? null, 2000, 'Program kerja kandidat');

        $this->exec(
            'UPDATE candidates SET name = ?, description = ?, vision = ?, mission = ?, work_program = ?, profile = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND session_id = ?',
            [$name, $description, $vision, $mission, $program, $profile, $id, $sid]
        );
        $this->audit((int)$u['id'], 'candidate_update', "Kandidat #{$id} diperbarui.", $sid, $ip);
        return ['id' => $id, 'message' => 'Kandidat berhasil diperbarui.'];
    }

    public function deleteCandidate(?array $user, int $id, ?string $ip = null, ?int $sessionId = null): array
    {
        [$u, $sid] = $this->masterGuard($user, $sessionId, 'candidates', $id);
        $this->exec('DELETE FROM candidates WHERE id = ? AND session_id = ?', [$id, $sid]);
        $this->audit((int)$u['id'], 'candidate_delete', "Kandidat #{$id} dihapus.", $sid, $ip);
        return ['id' => $id, 'message' => 'Kandidat berhasil dihapus.'];
    }

    public function verifyCandidate(?array $user, int $id, ?string $ip = null, ?int $sessionId = null): array
    {
        [$u, $sid] = $this->masterGuard($user, $sessionId, 'candidates', $id);
        $this->exec('UPDATE candidates SET is_finalized = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND session_id = ?', [$id, $sid]);
        $this->audit((int)$u['id'], 'candidate_verify', "Kandidat #{$id} diverifikasi.", $sid, $ip);
        return ['id' => $id, 'message' => 'Kandidat berhasil diverifikasi.'];
    }

    public function finalizeCandidates(?array $user, ?string $ip = null, ?int $sessionId = null): array
    {
        [$u, $sid] = $this->masterGuard($user, $sessionId);
        $count = (int)$this->one('SELECT COUNT(*) AS n FROM candidates WHERE session_id = ?', [$sid])['n'];
        $this->bad($count < 1, 422, 'Minimal harus ada satu kandidat sebelum finalisasi.');
        $this->exec('UPDATE candidates SET is_finalized = 1, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?', [$sid]);
        $this->audit((int)$u['id'], 'candidates_finalize', "Kandidat sesi #{$sid} difinalisasi ({$count} kandidat).", $sid, $ip);
        return ['session_id' => $sid, 'count' => $count, 'message' => 'Kandidat berhasil difinalisasi.'];
    }

    /**
     * Penilaian: Ambil Penilaian Pribadi DM Saat Ini
     */
    public function getAssessmentsMe(?array $user, ?int $sessionId = null): array
    {
        $sessionId = $this->resolveSessionId($sessionId);
        $u = $this->actor($user);
        $this->bad(
            !in_array($u['role'], ['chair', 'member'], true),
            403,
            'Akses ditolak. Hanya Ketua Panel dan Anggota Panel yang dapat mengakses penilaian.'
        );
        $statusRow = $this->one(
            'SELECT is_finalized, finalized_at FROM assessment_status WHERE session_id = ? AND user_id = ?',
            [$sessionId, $u['id']]
        );

        $items = $this->all(
            'SELECT candidate_id, criterion_id, score FROM assessments WHERE session_id = ? AND user_id = ? ORDER BY candidate_id, criterion_id',
            [$sessionId, $u['id']]
        );

        return [
            'user_id' => (int)$u['id'],
            'is_finalized' => (bool)($statusRow['is_finalized'] ?? 0),
            'finalized_at' => $statusRow['finalized_at'] ?? null,
            'items' => array_map(fn($it) => [
                'candidate_id' => (int)$it['candidate_id'],
                'criterion_id' => (int)$it['criterion_id'],
                'score' => (int)$it['score'],
            ], $items),
        ];
    }

    /**
     * Penilaian: Simpan / Perbarui Matriks Penilaian DM (Draft)
     */
    public function saveAssessmentsMe(?array $user, array $items, ?int $sessionId = null): array
    {
        $sessionId = $this->resolveSessionId($sessionId);
        $u = $this->actor($user);
        $this->bad(
            !in_array($u['role'], ['chair', 'member'], true),
            403,
            'Akses ditolak. Hanya Ketua Panel dan Anggota Panel yang dapat menyimpan penilaian.'
        );
        $candidates = $this->listCandidates(null, $sessionId);
        $criteria = $this->listCriteria(null, $sessionId);

        // Phase 5: penilaian hanya dapat berjalan bila master data sudah difinalisasi.
        $this->bad(
            count($candidates) === 0 || count($criteria) === 0,
            409,
            'Kriteria dan kandidat belum disiapkan untuk sesi ini.'
        );
        $this->bad(
            !$this->masterFinalized($sessionId),
            409,
            'Kriteria dan kandidat wajib difinalisasi Ketua Panel sebelum penilaian dimulai.'
        );

        // Validasi kelengkapan seluruh pasangan kandidat x kriteria (3 x 4 = 12 item)
        $expectedMap = [];
        foreach ($candidates as $cand) {
            foreach ($criteria as $crit) {
                $expectedMap[$cand['id'] . ':' . $crit['id']] = true;
            }
        }

        $validatedScores = [];
        foreach ($items as $item) {
            $this->bad(
                !is_array($item) || !isset($item['candidate_id'], $item['criterion_id'], $item['score']),
                422,
                'Format data penilaian tidak lengkap. Wajib menyertakan candidate_id, criterion_id, dan score.'
            );
            $key = $item['candidate_id'] . ':' . $item['criterion_id'];
            $this->bad(!isset($expectedMap[$key]), 422, 'Pasangan kandidat atau kriteria tidak valid: ' . $key);
            $this->bad(isset($validatedScores[$key]), 422, 'Duplikasi entri penilaian untuk pasangan: ' . $key);

            $validatedScores[$key] = $this->calc->validateScore($item['score']);
        }

        $this->bad(
            count($validatedScores) !== count($expectedMap),
            422,
            'Matriks penilaian harus lengkap untuk seluruh ' . count($candidates) . ' kandidat dan ' . count($criteria) . ' kriteria (' . count($expectedMap) . ' item).'
        );

        return $this->transaction(function () use ($u, $sessionId, $validatedScores) {
            $session = $this->lockSession($sessionId);
            $this->bad(
                $session['status'] !== 'assessment',
                409,
                'Penilaian tidak dapat diubah karena sesi telah berpindah ke tahap voting konsensus.'
            );

            $statusRow = $this->one(
                'SELECT is_finalized FROM assessment_status WHERE session_id = ? AND user_id = ?',
                [$sessionId, $u['id']]
            );
            $this->bad(
                !empty($statusRow['is_finalized']),
                409,
                'Penilaian Anda sudah difinalisasi dan telah dikunci. Tidak dapat diubah kembali.'
            );

            // Simpan setiap item skor
            foreach ($validatedScores as $key => $score) {
                [$candId, $critId] = array_map('intval', explode(':', $key));
                $exists = $this->one(
                    'SELECT id FROM assessments WHERE session_id = ? AND user_id = ? AND candidate_id = ? AND criterion_id = ?',
                    [$sessionId, $u['id'], $candId, $critId]
                );

                if ($exists !== null) {
                    $this->exec(
                        'UPDATE assessments SET score = ? WHERE id = ?',
                        [$score, $exists['id']]
                    );
                } else {
                    $this->exec(
                        'INSERT INTO assessments (session_id, user_id, candidate_id, criterion_id, score) VALUES (?, ?, ?, ?, ?)',
                        [$sessionId, $u['id'], $candId, $critId, $score]
                    );
                }
            }

            // Pastikan baris status ada
            if ($statusRow === null) {
                $this->exec(
                    'INSERT INTO assessment_status (session_id, user_id, is_finalized, finalized_at) VALUES (?, ?, 0, NULL)',
                    [$sessionId, $u['id']]
                );
            }

            $this->audit((int)$u['id'], 'assessment_save', 'Menyimpan matriks penilaian lengkap', $sessionId);

            return ['saved_items' => count($validatedScores)];
        });
    }

    /**
     * Penilaian: Finalisasi Penilaian Pribadi (Kunci Nilai)
     */
    public function finalizeAssessmentsMe(?array $user, ?int $sessionId = null): array
    {
        $sessionId = $this->resolveSessionId($sessionId);
        $u = $this->actor($user);
        $this->bad(
            !in_array($u['role'], ['chair', 'member'], true),
            403,
            'Akses ditolak. Hanya Ketua Panel dan Anggota Panel yang dapat memfinalisasi penilaian.'
        );
        return $this->transaction(function () use ($u, $sessionId) {
            $session = $this->lockSession($sessionId);
            $this->bad(
                $session['status'] !== 'assessment',
                409,
                'Tahap penilaian sudah ditutup.'
            );

            $expectedCount = count($this->listCandidates(null, $sessionId)) * count($this->listCriteria(null, $sessionId));
            $actualCount = (int)$this->one(
                'SELECT COUNT(*) n FROM assessments WHERE session_id = ? AND user_id = ?',
                [$sessionId, $u['id']]
            )['n'];

            $this->bad(
                $actualCount !== $expectedCount,
                422,
                'Penilaian belum lengkap. Anda baru mengisi ' . $actualCount . ' dari ' . $expectedCount . ' item penilaian.'
            );

            $statusRow = $this->one(
                'SELECT is_finalized FROM assessment_status WHERE session_id = ? AND user_id = ?',
                [$sessionId, $u['id']]
            );

            $this->bad(
                !empty($statusRow['is_finalized']),
                409,
                'Penilaian Anda sudah pernah difinalisasi sebelumnya.'
            );

            $now = date('Y-m-d H:i:s');
            if ($statusRow !== null) {
                $this->exec(
                    'UPDATE assessment_status SET is_finalized = 1, finalized_at = ? WHERE session_id = ? AND user_id = ?',
                    [$now, $sessionId, $u['id']]
                );
            } else {
                $this->exec(
                    'INSERT INTO assessment_status (session_id, user_id, is_finalized, finalized_at) VALUES (?, ?, 1, ?)',
                    [$sessionId, $u['id'], $now]
                );
            }

            $this->audit((int)$u['id'], 'assessment_finalize', 'Penilaian difinalisasi dan dikunci', $sessionId);

            return [
                'is_finalized' => true,
                'finalized_at' => $now,
            ];
        });
    }

    /**
     * Penilaian: Status Finalisasi Seluruh Anggota Panel
     */
    public function getAssessmentsStatus(?int $sessionId = null): array
    {
        $sessionId = $this->resolveSessionId($sessionId);
        // Panel penilai hanya terdiri dari Ketua dan Anggota; pemilih publik (voter)
        // tidak mengisi penilaian dan tidak boleh memblokir pembukaan voting.
        $users = $this->all(
            'SELECT id, username, name, role FROM users WHERE role IN ("chair", "member") ORDER BY id',
            []
        );
        $statuses = $this->all(
            'SELECT user_id, is_finalized, finalized_at FROM assessment_status WHERE session_id = ?',
            [$sessionId]
        );
        $statusMap = array_column($statuses, null, 'user_id');

        $panel = [];
        $allFinalized = true;
        foreach ($users as $usr) {
            $uId = (int)$usr['id'];
            $st = $statusMap[$uId] ?? null;
            $isFin = !empty($st['is_finalized']);
            if (!$isFin) {
                $allFinalized = false;
            }
            $panel[] = [
                'user_id' => $uId,
                'username' => $usr['username'],
                'name' => $usr['name'],
                'role' => $usr['role'],
                'is_finalized' => $isFin,
                'finalized_at' => $st['finalized_at'] ?? null,
            ];
        }

        return [
            'all_finalized' => $allFinalized,
            'total_panelists' => count($users),
            'panel' => $panel,
        ];
    }

    /**
     * Perhitungan: Hasil SAW Pribadi DM yang Sedang Login
     */
    public function calculateSawMe(?array $user, ?int $sessionId = null): array
    {
        $sessionId = $this->resolveSessionId($sessionId);
        $u = $this->actor($user);
        $this->bad(
            !in_array($u['role'], ['chair', 'member'], true),
            403,
            'Akses ditolak. Hanya Ketua Panel dan Anggota Panel yang memiliki perhitungan SAW pribadi.'
        );
        $statusRow = $this->one(
            'SELECT is_finalized FROM assessment_status WHERE session_id = ? AND user_id = ?',
            [$sessionId, $u['id']]
        );

        $this->bad(
            empty($statusRow['is_finalized']),
            409,
            'Anda harus menyelesaikan dan memfinalisasi penilaian terlebih dahulu sebelum melihat hasil SAW.'
        );

        $candidates = $this->listCandidates(null, $sessionId);
        $criteria = $this->listCriteria(null, $sessionId);
        $candidateMap = array_column($candidates, 'name', 'id');

        $matrix = [];
        foreach ($candidates as $c) {
            $matrix[$c['id']] = ['candidate_id' => (int)$c['id'], 'scores' => []];
        }

        $scores = $this->all(
            'SELECT candidate_id, criterion_id, score FROM assessments WHERE session_id = ? AND user_id = ?',
            [$sessionId, $u['id']]
        );
        foreach ($scores as $s) {
            $matrix[$s['candidate_id']]['scores'][(int)$s['criterion_id']] = (int)$s['score'];
        }

        $sawResults = $this->calc->calculateSaw($criteria, array_values($matrix));

        // Tambahkan nama kandidat ke hasil
        foreach ($sawResults as &$item) {
            $item['candidate_name'] = $candidateMap[$item['candidate_id']] ?? ('Kandidat ' . $item['candidate_id']);
        }

        return [
            'dm_user_id' => (int)$u['id'],
            'dm_name' => $u['name'],
            'rankings' => $sawResults,
        ];
    }

    /**
     * Helper: Susun matriks penilaian satu DM dari assessment pada sesi yang diminta.
     * Kandidat dan assessment sama-sama terikat session_id yang sama.
     */
    private function buildAssessmentMatrix(int $sessionId, int $userId, array $candidates): array
    {
        $matrix = [];
        foreach ($candidates as $c) {
            $matrix[$c['id']] = ['candidate_id' => (int)$c['id'], 'scores' => []];
        }
        $scores = $this->all(
            'SELECT candidate_id, criterion_id, score FROM assessments WHERE session_id = ? AND user_id = ?',
            [$sessionId, $userId]
        );
        foreach ($scores as $s) {
            $matrix[$s['candidate_id']]['scores'][(int)$s['criterion_id']] = (int)$s['score'];
        }
        return array_values($matrix);
    }

    /**
     * Perhitungan: Hasil TOPSIS Pribadi DM yang Sedang Login
     * Dipakai oleh endpoint GET /results/topsis/me (dan alias /results/topsis).
     * Identitas DM selalu berasal dari token; session_id hanya memilih sesi aktif.
     */
    public function calculateTopsisMe(?array $user, ?int $sessionId = null): array
    {
        $sessionId = $this->resolveSessionId($sessionId);
        $u = $this->actor($user);
        $this->bad(
            !in_array($u['role'], ['chair', 'member'], true),
            403,
            'Akses ditolak. Hanya Ketua Panel dan Anggota Panel yang memiliki perhitungan TOPSIS pribadi.'
        );
        $statusRow = $this->one(
            'SELECT is_finalized FROM assessment_status WHERE session_id = ? AND user_id = ?',
            [$sessionId, $u['id']]
        );
        $this->bad(
            empty($statusRow['is_finalized']),
            409,
            'Anda harus menyelesaikan dan memfinalisasi penilaian terlebih dahulu sebelum melihat hasil TOPSIS.'
        );

        $candidates = $this->listCandidates(null, $sessionId);
        $criteria = $this->listCriteria(null, $sessionId);
        $candidateMap = array_column($candidates, 'name', 'id');

        $matrix = $this->buildAssessmentMatrix($sessionId, (int)$u['id'], $candidates);
        $topsisResults = $this->calc->calculateTopsis($criteria, $matrix);

        foreach ($topsisResults as &$item) {
            $item['candidate_name'] = $candidateMap[$item['candidate_id']] ?? ('Kandidat ' . $item['candidate_id']);
        }

        return [
            'dm_user_id' => (int)$u['id'],
            'dm_name' => $u['name'],
            'rankings' => $topsisResults,
        ];
    }

    /**
     * Perhitungan: Agregasi Borda dari Ketiga Decision Maker
     * Sumber skor: TOPSIS per DM (final_score presisi penuh), bukan SAW.
     */
    public function calculateBorda(?int $sessionId = null): array
    {
        $sessionId = $this->resolveSessionId($sessionId);
        $panelStatus = $this->getAssessmentsStatus($sessionId);
        $this->bad(
            !$panelStatus['all_finalized'],
            409,
            'Hasil Borda belum dapat dihitung karena belum seluruh Decision Maker memfinalisasi penilaian.'
        );

        $candidates = $this->listCandidates(null, $sessionId);
        $criteria = $this->listCriteria(null, $sessionId);
        // Hanya Ketua dan Anggota Panel yang menilai; pemilih publik tidak memiliki
        // penilaian dan tidak boleh masuk ke agregasi Borda.
        $users = $this->all(
            'SELECT id, name FROM users WHERE role IN ("chair", "member") ORDER BY id',
            []
        );

        $dmScores = [];
        foreach ($users as $usr) {
            $uId = (int)$usr['id'];
            $matrix = $this->buildAssessmentMatrix($sessionId, $uId, $candidates);
            $topsisOut = $this->calc->calculateTopsis($criteria, $matrix);
            $dmScores[$uId] = array_column($topsisOut, 'final_score', 'candidate_id');
        }

        return $this->calc->calculateBorda($dmScores, $candidates);
    }

    /**
     * Voting: Status Sesi Voting Saat Ini
     */
    public function getVotingStatus(?array $user, ?int $sessionId = null): array
    {
        $sessionId = $this->resolveSessionId($sessionId);
        $u = $this->actor($user);
        $session = $this->one('SELECT * FROM decision_sessions WHERE id = ?', [$sessionId]);
        $this->bad($session === null, 404, 'Sesi keputusan tidak ditemukan.');

        $currentRoundNo = (int)$session['current_round'];
        $currentRound = null;
        $hasVoted = false;
        $votesCount = 0;
        $evalResult = null;

        if ($currentRoundNo > 0) {
            $currentRound = $this->one(
                'SELECT * FROM voting_rounds WHERE session_id = ? AND round_number = ?',
                [$sessionId, $currentRoundNo]
            );

            if ($currentRound !== null) {
                $userVote = $this->one(
                    'SELECT id FROM votes WHERE round_id = ? AND user_id = ?',
                    [$currentRound['id'], $u['id']]
                );
                $hasVoted = ($userVote !== null);

                $roundVotes = $this->all(
                    'SELECT user_id, candidate_id FROM votes WHERE round_id = ?',
                    [$currentRound['id']]
                );
                $votesCount = count($roundVotes);

                $voteMap = array_column($roundVotes, 'candidate_id', 'user_id');

                // Get eligible voter count from snapshot
                $eligibleCountRow = $this->one(
                    'SELECT COUNT(*) as cnt FROM session_voters WHERE session_id = ?',
                    [$sessionId]
                );
                $eligibleCount = (int)$eligibleCountRow['cnt'];

                $evalResult = $this->calc->evaluateVotes($voteMap, $this->listCandidates(null, $sessionId), $eligibleCount);
            }
        }

        $decision = $this->one(
            'SELECT fd.*, c.name as candidate_name, u.name as approved_by_name FROM final_decisions fd JOIN candidates c ON fd.candidate_id = c.id JOIN users u ON fd.approved_by = u.id WHERE fd.session_id = ?',
            [$sessionId]
        );

        // Snapshot electorate metadata (frozen at first round)
        $eligibleCountRow = $this->one(
            'SELECT COUNT(*) as cnt FROM session_voters WHERE session_id = ?',
            [$sessionId]
        );
        $eligibleCount = (int)$eligibleCountRow['cnt'];

        $isEligible = false;
        if ($eligibleCount > 0) {
            $snapshotRow = $this->one(
                'SELECT user_id FROM session_voters WHERE session_id = ? AND user_id = ?',
                [$sessionId, $u['id']]
            );
            $isEligible = ($snapshotRow !== null);
        }

        return [
            'session_id' => $sessionId,
            'session_status' => $session['status'],
            'current_round' => $currentRoundNo,
            'round_id' => $currentRound !== null ? (int)$currentRound['id'] : null,
            'is_voting_open' => ($session['status'] === 'voting' && $currentRound !== null && $currentRound['status'] === 'open'),
            'has_voted_this_round' => $hasVoted,
            'votes_cast_in_round' => $votesCount,
            'eligible_voters' => $eligibleCount,
            'required_votes' => $eligibleCount,
            'majority_threshold' => $eligibleCount > 0 ? (int)ceil((2 * $eligibleCount) / 3) : 0,
            'is_eligible' => $isEligible,
            'evaluation' => $evalResult,
            'ratified_decision' => $decision,
            'can_chair_open' => ($u['role'] === 'chair' && in_array($session['status'], ['assessment', 'tie_revote'], true)),
            'can_chair_approve' => ($u['role'] === 'chair' && $session['status'] === 'voting_completed' && $evalResult && $evalResult['status'] === 'majority'),
            'electorate' => $this->buildElectorateStatus($sessionId, $currentRound),
        ];
    }

    /**
     * Bangun daftar status voting per anggota electorate.
     * Hanya menampilkan apakah sudah/belum voting dan waktu voting — kandidat pilihan TIDAK diekspos.
     *
     * @return array<int, array{user_id:int, username:string, name:string, role:string, has_voted:bool, voted_at:?string}>
     */
    private function buildElectorateStatus(int $sessionId, ?array $currentRound): array
    {
        $electors = $this->all(
            'SELECT sv.user_id, u.username, u.name, u.role
             FROM session_voters sv
             JOIN users u ON sv.user_id = u.id
             WHERE sv.session_id = ?
             ORDER BY sv.user_id',
            [$sessionId]
        );

        if (empty($electors) || $currentRound === null) {
            return array_map(fn(array $e) => [
                'user_id' => (int)$e['user_id'],
                'username' => $e['username'],
                'name' => $e['name'],
                'role' => $e['role'],
                'has_voted' => false,
                'voted_at' => null,
            ], $electors);
        }

        $voteRows = $this->all('SELECT user_id, voted_at FROM votes WHERE round_id = ?', [$currentRound['id']]);
        $votedMap = [];
        foreach ($voteRows as $vr) {
            $votedMap[(int)$vr['user_id']] = $vr['voted_at'] ?? null;
        }

        return array_map(function (array $e) use ($votedMap) {
            $userId = (int)$e['user_id'];
            $hasVoted = array_key_exists($userId, $votedMap);
            return [
                'user_id' => $userId,
                'username' => $e['username'],
                'name' => $e['name'],
                'role' => $e['role'],
                'has_voted' => $hasVoted,
                'voted_at' => $hasVoted ? $votedMap[$userId] : null,
            ];
        }, $electors);
    }

    /**
     * Voting: Buka Sesi Voting Putaran Pertama (Hanya Ketua Panel)
     */
    public function openVoting(?array $user, ?int $sessionId = null): array
    {
        $sessionId = $this->resolveSessionId($sessionId);
        $u = $this->chair($user);
        return $this->transaction(function () use ($u, $sessionId) {
            $session = $this->lockSession($sessionId);
            $this->bad(
                $session['status'] !== 'assessment',
                409,
                'Sesi voting hanya dapat dibuka saat sesi berstatus assessment.'
            );

            $status = $this->getAssessmentsStatus($sessionId);
            $this->bad(
                !$status['all_finalized'],
                409,
                'Seluruh Decision Maker harus memfinalisasi penilaian terlebih dahulu sebelum voting dapat dibuka.'
            );

            // Snapshot electorate resmi: hanya dm1, dm2, dm3 (diverifikasi dari tabel users).
            // Akun voter/demo/testing tidak pernah masuk snapshot.
            $sync = $this->reconcileElectorateRows($sessionId);

            $roundNo = 1;
            $this->exec(
                'INSERT INTO voting_rounds (session_id, round_number, status, opened_by) VALUES (?, ?, "open", ?)',
                [$sessionId, $roundNo, $u['id']]
            );

            $this->exec(
                'UPDATE decision_sessions SET status = "voting", current_round = ? WHERE id = ?',
                [$roundNo, $sessionId]
            );

            $this->audit(
                (int)$u['id'],
                'voting_electorate_sync',
                'Snapshot electorate diselaraskan: ' . count($sync['electorate']) . ' pemilih resmi (added=' . $sync['added'] . ', removed=' . $sync['removed'] . ')',
                $sessionId
            );
            $this->audit((int)$u['id'], 'voting_open', 'Membuka voting putaran ' . $roundNo, $sessionId);

            return [
                'round_number' => $roundNo,
                'status' => 'open',
                'message' => 'Sesi voting putaran 1 berhasil dibuka.',
            ];
        });
    }

    /**
     * Voting: Berikan 1 Suara pada Putaran Aktif
     */
    public function vote(?array $user, mixed $candidateId, ?int $sessionId = null): array
    {
        $sessionId = $this->resolveSessionId($sessionId);
        $u = $this->actor($user);
        $this->bad(
            !is_int($candidateId) && !(is_string($candidateId) && ctype_digit((string)$candidateId)),
            422,
            'Pilihan kandidat (candidate_id) wajib diisi berupa bilangan bulat.'
        );
        $cId = (int)$candidateId;
        $this->getCandidate($cId, null, $sessionId); // Pastikan kandidat valid pada sesi ini

        return $this->transaction(function () use ($u, $cId, $sessionId) {
            $session = $this->lockSession($sessionId);
            $this->bad(
                $session['status'] !== 'voting',
                409,
                'Voting tidak sedang dibuka atau telah ditutup.'
            );

            // Check user eligibility from session snapshot
            $eligible = $this->one(
                'SELECT user_id FROM session_voters WHERE session_id = ? AND user_id = ?',
                [$sessionId, $u['id']]
            );
            $this->bad(
                $eligible === null,
                403,
                'Anda tidak terdaftar dalam daftar pemilih yang berhak untuk sesi ini.'
            );

            // Lapisan kedua: identitas & role harus cocok dengan electorate resmi.
            // Mencegah akun voter/demo/testing memberi suara walau snapshot lama masih memuatnya.
            $expectedRole = self::OFFICIAL_ELECTORATE[$u['username']] ?? null;
            $this->bad(
                $expectedRole === null || $u['role'] !== $expectedRole,
                403,
                'Anda bukan bagian dari electorate resmi sesi ini.'
            );

            $roundNo = (int)$session['current_round'];
            $round = $this->one(
                'SELECT * FROM voting_rounds WHERE session_id = ? AND round_number = ?',
                [$sessionId, $roundNo]
            );
            $this->bad(
                $round === null || $round['status'] !== 'open',
                409,
                'Putaran voting ' . $roundNo . ' tidak sedang aktif menerima suara.'
            );

            $existingVote = $this->one(
                'SELECT id FROM votes WHERE round_id = ? AND user_id = ?',
                [$round['id'], $u['id']]
            );
            $this->bad(
                $existingVote !== null,
                409,
                'Anda sudah memberikan suara pada putaran ' . $roundNo . '. Suara yang sudah masuk tidak dapat diubah.'
            );

            $this->exec(
                'INSERT INTO votes (session_id, round_id, user_id, candidate_id) VALUES (?, ?, ?, ?)',
                [$sessionId, $round['id'], $u['id'], $cId]
            );

            $roundVotes = $this->all(
                'SELECT user_id, candidate_id FROM votes WHERE round_id = ?',
                [$round['id']]
            );
            $voteCount = count($roundVotes);

            // Get eligible voter count from snapshot
            $eligibleCountRow = $this->one(
                'SELECT COUNT(*) as cnt FROM session_voters WHERE session_id = ?',
                [$sessionId]
            );
            $eligibleCount = (int)$eligibleCountRow['cnt'];

            $eval = $this->calc->evaluateVotes(
                array_column($roundVotes, 'candidate_id', 'user_id'),
                $this->listCandidates(null, $sessionId),
                $eligibleCount
            );

            // If voting complete, update status
            if ($eval['is_completed']) {
                $now = date('Y-m-d H:i:s');
                if ($eval['status'] === 'majority') {
                    $this->exec('UPDATE voting_rounds SET status = "completed", closed_at = ? WHERE id = ?', [$now, $round['id']]);
                    $this->exec('UPDATE decision_sessions SET status = "voting_completed" WHERE id = ?', [$sessionId]);
                } else {
                    $this->exec('UPDATE voting_rounds SET status = "tie_revote", closed_at = ? WHERE id = ?', [$now, $round['id']]);
                    $this->exec('UPDATE decision_sessions SET status = "tie_revote" WHERE id = ?', [$sessionId]);
                }
            }

            $this->audit((int)$u['id'], 'voting_cast', 'Memberikan suara pada putaran ' . $roundNo, $sessionId);

            return [
                'round_number' => $roundNo,
                'has_voted' => true,
                'votes_cast_in_round' => $voteCount,
                'round_completed' => $eval['is_completed'],
                'evaluation' => $eval,
            ];
        });
    }

    /**
     * Voting: Ambil Hasil Perolehan Suara Putaran Terkini
     */
    public function getVotingResults(?int $sessionId = null): array
    {
        $sessionId = $this->resolveSessionId($sessionId);
        $session = $this->one('SELECT * FROM decision_sessions WHERE id = ?', [$sessionId]);
        $this->bad($session === null, 404, 'Sesi tidak ditemukan.');

        $currentRoundNo = (int)$session['current_round'];
        $this->bad($currentRoundNo < 1, 409, 'Belum ada putaran voting yang dimulai.');

        $round = $this->one(
            'SELECT * FROM voting_rounds WHERE session_id = ? AND round_number = ?',
            [$sessionId, $currentRoundNo]
        );
        $this->bad($round === null, 404, 'Putaran voting tidak ditemukan.');

        $votes = $this->all(
            'SELECT user_id, candidate_id FROM votes WHERE round_id = ?',
            [$round['id']]
        );

        $eval = $this->calc->evaluateVotes(
            array_column($votes, 'candidate_id', 'user_id'),
            $this->listCandidates(null, $sessionId),
            (int)$this->one('SELECT COUNT(*) as cnt FROM session_voters WHERE session_id = ?', [$sessionId])['cnt']
        );

        return [
            'session_status' => $session['status'],
            'round_number' => $currentRoundNo,
            'round_status' => $round['status'],
            'results' => $eval,
        ];
    }

    /**
     * Voting: Buka Putaran Ulang Jika Terjadi Seri 1-1-1 (Hanya Ketua Panel)
     */
    public function nextRoundVoting(?array $user, ?int $sessionId = null): array
    {
        $sessionId = $this->resolveSessionId($sessionId);
        $u = $this->chair($user);
        return $this->transaction(function () use ($u, $sessionId) {
            $session = $this->lockSession($sessionId);
            $this->bad(
                $session['status'] !== 'tie_revote',
                409,
                'Putaran baru hanya dapat dibuka apabila putaran sebelumnya menghasilkan seri (tie_revote).'
            );

            $currentRoundNo = (int)$session['current_round'];
            $prevRound = $this->one(
                'SELECT * FROM voting_rounds WHERE session_id = ? AND round_number = ?',
                [$sessionId, $currentRoundNo]
            );
            $this->bad(
                $prevRound === null || $prevRound['status'] !== 'tie_revote',
                409,
                'Putaran sebelumnya belum selesai atau tidak dalam kondisi seri.'
            );

            $nextRoundNo = $currentRoundNo + 1;

            // Revote mempertahankan electorate resmi yang sama (dm1, dm2, dm3).
            $sync = $this->reconcileElectorateRows($sessionId);

            $this->exec(
                'INSERT INTO voting_rounds (session_id, round_number, status, opened_by) VALUES (?, ?, "open", ?)',
                [$sessionId, $nextRoundNo, $u['id']]
            );

            $this->exec(
                'UPDATE decision_sessions SET status = "voting", current_round = ? WHERE id = ?',
                [$nextRoundNo, $sessionId]
            );

            $this->audit(
                (int)$u['id'],
                'voting_electorate_sync',
                'Revote memakai electorate resmi: ' . count($sync['electorate']) . ' pemilih (added=' . $sync['added'] . ', removed=' . $sync['removed'] . ')',
                $sessionId
            );
            $this->audit((int)$u['id'], 'voting_next_round', 'Membuka putaran voting ulang ' . $nextRoundNo, $sessionId);

            return [
                'round_number' => $nextRoundNo,
                'status' => 'open',
                'message' => 'Putaran voting ulang ' . $nextRoundNo . ' berhasil dibuka.',
            ];
        });
    }

    /**
     * Pengesahan: Sahkan Hasil Keputusan Mayoritas (Hanya Ketua Panel)
     */
    public function approveDecision(?array $user, string $reason, ?int $sessionId = null): array
    {
        $sessionId = $this->resolveSessionId($sessionId);
        $u = $this->chair($user);
        $reason = trim($reason);
        $this->bad($reason === '', 422, 'Alasan pengesahan konsensus wajib diisi.');
        $this->bad(mb_strlen($reason) > 1000, 422, 'Alasan pengesahan maksimal 1000 karakter.');

        return $this->transaction(function () use ($u, $reason, $sessionId) {
            $session = $this->lockSession($sessionId);
            $this->bad(
                $session['status'] !== 'voting_completed',
                409,
                'Pengesahan hanya dapat dilakukan setelah putaran voting menghasilkan mayoritas sah.'
            );

            $existing = $this->one('SELECT id FROM final_decisions WHERE session_id = ?', [$sessionId]);
            $this->bad($existing !== null, 409, 'Keputusan untuk sesi ini sudah pernah disahkan sebelumnya.');

            $currentRoundNo = (int)$session['current_round'];
            $round = $this->one(
                'SELECT * FROM voting_rounds WHERE session_id = ? AND round_number = ?',
                [$sessionId, $currentRoundNo]
            );
            $this->bad($round === null, 404, 'Data putaran voting tidak ditemukan.');

            $votes = $this->all('SELECT user_id, candidate_id FROM votes WHERE round_id = ?', [$round['id']]);
            $eval = $this->calc->evaluateVotes(
                array_column($votes, 'candidate_id', 'user_id'),
                $this->listCandidates(null, $sessionId),
                (int)$this->one('SELECT COUNT(*) as cnt FROM session_voters WHERE session_id = ?', [$sessionId])['cnt']
            );

            $this->bad($eval['status'] !== 'majority', 409, 'Tidak ada calon mayoritas yang sah untuk disahkan.');

            $winner = $eval['winner'];
            $now = date('Y-m-d H:i:s');

            $this->exec(
                'INSERT INTO final_decisions (session_id, round_id, candidate_id, approved_by, reason, total_votes, percentage, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [$sessionId, $round['id'], $winner['candidate_id'], $u['id'], $reason, $winner['votes'], $winner['percentage'], $now]
            );

            $this->exec('UPDATE decision_sessions SET status = "ratified" WHERE id = ?', [$sessionId]);

            $this->audit((int)$u['id'], 'decision_approve', 'Mengesahkan keputusan terpilih: ' . $winner['candidate_name'], $sessionId);

            return [
                'session_id' => $sessionId,
                'round_number' => $currentRoundNo,
                'candidate_id' => $winner['candidate_id'],
                'candidate_name' => $winner['candidate_name'],
                'total_votes' => $winner['votes'],
                'percentage' => $winner['percentage'],
                'approved_by' => $u['name'],
                'reason' => $reason,
                'approved_at' => $now,
            ];
        });
    }

    /**
     * Pengesahan: Ambil Keputusan Final yang Sudah Disahkan
     */
    public function getFinalDecision(?int $sessionId = null): ?array
    {
        $sessionId = $this->resolveSessionId($sessionId);
        $row = $this->one(
            'SELECT fd.id, fd.session_id, fd.round_id, fd.candidate_id, c.name as candidate_name, c.vision, c.mission, fd.total_votes, fd.percentage, u.name as approved_by_name, fd.reason, fd.approved_at, vr.round_number FROM final_decisions fd JOIN candidates c ON fd.candidate_id = c.id JOIN users u ON fd.approved_by = u.id JOIN voting_rounds vr ON fd.round_id = vr.id WHERE fd.session_id = ?',
            [$sessionId]
        );
        return $row ?: null;
    }

    /**
     * Pengesahan: Riwayat Keputusan dan Putaran Voting
     */
    public function getDecisionsHistory(?int $sessionId = null): array
    {
        $sessionId = $this->resolveSessionId($sessionId);
        $rounds = $this->all(
            'SELECT vr.id, vr.round_number, vr.status, vr.opened_at, vr.closed_at, u.name as opened_by_name FROM voting_rounds vr JOIN users u ON vr.opened_by = u.id WHERE vr.session_id = ? ORDER BY vr.round_number',
            [$sessionId]
        );

        $final = $this->getFinalDecision($sessionId);

        $roundsWithVotes = [];
        $candidates = $this->listCandidates(null, $sessionId);
        $eligibleCountRow = $this->one(
            'SELECT COUNT(*) as cnt FROM session_voters WHERE session_id = ?',
            [$sessionId]
        );
        $eligibleCount = (int)$eligibleCountRow['cnt'];
        foreach ($rounds as $r) {
            $votes = $this->all('SELECT user_id, candidate_id FROM votes WHERE round_id = ?', [$r['id']]);
            $eval = $this->calc->evaluateVotes(
                array_column($votes, 'candidate_id', 'user_id'),
                $candidates,
                $eligibleCount
            );
            $r['evaluation'] = $eval;
            $roundsWithVotes[] = $r;
        }

        return [
            'session_id' => $sessionId,
            'rounds' => $roundsWithVotes,
            'final_decision' => $final,
        ];
    }

    /* ==================================================================
     * PHASE 4 — ELECTION CYCLE / NEW ELECTION SYSTEM
     * ================================================================== */

    /**
     * Representasi ringkas satu sesi. Satu-satunya sumber is_active/can_create_election
     * untuk getActiveSession(), listElections(), dan getElection().
     */
    private function electionSummary(array $r, mixed $u, ?int $activeId): array
    {
        $sid = (int)$r['id'];
        $final = $this->getFinalDecision($sid);
        $electorate = $this->one('SELECT COUNT(*) AS n FROM session_voters WHERE session_id = ?', [$sid]);
        $rounds = $this->one('SELECT COUNT(*) AS n FROM voting_rounds WHERE session_id = ?', [$sid]);
        return [
            'id' => $sid,
            'title' => $r['title'],
            'description' => $r['description'],
            'status' => $r['status'],
            'current_round' => (int)$r['current_round'],
            'created_by' => $r['created_by'] !== null ? (int)$r['created_by'] : null,
            'previous_session_id' => $r['previous_session_id'] !== null ? (int)$r['previous_session_id'] : null,
            'created_at' => $r['created_at'],
            'updated_at' => $r['updated_at'],
            'electorate_count' => (int)$electorate['n'],
            'round_count' => (int)$rounds['n'],
            'is_active' => $activeId !== null && $sid === $activeId,
            'final_candidate' => $final['candidate_name'] ?? null,
            'can_create_election' => $u !== null
                && ($u['role'] ?? null) === 'chair'
                && $activeId !== null
                && $sid === $activeId
                && $r['status'] === 'ratified',
        ];
    }

    /**
     * Sesi aktif lengkap. Representasi identik dengan item listElections(),
     * is_active = true, can_create_election mengikuti aturan pembuatan siklus baru.
     */
    public function getActiveSession(?array $user = null): array
    {
        $row = $this->one('SELECT * FROM decision_sessions WHERE id = ?', [$this->getActiveSessionId()]);
        $this->bad($row === null, 404, 'Sesi pemilihan aktif tidak ditemukan.');
        return $this->electionSummary($row, $user, (int)$row['id']);
    }

    /**
     * Daftar semua siklus pemilihan (terbaru lebih dulu) untuk histori.
     * Data sesi lama tidak pernah ditimpa — dibaca langsung per session_id.
     */
    public function listElections(?array $user): array
    {
        $u = $this->actor($user);
        $activeId = $this->activeSessionIdOrNull();
        $rows = $this->all(
            'SELECT ds.id, ds.title, ds.description, ds.status, ds.current_round,
                    ds.created_by, ds.previous_session_id, ds.created_at, ds.updated_at
             FROM decision_sessions ds ORDER BY ds.id DESC'
        );
        return array_map(fn(array $r) => $this->electionSummary($r, $u, $activeId), $rows);
    }

    /**
     * Detail satu siklus pemilihan — dipakai histori untuk membaca ulang
     * SAW/Borda/voting/revote/keputusan final sesi lama tanpa mengubahnya.
     */
    public function getElection(?array $user, ?int $sessionId = null): array
    {
        $u = $this->actor($user);
        $sid = $this->resolveSessionId($sessionId);
        $row = $this->one('SELECT * FROM decision_sessions WHERE id = ?', [$sid]);
        $this->bad($row === null, 404, 'Siklus pemilihan tidak ditemukan.');

        $results = null;
        if ((int)$row['current_round'] > 0) {
            try {
                $results = $this->getVotingResults($sid);
            } catch (ApiError) {
                $results = null;
            }
        }

        return [
            'session' => $this->electionSummary($row, $u, $this->activeSessionIdOrNull()),
            'voting_status' => $this->getVotingStatus($u, $sid),
            'voting_results' => $results,
            'history' => $this->getDecisionsHistory($sid),
            'final_decision' => $this->getFinalDecision($sid),
        ];
    }

    /**
     * Buat siklus pemilihan baru. Hanya Ketua Panel, hanya jika sesi aktif
     * sudah ratified. MembuatBARU decision_session + snapshot 3 electorate.
     * Tidak membuat suara/kriteria/kandidat/penilaian, tidak menyentuh sesi lama.
     */
    public function createElectionCycle(
        ?array $user,
        string $title,
        ?string $description = null,
        ?string $ip = null
    ): array {
        $u = $this->chair($user);
        $title = trim($title);
        $this->bad($title === '', 422, 'Judul pemilihan wajib diisi.');
        $this->bad(mb_strlen($title) > 150, 422, 'Judul pemilihan maksimal 150 karakter.');

        if ($description !== null) {
            $description = trim($description);
            if ($description === '') {
                $description = null;
            }
            $this->bad($description !== null && mb_strlen($description) > 1000, 422, 'Deskripsi maksimal 1000 karakter.');
        }

        return $this->transaction(function () use ($u, $title, $description, $ip) {
            $driver = $this->db->getAttribute(PDO::ATTR_DRIVER_NAME);
            $lockSql = 'SELECT * FROM decision_sessions ORDER BY id DESC LIMIT 1'
                . ($driver === 'mysql' ? ' FOR UPDATE' : '');
            $previous = $this->one($lockSql);
            $this->bad($previous === null, 404, 'Belum ada sesi pemilihan yang tersedia.');
            $this->bad(
                $previous['status'] !== 'ratified',
                409,
                'Pemilihan baru hanya dapat dibuat setelah sesi sebelumnya disahkan (ratified).'
            );

            $electorate = $this->officialElectorate();
            $this->bad(count($electorate) !== 3, 409, 'Electorate resmi harus tepat 3 orang (dm1, dm2, dm3).');

            $this->exec(
                'INSERT INTO decision_sessions (title, description, status, current_round, created_by, previous_session_id)
                 VALUES (?, ?, ?, 0, ?, ?)',
                [$title, $description, 'assessment', (int)$u['id'], (int)$previous['id']]
            );
            $newId = (int)$this->db->lastInsertId();

            // Snapshot electorate HANYA untuk sesi baru.
            foreach ($electorate as $member) {
                $this->exec(
                    'INSERT INTO session_voters (session_id, user_id) VALUES (?, ?)',
                    [$newId, $member['id']]
                );
            }

            // Guard: sesi baru harus bersih dari data turunan otomatis.
            foreach (['assessments', 'assessment_status', 'voting_rounds', 'votes', 'final_decisions'] as $table) {
                $count = (int)$this->one("SELECT COUNT(*) AS n FROM {$table} WHERE session_id = ?", [$newId])['n'];
                $this->bad($count !== 0, 500, "Sesi baru tidak boleh memuat data {$table} otomatis.");
            }
            $snapshot = $this->all('SELECT user_id FROM session_voters WHERE session_id = ? ORDER BY user_id', [$newId]);
            $this->bad(count($snapshot) !== 3, 500, 'Snapshot electorate sesi baru harus tepat 3 orang.');

            $this->audit(
                (int)$u['id'],
                'election_cycle_create',
                sprintf('Siklus pemilihan #%d "%s" dibuat dari sesi #%d.', $newId, $title, (int)$previous['id']),
                $newId,
                $ip
            );

            return [
                'session_id' => $newId,
                'title' => $title,
                'description' => $description,
                'status' => 'assessment',
                'current_round' => 0,
                'previous_session_id' => (int)$previous['id'],
                'created_by' => (int)$u['id'],
                'electorate' => array_map(fn(array $e) => [
                    'user_id' => $e['id'],
                    'username' => $e['username'],
                    'role' => $e['role'],
                ], $electorate),
                'message' => "Siklus pemilihan #{$newId} berhasil dibuat.",
            ];
        });
    }
}
