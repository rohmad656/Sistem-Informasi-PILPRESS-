import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Trophy,
  FileText,
  Home,
  CheckCircle2,
  ChevronLeft,
  AlertTriangle,
  Clock,
  LoaderCircle,
  RefreshCw,
  Lock,
  Vote,
  ClipboardCheck,
  ShieldCheck,
  Printer,
} from 'lucide-react';
import { api, describeApiError, isApiError } from '@/services/api';
import { useAuth } from '@/features/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import type {
  VotingStatusResponse,
  Candidate,
  TopsisResponse,
  BordaResponse,
  ElectionDetail,
  ElectorateVoterStatus,
  VotingEvaluation,
  RatifiedDecision,
  Criterion,
} from '@/types';
import { ElectorateMonitor } from '@/components/ElectorateMonitor';

type StageState = 'done' | 'active' | 'pending';

interface TimelineStage {
  key: string;
  label: string;
  description: string;
  state: StageState;
}

interface DecisionStateView {
  key: string;
  label: string;
  tone: 'neutral' | 'info' | 'warning' | 'success';
  description: string;
}

const TONE_STYLES: Record<DecisionStateView['tone'], { badge: string; panel: string; icon: string }> = {
  neutral: {
    badge: 'bg-slate-100 text-slate-700',
    panel: 'border-slate-200 bg-slate-50 text-slate-800',
    icon: 'text-slate-500',
  },
  info: {
    badge: 'bg-blue-100 text-blue-800',
    panel: 'border-blue-200 bg-blue-50 text-blue-900',
    icon: 'text-blue-600',
  },
  warning: {
    badge: 'bg-amber-100 text-amber-800',
    panel: 'border-amber-200 bg-amber-50 text-amber-900',
    icon: 'text-amber-600',
  },
  success: {
    badge: 'bg-green-100 text-green-800',
    panel: 'border-green-200 bg-green-50 text-green-900',
    icon: 'text-green-600',
  },
};

/** Petakan status sesi dari backend ke label & penjelasan berbahasa Indonesia. */
function describeDecisionState(status: VotingStatusResponse | undefined): DecisionStateView {
  if (!status) {
    return {
      key: 'unknown',
      label: 'Memuat Status Keputusan',
      tone: 'neutral',
      description: 'Status proses pemilihan sedang dimuat dari server.',
    };
  }

  const { session_status, is_voting_open, votes_cast_in_round, eligible_voters, can_chair_approve } =
    status;

  if (session_status === 'ratified') {
    return {
      key: 'ratified',
      label: 'Keputusan Telah Disahkan',
      tone: 'success',
      description: 'Keputusan final telah disahkan oleh Ketua Panel dan berlaku sebagai hasil resmi pemilihan.',
    };
  }

  if (session_status === 'tie_revote') {
    return {
      key: 'tie_revote',
      label: 'Hasil Voting Seri — Menunggu Putaran Berikutnya',
      tone: 'warning',
      description:
        'Hasil voting tidak menghasilkan mayoritas. Ketua Panel perlu membuka putaran voting ulang agar konsensus dapat tercapai.',
    };
  }

  if (session_status === 'voting_completed') {
    if (can_chair_approve) {
      return {
        key: 'awaiting_approval',
        label: 'Menunggu Pengesahan Ketua Panel',
        tone: 'warning',
        description:
          'Voting telah selesai dengan hasil mayoritas. Ketua Panel perlu memeriksa dan mengesahkan keputusan sebelum diumumkan sebagai hasil final.',
      };
    }
    return {
      key: 'voting_completed',
      label: 'Hasil Voting Selesai',
      tone: 'info',
      description:
        'Seluruh suara telah masuk dan hasil voting sudah selesai. Keputusan final belum disahkan sehingga belum dapat diumumkan sebagai pemenang.',
    };
  }

  if (session_status === 'voting' && is_voting_open) {
    const remaining = Math.max(eligible_voters - votes_cast_in_round, 0);
    if (votes_cast_in_round === 0) {
      return {
        key: 'voting_open',
        label: 'Voting Sedang Berlangsung',
        tone: 'info',
        description: `Sesi voting telah dibuka. Belum ada suara yang masuk dari ${eligible_voters} pemilih terdaftar.`,
      };
    }
    return {
      key: 'voting_collecting',
      label: 'Menunggu Suara Panelis',
      tone: 'info',
      description: `Voting sedang berlangsung. ${votes_cast_in_round} dari ${eligible_voters} suara telah masuk, tersisa ${remaining} suara.`,
    };
  }

  return {
    key: 'not_opened',
    label: 'Voting Belum Dibuka',
    tone: 'neutral',
    description:
      'Sesi voting belum dibuka. Seluruh Decision Maker harus menyelesaikan dan memfinalisasi penilaian sebelum voting dapat dimulai.',
  };
}

