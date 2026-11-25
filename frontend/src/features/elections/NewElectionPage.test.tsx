import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { NewElectionPage } from './NewElectionPage';
import { ToastProvider } from '@/components/ui/Toast';
import { ElectionSummary, VotingStatusResponse } from '@/types';
import { describeApiError } from '@/services/api';

const getElectionsMock = vi.fn();
const getVotingStatusMock = vi.fn();
const createElectionMock = vi.fn();
const authState = vi.hoisted(() => ({ role: 'chair' }));

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>();
  return {
    ...actual,
    api: {
      getElections: () => getElectionsMock(),
      getVotingStatus: () => getVotingStatusMock(),
      createElection: (title: string, description: string | null) =>
        createElectionMock(title, description),
    },
  };
});

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: 'dm1',
      name: 'Ketua Panel',
      role: authState.role,
    },
  }),
}));

function makeElection(overrides: Partial<ElectionSummary> = {}): ElectionSummary {
  return {
    id: 1,
    title: 'Pemilihan 2026',
    description: null,
    status: 'ratified',
    current_round: 1,
    created_by: null,
    previous_session_id: null,
    created_at: '2026-11-04T14:11:17',
    updated_at: '2026-11-19T13:47:40',
    electorate_count: 3,
    round_count: 1,
    is_active: true,
    final_candidate: 'Kandidat A',
    can_create_election: true,
    ...overrides,
  };
}

function makeStatus(): VotingStatusResponse {
  return {
    session_id: 1,
    session_status: 'ratified',
    current_round: 1,
    round_id: 1,
    is_voting_open: false,
    has_voted_this_round: true,
    votes_cast_in_round: 3,
    eligible_voters: 3,
    required_votes: 3,
    majority_threshold: 2,
    is_eligible: true,
    evaluation: null,
    ratified_decision: null,
    can_chair_open: false,
    can_chair_approve: false,
    electorate: [
      { user_id: 1, username: 'dm1', name: 'Ketua Panel', role: 'chair', has_voted: true, voted_at: '2026-11-04 21:57:57' },
      { user_id: 2, username: 'dm2', name: 'Anggota Panel 1', role: 'member', has_voted: true, voted_at: '2026-11-19 13:15:59' },
      { user_id: 3, username: 'dm3', name: 'Anggota Panel 2', role: 'member', has_voted: true, voted_at: '2026-11-19 13:46:15' },
    ],
  };
}

function ok<T>(data: T) {
  return { success: true, message: 'ok', data };
}

function renderPage(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <NewElectionPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe('Phase 4 — Buat Siklus Pemilihan Baru', () => {
  let client: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    authState.role = 'chair';
    getElectionsMock.mockResolvedValue(ok([makeElection()]));
    getVotingStatusMock.mockResolvedValue(ok(makeStatus()));
    createElectionMock.mockResolvedValue(
      ok({
        session_id: 2,
        title: 'Pemilihan 2027',
        description: null,
        status: 'assessment',
        current_round: 0,
        previous_session_id: 1,
        created_by: 1,
        electorate: [],
        message: 'Siklus pemilihan #2 berhasil dibuat.',
      })
    );
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => client.clear());

  it('1. Anggota Panel tidak melihat formulir (403 ditolak di UI)', async () => {
    authState.role = 'member';
    renderPage(client);
    expect(await screen.findByTestId('new-election-forbidden')).toBeInTheDocument();
    expect(screen.queryByTestId('new-election-page')).not.toBeInTheDocument();
    expect(createElectionMock).not.toHaveBeenCalled();
  });

  it('2. Sesi aktif belum ratified → formulir terkunci dengan alasan', async () => {
    getElectionsMock.mockResolvedValue(
      ok([makeElection({ status: 'voting', final_candidate: null, can_create_election: false })])
    );
    renderPage(client);

    expect(await screen.findByTestId('election-blocked')).toBeInTheDocument();
    expect(screen.getByTestId('election-title-input')).toBeDisabled();
    expect(screen.getByTestId('create-election-open-confirm')).toBeDisabled();
    expect(createElectionMock).not.toHaveBeenCalled();
  });

  it('3. Ratified → konfirmasi menampilkan tepat 3 electorate, submit mengirim judul & deskripsi', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const user = userEvent.setup();
    renderPage(client);

    await screen.findByTestId('create-election-open-confirm');
    await user.type(screen.getByTestId('election-title-input'), '  Pemilihan 2027  ');
    await user.type(screen.getByTestId('election-description-input'), 'Catatan uji');
    await user.click(screen.getByTestId('create-election-open-confirm'));

    expect(await screen.findByTestId('election-confirm-modal')).toBeInTheDocument();
    const items = screen.getByTestId('confirm-electorate-list').querySelectorAll('li');
    expect(items).toHaveLength(3);
    expect(screen.getByTestId('confirm-electorate-dm1')).toHaveTextContent('Perwakilan MPR (dm1)');
    expect(screen.getByTestId('confirm-electorate-dm2')).toHaveTextContent('Perwakilan DPR (dm2)');
    expect(screen.getByTestId('confirm-electorate-dm3')).toHaveTextContent('Utusan Daerah (dm3)');

    await user.click(screen.getByTestId('create-election-submit'));

    await waitFor(() =>
      expect(createElectionMock).toHaveBeenCalledWith('Pemilihan 2027', 'Catatan uji')
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['elections'] })
      )
    );
  });

  it('4. Judul kosong tidak dapat melanjutkan', async () => {
    renderPage(client);
    await screen.findByTestId('create-election-open-confirm');
    expect(screen.getByTestId('create-election-open-confirm')).toBeDisabled();
    expect(createElectionMock).not.toHaveBeenCalled();
  });

  it('5. Error 409 (sesi bukan ratified) ditampilkan, modal tetap terbuka', async () => {
    const user = userEvent.setup();
    const errorMsg = 'Pemilihan baru hanya dapat dibuat setelah sesi sebelumnya disahkan (ratified).';
    createElectionMock.mockRejectedValue(new Error(errorMsg));
    // describeApiError dipakai di komponen; spy agar mengembalikan pesan backend
    const describeSpy = vi.spyOn({ describeApiError }, 'describeApiError');
    describeSpy.mockImplementation(() => errorMsg);
    renderPage(client);

    await screen.findByTestId('create-election-open-confirm');
    await user.type(screen.getByTestId('election-title-input'), 'Pemilihan Baru');
    await user.click(screen.getByTestId('create-election-open-confirm'));
    await user.click(await screen.findByTestId('create-election-submit'));

    expect(await screen.findByTestId('create-election-error')).toHaveTextContent(errorMsg);
    expect(screen.getByTestId('election-confirm-modal')).toBeInTheDocument();
    describeSpy.mockRestore();
  });
});
