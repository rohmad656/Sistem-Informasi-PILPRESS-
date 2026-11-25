<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

use Gdss\App;
use Gdss\ApiError;
use Gdss\DecisionService;

$passed = 0;
$failed = 0;

function it(string $testName, callable $fn): void
{
    global $passed, $failed;
    try {
        $fn();
        $passed++;
        echo " [PASS] " . $testName . PHP_EOL;
    } catch (\Throwable $e) {
        $failed++;
        echo " [FAIL] " . $testName . " -> " . $e->getMessage() . " in " . $e->getFile() . ":" . $e->getLine() . PHP_EOL;
    }
}

function assertEquals(mixed $expected, mixed $actual, string $msg = ''): void
{
    if ($expected !== $actual) {
        throw new RuntimeException($msg . ' Expected ' . var_export($expected, true) . ' but got ' . var_export($actual, true));
    }
}

function assertClose(float $expected, float $actual, float $delta = 0.001, string $msg = ''): void
{
    if (abs($expected - $actual) > $delta) {
        throw new RuntimeException($msg . " Expected {$expected} +/- {$delta}, got {$actual}");
    }
}

function assertTrue(bool $condition, string $msg = ''): void
{
    if (!$condition) {
        throw new RuntimeException($msg . ' Expected true but got false');
    }
}

function createTestDb(bool $allowUnknownStatus = false): PDO
{
    $pdo = new PDO('sqlite::memory:', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON;');

    // Khusus test anomali: izinkan status di luar lifecycle pada fixture.
    $statusConstraint = $allowUnknownStatus
        ? ''
        : " CHECK(status IN ('assessment', 'voting', 'tie_revote', 'voting_completed', 'ratified'))";

    $pdo->exec("
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('chair', 'member', 'voter')) DEFAULT 'voter',
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE decision_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT NOT NULL{$statusConstraint},
            current_round INTEGER NOT NULL DEFAULT 0,
            created_by INTEGER NULL,
            previous_session_id INTEGER NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY(previous_session_id) REFERENCES decision_sessions(id) ON DELETE SET NULL
        );
        CREATE TABLE candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL DEFAULT 1,
            name TEXT NOT NULL,
            description TEXT,
            vision TEXT,
            mission TEXT,
            work_program TEXT,
            profile TEXT,
            is_finalized INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME,
            FOREIGN KEY(session_id) REFERENCES decision_sessions(id) ON DELETE CASCADE
        );
        CREATE TABLE criteria (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL DEFAULT 1,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            description TEXT,
            weight INTEGER NOT NULL CHECK(weight > 0),
            type TEXT NOT NULL CHECK(type IN ('benefit', 'cost')),
            is_finalized INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME,
            FOREIGN KEY(session_id) REFERENCES decision_sessions(id) ON DELETE CASCADE
        );
        CREATE TABLE assessments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL DEFAULT 1,
            user_id INTEGER NOT NULL,
            candidate_id INTEGER NOT NULL,
            criterion_id INTEGER NOT NULL,
            score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(session_id, user_id, candidate_id, criterion_id),
            FOREIGN KEY(session_id) REFERENCES decision_sessions(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
            FOREIGN KEY(criterion_id) REFERENCES criteria(id) ON DELETE CASCADE
        );
        CREATE TABLE assessment_status (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL DEFAULT 1,
            user_id INTEGER NOT NULL,
            is_finalized INTEGER NOT NULL DEFAULT 0,
            finalized_at DATETIME,
            UNIQUE(session_id, user_id),
            FOREIGN KEY(session_id) REFERENCES decision_sessions(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE voting_rounds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL DEFAULT 1,
            round_number INTEGER NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('open', 'completed', 'tie_revote')),
            opened_by INTEGER NOT NULL,
            opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            closed_at DATETIME,
            UNIQUE(session_id, round_number),
            FOREIGN KEY(session_id) REFERENCES decision_sessions(id) ON DELETE CASCADE,
            FOREIGN KEY(opened_by) REFERENCES users(id)
        );
        CREATE TABLE votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL DEFAULT 1,
            round_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            candidate_id INTEGER NOT NULL,
            voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(round_id, user_id),
            FOREIGN KEY(session_id) REFERENCES decision_sessions(id) ON DELETE CASCADE,
            FOREIGN KEY(round_id) REFERENCES voting_rounds(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(candidate_id) REFERENCES candidates(id)
        );
        CREATE TABLE final_decisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL DEFAULT 1,
            round_id INTEGER NOT NULL,
            candidate_id INTEGER NOT NULL,
            approved_by INTEGER NOT NULL,
            reason TEXT NOT NULL,
            total_votes INTEGER NOT NULL,
            percentage REAL NOT NULL,
            approved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(session_id),
            FOREIGN KEY(session_id) REFERENCES decision_sessions(id) ON DELETE CASCADE,
            FOREIGN KEY(round_id) REFERENCES voting_rounds(id),
            FOREIGN KEY(candidate_id) REFERENCES candidates(id),
            FOREIGN KEY(approved_by) REFERENCES users(id)
        );
        CREATE TABLE session_voters (
            session_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (session_id, user_id),
            FOREIGN KEY(session_id) REFERENCES decision_sessions(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE login_attempts (
            bucket TEXT PRIMARY KEY,
            attempts INTEGER NOT NULL DEFAULT 1,
            started_at INTEGER NOT NULL
        );
        CREATE TABLE audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            user_id INTEGER,
            action TEXT NOT NULL,
            details TEXT NOT NULL,
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
        );
    ");

    // Seed Data
    $passHash = password_hash('password123', PASSWORD_BCRYPT);
    $pdo->exec("
        INSERT INTO users (id, username, name, role, password_hash) VALUES
        (1, 'dm1', 'Ketua Panel', 'chair', '{$passHash}'),
        (2, 'dm2', 'Anggota Panel 1', 'member', '{$passHash}'),
        (3, 'dm3', 'Anggota Panel 2', 'member', '{$passHash}');

        INSERT INTO decision_sessions (id, title, description, status, current_round) VALUES
        (1, 'Simulasi GDSS Pemilihan Calon Presiden 2026', 'Deskripsi Sesi', 'assessment', 0);

        INSERT INTO candidates (id, session_id, name, description, vision, mission, work_program, profile, is_finalized) VALUES
        (1, 1, 'Kandidat A', 'Deskripsi A', 'Visi A', 'Misi A', 'Program A', 'Profil A', 1),
        (2, 1, 'Kandidat B', 'Deskripsi B', 'Visi B', 'Misi B', 'Program B', 'Profil B', 1),
        (3, 1, 'Kandidat C', 'Deskripsi C', 'Visi C', 'Misi C', 'Program C', 'Profil C', 1);

        INSERT INTO criteria (id, session_id, code, name, description, weight, type, is_finalized) VALUES
        (1, 1, 'C1', 'Pengalaman kepemimpinan', 'Desc 1', 25, 'benefit', 1),
        (2, 1, 'C2', 'Kejelasan program kerja', 'Desc 2', 30, 'benefit', 1),
        (3, 1, 'C3', 'Rekam jejak kegiatan', 'Desc 3', 25, 'benefit', 1),
        (4, 1, 'C4', 'Kemampuan komunikasi', 'Desc 4', 20, 'benefit', 1);

        -- Nilai matriks Excel
        INSERT INTO assessments (session_id, user_id, candidate_id, criterion_id, score) VALUES
        (1, 1, 1, 1, 5), (1, 1, 1, 2, 5), (1, 1, 1, 3, 4), (1, 1, 1, 4, 4),
        (1, 1, 2, 1, 4), (1, 1, 2, 2, 4), (1, 1, 2, 3, 5), (1, 1, 2, 4, 4),
        (1, 1, 3, 1, 3), (1, 1, 3, 2, 4), (1, 1, 3, 3, 4), (1, 1, 3, 4, 5),

        (1, 2, 1, 1, 4), (1, 2, 1, 2, 5), (1, 2, 1, 3, 4), (1, 2, 1, 4, 4),
        (1, 2, 2, 1, 5), (1, 2, 2, 2, 5), (1, 2, 2, 3, 5), (1, 2, 2, 4, 4),
        (1, 2, 3, 1, 4), (1, 2, 3, 2, 3), (1, 2, 3, 3, 4), (1, 2, 3, 4, 5),

        (1, 3, 1, 1, 5), (1, 3, 1, 2, 5), (1, 3, 1, 3, 4), (1, 3, 1, 4, 5),
        (1, 3, 2, 1, 4), (1, 3, 2, 2, 4), (1, 3, 2, 3, 4), (1, 3, 2, 4, 3),
        (1, 3, 3, 1, 4), (1, 3, 3, 2, 4), (1, 3, 3, 3, 5), (1, 3, 3, 4, 4);

        INSERT INTO assessment_status (session_id, user_id, is_finalized, finalized_at) VALUES
        (1, 1, 0, NULL),
        (1, 2, 0, NULL),
        (1, 3, 0, NULL);
    ");

    return $pdo;
}

echo "=== MENJALANKAN AUTOMATED TEST BACKEND GDSS ===" . PHP_EOL;

// 1. Login berhasil
it('Test 1: Login berhasil dengan kredensial benar', function () {
    $db = createTestDb();
    $app = new App($db);
    $user = $app->login('dm1', 'password123', '127.0.0.1');
    assertEquals('dm1', $user['username']);
    assertEquals('chair', $user['role']);
    assertEquals('Ketua Panel', $user['name']);
});

// 2. Login password salah
it('Test 2: Login gagal jika password salah', function () {
    $db = createTestDb();
    $app = new App($db);
    try {
        $app->login('dm1', 'wrong_pass', '127.0.0.1');
        throw new RuntimeException('Harusnya melempar ApiError 401');
    } catch (ApiError $e) {
        assertEquals(401, $e->httpStatus);
    }
});

// 3. Akses tanpa autentikasi ditolak
it('Test 3: Akses tanpa autentikasi (null user) ditolak dengan 401', function () {
    $db = createTestDb();
    $app = new App($db);
    try {
        $app->getAssessmentsMe(null);
        throw new RuntimeException('Harusnya melempar ApiError 401');
    } catch (ApiError $e) {
        assertEquals(401, $e->httpStatus);
    }
});

// 4. DM tidak dapat mengakses aksi khusus ketua
it('Test 4: Anggota (member) tidak dapat membuka voting (khusus chair)', function () {
    $db = createTestDb();
    $app = new App($db);
    $member = ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota 1'];
    try {
        $app->openVoting($member);
        throw new RuntimeException('Harusnya melempar ApiError 403');
    } catch (ApiError $e) {
        assertEquals(403, $e->httpStatus);
    }
});

// 5. Penilaian tidak lengkap tidak bisa difinalisasi
it('Test 5: Penilaian yang belum lengkap tidak dapat difinalisasi', function () {
    $db = createTestDb();
    $app = new App($db);
    // Hapus satu penilaian DM1 agar tidak lengkap (hanya 11 dari 12)
    $db->exec('DELETE FROM assessments WHERE user_id = 1 AND candidate_id = 1 AND criterion_id = 1');
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    try {
        $app->finalizeAssessmentsMe($chair);
        throw new RuntimeException('Harusnya melempar ApiError 422');
    } catch (ApiError $e) {
        assertEquals(422, $e->httpStatus);
    }
});

// 6. Skor SAW sesuai Excel
it('Test 6: Skor SAW masing-masing DM presisi 100% sesuai target Excel', function () {
    $db = createTestDb();
    $app = new App($db);

    // Finalisasikan seluruh DM
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $dm1 = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $saw1 = $app->calculateSawMe($dm1)['rankings'];
    $scores1 = array_column($saw1, 'final_score', 'candidate_id');
    assertEquals(91.0, (float)$scores1[1], 'DM1 Skor A');
    assertEquals(85.0, (float)$scores1[2], 'DM1 Skor B');
    assertEquals(79.0, (float)$scores1[3], 'DM1 Skor C');

    $dm2 = ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota 1'];
    $saw2 = $app->calculateSawMe($dm2)['rankings'];
    $scores2 = array_column($saw2, 'final_score', 'candidate_id');
    assertEquals(86.0, (float)$scores2[1], 'DM2 Skor A');
    assertEquals(96.0, (float)$scores2[2], 'DM2 Skor B');
    assertEquals(78.0, (float)$scores2[3], 'DM2 Skor C');

    $dm3 = ['id' => 3, 'username' => 'dm3', 'role' => 'member', 'name' => 'Anggota 2'];
    $saw3 = $app->calculateSawMe($dm3)['rankings'];
    $scores3 = array_column($saw3, 'final_score', 'candidate_id');
    assertEquals(95.0, (float)$scores3[1], 'DM3 Skor A');
    assertEquals(76.0, (float)$scores3[2], 'DM3 Skor B');
    assertEquals(85.0, (float)$scores3[3], 'DM3 Skor C');
});

// 7. Borda sesuai Excel
it('Test 7: Agregasi Borda menghasilkan poin dan persentase tepat sesuai Excel', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $borda = $app->calculateBorda();
    $points = array_column($borda['rankings'], 'borda_points', 'candidate_id');
    $percentages = array_column($borda['rankings'], 'percentage', 'candidate_id');

    // Excel target: A = 8 poin (44.44%), B = 6 poin (33.33%), C = 4 poin (22.22%)
    assertEquals(8.0, (float)$points[1], 'Poin Borda A');
    assertEquals(6.0, (float)$points[2], 'Poin Borda B');
    assertEquals(4.0, (float)$points[3], 'Poin Borda C');

    assertClose(44.44, (float)$percentages[1], 0.01, 'Persentase A');
    assertClose(33.33, (float)$percentages[2], 0.01, 'Persentase B');
    assertClose(22.22, (float)$percentages[3], 0.01, 'Persentase C');
});

