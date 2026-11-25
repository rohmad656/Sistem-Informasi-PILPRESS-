import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { BordaResultsPage } from './BordaResultsPage';
import { ToastProvider } from '@/components/ui/Toast';
import { ApiError } from '@/services/api';
import { AssessmentStatusResponse, BordaResponse } from '@/types';

const bordaMock = vi.fn();
const assessmentStatusMock = vi.fn();

vi.mock('recharts', () => {
  const Null = () => null;
  return {
    ResponsiveContainer: Null,
    BarChart: Null,
    Bar: Null,
    XAxis: Null,
    YAxis: Null,
    CartesianGrid: Null,
    Tooltip: Null,
    LabelList: Null,
    Cell: Null,
  };
});

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>();
  return {
    ...actual,
    api: {
      getBordaResults: () => bordaMock(),
      getAssessmentStatus: () => assessmentStatusMock(),
    },
  };
});

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, username: 'dm1', name: 'DM Satu', role: 'chair' } }),
}));

const pendingStatus: AssessmentStatusResponse = {
  all_finalized: false,
  total_panelists: 3,
  panel: [
    { user_id: 1, username: 'dm1', name: 'DM Satu', role: 'chair', is_finalized: true, finalized_at: '2026-01-01T10:00:00Z' },
    { user_id: 2, username: 'dm2', name: 'DM Dua', role: 'member', is_finalized: false, finalized_at: null },
    { user_id: 3, username: 'dm3', name: 'DM Tiga', role: 'member', is_finalized: false, finalized_at: null },
  ],
};

const bordaResponse: BordaResponse = {
  total_points_distributed: 18,
  rankings: [
    { candidate_id: 1, candidate_name: 'Kandidat A', borda_points: 8, borda_value: 0.4444, percentage: 44.44, rank: 1 },
    { candidate_id: 2, candidate_name: 'Kandidat B', borda_points: 6, borda_value: 0.3333, percentage: 33.33, rank: 2 },
    { candidate_id: 3, candidate_name: 'Kandidat C', borda_points: 4, borda_value: 0.2222, percentage: 22.22, rank: 3 },
  ],
  dm_breakdown: {},
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <BordaResultsPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe('BordaResultsPage', () => {
  beforeEach(() => {
    bordaMock.mockReset();
    assessmentStatusMock.mockReset();
    assessmentStatusMock.mockResolvedValue({ success: true, message: 'ok', data: pendingStatus });
  });

  it('menampilkan status terblokir dengan alasan dan status panelis nyata', async () => {
    bordaMock.mockRejectedValue(
      new ApiError(409, 'Hasil Borda belum dapat dihitung karena belum seluruh Decision Maker memfinalisasi penilaian.')
    );

    renderPage();

    expect(await screen.findByText('Menunggu Finalisasi Penilaian')).toBeInTheDocument();
    expect(
      screen.getByText(/seluruh Decision Maker harus menyelesaikan dan memfinalisasi penilaiannya terlebih dahulu/i)
    ).toBeInTheDocument();

    expect(await screen.findByText('1 / 3 panelis')).toBeInTheDocument();
    expect(screen.getByText('Ketua Panel — Perwakilan MPR')).toBeInTheDocument();
    expect(screen.getByText('Anggota Panel — Perwakilan DPR')).toBeInTheDocument();
    expect(screen.getByText('Anggota Panel — Utusan Daerah')).toBeInTheDocument();
    expect(screen.getByText('Sudah difinalisasi')).toBeInTheDocument();
    expect(screen.getAllByText('Draft — belum finalisasi')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Buka Halaman Penilaian/i })).toBeInTheDocument();
  });

  it('tidak memperlakukan prasyarat bisnis 409 sebagai kegagalan server', async () => {
    bordaMock.mockRejectedValue(new ApiError(409, 'Belum seluruh Decision Maker memfinalisasi penilaian.'));

    renderPage();

    await screen.findByText('Menunggu Finalisasi Penilaian');
    expect(screen.queryByText('Hasil Borda gagal dimuat.')).not.toBeInTheDocument();
  });

  it('tombol Coba Lagi memuat ulang Borda dan status penilaian lalu menampilkan hasil nyata', async () => {
    const user = userEvent.setup();
    bordaMock
      .mockRejectedValueOnce(new ApiError(409, 'Belum seluruh Decision Maker memfinalisasi penilaian.'))
      .mockResolvedValueOnce({ success: true, message: 'ok', data: bordaResponse });
    assessmentStatusMock
      .mockResolvedValueOnce({ success: true, message: 'ok', data: pendingStatus })
      .mockResolvedValueOnce({
        success: true,
        message: 'ok',
        data: {
          ...pendingStatus,
          all_finalized: true,
          panel: pendingStatus.panel.map((p) => ({ ...p, is_finalized: true })),
        },
      });

    renderPage();

    await user.click(await screen.findByRole('button', { name: /Coba Lagi/i }));

    expect((await screen.findAllByText('Kandidat A')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Kandidat B')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Kandidat C')).length).toBeGreaterThan(0);
    expect(bordaMock).toHaveBeenCalledTimes(2);
    expect(assessmentStatusMock).toHaveBeenCalledTimes(2);

    const points = screen.getAllByText('8');
    expect(points.length).toBeGreaterThan(0);
  });

  it('menampilkan pesan bantuan bila Coba Lagi masih menemukan penilaian belum lengkap', async () => {
    const user = userEvent.setup();
    bordaMock.mockRejectedValue(new ApiError(409, 'Belum seluruh Decision Maker memfinalisasi penilaian.'));

    renderPage();

    await user.click(await screen.findByRole('button', { name: /Coba Lagi/i }));

    expect(
      (await screen.findAllByText(/Penilaian masih belum lengkap/i)).length
    ).toBeGreaterThan(0);
    expect(screen.getByText('Menunggu Finalisasi Penilaian')).toBeInTheDocument();
  });

  it('menampilkan error jaringan yang aman beserta tombol coba lagi', async () => {
    bordaMock.mockRejectedValue(new TypeError('Failed to fetch'));

    renderPage();

    expect(await screen.findByText('Hasil Borda gagal dimuat.')).toBeInTheDocument();
    expect(screen.getByText(/Tidak dapat terhubung ke server/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Coba Lagi/i })).toBeEnabled();
  });

  it('menampilkan hasil Borda dari API saat seluruh penilaian selesai', async () => {
    bordaMock.mockResolvedValue({ success: true, message: 'ok', data: bordaResponse });
    assessmentStatusMock.mockResolvedValue({
      success: true,
      message: 'ok',
      data: { ...pendingStatus, all_finalized: true },
    });

    renderPage();

    expect(await screen.findByText('Hasil Agregasi Borda')).toBeInTheDocument();
    expect(screen.getAllByText('Kandidat A').length).toBeGreaterThan(0);
    expect(screen.getByText('Tabel Peringkat Borda')).toBeInTheDocument();
    expect(screen.getAllByText(/Total Poin Terdistribusi/i).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText('Menunggu Finalisasi Penilaian')).not.toBeInTheDocument());
  });
});
