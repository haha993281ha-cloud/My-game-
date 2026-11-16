import React from 'react';
import { RotateCcw, Trophy, SlidersHorizontal } from 'lucide-react';
import { RacerResult } from '../game/types';
import { formatMs } from './PreRaceMenu';

interface ResultsModalProps {
  trackName: string;
  results: RacerResult[];
  isNewBestLap: boolean;
  isMultiplayer: boolean;
  isRoomHost: boolean;
  onRaceAgain: () => void;
  onOpenGarage: () => void;
}

export const ResultsModal: React.FC<ResultsModalProps> = ({
  trackName,
  results,
  isNewBestLap,
  isMultiplayer,
  isRoomHost,
  onRaceAgain,
  onOpenGarage,
}) => {
  const playerResult = results.find((r) => r.isPlayer);
  const pos = playerResult?.position ?? 1;
  const headline =
    pos === 1 ? '1st Place Champion' : pos <= 3 ? `Podium Finish — P${pos}` : `Finished P${pos}`;

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl bg-[#0F141E] border border-white/15 rounded-2xl p-6 md:p-7 shadow-2xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-slate-400">
              SAHANUR RACING · {trackName} · Final Standings
            </div>
            <h2 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-bold text-white mt-0.5">
              {headline}
            </h2>
          </div>

          {isNewBestLap && (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-lg px-3 py-1.5">
              <Trophy className="w-4 h-4" />
              <span>New Track Best Lap</span>
            </div>
          )}
        </div>

        {/* Standings Table */}
        <div className="overflow-hidden border border-white/10 rounded-xl">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-white/[0.04] text-xs text-slate-400 border-b border-white/10">
                <th className="py-2.5 px-3.5 font-medium">Pos</th>
                <th className="py-2.5 px-3.5 font-medium">Driver</th>
                <th className="py-2.5 px-3.5 font-medium text-right">Best Lap</th>
                <th className="py-2.5 px-3.5 font-medium text-right">Total Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8">
              {results.map((r) => (
                <tr
                  key={r.id}
                  className={r.isPlayer ? 'bg-red-500/12 text-white font-semibold' : 'text-slate-300'}
                >
                  <td className="py-2.5 px-3.5 font-[family-name:var(--font-display)] font-bold tabular-nums">
                    {r.position}
                  </td>
                  <td className="py-2.5 px-3.5">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: r.colorHex }}
                      />
                      <span>{r.name}</span>
                      <span className="text-xs text-slate-400 font-normal hidden sm:inline">
                        {r.carName}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3.5 text-right font-[family-name:var(--font-mono)] tabular-nums text-xs">
                    {formatMs(r.bestLapMs)}
                  </td>
                  <td className="py-2.5 px-3.5 text-right font-[family-name:var(--font-mono)] tabular-nums text-xs">
                    {formatMs(r.totalTimeMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="text-xs text-slate-400">
            Developed by SAHANUR ISLAM · Thanks for playing!
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={onOpenGarage}
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-white/8 hover:bg-white/14 border border-white/12 text-slate-200 font-medium py-2.5 px-5 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>{isMultiplayer ? 'Back to Lobby' : 'Change Track & Car'}</span>
            </button>

            {(!isMultiplayer || isRoomHost) && (
              <button
                type="button"
                onClick={onRaceAgain}
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#EF4444] hover:bg-[#DC2626] text-white font-[family-name:var(--font-display)] font-bold py-2.5 px-6 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Race Again</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