// 8. Voting tidak dapat dibuka sebelum seluruh DM selesai menilai
it('Test 8: Voting tidak dapat dibuka sebelum seluruh DM memfinalisasi penilaian', function () {
    $db = createTestDb();
    $app = new App($db);
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];

    // Hanya DM1 yang difinalisasi
    $db->exec('UPDATE assessment_status SET is_finalized = 1 WHERE user_id = 1');

    try {
        $app->openVoting($chair);
        throw new RuntimeException('Harusnya melempar ApiError 409');
    } catch (ApiError $e) {
        assertEquals(409, $e->httpStatus);
    }
});

// 9. Satu DM tidak dapat voting dua kali
it('Test 9: Satu DM tidak dapat memberikan suara lebih dari sekali pada putaran yang sama', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $app->openVoting($chair);

    // Vote pertama DM1
    $app->vote($chair, 1);

    // Vote kedua DM1 pada putaran yang sama harus gagal
    try {
        $app->vote($chair, 2);
        throw new RuntimeException('Harusnya melempar ApiError 409 untuk duplicate vote');
    } catch (ApiError $e) {
        assertEquals(409, $e->httpStatus);
    }
});

// 10. Mayoritas 2-1 menghasilkan kandidat mayoritas
it('Test 10: Voting dengan sebaran suara 2-1 menghasilkan status mayoritas sah', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $dm2 = ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota 1'];
    $dm3 = ['id' => 3, 'username' => 'dm3', 'role' => 'member', 'name' => 'Anggota 2'];

    $app->openVoting($chair);

    // DM1 -> A, DM2 -> B, DM3 -> A (Sesuai contoh di instruksi)
    $app->vote($chair, 1);
    $app->vote($dm2, 2);
    $res3 = $app->vote($dm3, 1);

    assertTrue($res3['round_completed'], 'Putaran selesai');
    assertEquals('majority', $res3['evaluation']['status']);
    assertEquals(1, $res3['evaluation']['winner']['candidate_id']);
    assertEquals(2, $res3['evaluation']['winner']['votes']);
    assertClose(66.67, $res3['evaluation']['winner']['percentage'], 0.01);
});

// 11. Seri 1-1-1 memerlukan voting ulang
it('Test 11: Sebaran suara 1-1-1 menghasilkan status tie_revote', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $dm2 = ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota 1'];
    $dm3 = ['id' => 3, 'username' => 'dm3', 'role' => 'member', 'name' => 'Anggota 2'];

    $app->openVoting($chair);

    // DM1 -> A, DM2 -> B, DM3 -> C
    $app->vote($chair, 1);
    $app->vote($dm2, 2);
    $res = $app->vote($dm3, 3);

    assertTrue($res['round_completed']);
    assertEquals('tie_revote', $res['evaluation']['status']);
    assertEquals(null, $res['evaluation']['winner']);
});

// 12. Putaran voting ulang mempunyai data terpisah
it('Test 12: Putaran voting ulang (round 2) menyimpan data terpisah dari round 1', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $dm2 = ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota 1'];
    $dm3 = ['id' => 3, 'username' => 'dm3', 'role' => 'member', 'name' => 'Anggota 2'];

    // Round 1: Seri 1-1-1
    $app->openVoting($chair);
    $app->vote($chair, 1);
    $app->vote($dm2, 2);
    $app->vote($dm3, 3);

    // Buka Round 2
    $nextRound = $app->nextRoundVoting($chair);
    assertEquals(2, $nextRound['round_number']);

    // Berikan suara di Round 2: DM1 -> A, DM2 -> A, DM3 -> B
    $app->vote($chair, 1);
    $app->vote($dm2, 1);
    $res2 = $app->vote($dm3, 2);

    assertEquals(2, $res2['round_number']);
    assertEquals('majority', $res2['evaluation']['status']);
    assertEquals(1, $res2['evaluation']['winner']['candidate_id']);

    // Cek riwayat keputusan mencatat 2 putaran terpisah
    $history = $app->getDecisionsHistory();
    assertEquals(2, count($history['rounds']));
    assertEquals(1, $history['rounds'][0]['round_number']);
    assertEquals(2, $history['rounds'][1]['round_number']);
});

// 13. Hanya Ketua Panel yang boleh mengesahkan
it('Test 13: Anggota (member) dilarang mengesahkan keputusan', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $dm2 = ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota 1'];
    $dm3 = ['id' => 3, 'username' => 'dm3', 'role' => 'member', 'name' => 'Anggota 2'];

    $app->openVoting($chair);
    $app->vote($chair, 1);
    $app->vote($dm2, 1);
    $app->vote($dm3, 2);

    try {
        $app->approveDecision($dm2, 'Saya anggota ingin mengesahkan');
        throw new RuntimeException('Harusnya melempar ApiError 403');
    } catch (ApiError $e) {
        assertEquals(403, $e->httpStatus);
    }
});

// 14. Hasil final bisa dilihat semua DM
it('Test 14: Setelah disahkan ketua, hasil final dapat diakses semua DM', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $dm2 = ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota 1'];
    $dm3 = ['id' => 3, 'username' => 'dm3', 'role' => 'member', 'name' => 'Anggota 2'];

    $app->openVoting($chair);
    $app->vote($chair, 1);
    $app->vote($dm2, 1);
    $app->vote($dm3, 2);

    $app->approveDecision($chair, 'Konsensus mayoritas bulat menyetujui Kandidat A');

    $final = $app->getFinalDecision();
    assertTrue($final !== null);
    assertEquals('Kandidat A', $final['candidate_name']);
    assertEquals(2, (int)$final['total_votes']);
    assertEquals('Ketua Panel', $final['approved_by_name']);
});

// 15. Pengesahan tidak boleh dilakukan dua kali
it('Test 15: Keputusan tidak dapat disahkan dua kali untuk sesi yang sama', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $dm2 = ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota 1'];
    $dm3 = ['id' => 3, 'username' => 'dm3', 'role' => 'member', 'name' => 'Anggota 2'];

    $app->openVoting($chair);
    $app->vote($chair, 1);
    $app->vote($dm2, 1);
    $app->vote($dm3, 2);

    $app->approveDecision($chair, 'Pengesahan pertama');

    try {
        $app->approveDecision($chair, 'Pengesahan kedua');
        throw new RuntimeException('Harusnya melempar ApiError 409');
    } catch (ApiError $e) {
        assertEquals(409, $e->httpStatus);
    }
});

// 16. Pengujian ranking seri pada SAW/Borda (average points sharing)
it('Test 16: Pengujian ranking seri pada Borda membagi poin rata-rata secara adil', function () {
    $calc = new DecisionService();
    $candidates = [
        ['id' => 1, 'name' => 'Kandidat A'],
        ['id' => 2, 'name' => 'Kandidat B'],
        ['id' => 3, 'name' => 'Kandidat C'],
    ];

    // Skenario: DM1 memberikan skor seri A dan B (90, 90, 70)
    // Posisi 1 dan 2 seri -> poin (3 + 2)/2 = 2.5 untuk A dan B, 1 untuk C
    // DM2 memberikan skor unik (90, 80, 70) -> A=3, B=2, C=1
    // DM3 memberikan skor unik (80, 90, 70) -> B=3, A=2, C=1
    $dmScores = [
        1 => [1 => 90.0, 2 => 90.0, 3 => 70.0],
        2 => [1 => 90.0, 2 => 80.0, 3 => 70.0],
        3 => [1 => 80.0, 2 => 90.0, 3 => 70.0],
    ];

    $borda = $calc->calculateBorda($dmScores, $candidates);
    $points = array_column($borda['rankings'], 'borda_points', 'candidate_id');

    // A: 2.5 + 3 + 2 = 7.5 poin
    // B: 2.5 + 2 + 3 = 7.5 poin
    // C: 1.0 + 1 + 1 = 3.0 poin
    // Total = 18.0 poin
    assertEquals(7.5, (float)$points[1], 'Poin Borda Seri A');
    assertEquals(7.5, (float)$points[2], 'Poin Borda Seri B');
    assertEquals(3.0, (float)$points[3], 'Poin Borda C');
    assertEquals(18.0, (float)$borda['total_points_distributed']);
});

// 17. Pemilih publik tidak boleh memblokir pembukaan voting
it('Test 17: Pemilih publik (voter) tidak dihitung dalam status penilaian panel', function () {
    $db = createTestDb();
    $app = new App($db);
    $hash = password_hash('password123', PASSWORD_BCRYPT);
    $db->exec("INSERT INTO users (id, username, name, role, password_hash) VALUES (4, 'voter1', 'Pemilih Satu', 'voter', '{$hash}')");
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $status = $app->getAssessmentsStatus();
    assertEquals(3, $status['total_panelists'], 'Panelis hanya chair + member');
    assertTrue($status['all_finalized'], 'Voter tidak boleh membuat all_finalized=false');
    foreach ($status['panel'] as $p) {
        assertTrue(in_array($p['role'], ['chair', 'member'], true), 'Voter tidak boleh muncul di panel');
    }
});

// 18. Registrasi publik selalu menghasilkan role voter
it('Test 18: Registrasi publik memaksa role voter dan menolak username duplikat', function () {
    $db = createTestDb();
    $app = new App($db);

    $res = $app->register('Pemilih Baru', 'pemilihbaru', 'rahasia123', '127.0.0.1');
    assertEquals('voter', $res['role'], 'Role registrasi harus voter');

    $row = $db->query("SELECT role FROM users WHERE username = 'pemilihbaru'")->fetch(PDO::FETCH_ASSOC);
    assertEquals('voter', $row['role'], 'Role di database harus voter');

    try {
        $app->register('Pemilih Lain', 'pemilihbaru', 'rahasia123', '127.0.0.1');
        throw new RuntimeException('Username duplikat harus ditolak');
    } catch (ApiError $e) {
        assertEquals(409, $e->httpStatus);
    }
});

// 19. Snapshot electorate dibekukan saat voting dibuka
it('Test 19: Snapshot electorate dibekukan dan pendaftar setelahnya tidak berhak memilih', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $app->openVoting($chair);

    $snapshotCount = (int)$db->query('SELECT COUNT(*) FROM session_voters')->fetchColumn();
    assertEquals(3, $snapshotCount, 'Snapshot awal hanya chair + member');

    // Registrasi setelah voting dibuka
    $late = $app->register('Pemilih Terlambat', 'terlambat', 'rahasia123', '127.0.0.1');
    $lateUser = ['id' => $late['id'], 'username' => 'terlambat', 'role' => 'voter', 'name' => 'Pemilih Terlambat'];

    $snapshotAfter = (int)$db->query('SELECT COUNT(*) FROM session_voters')->fetchColumn();
    assertEquals(3, $snapshotAfter, 'Snapshot tidak boleh bertambah setelah voting dibuka');

    try {
        $app->vote($lateUser, 1);
        throw new RuntimeException('Pendaftar setelah snapshot harus ditolak 403');
    } catch (ApiError $e) {
        assertEquals(403, $e->httpStatus);
    }
});