/** Tandai tahap proses berdasarkan status nyata dari backend. */
function buildTimeline(status: VotingStatusResponse | undefined): TimelineStage[] {
  const stages: TimelineStage[] = [
    { key: 'assessment', label: 'Finalisasi Penilaian', description: 'Seluruh panelis memfinalisasi penilaian.', state: 'pending' },
    { key: 'open', label: 'Pembukaan Voting', description: 'Ketua Panel membuka sesi voting.', state: 'pending' },
    { key: 'collect', label: 'Pengumpulan Suara', description: 'Pemilih terdaftar memberikan suara.', state: 'pending' },
    { key: 'check', label: 'Pemeriksaan Hasil', description: 'Backend memeriksa mayoritas dan hasil seri.', state: 'pending' },
    { key: 'approve', label: 'Pengesahan Ketua Panel', description: 'Ketua Panel mengesahkan hasil voting.', state: 'pending' },
    { key: 'final', label: 'Keputusan Final', description: 'Keputusan resmi diumumkan.', state: 'pending' },
  ];

  if (!status) return stages;

  const { session_status, is_voting_open } = status;

  if (session_status === 'assessment') {
    stages[0].state = 'active';
    return stages;
  }

  // Penilaian sudah final pada semua status setelah 'assessment'.
  stages[0].state = 'done';
  stages[1].state = 'done';

  if (session_status === 'voting' && is_voting_open) {
    stages[2].state = 'active';
    return stages;
  }

  if (session_status === 'tie_revote') {
    stages[2].state = 'done';
    stages[3].state = 'active';
    return stages;
  }

  if (session_status === 'voting_completed') {
    stages[2].state = 'done';
    stages[3].state = 'done';
    stages[4].state = 'active';
    return stages;
  }

  if (session_status === 'ratified') {
    stages[2].state = 'done';
    stages[3].state = 'done';
    stages[4].state = 'done';
    stages[5].state = 'done';
  }

  return stages;
}

const StageIcon: React.FC<{ state: StageState }> = ({ state }) => {
  if (state === 'done') return <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />;
  if (state === 'active') return <Clock className="h-4 w-4 text-amber-600" aria-hidden="true" />;
  return <span className="h-2 w-2 rounded-full bg-slate-300" aria-hidden="true" />;
};

const formatReportDate = (value: string): string => {
  try {
    return new Date(value.replace(' ', 'T')).toLocaleString('id-ID', {
      dateStyle: 'long',
      timeStyle: 'short',
    });
  } catch {
    return value;
  }
};

interface OfficialReportProps {
  decision: RatifiedDecision;
  election: ElectionDetail | null;
  criteria: Criterion[];
  candidates: Candidate[];
  topsis: TopsisResponse | null;
  borda: BordaResponse | null;
  electorate: ElectorateVoterStatus[];
  evaluation: VotingEvaluation | null;
  statusLabel: string;
}

const PANEL_PLACEHOLDER = 'Nama panelis — diisi resmi';

