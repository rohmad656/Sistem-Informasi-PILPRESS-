<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

use Gdss\App;
use Gdss\ApiError;

// 1. Header Keamanan Standar
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

// 2. Penanganan CORS (Cross-Origin Resource Sharing)
(function () {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowedConfig = getenv('CORS_ALLOWED_ORIGINS') ?: '';
    $allowedOrigins = array_filter(array_map('trim', explode(',', $allowedConfig)));
    $defaults = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001', 'http://127.0.0.1:3002', 'http://[::1]:3000', 'http://[::1]:3001', 'http://[::1]:3002', 'http://127.0.0.1:5500', 'http://localhost:5500', 'http://127.0.0.1:8000', 'http://localhost:8080'];
    $allowedOrigins = array_unique(array_merge($allowedOrigins, $defaults));

    if ($origin !== '' && in_array($origin, $allowedOrigins, true)) {
        header("Access-Control-Allow-Origin: {$origin}");
        header('Access-Control-Allow-Credentials: true');
    } elseif ($origin !== '' && in_array('*', $allowedOrigins, true)) {
        header('Access-Control-Allow-Origin: *');
    }

    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
    header('Access-Control-Max-Age: 86400');

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
})();

// 3. Response JSON Helper Konsisten
function respond(int $statusCode, bool $success, string $message, mixed $data = null): never
{
    http_response_code($statusCode);
    echo json_encode([
        'success' => $success,
        'message' => $message,
        'data' => $data,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// 4. Token Helper (HMAC-SHA256 Stateless Bearer Token)
function appKey(): string
{
    $key = getenv('APP_KEY') ?: '';
    if (strlen($key) < 32) {
        throw new RuntimeException('APP_KEY belum dikonfigurasi atau kurang dari 32 karakter.');
    }
    return $key;
}

function base64UrlEncode(string $data): string
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function base64UrlDecode(string $data): string
{
    return base64_decode(strtr($data, '-_', '+/') . str_repeat('=', (4 - strlen($data) % 4) % 4), true) ?: '';
}

function createToken(array $user): string
{
    $payload = [
        'sub' => (int)$user['id'],
        'username' => $user['username'],
        'role' => $user['role'],
        'iat' => time(),
        'exp' => time() + 3600, // Berlaku 1 jam
    ];
    $encodedPayload = base64UrlEncode(json_encode($payload));
    $signature = base64UrlEncode(hash_hmac('sha256', $encodedPayload, appKey(), true));
    return $encodedPayload . '.' . $signature;
}

function authenticateToken(PDO $db): ?array
{
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/', $authHeader, $matches)) {
        return null;
    }

    [$encodedPayload, $signature] = explode('.', $matches[1], 2);
    $expectedSignature = base64UrlEncode(hash_hmac('sha256', $encodedPayload, appKey(), true));
    if (!hash_equals($expectedSignature, $signature)) {
        throw new ApiError(401, 'Token autentikasi tidak valid atau telah dimodifikasi.');
    }

    $payload = json_decode(base64UrlDecode($encodedPayload), true);
    if (!is_array($payload) || ($payload['exp'] ?? 0) < time()) {
        throw new ApiError(401, 'Sesi token telah kedaluwarsa. Silakan login kembali.');
    }

    $stmt = $db->prepare('SELECT id, username, name, role FROM users WHERE id = ?');
    $stmt->execute([(int)$payload['sub']]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        throw new ApiError(401, 'Pengguna pemilik token tidak ditemukan.');
    }

    return [
        'id' => (int)$user['id'],
        'username' => $user['username'],
        'name' => $user['name'],
        'role' => $user['role'],
    ];
}

function parseJsonBody(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) {
        return [];
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        throw new ApiError(400, 'Payload harus berupa JSON object yang valid.');
    }
    return $decoded;
}

/**
 * session_id opsional untuk endpoint READ (histori Phase 4).
 * Null = pakai sesi aktif. Nilai invalid ditolak 422.
 */
function querySessionId(): ?int
{
    if (!isset($_GET['session_id']) || $_GET['session_id'] === '') {
        return null;
    }
    $raw = $_GET['session_id'];
    if (!is_string($raw) || !ctype_digit($raw) || (int)$raw < 1) {
        throw new ApiError(422, 'session_id harus berupa bilangan bulat positif.');
    }
    return (int)$raw;
}

// 5. Router Eksekusi Utama
try {
    $db = database();
    $app = new App($db);

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $rawPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $path = '/' . trim($rawPath, '/');

    // Normalisasi prefix /api
    $apiPrefix = '/api';
    if (!str_starts_with($path, $apiPrefix)) {
        throw new ApiError(404, 'Endpoint tidak ditemukan. Seluruh API menggunakan prefix /api.');
    }

    $route = substr($path, strlen($apiPrefix)) ?: '/';
    $body = parseJsonBody();
    $currentUser = authenticateToken($db);
    $clientIp = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';

    // Route: Autentikasi
    if ($method === 'POST' && ($route === '/auth/login' || $route === '/login')) {
        $user = $app->login(
            (string)($body['username'] ?? ''),
            (string)($body['password'] ?? ''),
            $clientIp
        );
        $token = createToken($user);
        respond(200, true, 'Login berhasil.', [
            'token' => $token,
            'token_type' => 'Bearer',
            'expires_in' => 3600,
            'user' => $user,
        ]);
    }

    if ($method === 'POST' && ($route === '/auth/register' || $route === '/register')) {
        $result = $app->register(
            (string)($body['name'] ?? ''),
            (string)($body['username'] ?? ''),
            (string)($body['password'] ?? ''),
            $clientIp
        );
        respond(201, true, $result['message'], $result);
    }

    if ($method === 'GET' && ($route === '/auth/me' || $route === '/me')) {
        $user = $app->actor($currentUser);
        respond(200, true, 'Profil pengguna berhasil diambil.', $user);
    }

    if ($method === 'POST' && ($route === '/auth/logout' || $route === '/logout')) {
        $app->actor($currentUser);
        respond(200, true, 'Logout berhasil. Sesi token di sisi klien silakan dihapus.', null);
    }

    // Route: Master Data (wajib autentikasi; voter boleh melihat kandidat & kriteria final)
    if ($method === 'GET' && $route === '/candidates') {
        $app->actor($currentUser);
        respond(200, true, 'Daftar kandidat berhasil diambil.', $app->listCandidates($currentUser, querySessionId()));
    }

    if ($method === 'GET' && preg_match('#^/candidates/(\d+)$#', $route, $m)) {
        $app->actor($currentUser);
        respond(200, true, 'Detail kandidat berhasil diambil.', $app->getCandidate((int)$m[1], $currentUser, querySessionId()));
    }

    if ($method === 'GET' && $route === '/criteria') {
        $app->actor($currentUser);
        respond(200, true, 'Daftar kriteria berhasil diambil.', $app->listCriteria($currentUser, querySessionId()));
    }

    if ($method === 'GET' && $route === '/criteria/summary') {
        respond(200, true, 'Ringkasan kriteria berhasil diambil.', $app->getCriteriaSummary($currentUser, querySessionId()));
    }

    // Route: Phase 5 — kelola kriteria (chair only)
    if ($method === 'POST' && $route === '/criteria') {
        $res = $app->createCriterion($currentUser, $body, $clientIp, querySessionId());
        respond(201, true, $res['message'], $res);
    }

    if ($method === 'POST' && $route === '/criteria/finalize') {
        $res = $app->finalizeCriteria($currentUser, $clientIp, querySessionId());
        respond(200, true, $res['message'], $res);
    }

    if ($method === 'PUT' && preg_match('#^/criteria/(\d+)$#', $route, $m)) {
        $res = $app->updateCriterion($currentUser, (int)$m[1], $body, $clientIp, querySessionId());
        respond(200, true, $res['message'], $res);
    }

    if ($method === 'DELETE' && preg_match('#^/criteria/(\d+)$#', $route, $m)) {
        $res = $app->deleteCriterion($currentUser, (int)$m[1], $clientIp, querySessionId());
        respond(200, true, $res['message'], $res);
    }

    // Route: Phase 5 — pencalonan kandidat (chair only)
    if ($method === 'POST' && $route === '/candidates') {
        $res = $app->createCandidate($currentUser, $body, $clientIp, querySessionId());
        respond(201, true, $res['message'], $res);
    }

    if ($method === 'POST' && $route === '/candidates/finalize') {
        $res = $app->finalizeCandidates($currentUser, $clientIp, querySessionId());
        respond(200, true, $res['message'], $res);
    }

    if ($method === 'POST' && preg_match('#^/candidates/(\d+)/verify$#', $route, $m)) {
        $res = $app->verifyCandidate($currentUser, (int)$m[1], $clientIp, querySessionId());
        respond(200, true, $res['message'], $res);
    }

    if ($method === 'PUT' && preg_match('#^/candidates/(\d+)$#', $route, $m)) {
        $res = $app->updateCandidate($currentUser, (int)$m[1], $body, $clientIp, querySessionId());
        respond(200, true, $res['message'], $res);
    }

    if ($method === 'DELETE' && preg_match('#^/candidates/(\d+)$#', $route, $m)) {
        $res = $app->deleteCandidate($currentUser, (int)$m[1], $clientIp, querySessionId());
        respond(200, true, $res['message'], $res);
    }

    // Route: Penilaian (Assessments)
    if ($method === 'GET' && ($route === '/assessments/me' || $route === '/assessments')) {
        respond(200, true, 'Penilaian pribadi berhasil diambil.', $app->getAssessmentsMe($currentUser, querySessionId()));
    }

    if ($method === 'PUT' && ($route === '/assessments/me' || $route === '/assessments')) {
        $result = $app->saveAssessmentsMe($currentUser, $body['items'] ?? [], querySessionId());
        respond(200, true, 'Matriks penilaian berhasil disimpan.', $result);
    }

    if ($method === 'POST' && ($route === '/assessments/me/finalize' || $route === '/assessments/submit')) {
        $result = $app->finalizeAssessmentsMe($currentUser);
        respond(200, true, 'Penilaian berhasil difinalisasi dan dikunci.', $result);
    }

    if ($method === 'GET' && ($route === '/assessments/status' || $route === '/status')) {
        $u = $app->actor($currentUser);
        if (!in_array($u['role'], ['chair', 'member'], true)) {
            throw new ApiError(403, 'Akses ditolak. Hanya Ketua Panel dan Anggota Panel yang dapat melihat status penilaian.');
        }
        respond(200, true, 'Status penilaian seluruh panel berhasil diambil.', $app->getAssessmentsStatus(querySessionId()));
    }

    // Route: Perhitungan (Results)
    // Endpoint SAW legacy dipertahankan (pembanding sementara).
    if ($method === 'GET' && ($route === '/results/saw/me' || $route === '/results/saw')) {
        respond(200, true, 'Perhitungan SAW pribadi berhasil diambil.', $app->calculateSawMe($currentUser, querySessionId()));
    }

    // Endpoint TOPSIS personal: identitas DM diambil dari token, bukan parameter.
    if ($method === 'GET' && ($route === '/results/topsis/me' || $route === '/results/topsis')) {
        $u = $app->actor($currentUser);
        if (!in_array($u['role'], ['chair', 'member'], true)) {
            throw new ApiError(403, 'Akses ditolak. Hasil TOPSIS hanya dapat diakses oleh Ketua Panel dan Anggota Panel.');
        }
        respond(200, true, 'Perhitungan TOPSIS pribadi berhasil diambil.', $app->calculateTopsisMe($currentUser, querySessionId()));
    }

    if ($method === 'GET' && $route === '/results/borda') {
        $u = $app->actor($currentUser);
        if (!in_array($u['role'], ['chair', 'member'], true)) {
            throw new ApiError(403, 'Akses ditolak. Hasil Borda hanya dapat diakses oleh Ketua Panel dan Anggota Panel.');
        }
        respond(200, true, 'Agregasi metode Borda berhasil dihitung.', $app->calculateBorda(querySessionId()));
    }

    // Route: Voting Langsung
    if ($method === 'GET' && $route === '/voting/status') {
        respond(200, true, 'Status sesi voting berhasil diambil.', $app->getVotingStatus($currentUser, querySessionId()));
    }

    if ($method === 'POST' && ($route === '/voting/open' || $route === '/rounds')) {
        $res = $app->openVoting($currentUser);
        respond(201, true, $res['message'] ?? 'Sesi voting berhasil dibuka.', $res);
    }

    if ($method === 'POST' && ($route === '/voting/vote' || $route === '/votes')) {
        $res = $app->vote($currentUser, $body['candidate_id'] ?? null);
        respond(201, true, 'Suara voting Anda berhasil dicatat.', $res);
    }

    if ($method === 'GET' && $route === '/voting/results') {
        $app->actor($currentUser);
        respond(200, true, 'Hasil perolehan suara voting berhasil diambil.', $app->getVotingResults(querySessionId()));
    }

    if ($method === 'POST' && $route === '/voting/next-round') {
        $res = $app->nextRoundVoting($currentUser);
        respond(201, true, $res['message'] ?? 'Putaran voting baru berhasil dibuka.', $res);
    }

    // Route: Pengesahan Keputusan (Decisions)
    if ($method === 'POST' && ($route === '/decisions/approve' || $route === '/decision')) {
        $res = $app->approveDecision($currentUser, (string)($body['reason'] ?? ''));
        respond(201, true, 'Keputusan konsensus mayoritas berhasil disahkan oleh Ketua Panel.', $res);
    }

    if ($method === 'GET' && $route === '/decisions/final') {
        $app->actor($currentUser);
        $res = $app->getFinalDecision(querySessionId());
        if ($res === null) {
            throw new ApiError(404, 'Belum ada keputusan final yang disahkan.');
        }
        respond(200, true, 'Keputusan konsensus final berhasil diambil.', $res);
    }

    if ($method === 'GET' && $route === '/decisions/history') {
        $app->actor($currentUser);
        respond(200, true, 'Riwayat putaran voting dan keputusan berhasil diambil.', $app->getDecisionsHistory(querySessionId()));
    }

    // ===== PHASE 4: Election Cycle =====

    // GET /elections — daftar semua siklus (histori)
    if ($method === 'GET' && $route === '/elections') {
        respond(200, true, 'Daftar siklus pemilihan berhasil diambil.', $app->listElections($currentUser));
    }

    // GET /elections/active — sesi aktif + flag can_create (konsisten dengan daftar)
    if ($method === 'GET' && $route === '/elections/active') {
        respond(200, true, 'Sesi pemilihan aktif berhasil diambil.', $app->getActiveSession($currentUser));
    }

    // GET /elections/{id} — detail siklus spesifik (histori)
    if ($method === 'GET' && preg_match('#^/elections/(\d+)$#', $route, $m)) {
        $sid = (int)$m[1];
        respond(200, true, 'Detail siklus pemilihan berhasil diambil.', $app->getElection($currentUser, $sid));
    }

    // POST /elections — buat siklus baru (hanya Ketua Panel, sesi aktif ratified)
    if ($method === 'POST' && $route === '/elections') {
        $title = (string)($body['title'] ?? '');
        $description = isset($body['description']) ? (string)$body['description'] : null;
        $clientIp = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
        $res = $app->createElectionCycle($currentUser, $title, $description, $clientIp);
        respond(201, true, $res['message'], $res);
    }

    // ===== PHASE 6: Audit Trail Logs (Chair Only) =====
    if ($method === 'GET' && $route === '/audit-logs') {
        $limit = isset($_GET['limit']) ? min(200, max(1, (int)$_GET['limit'])) : 50;
        $offset = isset($_GET['offset']) ? max(0, (int)$_GET['offset']) : 0;
        $userId = null;
        if (isset($_GET['user_id']) && $_GET['user_id'] !== '' && ctype_digit((string)$_GET['user_id'])) {
            $userId = (int)$_GET['user_id'];
        }
        $action = null;
        if (isset($_GET['action']) && $_GET['action'] !== '') {
            $action = (string)$_GET['action'];
        }
        $dateFrom = null;
        if (isset($_GET['date_from']) && $_GET['date_from'] !== '') {
            $dateFrom = (string)$_GET['date_from'];
        }
        $dateTo = null;
        if (isset($_GET['date_to']) && $_GET['date_to'] !== '') {
            $dateTo = (string)$_GET['date_to'];
        }
        $result = $app->listAuditLogs($currentUser, querySessionId(), $limit, $offset, $userId, $action, $dateFrom, $dateTo);
        respond(200, true, 'Daftar audit log berhasil diambil.', $result);
    }

    throw new ApiError(404, "Endpoint {$method} {$path} tidak ditemukan.");

} catch (ApiError $e) {
    respond($e->httpStatus, false, $e->getMessage(), null);
} catch (PDOException $e) {
    error_log('Database Error: ' . $e->getMessage());
    respond(503, false, 'Layanan database tidak tersedia atau mengalami kegagalan.', null);
} catch (Throwable $e) {
    error_log('Internal Error: ' . $e->getMessage());
    respond(500, false, 'Terjadi kesalahan internal pada server.', null);
}