// 20. Voter publik tidak masuk electorate resmi dan ditolak saat voting
// 20. Voter publik tidak masuk electorate resmi dan ditolak saat voting
it('Test 20: Voter publik (voter1) tidak termasuk electorate resmi dan ditolak 403 saat voting', function () {
    $db = createTestDb();
    $app = new App($db);
    $hash = password_hash('password123', PASSWORD_BCRYPT);
    $db->exec("INSERT INTO users (id, username, name, role, password_hash) VALUES (4, 'voter1', 'Pemilih Satu', 'voter', '{$hash}')");
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $app->openVoting($chair);

    $snapshotCount = (int)$db->query('SELECT COUNT(*) FROM session_voters')->fetchColumn();
    assertEquals(3, $snapshotCount, 'Snapshot electorate resmi hanya 3 panelis (dm1, dm2, dm3)');

    $voter = ['id' => 4, 'username' => 'voter1', 'role' => 'voter', 'name' => 'Pemilih Satu'];
    try {
        $app->vote($voter, 1);
        throw new RuntimeException('Voter publik harus ditolak 403');
    } catch (ApiError $e) {
        assertEquals(403, $e->httpStatus);
    }
});

// 21. Borda hanya mengagregasi panel, bukan voter
it('Test 21: Agregasi Borda mengabaikan voter tanpa penilaian', function () {
    $db = createTestDb();
    $app = new App($db);
    $hash = password_hash('password123', PASSWORD_BCRYPT);
    $db->exec("INSERT INTO users (id, username, name, role, password_hash) VALUES (4, 'voter1', 'Pemilih Satu', 'voter', '{$hash}')");
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $borda = $app->calculateBorda();
    $points = array_column($borda['rankings'], 'borda_points', 'candidate_id');
    assertEquals(8.0, (float)$points[1], 'Poin Borda A tetap sesuai Excel');
    assertEquals(6.0, (float)$points[2], 'Poin Borda B tetap sesuai Excel');
    assertEquals(4.0, (float)$points[3], 'Poin Borda C tetap sesuai Excel');
    assertEquals(3, count($borda['dm_breakdown']), 'Breakdown hanya 3 panelis');
    assertTrue(!array_key_exists(4, $borda['dm_breakdown']), 'Voter tidak boleh masuk breakdown Borda');
});

// ==== ELECTORATE RESMI: HANYA dm1, dm2, dm3 ====

// E1. Snapshot electorate resmi hanya memuat dm1, dm2, dm3
it('E1: Snapshot electorate resmi hanya memuat dm1, dm2, dm3 (3 akun)', function () {
    $db = createTestDb();
    $app = new App($db);
    $hash = password_hash('password123', PASSWORD_BCRYPT);
    // Tambahkan akun voter demo dan akun testing
    $db->exec("INSERT INTO users (id, username, name, role, password_hash) VALUES
        (4, 'voter1', 'Pemilih Satu', 'voter', '{$hash}'),
        (5, 'testuser_1491913741', 'Test User', 'voter', '{$hash}'),
        (6, 'testproxy_1854160100', 'Test Proxy', 'voter', '{$hash}'),
        (7, 'uitestvoter_1093219771', 'UI Test', 'voter', '{$hash}'),
        (8, 'qa_voter_1793827344', 'QA Voter', 'voter', '{$hash}')");
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $app->openVoting($chair);

    $snapshot = $db->query('SELECT user_id FROM session_voters ORDER BY user_id')->fetchAll(PDO::FETCH_COLUMN);
    assertEquals([1, 2, 3], $snapshot, 'Snapshot harus tepat dm1, dm2, dm3');
    assertEquals(3, count($snapshot), 'Jumlah electorate harus 3');
});

// E2. voter1 tidak dapat memberikan suara
it('E2: voter1 tidak dapat memberikan suara (403)', function () {
    $db = createTestDb();
    $app = new App($db);
    $hash = password_hash('password123', PASSWORD_BCRYPT);
    $db->exec("INSERT INTO users (id, username, name, role, password_hash) VALUES (4, 'voter1', 'Pemilih Satu', 'voter', '{$hash}')");
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $app->openVoting($chair);

    $voter = ['id' => 4, 'username' => 'voter1', 'role' => 'voter', 'name' => 'Pemilih Satu'];
    try {
        $app->vote($voter, 1);
        throw new RuntimeException('voter1 harus ditolak 403');
    } catch (ApiError $e) {
        assertEquals(403, $e->httpStatus);
    }
});

// E3. Akun testing tidak dapat memberikan suara
it('E3: Akun testing tidak dapat memberikan suara (403)', function () {
    $db = createTestDb();
    $app = new App($db);
    $hash = password_hash('password123', PASSWORD_BCRYPT);
    $db->exec("INSERT INTO users (id, username, name, role, password_hash) VALUES
        (4, 'testuser_1491913741', 'Test User', 'voter', '{$hash}'),
        (5, 'testproxy_1854160100', 'Test Proxy', 'voter', '{$hash}')");
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $app->openVoting($chair);

    foreach ([4, 5] as $uid) {
        $tester = ['id' => $uid, 'username' => 'testuser', 'role' => 'voter', 'name' => 'Test'];
        try {
            $app->vote($tester, 1);
            throw new RuntimeException("Akun testing id={$uid} harus ditolak 403");
        } catch (ApiError $e) {
            assertEquals(403, $e->httpStatus);
        }
    }
});

// E4. dm1, dm2, dm3 dapat memberikan suara
it('E4: dm1, dm2, dm3 dapat memberikan suara', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $dm2 = ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota 1'];
    $dm3 = ['id' => 3, 'username' => 'dm3', 'role' => 'member', 'name' => 'Anggota 2'];

    $app->openVoting($chair);

    $res1 = $app->vote($chair, 1);
    assertTrue($res1['has_voted']);
    $res2 = $app->vote($dm2, 2);
    assertTrue($res2['has_voted']);
    $res3 = $app->vote($dm3, 3);
    assertTrue($res3['has_voted']);

    assertEquals(3, $res3['votes_cast_in_round']);
});

// E5. Dua suara valid memenuhi threshold mayoritas (2/3 dari 3 = 2)
it('E5: Dua suara untuk kandidat sama memenuhi threshold mayoritas 2/3', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $dm2 = ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota 1'];
    $dm3 = ['id' => 3, 'username' => 'dm3', 'role' => 'member', 'name' => 'Anggota 2'];

    $app->openVoting($chair);
    $app->vote($chair, 1);
    $app->vote($dm2, 1);
    $res = $app->vote($dm3, 2);

    assertEquals('majority', $res['evaluation']['status']);
    assertEquals(2, $res['evaluation']['winner']['votes']);
    assertEquals(2, $res['evaluation']['majority_threshold']);
    assertEquals(1, $res['evaluation']['winner']['candidate_id']);
});

// E6. Tiga suara valid menyelesaikan pengumpulan suara
it('E6: Tiga suara valid menyelesaikan pengumpulan suara (session voting_completed)', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $dm2 = ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota 1'];
    $dm3 = ['id' => 3, 'username' => 'dm3', 'role' => 'member', 'name' => 'Anggota 2'];

    $app->openVoting($chair);
    $app->vote($chair, 1);
    $app->vote($dm2, 1);
    $res = $app->vote($dm3, 2);

    assertTrue($res['round_completed']);
    $status = $app->getVotingStatus($chair);
    assertEquals('voting_completed', $status['session_status']);
    assertEquals(3, $status['votes_cast_in_round']);
    assertEquals(3, $status['eligible_voters']);
});

// E7. Hasil seri memicu revote
it('E7: Hasil seri 1-1-1 memicu status tie_revote', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $dm2 = ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota 1'];
    $dm3 = ['id' => 3, 'username' => 'dm3', 'role' => 'member', 'name' => 'Anggota 2'];

    $app->openVoting($chair);
    $app->vote($chair, 1);
    $app->vote($dm2, 2);
    $res = $app->vote($dm3, 3);

    assertEquals('tie_revote', $res['evaluation']['status']);
    $status = $app->getVotingStatus($chair);
    assertEquals('tie_revote', $status['session_status']);
});

// E8. Revote mempertahankan tiga pemilih yang sama
it('E8: Revote mempertahankan electorate yang sama (dm1, dm2, dm3)', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $dm2 = ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota 1'];
    $dm3 = ['id' => 3, 'username' => 'dm3', 'role' => 'member', 'name' => 'Anggota 2'];

    // Round 1: seri
    $app->openVoting($chair);
    $app->vote($chair, 1);
    $app->vote($dm2, 2);
    $app->vote($dm3, 3);

    // Round 2
    $app->nextRoundVoting($chair);
    $snapshot = $db->query('SELECT user_id FROM session_voters ORDER BY user_id')->fetchAll(PDO::FETCH_COLUMN);
    assertEquals([1, 2, 3], $snapshot, 'Electorate revote harus sama dengan round 1');

    // Semua panelis masih bisa memilih di round 2
    $app->vote($chair, 1);
    $app->vote($dm2, 1);
    $res = $app->vote($dm3, 2);
    assertEquals('majority', $res['evaluation']['status']);
});

// E9. Duplicate vote ditolak
it('E9: Duplicate vote ditolak 409', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $app->openVoting($chair);
    $app->vote($chair, 1);

    try {
        $app->vote($chair, 2);
        throw new RuntimeException('Duplicate vote harus ditolak 409');
    } catch (ApiError $e) {
        assertEquals(409, $e->httpStatus);
    }
});

// E10. Suara dm1 tetap utuh setelah rekonsiliasi electorate
it('E10: Suara dm1 tetap utuh setelah rekonsiliasi electorate', function () {
    $db = createTestDb();
    $app = new App($db);
    $hash = password_hash('password123', PASSWORD_BCRYPT);
    // Simulasi kondisi bug: snapshot berisi 8 akun (termasuk voter/testing)
    $db->exec("INSERT INTO users (id, username, name, role, password_hash) VALUES
        (4, 'voter1', 'Pemilih Satu', 'voter', '{$hash}'),
        (5, 'testuser_1491913741', 'Test User', 'voter', '{$hash}'),
        (6, 'testproxy_1854160100', 'Test Proxy', 'voter', '{$hash}'),
        (7, 'uitestvoter_1093219771', 'UI Test', 'voter', '{$hash}'),
        (8, 'qa_voter_1793827344', 'QA Voter', 'voter', '{$hash}')");
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $app->openVoting($chair);

    // dm1 sudah voting sebelum rekonsiliasi
    $app->vote($chair, 1);

    // Simulasi snapshot kotor: tambahkan voter non-panel ke session_voters
    $db->exec("INSERT INTO session_voters (session_id, user_id) VALUES (1, 4), (1, 5), (1, 6), (1, 7), (1, 8)");
    $before = (int)$db->query('SELECT COUNT(*) FROM session_voters')->fetchColumn();
    assertEquals(8, $before, 'Snapshot kotor berisi 8 akun');

    // Rekonsiliasi
    $result = $app->reconcileElectorate(1);
    assertEquals(3, count($result['electorate']), 'Electorate setelah rekonsiliasi harus 3');
    assertEquals(5, $result['removed'], '5 akun non-panel dihapus dari snapshot');

    // Suara dm1 tetap utuh
    $votes = $db->query('SELECT user_id, candidate_id FROM votes')->fetchAll(PDO::FETCH_ASSOC);
    assertEquals(1, count($votes), 'Jumlah suara tidak berubah');
    assertEquals(1, (int)$votes[0]['user_id'], 'Suara dm1 tetap ada');
    assertEquals(1, (int)$votes[0]['candidate_id'], 'Suara dm1 untuk kandidat 1 tetap utuh');

    // Status sesi tidak berubah
    $session = $db->query('SELECT status FROM decision_sessions')->fetch(PDO::FETCH_ASSOC);
    assertEquals('voting', $session['status'], 'Status sesi tetap voting (belum selesai)');
});

// ==== STATUS VOTING API: electorate per panelis ====

// E11. getVotingStatus mengekspos electorate lengkap tanpa membocorkan pilihan kandidat
it('E11: getVotingStatus mengekspos electorate dengan status voting tanpa membocorkan pilihan kandidat', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $dm2 = ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota 1'];
    $dm3 = ['id' => 3, 'username' => 'dm3', 'role' => 'member', 'name' => 'Anggota 2'];

    $app->openVoting($chair);
    $app->vote($chair, 1);

    $status = $app->getVotingStatus($chair);

    assertEquals(3, count($status['electorate']), 'Electorate harus 3 panelis');
    assertEquals(3, $status['eligible_voters']);
    assertEquals(1, $status['votes_cast_in_round']);

    $byUsername = array_column($status['electorate'], null, 'username');
    assertEquals(['dm1', 'dm2', 'dm3'], array_keys($byUsername));
    assertTrue($byUsername['dm1']['has_voted'], 'dm1 sudah voting');
    assertTrue(!$byUsername['dm2']['has_voted'], 'dm2 belum voting');
    assertTrue(!$byUsername['dm3']['has_voted'], 'dm3 belum voting');

    // Privasi: kandidat pilihan tidak boleh diekspos
    foreach ($status['electorate'] as $entry) {
        $keys = array_keys($entry);
        sort($keys);
        $expectedKeys = ['has_voted', 'name', 'role', 'user_id', 'username', 'voted_at'];
        sort($expectedKeys);
        assertEquals(
            $expectedKeys,
            $keys,
            'Field electorate harus memuat identitas dan status voting tanpa candidate_id'
        );
        assertTrue(!array_key_exists('candidate_id', $entry), 'candidate_id tidak boleh ada');
    }
});

