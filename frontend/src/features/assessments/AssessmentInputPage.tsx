import React, { useState, useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { getDmDisplayName } from '@/utils/dmIdentity';
import { useCandidates, useCriteria, useMyAssessments, useSaveAssessments } from './useAssessmentData';

type ScoreMatrix = Record<string, number | undefined>;

export const AssessmentInputPage: React.FC = () => {
  const { user } = useAuth();
  const { data: candidates, isLoading: candLoading, error: candError } = useCandidates();
  const { data: criteria, isLoading: critLoading, error: critError } = useCriteria();
  const { data: assessments, isLoading: assLoading, error: assError } = useMyAssessments();
  const saveAssessmentsMut = useSaveAssessments();

  // Initialize scores from API or empty
  const [scores, setScores] = useState<ScoreMatrix>(() => {
    if (!assessments?.items) return {};
    const map: ScoreMatrix = {};
    assessments.items.forEach((item) => {
      map[`${item.candidate_id}:${item.criterion_id}`] = item.score;
    });
    return map;
  });

  const [showNotification, setShowNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Calculate completion
  const completion = useMemo(() => {
    if (!candidates || !criteria) return { filled: 0, total: 0 };
    const total = candidates.length * criteria.length;
    const filled = Object.values(scores).filter((v) => v !== undefined).length;
    return { filled, total };
  }, [scores, candidates, criteria]);

  const isComplete = completion.filled === completion.total && completion.total > 0;
  const isFinalized = assessments?.is_finalized;

  const handleScoreChange = (candidateId: number, criterionId: number, value: number | undefined) => {
    setScores((prev) => ({
      ...prev,
      [`${candidateId}:${criterionId}`]: value,
    }));
  };

  const handleSave = async () => {
    if (!isComplete) {
      setShowNotification({ type: 'error', message: 'Penilaian belum lengkap. Semua nilai harus terisi.' });
      return;
    }

    try {
      const items = Object.entries(scores)
        .filter(([, v]) => v !== undefined)
        .map(([key, score]) => {
          const [candId, critId] = key.split(':').map(Number);
          return { candidate_id: candId, criterion_id: critId, score: score! };
        });

      await saveAssessmentsMut.mutateAsync(items);
      setShowNotification({ type: 'success', message: 'Penilaian berhasil disimpan.' });
      setTimeout(() => setShowNotification(null), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan';
      setShowNotification({ type: 'error', message: msg });
    }
  };

  if (candLoading || critLoading || assLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-navy-800 border-t-gold-accent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600">Memuat data penilaian...</p>
        </div>
      </div>
    );
  }

  if (candError || critError || assError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <p className="text-red-700 font-medium">
          {candError instanceof Error ? candError.message : critError instanceof Error ? critError.message : assError instanceof Error ? assError.message : 'Gagal memuat data'}
        </p>
      </div>
    );
  }

  const candList = candidates ?? [];
  const critList = criteria ?? [];

  // Determine readiness
  const criteriaFinalized = critList.length > 0 && critList.every((c) => c.is_finalized);
  const candidatesFinalized = candList.length > 0 && candList.every((c) => c.is_finalized);
  const criteriaAvailable = critList.length > 0;
  const candidatesAvailable = candList.length > 0;

  const isReady = criteriaFinalized && candidatesFinalized;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-navy-800 to-navy-900 text-white rounded-xl p-6 shadow-lg">
        <h1 className="text-2xl font-bold mb-2">Penilaian Kandidat</h1>
        <p className="text-slate-300 mb-4">{user ? getDmDisplayName({ username: user.username, name: user.name }) : 'Pengguna'}</p>
        <div className="flex items-center justify-between text-sm">
          <div>
            <p className="text-slate-400">Kelengkapan Penilaian</p>
            <p className="text-lg font-bold text-gold-accent">
              {completion.filled} / {completion.total} item
            </p>
          </div>
          {isFinalized && (
            <div className="px-3 py-1 bg-green-500 text-white rounded-full text-xs font-semibold inline-flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Sudah Difinalisasi
            </div>
          )}
        </div>
      </div>

      {/* Notification */}
      {showNotification && (
        <div
          className={`p-4 rounded-lg border ${
            showNotification.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {showNotification.message}
        </div>
      )}

      {/* Empty state when master data not ready */}
      {!isReady && (
        <div className="bg-white rounded-xl shadow border border-slate-100 p-8 text-center" data-testid="assessment-empty-state">
          <CheckCircle2 className="w-10 h-10 text-slate-300 mx-auto mb-3" aria-hidden="true" />
          <h2 className="text-lg font-bold text-navy-800">Penilaian belum dapat dimulai</h2>
          <ul className="mt-4 space-y-3 text-left max-w-xl mx-auto text-sm text-slate-600">
            {!criteriaAvailable && (
              <li className="flex items-start gap-2">
                <span className="mt-1 w-2 h-2 rounded-full bg-amber-500 flex-shrink-0"></span>
                <span><strong>Kriteria belum tersedia.</strong> Ketua Panel perlu menambahkan kriteria penilaian terlebih dahulu.</span>
              </li>
            )}
            {criteriaAvailable && !criteriaFinalized && (
              <li className="flex items-start gap-2">
                <span className="mt-1 w-2 h-2 rounded-full bg-amber-500 flex-shrink-0"></span>
                <span><strong>Kriteria belum difinalisasi.</strong> Ketua Panel perlu memfinalisasi konfigurasi kriteria sebelum penilaian dibuka.</span>
              </li>
            )}
            {!candidatesAvailable && (
              <li className="flex items-start gap-2">
                <span className="mt-1 w-2 h-2 rounded-full bg-amber-500 flex-shrink-0"></span>
                <span><strong>Kandidat belum tersedia.</strong> Ketua Panel perlu mengajukan kandidat terlebih dahulu.</span>
              </li>
            )}
            {candidatesAvailable && !candidatesFinalized && (
              <li className="flex items-start gap-2">
                <span className="mt-1 w-2 h-2 rounded-full bg-amber-500 flex-shrink-0"></span>
                <span><strong>Kandidat belum difinalisasi.</strong> Ketua Panel perlu memfinalisasi daftar kandidat sebelum penilaian dibuka.</span>
              </li>
            )}
          </ul>
          <p className="mt-5 text-sm text-slate-500">
            Hubungi Ketua Panel untuk menyelesaikan konfigurasi kriteria dan kandidat pada siklus ini.
          </p>
          {user?.role === 'chair' && (
            <p className="mt-2 text-xs text-slate-400">Sebagai Ketua Panel, gunakan menu Kriteria dan Kandidat pada sidebar untuk melengkapi konfigurasi.</p>
          )}
        </div>
      )}

      {/* Matrix */}
      {isReady && (
      <div className="bg-white rounded-xl shadow border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left font-bold text-navy-800">Kandidat</th>
              {critList.map((c) => (
                <th key={c.id} className="px-3 py-3 text-center font-bold text-slate-700">
                  <div className="text-sm font-mono text-navy-700">{c.code}</div>
                  <div className="text-xs text-slate-500 mt-1">{c.weight}%</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {candList.map((cand) => (
              <tr key={cand.id} className="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 font-semibold text-navy-800">{cand.name}</td>
                {critList.map((crit) => {
                  const key = `${cand.id}:${crit.id}`;
                  const currentScore = scores[key];
                  return (
                    <td key={crit.id} className="px-3 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {[1, 2, 3, 4, 5].map((val) => (
                          <button
                            key={val}
                            onClick={() => handleScoreChange(cand.id, crit.id, val)}
                            disabled={isFinalized}
                            aria-label={`Nilai ${val} untuk ${cand.name} pada kriteria ${crit.code}`}
                            aria-pressed={currentScore === val}
                            className={`w-10 h-10 rounded-lg font-bold transition-all focus:outline-none focus:ring-2 focus:ring-gold-accent ${
                              currentScore === val
                                ? 'bg-navy-800 text-white ring-2 ring-gold-accent'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            } ${isFinalized ? 'opacity-60 cursor-not-allowed' : ''}`}
                          >
                            {val}
                          </button>
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {/* Actions */}
      {isReady && !isFinalized && (
        <div className="flex gap-3 justify-end">
          <button
            onClick={handleSave}
            disabled={saveAssessmentsMut.isPending || !isComplete}
            className="px-6 py-2 bg-navy-800 text-white font-semibold rounded-lg hover:bg-navy-900 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveAssessmentsMut.isPending ? 'Menyimpan...' : 'Simpan Penilaian'}
          </button>
        </div>
      )}
    </div>
  );
};
