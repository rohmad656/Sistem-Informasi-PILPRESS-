import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
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
import { AlertTriangle, CheckCircle2, Clock, ClipboardCheck, RefreshCw, LoaderCircle } from 'lucide-react';
import { api, describeApiError, isApiError } from '@/services/api';
import { AssessmentStatusResponse, BordaRankingItem, BordaResponse } from '@/types';
import { useToast } from '@/components/ui/Toast';

const RANK_COLORS: Record<number, string> = {
  1: '#F59E0B',
  2: '#6B7280',
  3: '#92400E',
};

const rankLabel = (rank: number) => `Peringkat ${rank}`;

const DM_NAMES: Record<string, string> = {
  '1': 'Ketua Panel (DM 1)',
  '2': 'Anggota Panel 1 (DM 2)',
  '3': 'Anggota Panel 2 (DM 3)',
};

const roleLabel = (role: string, name: string) => {
  if (role === 'chair') return `Ketua Panel — ${name}`;
  if (role === 'member') return `Anggota Panel — ${name}`;
  return name;
};

interface PanelistProgressProps {
  status: AssessmentStatusResponse | undefined;
  isLoading: boolean;
}

const PanelistProgress: React.FC<PanelistProgressProps> = ({ status, isLoading }) => {
  if (isLoading) {
    return (
      <div className="space-y-2" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  if (!status) {
    return (
      <p className="text-sm text-slate-600">
        Status panelis tidak dapat dimuat saat ini. Gunakan tombol muat ulang untuk mencoba lagi.
      </p>
    );
  }

  const completed = status.panel.filter((p) => p.is_finalized).length;
  const total = status.total_panelists || status.panel.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="font-medium text-slate-700">Progres finalisasi penilaian</span>
          <span className="font-bold text-navy-800">
            {completed} / {total} panelis
          </span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Progres finalisasi penilaian panelis"
        >
          <div
            className={`h-full rounded-full transition-all ${percent === 100 ? 'bg-green-600' : 'bg-gold-accent'}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {status.panel.map((panelist) => (
          <li key={panelist.user_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-navy-800">
                {roleLabel(panelist.role, panelist.name)}
              </p>
              <p className="text-xs text-slate-500">@{panelist.username}</p>
            </div>
            {panelist.is_finalized ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-800">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Sudah difinalisasi
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" /> Draft — belum finalisasi
              </span>
            )}
          </li>
        ))}
      </ul>

      {status.all_finalized && (
        <p className="flex items-start gap-2 text-sm text-green-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          Seluruh panelis sudah memfinalisasi penilaian. Muat ulang untuk menampilkan hasil Borda terbaru.
        </p>
      )}
    </div>
  );
};

export const BordaResultsPage: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const [retryMessage, setRetryMessage] = useState('');

  const bordaQuery = useQuery({
    queryKey: ['results', 'borda'],
    queryFn: async () => {
      const res = await api.getBordaResults();
      if (res.success && res.data) return res.data;
      throw new Error(res.message || 'Gagal memuat hasil Borda');
    },
    staleTime: 1000 * 60 * 3,
    retry: false,
  });

  const statusQuery = useQuery({
    queryKey: ['assessments', 'status'],
    queryFn: async () => {
      const res = await api.getAssessmentStatus();
      if (res.success && res.data) return res.data;
      throw new Error(res.message || 'Gagal memuat status penilaian');
    },
    retry: false,
  });

  const data: BordaResponse | undefined = bordaQuery.data;
  const error = bordaQuery.error;

  /** 409 = prasyarat bisnis (penilaian belum final), bukan kegagalan server. */
  const isPrerequisiteBlocked = isApiError(error) && error.status === 409;
  const isRealError = Boolean(error) && !isPrerequisiteBlocked;
  const isRetrying = bordaQuery.isFetching || statusQuery.isFetching;

  const handleRetry = async () => {
    setRetryMessage('');
    const [bordaResult] = await Promise.all([bordaQuery.refetch(), statusQuery.refetch()]);

    if (bordaResult.data) {
      toast.success('Hasil Borda berhasil dimuat.', 'Seluruh panelis telah memfinalisasi penilaian.');
      return;
    }

    if (isApiError(bordaResult.error) && bordaResult.error.status === 409) {
      const message =
        'Penilaian masih belum lengkap. Seluruh Decision Maker harus memfinalisasi penilaian sebelum hasil Borda dapat dihitung.';
      setRetryMessage(message);
      toast.info('Hasil Borda masih belum tersedia.', message);
      return;
    }

    if (bordaResult.error) {
      const message = describeApiError(bordaResult.error, 'Gagal memuat hasil Borda.');
      setRetryMessage(message);
      toast.error('Gagal memuat hasil Borda.', message);
    }
  };

  /* ─── Loading awal ─── */
  if (bordaQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 rounded bg-slate-200 animate-pulse" />
        <div className="h-4 w-48 rounded bg-slate-100 animate-pulse" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3 rounded-xl bg-white p-6 shadow animate-pulse">
              <div className="h-4 w-20 rounded bg-slate-200" />
              <div className="h-8 w-32 rounded bg-slate-200" />
              <div className="h-3 w-24 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ─── Prasyarat belum terpenuhi (409) ─── */
  if (isPrerequisiteBlocked) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-navy-800">Hasil Agregasi Borda</h1>
          <p className="mt-1 text-sm text-slate-500">
            Peringkat konsensus kelompok berdasarkan agregasi Borda Count dari seluruh pengambil keputusan.
          </p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-6 w-6 flex-shrink-0 text-amber-600" aria-hidden="true" />
            <div>
              <p className="text-lg font-bold text-amber-900">Menunggu Finalisasi Penilaian</p>
              <p className="mt-1 text-sm text-amber-800">
                Hasil Borda belum tersedia karena seluruh Decision Maker harus menyelesaikan dan memfinalisasi
                penilaiannya terlebih dahulu.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-100 bg-white p-6 shadow">
          <div className="mb-4 flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-navy-700" aria-hidden="true" />
            <h2 className="font-bold text-navy-800">Status Panelis</h2>
          </div>
          <PanelistProgress status={statusQuery.data} isLoading={statusQuery.isLoading} />
        </div>

        {retryMessage && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" role="status">
            {retryMessage}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleRetry}
            disabled={isRetrying}
            className="inline-flex items-center gap-2 rounded-lg bg-navy-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRetrying ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> Memuat ulang...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> Coba Lagi
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => navigate('/assessments')}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-navy-800 transition hover:bg-slate-50"
          >
            <ClipboardCheck className="h-4 w-4" aria-hidden="true" /> Buka Halaman Penilaian
          </button>
        </div>
      </div>
    );
  }

  /* ─── Error nyata (jaringan/server) ─── */
  if (isRealError) {
    const msg = describeApiError(error, 'Gagal memuat hasil Borda.');
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-navy-800">Hasil Agregasi Borda</h1>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center" role="alert">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-red-500" aria-hidden="true" />
          <p className="mb-1 font-medium text-red-700">Hasil Borda gagal dimuat.</p>
          <p className="mb-4 text-sm text-red-700">{msg}</p>
          <button
            type="button"
            onClick={handleRetry}
            disabled={isRetrying}
            className="inline-flex items-center gap-2 rounded-lg bg-navy-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRetrying ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> Memuat ulang...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> Coba Lagi
              </>
            )}
          </button>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>Catatan:</strong> Hasil agregasi Borda hanya tersedia setelah{' '}
          <strong>seluruh pengambil keputusan (3 panelis)</strong> menyelesaikan dan memfinalisasi penilaian
          masing-masing.
        </div>
      </div>
    );
  }

  if (!data) return null;

  const rankings: BordaRankingItem[] = [...data.rankings].sort((a, b) => a.rank - b.rank);
  const totalPoints = data.total_points_distributed;

  const chartData = rankings.map((r) => ({
    name: r.candidate_name,
    poin: r.borda_points,
    rank: r.rank,
    persen: r.percentage,
  }));

  const dmKeys = Object.keys(data.dm_breakdown ?? {}).sort();

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-navy-800">Hasil Agregasi Borda</h1>
        <p className="mt-1 text-sm text-slate-500">
          Peringkat konsensus kelompok berdasarkan agregasi Borda Count dari seluruh pengambil keputusan.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          TOPSIS digunakan untuk menentukan ranking alternatif berdasarkan penilaian multikriteria dari setiap Decision Maker.
          Hasil ranking masing-masing Decision Maker kemudian diagregasikan menggunakan metode Borda.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
          <span>
            Total Poin Terdistribusi: <strong className="text-navy-800">{totalPoints} poin</strong>
          </span>
          <span>·</span>
          <span>
            Panel: <strong className="text-navy-800">{dmKeys.length} Pengambil Keputusan</strong>
          </span>
        </div>
      </div>

      {/* ── Leaderboard Cards ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {rankings.map((r) => (
          <div
            key={r.candidate_id}
            className={`flex flex-col gap-2 rounded-xl border bg-white p-5 shadow ${
              r.rank === 1 ? 'border-gold-accent ring-2 ring-gold-accent ring-opacity-30' : 'border-slate-100'
            }`}
          >
            <div className="flex items-start justify-between">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{rankLabel(r.rank)}</span>
              {r.rank === 1 && (
                <span className="rounded-full bg-gold-accent px-2 py-1 text-xs font-bold text-navy-800">
                  Konsensus Teratas
                </span>
              )}
            </div>
            <p className="text-lg font-bold leading-tight text-navy-800">{r.candidate_name}</p>
            <div className="flex items-baseline gap-2">
              <p className="text-3xl font-extrabold text-navy-800">{r.borda_points}</p>
              <span className="text-xs font-medium text-slate-400">poin</span>
              <span className="ml-auto font-mono text-sm font-bold text-amber-600">{r.percentage.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${r.rank === 1 ? 'bg-gold-accent' : 'bg-slate-400'}`}
                style={{ width: `${Math.min(r.percentage, 100)}%` }}
              />
            </div>
            <div className="mt-auto text-xs text-slate-400">
              Peringkat {r.rank} · Nilai: {r.borda_value.toFixed(4)}
            </div>
          </div>
        ))}
      </div>

      {/* ── Ranking Table ── */}
      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-bold text-navy-800">Tabel Peringkat Borda</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left">
                <th className="px-5 py-3 font-semibold text-slate-600">Peringkat</th>
                <th className="px-5 py-3 font-semibold text-slate-600">Kandidat</th>
                <th className="px-5 py-3 text-right font-semibold text-slate-600">Poin Borda</th>
                <th className="px-5 py-3 text-right font-semibold text-slate-600">Nilai Borda</th>
                <th className="px-5 py-3 text-right font-semibold text-slate-600">Persentase</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map((r) => (
                <tr
                  key={r.candidate_id}
                  className={`border-b border-slate-100 ${r.rank === 1 ? 'bg-amber-50' : 'hover:bg-slate-50'}`}
                >
                  <td className="px-5 py-3 font-bold text-navy-800">{rankLabel(r.rank)}</td>
                  <td className="px-5 py-3 font-medium text-slate-800">{r.candidate_name}</td>
                  <td className="px-5 py-3 text-right font-mono font-bold text-navy-800">{r.borda_points}</td>
                  <td className="px-5 py-3 text-right font-mono text-slate-600">{r.borda_value.toFixed(4)}</td>
                  <td className="px-5 py-3 text-right font-mono font-bold text-navy-800">
                    {r.percentage.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Chart ── */}
      <div className="rounded-xl border border-slate-100 bg-white p-6 shadow">
        <h2 className="mb-4 font-bold text-navy-800">Visualisasi Poin Borda</h2>
        <div className="w-full" style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 48, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
              <XAxis
                type="number"
                domain={[0, totalPoints]}
                tick={{ fontSize: 11, fill: '#6B7280' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 12, fill: '#1A2332', fontWeight: 600 }}
                width={100}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(value: number) => [`${value} poin`, 'Poin Borda']}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Bar dataKey="poin" radius={[0, 4, 4, 0]} maxBarSize={36}>
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={RANK_COLORS[entry.rank] ?? '#1A2332'} />
                ))}
                <LabelList
                  dataKey="poin"
                  position="right"
                  formatter={(v: number) => `${v} poin`}
                  style={{ fontSize: 11, fill: '#374151', fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-3 text-center text-xs text-slate-400">Maksimal: {totalPoints} poin · Sumber: API Borda</p>
      </div>

      {/* ── DM Breakdown Matrix ── */}
      {dmKeys.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-bold text-navy-800">Matriks Kontribusi Pengambil Keputusan</h2>
            <p className="mt-1 text-xs text-slate-500">
              Nilai preferensi TOPSIS, posisi peringkat, dan poin Borda yang disumbangkan tiap DM
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="px-4 py-2 font-semibold text-slate-600">Kandidat</th>
                  {dmKeys.map((dmKey) => (
                    <th key={dmKey} className="px-4 py-2 text-center font-semibold text-slate-600" colSpan={3}>
                      {DM_NAMES[dmKey] ?? `DM ${dmKey}`}
                    </th>
                  ))}
                  <th className="px-4 py-2 text-right font-semibold text-slate-600">Total Poin</th>
                </tr>
                <tr className="border-b border-slate-200 bg-slate-100/60 text-[11px] text-slate-500">
                  <th className="px-4 py-1" />
                  {dmKeys.map((dmKey) => (
                    <React.Fragment key={dmKey}>
                      <th className="px-2 py-1 text-right font-normal">Skor</th>
                      <th className="px-2 py-1 text-center font-normal">Pos</th>
                      <th className="px-2 py-1 text-right font-normal">Poin</th>
                    </React.Fragment>
                  ))}
                  <th className="px-4 py-1" />
                </tr>
              </thead>
              <tbody>
                {rankings.map((r) => (
                  <tr
                    key={r.candidate_id}
                    className={`border-b border-slate-100 hover:bg-slate-50 ${
                      r.rank === 1 ? 'bg-amber-50/50' : ''
                    }`}
                  >
                    <td className="px-4 py-3 font-semibold text-navy-800">{r.candidate_name}</td>
                    {dmKeys.map((dmKey) => {
                      const dmCandidateData = data.dm_breakdown?.[dmKey]?.[String(r.candidate_id)];
                      if (!dmCandidateData) {
                        return (
                          <React.Fragment key={dmKey}>
                            <td className="px-2 py-3 text-right text-slate-400">-</td>
                            <td className="px-2 py-3 text-center text-slate-400">-</td>
                            <td className="px-2 py-3 text-right text-slate-400">-</td>
                          </React.Fragment>
                        );
                      }
                      return (
                        <React.Fragment key={dmKey}>
                          <td className="px-2 py-3 text-right font-mono text-slate-700">
                            {dmCandidateData.score.toFixed(6)}
                          </td>
                          <td className="px-2 py-3 text-center text-slate-600">#{dmCandidateData.rank_position}</td>
                          <td className="px-2 py-3 text-right font-bold text-navy-800">+{dmCandidateData.points}</td>
                        </React.Fragment>
                      );
                    })}
                    <td className="px-4 py-3 text-right font-mono text-sm font-extrabold text-navy-800">
                      {r.borda_points}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Explanation ── */}
      <div className="space-y-4 rounded-xl border border-navy-200 bg-navy-50 p-6">
        <h2 className="font-bold text-navy-800">Penjelasan Metode Borda Count</h2>
        <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
          <div className="space-y-3">
            <div className="rounded-lg border border-navy-100 bg-white p-4">
              <p className="mb-1 font-semibold text-navy-700">1. Konversi Peringkat ke Poin</p>
              <p className="text-xs text-slate-600">
                Untuk m kandidat: Peringkat 1 mendapat m poin, peringkat 2 mendapat m-1 poin, dan peringkat
                terakhir mendapat 1 poin. (Dengan 3 kandidat: Pos 1 = 3 poin, Pos 2 = 2 poin, Pos 3 = 1 poin).
              </p>
            </div>
            <div className="rounded-lg border border-navy-100 bg-white p-4">
              <p className="mb-1 font-semibold text-navy-700">2. Penanganan Posisi Seri (Tie)</p>
              <p className="text-xs text-slate-600">
                Kandidat dengan nilai preferensi TOPSIS yang sama membagi rata poin dari posisi yang diperebutkan
                (average point sharing rule).
              </p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-lg border border-navy-100 bg-white p-4">
              <p className="mb-1 font-semibold text-navy-700">3. Agregasi Poin Kelompok</p>
              <p className="font-mono text-sm text-navy-800">Total Poin = Σ (Poin dari tiap DM)</p>
              <p className="mt-1 text-xs text-slate-600">
                Kandidat dengan akumulasi poin Borda terbanyak menempati peringkat konsensus teratas.
              </p>
            </div>
            <div className="rounded-lg border border-navy-100 bg-white p-4">
              <p className="mb-1 font-semibold text-navy-700">4. Nilai & Persentase Borda</p>
              <p className="font-mono text-sm text-navy-800">Nilai Borda = Poin / Total Poin Terdistribusi</p>
              <p className="mt-1 text-xs text-slate-600">
                Merepresentasikan pangsa preferensi konsensus kelompok.
              </p>
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Metode Borda mengakomodasi preferensi seluruh panel tanpa mereduksi hasil menjadi rata-rata aritmatika
          sederhana. Seluruh perhitungan dilakukan oleh backend PHP.
        </p>
      </div>
    </div>
  );
};
