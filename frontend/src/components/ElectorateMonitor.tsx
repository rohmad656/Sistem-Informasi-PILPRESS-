import React from 'react';
import { ElectorateVoterStatus } from '@/types';
import { Check, Clock, UserCheck, Users } from 'lucide-react';
import { getDmDisplayName } from '@/utils/dmIdentity';

interface ElectorateMonitorProps {
  electorate: ElectorateVoterStatus[];
  votesCast: number;
  totalVoters: number;
  currentRound?: number;
  className?: string;
}

/** Format waktu voting ke representasi lokal yang mudah dibaca */
function formatVotedAt(isoString?: string | null): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString.replace(' ', 'T'));
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return isoString;
  }
}

export const ElectorateMonitor: React.FC<ElectorateMonitorProps> = ({
  electorate,
  votesCast,
  totalVoters,
  currentRound,
  className = '',
}) => {
  const remaining = Math.max(totalVoters - votesCast, 0);
  const isComplete = totalVoters > 0 && votesCast >= totalVoters;

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}
      data-testid="electorate-monitor"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 mb-4">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-navy-800" />
          <h3 className="font-bold text-navy-800 text-base">Monitoring Pemilih Resmi</h3>
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-navy-50 text-navy-800 border border-navy-100">
            {totalVoters} Orang
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {currentRound && currentRound > 0 && (
            <span className="text-slate-500 font-medium">Putaran #{currentRound}</span>
          )}
          <span
            className="font-bold text-navy-800 bg-slate-100 px-2.5 py-0.5 rounded-md"
            data-testid="electorate-monitor-fraction"
          >
            {votesCast}/{totalVoters} Suara
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>Progres Pengumpulan Suara</span>
          <span>{totalVoters > 0 ? Math.round((votesCast / totalVoters) * 100) : 0}%</span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-500 ${
              isComplete ? 'bg-green-500' : 'bg-gold-accent'
            }`}
            style={{ width: `${totalVoters > 0 ? Math.min((votesCast / totalVoters) * 100, 100) : 0}%` }}
          />
        </div>
        <p className="text-xs text-slate-500 mt-1.5 flex items-center justify-between">
          <span>
            {isComplete ? (
              <span className="text-green-600 font-medium flex items-center gap-1">
                <UserCheck className="w-3.5 h-3.5" /> Seluruh panelis telah memberikan suara.
              </span>
            ) : (
              <span className="text-amber-700 font-medium flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> Tersisa {remaining} pemilih belum memberikan suara.
              </span>
            )}
          </span>
        </p>
      </div>

      {/* Voter List */}
      <ul className="space-y-2.5" data-testid="electorate-monitor-list">
        {electorate.map((voter) => {
          const roleLabel = voter.role === 'chair' ? 'Ketua Panel' : 'Anggota Panel';
          const timeText = formatVotedAt(voter.voted_at);

          return (
            <li
              key={voter.user_id}
              className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition"
              data-testid={`monitor-item-${voter.username}`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                    voter.has_voted
                      ? 'bg-green-100 text-green-800 border border-green-200'
                      : 'bg-amber-100 text-amber-800 border border-amber-200'
                  }`}
                >
                  {voter.username.toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800 leading-snug">
                    {getDmDisplayName({ username: voter.username, name: voter.name })}
                  </p>
                  <p className="text-xs text-slate-500">
                    {roleLabel} ({voter.username})
                    {voter.has_voted && timeText && (
                      <span className="ml-2 text-slate-400">· pukul {timeText}</span>
                    )}
                  </p>
                </div>
              </div>

              <div>
                {voter.has_voted ? (
                  <span
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold border border-green-200 shadow-sm"
                    data-testid={`monitor-voted-${voter.username}`}
                  >
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" /> Sudah Voting
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-semibold border border-amber-200 shadow-sm"
                    data-testid={`monitor-not-voted-${voter.username}`}
                  >
                    <Clock className="w-3.5 h-3.5 stroke-[2.5]" /> Belum Voting
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
