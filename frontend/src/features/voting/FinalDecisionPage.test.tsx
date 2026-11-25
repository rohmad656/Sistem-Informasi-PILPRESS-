import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { FinalDecisionPage } from './FinalDecisionPage';
import { ToastProvider } from '@/components/ui/Toast';
import { ApiError } from '@/services/api';
import { RatifiedDecision, VotingStatusResponse, Candidate, Criterion, TopsisResponse, BordaResponse } from '@/types';

const statusMock = vi.fn();
const finalDecisionMock = vi.fn();
const approveMock = vi.fn();
const electionMock = vi.fn();
const candidatesMock = vi.fn();
const criteriaMock = vi.fn();
const topsisMock = vi.fn();
const bordaMock = vi.fn();
const userState: { role: 'chair' | 'member' | 'voter' } = { role: 'chair' };

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>();
  return {
    ...actual,
    api: {
      getVotingStatus: () => statusMock(),
      getFinalDecision: () => finalDecisionMock(),
      approveDecision: (reason: string) => approveMock(reason),
      getElection: () => electionMock(),
      getCandidates: () => candidatesMock(),
      getCriteria: () => criteriaMock(),
      getTopsisResults: () => topsisMock(),
      getBordaResults: () => bordaMock(),
    },
  };
});

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'dm1', name: 'DM Satu', role: userState.role },
  }),
}));

const baseStatus: VotingStatusResponse = {
  session_status: 'assessment',
  current_round: 0,
  is_voting_open: false,
  has_voted_this_round: false,
  votes_cast_in_round: 0,
  eligible_voters: 0,
  required_votes: 0,
  majority_threshold: 0,
  is_eligible: false,
  evaluation: null,
  ratified_decision: null,
  can_chair_open: false,
  can_chair_approve: false,
  electorate: [],
};

