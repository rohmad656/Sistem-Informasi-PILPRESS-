import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { getDmDisplayName } from '@/utils/dmIdentity';
import { api, isApiError } from '@/services/api';
import { AssessmentStatusResponse, VotingStatusResponse, BordaResponse, ElectionSummary } from '@/types';
import { CheckCircle2, Clock, Check, RefreshCw, AlertCircle, Users, Vote, Layers, PlusCircle } from 'lucide-react';

/** Interval polling dashboard (ms). Refresh setiap 10 detik selama voting aktif. */
const POLL_INTERVAL_MS = 10_000;

/** Label status sesi dalam Bahasa Indonesia. */
function labelSessionStatus(status: string | undefined): string {
  switch (status) {
    case 'assessment':     return 'Tahap Penilaian';
    case 'voting':         return 'Voting Berlangsung';
    case 'tie_revote':     return 'Voting Ulang (Seri)';
    case 'voting_completed': return 'Voting Selesai';
    case 'ratified':       return 'Keputusan Disahkan';
    default:               return 'Belum Dimulai';
  }
}

/** Apakah sesi perlu polling aktif. */
function needsPolling(status: string | undefined): boolean {
  return status === 'voting' || status === 'tie_revote';
}

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const [assessmentStatus, setAssessmentStatus] = useState<AssessmentStatusResponse | null>(null);
  const [votingStatus, setVotingStatus] = useState<VotingStatusResponse | null>(null);
  const [bordaResults, setBordaResults] = useState<BordaResponse | null>(null);
  const [activeElection, setActiveElection] = useState<ElectionSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [assessError, setAssessError] = useState('');
  const [votingError, setVotingError] = useState('');
  const [activeElectionError, setActiveElectionError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isVoter = user?.role === 'voter';

  const loadVotingStatus = async () => {
    try {
      const res = await api.getVotingStatus();
      if (res.success && res.data) {
        setVotingStatus(res.data);
        setVotingError('');
      }
    } catch (err) {
      setVotingError(err instanceof Error ? err.message : 'Gagal memuat status voting');
    }
  };

  useEffect(() => {
    const loadAll = async () => {
      setIsLoading(true);

      // Siklus aktif (untuk semua role) — pakai session resolver resmi backend
      try {
        const actRes = await api.getActiveElection();
        if (actRes.success && actRes.data) {
          setActiveElection(actRes.data);
          setActiveElectionError('');
        } else {
          setActiveElectionError(actRes.message || 'Gagal memuat siklus aktif');
        }
      } catch (err) {
        // 404 = belum ada sesi aktif, bukan error fatal
        if (isApiError(err) && err.status === 404) {
          setActiveElection(null);
          setActiveElectionError('');
        } else {
          setActiveElectionError(err instanceof Error ? err.message : 'Gagal memuat siklus aktif');
        }
      }

      // Penilaian & Borda — hanya untuk panelis
      if (!isVoter) {
        try {
          const assRes = await api.getAssessmentStatus();
          if (assRes.success && assRes.data) {
            setAssessmentStatus(assRes.data);
            setAssessError('');
          }
        } catch (err) {
          setAssessError(err instanceof Error ? err.message : 'Gagal memuat status penilaian');
        }

        try {
          const bordRes = await api.getBordaResults();
          if (bordRes.success && bordRes.data) {
            setBordaResults(bordRes.data);
          }
        } catch {
          // Borda belum tersedia — bukan error fatal, cukup tidak tampil
        }
      }

      await loadVotingStatus();
      setIsLoading(false);
    };

    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVoter]);

  // Polling aktif hanya saat voting berlangsung
  useEffect(() => {
    if (needsPolling(votingStatus?.session_status)) {
      pollRef.current = setInterval(loadVotingStatus, POLL_INTERVAL_MS);
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [votingStatus?.session_status]);

  const getRoleDesc = (role?: string) => {
    switch (role) {
      case 'chair':  return 'Anda berperan sebagai Ketua Panel';
      case 'member': return 'Anda berperan sebagai Anggota Panel';
      case 'voter':  return 'Anda terdaftar sebagai Pemilih Publik';
      default:       return 'Pengguna Terdaftar';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="dashboard-loading">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-navy-800 border-t-gold-accent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Memuat dashboard...</p>
        </div>
      </div>
    );
  }

  /* ── Komponen bantu: Progres Voting ── */
  const VotingProgressSection: React.FC = () => {
    const vs = votingStatus;

    if (votingError) {
      return (
        <div
          className="bg-white rounded-lg shadow p-6 border-l-4 border-red-400"
          data-testid="voting-error"
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-red-500" />
            <h3 className="text-sm font-semibold text-slate-600">Progres Voting</h3>
          </div>
          <p className="text-sm text-red-600">{votingError}</p>
        </div>
      );
    }

    if (!vs || vs.session_status === 'assessment') {
      return (
        <div
          className="bg-white rounded-lg shadow p-6 border-l-4 border-slate-300"
          data-testid="voting-not-started"
        >
          <div className="flex items-center gap-2 mb-2">
            <Vote className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-600">Progres Voting</h3>
          </div>
          <p className="text-sm text-slate-500">
            Voting belum dimulai — data belum tersedia.
          </p>
        </div>
      );
    }

    const totalEligible = vs.eligible_voters;
    const castVotes = vs.votes_cast_in_round;
    const allCast = castVotes >= totalEligible && totalEligible > 0;
    const progressPct = totalEligible > 0 ? Math.round((castVotes / totalEligible) * 100) : 0;

    return (
      <div
        className="bg-white rounded-lg shadow p-6 border-l-4 border-indigo-500"
        data-testid="voting-progress"
      >
        <div className="flex items-center gap-2 mb-3">
          <Vote className="w-4 h-4 text-indigo-500" />
          <h3 className="text-sm font-semibold text-slate-600">Progres Voting</h3>
          {needsPolling(vs.session_status) && (
            <span
              className="ml-auto text-xs text-slate-400 flex items-center gap-1"
              data-testid="polling-indicator"
            >
              <RefreshCw className="w-3 h-3 animate-spin" />
              Auto-refresh
            </span>
          )}
        </div>

        {/* Jumlah suara */}
        <div className="mb-3">
          <div className="flex justify-between text-sm mb-1">
            <span className="font-medium text-slate-700">Suara masuk</span>
            <span
              className="font-bold text-navy-800"
              data-testid="votes-fraction"
            >
              {castVotes}/{totalEligible}
            </span>
          </div>
          <div className="bg-slate-100 rounded-full h-2.5">
            <div
              className={`h-2.5 rounded-full transition-all duration-500 ${
                allCast ? 'bg-green-500' : 'bg-indigo-500'
              }`}
              style={{ width: `${progressPct}%` }}
              data-testid="votes-progress-bar"
            />
          </div>
          {totalEligible === 0 ? (
            <p className="text-xs text-slate-400 mt-1">Data belum tersedia</p>
          ) : allCast ? (
            <p className="text-xs text-green-600 mt-1 font-medium" data-testid="collection-done">
              Pengumpulan suara selesai.
            </p>
          ) : (
            <p className="text-xs text-slate-500 mt-1" data-testid="collection-pending">
              {totalEligible - castVotes} panelis belum memberikan suara.
            </p>
          )}
        </div>

        {/* Status per panelis */}
        {vs.electorate && vs.electorate.length > 0 ? (
          <ul className="space-y-1.5" data-testid="electorate-list">
            {vs.electorate.map((e) => (
              <li
                key={e.user_id}
                className="flex items-center justify-between text-sm"
                data-testid={`electorate-item-${e.username}`}
              >
                <span className="text-slate-700">
                  {getDmDisplayName({ username: e.username, name: e.name })}
                  <span className="ml-1 text-xs text-slate-400">
                    ({e.role === 'chair' ? 'Ketua' : 'Anggota'})
                  </span>
                </span>
                {e.has_voted ? (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-xs font-semibold"
                    data-testid={`voted-${e.username}`}
                  >
                    <Check className="w-3 h-3" /> Sudah voting
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-semibold"
                    data-testid={`not-voted-${e.username}`}
                  >
                    <Clock className="w-3 h-3" /> Belum voting
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : castVotes === 0 ? (
          <p className="text-xs text-slate-500" data-testid="no-votes-yet">
            Belum ada suara masuk — 0/{totalEligible}
          </p>
        ) : null}

        {/* Putaran */}
        {vs.current_round > 0 && (
          <p className="text-xs text-slate-400 mt-3 border-t border-slate-100 pt-2">
            Putaran {vs.current_round}
            {vs.session_status === 'tie_revote' && (
              <span className="ml-2 text-amber-600 font-medium">· Voting ulang (seri)</span>
            )}
          </p>
        )}
      </div>
    );
  };

  /* ── Render utama ── */
  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="bg-gradient-to-r from-navy-800 to-navy-900 text-white rounded-xl p-6 shadow-lg">
        <h1 className="text-3xl font-bold mb-2">Selamat Datang, {user ? getDmDisplayName({ username: user.username, name: user.name }) : 'Pengguna'}</h1>
        <p className="text-slate-300">{getRoleDesc(user?.role)}</p>
      </div>

      {/* Siklus Aktif */}
      <div className="space-y-3" data-testid="active-cycle-section">
        {isLoading && (
          <div className="bg-white rounded-lg shadow p-6 border-l-4 border-slate-300 animate-pulse" data-testid="active-cycle-loading">
            <div className="h-5 bg-slate-200 rounded w-1/3 mb-2"></div>
            <div className="h-4 bg-slate-200 rounded w-1/2"></div>
          </div>
        )}
        {activeElectionError && !isLoading && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4" data-testid="active-cycle-error">
            <p className="text-red-700 font-medium">Gagal memuat siklus aktif</p>
            <p className="text-sm text-red-600 mt-1">{activeElectionError}</p>
          </div>
        )}
        {!activeElection && !activeElectionError && !isLoading && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4" data-testid="active-cycle-empty">
            <p className="text-slate-600 font-medium">Belum ada siklus pemilihan aktif</p>
            <p className="text-sm text-slate-500 mt-1">Ketua Panel dapat membuat siklus baru melalui menu "Pemilihan Baru".</p>
          </div>
        )}
        {activeElection && !isLoading && (
          <div className="bg-white rounded-lg shadow p-5 border-l-4 border-indigo-500" data-testid="active-cycle-banner">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  <h3 className="text-sm font-semibold text-slate-600">Siklus Pemilihan Aktif</h3>
                </div>
                <p className="text-xl font-bold text-navy-800">{activeElection.title}</p>
                {activeElection.description && (
                  <p className="text-sm text-slate-500 mt-1">{activeElection.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-500">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    ID Sesi: {activeElection.id}
                  </span>
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Status: {labelSessionStatus(activeElection.status)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5" />
                    Putaran: {activeElection.current_round}
                  </span>
                </div>
              </div>
              {activeElection.can_create_election && user?.role === 'chair' && (
                <button
                  type="button"
                  className="no-print inline-flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition"
                >
                  <PlusCircle className="w-4 h-4" /> Buat Siklus Baru
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Kartu status ringkas */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

        {/* Status Penilaian — hanya panelis */}
        {!isVoter && (
          assessError ? (
            <div
              className="bg-white rounded-lg shadow p-6 border-l-4 border-red-400"
              data-testid="assessment-error"
            >
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="w-4 h-4 text-red-500" />
                <h3 className="text-sm font-semibold text-slate-600">Status Penilaian</h3>
              </div>
              <p className="text-xs text-red-600">{assessError}</p>
            </div>
          ) : assessmentStatus ? (
            <div
              className="bg-white rounded-lg shadow p-6 border-l-4 border-blue-500"
              data-testid="assessment-status"
            >
              <h3 className="text-sm font-semibold text-slate-600 mb-2">Status Penilaian</h3>
              <p className="text-2xl font-bold text-navy-800">
                {assessmentStatus.panel.filter((p) => p.is_finalized).length}/
                {assessmentStatus.total_panelists}
              </p>
              <p className="text-xs text-slate-500 mt-1">Selesai</p>
              <div className="mt-4 bg-slate-100 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: `${
                      (assessmentStatus.panel.filter((p) => p.is_finalized).length /
                        assessmentStatus.total_panelists) *
                      100
                    }%`,
                  }}
                />
              </div>
            </div>
          ) : (
            <div
              className="bg-white rounded-lg shadow p-6 border-l-4 border-slate-300"
              data-testid="assessment-empty"
            >
              <h3 className="text-sm font-semibold text-slate-600 mb-2">Status Penilaian</h3>
              <p className="text-sm text-slate-400">Data belum tersedia</p>
            </div>
          )
        )}

        {/* Status Sesi Voting */}
        <div
          className="bg-white rounded-lg shadow p-6 border-l-4 border-green-500"
          data-testid="session-status-card"
        >
          <h3 className="text-sm font-semibold text-slate-600 mb-2">Status Voting</h3>
          <p className="text-xl font-bold text-navy-800" data-testid="session-status-label">
            {labelSessionStatus(votingStatus?.session_status)}
          </p>
          {votingStatus && votingStatus.current_round > 0 && (
            <p className="text-xs text-slate-500 mt-1">Putaran {votingStatus.current_round}</p>
          )}
        </div>

        {/* Kondisi Sesi */}
        <div
          className="bg-white rounded-lg shadow p-6 border-l-4 border-gold-accent"
          data-testid="session-condition-card"
        >
          <h3 className="text-sm font-semibold text-slate-600 mb-2">Kondisi Sesi</h3>
          <p className="text-2xl font-bold text-navy-800 flex items-center gap-2">
            {votingStatus?.ratified_decision ? (
              <>
                <CheckCircle2 className="w-6 h-6 text-green-600" />
                <span>Selesai</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-5 h-5 text-blue-600" />
                <span>Berlangsung</span>
              </>
            )}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {votingStatus?.ratified_decision
              ? 'Keputusan sudah disahkan'
              : 'Keputusan belum disahkan'}
          </p>
        </div>
      </div>

      {/* Progres Voting — semua role */}
      {votingStatus?.session_status !== 'assessment' && (
        <VotingProgressSection />
      )}

      {/* Daftar Panel Penilaian — hanya panelis */}
      {!isVoter && assessmentStatus && (
        <div className="bg-white rounded-lg shadow overflow-hidden" data-testid="panel-table">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-500" />
            <h3 className="font-semibold text-navy-800">Daftar Panel Penilaian</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-6 py-3 text-left font-semibold text-slate-600">Nama</th>
                  <th className="px-6 py-3 text-left font-semibold text-slate-600">Jabatan</th>
                  <th className="px-6 py-3 text-left font-semibold text-slate-600">Status</th>
                  <th className="px-6 py-3 text-left font-semibold text-slate-600">Waktu Finalisasi</th>
                </tr>
              </thead>
              <tbody>
                {assessmentStatus.panel.map((p) => (
                  <tr key={p.user_id} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-6 py-3">{getDmDisplayName({ username: p.username, name: p.name })}</td>
                    <td className="px-6 py-3 text-slate-600">
                      {p.role === 'chair' ? 'Ketua Panel' : 'Anggota Panel'}
                    </td>
                    <td className="px-6 py-3">
                      {p.is_finalized ? (
                        <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold">
                          <Check className="w-3.5 h-3.5" /> Selesai
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-semibold">
                          <Clock className="w-3.5 h-3.5" /> Draft
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {p.finalized_at
                        ? new Date(p.finalized_at).toLocaleString('id-ID')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Ringkas Hasil Borda — hanya panelis */}
      {!isVoter && bordaResults && (
        <div className="bg-white rounded-lg shadow overflow-hidden" data-testid="borda-preview">
          <div className="px-6 py-4 border-b border-slate-200">
            <h3 className="font-semibold text-navy-800">Ringkas Hasil Borda</h3>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {bordaResults.rankings.map((r) => (
                <div key={r.candidate_id} className="p-4 bg-slate-50 rounded-lg text-center">
                  <div className="text-2xl font-bold text-navy-800 mb-1">{r.rank}</div>
                  <p className="font-semibold text-slate-700">{r.candidate_name}</p>
                  <p className="text-sm text-slate-600 mt-1">
                    {r.borda_points} poin ({r.percentage}%)
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Keputusan Final */}
      {votingStatus?.ratified_decision && (
        <div
          className="bg-gradient-to-r from-gold-accent to-gold-hover text-navy-800 rounded-lg shadow p-6"
          data-testid="final-decision-banner"
        >
          <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-800" />
            <span>Keputusan Konsensus Akhir</span>
          </h3>
          <p className="mb-2">
            Calon terpilih:{' '}
            <span className="font-bold">{votingStatus.ratified_decision.candidate_name}</span>
          </p>
          <p className="text-sm">
            Disahkan oleh {getDmDisplayName(votingStatus.ratified_decision.approved_by_name)} pada{' '}
            {new Date(votingStatus.ratified_decision.approved_at).toLocaleString('id-ID')}
          </p>
        </div>
      )}
    </div>
  );
};
