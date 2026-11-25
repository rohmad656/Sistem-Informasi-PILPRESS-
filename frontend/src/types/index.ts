export type UserRole = 'chair' | 'member' | 'voter';

export interface User {
  id: number;
  username: string;
  name: string;
  role: UserRole;
}

export interface LoginResponseData {
  token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface Candidate {
  id: number;
  session_id?: number;
  name: string;
  description?: string | null;
  vision: string | null;
  mission: string | null;
  work_program?: string | null;
  profile: string | null;
  is_finalized?: boolean | number;
  created_at?: string;
}

export interface Criterion {
  id: number;
  session_id?: number;
  code: string;
  name: string;
  weight: number;
  type: 'benefit' | 'cost';
  description?: string | null;
  is_finalized?: boolean | number;
  created_at?: string;
}

export interface CriteriaSummary {
  session_id: number;
  count: number;
  total_weight: number;
  is_complete: boolean;
  is_finalized: boolean;
  can_manage: boolean;
  can_finalize: boolean;
}

export interface AssessmentItem {
  candidate_id: number;
  criterion_id: number;
  score: number;
}

export interface MyAssessmentsResponse {
  user_id: number;
  is_finalized: boolean;
  finalized_at: string | null;
  items: AssessmentItem[];
}

export interface PanelistStatus {
  user_id: number;
  username: string;
  name: string;
  role: UserRole;
  is_finalized: boolean;
  finalized_at: string | null;
}

export interface AssessmentStatusResponse {
  all_finalized: boolean;
  total_panelists: number;
  panel: PanelistStatus[];
}

export interface CriterionBreakdown {
  criterion_id: number;
  code: string;
  raw_score: number;
  best_value: number;
  normalized: number;
  weight: number;
  weighted_score: number;
}

export interface SawRankingItem {
  candidate_id: number;
  candidate_name: string;
  final_score: number;
  rank: number;
  breakdown: Record<string, CriterionBreakdown>;
}

export interface SawResponse {
  dm_user_id: number;
  dm_name: string;
  rankings: SawRankingItem[];
}

/** Rincian satu kriteria pada perhitungan TOPSIS (dari backend). */
export interface TopsisCriterionBreakdown {
  criterion_id: number;
  code: string;
  raw_score: number;
  sum_squares: number;
  normalized: number;
  weight: number;
  norm_weight: number;
  weighted_normalized: number;
  ideal_positive: number;
  ideal_negative: number;
}

/** Satu baris ranking TOPSIS personal DM. */
export interface TopsisRankingItem {
  candidate_id: number;
  candidate_name: string;
  /** Nilai preferensi TOPSIS, rentang 0–1, presisi penuh dari backend. */
  final_score: number;
  d_plus: number;
  d_minus: number;
  rank: number;
  breakdown: Record<string, TopsisCriterionBreakdown>;
}

/** Response GET /results/topsis/me (atau /results/topsis). */
export interface TopsisResponse {
  dm_user_id: number;
  dm_name: string;
  rankings: TopsisRankingItem[];
}

export interface BordaRankingItem {
  candidate_id: number;
  candidate_name: string;
  borda_points: number;
  borda_value: number;
  percentage: number;
  rank: number;
}

export interface BordaDmBreakdownItem {
  score: number;
  rank_position: number;
  is_tied?: boolean;
  points: number;
}

export interface BordaResponse {
  total_points_distributed: number;
  rankings: BordaRankingItem[];
  dm_breakdown: Record<string, Record<string, BordaDmBreakdownItem>>;
}

export interface CandidateTally {
  candidate_id: number;
  candidate_name: string;
  votes: number;
  percentage: number;
}

export interface VotingWinner {
  candidate_id: number;
  candidate_name: string;
  votes: number;
  percentage: number;
}

export interface VotingEvaluation {
  status: 'waiting' | 'majority' | 'tie_revote';
  is_completed: boolean;
  requires_revote?: boolean;
  total_votes_cast: number;
  required_votes?: number;
  eligible_voters?: number;
  majority_threshold?: number;
  winner: VotingWinner | null;
  tallies: CandidateTally[];
}

export interface RatifiedDecision {
  id: number;
  session_id: number;
  round_id: number;
  candidate_id: number;
  candidate_name: string;
  vision?: string;
  mission?: string;
  total_votes: number;
  /** Backend mengirim DECIMAL sebagai string (mis. "66.67") lewat PDO. */
  percentage: number | string;
  approved_by: number;
  approved_by_name: string;
  reason: string;
  approved_at: string;
  round_number?: number;
}

export interface ElectorateVoterStatus {
  user_id: number;
  username: string;
  name: string;
  role: UserRole;
  has_voted: boolean;
  voted_at?: string | null;
}

export interface VotingStatusResponse {
  session_id?: number;
  session_status: 'assessment' | 'voting' | 'tie_revote' | 'voting_completed' | 'ratified';
  current_round: number;
  round_id?: number | null;
  is_voting_open: boolean;
  has_voted_this_round: boolean;
  votes_cast_in_round: number;
  eligible_voters: number;
  required_votes: number;
  majority_threshold: number;
  is_eligible: boolean;
  evaluation: VotingEvaluation | null;
  ratified_decision: RatifiedDecision | null;
  can_chair_open: boolean;
  can_chair_approve: boolean;
  electorate: ElectorateVoterStatus[];
}

export interface VotingResultsResponse {
  session_status: string;
  round_number: number;
  round_status: 'open' | 'completed' | 'tie_revote';
  results: VotingEvaluation;
}

export interface DecisionHistoryRound {
  id: number;
  round_number: number;
  status: string;
  opened_at: string;
  closed_at: string | null;
  opened_by_name: string;
  evaluation: VotingEvaluation;
}

export interface DecisionHistoryResponse {
  session_id: number;
  rounds: DecisionHistoryRound[];
  final_decision: RatifiedDecision | null;
}

/* ===== Phase 4: Election Cycle / New Election System ===== */

export type ElectionStatus = 'assessment' | 'voting' | 'tie_revote' | 'voting_completed' | 'ratified';

/** Ringkasan satu siklus pemilihan untuk daftar histori. */
export interface ElectionSummary {
  id: number;
  title: string;
  description: string | null;
  status: ElectionStatus;
  current_round: number;
  created_by: number | null;
  previous_session_id: number | null;
  created_at: string;
  updated_at: string;
  electorate_count: number;
  round_count: number;
  is_active: boolean;
  final_candidate: string | null;
  /** True hanya untuk Ketua Panel pada sesi aktif yang sudah ratified. */
  can_create_election: boolean;
}

/** Detail sesi pada endpoint /elections/{id} (tanpa field agregat daftar). */
export interface ElectionDetailSession {
  id: number;
  title: string;
  description: string | null;
  status: ElectionStatus;
  current_round: number;
  created_by: number | null;
  previous_session_id: number | null;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  can_create_election: boolean;
}

/** Electorate yang disnapshot saat siklus baru dibuat. */
export interface ElectionElectorateMember {
  user_id: number;
  username: string;
  role: UserRole;
}

export interface CreateElectionResponse {
  session_id: number;
  title: string;
  description: string | null;
  status: 'assessment';
  current_round: 0;
  previous_session_id: number;
  created_by: number;
  electorate: ElectionElectorateMember[];
  message: string;
}

/** Baca ulang seluruh hasil siklus lama tanpa mengubahnya. */
export interface ElectionDetail {
  session: ElectionDetailSession;
  voting_status: VotingStatusResponse;
  voting_results: VotingResultsResponse | null;
  history: DecisionHistoryResponse;
  final_decision: RatifiedDecision | null;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data: T;
}

/* ===== Phase 6: Audit Trail ===== */

export interface AuditLog {
  id: number;
  session_id: number | null;
  user_id: number | null;
  action: string;
  details: string;
  ip_address: string | null;
  created_at: string;
  user_name: string | null;
  user_role: string | null;
}

export interface AuditLogsResponse {
  logs: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}