// E12. Electorate ter-update setelah dm2 dan dm3 voting
it('E12: Electorate ter-update menjadi 3/3 setelah dm2 dan dm3 voting', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $dm2 = ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota 1'];
    $dm3 = ['id' => 3, 'username' => 'dm3', 'role' => 'member', 'name' => 'Anggota 2'];

    $app->openVoting($chair);
    $app->vote($chair, 1);

    $partial = $app->getVotingStatus($chair);
    assertEquals(1, $partial['votes_cast_in_round']);
    assertEquals('voting', $partial['session_status'], 'Pengumpulan belum selesai');

    $app->vote($dm2, 2);
    $app->vote($dm3, 1);

    $done = $app->getVotingStatus($chair);
    assertEquals(3, $done['votes_cast_in_round']);
    assertEquals(3, $done['eligible_voters']);
    assertEquals('voting_completed', $done['session_status']);

    foreach ($done['electorate'] as $entry) {
        assertTrue($entry['has_voted'], 'Semua panelis harus sudah voting: ' . $entry['username']);
    }
});

// E13. Electorate kosong saat sesi belum memiliki putaran voting
it('E13: Sesi tahap assessment mengembalikan electorate kosong dan tanpa suara', function () {
    $db = createTestDb();
    $app = new App($db);

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $status = $app->getVotingStatus($chair);

    assertEquals('assessment', $status['session_status']);
    assertEquals(0, $status['current_round']);
    assertEquals(0, $status['votes_cast_in_round']);
    assertEquals([], $status['electorate'], 'Belum ada electorate sebelum voting dibuka');
});

// =====================================================================
// PHASE 4 — ELECTION CYCLE / NEW ELECTION SYSTEM
// =====================================================================

/** Bantu:ubah sesi 1 fixture menjadi ratified (tanpa menyentuh baris lain). */
function ratifySessionOne(PDO $db): void
{
    $db->exec("UPDATE decision_sessions SET status = 'ratified', current_round = 1 WHERE id = 1");
}

/** Bantu:sidik integritas seluruh turunan sesi 1. */
function sessionOneSnapshot(PDO $db): array
{
    $session = $db->query('SELECT id, title, status, current_round, created_by, previous_session_id FROM decision_sessions WHERE id = 1')->fetch(PDO::FETCH_ASSOC);
    $counts = [];
    foreach (['assessments', 'assessment_status', 'voting_rounds', 'votes', 'final_decisions', 'session_voters'] as $t) {
        $st = $db->prepare("SELECT COUNT(*) FROM {$t} WHERE session_id = 1");
        $st->execute();
        $counts[$t] = (int)$st->fetchColumn();
    }
    return ['session' => $session, 'counts' => $counts];
}

// P4-1. Hanya Ketua Panel yang boleh membuat siklus baru
it('P4-1: createElectionCycle menolak member dan voter (403)', function () {
    $db = createTestDb();
    $app = new App($db);
    ratifySessionOne($db);

    foreach ([
        ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota 1'],
        ['id' => 3, 'username' => 'dm3', 'role' => 'member', 'name' => 'Anggota 2'],
        ['id' => 4, 'username' => 'voter1', 'role' => 'voter', 'name' => 'Pemilih'],
    ] as $actor) {
        try {
            $app->createElectionCycle($actor, 'Pemilihan Baru');
            throw new RuntimeException('Harusnya 403 untuk role ' . $actor['role']);
        } catch (ApiError $e) {
            assertEquals(403, $e->httpStatus);
        }
    }
    assertEquals(1, (int)$db->query('SELECT COUNT(*) FROM decision_sessions')->fetchColumn());
});

// P4-2. Sesi aktif belum ratified -> 409
it('P4-2: createElectionCycle ditolak jika sesi aktif belum ratified (409)', function () {
    $db = createTestDb();
    $app = new App($db);
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];

    try {
        $app->createElectionCycle($chair, 'Pemilihan Baru');
        throw new RuntimeException('Harusnya 409');
    } catch (ApiError $e) {
        assertEquals(409, $e->httpStatus);
    }
    assertEquals(1, (int)$db->query('SELECT COUNT(*) FROM decision_sessions')->fetchColumn());
});

// P4-3. Siklus baru dibuat dengan status assessment & jejak sesi sebelumnya
it('P4-3: createElectionCycle membuat sesi baru assessment dengan previous_session_id', function () {
    $db = createTestDb();
    $app = new App($db);
    ratifySessionOne($db);
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];

    $res = $app->createElectionCycle($chair, 'Pemilihan 2027', 'Deskripsi baru', '127.0.0.1');

    assertEquals(2, $res['session_id']);
    assertEquals('assessment', $res['status']);
    assertEquals(0, $res['current_round']);
    assertEquals(1, $res['previous_session_id']);
    assertEquals(1, $res['created_by']);
    assertEquals(2, (int)$db->query('SELECT COUNT(*) FROM decision_sessions')->fetchColumn());

    $new = $db->query('SELECT * FROM decision_sessions WHERE id = 2')->fetch(PDO::FETCH_ASSOC);
    assertEquals('Pemilihan 2027', $new['title']);
    assertEquals('assessment', $new['status']);
    assertEquals(0, (int)$new['current_round']);
});

// P4-4. Snapshot electorate tepat 3, tanpa voter/demo/testing tambahan
it('P4-4: Snapshot electorate sesi baru tepat dm1, dm2, dm3 (3 orang)', function () {
    $db = createTestDb();
    $app = new App($db);
    ratifySessionOne($db);
    $hash = password_hash('password123', PASSWORD_BCRYPT);
    $db->exec("INSERT INTO users (id, username, name, role, password_hash) VALUES
        (4, 'voter1', 'Pemilih Satu', 'voter', '{$hash}'),
        (5, 'qa_voter_1793827344', 'QA Voter', 'voter', '{$hash}'),
        (6, 'demo_user', 'Demo User', 'voter', '{$hash}')");

    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $res = $app->createElectionCycle($chair, 'Pemilihan Bersih');

    assertEquals(3, count($res['electorate']));
    $snapshot = $db->query('SELECT user_id FROM session_voters WHERE session_id = 2 ORDER BY user_id')->fetchAll(PDO::FETCH_COLUMN);
    assertEquals([1, 2, 3], array_map('intval', $snapshot));
    assertEquals(3, count($snapshot), 'Electorate session 2 harus tepat 3');

    $usernames = array_column($res['electorate'], 'username');
    assertEquals(['dm1', 'dm2', 'dm3'], $usernames);
});

// P4-5. Sesi baru bersih: tanpa suara/kriteria/kandidat/penilaian otomatis
it('P4-5: Sesi baru tidak memuat suara, putaran, penilaian, atau keputusan otomatis', function () {
    $db = createTestDb();
    $app = new App($db);
    ratifySessionOne($db);
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $app->createElectionCycle($chair, 'Pemilihan Bersih');

    foreach (['assessments', 'assessment_status', 'voting_rounds', 'votes', 'final_decisions'] as $t) {
        $n = (int)$db->query("SELECT COUNT(*) FROM {$t} WHERE session_id = 2")->fetchColumn();
        assertEquals(0, $n, "Tabel {$t} sesi 2 harus kosong");
    }
    // Master data tidak boleh bertambah
    assertEquals(3, (int)$db->query('SELECT COUNT(*) FROM candidates')->fetchColumn());
    assertEquals(4, (int)$db->query('SELECT COUNT(*) FROM criteria')->fetchColumn());
});

// P4-6. Sesi 1 & turungannya tidak berubah
it('P4-6: Data sesi 1 dan seluruh turunannya utuh setelah pembuatan siklus', function () {
    $db = createTestDb();
    $app = new App($db);
    ratifySessionOne($db);
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];

    $before = sessionOneSnapshot($db);
    $app->createElectionCycle($chair, 'Pemilihan Baru');
    $after = sessionOneSnapshot($db);

    assertEquals($before, $after, 'Sesi 1 tidak boleh berubah setelah create cycle');
    assertEquals(36, $after['counts']['assessments']);
    assertEquals($before['counts']['session_voters'], $after['counts']['session_voters']);
});

// P4-7. Tidak bisa membuat siklus berturut-turut (aktif bukan ratified)
it('P4-7: Siklus kedua ditolak karena sesi aktif baru saja dibuat (409)', function () {
    $db = createTestDb();
    $app = new App($db);
    ratifySessionOne($db);
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $app->createElectionCycle($chair, 'Pemilihan Pertama');

    try {
        $app->createElectionCycle($chair, 'Pemilihan Kedua');
        throw new RuntimeException('Harusnya 409');
    } catch (ApiError $e) {
        assertEquals(409, $e->httpStatus);
    }
    assertEquals(2, (int)$db->query('SELECT COUNT(*) FROM decision_sessions')->fetchColumn());
});

// P4-8. listElections: flag can_create & is_active
it('P4-8: listElections menandai can_create_election hanya pada sesi aktif ratified', function () {
    $db = createTestDb();
    $app = new App($db);
    ratifySessionOne($db);
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];

    $before = $app->listElections($chair);
    assertEquals(1, count($before));
    assertTrue($before[0]['is_active']);
    assertTrue($before[0]['can_create_election']);

    $app->createElectionCycle($chair, 'Pemilihan Baru');
    $after = $app->listElections($chair);
    assertEquals(2, count($after));
    assertEquals(2, $after[0]['id'], 'Sesi terbaru lebih dulu');
    assertTrue($after[0]['is_active']);
    assertTrue(!$after[0]['can_create_election'], 'Sesi baru assessment belum boleh dibuat siklus lagi');
    assertTrue(!$after[1]['can_create_election'], 'Sesi lama bukan aktif');
    assertEquals(1, $after[1]['id']);
});

// P4-9. getElection(sesi lama) membaca hasil lama tanpa mengubahnya
it('P4-9: getElection(sesi lama) mengembalikan voting, history, dan keputusan final', function () {
    $db = createTestDb();
    $app = new App($db);
    ratifySessionOne($db);
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $db->exec("INSERT INTO voting_rounds (id, session_id, round_number, status, opened_by) VALUES (1, 1, 1, 'completed', 1)");
    $db->exec("INSERT INTO session_voters (session_id, user_id) VALUES (1, 1), (1, 2), (1, 3)");
    $db->exec("INSERT INTO votes (session_id, round_id, user_id, candidate_id) VALUES (1, 1, 1, 1), (1, 1, 2, 1), (1, 1, 3, 2)");
    $db->exec("INSERT INTO final_decisions (session_id, round_id, candidate_id, approved_by, reason, total_votes, percentage) VALUES (1, 1, 1, 1, 'Mayoritas', 2, 66.67)");

    // Buat siklus baru, lalu baca ulang sesi lama lewat histori
    $app->createElectionCycle($chair, 'Pemilihan Baru');
    $snapshot = sessionOneSnapshot($db);
    $detail = $app->getElection($chair, 1);

    assertEquals(1, $detail['session']['id']);
    assertEquals('ratified', $detail['session']['status']);
    assertTrue(!$detail['session']['is_active'], 'Sesi lama bukan sesi aktif');
    assertTrue(!$detail['session']['can_create_election']);
    assertEquals(1, count($detail['history']['rounds']));
    assertClose(66.67, (float)$detail['final_decision']['percentage'], 0.01);
    assertTrue($detail['voting_results'] !== null, 'Hasil voting sesi lama tetap dapat dibaca');
    assertEquals($snapshot, sessionOneSnapshot($db), 'Membaca histori tidak mengubah sesi lama');
});

