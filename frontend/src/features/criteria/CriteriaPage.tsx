import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, describeApiError } from '@/services/api';
import { Criterion } from '@/types';
import { useAuth } from '@/features/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import {
  AlertTriangle,
  PlusCircle,
  Pencil,
  Trash2,
  CheckCircle,
  Lock,
  Scale,
  Sparkles,
  Info,
} from 'lucide-react';

interface FormState {
  id?: number;
  name: string;
  description: string;
  weight: number;
  type: 'benefit' | 'cost';
}

const emptyForm: FormState = {
  name: '',
  description: '',
  weight: 10,
  type: 'benefit',
};

export const CriteriaPage: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const isChair = user?.role === 'chair';

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [confirmFinalize, setConfirmFinalize] = useState(false);

  const { data: criteriaData, isLoading, error, refetch } = useQuery({
    queryKey: ['criteria'],
    queryFn: async () => {
      const res = await api.getCriteria();
      if (res.success && res.data) return res.data;
      throw new Error(res.message || 'Gagal memuat kriteria');
    },
  });

  const { data: summaryData } = useQuery({
    queryKey: ['criteria-summary'],
    queryFn: async () => {
      const res = await api.getCriteriaSummary();
      if (res.success && res.data) return res.data;
      return null;
    },
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['criteria'] });
    queryClient.invalidateQueries({ queryKey: ['criteria-summary'] });
  };

  const createMutation = useMutation({
    mutationFn: async (payload: FormState) => {
      const res = await api.createCriterion({
        name: payload.name,
        description: payload.description || undefined,
        weight: Number(payload.weight),
        type: payload.type,
      });
      if (!res.success) throw new Error(res.message);
      return res;
    },
    onSuccess: (res) => {
      toast.success(res.message || 'Kriteria berhasil ditambahkan');
      setFormOpen(false);
      setForm(emptyForm);
      invalidateAll();
    },
    onError: (err) => {
      toast.error(describeApiError(err, 'Gagal menambahkan kriteria'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: FormState) => {
      if (!payload.id) throw new Error('ID kriteria tidak valid');
      const res = await api.updateCriterion(payload.id, {
        name: payload.name,
        description: payload.description || undefined,
        weight: Number(payload.weight),
        type: payload.type,
      });
      if (!res.success) throw new Error(res.message);
      return res;
    },
    onSuccess: (res) => {
      toast.success(res.message || 'Kriteria berhasil diperbarui');
      setFormOpen(false);
      setForm(emptyForm);
      invalidateAll();
    },
    onError: (err) => {
      toast.error(describeApiError(err, 'Gagal memperbarui kriteria'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.deleteCriterion(id);
      if (!res.success) throw new Error(res.message);
      return res;
    },
    onSuccess: (res) => {
      toast.success(res.message || 'Kriteria berhasil dihapus');
      invalidateAll();
    },
    onError: (err) => {
      toast.error(describeApiError(err, 'Gagal menghapus kriteria'));
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      const res = await api.finalizeCriteria();
      if (!res.success) throw new Error(res.message);
      return res;
    },
    onSuccess: (res) => {
      toast.success(res.message || 'Kriteria berhasil difinalisasi');
      setConfirmFinalize(false);
      invalidateAll();
    },
    onError: (err) => {
      toast.error(describeApiError(err, 'Gagal memfinalisasi kriteria'));
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-navy-800 mb-4">Kriteria Penilaian</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-lg shadow p-5 animate-pulse">
              <div className="w-10 h-10 rounded-full bg-navy-100 mb-3" />
              <div className="h-5 w-3/4 bg-navy-100 rounded mb-2" />
              <div className="h-4 w-1/2 bg-navy-100 rounded mb-2" />
              <div className="h-3 w-full bg-navy-100 rounded mt-2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-navy-800 mb-4">Kriteria Penilaian</h2>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <div className="flex justify-center mb-3">
            <AlertTriangle className="w-10 h-10 text-red-500" />
          </div>
          <p className="text-red-700 font-medium">
            {error instanceof Error ? error.message : 'Gagal memuat'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 bg-navy-800 text-white rounded-lg hover:bg-navy-900 transition text-sm font-medium"
          >
            Coba Lagi
          </button>
        </div>
      </div>
    );
  }

  const criteria = (criteriaData ?? []) as Criterion[];
  const totalWeight = criteria.reduce((sum, c) => sum + Number(c.weight), 0);
  const isFinalized = summaryData?.is_finalized ?? criteria.every((c) => Boolean(c.is_finalized));
  const canManage = isChair && (summaryData?.can_manage ?? !isFinalized);
  const canFinalize = isChair && (summaryData?.can_finalize ?? (!isFinalized && totalWeight === 100 && criteria.length > 0));

  const openEdit = (c: Criterion) => {
    setForm({
      id: c.id,
      name: c.name,
      description: c.description || '',
      weight: c.weight,
      type: c.type,
    });
    setFormOpen(true);
  };

  const openCreate = () => {
    setForm(emptyForm);
    setFormOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.id) {
      updateMutation.mutate(form);
    } else {
      createMutation.mutate(form);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-navy-800">Kriteria Penilaian</h2>
            {isFinalized ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 border border-green-200">
                <Lock className="w-3.5 h-3.5" /> Terfinalisasi
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                <Sparkles className="w-3.5 h-3.5" /> Draft / Pengaturan
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1">
            {isChair
              ? isFinalized
                ? 'Kriteria sudah dikunci dan siap digunakan dalam proses penilaian.'
                : 'Ketua Panel: tentukan kriteria, bobot (total wajib 100%), lalu finalisasi sebelum penilaian.'
              : 'Daftar kriteria resmi yang digunakan dalam penilaian TOPSIS dan Borda.'}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg shadow border border-slate-200">
            <Scale className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-medium text-slate-600">Total Bobot:</span>
            <span className={`text-sm font-bold ${totalWeight === 100 ? 'text-green-600' : 'text-red-600'}`}>
              {totalWeight}% / 100%
            </span>
          </div>

          {canManage && (
            <>
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-2 px-4 py-2 bg-navy-800 text-white rounded-lg hover:bg-navy-900 transition text-sm font-medium shadow-sm"
              >
                <PlusCircle className="w-4 h-4" /> Tambah Kriteria
              </button>

              <button
                type="button"
                disabled={!canFinalize || finalizeMutation.isPending}
                onClick={() => setConfirmFinalize(true)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg transition text-sm font-medium shadow-sm ${
                  canFinalize
                    ? 'bg-green-600 hover:bg-green-700 text-white cursor-pointer'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
                title={
                  totalWeight !== 100
                    ? `Total bobot saat ini ${totalWeight}%. Harus tepat 100% untuk difinalisasi.`
                    : 'Kunci kriteria untuk memulai penilaian.'
                }
              >
                <CheckCircle className="w-4 h-4" /> Finalisasi Kriteria
              </button>
            </>
          )}
        </div>
      </div>

      {/* Info notice for total weight */}
      {canManage && totalWeight !== 100 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <span className="font-semibold">Perhatian Bobot:</span> Total bobot kriteria saat ini adalah {totalWeight}%.
            Untuk dapat difinalisasi, total bobot harus tepat <strong>100%</strong> (tersisa {100 - totalWeight}%).
          </div>
        </div>
      )}

      {/* Criteria Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {criteria.map((c) => {
          const isBenefit = c.type === 'benefit';
          const barWidth = `${Math.min(100, Math.max(0, c.weight))}%`;
          return (
            <div key={c.id} className="bg-white rounded-xl shadow p-6 border border-slate-100 flex flex-col justify-between">
              <div>
                <div className="flex items-start gap-4 mb-3">
                  <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-navy-800 flex items-center justify-center">
                    <span className="text-white font-bold text-lg">{c.code}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-navy-800 leading-tight">{c.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                          isBenefit ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {isBenefit ? '↑ Benefit' : '↓ Cost'}
                      </span>
                      {c.description && (
                        <span className="text-xs text-slate-500 truncate" title={c.description}>
                          {c.description}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <span className="text-2xl font-extrabold text-navy-800">{c.weight}</span>
                    <span className="text-sm text-slate-500">%</span>
                  </div>
                </div>

                {/* Weight bar */}
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden mb-3">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isBenefit ? 'bg-green-500' : 'bg-red-400'
                    }`}
                    style={{ width: barWidth }}
                  />
                </div>
              </div>

              {/* Action buttons (chair & not finalized) */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                <span>Skala penilaian: 1 – 5</span>
                {canManage && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(c)}
                      className="p-1.5 rounded hover:bg-slate-100 text-navy-700 transition"
                      title="Ubah kriteria"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Hapus kriteria "${c.name}"?`)) {
                          deleteMutation.mutate(c.id);
                        }
                      }}
                      className="p-1.5 rounded hover:bg-red-50 text-red-600 transition"
                      title="Hapus kriteria"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {criteria.length === 0 && (
        <div className="bg-white rounded-xl shadow p-8 text-center text-slate-500">
          Belum ada kriteria untuk sesi ini. {canManage && 'Klik "Tambah Kriteria" untuk membuat kriteria baru.'}
        </div>
      )}

      {/* Summary table */}
      <div className="bg-white rounded-xl shadow border border-slate-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-navy-800 text-sm">Ringkasan Bobot Kriteria</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[26rem]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-left">
                <th className="px-5 py-3 font-semibold text-slate-600">Kode</th>
                <th className="px-5 py-3 font-semibold text-slate-600">Kriteria</th>
                <th className="px-5 py-3 font-semibold text-slate-600">Tipe</th>
                <th className="px-5 py-3 font-semibold text-slate-600 text-right">Bobot</th>
              </tr>
            </thead>
            <tbody>
              {criteria.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 font-mono font-semibold text-navy-700">{c.code}</td>
                  <td className="px-5 py-3 text-slate-700">{c.name}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        c.type === 'benefit' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {c.type === 'benefit' ? 'Benefit' : 'Cost'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-bold text-navy-800">{c.weight}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t-2 border-slate-200">
                <td colSpan={3} className="px-5 py-3 font-bold text-slate-700 text-right">
                  Total
                </td>
                <td
                  className={`px-5 py-3 font-bold text-right ${
                    totalWeight === 100 ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {totalWeight}%
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Modal Form Tambah / Ubah */}
      {formOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-navy-800 mb-4">
              {form.id ? 'Ubah Kriteria' : 'Tambah Kriteria Baru'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Kriteria *</label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="contoh: Integritas dan Rekam Jejak"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Deskripsi</label>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Keterangan singkat kriteria..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Bobot (%) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={100}
                    value={form.weight}
                    onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tipe *</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as 'benefit' | 'cost' })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600"
                  >
                    <option value="benefit">Benefit (Makin tinggi makin baik)</option>
                    <option value="cost">Cost (Makin rendah makin baik)</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm hover:bg-slate-50 transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="px-4 py-2 bg-navy-800 text-white rounded-lg text-sm font-medium hover:bg-navy-900 transition disabled:opacity-50"
                >
                  {form.id ? 'Simpan Perubahan' : 'Tambah'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Finalisasi */}
      {confirmFinalize && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-navy-800 mb-2">Konfirmasi Finalisasi Kriteria</h3>
            <p className="text-sm text-slate-600 mb-4">
              Setelah difinalisasi, kriteria dan bobot akan <strong>dikunci permanen</strong> dan tidak dapat diubah
              atau dihapus. Anggota panel dapat langsung memulai pengisian penilaian.
            </p>
            <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-700 mb-4">
              Total {criteria.length} kriteria dengan total bobot {totalWeight}%.
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmFinalize(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm hover:bg-slate-50 transition"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={finalizeMutation.isPending}
                onClick={() => finalizeMutation.mutate()}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition disabled:opacity-50"
              >
                {finalizeMutation.isPending ? 'Memproses...' : 'Ya, Finalisasi Kriteria'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
