import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Candidate } from '@/types';
import { AlertTriangle, FileText, ChevronLeft } from 'lucide-react';

export const CandidateDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const candidateId = id ? Number(id) : NaN;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['candidates', id ?? 'new'],
    queryFn: async () => {
      const res = await api.getCandidate(candidateId);
      if (res.success && res.data) return res.data;
      throw new Error(res.message || 'Gagal memuat detail kandidat');
    },
    enabled: !!id && !isNaN(candidateId),
  });

  if (isLoading || (!data && !error)) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-navy-800 mb-4">Detail Kandidat</h2>
        <div className="max-w-md bg-white rounded-lg shadow p-8 animate-pulse">
          <div className="w-12 h-12 rounded-full bg-navy-100 mb-3"></div>
          <div className="h-5 w-3/4 bg-navy-100 rounded mb-2"></div>
          <div className="h-4 w-1/2 bg-navy-100 rounded mb-4"></div>
          <div className="h-4 w-2/3 bg-navy-100 rounded mb-2"></div>
          <div className="h-3 w-full bg-navy-100 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 max-w-md mx-auto">
        <h2 className="text-xl font-bold text-navy-800 mb-4">Detail Kandidat</h2>
        <div className="bg-red-50 border border-red-200 rounded-lg p-8 text-center">
          <div className="text-red-400 mb-3 flex justify-center"><AlertTriangle className="w-10 h-10" /></div>
          <p className="text-red-700 font-medium">{error instanceof Error ? error.message : 'Gagal memuat'}</p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={() => navigate('/candidates')}
              className="px-4 py-2 bg-navy-800 text-white rounded-lg hover:bg-navy-900 transition text-sm font-medium"
            >
              Kembali ke Daftar
            </button>
            <button
              onClick={() => refetch()}
              className="px-4 py-2 bg-gold-accent text-navy-800 rounded-lg hover:bg-gold-hover transition text-sm font-medium"
              disabled={isLoading}
            >
              Coba Lagi
            </button>
          </div>
        </div>
      </div>
    );
  }

  const c = data as Candidate;

  const initials = c.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '?';

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/candidates')}
          className="flex items-center gap-1 text-navy-800 font-semibold hover:text-gold-accent transition-colors text-sm"
        >
          <ChevronLeft className="w-4 h-4" /> Kembali ke Daftar
        </button>
        <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">Detail Kandidat</span>
      </div>

      {c.vision || c.mission || c.description || c.work_program || c.profile ? (
        <article className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-navy-100 to-navy-200 flex items-center justify-center">
                  <span className="text-navy-800 font-bold text-3xl">{initials}</span>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-bold text-navy-800 leading-tight">{c.name}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <span className="px-2 py-1 text-xs font-medium text-navy-700 bg-navy-50 border border-navy-200 rounded-full">
                    ID {c.id}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {c.description && (
              <section>
                <h3 className="font-semibold text-navy-800 mb-2 flex items-center gap-2">
                  <span className="w-5 h-5 bg-gold-accent text-navy-800 rounded flex items-center justify-center text-xs font-bold">D</span>
                  Deskripsi Singkat
                </h3>
                <p className="text-slate-700 leading-relaxed">{c.description}</p>
              </section>
            )}
            {c.vision && (
              <section>
                <h3 className="font-semibold text-navy-800 mb-2 flex items-center gap-2">
                  <span className="w-5 h-5 bg-gold-accent text-navy-800 rounded flex items-center justify-center text-xs font-bold">V</span>
                  Visi
                </h3>
                <p className="text-slate-700 leading-relaxed">{c.vision}</p>
              </section>
            )}
            {c.mission && (
              <section>
                <h3 className="font-semibold text-navy-800 mb-2 flex items-center gap-2">
                  <span className="w-5 h-5 bg-gold-accent text-navy-800 rounded flex items-center justify-center text-xs font-bold">M</span>
                  Misi
                </h3>
                <p className="text-slate-700 leading-relaxed">{c.mission}</p>
              </section>
            )}
            {c.work_program && (
              <section>
                <h3 className="font-semibold text-navy-800 mb-2 flex items-center gap-2">
                  <span className="w-5 h-5 bg-gold-accent text-navy-800 rounded flex items-center justify-center text-xs font-bold">W</span>
                  Program Kerja
                </h3>
                <p className="text-slate-700 leading-relaxed">{c.work_program}</p>
              </section>
            )}
            {c.profile && (
              <section>
                <h3 className="font-semibold text-navy-800 mb-2 flex items-center gap-2">
                  <span className="w-5 h-5 bg-gold-accent text-navy-800 rounded flex items-center justify-center text-xs font-bold">P</span>
                  Profil
                </h3>
                <p className="text-slate-700 leading-relaxed">{c.profile}</p>
              </section>
            )}
          </div>

          <div className="px-6 py-4 border-t border-slate-100 bg-navy-50">
            <p className="text-xs text-slate-600 text-center">
              Informasi profil lengkap adalah data referensi untuk penilaian TOPSIS dan Borda.
            </p>
          </div>
        </article>
      ) : (
        <div className="max-w-md bg-white rounded-lg shadow p-8 text-center border border-slate-200">
          <div className="text-navy-400 mb-3 flex justify-center"><FileText className="w-10 h-10" /></div>
          <h3 className="font-bold text-navy-800 mb-1">Detail tidak tersedia</h3>
          <p className="text-slate-600 text-sm">
            Informasi visi dan misi untuk kandidat ini belum tersedia dari backend.
          </p>
        </div>
      )}
    </div>
  );
};
