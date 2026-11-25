import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, describeApiError } from '@/services/api';
import { useAuth } from '@/features/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { getDmDisplayName } from '@/utils/dmIdentity';
import { AlertTriangle, ArrowLeft, Check, ChevronRight, Lock, PlusCircle, ShieldCheck, Users } from 'lucide-react';

/** Label peran panel resmi — identitas diverifikasi backend dari tabel users. */
const roleLabel = (role: string): string =>
  role === 'chair' ? 'Ketua Panel' : role === 'member' ? 'Anggota Panel' : 'Pemilih';

export const NewElectionPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isChair = user?.role === 'chair';

  const electionsQuery = useQuery({
    queryKey: ['elections'],
    queryFn: async () => {
      const res = await api.getElections();
      if (res.success && res.data) return res.data;
      throw new Error(res.message || 'Gagal memuat daftar siklus pemilihan');
    },
    enabled: isChair,
  });

  const statusQuery = useQuery({
    queryKey: ['voting', 'status'],
    queryFn: async () => {
      const res = await api.getVotingStatus();
      if (res.success && res.data) return res.data;
      throw new Error(res.message || 'Gagal memuat electorate resmi');
    },
    enabled: isChair,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await api.createElection(title.trim(), description.trim() || null);
      if (res.success && res.data) return res.data;
      throw new Error(res.message || 'Gagal membuat siklus pemilihan');
    },
    onSuccess: (data) => {
      // Semua halaman harus melihat sesi aktif yang baru, tanpa hardcode.
      queryClient.invalidateQueries({ queryKey: ['elections'] });
      queryClient.invalidateQueries({ queryKey: ['voting', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['voting', 'results'] });
      queryClient.invalidateQueries({ queryKey: ['decisions', 'final'] });
      queryClient.invalidateQueries({ queryKey: ['decisions', 'history'] });
      queryClient.invalidateQueries({ queryKey: ['assessments'] });
      queryClient.invalidateQueries({ queryKey: ['results'] });
      queryClient.invalidateQueries({ queryKey: ['criteria'] });
      queryClient.invalidateQueries({ queryKey: ['criteria-summary'] });
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      setConfirmOpen(false);
      setTitle('');
      setDescription('');
      toast.success('Siklus pemilihan berhasil dibuat.', data.message);
      navigate('/elections');
    },
    onError: (err) => {
      toast.error('Pembuatan siklus gagal.', describeApiError(err, 'Silakan coba lagi.'));
    },
  });

  if (!isChair) {
    return (
      <div className="space-y-4" data-testid="new-election-forbidden">
        <h1 className="text-2xl font-bold text-navy-800">Pemilihan Baru</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 flex items-start gap-3">
          <Lock className="w-5 h-5 text-amber-700 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-amber-900">Akses ditolak</p>
            <p className="text-sm text-amber-800 mt-1">
              Hanya Ketua Panel yang dapat membuat siklus pemilihan baru.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const active = electionsQuery.data?.find((e) => e.is_active) ?? null;
  const electorate = statusQuery.data?.electorate ?? [];
  const canCreate = active?.can_create_election === true && active.status === 'ratified';
  const titleValid = title.trim().length > 0 && title.trim().length <= 150;
  const descriptionValid = description.trim().length <= 1000;
  const isLoading = electionsQuery.isLoading || statusQuery.isLoading;

  const handleConfirmOpen = () => {
    if (!canCreate || !titleValid || !descriptionValid || createMut.isPending) return;
    setConfirmOpen(true);
  };

  const handleSubmit = () => {
    if (!canCreate || !titleValid || !descriptionValid || createMut.isPending) return;
    createMut.mutate();
  };

  return (
    <div className="space-y-6" data-testid="new-election-page">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy-800">Buat Siklus Pemilihan Baru</h1>
          <p className="text-slate-500 mt-1 text-sm">
            Hanya Ketua Panel. Siklus baru dapat dibuat setelah sesi sebelumnya disahkan.
          </p>
        </div>
        <button
          onClick={() => navigate('/elections')}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 hover:text-navy-800 hover:bg-slate-100 rounded-lg transition focus:outline-none focus:ring-2 focus:ring-gold-accent"
        >
          <ArrowLeft className="w-4 h-4" /> Riwayat Pemilihan
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <div className="text-center">
            <div className="w-10 h-10 border-4 border-navy-800 border-t-gold-accent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-slate-600 text-sm">Memeriksa sesi aktif...</p>
          </div>
        </div>
      ) : electionsQuery.error || statusQuery.error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-700 font-medium">
            {describeApiError(
              electionsQuery.error ?? statusQuery.error,
              'Gagal memeriksa prasyarat pemilihan baru.'
            )}
          </p>
          <button
            onClick={() => {
              electionsQuery.refetch();
              statusQuery.refetch();
            }}
            className="mt-4 px-4 py-2 bg-navy-800 text-white rounded-lg text-sm font-medium hover:bg-navy-900 transition"
          >
            Coba Lagi
          </button>
        </div>
      ) : (
        <>
          {/* Prasyarat */}
          <section className="bg-white rounded-xl shadow border border-slate-100 p-5" data-testid="election-prerequisite">
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck className="w-5 h-5 text-navy-800" />
              <h2 className="font-bold text-navy-800">Prasyarat Siklus Baru</h2>
            </div>

            {active ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase">Sesi Aktif</p>
                  <p className="font-semibold text-slate-800 mt-1">#{active.id} — {active.title}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase">Status</p>
                  <p className="mt-1">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                        active.status === 'ratified'
                          ? 'bg-green-100 text-green-800 border-green-200'
                          : 'bg-amber-100 text-amber-800 border-amber-200'
                      }`}
                      data-testid="active-session-status"
                    >
                      {active.status === 'ratified' ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                      {active.status === 'ratified' ? 'Ratified / Disahkan' : active.status}
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase">Keputusan Final</p>
                  <p className="font-medium text-slate-800 mt-1">{active.final_candidate ?? 'Belum tersedia'}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-600">Belum ada sesi pemilihan aktif.</p>
            )}

            {!canCreate && (
              <div className="mt-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3" data-testid="election-blocked">
                <Lock className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-amber-800">
                  Pemilihan baru belum dapat dibuat. Sesi aktif harus berstatus <strong>ratified</strong> dan Anda
                  harus Ketua Panel pada sesi tersebut.
                </p>
              </div>
            )}
          </section>

          {/* Formulir */}
          <section className="bg-white rounded-xl shadow border border-slate-100 p-5">
            <div className="flex items-center gap-2 mb-4">
              <PlusCircle className="w-5 h-5 text-navy-800" />
              <h2 className="font-bold text-navy-800">Detail Pemilihan Baru</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="election-title" className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Judul Pemilihan <span className="text-red-600">*</span>
                </label>
                <input
                  id="election-title"
                  type="text"
                  value={title}
                  maxLength={150}
                  disabled={!canCreate || createMut.isPending}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Contoh: Pemilihan Presiden 2027"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold-accent disabled:bg-slate-100 disabled:text-slate-500"
                  data-testid="election-title-input"
                />
                <p className="text-xs text-slate-500 mt-1">{title.trim().length}/150 karakter</p>
              </div>

              <div>
                <label htmlFor="election-description" className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Deskripsi <span className="font-normal text-slate-400">(opsional)</span>
                </label>
                <textarea
                  id="election-description"
                  rows={3}
                  value={description}
                  maxLength={1000}
                  disabled={!canCreate || createMut.isPending}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Tujuan atau catatan siklus pemilihan ini"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold-accent disabled:bg-slate-100 disabled:text-slate-500"
                  data-testid="election-description-input"
                />
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-4 h-4 text-slate-600" />
                  <p className="text-sm font-semibold text-slate-700">
                    Electorate yang akan disnapshot (3 orang)
                  </p>
                </div>
                <ul className="space-y-2" data-testid="new-election-electorate">
                  {electorate.length > 0 ? (
                    electorate.map((member) => (
                      <li key={member.user_id} className="flex items-center justify-between text-sm">
                        <span className="font-medium text-slate-800">{getDmDisplayName({ username: member.username, name: member.name })} ({member.username})</span>
                        <span className="text-xs text-slate-500">{roleLabel(member.role)}</span>
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-slate-500">Electorate resmi belum tersedia.</li>
                  )}
                </ul>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
                <p className="font-semibold mb-1">Yang TIDAK akan dibuat otomatis:</p>
                <p>suara, kriteria, kandidat, penilaian, putaran voting, dan keputusan final. Sesi lama tetap dapat diakses melalui Riwayat Pemilihan.</p>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => navigate('/elections')}
                  className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleConfirmOpen}
                  disabled={!canCreate || !titleValid || !descriptionValid || createMut.isPending}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-navy-800 text-white rounded-lg text-sm font-semibold hover:bg-navy-900 transition disabled:bg-slate-300 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-gold-accent"
                  data-testid="create-election-open-confirm"
                >
                  Lanjutkan <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </section>
        </>
      )}

      {/* Modal konfirmasi */}
      {confirmOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" data-testid="election-confirm-modal">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-navy-800" />
              <h2 className="text-lg font-bold text-navy-800">Konfirmasi Siklus Pemilihan Baru</h2>
            </div>

            <div className="space-y-2 text-sm">
              <p><span className="text-slate-500">Judul:</span> <strong className="text-slate-800">{title.trim()}</strong></p>
              {description.trim() && <p><span className="text-slate-500">Deskripsi:</span> {description.trim()}</p>}
              <p><span className="text-slate-500">Dibuat dari sesi:</span> <strong className="text-slate-800">#{active?.id} — {active?.title}</strong></p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Snapshot electorate (3 orang)</p>
              <ul className="space-y-1 text-sm" data-testid="confirm-electorate-list">
                {electorate.map((m) => (
                  <li
                    key={m.user_id}
                    className="flex items-center justify-between"
                    data-testid={`confirm-electorate-${m.username}`}
                  >
                    <span className="text-slate-800">{getDmDisplayName({ username: m.username, name: m.name })} ({m.username})</span>
                    <span className="text-xs text-slate-500">{roleLabel(m.role)}</span>
                  </li>
                ))}
              </ul>
            </div>

            {createMut.error && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3" data-testid="create-election-error">
                {describeApiError(createMut.error, 'Pembuatan siklus gagal.')}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={createMut.isPending}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                Kembali
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={createMut.isPending}
                className="px-5 py-2 bg-gold-accent text-navy-900 rounded-lg text-sm font-bold hover:brightness-95 transition disabled:opacity-50"
                data-testid="create-election-submit"
              >
                {createMut.isPending ? 'Membuat...' : 'Buat Pemilihan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