const ratifiedDecision: RatifiedDecision = {
  id: 10,
  session_id: 1,
  round_id: 2,
  candidate_id: 1,
  candidate_name: 'Kandidat A',
  vision: 'Visi A',
  mission: 'Misi A',
  total_votes: 2,
  percentage: 66.67,
  approved_by: 1,
  approved_by_name: 'DM Satu',
  reason: 'Konsensus panel tercapai.',
  approved_at: '2026-01-02T10:00:00Z',
  round_number: 2,
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <FinalDecisionPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe('FinalDecisionPage', () => {
  beforeEach(() => {
    statusMock.mockReset();
    finalDecisionMock.mockReset();
    approveMock.mockReset();
    electionMock.mockReset();
    candidatesMock.mockReset();
    criteriaMock.mockReset();
    topsisMock.mockReset();
    bordaMock.mockReset();
    userState.role = 'chair';
    finalDecisionMock.mockRejectedValue(new ApiError(404, 'Keputusan final belum tersedia.'));
    electionMock.mockResolvedValue({ success: true, message: 'ok', data: null });
    candidatesMock.mockResolvedValue({ success: true, message: 'ok', data: [] });
    criteriaMock.mockResolvedValue({ success: true, message: 'ok', data: [] });
    topsisMock.mockResolvedValue({ success: true, message: 'ok', data: null });
    bordaMock.mockResolvedValue({ success: true, message: 'ok', data: null });
    window.print = vi.fn();
  });

  it('menampilkan status voting belum dibuka dan aksi Ketua Panel', async () => {
    statusMock.mockResolvedValue({
      success: true,
      message: 'ok',
      data: { ...baseStatus, can_chair_open: true },
    });

    renderPage();

    expect((await screen.findAllByText('Voting Belum Dibuka')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Buka Halaman Voting/i })).toBeInTheDocument();
    expect(screen.getByText('Keputusan belum disahkan')).toBeInTheDocument();
  });

  it('anggota panel hanya melihat informasi menunggu saat voting belum dibuka', async () => {
    userState.role = 'member';
    statusMock.mockResolvedValue({ success: true, message: 'ok', data: baseStatus });

    renderPage();

    expect((await screen.findAllByText('Voting Belum Dibuka')).length).toBeGreaterThan(0);
    expect(screen.getByText('Menunggu Ketua Panel membuka sesi voting.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Buka Halaman Voting/i })).not.toBeInTheDocument();
  });

  it('menampilkan progres pengumpulan suara saat voting berlangsung', async () => {
    statusMock.mockResolvedValue({
      success: true,
      message: 'ok',
      data: {
        ...baseStatus,
        session_status: 'voting',
        is_voting_open: true,
        current_round: 1,
        votes_cast_in_round: 1,
        eligible_voters: 4,
        required_votes: 4,
        majority_threshold: 3,
      },
    });

    renderPage();

    expect((await screen.findAllByText('Menunggu Suara Panelis')).length).toBeGreaterThan(0);
    expect(screen.getByText('Tersisa 3 suara')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('menampilkan aksi putaran ulang untuk Ketua Panel saat hasil seri', async () => {
    statusMock.mockResolvedValue({
      success: true,
      message: 'ok',
      data: { ...baseStatus, session_status: 'tie_revote', current_round: 1, eligible_voters: 3 },
    });

    renderPage();

    expect(
      (await screen.findAllByText('Hasil Voting Seri — Menunggu Putaran Berikutnya')).length
    ).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Buka Putaran Ulang/i })).toBeInTheDocument();
  });

  it('menampilkan aksi pengesahan hanya untuk Ketua Panel saat menunggu pengesahan', async () => {
    statusMock.mockResolvedValue({
      success: true,
      message: 'ok',
      data: {
        ...baseStatus,
        session_status: 'voting_completed',
        current_round: 1,
        votes_cast_in_round: 3,
        eligible_voters: 3,
        can_chair_approve: true,
      },
    });

    renderPage();

    expect((await screen.findAllByText('Menunggu Pengesahan Ketua Panel')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Periksa dan Sahkan Keputusan/i })).toBeInTheDocument();
  });

  it('menampilkan pesan menunggu pengesahan untuk peran non-Ketua', async () => {
    userState.role = 'voter';
    statusMock.mockResolvedValue({
      success: true,
      message: 'ok',
      data: {
        ...baseStatus,
        session_status: 'voting_completed',
        current_round: 1,
        votes_cast_in_round: 3,
        eligible_voters: 3,
        can_chair_approve: false,
      },
    });

    renderPage();

    expect((await screen.findAllByText('Hasil Voting Selesai')).length).toBeGreaterThan(0);
    expect(screen.getByText('Keputusan belum disahkan')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Periksa dan Sahkan Keputusan/i })).not.toBeInTheDocument();
  });

  it('menampilkan keputusan yang sudah disahkan dari backend beserta detail pengesahan', async () => {
    statusMock.mockResolvedValue({
      success: true,
      message: 'ok',
      data: {
        ...baseStatus,
        session_status: 'ratified',
        current_round: 2,
        ratified_decision: ratifiedDecision,
      },
    });
    finalDecisionMock.mockResolvedValue({ success: true, message: 'ok', data: ratifiedDecision });

    renderPage();

    expect((await screen.findAllByText('Keputusan Telah Disahkan')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Kandidat A').length).toBeGreaterThan(0);
    expect(screen.getByText('Detail Pengesahan')).toBeInTheDocument();
    expect(screen.getAllByText('DM Satu').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Konsensus panel tercapai.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Keputusan belum disahkan')).not.toBeInTheDocument();
  });

  it('merender persentase string dari backend DECIMAL tanpa crash (regresi toFixed)', async () => {
    const stringPercentageDecision: RatifiedDecision = { ...ratifiedDecision, percentage: '66.67' };
    statusMock.mockResolvedValue({
      success: true,
      message: 'ok',
      data: {
        ...baseStatus,
        session_status: 'ratified',
        current_round: 2,
        ratified_decision: stringPercentageDecision,
      },
    });
    finalDecisionMock.mockResolvedValue({ success: true, message: 'ok', data: stringPercentageDecision });

    expect(() => renderPage()).not.toThrow();
    expect((await screen.findAllByText('66.67%')).length).toBeGreaterThan(0);
  });

  it('memperlakukan 404 keputusan final sebagai kondisi kosong, bukan error', async () => {
    statusMock.mockResolvedValue({ success: true, message: 'ok', data: baseStatus });

    renderPage();

    expect(await screen.findByText('Keputusan belum disahkan')).toBeInTheDocument();
    expect(screen.queryByText('Data keputusan final gagal dimuat.')).not.toBeInTheDocument();
    expect(screen.queryByText(/Kandidat A/i)).not.toBeInTheDocument();
  });

  it('menampilkan error nyata saat status voting gagal dimuat dan menyediakan coba lagi', async () => {
    statusMock.mockRejectedValue(new ApiError(500, 'Kesalahan internal server.'));

    renderPage();

    expect(await screen.findByText('Status proses pemilihan gagal dimuat.')).toBeInTheDocument();
    expect(screen.getByText('Kesalahan internal server.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Coba Lagi/i })).toBeEnabled();
  });

  it('mengesahkan keputusan sekali dengan alasan, menampilkan notifikasi sukses, lalu menutup modal', async () => {
    const user = userEvent.setup();
    statusMock.mockResolvedValue({
      success: true,
      message: 'ok',
      data: {
        ...baseStatus,
        session_status: 'voting_completed',
        current_round: 1,
        votes_cast_in_round: 3,
        eligible_voters: 3,
        can_chair_approve: true,
      },
    });
    approveMock.mockResolvedValue({ success: true, message: 'ok', data: ratifiedDecision });

    renderPage();

    await user.click(await screen.findByRole('button', { name: /Periksa dan Sahkan Keputusan/i }));
    const reasonInput = await screen.findByLabelText(/Alasan Pengesahan/i);
    await user.type(reasonInput, 'Konsensus panel tercapai.');
    await user.click(screen.getByRole('button', { name: /^Sahkan Keputusan$/i }));

    expect(await screen.findByText('Keputusan final berhasil disahkan.')).toBeInTheDocument();
    expect(approveMock).toHaveBeenCalledTimes(1);
    expect(approveMock).toHaveBeenCalledWith('Konsensus panel tercapai.');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('menampilkan error pengesahan dan menjaga modal tetap terbuka', async () => {
    const user = userEvent.setup();
    statusMock.mockResolvedValue({
      success: true,
      message: 'ok',
      data: {
        ...baseStatus,
        session_status: 'voting_completed',
        current_round: 1,
        votes_cast_in_round: 3,
        eligible_voters: 3,
        can_chair_approve: true,
      },
    });
    approveMock.mockRejectedValue(new ApiError(403, 'Hanya Ketua Panel yang dapat mengesahkan keputusan.'));

    renderPage();

    await user.click(await screen.findByRole('button', { name: /Periksa dan Sahkan Keputusan/i }));
    await user.type(await screen.findByLabelText(/Alasan Pengesahan/i), 'Alasan pengesahan.');
    await user.click(screen.getByRole('button', { name: /^Sahkan Keputusan$/i }));

    expect(
      (await screen.findAllByText('Hanya Ketua Panel yang dapat mengesahkan keputusan.')).length
    ).toBeGreaterThan(0);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(approveMock).toHaveBeenCalledTimes(1);
  });

  it('merender Berita Acara 12 bagian dengan 3 slot panel dan tombol cetak', async () => {
    const candidates: Candidate[] = [
      { id: 1, session_id: 1, name: 'Kandidat A', vision: 'Visi A', mission: null, profile: null },
    ];
    const criteria: Criterion[] = [
      { id: 1, session_id: 1, code: 'C1', name: 'Kriteria 1', description: '', weight: 100, type: 'benefit', is_finalized: true },
    ];
    const topsis: TopsisResponse = {
      dm_user_id: 1,
      dm_name: 'DM Satu',
      rankings: [
        { candidate_id: 1, candidate_name: 'Kandidat A', final_score: 0.875, d_plus: 0.1, d_minus: 0.7, rank: 1, breakdown: {} },
      ],
    };
    const borda: BordaResponse = {
      total_points_distributed: 3,
      rankings: [
        { candidate_id: 1, candidate_name: 'Kandidat A', borda_points: 3, borda_value: 1, percentage: 100, rank: 1 },
      ],
      dm_breakdown: {},
    };
    const electorate = [
      { user_id: 1, username: 'dm1', name: 'DM Satu', role: 'chair' as const, has_voted: true },
      { user_id: 2, username: 'dm2', name: 'DM Dua', role: 'member' as const, has_voted: true },
      { user_id: 3, username: 'dm3', name: 'DM Tiga', role: 'member' as const, has_voted: true },
    ];
    const evaluation = {
      status: 'majority' as const,
      is_completed: true,
      total_votes_cast: 2,
      winner: null,
      tallies: [
        { candidate_id: 1, candidate_name: 'Kandidat A', votes: 2, percentage: 100 },
      ],
    };

    statusMock.mockResolvedValue({
      success: true,
      message: 'ok',
      data: {
        ...baseStatus,
        session_status: 'ratified',
        current_round: 1,
        ratified_decision: ratifiedDecision,
        electorate,
        evaluation,
      },
    });
    finalDecisionMock.mockResolvedValue({ success: true, message: 'ok', data: ratifiedDecision });
    candidatesMock.mockResolvedValue({ success: true, message: 'ok', data: candidates });
    criteriaMock.mockResolvedValue({ success: true, message: 'ok', data: criteria });
    topsisMock.mockResolvedValue({ success: true, message: 'ok', data: topsis });
    bordaMock.mockResolvedValue({ success: true, message: 'ok', data: borda });

    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByTestId('official-decision-report')).toBeInTheDocument();
    const headings = [
      '1. Identitas Dokumen',
      '2. Deskripsi Siklus',
      '3. Dasar Pengambilan Keputusan',
      '4. Waktu & Status Pengesahan',
      '5. Susunan Panel Decision Maker',
      '6. Daftar Kriteria Penilaian',
      '7. Daftar Kandidat',
      '8. Hasil Penilaian TOPSIS',
      '9. Hasil Penilaian Borda',
      '10. Rekapitulasi Perolehan Suara',
      '11. Hasil Akhir Pemilihan',
      '12. Pernyataan Pengesahan & Tanda Tangan',
    ];
    headings.forEach((heading) => {
      expect(screen.getByText(heading)).toBeInTheDocument();
    });

    const report = screen.getByTestId('official-decision-report');
    expect(report).toHaveTextContent('DM Satu');
    expect(report).toHaveTextContent('DM Dua');
    expect(report).toHaveTextContent('DM Tiga');
    expect(report).not.toHaveTextContent('Nama panelis — diisi resmi');
    expect(report).toHaveTextContent(/hasil TOPSIS di bawah dihitung ulang dengan metodologi terkini/);
    expect(report).toHaveTextContent(/bukan bukti bahwa keputusan historis disahkan berdasarkan TOPSIS/);

    await user.click(screen.getByTestId('print-official-report'));
    expect(window.print).toHaveBeenCalledTimes(1);
  });
});
