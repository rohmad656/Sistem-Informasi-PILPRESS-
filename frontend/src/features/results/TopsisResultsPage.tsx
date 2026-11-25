import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
  Cell,
} from 'recharts';
import { api, describeApiError, isApiError } from '@/services/api';
import { useAuth } from '@/features/auth/AuthContext';
import { getDmDisplayName } from '@/utils/dmIdentity';
import { TopsisRankingItem, TopsisCriterionBreakdown } from '@/types';

const RANK_COLORS: Record<number, string> = {
  1: '#F59E0B',
  2: '#6B7280',
  3: '#92400E',
};

const rankLabel = (rank: number) => `Peringkat ${rank}`;

/** Format tampilan enam angka desimal sesuai konvensi skor preferensi TOPSIS. */
const formatScore = (value: number) => value.toFixed(6);

export const TopsisResultsPage: React.FC = () => {
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['results', 'topsis'],
    queryFn: async () => {
      const res = await api.getTopsisResults();
      if (res.success && res.data) return res.data;
      throw new Error(res.message || 'Gagal memuat hasil TOPSIS');
    },
    staleTime: 1000 * 60 * 3,
    retry: false,
  });

  /* ─── Loading ─── */
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-slate-200 rounded animate-pulse" />
        <div className="h-4 w-48 bg-slate-100 rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow p-6 animate-pulse space-y-3">
              <div className="h-4 w-20 bg-slate-200 rounded" />
              <div className="h-8 w-32 bg-slate-200 rounded" />
              <div className="h-3 w-24 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ─── Error (termasuk 409 prasyarat) ─── */
  if (error) {
    const msg = isApiError(error)
      ? describeApiError(error, 'Gagal memuat hasil TOPSIS')
      : error instanceof Error
        ? error.message
        : 'Gagal memuat hasil TOPSIS';
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-navy-800">Hasil Perhitungan TOPSIS</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center" role="alert">
          <p className="text-red-700 font-medium mb-4">{msg}</p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-navy-800 text-white rounded-lg text-sm font-medium hover:bg-navy-900 transition"
          >
            Coba Lagi
          </button>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          <strong>Catatan:</strong> Hasil TOPSIS hanya tersedia setelah Anda menyelesaikan dan memfinalisasi penilaian.
        </div>
      </div>
    );
  }

  if (!data) return null;

  const rankings: TopsisRankingItem[] = [...data.rankings].sort((a, b) => a.rank - b.rank);

  /* data grafik: skala 0–1 sesuai rentang nilai preferensi TOPSIS */
  const chartData = rankings.map((r) => ({
    name: r.candidate_name,
    nilai: r.final_score,
    rank: r.rank,
  }));
  const maxScore = Math.max(1, ...rankings.map((r) => r.final_score));

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-navy-800">Hasil Perhitungan TOPSIS</h1>
        <p className="text-slate-500 mt-1 text-sm">
          Nilai preferensi alternatif berdasarkan metode TOPSIS (Technique for Order of Preference by Similarity to Ideal Solution).
        </p>
        <div className="flex items-center gap-2 mt-2 text-sm text-slate-500">
          <span className="font-medium text-navy-700">{getDmDisplayName(data.dm_name)}</span>
          <span>·</span>
          <span className="capitalize">{user?.role === 'chair' ? 'Ketua Panel' : 'Anggota Panel'}</span>
        </div>
      </div>

      {/* ── Rank Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {rankings.map((r) => (
          <div
            key={r.candidate_id}
            className={`bg-white rounded-xl shadow border p-5 flex flex-col gap-2 ${
              r.rank === 1
                ? 'border-gold-accent ring-2 ring-gold-accent ring-opacity-30'
                : 'border-slate-100'
            }`}
          >
            <div className="flex items-start justify-between">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{rankLabel(r.rank)}</span>
              {r.rank === 1 && (
                <span className="px-2 py-1 bg-gold-accent text-navy-800 text-xs font-bold rounded-full">
                  Terbaik
                </span>
              )}
            </div>
            <p className="font-bold text-navy-800 text-lg leading-tight">{r.candidate_name}</p>
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide">Nilai Preferensi</p>
              <p className="text-3xl font-extrabold text-navy-800">{formatScore(r.final_score)}</p>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${r.rank === 1 ? 'bg-gold-accent' : 'bg-slate-400'}`}
                style={{ width: `${Math.min(Math.max(r.final_score, 0), 1) * 100}%` }}
              />
            </div>
            <div className="mt-auto text-xs text-slate-400">
              D+ {formatScore(r.d_plus)} · D− {formatScore(r.d_minus)}
            </div>
          </div>
        ))}
      </div>

      {/* ── Ranking Table ── */}
      <div className="bg-white rounded-xl shadow border border-slate-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="font-bold text-navy-800">Ranking Alternatif — Nilai Preferensi TOPSIS</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left">
                <th className="px-5 py-3 font-semibold text-slate-600">Peringkat</th>
                <th className="px-5 py-3 font-semibold text-slate-600">Kandidat</th>
                <th className="px-5 py-3 font-semibold text-slate-600 text-right">Nilai Preferensi</th>
                <th className="px-5 py-3 font-semibold text-slate-600 text-right">D+</th>
                <th className="px-5 py-3 font-semibold text-slate-600 text-right">D−</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map((r) => (
                <tr key={r.candidate_id} className={`border-b border-slate-100 ${r.rank === 1 ? 'bg-amber-50' : 'hover:bg-slate-50'}`}>
                  <td className="px-5 py-3 font-bold text-navy-800">{rankLabel(r.rank)}</td>
                  <td className="px-5 py-3 text-slate-800 font-medium">{r.candidate_name}</td>
                  <td className="px-5 py-3 text-right font-bold text-navy-800 font-mono">{formatScore(r.final_score)}</td>
                  <td className="px-5 py-3 text-right font-mono text-slate-600">{formatScore(r.d_plus)}</td>
                  <td className="px-5 py-3 text-right font-mono text-slate-600">{formatScore(r.d_minus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Chart ── */}
      <div className="bg-white rounded-xl shadow border border-slate-100 p-6">
        <h2 className="font-bold text-navy-800 mb-4">Visualisasi Nilai Preferensi TOPSIS</h2>
        <div className="w-full" style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 72, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
              <XAxis type="number" domain={[0, maxScore]} tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#1A2332', fontWeight: 600 }} width={100} tickLine={false} axisLine={false} />
              <Tooltip
                formatter={(value: number) => [formatScore(value), 'Nilai Preferensi']}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Bar dataKey="nilai" radius={[0, 4, 4, 0]} maxBarSize={36}>
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={RANK_COLORS[entry.rank] ?? '#1A2332'} />
                ))}
                <LabelList dataKey="nilai" position="right" formatter={(v: number) => formatScore(v)} style={{ fontSize: 11, fill: '#374151', fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-slate-400 text-center mt-3">Skala: 0 – 1 · Nilai dari API backend (bukan persentase voting)</p>
      </div>

      {/* ── Breakdown Detail ── */}
      <div className="bg-white rounded-xl shadow border border-slate-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="font-bold text-navy-800">Rincian Perhitungan per Kandidat</h2>
          <p className="text-xs text-slate-500 mt-1">
            Skor mentah → normalisasi vektor → matriks terbobot → jarak ke solusi ideal
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left">
                <th className="px-4 py-2 font-semibold text-slate-600">Kandidat</th>
                <th className="px-4 py-2 font-semibold text-slate-600">Kriteria</th>
                <th className="px-4 py-2 font-semibold text-slate-600 text-right">Skor</th>
                <th className="px-4 py-2 font-semibold text-slate-600 text-right">Normalisasi</th>
                <th className="px-4 py-2 font-semibold text-slate-600 text-right">Bobot</th>
                <th className="px-4 py-2 font-semibold text-slate-600 text-right">Yij</th>
                <th className="px-4 py-2 font-semibold text-slate-600 text-right">A+</th>
                <th className="px-4 py-2 font-semibold text-slate-600 text-right">A−</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map((r) => {
                const breakdownEntries = Object.values(r.breakdown ?? {}) as TopsisCriterionBreakdown[];
                return breakdownEntries.map((bd, idx) => (
                  <tr key={`${r.candidate_id}-${bd.criterion_id}`} className={`border-b border-slate-100 hover:bg-slate-50 ${r.rank === 1 ? 'bg-amber-50/40' : ''}`}>
                    {idx === 0 && (
                      <td className="px-4 py-2 font-semibold text-navy-800 align-top" rowSpan={breakdownEntries.length}>
                        {r.candidate_name}
                        <div className="text-xs text-slate-400 font-normal">Ci = {formatScore(r.final_score)}</div>
                      </td>
                    )}
                    <td className="px-4 py-2 font-mono text-navy-700">{bd.code}</td>
                    <td className="px-4 py-2 text-right text-slate-700">{bd.raw_score}</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-700">{bd.normalized.toFixed(6)}</td>
                    <td className="px-4 py-2 text-right text-slate-700">{bd.weight}%</td>
                    <td className="px-4 py-2 text-right font-bold text-navy-800">{bd.weighted_normalized.toFixed(6)}</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-700">{bd.ideal_positive.toFixed(6)}</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-700">{bd.ideal_negative.toFixed(6)}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Explanation ── */}
      <div className="bg-navy-50 border border-navy-200 rounded-xl p-6 space-y-4">
        <h2 className="font-bold text-navy-800">Penjelasan Metode TOPSIS</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="space-y-3">
            <div className="bg-white rounded-lg p-4 border border-navy-100">
              <p className="font-semibold text-navy-700 mb-1">1. Normalisasi Vektor</p>
              <p className="font-mono text-navy-800 text-base">Rij = Xij / √(Σ Xij²)</p>
              <p className="text-slate-500 text-xs mt-1">Skor mentah dibagi akar jumlah kuadrat pada kriteria yang sama.</p>
            </div>
            <div className="bg-white rounded-lg p-4 border border-navy-100">
              <p className="font-semibold text-navy-700 mb-1">2. Matriks Ternormalisasi Terbobot</p>
              <p className="font-mono text-navy-800 text-base">Yij = Wj × Rij</p>
              <p className="text-slate-500 text-xs mt-1">Bobot kriteria (Wj) dinormalisasi terhadap total 100.</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="bg-white rounded-lg p-4 border border-navy-100">
              <p className="font-semibold text-navy-700 mb-1">3. Solusi Ideal & Jarak</p>
              <p className="font-mono text-navy-800 text-xs">A+ = max/min Yij · A− = min/max Yij</p>
              <p className="font-mono text-navy-800 text-xs">D+ = √(Σ(Yij − A+)²) · D− = √(Σ(Yij − A−)²)</p>
              <p className="text-slate-500 text-xs mt-1">Kriteria benefit mencari nilai maksimum; cost mencari minimum.</p>
            </div>
            <div className="bg-white rounded-lg p-4 border border-navy-100">
              <p className="font-semibold text-navy-700 mb-1">4. Nilai Preferensi</p>
              <p className="font-mono text-navy-800 text-base">Ci = D− / (D+ + D−)</p>
              <p className="text-slate-500 text-xs mt-1">Rentang 0–1. Semakin mendekati 1, semakin baik alternatifnya.</p>
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Solusi Ideal Positif (A+) dan Solusi Ideal Negatif (A−) ditentukan backend per kriteria. Seluruh nilai di halaman ini
          dihitung oleh backend PHP dan ditampilkan apa adanya; frontend tidak melakukan perhitungan ulang.
        </p>
      </div>
    </div>
  );
};