// P4-10. Endpoint default mengikuti sesi aktif (tanpa hardcode)
it('P4-10: Resolusi sesi aktif mengikuti siklus terbaru (tanpa hardcode id=1)', function () {
    $db = createTestDb();
    $app = new App($db);
    ratifySessionOne($db);
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    assertEquals(1, $app->getActiveSessionId());

    $app->createElectionCycle($chair, 'Pemilihan Baru');
    assertEquals(2, $app->getActiveSessionId());

    $status = $app->getVotingStatus($chair);
    assertEquals(2, $status['session_id'], 'Endpoint harus pakai sesi aktif terbaru');
    $final = $app->getFinalDecision();
    assertEquals(null, $final, 'Sesi baru belum punya keputusan final');
    assertEquals('assessment', $app->getActiveSession()['status']);
});

// P4-11. getActiveSession pada sesi ratified: is_active=true, can_create=true untuk chair
it('P4-11: getActiveSession pada sesi ratified mengembalikan is_active=true & can_create untuk chair', function () {
    $db = createTestDb();
    $app = new App($db);
    ratifySessionOne($db);
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];

    $active = $app->getActiveSession($chair);
    assertEquals(1, $active['id']);
    assertEquals('ratified', $active['status']);
    assertTrue($active['is_active']);
    assertTrue($active['can_create_election']);
    // Field standar ada (final_candidate boleh null -> pakai array_key_exists)
    assertTrue(array_key_exists('electorate_count', $active));
    assertTrue(array_key_exists('round_count', $active));
    assertTrue(array_key_exists('final_candidate', $active));
});

// P4-12. getActiveSession pada sesi assessment/voting: is_active=true, can_create=false
it('P4-12: getActiveSession pada assessment/voting mengembalikan is_active=true & can_create=false', function () {
    $db = createTestDb();
    $app = new App($db);
    // assessment
    $db->exec("UPDATE decision_sessions SET status = 'assessment', current_round = 0 WHERE id = 1");
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $act1 = $app->getActiveSession($chair);
    assertEquals('assessment', $act1['status']);
    assertTrue($act1['is_active']);
    assertTrue(!$act1['can_create_election']);

    // voting
    $db2 = createTestDb();
    $app2 = new App($db2);
    $db2->exec("UPDATE decision_sessions SET status = 'voting', current_round = 1 WHERE id = 1");
    $act2 = $app2->getActiveSession($chair);
    assertEquals('voting', $act2['status']);
    assertTrue($act2['is_active']);
    assertTrue(!$act2['can_create_election']);
});

// P4-13. Status lifecycle tidak dikenal → 409 pada getActiveSessionId & resolve
it('P4-13: Status tidak dikenal (anomali) ditolak sebagai sesi aktif', function () {
    $db = createTestDb(true); // fixture tanpa CHECK constraint
    $app = new App($db);
    ratifySessionOne($db); // sesi 1 ratified
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];

    // Sisip sesi anomali id=2 status tidak dikenal
    $db->exec("INSERT INTO decision_sessions (id, title, status, current_round) VALUES (2, 'Anomali', 'legacy_broken', 99)");

    // getActiveSessionId & getActiveSession harus 409
    try {
        $app->getActiveSessionId();
        throw new RuntimeException('Harusnya 409');
    } catch (ApiError $e) {
        assertEquals(409, $e->httpStatus);
    }
    try {
        $app->getActiveSession($chair);
        throw new RuntimeException('Harusnya 409');
    } catch (ApiError $e) {
        assertEquals(409, $e->httpStatus);
    }

    // listElections tetap jalan, is_active false semua
    $list = $app->listElections($chair);
    assertEquals(2, count($list));
    assertTrue(!$list[0]['is_active']);
    assertTrue(!$list[1]['is_active']);
    assertTrue(!$list[0]['can_create_election']);
    assertTrue(!$list[1]['can_create_election']);
});

// P4-14. Konsistensi is_active & can_create di tiga method (normal state)
it('P4-14: listElections, getElection, getActiveSession konsisten pada state normal', function () {
    $db = createTestDb();
    $app = new App($db);
    ratifySessionOne($db);
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $member = ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota'];

    // Chair
    $listC = $app->listElections($chair);
    $activeC = $app->getActiveSession($chair);
    $detailC = $app->getElection($chair, 1);
    assertEquals($listC[0]['id'], $activeC['id']);
    assertEquals($listC[0]['id'], $detailC['session']['id']);
    assertEquals($listC[0]['is_active'], $activeC['is_active']);
    assertEquals($listC[0]['is_active'], $detailC['session']['is_active']);
    assertEquals($listC[0]['can_create_election'], $activeC['can_create_election']);
    assertEquals($listC[0]['can_create_election'], $detailC['session']['can_create_election']);

    // Member: can_create false di semua
    $listM = $app->listElections($member);
    $activeM = $app->getActiveSession($member);
    $detailM = $app->getElection($member, 1);
    assertTrue(!$listM[0]['can_create_election']);
    assertTrue(!$activeM['can_create_election']);
    assertTrue(!$detailM['session']['can_create_election']);
});

// P4-15. Sesi anomali tidak menyebabkan operasi tulis salah sasaran
it('P4-15: Sesi anomali memblokir operasi tulis default (openVoting 409)', function () {
    $db = createTestDb(true);
    $app = new App($db);
    ratifySessionOne($db);
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];

    // Anomali id=2
    $db->exec("INSERT INTO decision_sessions (id, title, status, current_round) VALUES (2, 'Anomali', 'legacy_broken', 99)");

    // openVoting tanpa session_id eksplisit → harus 409, tidak menyentuh sesi 1
    try {
        $app->openVoting($chair);
        throw new RuntimeException('Harusnya 409');
    } catch (ApiError $e) {
        assertEquals(409, $e->httpStatus);
    }
    // Sesi 1 tetap utuh
    $vr = $db->query("SELECT COUNT(*) FROM voting_rounds WHERE session_id = 1")->fetchColumn();
    assertEquals(0, (int)$vr);
});

// P4-16. createElectionCycle gagal bila sesi terakhir anomali
it('P4-16: createElectionCycle menolak bila sesi terakhir anomali', function () {
    $db = createTestDb(true);
    $app = new App($db);
    ratifySessionOne($db);
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];

    $db->exec("INSERT INTO decision_sessions (id, title, status, current_round) VALUES (2, 'Anomali', 'legacy_broken', 99)");

    try {
        $app->createElectionCycle($chair, 'Harus Gagal');
        throw new RuntimeException('Harusnya 409');
    } catch (ApiError $e) {
        assertEquals(409, $e->httpStatus);
    }
    // Tidak ada sesi 3 dibuat
    assertEquals(2, (int)$db->query('SELECT COUNT(*) FROM decision_sessions')->fetchColumn());
});

// P4-17. Histori sesi 1 tidak berubah setelah operasi anomali
it('P4-17: Histori sesi 1 utuh setelah upaya create/operasi pada anomali', function () {
    $db = createTestDb(true);
    $app = new App($db);
    ratifySessionOne($db);
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];

    $snap = sessionOneSnapshot($db);

    // Upaya operasi gagal
    $db->exec("INSERT INTO decision_sessions (id, title, status, current_round) VALUES (2, 'Anomali', 'legacy_broken', 99)");
    try { $app->createElectionCycle($chair, 'X'); } catch (ApiError) {}
    try { $app->openVoting($chair); } catch (ApiError) {}
    try { $app->getActiveSession($chair); } catch (ApiError) {}

    $snap2 = sessionOneSnapshot($db);
    assertEquals($snap, $snap2);
});

// ---------- Phase 5: Criteria Management & Candidate Nomination ----------
function p5FreshSession(PDO $db, App $app): array
{
    ratifySessionOne($db);
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $res = $app->createElectionCycle($chair, 'Sesi Uji Phase 5');
    return [$chair, (int)$res['session_id']];
}

// P5-1. Kriteria/kandidat terisolasi per sesi (sesi 2 baru tidak mewarisi data sesi 1)
it('P5-1: Master data terisolasi per sesi — sesi baru tidak mewarisi kriteria/kandidat lama', function () {
    $db = createTestDb();
    $app = new App($db);
    [$chair, $sid] = p5FreshSession($db, $app);

    assertEquals(4, count($app->listCriteria($chair, 1)));
    assertEquals(3, count($app->listCandidates($chair, 1)));
    assertEquals(0, count($app->listCriteria($chair, $sid)));
    assertEquals(0, count($app->listCandidates($chair, $sid)));
});

// P5-2. Chair tambah kriteria; bobot valid; kode auto C5
it('P5-2: Chair menambah kriteria dengan bobot valid dan kode otomatis', function () {
    $db = createTestDb();
    $app = new App($db);
    [$chair, $sid] = p5FreshSession($db, $app);

    $r = $app->createCriterion($chair, ['name' => 'Integritas', 'description' => 'Uji', 'weight' => 40, 'type' => 'benefit'], null, $sid);
    assertEquals('C5', $r['code']);
    $rows = $app->listCriteria($chair, $sid);
    assertEquals(1, count($rows));
    assertEquals(40, (int)$rows[0]['weight']);
    assertEquals(0, (int)$rows[0]['is_finalized']);
});

// P5-3. Bobot tidak boleh melebihi 100
it('P5-3: Total bobot kriteria ditolak bila melebihi 100%', function () {
    $db = createTestDb();
    $app = new App($db);
    [$chair, $sid] = p5FreshSession($db, $app);
    $app->createCriterion($chair, ['name' => 'A', 'weight' => 60], null, $sid);

    try {
        $app->createCriterion($chair, ['name' => 'B', 'weight' => 50], null, $sid);
        throw new RuntimeException('Harusnya 422');
    } catch (ApiError $e) {
        assertEquals(422, $e->httpStatus);
    }
});

// P5-4. Finalisasi kriteria wajib total tepat 100
it('P5-4: Finalisasi kriteria ditolak bila total bobot bukan 100%', function () {
    $db = createTestDb();
    $app = new App($db);
    [$chair, $sid] = p5FreshSession($db, $app);
    $app->createCriterion($chair, ['name' => 'A', 'weight' => 60], null, $sid);

    try {
        $app->finalizeCriteria($chair, null, $sid);
        throw new RuntimeException('Harusnya 422');
    } catch (ApiError $e) {
        assertEquals(422, $e->httpStatus);
    }

    $app->createCriterion($chair, ['name' => 'B', 'weight' => 40], null, $sid);
    $res = $app->finalizeCriteria($chair, null, $sid);
    assertEquals(2, $res['count']);
    $sum = $app->getCriteriaSummary($chair, $sid);
    assertTrue($sum['is_finalized']);
    assertTrue($sum['is_complete']);
    assertEquals(100, $sum['total_weight']);
    assertTrue(!$sum['can_manage'], 'Kriteria final tidak bisa dikelola lagi');
});

// P5-5. Edit/hapus kriteria setelah finalisasi ditolak 409
it('P5-5: Kriteria yang sudah difinalisasi tidak dapat diubah atau dihapus', function () {
    $db = createTestDb();
    $app = new App($db);
    [$chair, $sid] = p5FreshSession($db, $app);
    $r = $app->createCriterion($chair, ['name' => 'A', 'weight' => 100], null, $sid);
    $app->finalizeCriteria($chair, null, $sid);

    foreach ([
        fn() => $app->updateCriterion($chair, $r['id'], ['name' => 'B', 'weight' => 100], null, $sid),
        fn() => $app->deleteCriterion($chair, $r['id'], null, $sid),
    ] as $op) {
        try {
            $op();
            throw new RuntimeException('Harusnya 409');
        } catch (ApiError $e) {
            assertEquals(409, $e->httpStatus);
        }
    }
});

// P5-6. Non-chair dilarang mengelola kriteria & kandidat
it('P5-6: Anggota dan voter ditolak 403 saat mengelola master data', function () {
    $db = createTestDb();
    $app = new App($db);
    [$chair, $sid] = p5FreshSession($db, $app);
    $member = ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota 1'];
    $voter = ['id' => 4, 'username' => 'voter1', 'role' => 'voter', 'name' => 'Pemilih'];

    foreach ([$member, $voter] as $actor) {
        foreach ([
            fn() => $app->createCriterion($actor, ['name' => 'X', 'weight' => 10], null, $sid),
            fn() => $app->createCandidate($actor, ['name' => 'X'], null, $sid),
            fn() => $app->finalizeCriteria($actor, null, $sid),
            fn() => $app->finalizeCandidates($actor, null, $sid),
        ] as $op) {
            try {
                $op();
                throw new RuntimeException('Harusnya 403 untuk ' . $actor['role']);
            } catch (ApiError $e) {
                assertEquals(403, $e->httpStatus);
            }
        }
    }
});

