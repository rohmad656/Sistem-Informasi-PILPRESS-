import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { getDmDisplayName } from '@/utils/dmIdentity';
import { useMyAssessments, useAssessmentStatus, useFinalizeAssessments, useCandidates, useCriteria } from './useAssessmentData';
import { CheckCircle, Clock, Eye, Pencil, CheckCircle2, AlertTriangle } from 'lucide-react';

export const AssessmentOverviewPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: assessments, isLoading: assLoading, error: assError } = useMyAssessments();
  const { data: status, isLoading: statusLoading, error: statusError } = useAssessmentStatus();
  const { data: candidates, isLoading: candLoading } = useCandidates();
  const { data: criteria, isLoading: critLoading } = useCriteria();
  const finalizeAssessmentsMut = useFinalizeAssessments();

  const [showFinalizeModal, setShowFinalizeModal] = useState(false);

  const isLoading = assLoading || statusLoading || candLoading || critLoading;
  const isError = assError || statusError;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-navy-800 border-t-gold-accent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600">Memuat data penilaian...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <p className="text-red-700 font-medium">
          {assError instanceof Error ? assError.message : statusError instanceof Error ? statusError.message : 'Gagal memuat'}
        </p>
      </div>
    );
  }

  const totalExpected = (candidates?.length || 0) * (criteria?.length || 0);
  const itemsFilled = assessments?.items?.length || 0;
  const completionPercent = totalExpected > 0 ? Math.round((itemsFilled / totalExpected) * 100) : 0;
  const isComplete = itemsFilled === totalExpected && totalExpected > 0;
  const isFinalized = assessments?.is_finalized;

  const statusBadgeColor = isFinalized ? 'bg-green-100 text-green-800' : isComplete ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800';
  const statusLabel = isFinalized ? 'Sudah Difinalisasi' : isComplete ? 'Siap Difinalisasi' : 'Sedang Dikerjakan';

  const handleFinalize = async () => {
    try {
      await finalizeAssessmentsMut.mutateAsync();
      setShowFinalizeModal(false);
    } catch {
      // Error handled by mutation
    }
  };

  return (
    <div className="space-y-6">
      {/* Main Status Card */}
      <div className="bg-gradient-to-r from-navy-800 to-navy-900 text-white rounded-xl p-8 shadow-lg">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Penilaian Kandidat</h1>
            <p className="text-slate-300">{user ? getDmDisplayName({ username: user.username, name: user.name }) : 'Pengguna'}</p>
            <p className="text-sm text-slate-400 mt-2">{user?.role === 'chair' ? 'Ketua Panel' : 'Anggota Panel'}</p>
          </div>
          <div className={`px-4 py-2 rounded-lg font-semibold text-sm ${statusBadgeColor}`}>
            {statusLabel}
          </div>
        </div>
      </div>

      {/* Completion Card */}
      <div className="bg-white rounded-xl shadow border border-slate-100 p-6">
        <h2 className="text-lg font-bold text-navy-800 mb-4">Kelengkapan Penilaian</h2>
        <div className="space-y-4">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-sm text-slate-600 mb-1">Item yang terisi</p>
              <p className="text-4xl font-bold text-navy-800">
                {itemsFilled}<span className="text-xl text-slate-400">/{totalExpected}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-gold-accent">{completionPercent}%</p>
            </div>
          </div>
          <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-gold-accent to-gold-hover transition-all duration-500"
              style={{ width: `${completionPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
          <p className="text-sm text-slate-600 mb-1">Kandidat</p>
          <p className="text-2xl font-bold text-navy-800">{candidates?.length || 0}</p>
          <p className="text-xs text-slate-500 mt-2">Total kandidat calon presiden</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-purple-500">
          <p className="text-sm text-slate-600 mb-1">Kriteria</p>
          <p className="text-2xl font-bold text-navy-800">{criteria?.length || 0}</p>
          <p className="text-xs text-slate-500 mt-2">Total kriteria penilaian</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-500">
          <p className="text-sm text-slate-600 mb-1">Bobot Total</p>
          <p className="text-2xl font-bold text-navy-800">
            {criteria?.reduce((sum, c) => sum + c.weight, 0) || 0}%
          </p>
          <p className="text-xs text-slate-500 mt-2">Jumlah bobot kriteria</p>
        </div>
      </div>

      {/* Criteria Reference */}
      <div className="bg-white rounded-xl shadow border border-slate-100 p-6">
        <h3 className="text-lg font-bold text-navy-800 mb-4">Referensi Kriteria</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {criteria?.map((c) => (
            <div key={c.id} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-navy-800 text-white flex items-center justify-center font-bold text-sm">
                {c.code}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800 text-sm">{c.name}</p>
                <p className="text-xs text-slate-500 mt-1">{c.weight}% bobot</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Panel Status */}
      {status && (
        <div className="bg-white rounded-xl shadow border border-slate-100 p-6">
          <h3 className="text-lg font-bold text-navy-800 mb-4">Status Panel Penilaian</h3>
          <div className="space-y-2">
            {status.panel.map((p) => (
              <div key={p.user_id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div>
                  <p className="font-semibold text-slate-800 text-sm">{getDmDisplayName({ username: p.username, name: p.name })}</p>
                  <p className="text-xs text-slate-500">{p.role === 'chair' ? 'Ketua Panel' : 'Anggota Panel'}</p>
                </div>
                <div>
                  {p.is_finalized ? (
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold">
                        <CheckCircle className="w-3.5 h-3.5 inline mr-1" /> Selesai
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(p.finalized_at || '').toLocaleString('id-ID')}
                      </span>
                    </div>
                  ) : (
                    <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-semibold">
                      <Clock className="w-3.5 h-3.5 inline mr-1" /> Proses
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-900 font-semibold mb-1">Status Keseluruhan</p>
            <p className="text-sm text-blue-800">
              {status.all_finalized ? <><CheckCircle className="w-4 h-4 inline mr-1" /> Semua panel sudah selesai</> : <><Clock className="w-4 h-4 inline mr-1" /> Menunggu panel lainnya menyelesaikan penilaian</>}
            </p>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 justify-end flex-wrap">
        <button
          onClick={() => navigate('/assessments/input')}
          className="px-6 py-3 bg-navy-800 text-white font-semibold rounded-lg hover:bg-navy-900 transition"
        >
          {isFinalized ? (
            <span className="inline-flex items-center gap-2"><Eye className="w-4 h-4" /> Lihat Penilaian</span>
          ) : (
            <span className="inline-flex items-center gap-2"><Pencil className="w-4 h-4" /> Isi/Edit Penilaian</span>
          )}
        </button>
        {isComplete && !isFinalized && (
          <button
            onClick={() => setShowFinalizeModal(true)}
            className="px-6 py-3 bg-gold-accent text-navy-800 font-semibold rounded-lg hover:bg-gold-hover transition"
          >
            <span className="inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Finalisasi Penilaian</span>
          </button>
        )}
      </div>

      {/* Finalize Modal */}
      {showFinalizeModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={() => setShowFinalizeModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="finalize-title"
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
          >
            <h3 id="finalize-title" className="text-xl font-bold text-navy-800 mb-2">Finalisasi Penilaian</h3>
            <p className="text-slate-600 mb-4">
              Apakah Anda yakin ingin menyelesaikan penilaian?
            </p>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-yellow-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>Pastikan seluruh nilai sudah benar. Setelah penilaian difinalisasi, perubahan mungkin tidak dapat dilakukan lagi.</span>
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowFinalizeModal(false)}
                className="flex-1 px-4 py-2 bg-slate-200 text-slate-800 font-semibold rounded-lg hover:bg-slate-300 transition"
              >
                Batal
              </button>
              <button
                onClick={handleFinalize}
                disabled={finalizeAssessmentsMut.isPending}
                className="flex-1 px-4 py-2 bg-gold-accent text-navy-800 font-semibold rounded-lg hover:bg-gold-hover transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {finalizeAssessmentsMut.isPending ? 'Proses...' : 'Ya, Finalisasi'}
              </button>
            </div>
            {finalizeAssessmentsMut.error && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">
                  {finalizeAssessmentsMut.error instanceof Error ? finalizeAssessmentsMut.error.message : 'Gagal finalisasi'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
