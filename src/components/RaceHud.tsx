import React, { useEffect, useState } from 'react';
import {
  Camera,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  ArrowLeft,
  ArrowRight,
  Flame,
  Gamepad2,
} from 'lucide-react';
import { CameraMode, ControlInputState, GamePhase, RaceTelemetry } from '../game/types';
import { MiniMap } from './MiniMap';
import { formatMs } from './PreRaceMenu';

interface RaceHudProps {
  phase: GamePhase;
  telemetry: RaceTelemetry;
  cameraMode: CameraMode;
  muted: boolean;
  isMultiplayer: boolean;
  minimap: {
    points: { x: number; z: number }[];
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  } | null;
  onCycleCamera: () => void;
  onToggleMute: () => void;
  onTogglePause: () => void;
  onRestart: () => void;
  onExitToMenu: () => void;
  onTouchInput: (key: keyof ControlInputState, active: boolean) => void;
}

const CAMERA_LABELS: Record<CameraMode, string> = {
  chase: 'Chase',
  far: 'Far',
  hood: 'Hood',
};

export const RaceHud: React.FC<RaceHudProps> = ({
  phase,
  telemetry,
  cameraMode,
  muted,
  isMultiplayer,
  minimap,
  onCycleCamera,
  onToggleMute,
  onTogglePause,
  onRestart,
  onExitToMenu,
  onTouchInput,
}) => {
  const [showTouchPad, setShowTouchPad] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768;
  });

  useEffect(() => {
    const onResize = () => {
      if (window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768) {
        setShowTouchPad(true);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // SVG Tachometer Arc math
  const radius = 54;
  const circumference = Math.PI * radius;
  const dashOffset = circumference * (1 - telemetry.rpmRatio);

  const touchBind = (key: keyof ControlInputState) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      onTouchInput(key, true);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      onTouchInput(key, false);
    },
    onPointerLeave: () => onTouchInput(key, false),
    onPointerCancel: () => onTouchInput(key, false),
  });

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between p-3 md:p-6">
      {/* Top Row: Position/Lap/Timers on Left, Minimap & Controls on Right */}
      <div className="flex items-start justify-between gap-3">
        <div className="bg-[#0B0E14]/92 border border-white/12 rounded-xl px-3.5 py-2.5 md:px-4 md:py-3 shadow-lg flex items-center gap-4 md:gap-5">
          <div>
            <div className="text-[11px] font-medium text-slate-400">Position</div>
            <div className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-bold tabular-nums leading-none mt-0.5">
              <span className="text-white">{telemetry.position}</span>
              <span className="text-sm text-slate-400 font-medium"> / {telemetry.totalRacers}</span>
            </div>
          </div>

          <div className="h-9 w-px bg-white/10" />

          <div>
            <div className="text-[11px] font-medium text-slate-400">Lap</div>
            <div className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-bold tabular-nums leading-none mt-0.5">
              <span className="text-amber-400">{telemetry.lap}</span>
              <span className="text-sm text-slate-400 font-medium"> / {telemetry.totalLaps}</span>
            </div>
          </div>

          <div className="hidden sm:block h-9 w-px bg-white/10" />

          <div className="hidden sm:flex flex-col gap-0.5 font-[family-name:var(--font-mono)] tabular-nums text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-400 font-[family-name:var(--font-sans)]">Lap</span>
              <span className="text-white font-semibold">{formatMs(telemetry.currentLapMs)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-400 font-[family-name:var(--font-sans)]">Best</span>
              <span className="text-amber-400 font-semibold">{formatMs(telemetry.bestLapMs)}</span>
            </div>
          </div>
        </div>

        {/* Top-Right Minimap & Utility Actions */}
        <div className="flex items-start gap-2">
          <div className="pointer-events-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowTouchPad((v) => !v)}
              title="Toggle Touch Controls"
              aria-label="Toggle touch controls"
              className={`border border-white/12 rounded-xl p-2 transition-colors cursor-pointer ${
                showTouchPad
                  ? 'bg-white/20 text-white'
                  : 'bg-[#0B0E14]/90 hover:bg-[#161B26] text-slate-300'
              }`}
            >
              <Gamepad2 className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onCycleCamera}
              title="Switch Camera (C)"
              className="flex items-center gap-1.5 bg-[#0B0E14]/90 hover:bg-[#161B26] border border-white/12 rounded-xl px-3 py-2 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
            >
              <Camera className="w-4 h-4 text-slate-300" />
              <span className="hidden md:inline whitespace-nowrap">{CAMERA_LABELS[cameraMode]}</span>
            </button>

            <button
              type="button"
              onClick={onToggleMute}
              title="Mute / Unmute"
              aria-label={muted ? 'Unmute audio' : 'Mute audio'}
              className="bg-[#0B0E14]/90 hover:bg-[#161B26] border border-white/12 rounded-xl p-2 text-slate-200 transition-colors cursor-pointer"
            >
              {muted ? <VolumeX className="w-4 h-4 text-slate-400" /> : <Volume2 className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={onTogglePause}
              title="Pause / Menu (Esc)"
              aria-label="Pause race"
              className="bg-[#0B0E14]/90 hover:bg-[#161B26] border border-white/12 rounded-xl p-2 text-slate-200 transition-colors cursor-pointer"
            >
              <Pause className="w-4 h-4" />
            </button>
          </div>

          {minimap && (
            <div className="hidden sm:block">
              <MiniMap points={minimap.points} bounds={minimap.bounds} dots={telemetry.dots} />
            </div>
          )}
        </div>
      </div>

      {/* Center Transient Alerts */}
      <div className="flex flex-col items-center justify-center gap-3">
        {phase === 'countdown' && (
          <div className="bg-[#0B0E14]/92 border border-white/15 rounded-2xl px-8 py-4 shadow-2xl text-center">
            <div className="font-[family-name:var(--font-display)] text-6xl md:text-7xl font-bold tabular-nums text-white">
              {telemetry.countdownValue > 0 ? telemetry.countdownValue : 'GO!'}
            </div>
            <div className="text-xs text-slate-300 mt-1">SAHANUR RACING · Ready to launch</div>
          </div>
        )}

        {phase === 'racing' && telemetry.wrongWay && (
          <div className="bg-red-600/95 border border-red-300/40 rounded-xl px-5 py-2 shadow-lg">
            <span className="font-[family-name:var(--font-display)] text-lg font-bold tracking-wide text-white">
              Wrong Way — Turn Around
            </span>
          </div>
        )}

        {phase === 'racing' && telemetry.lapNotification && !telemetry.wrongWay && (
          <div className="bg-[#0B0E14]/92 border border-amber-400/50 rounded-xl px-6 py-2.5 shadow-xl">
            <span className="font-[family-name:var(--font-display)] text-xl md:text-2xl font-bold tracking-wide text-amber-400">
              {telemetry.lapNotification}
            </span>
          </div>
        )}
      </div>

      {/* Bottom Row: Controls Hint / Android Touch Controls + Speedometer */}
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          {!showTouchPad && (
            <div className="hidden md:flex items-center gap-3 bg-[#0B0E14]/88 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-slate-300">
              <span>WASD / Arrows Drive</span>
              <span aria-hidden="true">·</span>
              <span>Space Drift</span>
              <span aria-hidden="true">·</span>
              <span>Shift Nitro</span>
              <span aria-hidden="true">·</span>
              <span>C Camera</span>
            </div>
          )}

          {showTouchPad && (
            <div className="pointer-events-auto flex items-center gap-2 touch-none">
              <button
                type="button"
                {...touchBind('left')}
                aria-label="Steer Left"
                className="w-16 h-16 flex items-center justify-center bg-[#0B0E14]/92 active:bg-white/25 border border-white/20 rounded-2xl text-white shadow-lg"
              >
                <ArrowLeft className="w-7 h-7" />
              </button>
              <button
                type="button"
                {...touchBind('right')}
                aria-label="Steer Right"
                className="w-16 h-16 flex items-center justify-center bg-[#0B0E14]/92 active:bg-white/25 border border-white/20 rounded-2xl text-white shadow-lg"
              >
                <ArrowRight className="w-7 h-7" />
              </button>
            </div>
          )}
        </div>

        <div className="flex items-end gap-2.5">
          {showTouchPad && (
            <div className="pointer-events-auto flex items-center gap-2 touch-none">
              <button
                type="button"
                {...touchBind('drift')}
                className="h-14 px-3.5 flex items-center justify-center bg-amber-500/90 active:bg-amber-400 border border-amber-200/30 rounded-2xl text-xs font-bold text-slate-950 shadow-lg"
              >
                Drift
              </button>
              <button
                type="button"
                {...touchBind('boost')}
                aria-label="Nitro Boost"
                className="w-13 h-14 flex items-center justify-center bg-cyan-600/95 active:bg-cyan-400 border border-cyan-300/30 rounded-2xl text-white shadow-lg"
              >
                <Flame className="w-5 h-5" />
              </button>
              <button
                type="button"
                {...touchBind('brake')}
                className="h-14 px-4 flex items-center justify-center bg-[#0B0E14]/92 active:bg-red-600/80 border border-white/20 rounded-2xl text-xs font-semibold text-slate-200 shadow-lg"
              >
                Brake
              </button>
              <button
                type="button"
                {...touchBind('throttle')}
                className="h-16 px-5 flex items-center justify-center bg-[#EF4444]/95 active:bg-red-500 border border-red-300/30 rounded-2xl text-sm font-bold text-white shadow-lg"
              >
                Gas
              </button>
            </div>
          )}

          {/* Tachometer + Speed Cluster */}
          <div className="bg-[#0B0E14]/92 border border-white/12 rounded-2xl px-3.5 py-2.5 md:px-4 md:py-3 shadow-xl flex items-center gap-3 md:gap-4">
            <div className="relative w-24 md:w-28 h-14 md:h-16 flex flex-col items-center justify-end">
              <svg
                width="116"
                height="62"
                viewBox="0 0 120 66"
                className="absolute top-0 left-1/2 -translate-x-1/2 w-full"
              >
                <path
                  d="M 6 60 A 54 54 0 0 1 114 60"
                  fill="none"
                  stroke="rgba(255,255,255,0.12)"
                  strokeWidth="7"
                  strokeLinecap="round"
                />
                <path
                  d="M 6 60 A 54 54 0 0 1 114 60"
                  fill="none"
                  stroke={telemetry.isBoosting ? '#06B6D4' : telemetry.rpmRatio > 0.85 ? '#EF4444' : '#F59E0B'}
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                />
              </svg>
              <div className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-bold tabular-nums leading-none text-white">
                {telemetry.speedKmh}
              </div>
              <div className="text-[10px] text-slate-400 font-medium mt-0.5">km/h</div>
            </div>

            <div className="h-11 w-px bg-white/10" />

            <div className="flex flex-col justify-between gap-2 min-w-[62px]">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] text-slate-400">Gear</span>
                <span className="font-[family-name:var(--font-display)] text-xl font-bold tabular-nums text-white">
                  {telemetry.gear}
                </span>
              </div>

              <div>
                <div className="flex items-center justify-between text-[10px] mb-1">
                  <span className="text-slate-400">Nitro</span>
                  <span className="font-[family-name:var(--font-mono)] tabular-nums text-cyan-400">
                    {telemetry.nitro}%
                  </span>
                </div>
                <div className="w-16 md:w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-cyan-400 transition-all duration-75"
                    style={{ width: `${telemetry.nitro}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pause Modal */}
      {phase === 'paused' && (
        <div className="pointer-events-auto fixed inset-0 z-20 flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-sm bg-[#0F141E] border border-white/15 rounded-2xl p-6 shadow-2xl space-y-5">
            <div>
              <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold text-white">
                Race Paused
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Lap {telemetry.lap} of {telemetry.totalLaps} · Position {telemetry.position}/{telemetry.totalRacers}
              </p>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={onTogglePause}
                className="w-full flex items-center justify-center gap-2 bg-[#EF4444] hover:bg-[#DC2626] text-white font-semibold py-2.5 px-4 rounded-xl transition-colors cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Resume Race</span>
              </button>
              {!isMultiplayer && (
                <button
                  type="button"
                  onClick={onRestart}
                  className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 text-white font-medium py-2.5 px-4 rounded-xl transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Restart Race</span>
                </button>
              )}
              <button
                type="button"
                onClick={onExitToMenu}
                className="w-full flex items-center justify-center gap-2 bg-transparent hover:bg-white/8 border border-white/12 text-slate-300 font-medium py-2.5 px-4 rounded-xl transition-colors cursor-pointer"
              >
                <span>Back to Garage</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