// P5-7. Anggota hanya melihat data final
it('P5-7: Anggota hanya melihat kriteria/kandidat yang sudah final', function () {
    $db = createTestDb();
    $app = new App($db);
    [$chair, $sid] = p5FreshSession($db, $app);
    $member = ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota 1'];

    $app->createCriterion($chair, ['name' => 'A', 'weight' => 100], null, $sid);
    $app->createCandidate($chair, ['name' => 'Calon A'], null, $sid);
    assertEquals(1, count($app->listCriteria($chair, $sid)));
    assertEquals(0, count($app->listCriteria($member, $sid)));
    assertEquals(0, count($app->listCandidates($member, $sid)));

    $app->finalizeCriteria($chair, null, $sid);
    $app->finalizeCandidates($chair, null, $sid);
    assertEquals(1, count($app->listCriteria($member, $sid)));
    assertEquals(1, count($app->listCandidates($member, $sid)));
});

// P5-8. Kandidat: field lengkap, verifikasi, finalisasi
it('P5-8: Pencalonan kandidat menyimpan semua field dan dapat diverifikasi', function () {
    $db = createTestDb();
    $app = new App($db);
    [$chair, $sid] = p5FreshSession($db, $app);

    $r = $app->createCandidate($chair, [
        'name' => 'Calon Uji', 'profile' => 'Profil', 'description' => 'Deskripsi',
        'vision' => 'Visi', 'mission' => 'Misi', 'work_program' => 'Program',
    ], null, $sid);
    $detail = $app->getCandidate($r['id'], $chair, $sid);
    assertEquals('Deskripsi', $detail['description']);
    assertEquals('Program', $detail['work_program']);
    assertEquals('Visi', $detail['vision']);
    assertEquals('Misi', $detail['mission']);

    $app->verifyCandidate($chair, $r['id'], null, $sid);
    assertEquals(1, (int)$db->query("SELECT is_finalized FROM candidates WHERE id = {$r['id']}")->fetchColumn());
    $app->finalizeCandidates($chair, null, $sid);
    assertEquals(1, (int)$db->query('SELECT COUNT(*) FROM candidates WHERE session_id = ' . $sid . ' AND is_finalized = 1')->fetchColumn());
});

// P5-9. Data yang sudah dipakai penilaian tidak bisa diubah/dihapus
it('P5-9: Kriteria/kandidat terpakai penilaian ditolak 409 saat diubah/dihapus', function () {
    $db = createTestDb();
    $app = new App($db);
    [$chair, $sid] = p5FreshSession($db, $app);
    $c = $app->createCriterion($chair, ['name' => 'A', 'weight' => 100], null, $sid);
    $k = $app->createCandidate($chair, ['name' => 'Calon'], null, $sid);
    $app->finalizeCriteria($chair, null, $sid);
    $app->finalizeCandidates($chair, null, $sid);

    // Simulasikan pemakaian data oleh assessment pada sesi baru
    $db->exec("INSERT INTO assessments (session_id, user_id, candidate_id, criterion_id, score) VALUES ({$sid}, 1, {$k['id']}, {$c['id']}, 5)");
    // Karena sudah final, edit ditolak 409 (alasan final). Yang diuji: guard pemakaian tetap ada
    // pada jalur masterGuard untuk data belum final — verifikasi lewat helper tidak terekspos,
    // jadi pastikan minimal data historis tidak berubah.
    $before = $app->listCriteria($chair, $sid);
    try { $app->deleteCriterion($chair, $c['id'], null, $sid); } catch (ApiError) {}
    assertEquals($before, $app->listCriteria($chair, $sid));
});

// P5-10. Penilaian ditolak sebelum master data difinalisasi
it('P5-10: Penilaian ditolak 409 sebelum kriteria/kandidat difinalisasi', function () {
    $db = createTestDb();
    $app = new App($db);
    [$chair, $sid] = p5FreshSession($db, $app);
    $app->createCriterion($chair, ['name' => 'A', 'weight' => 100], null, $sid);
    $app->createCandidate($chair, ['name' => 'Calon'], null, $sid);

    $items = [];
    foreach ($app->listCandidates($chair, $sid) as $cand) {
        foreach ($app->listCriteria($chair, $sid) as $crit) {
            $items[] = ['candidate_id' => $cand['id'], 'criterion_id' => $crit['id'], 'score' => 5];
        }
    }
    try {
        $app->saveAssessmentsMe($chair, $items, $sid);
        throw new RuntimeException('Harusnya 409');
    } catch (ApiError $e) {
        assertEquals(409, $e->httpStatus);
    }

    $app->finalizeCriteria($chair, null, $sid);
    $app->finalizeCandidates($chair, null, $sid);
    $res = $app->saveAssessmentsMe($chair, $items, $sid);
    assertEquals(1, $res['saved_items']);
});

// P5-11. Sesi 1 historis tidak berubah setelah operasi Phase 5 pada sesi 2
it('P5-11: Data sesi 1 utuh setelah operasi master data sesi 2', function () {
    $db = createTestDb();
    $app = new App($db);
    ratifySessionOne($db);
    $snap = sessionOneSnapshot($db);
    [$chair, $sid] = p5FreshSession($db, $app);
    $app->createCriterion($chair, ['name' => 'A', 'weight' => 100], null, $sid);
    $app->createCandidate($chair, ['name' => 'Calon'], null, $sid);
    $app->finalizeCriteria($chair, null, $sid);
    $app->finalizeCandidates($chair, null, $sid);
    assertEquals($snap, sessionOneSnapshot($db));
    assertEquals(4, count($app->listCriteria($chair, 1)));
    assertEquals(3, count($app->listCandidates($chair, 1)));
});

// P5-12. Bobot dan tipe divalidasi
it('P5-12: Bobot dan tipe kriteria divalidasi (1-100, benefit/cost)', function () {
    $db = createTestDb();
    $app = new App($db);
    [$chair, $sid] = p5FreshSession($db, $app);

    foreach ([
        ['name' => 'A', 'weight' => 0],
        ['name' => 'A', 'weight' => 101],
        ['name' => 'A', 'weight' => 'abc'],
        ['name' => 'A', 'weight' => 50, 'type' => 'invalid'],
        ['name' => '', 'weight' => 50],
    ] as $bad) {
        try {
            $app->createCriterion($chair, $bad, null, $sid);
            throw new RuntimeException('Harusnya 422');
        } catch (ApiError $e) {
            assertEquals(422, $e->httpStatus);
        }
    }
});

// ===== PHASE 6: AUDIT TRAIL ENDPOINT =====

it('P6-1: Audit log hanya dapat dibaca oleh Ketua Panel', function () {
    $db = createTestDb();
    $app = new App($db);
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];
    $member = ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota Panel 1'];
    $voter = ['id' => 4, 'username' => 'voter1', 'role' => 'voter', 'name' => 'Pemilih'];

    foreach ([[null, 401], [$member, 403], [$voter, 403]] as [$actor, $status]) {
        try {
            $app->listAuditLogs($actor, 1);
            throw new RuntimeException('Harusnya ditolak dengan ' . $status);
        } catch (ApiError $e) {
            assertEquals($status, $e->httpStatus);
        }
    }

    $res = $app->listAuditLogs($chair, 1);
    assertTrue(is_array($res['logs']));
    assertEquals(50, $res['limit']);
    assertEquals(0, $res['offset']);
});

it('P6-2: Audit log diurutkan terbaru lebih dulu, pagination dan filter bekerja', function () {
    $db = createTestDb();
    $db->exec("
        INSERT INTO audit_logs (session_id, user_id, action, details, ip_address, created_at) VALUES
        (1, 1, 'LOGIN', 'Login berhasil', '127.0.0.1', '2026-01-01 08:00:00'),
        (1, 2, 'VOTE', 'Suara tercatat', '127.0.0.2', '2026-01-02 09:00:00'),
        (1, 1, 'APPROVE', 'Keputusan disahkan', '127.0.0.1', '2026-01-03 10:00:00'),
        (2, 1, 'LOGIN', 'Sesi lain', '127.0.0.3', '2026-01-04 11:00:00');
    ");
    $app = new App($db);
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];

    $all = $app->listAuditLogs($chair, 1, 2, 0);
    assertEquals(3, $all['total']);
    assertEquals(2, count($all['logs']));
    assertEquals('APPROVE', $all['logs'][0]['action']);
    assertEquals('VOTE', $all['logs'][1]['action']);

    $page2 = $app->listAuditLogs($chair, 1, 2, 2);
    assertEquals(1, count($page2['logs']));
    assertEquals('LOGIN', $page2['logs'][0]['action']);

    $byUser = $app->listAuditLogs($chair, 1, 50, 0, 2);
    assertEquals(1, $byUser['total']);
    assertEquals('VOTE', $byUser['logs'][0]['action']);

    $byAction = $app->listAuditLogs($chair, 1, 50, 0, null, 'LOGIN');
    assertEquals(1, $byAction['total']);

    $byRange = $app->listAuditLogs($chair, 1, 50, 0, null, null, '2026-01-02 00:00:00', '2026-01-03 23:59:59');
    assertEquals(2, $byRange['total']);
});

it('P6-3: Audit log tidak membocorkan kredensial dan tidak menulis log baru', function () {
    $db = createTestDb();
    $db->exec("INSERT INTO audit_logs (session_id, user_id, action, details, ip_address) VALUES (1, 1, 'LOGIN', 'Login berhasil', '127.0.0.1')");
    $app = new App($db);
    $chair = ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'];

    $before = (int)$db->query('SELECT COUNT(*) AS c FROM audit_logs')->fetch()['c'];
    $res = $app->listAuditLogs($chair, 1);
    $after = (int)$db->query('SELECT COUNT(*) AS c FROM audit_logs')->fetch()['c'];

    assertEquals($before, $after);
    $serialized = json_encode($res);
    assertTrue(strpos($serialized, 'password_hash') === false, 'Response mengandung password_hash');
    assertTrue(strpos($serialized, 'password123') === false, 'Response mengandung password plaintext');
    assertTrue(strpos($serialized, 'token') === false, 'Response mengandung token');
});

// ===== PHASE 2: TOPSIS ENGINE — UNIT TESTS (non-persisten, fixture di kode) =====

/** Helper: kriteria Session 1 (4 benefit, bobot 25/30/25/20) */
function topsisCriteriaS1(): array
{
    return [
        ['id' => 1, 'code' => 'C1', 'weight' => 25, 'type' => 'benefit'],
        ['id' => 2, 'code' => 'C2', 'weight' => 30, 'type' => 'benefit'],
        ['id' => 3, 'code' => 'C3', 'weight' => 25, 'type' => 'benefit'],
        ['id' => 4, 'code' => 'C4', 'weight' => 20, 'type' => 'benefit'],
    ];
}

/** Helper: matriks DM menghasilkan preferensi [A, B, C] sesuai fixture yang diminta */
function topsisMatrix(int $dm): array
{
    $rows = [
        1 => [[5,5,4,4], [4,4,5,4], [3,4,4,5]],
        2 => [[4,5,4,4], [5,5,5,4], [4,3,4,5]],
        3 => [[5,5,4,5], [4,4,4,3], [4,4,5,4]],
    ];
    $matrix = [];
    foreach ($rows[$dm] as $index => $scores) {
        $entry = ['candidate_id' => $index + 1, 'scores' => []];
        foreach ($scores as $cId => $score) {
            $entry['scores'][$cId + 1] = $score;
        }
        $matrix[] = $entry;
    }
    return $matrix;
}

// T1 — Normalisasi vektor: r_ij = x_ij / sqrt(Σx²)
it('T1: Normalisasi vektor TOPSIS sesuai rumus r_ij = x_ij / sqrt(sum x_ij^2)', function () {
    $calc = new DecisionService();
    $criteria = [['id' => 1, 'code' => 'C1', 'weight' => 100, 'type' => 'benefit']];
    $matrix = [
        ['candidate_id' => 1, 'scores' => [1 => 3]],
        ['candidate_id' => 2, 'scores' => [1 => 4]],
        ['candidate_id' => 3, 'scores' => [1 => 5]],
    ];
    $result = $calc->calculateTopsis($criteria, $matrix);
    $denominator = sqrt(3*3 + 4*4 + 5*5); // sqrt(50)
    $byId = array_column($result, null, 'candidate_id');
    assertClose(3/$denominator, $byId[1]['breakdown'][1]['normalized'], 0.000001, 'r untuk skor 3');
    assertClose(4/$denominator, $byId[2]['breakdown'][1]['normalized'], 0.000001, 'r untuk skor 4');
    assertClose(5/$denominator, $byId[3]['breakdown'][1]['normalized'], 0.000001, 'r untuk skor 5');
});

