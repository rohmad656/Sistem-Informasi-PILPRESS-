import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, describeApiError } from '@/services/api';
import { useAuth } from '@/features/auth/AuthContext';
import { ElectorateMonitor } from '@/components/ElectorateMonitor';
import {
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  History,
  Layers,
  PlusCircle,
  Users,
} from 'lucide-react';

const statusLabel = (status: string): string => {
  const map: Record<string, string> = {
    assessment: 'Penilaian',
    voting: 'Voting',
    tie_revote: 'Seri — Revote',
    voting_completed: 'Voting Selesai',
    ratified: 'Disahkan',
  };
  return map[status] ?? status;
};

const formatDate = (value: string): string => {
  try {
    return new Date(value.replace(' ', 'T')).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return value;
  }
};

export const ElectionHistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const listQuery = useQuery({
    queryKey: ['elections'],
    queryFn: async () => {
      const res = await api.getElections();
      if (res.success && res.data) return res.data;
      throw new Error(res.message || 'Gagal memuat riwayat pemilihan');
    },
  });

  const detailQuery = useQuery({
    queryKey: ['elections', selectedId],
    queryFn: async () => {
      if (selectedId === null) throw new Error('Siklus tidak dipilih');
      const res = await api.getElection(selectedId);
      if (res.success && res.data) return res.data;
      throw new Error(res.message || 'Gagal memuat detail siklus');
    },
    enabled: selectedId !== null,
  });

  const list = listQuery.data ?? [];
  const canCreate = list.some((e) => e.can_create_election);
  const detail = detailQuery.data;
  const detailFinal = detail?.final_decision ?? detail?.history?.final_decision ?? null;
  const detailWinner = detail?.voting_results?.results?.winner ?? null;

  return (
    <div className="space-y-6" data-testid="election-history-page">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy-800">Riwayat Siklus Pemilihan</h1>
          <p className="text-slate-500 mt-1 text-sm">
            Arsip seluruh pemilihan. Hasil TOPSIS, Borda, voting, revote, dan keputusan final tetap dapat diakses.
          </p>
        </div>
        {canCreate && user?.role === 'chair' && (
          <button
            onClick={() => navigate('/elections/new')}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-navy-800 text-white rounded-lg text-sm font-semibold hover:bg-navy-900 transition focus:outline-none focus:ring-2 focus:ring-gold-accent"
            data-testid="history-create-election"
          >
            <PlusCircle className="w-4 h-4" /> Pemilihan Baru
          </button>
        )}
      </div>

      {listQuery.isLoading ? (
        <div className="flex items-center justify-center h-48">
          <div className="text-center">
            <div className="w-10 h-10 border-4 border-navy-800 border-t-gold-accent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-slate-600 text-sm">Memuat riwayat pemilihan...</p>
          </div>
        </div>
      ) : listQuery.error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-700 font-medium">
            {describeApiError(listQuery.error, 'Gagal memuat riwayat pemilihan.')}
          </p>
          <button
            onClick={() => listQuery.refetch()}
            className="mt-4 px-4 py-2 bg-navy-800 text-white rounded-lg text-sm font-medium hover:bg-navy-900 transition"
          >
            Coba Lagi
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4" data-testid="election-history-list">
          {list.length === 0 ? (
            <div className="bg-white rounded-xl shadow border border-slate-100 p-8 text-center text-slate-500 text-sm">
              Belum ada siklus pemilihan.
            </div>
          ) : (
            list.map((election) => (
              <article
                key={election.id}
                className="bg-white rounded-xl shadow border border-slate-100 overflow-hidden hover:border-navy-200 transition"
                data-testid={`election-card-${election.id}`}
              >
                <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/70 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <History className="w-4 h-4 text-navy-700" />
                      <h2 className="font-bold text-navy-800 text-lg">
                        #{election.id} — {election.title}
                      </h2>
                      {election.is_active && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gold-accent text-navy-900 border border-yellow-400" data-testid={`election-active-${election.id}`}>
                          Aktif
                        </span>
                      )}
                    </div>
                    {election.description && (
                      <p className="text-sm text-slate-500 mt-1">{election.description}</p>
                    )}
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                      election.status === 'ratified'
                        ? 'bg-green-100 text-green-800 border-green-200'
                        : 'bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                    data-testid={`election-status-${election.id}`}
                  >
                    {statusLabel(election.status)}
                  </span>
                </div>

                <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase">Electorate</p>
                    <p className="font-medium text-slate-800 mt-1 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-slate-400" /> {election.electorate_count} orang
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase">Putaran</p>
                    <p className="font-medium text-slate-800 mt-1 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-slate-400" /> {election.round_count} putaran
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase">Keputusan Final</p>
                    <p className="font-medium text-slate-800 mt-1">{election.final_candidate ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase">Dibuat</p>
                    <p className="font-medium text-slate-800 mt-1 flex items-center gap-1.5">
                      <CalendarDays className="w-3.5 h-3.5 text-slate-400" /> {formatDate(election.created_at)}
                    </p>
                  </div>
                </div>

                <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
                  <button
                    onClick={() => setSelectedId(election.id)}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-700 hover:text-navy-900 hover:underline focus:outline-none focus:ring-2 focus:ring-gold-accent rounded"
                    data-testid={`election-detail-button-${election.id}`}
                  >
                    Lihat Detail <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      )}

      {/* Detail siklus (read-only) */}
      {selectedId !== null && (
        <section className="bg-white rounded-xl shadow border border-slate-100 p-5 space-y-5" data-testid="election-detail-panel">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-lg font-bold text-navy-800" data-testid="election-detail-title">
                Detail Siklus #{selectedId}
              </h2>
              <p className="text-xs text-slate-500 mt-1">Data historis — dibaca langsung per session_id, tidak diubah.</p>
            </div>
            <button
              onClick={() => setSelectedId(null)}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 hover:text-navy-800 hover:bg-slate-100 rounded-lg transition"
            >
              <ArrowLeft className="w-4 h-4" /> Kembali ke Daftar
            </button>
          </div>

          {detailQuery.isLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-9 h-9 border-4 border-navy-800 border-t-gold-accent rounded-full animate-spin" />
            </div>
          ) : detailQuery.error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-5 text-center">
              <p className="text-red-700 text-sm">
                {describeApiError(detailQuery.error, 'Gagal memuat detail siklus.')}
              </p>
              <button
                onClick={() => detailQuery.refetch()}
                className="mt-3 px-4 py-2 bg-navy-800 text-white rounded-lg text-sm font-medium"
              >
                Coba Lagi
              </button>
            </div>
          ) : detail ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase">Status Sesi</p>
                  <p className="font-medium text-slate-800 mt-1">{statusLabel(detail.session.status)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase">Putaran Saat Ini</p>
                  <p className="font-medium text-slate-800 mt-1">#{detail.session.current_round}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase">Sesi Sebelumnya</p>
                  <p className="font-medium text-slate-800 mt-1">
                    {detail.session.previous_session_id ? `#${detail.session.previous_session_id}` : '—'}
                  </p>
                </div>
              </div>

              {detail.voting_status && (
                <ElectorateMonitor
                  electorate={detail.voting_status.electorate}
                  votesCast={detail.voting_status.votes_cast_in_round}
                  totalVoters={detail.voting_status.eligible_voters}
                  currentRound={detail.voting_status.current_round}
                />
              )}

              {detailWinner && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm" data-testid="election-detail-winner">
                  <p className="flex items-center gap-2 font-semibold text-green-900">
                    <CheckCircle2 className="w-4 h-4" /> Pemenang Voting: {detailWinner.candidate_name}
                  </p>
                  <p className="text-green-800 mt-1">
                    {detailWinner.votes} suara · {Number(detailWinner.percentage).toFixed(2)}%
                  </p>
                </div>
              )}

              {detailFinal && (
                <div className="bg-navy-50 border border-navy-100 rounded-lg p-4 text-sm" data-testid="election-detail-final">
                  <p className="flex items-center gap-2 font-semibold text-navy-800">
                    <BadgeCheck className="w-4 h-4" /> Keputusan Final: {detailFinal.candidate_name}
                  </p>
                  <p className="text-slate-600 mt-1">
                    {Number(detailFinal.percentage).toFixed(2)}% · disahkan oleh {detailFinal.approved_by_name}
                  </p>
                </div>
              )}

              <div>
                <h3 className="font-bold text-navy-800 text-sm mb-2">Riwayat Putaran</h3>
                <div className="space-y-2" data-testid="election-detail-rounds">
                  {(detail.history?.rounds ?? []).length === 0 ? (
                    <p className="text-sm text-slate-500">Belum ada putaran voting pada siklus ini.</p>
                  ) : (
                    detail.history.rounds.map((round) => (
                      <div key={round.id} className="border border-slate-200 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="font-medium text-slate-800">Putaran #{round.round_number}</span>
                        <span className="text-slate-500">{statusLabel(round.status)}</span>
                        <span className="text-xs text-slate-400">
                          {new Date(round.opened_at.replace(' ', 'T')).toLocaleDateString('id-ID')}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : null}
        </section>
      )}
    </div>
  );
};