const OfficialDecisionReport: React.FC<OfficialReportProps> = ({
  decision,
  election,
  criteria,
  candidates,
  topsis,
  borda,
  electorate,
  evaluation,
  statusLabel,
}) => {
  const printedAt = new Date();
  const electorateByUsername = (username: string) => electorate.find((v) => v.username === username)?.name ?? null;
  const panelists = [
    {
      username: 'dm1',
      role: 'Ketua Panel (DM1)',
      name: electorateByUsername('dm1') ?? decision.approved_by_name ?? PANEL_PLACEHOLDER,
    },
    {
      username: 'dm2',
      role: 'Anggota Panel (DM2)',
      name: electorateByUsername('dm2') ?? PANEL_PLACEHOLDER,
    },
    {
      username: 'dm3',
      role: 'Anggota Panel (DM3)',
      name: electorateByUsername('dm3') ?? PANEL_PLACEHOLDER,
    },
  ];

  return (
    <section
      className="official-report mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow sm:p-10"
      data-testid="official-decision-report"
      aria-label="Berita Acara Keputusan Resmi"
    >
      <div className="report-header border-b-2 border-navy-800 pb-5 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-navy-700">PILPRESS</p>
        <p className="mt-1 text-xs text-slate-500">
          Sistem Pendukung Keputusan Kelompok — Pemilihan Calon Presiden
        </p>
        <h2 className="mt-4 text-xl font-extrabold uppercase tracking-wide text-navy-800 sm:text-2xl">
          Berita Acara Keputusan Resmi
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Dokumen ini merupakan catatan resmi hasil pemilihan yang disahkan oleh panel Decision Maker.
        </p>
      </div>

      {/* 1. Identitas Dokumen */}
      <section className="report-section mt-6">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-navy-800">1. Identitas Dokumen</h3>
        <table className="report-meta w-full text-sm">
          <tbody>
            <tr>
              <th scope="row" className="w-48 py-1.5 text-left font-semibold text-slate-600">Nama Siklus</th>
              <td className="py-1.5 font-medium text-navy-800">
                {election?.session.title ?? `Siklus Pemilihan #${decision.session_id}`}
              </td>
            </tr>
            <tr>
              <th scope="row" className="py-1.5 text-left font-semibold text-slate-600">ID Sesi</th>
              <td className="py-1.5 font-mono text-navy-800">#{decision.session_id}</td>
            </tr>
            <tr>
              <th scope="row" className="py-1.5 text-left font-semibold text-slate-600">Tanggal Cetak</th>
              <td className="py-1.5 text-slate-600">
                {printedAt.toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' })}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* 2. Deskripsi Siklus */}
      <section className="report-section mt-5">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-navy-800">2. Deskripsi Siklus</h3>
        <p className="text-sm text-slate-700">
          {election?.session.description || 'Deskripsi siklus tidak tersedia pada data sesi ini.'}
        </p>
      </section>

      {/* 3. Dasar Pengambilan Keputusan */}
      <section className="report-section mt-5">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-navy-800">3. Dasar Pengambilan Keputusan</h3>
        <p className="text-sm leading-relaxed text-slate-700">
          Keputusan disahkan melalui tahapan penilaian kriteria, agregasi preferensi panel, pemungutan
          suara, dan pengesahan oleh Ketua Panel. Data historis tidak menyimpan metadata metode
          perhitungan yang digunakan pada saat pengesahan, sehingga berita acara ini tidak menyatakan
          secara definitif metodologi asli keputusan tersebut. Bagian 8 dan 9 menampilkan hasil
          perhitungan terkini — TOPSIS untuk penilaian multikriteria dan Borda untuk agregasi ranking —
          sebagai informasi tambahan, bukan sebagai dasar asli pengesahan. Angka voting dan keputusan
          final bersumber dari data resmi yang tersimpan; tidak ada nilai yang direkayasa saat pencetakan.
        </p>
      </section>

      {/* 4. Waktu & Status Pengesahan */}
      <section className="report-section mt-5">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-navy-800">4. Waktu &amp; Status Pengesahan</h3>
        <table className="report-meta w-full text-sm">
          <tbody>
            <tr>
              <th scope="row" className="w-48 py-1.5 text-left font-semibold text-slate-600">Tanggal Keputusan</th>
              <td className="py-1.5 text-navy-800">{formatReportDate(decision.approved_at)}</td>
            </tr>
            <tr>
              <th scope="row" className="py-1.5 text-left font-semibold text-slate-600">Status Keputusan</th>
              <td className="py-1.5 text-navy-800">{statusLabel}</td>
            </tr>
            <tr>
              <th scope="row" className="py-1.5 text-left font-semibold text-slate-600">Putaran Pengesahan</th>
              <td className="py-1.5 text-navy-800">#{decision.round_number ?? decision.round_id}</td>
            </tr>
            <tr>
              <th scope="row" className="py-1.5 text-left font-semibold text-slate-600">Disahkan Oleh</th>
              <td className="py-1.5 text-navy-800">{decision.approved_by_name}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* 5. Susunan Panel Decision Maker */}
      <section className="report-section mt-5">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-navy-800">5. Susunan Panel Decision Maker</h3>
        <ul className="list-inside list-decimal space-y-1 text-sm text-slate-700">
          {panelists.map((panelist) => (
            <li key={panelist.username}>
              <span className="font-medium">{panelist.name}</span> — {panelist.role}
            </li>
          ))}
        </ul>
      </section>

      {/* 6. Daftar Kriteria Penilaian */}
      <section className="report-section mt-5">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-navy-800">6. Daftar Kriteria Penilaian</h3>
        {criteria.length === 0 ? (
          <p className="text-sm text-slate-500">Data kriteria tidak tersedia pada sesi ini.</p>
        ) : (
          <table className="report-table w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className="border border-slate-300 px-3 py-2">Kode</th>
                <th className="border border-slate-300 px-3 py-2">Nama Kriteria</th>
                <th className="border border-slate-300 px-3 py-2 text-right">Bobot</th>
                <th className="border border-slate-300 px-3 py-2">Jenis</th>
              </tr>
            </thead>
            <tbody>
              {criteria.map((criterion) => (
                <tr key={criterion.id}>
                  <td className="border border-slate-300 px-3 py-2 font-mono">{criterion.code}</td>
                  <td className="border border-slate-300 px-3 py-2">{criterion.name}</td>
                  <td className="border border-slate-300 px-3 py-2 text-right font-mono">
                    {Number(criterion.weight).toFixed(2)}
                  </td>
                  <td className="border border-slate-300 px-3 py-2">{criterion.type === 'cost' ? 'Biaya' : 'Keuntungan'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 7. Daftar Kandidat */}
      <section className="report-section mt-6">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-navy-800">7. Daftar Kandidat</h3>
        {candidates.length === 0 ? (
          <p className="text-sm text-slate-500">Data kandidat tidak tersedia pada sesi ini.</p>
        ) : (
          <table className="report-table w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className="border border-slate-300 px-3 py-2">No</th>
                <th className="border border-slate-300 px-3 py-2">Nama Kandidat</th>
                <th className="border border-slate-300 px-3 py-2">Visi</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate, index) => (
                <tr key={candidate.id}>
                  <td className="border border-slate-300 px-3 py-2">{index + 1}</td>
                  <td className="border border-slate-300 px-3 py-2 font-medium">{candidate.name}</td>
                  <td className="border border-slate-300 px-3 py-2">{candidate.vision ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 8. Hasil Penilaian TOPSIS */}
      <section className="report-section mt-6">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-navy-800">
          8. Hasil Penilaian TOPSIS{topsis ? ` — Penilaian ${topsis.dm_name}` : ''}
        </h3>
        <p className="mb-2 text-xs italic text-slate-500">
          Catatan metodologi: hasil TOPSIS di bawah dihitung ulang dengan metodologi terkini untuk
          keperluan tampilan. Angka ini bukan bukti bahwa keputusan historis disahkan berdasarkan TOPSIS.
        </p>
        {!topsis || topsis.rankings.length === 0 ? (
          <p className="text-sm text-slate-500">Data hasil TOPSIS tidak tersedia.</p>
        ) : (
          <table className="report-table w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className="border border-slate-300 px-3 py-2">Peringkat</th>
                <th className="border border-slate-300 px-3 py-2">Kandidat</th>
                <th className="border border-slate-300 px-3 py-2 text-right">Nilai Preferensi</th>
              </tr>
            </thead>
            <tbody>
              {topsis.rankings.map((row) => (
                <tr key={row.candidate_id}>
                  <td className="border border-slate-300 px-3 py-2">{row.rank}</td>
                  <td className="border border-slate-300 px-3 py-2">{row.candidate_name}</td>
                  <td className="border border-slate-300 px-3 py-2 text-right font-mono">{row.final_score.toFixed(6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 9. Hasil Penilaian Borda */}
      <section className="report-section mt-6">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-navy-800">9. Hasil Penilaian Borda</h3>
        {!borda || borda.rankings.length === 0 ? (
          <p className="text-sm text-slate-500">Data hasil Borda tidak tersedia.</p>
        ) : (
          <table className="report-table w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className="border border-slate-300 px-3 py-2">Peringkat</th>
                <th className="border border-slate-300 px-3 py-2">Kandidat</th>
                <th className="border border-slate-300 px-3 py-2 text-right">Poin</th>
                <th className="border border-slate-300 px-3 py-2 text-right">Persentase</th>
              </tr>
            </thead>
            <tbody>
              {borda.rankings.map((row) => (
                <tr key={row.candidate_id}>
                  <td className="border border-slate-300 px-3 py-2">{row.rank}</td>
                  <td className="border border-slate-300 px-3 py-2">{row.candidate_name}</td>
                  <td className="border border-slate-300 px-3 py-2 text-right font-mono">{row.borda_points}</td>
                  <td className="border border-slate-300 px-3 py-2 text-right font-mono">{row.percentage.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 10. Rekapitulasi Perolehan Suara */}
      <section className="report-section mt-6">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-navy-800">10. Rekapitulasi Perolehan Suara</h3>
        {!evaluation || evaluation.tallies.length === 0 ? (
          <p className="text-sm text-slate-500">Data perolehan suara tidak tersedia.</p>
        ) : (
          <table className="report-table w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className="border border-slate-300 px-3 py-2">Kandidat</th>
                <th className="border border-slate-300 px-3 py-2 text-right">Suara</th>
                <th className="border border-slate-300 px-3 py-2 text-right">Persentase</th>
              </tr>
            </thead>
            <tbody>
              {evaluation.tallies.map((row) => (
                <tr key={row.candidate_id}>
                  <td className="border border-slate-300 px-3 py-2">{row.candidate_name}</td>
                  <td className="border border-slate-300 px-3 py-2 text-right font-mono">{row.votes}</td>
                  <td className="border border-slate-300 px-3 py-2 text-right font-mono">{row.percentage.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 11. Hasil Akhir Pemilihan */}
      <section className="report-section report-final mt-6">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-navy-800">11. Hasil Akhir Pemilihan</h3>
        <div className="rounded-lg border-2 border-navy-800 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kandidat Terpilih</p>
          <p className="mt-1 text-2xl font-extrabold text-navy-800">{decision.candidate_name}</p>
          <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
            <p>
              <span className="font-semibold text-slate-600">Perolehan suara: </span>
              {decision.total_votes} suara
            </p>
            <p>
              <span className="font-semibold text-slate-600">Persentase: </span>
              {Number(decision.percentage).toFixed(2)}%
            </p>
          </div>
          <p className="mt-3 text-sm text-slate-700">
            <span className="font-semibold">Alasan pengesahan: </span>
            {decision.reason}
          </p>
        </div>
      </section>

      {/* 12. Pernyataan Pengesahan &amp; Tanda Tangan */}
      <section className="report-section report-signatures mt-10">
        <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-navy-800">
          12. Pernyataan Pengesahan &amp; Tanda Tangan
        </h3>
        <p className="mb-8 text-sm leading-relaxed text-slate-700">
          Demikian berita acara ini dibuat untuk digunakan sebagaimana mestinya. Pengesahan dilakukan
          secara manual oleh panelis yang namanya tercantum di bawah ini. Sistem tidak menghasilkan
          tanda tangan digital dan tidak mengubah data keputusan selama proses cetak.
        </p>
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
          {panelists.map((panelist) => (
            <div key={panelist.username} className="text-center">
              <p className="min-h-[2.5rem] text-sm font-semibold text-navy-800">{panelist.name}</p>
              <p className="mt-1 text-xs text-slate-600">{panelist.role}</p>
              <div className="mt-12 border-t border-slate-500 pt-2 text-xs text-slate-500">
                Tanda tangan
              </div>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
};

export const FinalDecisionPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [reason, setReason] = useState('');

  const statusQuery = useQuery({
    queryKey: ['voting', 'status'],
    queryFn: async () => {
      const res = await api.getVotingStatus();
      if (res.success && res.data) return res.data;
      throw new Error(res.message || 'Gagal memuat status voting');
    },
    retry: false,
    refetchInterval: 5000,
  });

  const decisionQuery = useQuery({
    queryKey: ['decisions', 'final'],
    queryFn: async () => {
      const res = await api.getFinalDecision();
      if (res.success && res.data) return res.data;
      throw new Error(res.message || 'Gagal memuat keputusan final');
    },
    // 404 = belum ada keputusan (kondisi normal), bukan kegagalan.
    retry: (failureCount, err) => !(isApiError(err) && err.status === 404) && failureCount < 2,
  });

  const decisionSessionId = decisionQuery.data?.session_id;
  const hasDecision = Boolean(decisionQuery.data);

  const electionQuery = useQuery({
    queryKey: ['elections', decisionSessionId],
    queryFn: async () => {
      if (decisionSessionId === undefined) throw new Error('Sesi keputusan tidak tersedia');
      const res = await api.getElection(decisionSessionId);
      if (res.success && res.data) return res.data;
      throw new Error(res.message || 'Gagal memuat detail siklus pemilihan');
    },
    enabled: hasDecision,
    retry: false,
  });

  const candidatesQuery = useQuery({
    queryKey: ['candidates', decisionSessionId],
    queryFn: async () => {
      const res = await api.getCandidates(decisionSessionId);
      if (res.success && res.data) return res.data;
      throw new Error(res.message || 'Gagal memuat daftar kandidat');
    },
    enabled: hasDecision,
    retry: false,
  });

  const criteriaQuery = useQuery({
    queryKey: ['criteria', decisionSessionId],
    queryFn: async () => {
      const res = await api.getCriteria(decisionSessionId);
      if (res.success && res.data) return res.data;
      throw new Error(res.message || 'Gagal memuat daftar kriteria');
    },
    enabled: hasDecision,
    retry: false,
  });

  const topsisQuery = useQuery({
    queryKey: ['results', 'topsis', 'me'],
    queryFn: async () => {
      const res = await api.getTopsisResults();
      if (res.success && res.data) return res.data;
      throw new Error(res.message || 'Gagal memuat hasil TOPSIS');
    },
    enabled: hasDecision,
    retry: false,
  });

  const bordaQuery = useQuery({
    queryKey: ['results', 'borda'],
    queryFn: async () => {
      const res = await api.getBordaResults();
      if (res.success && res.data) return res.data;
      throw new Error(res.message || 'Gagal memuat hasil Borda');
    },
    enabled: hasDecision,
    retry: false,
  });

  const approveMut = useMutation({
    mutationFn: async () => {
      const res = await api.approveDecision(reason.trim());
      if (res.success) return res.data;
      throw new Error(res.message || 'Gagal mengesahkan keputusan');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decisions', 'final'] });
      queryClient.invalidateQueries({ queryKey: ['decisions', 'history'] });
      queryClient.invalidateQueries({ queryKey: ['voting', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['voting', 'results'] });
      setShowApproveModal(false);
      setReason('');
      toast.success('Keputusan final berhasil disahkan.', 'Hasil resmi kini dapat dilihat pada halaman ini.');
    },
    onError: (err) => {
      toast.error('Pengesahan keputusan gagal.', describeApiError(err, 'Gagal mengesahkan keputusan.'));
    },
  });

  const handleApprove = async () => {
    if (!reason.trim() || approveMut.isPending) return;
    try {
      await approveMut.mutateAsync();
    } catch {
      // onError menampilkan pesan; modal tetap terbuka agar bisa dicoba lagi.
    }
  };

  const statusData = statusQuery.data;
  const decision = decisionQuery.data;
  const decisionNotFound = isApiError(decisionQuery.error) && decisionQuery.error.status === 404;
  const decisionError = decisionQuery.error && !decisionNotFound ? decisionQuery.error : null;

  const stateView = useMemo(() => describeDecisionState(statusData), [statusData]);
  const timeline = useMemo(() => buildTimeline(statusData), [statusData]);

  const isChair = user?.role === 'chair';
  const canApprove = Boolean(isChair && statusData?.can_chair_approve);
  const isRetrying = statusQuery.isFetching || decisionQuery.isFetching;

  const handleRetry = async () => {
    const [statusResult, decisionResult] = await Promise.all([
      statusQuery.refetch(),
      decisionQuery.refetch(),
    ]);

    if (statusResult.error || (decisionResult.error && !(isApiError(decisionResult.error) && decisionResult.error.status === 404))) {
      const err = statusResult.error ?? decisionResult.error;
      toast.error('Gagal memuat status keputusan.', describeApiError(err, 'Silakan coba lagi.'));
      return;
    }

    toast.info('Status keputusan diperbarui.', 'Data terbaru berhasil dimuat dari server.');
  };

  /* ─── Loading awal ─── */
  if (statusQuery.isLoading || (decisionQuery.isLoading && !decisionQuery.data)) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-navy-800">Keputusan Final</h1>
          <p className="mt-1 text-sm text-slate-500">Memuat status proses pemilihan...</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-white shadow" />
          ))}
        </div>
        <div className="h-48 animate-pulse rounded-xl bg-white shadow" />
      </div>
    );
  }

  /* ─── Status voting gagal dimuat ─── */
  if (statusQuery.error && !statusData) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-navy-800">Keputusan Final</h1>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6" role="alert">
          <p className="flex items-center gap-2 font-medium text-red-700">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            Status proses pemilihan gagal dimuat.
          </p>
          <p className="mt-1 text-sm text-red-700">
            {describeApiError(statusQuery.error, 'Gagal memuat status voting.')}
          </p>
          <button
            type="button"
            onClick={handleRetry}
            disabled={isRetrying}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-navy-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-900 disabled:cursor-not-allowed disabled:opacity-60"
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
      </div>
    );
  }

  const votesCast = statusData?.votes_cast_in_round ?? 0;
  const eligibleVoters = statusData?.eligible_voters ?? 0;
  const remainingVotes = Math.max(eligibleVoters - votesCast, 0);
  const evaluation = statusData?.evaluation ?? null;

  const outcomeLabel = (() => {
    if (!evaluation) return 'Belum ada hasil';
    if (evaluation.status === 'majority') return 'Mayoritas tercapai';
    if (evaluation.status === 'tie_revote') return 'Seri — perlu putaran ulang';
    return 'Menunggu suara';
  })();

  const approvalLabel = decision
    ? 'Telah disahkan'
    : canApprove
      ? 'Menunggu pengesahan Ketua Panel'
      : 'Belum disahkan';

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy-800">Keputusan Final</h1>
          <p className="mt-1 text-sm text-slate-500">
            Keputusan resmi hasil konsensus panel pemilihan calon presiden.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 no-print">
          {decision && (
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-lg bg-gold-accent px-4 py-2 text-sm font-semibold text-navy-800 shadow-sm transition hover:bg-gold-hover"
              data-testid="print-official-report"
            >
              <Printer className="h-4 w-4" aria-hidden="true" /> Cetak Berita Acara
            </button>
          )}
          <button
            type="button"
            onClick={handleRetry}
            disabled={isRetrying}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-navy-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRetrying ? (
            <>
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> Memuat...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Muat Ulang
            </>
          )}
          </button>
        </div>
      </div>

      {/* ── Status Saat Ini ── */}
      <div className={`rounded-xl border p-6 ${TONE_STYLES[stateView.tone].panel}`} role="status">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className={`mt-0.5 h-6 w-6 flex-shrink-0 ${TONE_STYLES[stateView.tone].icon}`} aria-hidden="true" />
            <div>
              <p className="text-lg font-bold">{stateView.label}</p>
              <p className="mt-1 max-w-2xl text-sm">{stateView.description}</p>
            </div>
          </div>
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${TONE_STYLES[stateView.tone].badge}`}>
            {stateView.label}
          </span>
        </div>
      </div>

      {/* ── Keputusan Resmi (hanya setelah disahkan backend) ── */}
      {decision ? (
        <div className="overflow-hidden rounded-xl border-2 border-gold-accent bg-gradient-to-br from-gold-accent to-amber-500 text-navy-800 shadow-2xl">
          <div className="bg-navy-800 px-8 py-6 text-white">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="mb-1 text-sm font-semibold uppercase tracking-wide text-gold-accent">Keputusan Resmi</p>
                <h2 className="text-3xl font-bold">Calon Presiden Terpilih</h2>
              </div>
              <Trophy className="h-12 w-12 text-navy-800" aria-hidden="true" />
            </div>
          </div>
          <div className="px-8 py-6">
            <div className="mb-6">
              <p className="mb-2 text-sm font-semibold uppercase tracking-wide">Kandidat Terpilih</p>
              <h3 className="mb-3 text-4xl font-extrabold">{decision.candidate_name}</h3>
              {decision.vision && (
                <div className="mb-3 rounded-lg bg-white bg-opacity-50 p-4">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide">Visi</p>
                  <p className="text-sm font-medium">{decision.vision}</p>
                </div>
              )}
              {decision.mission && (
                <div className="rounded-lg bg-white bg-opacity-50 p-4">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide">Misi</p>
                  <p className="text-sm font-medium">{decision.mission}</p>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide">Perolehan Suara</p>
                <p className="text-2xl font-bold">{decision.total_votes} suara</p>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide">Persentase</p>
                <p className="text-2xl font-bold">{Number(decision.percentage).toFixed(2)}%</p>
              </div>
            </div>
          </div>
        </div>
      ) : decisionError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6" role="alert">
          <p className="flex items-center gap-2 font-medium text-red-700">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            Data keputusan final gagal dimuat.
          </p>
          <p className="mt-1 text-sm text-red-700">
            {describeApiError(decisionError, 'Gagal memuat keputusan final.')}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <p className="flex items-center gap-2 font-semibold text-navy-800">
            <Lock className="h-5 w-5 text-slate-500" aria-hidden="true" />
            Keputusan belum disahkan
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Kandidat terpilih belum dapat ditampilkan sebagai keputusan final sebelum hasil voting disahkan oleh
            Ketua Panel. Sistem tidak menetapkan pemenang di sisi antarmuka.
          </p>
        </div>
      )}

      {/* ── Metrik Progres ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Putaran Voting</p>
          <p className="mt-2 text-2xl font-bold text-navy-800">#{statusData?.current_round ?? 0}</p>
          <p className="mt-1 text-xs text-slate-500">Putaran berjalan saat ini</p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pemilih Terdaftar</p>
          <p className="mt-2 text-2xl font-bold text-navy-800">{eligibleVoters}</p>
          <p className="mt-1 text-xs text-slate-500">Pemilih pada putaran ini</p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Suara Masuk</p>
          <p className="mt-2 text-2xl font-bold text-navy-800">
            {votesCast}
            <span className="text-base font-medium text-slate-400"> / {eligibleVoters}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">Tersisa {remainingVotes} suara</p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status Pengesahan</p>
          <p className="mt-2 text-base font-bold text-navy-800">{approvalLabel}</p>
          <p className="mt-1 text-xs text-slate-500">Hasil: {outcomeLabel}</p>
        </div>
      </div>

      {/* ── Monitoring Pemilih Resmi ── */}
      {statusData?.electorate && statusData.electorate.length > 0 && (
        <ElectorateMonitor
          electorate={statusData.electorate}
          votesCast={votesCast}
          totalVoters={eligibleVoters}
          currentRound={statusData.current_round}
        />
      )}

      {/* ── Ringkasan Hasil Voting (belum disahkan) ── */}
      {!decision && evaluation && evaluation.tallies.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-bold text-navy-800">Perolehan Suara Putaran Ini</h2>
            <p className="mt-1 text-xs text-slate-500">
              Angka sementara dari backend. Bukan keputusan final sampai disahkan Ketua Panel.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="px-5 py-3 font-semibold text-slate-600">Kandidat</th>
                  <th className="px-5 py-3 text-right font-semibold text-slate-600">Suara</th>
                  <th className="px-5 py-3 text-right font-semibold text-slate-600">Persentase</th>
                </tr>
              </thead>
              <tbody>
                {evaluation.tallies.map((tally) => (
                  <tr key={tally.candidate_id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 font-medium text-slate-800">{tally.candidate_name}</td>
                    <td className="px-5 py-3 text-right font-mono font-bold text-navy-800">{tally.votes}</td>
                    <td className="px-5 py-3 text-right font-mono text-slate-600">{tally.percentage.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Timeline Proses ── */}
      <div className="rounded-xl border border-slate-100 bg-white p-6 shadow">
        <h2 className="mb-4 font-bold text-navy-800">Tahapan Proses Pemilihan</h2>
        <ol className="space-y-3">
          {timeline.map((stage, index) => (
            <li key={stage.key} className="flex items-start gap-3">
              <div
                className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border ${
                  stage.state === 'done'
                    ? 'border-green-200 bg-green-50'
                    : stage.state === 'active'
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-slate-200 bg-slate-50'
                }`}
              >
                <StageIcon state={stage.state} />
              </div>
              <div className="min-w-0">
                <p
                  className={`text-sm font-semibold ${
                    stage.state === 'pending' ? 'text-slate-500' : 'text-navy-800'
                  }`}
                >
                  {index + 1}. {stage.label}
                  {stage.state === 'done' && <span className="ml-2 text-xs font-medium text-green-700">Selesai</span>}
                  {stage.state === 'active' && <span className="ml-2 text-xs font-medium text-amber-700">Sedang berlangsung</span>}
                  {stage.state === 'pending' && <span className="ml-2 text-xs font-medium text-slate-400">Menunggu</span>}
                </p>
                <p className="text-xs text-slate-500">{stage.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* ── Detail Pengesahan ── */}
      {decision && (
        <div className="rounded-xl border border-slate-100 bg-white p-6 shadow">
          <h2 className="mb-4 font-bold text-navy-800">Detail Pengesahan</h2>
          <div className="space-y-3 text-sm">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <span className="text-slate-600">Disahkan oleh</span>
              <span className="text-right font-semibold text-navy-800">{decision.approved_by_name}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <span className="text-slate-600">Waktu Pengesahan</span>
              <span className="text-right font-mono text-navy-800">
                {new Date(decision.approved_at).toLocaleString('id-ID', {
                  dateStyle: 'long',
                  timeStyle: 'short',
                })}
              </span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <span className="text-slate-600">Putaran</span>
              <span className="font-semibold text-navy-800">#{decision.round_number ?? decision.round_id}</span>
            </div>
            <div className="pt-2">
              <p className="mb-2 text-slate-600">Alasan Pengesahan</p>
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="leading-relaxed text-slate-800">{decision.reason}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Berita Acara Resmi (dapat dicetak) ── */}
      {decision && (
        <OfficialDecisionReport
          decision={decision}
          election={electionQuery.data ?? null}
          criteria={criteriaQuery.data ?? []}
          candidates={candidatesQuery.data ?? []}
          topsis={topsisQuery.data ?? null}
          borda={bordaQuery.data ?? null}
          electorate={statusData?.electorate ?? []}
          evaluation={evaluation}
          statusLabel={stateView.label}
        />
      )}

      {/* ── Aksi Sesuai Peran ── */}
      <div className="flex flex-wrap gap-3">
        {!decision && stateView.key === 'not_opened' && isChair && (
          <button
            type="button"
            onClick={() => navigate(statusData?.can_chair_open ? '/voting' : '/assessments')}
            className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700"
          >
            {statusData?.can_chair_open ? (
              <>
                <Vote className="h-4 w-4" aria-hidden="true" /> Buka Halaman Voting
              </>
            ) : (
              <>
                <ClipboardCheck className="h-4 w-4" aria-hidden="true" /> Buka Halaman Penilaian
              </>
            )}
          </button>
        )}

        {!decision && stateView.key === 'not_opened' && !isChair && (
          <p className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
            <Clock className="h-4 w-4" aria-hidden="true" />
            Menunggu Ketua Panel membuka sesi voting.
          </p>
        )}

        {!decision && (stateView.key === 'voting_open' || stateView.key === 'voting_collecting') && (
          <button
            type="button"
            onClick={() => navigate('/voting')}
            className="inline-flex items-center gap-2 rounded-lg bg-navy-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-900"
          >
            <Vote className="h-4 w-4" aria-hidden="true" /> Lihat Progres Voting
          </button>
        )}

        {!decision && stateView.key === 'tie_revote' && isChair && (
          <button
            type="button"
            onClick={() => navigate('/voting/revote')}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Buka Putaran Ulang
          </button>
        )}

        {!decision && stateView.key === 'tie_revote' && !isChair && (
          <p className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            <Clock className="h-4 w-4" aria-hidden="true" />
            Menunggu Ketua Panel membuka putaran voting berikutnya.
          </p>
        )}

        {!decision && canApprove && (
          <button
            type="button"
            onClick={() => setShowApproveModal(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-gold-accent px-5 py-2.5 text-sm font-semibold text-navy-800 shadow-md transition hover:bg-gold-hover"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Periksa dan Sahkan Keputusan
          </button>
        )}

        {!decision && !canApprove && stateView.key === 'awaiting_approval' && (
          <p className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
            <Clock className="h-4 w-4" aria-hidden="true" />
            Menunggu Pengesahan Ketua Panel.
          </p>
        )}

        <button
          type="button"
          onClick={() => navigate('/decisions/history')}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-navy-800 transition hover:bg-slate-50"
        >
          <FileText className="h-4 w-4" aria-hidden="true" /> Lihat Riwayat Lengkap
        </button>
        <button
          type="button"
          onClick={() => navigate('/voting')}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-navy-800 transition hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Kembali ke Voting
        </button>
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="inline-flex items-center gap-2 rounded-lg bg-navy-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-900"
        >
          <Home className="h-4 w-4" aria-hidden="true" /> Kembali ke Dashboard
        </button>
      </div>

      {/* ── Approve Modal ── */}
      {showApproveModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
          onClick={() => {
            if (!approveMut.isPending) {
              setShowApproveModal(false);
              setReason('');
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="approve-title"
            aria-busy={approveMut.isPending}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl"
          >
            <h3 id="approve-title" className="mb-2 text-xl font-bold text-navy-800">Sahkan Keputusan Final</h3>
            <p className="mb-4 text-sm text-slate-600">
              Dengan mengesahkan keputusan ini, Anda menyatakan bahwa hasil voting mayoritas telah sesuai dengan
              prosedur dan kandidat terpilih akan menjadi keputusan resmi panel.
            </p>
            <div className="mb-4">
              <label htmlFor="approve-reason" className="mb-2 block text-sm font-semibold text-navy-800">
                Alasan Pengesahan <span className="text-red-600">*</span>
              </label>
              <textarea
                id="approve-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={approveMut.isPending}
                placeholder="Contoh: Konsensus panel mufakat menetapkan kandidat berdasarkan visi Indonesia Maju dan mayoritas voting 66.67%."
                className="w-full resize-none rounded-lg border border-slate-300 px-4 py-3 focus:border-gold-accent focus:ring-2 focus:ring-gold-accent disabled:bg-slate-50"
                rows={4}
              />
              <p className="mt-1 text-xs text-slate-500">Jelaskan alasan pengesahan untuk dokumentasi resmi.</p>
            </div>
            {approveMut.error && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3" role="alert">
                <p className="text-sm text-red-700">
                  {describeApiError(approveMut.error, 'Gagal mengesahkan keputusan.')}
                </p>
              </div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowApproveModal(false);
                  setReason('');
                }}
                disabled={approveMut.isPending}
                className="flex-1 rounded-lg bg-slate-200 px-4 py-2 font-semibold text-slate-800 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={approveMut.isPending || !reason.trim()}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-gold-accent px-4 py-2 font-semibold text-navy-800 transition hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {approveMut.isPending ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> Mengesahkan...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Sahkan Keputusan
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