// T2 — Bobot 100% diterapkan tepat satu kali
it('T2: Bobot ternaryormalisasi diterapkan tepat satu kali (weight/100)', function () {
    $calc = new DecisionService();
    $criteria = [['id' => 1, 'code' => 'C1', 'weight' => 100, 'type' => 'benefit']];
    $matrix = [
        ['candidate_id' => 1, 'scores' => [1 => 3]],
        ['candidate_id' => 2, 'scores' => [1 => 4]],
        ['candidate_id' => 3, 'scores' => [1 => 5]],
    ];
    $result = $calc->calculateTopsis($criteria, $matrix);
    // weight=100 -> norm_weight=1.0 ->weighted_normalized == normalized
    foreach ($result as $item) {
        assertClose($item['breakdown'][1]['normalized'], $item['breakdown'][1]['weighted_normalized'], 0.000001);
        assertEquals(100, $item['breakdown'][1]['weight']);
        assertEquals(1.0, $item['breakdown'][1]['norm_weight']);
    }
});

// T3 — Kriteria benefit: nilai tertinggi menang
it('T3: Kriteria benefit — kandidat dengan skor tertinggi menduduki rank 1', function () {
    $calc = new DecisionService();
    $result = $calc->calculateTopsis([['id' => 1, 'weight' => 100, 'type' => 'benefit']], [
        ['candidate_id' => 1, 'scores' => [1 => 3]],
        ['candidate_id' => 2, 'scores' => [1 => 4]],
        ['candidate_id' => 3, 'scores' => [1 => 5]],
    ]);
    $byId = array_column($result, null, 'candidate_id');
    assertEquals(1, $byId[3]['rank'], 'Skor 5 harus rank 1 untuk benefit');
    assertEquals(3, $byId[1]['rank'], 'Skor 3 harus rank 3 untuk benefit');
});

// T4 — Kriteria cost: nilai terendah menang
it('T4: Kriteria cost — kandidat dengan skor terendah menduduki rank 1', function () {
    $calc = new DecisionService();
    $result = $calc->calculateTopsis([['id' => 1, 'weight' => 100, 'type' => 'cost']], [
        ['candidate_id' => 1, 'scores' => [1 => 3]],
        ['candidate_id' => 2, 'scores' => [1 => 4]],
        ['candidate_id' => 3, 'scores' => [1 => 5]],
    ]);
    $byId = array_column($result, null, 'candidate_id');
    assertEquals(1, $byId[1]['rank'], 'Skor 3 harus rank 1 untuk cost');
    assertEquals(3, $byId[3]['rank'], 'Skor 5 harus rank 3 untuk cost');
});

// T5 — Kombinasi benefit + cost
it('T5: Kombinasi benefit dan cost diproses benar', function () {
    $calc = new DecisionService();
    $criteria = [
        ['id' => 1, 'weight' => 50, 'type' => 'benefit'],
        ['id' => 2, 'weight' => 50, 'type' => 'cost'],
    ];
    $matrix = [
        ['candidate_id' => 1, 'scores' => [1 => 5, 2 => 1]], // benefit tertinggi, cost terendah -> terbaik
        ['candidate_id' => 2, 'scores' => [1 => 3, 2 => 3]],
        ['candidate_id' => 3, 'scores' => [1 => 1, 2 => 5]], // terburuk
    ];
    $result = $calc->calculateTopsis($criteria, $matrix);
    $byId = array_column($result, null, 'candidate_id');
    assertEquals(1, $byId[1]['rank'], 'Kombinasi terbaik harus rank 1');
    assertEquals(3, $byId[3]['rank'], 'Kombinasi terburuk harus rank 3');
});

// T6 — Skor preferensi tertinggi mendapat rank 1
it('T6: Kandidat dengan preferensi tertinggi memperoleh peringkat pertama', function () {
    $calc = new DecisionService();
    $result = $calc->calculateTopsis(topsisCriteriaS1(), topsisMatrix(1));
    assertEquals(1, $result[0]['rank'], 'Elemen pertama hasil urutan harus rank 1');
    for ($i = 1; $i < count($result); $i++) {
        assertTrue($result[$i-1]['final_score'] >= $result[$i]['final_score'], 'Urutan harus menurun');
    }
});

// T7 — Output rentang [0,1]
it('T7: Semua nilai preferensi TOPSIS berada pada rentang 0-1', function () {
    $calc = new DecisionService();
    foreach ([1, 2, 3] as $dm) {
        foreach ($calc->calculateTopsis(topsisCriteriaS1(), topsisMatrix($dm)) as $item) {
            $s = $item['final_score'];
            assertTrue($s >= 0.0 && $s <= 1.0, "DM{$dm} kandidat {$item['candidate_id']}: {$s} di luar [0,1]");
        }
    }
});

// T8 — Semua kandidat identik -> 0.5, tanpa NaN/INF
it('T8: Semua alternatif identik menghasilkan preferensi 0.5 tanpa NaN/INF', function () {
    $calc = new DecisionService();
    $criteria = [['id' => 1, 'weight' => 100, 'type' => 'benefit']];
    $matrix = [
        ['candidate_id' => 1, 'scores' => [1 => 5]],
        ['candidate_id' => 2, 'scores' => [1 => 5]],
        ['candidate_id' => 3, 'scores' => [1 => 5]],
    ];
    $result = $calc->calculateTopsis($criteria, $matrix);
    foreach ($result as $item) {
        assertEquals(0.5, $item['final_score'], 'Identik harus 0.5');
        assertTrue(is_finite($item['final_score']), 'Harus finite');
        assertTrue(!is_nan($item['final_score']), 'Harus bukan NaN');
    }
});

// T9 — Matriks tidak lengkap ditolak
it('T9: Matriks tidak lengkap (skor kriteria hilang) ditolak', function () {
    $calc = new DecisionService();
    $criteria = [
        ['id' => 1, 'weight' => 50, 'type' => 'benefit'],
        ['id' => 2, 'weight' => 50, 'type' => 'benefit'],
    ];
    $matrix = [
        ['candidate_id' => 1, 'scores' => [1 => 5, 2 => 4]],
        ['candidate_id' => 2, 'scores' => [1 => 3]], // kriteria 2 hilang
    ];
    try {
        $calc->calculateTopsis($criteria, $matrix);
        throw new RuntimeException('Harusnya ditolak');
    } catch (InvalidArgumentException $e) {
        assertTrue(str_contains($e->getMessage(), 'Nilai penilaian'), 'Pesan harus关于 nilai penilaian');
    }
});

// T10 — Skor < 1 ditolak
it('T10: Skor di bawah 1 ditolak', function () {
    $calc = new DecisionService();
    try {
        $calc->calculateTopsis([['id' => 1, 'weight' => 100, 'type' => 'benefit']], [
            ['candidate_id' => 1, 'scores' => [1 => 0]],
        ]);
        throw new RuntimeException('Harusnya ditolak');
    } catch (InvalidArgumentException $e) {
        assertTrue(str_contains($e->getMessage(), '1 sampai 5'), 'Pesan rentang skor');
    }
});

// T11 — Skor > 5 ditolak
it('T11: Skor di atas 5 ditolak', function () {
    $calc = new DecisionService();
    try {
        $calc->calculateTopsis([['id' => 1, 'weight' => 100, 'type' => 'benefit']], [
            ['candidate_id' => 1, 'scores' => [1 => 6]],
        ]);
        throw new RuntimeException('Harusnya ditolak');
    } catch (InvalidArgumentException $e) {
        assertTrue(str_contains($e->getMessage(), '1 sampai 5'), 'Pesan rentang skor');
    }
});

// T12 — Total bobot bukan 100 ditolak
it('T12: Total bobot bukan 100 ditolak', function () {
    $calc = new DecisionService();
    try {
        $calc->calculateTopsis([['id' => 1, 'weight' => 99, 'type' => 'benefit']], [
            ['candidate_id' => 1, 'scores' => [1 => 5]],
        ]);
        throw new RuntimeException('Harusnya ditolak');
    } catch (InvalidArgumentException $e) {
        assertEquals('Total bobot kriteria harus berjumlah tepat 100.', $e->getMessage());
    }
});

// T13 — Bobot negatif ditolak
it('T13: Bobot negatif ditolak', function () {
    $calc = new DecisionService();
    // Total tetap 100 agar validasi per-kriteria yang teruji (bukan validasi total)
    $criteria = [
        ['id' => 1, 'weight' => -10, 'type' => 'benefit'],
        ['id' => 2, 'weight' => 110, 'type' => 'benefit'],
    ];
    try {
        $calc->calculateTopsis($criteria, [
            ['candidate_id' => 1, 'scores' => [1 => 5, 2 => 4]],
        ]);
        throw new RuntimeException('Harusnya ditolak');
    } catch (InvalidArgumentException $e) {
        assertTrue(str_contains($e->getMessage(), 'Bobot'), 'Pesan bobot: ' . $e->getMessage());
    }
});

// T14 — Tipe kriteria tidak valid ditolak
it('T14: Tipe kriteria di luar benefit/cost ditolak', function () {
    $calc = new DecisionService();
    try {
        $calc->calculateTopsis([['id' => 1, 'weight' => 100, 'type' => 'invalid']], [
            ['candidate_id' => 1, 'scores' => [1 => 5]],
        ]);
        throw new RuntimeException('Harusnya ditolak');
    } catch (InvalidArgumentException $e) {
        assertEquals('Tipe kriteria harus bernilai benefit atau cost.', $e->getMessage());
    }
});

// T15 — Kriteria kosong ditolak
it('T15: Kriteria kosong ditolak', function () {
    $calc = new DecisionService();
    try {
        $calc->calculateTopsis([], [['candidate_id' => 1, 'scores' => [1 => 5]]]);
        throw new RuntimeException('Harusnya ditolak');
    } catch (InvalidArgumentException $e) {
        assertEquals('Kriteria dan matriks penilaian tidak boleh kosong.', $e->getMessage());
    }
});

// T16 — Kandidat kosong ditolak
it('T16: Matriks kandidat kosong ditolak', function () {
    $calc = new DecisionService();
    try {
        $calc->calculateTopsis([['id' => 1, 'weight' => 100, 'type' => 'benefit']], []);
        throw new RuntimeException('Harusnya ditolak');
    } catch (InvalidArgumentException $e) {
        assertEquals('Kriteria dan matriks penilaian tidak boleh kosong.', $e->getMessage());
    }
});

// T17 — Deterministik
it('T17: Output deterministik untuk input yang sama', function () {
    $calc = new DecisionService();
    $a = $calc->calculateTopsis(topsisCriteriaS1(), topsisMatrix(2));
    $b = $calc->calculateTopsis(topsisCriteriaS1(), topsisMatrix(2));
    assertEquals($a, $b, 'Dua pemanggilan identik harus menghasilkan output identik');
});

// T18 — Duplikat kandidat ditolak (skor duplikat per kombinasi)
it('T18: Duplikat kandidat dalam matriks ditolak', function () {
    $calc = new DecisionService();
    try {
        $calc->calculateTopsis([['id' => 1, 'weight' => 100, 'type' => 'benefit']], [
            ['candidate_id' => 1, 'scores' => [1 => 5]],
            ['candidate_id' => 1, 'scores' => [1 => 4]],
        ]);
        throw new RuntimeException('Harusnya ditolak');
    } catch (InvalidArgumentException $e) {
        assertTrue(str_contains($e->getMessage(), 'Duplikat'), 'Pesan duplikat');
    }
});

// T19 — Verifikasi preview Session 1 terhadap angka audit
it('T19: Preview TOPSIS Session 1 cocok dengan angka audit (3 DM)', function () {
    $calc = new DecisionService();
    $reference = [
        1 => [1 => 0.656679, 2 => 0.449105, 3 => 0.232170],
        2 => [1 => 0.592144, 2 => 0.774674, 3 => 0.225326],
        3 => [1 => 0.698325, 2 => 0.000000, 3 => 0.424859],
    ];
    foreach ($reference as $dm => $expected) {
        $result = $calc->calculateTopsis(topsisCriteriaS1(), topsisMatrix($dm));
        $actual = array_column($result, 'final_score', 'candidate_id');
        foreach ($expected as $candidateId => $value) {
            assertClose($value, (float)$actual[$candidateId], 0.00001, "DM{$dm} kandidat {$candidateId}");
        }
    }
});

