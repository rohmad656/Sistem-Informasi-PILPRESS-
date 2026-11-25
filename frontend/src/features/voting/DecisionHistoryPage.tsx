import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDmDisplayName } from '@/utils/dmIdentity';
import { useNavigate } from 'react-router-dom';
import { api } from '@/services/api';
import { DecisionHistoryRound, CandidateTally } from '@/types';
import { CheckCircle2, Clock, AlertTriangle, Trophy, ChevronLeft } from 'lucide-react';

export const DecisionHistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['decisions', 'history'],
    queryFn: async () => {
      const res = await api.getDecisionsHistory();
      if (res.success && res.data) return res.data;
      throw new Error(res.message || 'Gagal memuat riwayat keputusan');
    },
  });

  /* ─── Loading ─── */
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-navy-800 border-t-gold-accent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Memuat riwayat keputusan...</p>
        </div>
      </div>
    );
  }

  /* ─── Error ─── */
  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-navy-800">Riwayat Voting & Keputusan</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-700 font-medium mb-4">
            {error instanceof Error ? error.message : 'Gagal memuat'}
          </p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-navy-800 text-white rounded-lg text-sm font-medium hover:bg-navy-900 transition"
          >
            Coba Lagi
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const rounds = data.rounds ?? [];
  const finalDecision = data.final_decision;

  const getStatusBadge = (status: string) => {
    if (status === 'completed') {
      return (
        <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-semibold flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" /> Selesai
        </span>
      );
    }
    if (status === 'open') {
      return (
        <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-semibold flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" /> Berlangsung
        </span>
      );
    }
    if (status === 'tie_revote') {
      return (
        <span className="px-2 py-1 bg-amber-100 text-amber-800 rounded text-xs font-semibold flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5" /> Seri
        </span>
      );
    }
    return <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-semibold">{status}</span>;
  };

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-navy-800">Riwayat Voting & Keputusan</h1>
        <p className="text-slate-500 mt-1 text-sm">Histori lengkap semua putaran voting dan keputusan</p>
      </div>

      {/* ── Rounds Timeline ── */}
      <div className="space-y-4">
        {rounds.map((round: DecisionHistoryRound) => {
          const winner =
            round.evaluation.winner &&
            round.evaluation.tallies.find((t: CandidateTally) => t.candidate_id === round.evaluation.winner?.candidate_id);

          return (
            <div key={round.id} className="bg-white rounded-xl shadow border border-slate-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h3 className="font-bold text-navy-800 text-lg">
                      Putaran #{round.round_number}
                      <span className="ml-3 text-sm font-normal text-slate-500">
                        {new Date(round.opened_at).toLocaleDateString('id-ID')}
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Dibuka oleh: {getDmDisplayName(round.opened_by_name)}
                    </p>
                  </div>
                  {getStatusBadge(round.status)}
                </div>
              </div>
              <div className="px-5 py-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase">Status Putaran</p>
                    <p className="font-medium text-slate-800">{round.status}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase">Suara Terkumpul</p>
                    <p className="font-medium text-slate-800">
                      {round.evaluation.total_votes_cast || 0} dari {round.evaluation.total_votes_cast}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase">Waktu Ditutup</p>
                    <p className="font-medium text-slate-800">
                      {round.closed_at
                        ? new Date(round.closed_at).toLocaleString('id-ID')
                        : 'Sedang berlangsung'}
                    </p>
                  </div>
                </div>

                {/* Winner info if completed */}
                {winner && round.status === 'completed' && (
                  <div className="bg-gold-50 border border-gold-200 rounded-lg p-4 mb-3">
                    <div className="flex items-center gap-3">
                      <Trophy className="w-8 h-8 text-gold-600 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-xs font-semibold text-gold-700 uppercase">Pemenang Putaran Ini</p>
                        <p className="text-lg font-bold text-gold-800">{winner.candidate_name}</p>
                        <p className="text-sm text-gold-700">
                          {winner.votes} suara ({winner.percentage.toFixed(2)}%)
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tallies table */}
                <div className="mt-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Perolehan Suara</p>
                  <div className="space-y-2">
                    {round.evaluation.tallies.map((t: CandidateTally) => (
                      <div
                        key={t.candidate_id}
                        className="flex items-center justify-between text-sm border-b border-slate-100 pb-2"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-slate-700 min-w-[120px]">{t.candidate_name}</span>
                          <div className="flex-1 bg-slate-200 h-2 rounded-full overflow-hidden">
                            <div
                              className="bg-navy-600 h-full rounded-full"
                              style={{ width: `${t.percentage}%` }}
                            />
                          </div>
                        </div>
                        <div className="text-right min-w-[80px]">
                          <span className="font-bold text-navy-800">{t.votes}</span>
                          <span className="text-xs text-slate-500"> ({t.percentage.toFixed(1)}%)</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {rounds.length === 0 && (
          <div className="text-center py-8 bg-white rounded-xl border border-slate-100">
            <p className="text-slate-500">Belum ada riwayat voting.</p>
          </div>
        )}
      </div>

      {/* ── Final Decision Summary ── */}
      {finalDecision && (
        <div className="bg-gradient-to-br from-green-600 to-emerald-700 text-white rounded-xl shadow-xl p-6">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide mb-1 text-green-200">
                Keputusan Resmi Terakhir
              </p>
              <h3 className="text-2xl font-bold mb-2">{finalDecision.candidate_name}</h3>
              <div className="flex items-center gap-4 text-sm">
                <span>
                  Suara: <strong>{finalDecision.total_votes}</strong>
                </span>
                <span>
                  Persentase: <strong>{Number(finalDecision.percentage).toFixed(2)}%</strong>
                </span>
              </div>
            </div>
            <div className="text-center">
              <CheckCircle2 className="w-12 h-12 text-white mx-auto mb-2" />
              <p className="text-sm font-medium">
                Disahkan oleh {getDmDisplayName(finalDecision.approved_by_name)}
              </p>
              <p className="text-xs text-green-200">
                {new Date(finalDecision.approved_at).toLocaleDateString('id-ID')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Quick Links ── */}
      <div className="flex gap-3 flex-wrap">
        <button
          onClick={() => navigate('/voting')}
          className="px-4 py-2 bg-white border border-slate-200 text-navy-800 font-medium rounded-lg hover:bg-slate-50 transition text-sm inline-flex items-center gap-1"
        >
          <ChevronLeft className="w-4 h-4" /> Kembali ke Voting
        </button>
        {finalDecision && (
          <button
            onClick={() => navigate('/decisions/final')}
            className="px-4 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 transition text-sm"
          >
            Lihat Keputusan Final
          </button>
        )}
      </div>
    </div>
  );
};
