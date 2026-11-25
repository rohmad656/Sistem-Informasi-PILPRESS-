import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, describeApiError } from '@/services/api';
import { RefreshCw, ScrollText, Search } from 'lucide-react';
import { getDmDisplayName } from '@/utils/dmIdentity';

const PAGE_SIZE = 25;

const formatDateTime = (value: string): string => {
  try {
    return new Date(value.replace(' ', 'T')).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return value;
  }
};

interface Filters {
  userId: string;
  action: string;
  dateFrom: string;
  dateTo: string;
}

const emptyFilters: Filters = { userId: '', action: '', dateFrom: '', dateTo: '' };

export const AuditLogPage: React.FC = () => {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(0);

  const query = useQuery({
    queryKey: ['audit-logs', page, applied],
    queryFn: async () => {
      const userId = applied.userId ? Number(applied.userId) : undefined;
      const dateTo = applied.dateTo ? `${applied.dateTo} 23:59:59` : undefined;
      const res = await api.getAuditLogs(
        undefined,
        PAGE_SIZE,
        page * PAGE_SIZE,
        userId,
        applied.action || undefined,
        applied.dateFrom || undefined,
        dateTo
      );
      if (res.success && res.data) return res.data;
      throw new Error(res.message || 'Gagal memuat log aktivitas');
    },
  });

  const logs = query.data?.logs ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const applyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    setApplied(filters);
  };

  const resetFilters = () => {
    setFilters(emptyFilters);
    setApplied(emptyFilters);
    setPage(0);
  };

  const update = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6" data-testid="audit-log-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy-800">Log Aktivitas</h1>
          <p className="text-slate-500 mt-1 text-sm">
            Jejak audit siklus pemilihan aktif. Hanya Ketua Panel yang dapat melihat halaman ini.
          </p>
        </div>
        <button
          onClick={() => query.refetch()}
          className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition focus:outline-none focus:ring-2 focus:ring-gold-accent"
          data-testid="audit-refresh"
        >
          <RefreshCw className="w-4 h-4" /> Segarkan
        </button>
      </div>

      <form
        onSubmit={applyFilters}
        className="bg-white rounded-xl shadow border border-slate-100 p-4 md:p-5"
        data-testid="audit-filter-form"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <label className="block">
            <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">ID Aktor</span>
            <input
              type="number"
              min={1}
              value={filters.userId}
              onChange={(e) => update('userId', e.target.value)}
              placeholder="Mis. 1"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gold-accent"
              data-testid="audit-filter-user"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Aksi</span>
            <input
              type="text"
              value={filters.action}
              onChange={(e) => update('action', e.target.value)}
              placeholder="Nama aksi persis"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gold-accent"
              data-testid="audit-filter-action"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Dari Tanggal</span>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => update('dateFrom', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gold-accent"
              data-testid="audit-filter-date-from"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Sampai Tanggal</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => update('dateTo', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gold-accent"
              data-testid="audit-filter-date-to"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-4 py-2 bg-navy-800 text-white rounded-lg text-sm font-semibold hover:bg-navy-900 transition focus:outline-none focus:ring-2 focus:ring-gold-accent"
            data-testid="audit-apply-filter"
          >
            <Search className="w-4 h-4" /> Terapkan Filter
          </button>
          <button
            type="button"
            onClick={resetFilters}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition focus:outline-none focus:ring-2 focus:ring-gold-accent"
            data-testid="audit-reset-filter"
          >
            Reset
          </button>
        </div>
      </form>

      {query.isLoading ? (
        <div className="flex items-center justify-center h-48" data-testid="audit-loading">
          <div className="text-center">
            <div className="w-10 h-10 border-4 border-navy-800 border-t-gold-accent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-slate-600 text-sm">Memuat log aktivitas...</p>
          </div>
        </div>
      ) : query.error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center" data-testid="audit-error">
          <p className="text-red-700 font-medium">
            {describeApiError(query.error, 'Gagal memuat log aktivitas.')}
          </p>
          <button
            onClick={() => query.refetch()}
            className="mt-4 px-4 py-2 bg-navy-800 text-white rounded-lg text-sm font-medium hover:bg-navy-900 transition"
          >
            Coba Lagi
          </button>
        </div>
      ) : logs.length === 0 ? (
        <div className="bg-white rounded-xl shadow border border-slate-100 p-10 text-center" data-testid="audit-empty">
          <ScrollText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Belum ada aktivitas yang tercatat.</p>
          <p className="text-slate-400 text-sm mt-1">
            Coba ubah filter atau lakukan aktivitas pada siklus pemilihan aktif.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow border border-slate-100 overflow-hidden" data-testid="audit-table-wrap">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm" data-testid="audit-table">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">Waktu</th>
                  <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">Aktor</th>
                  <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">Peran</th>
                  <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">Aksi</th>
                  <th className="px-4 py-3 text-left font-semibold">Detail</th>
                  <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/60" data-testid={`audit-row-${log.id}`}>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDateTime(log.created_at)}</td>
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-navy-800">
                      {getDmDisplayName(log.user_name, `Pengguna #${log.user_id ?? '—'}`)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{log.user_role ?? '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="px-2 py-1 rounded-full text-xs font-semibold bg-navy-50 text-navy-700 border border-navy-100">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 break-all max-w-md">{log.details}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">{log.ip_address ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
            <span data-testid="audit-total">
              Menampilkan {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} dari {total} log
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-slate-50 transition"
                data-testid="audit-prev"
              >
                Sebelumnya
              </button>
              <span className="text-slate-500" data-testid="audit-page">
                Halaman {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page + 1 >= totalPages}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-slate-50 transition"
                data-testid="audit-next"
              >
                Berikutnya
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