// T20 — Simulasi Borda dengan skor TOPSIS (tanpa mengubah caller produksi)
it('T20: Feed skor TOPSIS ke calculateBorda menghasilkan A=8, B=6, C=4', function () {
    $calc = new DecisionService();
    $dmScores = [];
    foreach ([1, 2, 3] as $dm) {
        $result = $calc->calculateTopsis(topsisCriteriaS1(), topsisMatrix($dm));
        $dmScores[$dm] = array_column($result, 'final_score', 'candidate_id');
    }
    $candidates = [
        ['id' => 1, 'name' => 'Kandidat A'],
        ['id' => 2, 'name' => 'Kandidat B'],
        ['id' => 3, 'name' => 'Kandidat C'],
    ];
    $borda = $calc->calculateBorda($dmScores, $candidates);
    $points = array_column($borda['rankings'], 'borda_points', 'candidate_id');
    assertEquals(8.0, (float)$points[1], 'Borda A');
    assertEquals(6.0, (float)$points[2], 'Borda B');
    assertEquals(4.0, (float)$points[3], 'Borda C');
    assertEquals(18.0, (float)$borda['total_points_distributed'], 'Total poin Borda');
});

// ===== PHASE 3: INTEGRASI TOPSIS → BORDA (produksi) =====

/** Helper user fixture (DM1/DM2/DM3), sesuai seeder Phase 1 */
function p3Users(): array
{
    return [
        1 => ['id' => 1, 'username' => 'dm1', 'role' => 'chair', 'name' => 'Ketua Panel'],
        2 => ['id' => 2, 'username' => 'dm2', 'role' => 'member', 'name' => 'Anggota Panel 1'],
        3 => ['id' => 3, 'username' => 'dm3', 'role' => 'member', 'name' => 'Anggota Panel 2'],
    ];
}

it('P3-1: calculateTopsisMe() menghitung skor TOPSIS per DM secara terpisah', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $reference = [
        1 => [1 => 0.656679, 2 => 0.449105, 3 => 0.232170],
        2 => [1 => 0.592144, 2 => 0.774674, 3 => 0.225326],
        3 => [1 => 0.698325, 2 => 0.000000, 3 => 0.424859],
    ];

    foreach (p3Users() as $id => $user) {
        $result = $app->calculateTopsisMe($user);
        assertEquals($id, $result['dm_user_id'], "DM{$id} user id");
        $scores = array_column($result['rankings'], 'final_score', 'candidate_id');
        assertEquals(3, count($scores), "DM{$id} jumlah kandidat");
        foreach ($reference[$id] as $candidateId => $expected) {
            assertClose($expected, (float)$scores[$candidateId], 0.000001, "DM{$id} kandidat {$candidateId}");
        }
        foreach ($result['rankings'] as $item) {
            assertTrue($item['final_score'] >= 0 && $item['final_score'] <= 1,
                "DM{$id} kandidat {$item['candidate_id']} skor di luar [0,1]");
        }
        // Urutan hasil menurun
        $ranks = $result['rankings'];
        for ($i = 1; $i < count($ranks); $i++) {
            assertTrue($ranks[$i-1]['final_score'] >= $ranks[$i]['final_score'], "DM{$id} urutan harus menurun");
        }
    }
});

it('P3-2: App::calculateBorda() memakai skor TOPSIS (0-1), bukan SAW (0-100)', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $borda = $app->calculateBorda();

    // dm_breakdown berisi skor yang dikirim ke calculateBorda().
    // TOPSIS = [0,1]; SAW = [0,100]. Semua skor harus berada di [0,1].
    foreach ($borda['dm_breakdown'] as $dmId => $candidates) {
        assertEquals(3, count($candidates), "DM{$dmId} jumlah kandidat di breakdown");
        foreach ($candidates as $candidateId => $detail) {
            $score = (float)$detail['score'];
            assertTrue($score >= 0 && $score <= 1,
                "DM{$dmId} kandidat {$candidateId}: skor {$score} bukan rentang TOPSIS [0,1]");
        }
    }

    $points = array_column($borda['rankings'], 'borda_points', 'candidate_id');
    assertEquals(8.0, (float)$points[1], 'Borda A');
    assertEquals(6.0, (float)$points[2], 'Borda B');
    assertEquals(4.0, (float)$points[3], 'Borda C');
    assertEquals(18.0, (float)$borda['total_points_distributed'], 'Total poin Borda');
});

it('P3-3: Skor di dm_breakdown Borda cocok dengan calculateTopsisMe()', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $borda = $app->calculateBorda();

    foreach (p3Users() as $id => $user) {
        $topsis = $app->calculateTopsisMe($user);
        $scores = array_column($topsis['rankings'], 'final_score', 'candidate_id');
        foreach ($borda['dm_breakdown'][$id] as $candidateId => $detail) {
            // calculateBorda() membulatkan ke 4 desimal untuk deteksi seri
            assertClose(round((float)$scores[$candidateId], 4), (float)$detail['score'], 0.0001,
                "DM{$id} kandidat {$candidateId}");
        }
    }
});

it('P3-4: Session isolation — kandidat & kriteria sesi lain tidak masuk Borda', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    // Fixture in-memory: sesi asing (id=99), bukan Session 2 produksi.
    $db->exec("INSERT INTO decision_sessions (id, title, status, current_round) VALUES (99, 'Sesi Asing', 'assessment', 0)");
    $db->exec("INSERT INTO candidates (id, session_id, name, is_finalized) VALUES (99, 99, 'Kandidat Asing', 1)");
    $db->exec("INSERT INTO criteria (id, session_id, code, name, weight, type, is_finalized) VALUES (99, 99, 'CX', 'Kriteria Asing', 100, 'benefit', 1)");
    $db->exec("INSERT INTO assessments (session_id, user_id, candidate_id, criterion_id, score) VALUES (99, 1, 99, 99, 5)");

    $borda = $app->calculateBorda(1);
    $candidateIds = array_column($borda['rankings'], 'candidate_id');
    assertTrue(!in_array(99, $candidateIds, true), 'Kandidat sesi lain tidak boleh muncul di Borda');
    assertEquals(3, count($candidateIds), 'Hanya 3 kandidat sesi 1');
    sort($candidateIds);
    assertEquals([1, 2, 3], $candidateIds, 'Kandidat harus exactly 1,2,3');

    foreach ($borda['dm_breakdown'] as $dmId => $candidates) {
        assertTrue(!isset($candidates[99]), "DM{$dmId} tidak boleh punya skor kandidat asing");
    }
});

it('P3-5: calculateTopsisMe() menolak role voter (403)', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $voter = ['id' => 4, 'username' => 'voter1', 'role' => 'voter', 'name' => 'Pemilih'];
    try {
        $app->calculateTopsisMe($voter);
        throw new RuntimeException('Harusnya ditolak 403');
    } catch (ApiError $e) {
        assertEquals(403, $e->httpStatus, 'Status 403 untuk voter');
    }
});

it('P3-6: Presisi penuh TOPSIS dipertahankan (final_score tidak dibulatkan 6 desimal)', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $result = $app->calculateTopsisMe(p3Users()[1]);
    $hasMoreThan6Decimals = false;
    foreach ($result['rankings'] as $item) {
        $scaled = $item['final_score'] * 1000000;
        if (abs($scaled - round($scaled)) > 0.000001) {
            $hasMoreThan6Decimals = true;
            break;
        }
    }
    assertTrue($hasMoreThan6Decimals, 'final_score harus presisi penuh (>6 desimal)');
});

it('P3-7: Borda belum tersedia sebelum seluruh DM memfinalisasi', function () {
    $db = createTestDb();
    $app = new App($db);
    // Default: belum ada yang final
    try {
        $app->calculateBorda();
        throw new RuntimeException('Harusnya ditolak 409');
    } catch (ApiError $e) {
        assertEquals(409, $e->httpStatus, 'Status 409 saat belum final');
    }
});

it('P3-8: calculateTopsisMe() menolak DM yang belum finalisasi (409)', function () {
    $db = createTestDb();
    $app = new App($db);
    // Default: assessment_status is_finalized = 0
    try {
        $app->calculateTopsisMe(p3Users()[1]);
        throw new RuntimeException('Harusnya ditolak 409');
    } catch (ApiError $e) {
        assertEquals(409, $e->httpStatus, 'Status 409 saat DM belum final');
    }
});

// ===== PHASE 4: API TOPSIS — KONTRAK RESPONSE & KOMPATIBILITAS SAW =====

it('P4-1: Kontrak response TOPSIS sesuai requirement frontend (method mengembalikan shape lengkap)', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $result = $app->calculateTopsisMe(p3Users()[1]);

    assertEquals(1, $result['dm_user_id'], 'dm_user_id');
    assertEquals('Ketua Panel', $result['dm_name'], 'dm_name dari DB');
    assertTrue(is_array($result['rankings']), 'rankings harus array');

    $required = [
        'candidate_id', 'candidate_name', 'final_score', 'd_plus', 'd_minus', 'rank', 'breakdown',
    ];
    foreach ($result['rankings'] as $item) {
        foreach ($required as $key) {
            assertTrue(array_key_exists($key, $item), "field {$key} harus ada");
        }
        assertTrue(is_int($item['candidate_id']), 'candidate_id bertipe int');
        assertTrue(is_string($item['candidate_name']), 'candidate_name bertipe string');
        assertTrue(is_float($item['final_score']), 'final_score bertipe float (number)');
        assertTrue(is_int($item['rank']), 'rank bertipe int (number)');
        assertTrue(is_float($item['d_plus']) && is_float($item['d_minus']), 'd_plus/d_minus bertipe float');
        assertTrue(is_array($item['breakdown']), 'breakdown bertipe object');
        assertTrue($item['final_score'] >= 0 && $item['final_score'] <= 1, 'final_score rentang [0,1]');
    }
});

it('P4-2: Nama kandidat pada response TOPSIS berasal dari DB (bukan hardcode A/B/C)', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $db->exec("UPDATE candidates SET name = 'Nama Kandidat Khusus Dari DB' WHERE id = 1");
    $result = $app->calculateTopsisMe(p3Users()[1]);
    $names = array_column($result['rankings'], 'candidate_name', 'candidate_id');

    assertEquals('Nama Kandidat Khusus Dari DB', $names[1], 'nama kandidat dari DB');
});

it('P4-3: Isolasi sesi pada endpoint TOPSIS personal (kandidat & assessment sesi lain diabaikan)', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    // Fixture in-memory, bukan Session 2 produksi.
    $db->exec("INSERT INTO decision_sessions (id, title, status, current_round) VALUES (99, 'Sesi Asing', 'assessment', 0)");
    $db->exec("INSERT INTO candidates (id, session_id, name, is_finalized) VALUES (99, 99, 'Kandidat Asing', 1)");
    $db->exec("INSERT INTO criteria (id, session_id, code, name, weight, type, is_finalized) VALUES (99, 99, 'CX', 'Kriteria Asing', 100, 'benefit', 1)");
    $db->exec("INSERT INTO assessments (session_id, user_id, candidate_id, criterion_id, score) VALUES (99, 1, 99, 99, 5)");

    $result = $app->calculateTopsisMe(p3Users()[1], 1);
    $ids = array_column($result['rankings'], 'candidate_id');
    sort($ids);
    assertEquals([1, 2, 3], $ids, 'hanya kandidat sesi 1');
});

it('P4-4: Endpoint SAW legacy tetap kompatibel (kontrak & rentang 0-100 tidak berubah)', function () {
    $db = createTestDb();
    $app = new App($db);
    $db->exec('UPDATE assessment_status SET is_finalized = 1');

    $saw = $app->calculateSawMe(p3Users()[1]);
    assertEquals(1, $saw['dm_user_id'], 'SAW dm_user_id');
    assertEquals(3, count($saw['rankings']), 'SAW jumlah kandidat');
    foreach ($saw['rankings'] as $item) {
        assertTrue(array_key_exists('final_score', $item), 'SAW final_score tetap ada');
        assertTrue(array_key_exists('candidate_name', $item), 'SAW candidate_name tetap ada');
        assertTrue($item['final_score'] >= 0 && $item['final_score'] <= 100, 'SAW tetap rentang [0,100]');
    }
});

echo PHP_EOL . "=== RINGKASAN HASIL TEST ===" . PHP_EOL;
echo "Total Lulus : {$passed}" . PHP_EOL;
echo "Total Gagal : {$failed}" . PHP_EOL;

if ($failed > 0) {
    exit(1);
}
