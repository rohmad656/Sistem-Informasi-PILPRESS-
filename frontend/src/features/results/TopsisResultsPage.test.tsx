import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TopsisResultsPage } from './TopsisResultsPage';
import { ToastProvider } from '@/components/ui/Toast';
import { ApiError } from '@/services/api';
import { TopsisResponse } from '@/types';

const topsisMock = vi.fn();

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
      ...actual.api,
      getTopsisResults: () => topsisMock(),
    },
  };
});

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'dm1', name: 'DM Satu', role: 'chair' },
  }),
}));

const fixture: TopsisResponse = {
  dm_user_id: 1,
  dm_name: 'Ketua Panel',
  rankings: [
    {
      candidate_id: 1,
      candidate_name: 'Kandidat Alpha',
      final_score: 0.656678912345,
      d_plus: 0.123456789,
      d_minus: 0.234567891,
      rank: 1,
      breakdown: {
        1: {
          criterion_id: 1,
          code: 'C1',
          raw_score: 5,
          sum_squares: 8.66,
          normalized: 0.57735,
          weight: 60,
          norm_weight: 0.6,
          weighted_normalized: 0.34641,
          ideal_positive: 0.34641,
          ideal_negative: 0.13856,
        },
      },
    },
    {
      candidate_id: 2,
      candidate_name: 'Kandidat Beta',
      final_score: 0.449104512345,
      d_plus: 0.234567891,
      d_minus: 0.191234567,
      rank: 2,
      breakdown: {},
    },
  ],
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <TopsisResultsPage />
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe('TopsisResultsPage', () => {
  beforeEach(() => {
    topsisMock.mockReset();
  });

  it('memanggil endpoint TOPSIS (bukan SAW) dan menampilkan skor 6 desimal', async () => {
    topsisMock.mockResolvedValue({ success: true, message: 'ok', data: fixture });

    renderPage();

    expect((await screen.findAllByText('Kandidat Alpha')).length).toBeGreaterThan(0);
    expect(topsisMock).toHaveBeenCalledTimes(1);

    // Tampilan dibulatkan 6 desimal; backend tetap presisi penuh.
    expect(screen.getAllByText('0.656679').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0.449105').length).toBeGreaterThan(0);
    expect(screen.queryByText('65.6679')).not.toBeInTheDocument();
  });

  it('menampilkan peringkat, D+, D-, dan nama DM dari response backend', async () => {
    topsisMock.mockResolvedValue({ success: true, message: 'ok', data: fixture });

    renderPage();

    expect((await screen.findAllByText('Ketua Panel')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Peringkat 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Peringkat 2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('D+ 0.123457 · D− 0.234568').length).toBeGreaterThan(0);
  });

  it('urutan tabel mengikuti rank dari API, bukan urutan array', async () => {
    topsisMock.mockResolvedValue({
      success: true,
      message: 'ok',
      data: { ...fixture, rankings: [...fixture.rankings].reverse() },
    });

    renderPage();

    await screen.findAllByText('Kandidat Alpha');
    const rows = screen.getAllByRole('row');
    const dataRows = rows.slice(1, 3);
    expect(dataRows[0]).toHaveTextContent('Kandidat Alpha');
    expect(dataRows[1]).toHaveTextContent('Kandidat Beta');
  });

  it('menampilkan state loading sebelum response datang', async () => {
    topsisMock.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(document.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Hasil Perhitungan TOPSIS')).not.toBeInTheDocument();
  });

  it('menampilkan error 409 (prasyarat belum final) dengan tombol Coba Lagi', async () => {
    topsisMock.mockRejectedValue(new ApiError(409, 'Anda harus menyelesaikan penilaian terlebih dahulu.'));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Anda harus menyelesaikan penilaian terlebih dahulu.');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    await waitFor(() => expect(topsisMock).toHaveBeenCalledTimes(2));
  });

  it('menampilkan pesan gagal umum tanpa data dummy', async () => {
    topsisMock.mockResolvedValue({ success: false, message: 'Gagal memuat hasil TOPSIS', data: null });

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat hasil TOPSIS');
    expect(screen.queryByText('Kandidat Alpha')).not.toBeInTheDocument();
    expect(screen.queryByText('0.656679')).not.toBeInTheDocument();
  });

  it('tidak menampilkan data dummy saat API kosong', async () => {
    topsisMock.mockResolvedValue({ success: true, message: 'ok', data: null });

    renderPage();

    await waitFor(() => expect(topsisMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Kandidat Alpha')).not.toBeInTheDocument();
    expect(screen.queryByText('0.656679')).not.toBeInTheDocument();
  });

  it('menggunakan istilah metode TOPSIS dan menjelaskan rentang skor 0–1', async () => {
    topsisMock.mockResolvedValue({ success: true, message: 'ok', data: fixture });

    renderPage();

    expect(await screen.findByText('Ranking Alternatif — Nilai Preferensi TOPSIS')).toBeInTheDocument();
    expect(screen.getByText(/Solusi Ideal Positif \(A\+\)/)).toBeInTheDocument();
    expect(screen.getByText(/bukan persentase voting/)).toBeInTheDocument();
  });
});
