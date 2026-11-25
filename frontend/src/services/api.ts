import {
  ApiResponse,
  LoginResponseData,
  User,
  Candidate,
  Criterion,
  MyAssessmentsResponse,
  AssessmentStatusResponse,
  SawResponse,
  TopsisResponse,
  BordaResponse,
  VotingStatusResponse,
  VotingResultsResponse,
  RatifiedDecision,
  DecisionHistoryResponse,
  ElectionSummary,
  ElectionDetail,
  CreateElectionResponse,
  CriteriaSummary,
  AuditLogsResponse,
} from '@/types';

/** Error HTTP dari backend. `status` memungkinkan UI membedakan prasyarat bisnis (409) dari kegagalan server. */
export class ApiError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Terjemahkan error menjadi pesan aman untuk pengguna.
 * Pesan backend dipakai bila tersedia; selain itu dipakai pesan sesuai kode status.
 */
export function describeApiError(error: unknown, fallback: string): string {
  if (isApiError(error)) {
    if (error.message) return error.message;
    switch (error.status) {
      case 400: return 'Permintaan tidak valid.';
      case 401: return 'Sesi tidak valid atau sudah kedaluwarsa. Silakan login kembali.';
      case 403: return 'Akses ditolak. Anda tidak memiliki izin untuk tindakan ini.';
      case 404: return 'Data tidak ditemukan.';
      case 409: return 'Konflik data. Silakan periksa masukan Anda.';
      case 422: return 'Validasi gagal. Periksa kembali isian Anda.';
      case 429: return 'Terlalu banyak percobaan. Silakan coba kembali beberapa saat lagi.';
      case 500: return 'Terjadi kesalahan internal pada server.';
      case 503: return 'Layanan tidak tersedia. Pastikan server backend aktif.';
      default: return fallback;
    }
  }
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return 'Tidak dapat terhubung ke server. Periksa koneksi atau pastikan backend berjalan.';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

const LOGIN_ENDPOINTS = new Set(['/login', '/auth/login']);

export class ApiClient {
  private baseUrl: string;
  private token: string | null = null;
  private onUnauthorizedCallback: (() => void) | null = null;

  constructor() {
    this.baseUrl = import.meta.env.VITE_API_URL || '/api';
    // Initialize token from sessionStorage (stateless tab session)
    this.token = sessionStorage.getItem('gdss_token');
  }

  public setUnauthorizedHandler(callback: () => void) {
    this.onUnauthorizedCallback = callback;
  }

  public setToken(token: string | null) {
    this.token = token;
    if (token) {
      sessionStorage.setItem('gdss_token', token);
    } else {
      sessionStorage.removeItem('gdss_token');
    }
  }

  public getToken(): string | null {
    if (!this.token) {
      this.token = sessionStorage.getItem('gdss_token');
    }
    return this.token;
  }

  public clearSession() {
    this.token = null;
    sessionStorage.removeItem('gdss_token');
    sessionStorage.removeItem('gdss_user');
  }

  public getStoredUser(): User | null {
    const raw = sessionStorage.getItem('gdss_user');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  public setStoredUser(user: User | null) {
    if (user) {
      sessionStorage.setItem('gdss_user', JSON.stringify(user));
    } else {
      sessionStorage.removeItem('gdss_user');
    }
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const config: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined && method !== 'GET') {
      config.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, config);
    } catch {
      throw new Error('Tidak dapat terhubung ke server backend. Pastikan server PHP aktif.');
    }

    let jsonResult: ApiResponse<T>;
    try {
      jsonResult = await response.json();
    } catch {
      throw new Error(`Respons server tidak valid (HTTP ${response.status}).`);
    }

    if (!response.ok) {
      const isLoginEndpoint = LOGIN_ENDPOINTS.has(endpoint);
      // Hanya panggil callback unauthorized untuk endpoint BUKAN login
      // (login 401 = kredensial salah, bukan sesi kedaluwarsa)
      if (response.status === 401 && !isLoginEndpoint) {
        this.clearSession();
        if (this.onUnauthorizedCallback) {
          this.onUnauthorizedCallback();
        }
      }
      const errorMsg = jsonResult.message || `Terjadi kesalahan (Kode status: ${response.status})`;
      throw new ApiError(response.status, errorMsg);
    }

    return jsonResult;
  }

  // --- Auth APIs ---
  async login(username: string, password: string): Promise<ApiResponse<LoginResponseData>> {
    const res = await this.request<LoginResponseData>('POST', '/login', { username, password });
    if (res.success && res.data.token) {
      this.setToken(res.data.token);
      this.setStoredUser(res.data.user);
    }
    return res;
  }

  async getMe(): Promise<ApiResponse<User>> {
    return this.request<User>('GET', '/auth/me');
  }

  async logout(): Promise<ApiResponse<null>> {
    try {
      return await this.request<null>('POST', '/logout');
    } finally {
      this.clearSession();
    }
  }

  async register(name: string, username: string, password: string): Promise<ApiResponse<{ id: number; username: string; name: string; role: string; message: string }>> {
    return this.request<{ id: number; username: string; name: string; role: string; message: string }>('POST', '/register', { name, username, password });
  }

  // --- Master Data APIs (Phase 5: CRUD & Finalisasi) ---
  async getCandidates(sessionId?: number): Promise<ApiResponse<Candidate[]>> {
    const qs = sessionId ? `?session_id=${sessionId}` : '';
    return this.request<Candidate[]>('GET', `/candidates${qs}`);
  }

  async getCandidate(id: number, sessionId?: number): Promise<ApiResponse<Candidate>> {
    const qs = sessionId ? `?session_id=${sessionId}` : '';
    return this.request<Candidate>('GET', `/candidates/${id}${qs}`);
  }

  async createCandidate(body: {
    name: string;
    description?: string;
    vision?: string;
    mission?: string;
    work_program?: string;
    profile?: string;
  }, sessionId?: number): Promise<ApiResponse<{ id: number; message: string }>> {
    const qs = sessionId ? `?session_id=${sessionId}` : '';
    return this.request<{ id: number; message: string }>('POST', `/candidates${qs}`, body);
  }

  async updateCandidate(id: number, body: {
    name: string;
    description?: string;
    vision?: string;
    mission?: string;
    work_program?: string;
    profile?: string;
  }, sessionId?: number): Promise<ApiResponse<{ id: number; message: string }>> {
    const qs = sessionId ? `?session_id=${sessionId}` : '';
    return this.request<{ id: number; message: string }>('PUT', `/candidates/${id}${qs}`, body);
  }

  async deleteCandidate(id: number, sessionId?: number): Promise<ApiResponse<{ id: number; message: string }>> {
    const qs = sessionId ? `?session_id=${sessionId}` : '';
    return this.request<{ id: number; message: string }>('DELETE', `/candidates/${id}${qs}`);
  }

  async verifyCandidate(id: number, sessionId?: number): Promise<ApiResponse<{ id: number; message: string }>> {
    const qs = sessionId ? `?session_id=${sessionId}` : '';
    return this.request<{ id: number; message: string }>('POST', `/candidates/${id}/verify${qs}`);
  }

  async finalizeCandidates(sessionId?: number): Promise<ApiResponse<{ session_id: number; count: number; message: string }>> {
    const qs = sessionId ? `?session_id=${sessionId}` : '';
    return this.request<{ session_id: number; count: number; message: string }>('POST', `/candidates/finalize${qs}`);
  }

  async getCriteria(sessionId?: number): Promise<ApiResponse<Criterion[]>> {
    const qs = sessionId ? `?session_id=${sessionId}` : '';
    return this.request<Criterion[]>('GET', `/criteria${qs}`);
  }

  async getCriteriaSummary(sessionId?: number): Promise<ApiResponse<CriteriaSummary>> {
    const qs = sessionId ? `?session_id=${sessionId}` : '';
    return this.request<CriteriaSummary>('GET', `/criteria/summary${qs}`);
  }

  async createCriterion(body: {
    name: string;
    description?: string;
    weight: number;
    type: 'benefit' | 'cost';
  }, sessionId?: number): Promise<ApiResponse<{ id: number; code: string; message: string }>> {
    const qs = sessionId ? `?session_id=${sessionId}` : '';
    return this.request<{ id: number; code: string; message: string }>('POST', `/criteria${qs}`, body);
  }

  async updateCriterion(id: number, body: {
    name: string;
    description?: string;
    weight: number;
    type: 'benefit' | 'cost';
  }, sessionId?: number): Promise<ApiResponse<{ id: number; message: string }>> {
    const qs = sessionId ? `?session_id=${sessionId}` : '';
    return this.request<{ id: number; message: string }>('PUT', `/criteria/${id}${qs}`, body);
  }

  async deleteCriterion(id: number, sessionId?: number): Promise<ApiResponse<{ id: number; message: string }>> {
    const qs = sessionId ? `?session_id=${sessionId}` : '';
    return this.request<{ id: number; message: string }>('DELETE', `/criteria/${id}${qs}`);
  }

  async finalizeCriteria(sessionId?: number): Promise<ApiResponse<{ session_id: number; count: number; message: string }>> {
    const qs = sessionId ? `?session_id=${sessionId}` : '';
    return this.request<{ session_id: number; count: number; message: string }>('POST', `/criteria/finalize${qs}`);
  }

  // --- Assessment APIs ---
  async getMyAssessments(): Promise<ApiResponse<MyAssessmentsResponse>> {
    return this.request<MyAssessmentsResponse>('GET', '/assessments/me');
  }

  async saveAssessments(items: { candidate_id: number; criterion_id: number; score: number }[]): Promise<ApiResponse<{ saved_items: number }>> {
    return this.request<{ saved_items: number }>('PUT', '/assessments/me', { items });
  }

  async finalizeAssessments(): Promise<ApiResponse<{ is_finalized: boolean; finalized_at: string }>> {
    return this.request<{ is_finalized: boolean; finalized_at: string }>('POST', '/assessments/me/finalize');
  }

  async getAssessmentStatus(): Promise<ApiResponse<AssessmentStatusResponse>> {
    return this.request<AssessmentStatusResponse>('GET', '/assessments/status');
  }

  // --- Results APIs ---
  async getSawResults(): Promise<ApiResponse<SawResponse>> {
    return this.request<SawResponse>('GET', '/results/saw/me');
  }

  /** Hasil TOPSIS personal DM yang sedang login (skor 0–1, presisi penuh). */
  async getTopsisResults(sessionId?: number): Promise<ApiResponse<TopsisResponse>> {
    const qs = sessionId ? `?session_id=${sessionId}` : '';
    return this.request<TopsisResponse>('GET', `/results/topsis/me${qs}`);
  }

  async getBordaResults(): Promise<ApiResponse<BordaResponse>> {
    return this.request<BordaResponse>('GET', '/results/borda');
  }

  // --- Voting APIs ---
  async getVotingStatus(): Promise<ApiResponse<VotingStatusResponse>> {
    return this.request<VotingStatusResponse>('GET', '/voting/status');
  }

  async openVoting(): Promise<ApiResponse<{ round_number: number; status: string; message: string }>> {
    return this.request<{ round_number: number; status: string; message: string }>('POST', '/voting/open');
  }

  async vote(candidateId: number): Promise<ApiResponse<{ round_number: number; has_voted: boolean; votes_cast_in_round: number; round_completed: boolean }>> {
    return this.request<{ round_number: number; has_voted: boolean; votes_cast_in_round: number; round_completed: boolean }>('POST', '/voting/vote', { candidate_id: candidateId });
  }

  async getVotingResults(): Promise<ApiResponse<VotingResultsResponse>> {
    return this.request<VotingResultsResponse>('GET', '/voting/results');
  }

  async getNextRoundVoting(): Promise<ApiResponse<{ round_number: number; status: string; message: string }>> {
    return this.request<{ round_number: number; status: string; message: string }>('POST', '/voting/next-round');
  }

  async nextRoundVoting(): Promise<ApiResponse<{ round_number: number; status: string; message: string }>> {
    return this.getNextRoundVoting();
  }

  // --- Decision APIs ---
  async approveDecision(reason: string): Promise<ApiResponse<RatifiedDecision>> {
    return this.request<RatifiedDecision>('POST', '/decisions/approve', { reason });
  }

  async getFinalDecision(): Promise<ApiResponse<RatifiedDecision | null>> {
    return this.request<RatifiedDecision | null>('GET', '/decisions/final');
  }

  async getDecisionsHistory(): Promise<ApiResponse<DecisionHistoryResponse>> {
    return this.request<DecisionHistoryResponse>('GET', '/decisions/history');
  }

  // --- Election Cycle APIs (Phase 4) ---

  /** Daftar semua siklus pemilihan, terbaru lebih dulu (histori). */
  async getElections(): Promise<ApiResponse<ElectionSummary[]>> {
    return this.request<ElectionSummary[]>('GET', '/elections');
  }

  /** Sesi aktif menurut session resolver backend (bukan asumsi id terbesar). */
  async getActiveElection(): Promise<ApiResponse<ElectionSummary>> {
    return this.request<ElectionSummary>('GET', '/elections/active');
  }

  /** Detail satu siklus — baca hasil lama tanpa mengubahnya. */
  async getElection(sessionId: number): Promise<ApiResponse<ElectionDetail>> {
    return this.request<ElectionDetail>('GET', `/elections/${sessionId}`);
  }

  /** Buat siklus baru. Hanya Ketua Panel, hanya saat sesi aktif ratified. */
  async createElection(
    title: string,
    description?: string | null
  ): Promise<ApiResponse<CreateElectionResponse>> {
    return this.request<CreateElectionResponse>('POST', '/elections', {
      title,
      description: description ?? null,
    });
  }

  // --- Audit Trail Logs APIs (Phase 6) ---
  /** Daftar log aktivitas sistem per sesi. Hanya role chair. */
  async getAuditLogs(
    sessionId?: number,
    limit = 50,
    offset = 0,
    userId?: number,
    action?: string,
    dateFrom?: string,
    dateTo?: string
  ): Promise<ApiResponse<AuditLogsResponse>> {
    const params = new URLSearchParams();
    if (sessionId !== undefined && sessionId !== null) params.append('session_id', String(sessionId));
    params.append('limit', String(limit));
    params.append('offset', String(offset));
    if (userId !== undefined) params.append('user_id', String(userId));
    if (action !== undefined && action !== '') params.append('action', action);
    if (dateFrom !== undefined && dateFrom !== '') params.append('date_from', dateFrom);
    if (dateTo !== undefined && dateTo !== '') params.append('date_to', dateTo);
    return this.request<AuditLogsResponse>('GET', `/audit-logs?${params.toString()}`);
  }
}

export const api = new ApiClient();