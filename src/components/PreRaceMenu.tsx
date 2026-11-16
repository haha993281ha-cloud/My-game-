import React, { useState } from 'react';
import {
  Play,
  Volume2,
  VolumeX,
  Trophy,
  Users,
  User,
  Copy,
  Check,
  RefreshCw,
  LogOut,
} from 'lucide-react';
import { CAR_SPECS, TRACK_CONFIGS } from '../game/configs';
import type { RoomStatePayload, RoomSummary } from '../game/multiplayerTypes';

export type LobbyTab = 'solo' | 'multiplayer';

interface PreRaceMenuProps {
  selectedTrackId: string;
  selectedCarId: string;
  bestLapsByTrack: Record<string, number>;
  muted: boolean;
  lobbyTab: LobbyTab;
  driverName: string;
  wsConnected: boolean;
  room: RoomStatePayload | null;
  selfId: string | null;
  openRooms: RoomSummary[];
  roomError: string | null;
  onChangeTab: (tab: LobbyTab) => void;
  onChangeDriverName: (name: string) => void;
  onSelectTrack: (trackId: string) => void;
  onSelectCar: (carId: string) => void;
  onToggleMute: () => void;
  onStartSoloRace: () => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onLeaveRoom: () => void;
  onRefreshRooms: () => void;
  onToggleAiFill: (fill: boolean) => void;
  onStartMultiplayerRace: () => void;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms <= 0) return '--:--.--';
  const totalSeconds = ms / 1000;
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

export const PreRaceMenu: React.FC<PreRaceMenuProps> = ({
  selectedTrackId,
  selectedCarId,
  bestLapsByTrack,
  muted,
  lobbyTab,
  driverName,
  wsConnected,
  room,
  selfId,
  openRooms,
  roomError,
  onChangeTab,
  onChangeDriverName,
  onSelectTrack,
  onSelectCar,
  onToggleMute,
  onStartSoloRace,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  onRefreshRooms,
  onToggleAiFill,
  onStartMultiplayerRace,
}) => {
  const [joinCode, setJoinCode] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);

  const activeCar = CAR_SPECS.find((c) => c.id === selectedCarId) ?? CAR_SPECS[0];
  const displayTrackId = room ? room.trackId : selectedTrackId;
  const activeTrack = TRACK_CONFIGS.find((t) => t.id === displayTrackId) ?? TRACK_CONFIGS[0];
  const trackBest = bestLapsByTrack[activeTrack.id];
  const isHost = Boolean(room && selfId && room.hostId === selfId);

  const handleCopyCode = () => {
    if (!room) return;
    void navigator.clipboard?.writeText(room.code);
    setCopiedCode(true);
    window.setTimeout(() => setCopiedCode(false), 1800);
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between p-4 md:p-7">
      {/* Top Minimal Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="pointer-events-auto bg-[#0B0E14]/92 border border-white/12 rounded-xl px-4 py-3 md:px-5 md:py-3.5 shadow-xl">
          <h1 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-bold tracking-tight text-white">
            SAHANUR RACING
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span>Developed by SAHANUR ISLAM</span>
            <span aria-hidden="true">·</span>
            <span>{activeTrack.name}</span>
            <span aria-hidden="true">·</span>
            <span>{activeTrack.laps} Laps</span>
            {trackBest && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 font-[family-name:var(--font-mono)] tabular-nums text-amber-400">
                  <Trophy className="w-3.5 h-3.5" />
                  Best {formatMs(trackBest)}
                </span>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleMute}
          aria-label={muted ? 'Unmute audio' : 'Mute audio'}
          className="pointer-events-auto flex items-center gap-2 bg-[#0B0E14]/92 hover:bg-[#161B26] border border-white/12 rounded-xl px-3.5 py-2.5 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
        >
          {muted ? <VolumeX className="w-4 h-4 text-slate-400" /> : <Volume2 className="w-4 h-4 text-white" />}
          <span className="whitespace-nowrap">{muted ? 'Muted' : 'Audio On'}</span>
        </button>
      </div>

      {/* Bottom Unified Dock — keeps center 3D car showcase completely unobstructed */}
      <div className="pointer-events-auto mx-auto w-full max-w-4xl bg-[#0B0E14]/94 border border-white/12 rounded-2xl p-4 md:p-5 shadow-2xl space-y-4">
        {/* Mode Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div className="inline-flex items-center gap-1 p-1 bg-white/[0.05] rounded-xl">
            <button
              type="button"
              onClick={() => onChangeTab('solo')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                lobbyTab === 'solo'
                  ? 'bg-[#EF4444] text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>Solo Race</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeTab('multiplayer')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                lobbyTab === 'multiplayer'
                  ? 'bg-[#EF4444] text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Play With Friends</span>
            </button>
          </div>

          {lobbyTab === 'multiplayer' && (
            <div className="text-xs text-slate-400">
              {wsConnected ? 'Online Multiplayer Ready' : 'Connecting to race server...'}
            </div>
          )}
        </div>

        {/* SOLO TAB */}
        {lobbyTab === 'solo' && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-5 items-end">
            <div className="md:col-span-4 space-y-2">
              <div className="text-xs font-medium text-slate-400">Circuit</div>
              <div className="grid grid-cols-3 md:grid-cols-1 gap-1.5">
                {TRACK_CONFIGS.map((track) => {
                  const selected = track.id === selectedTrackId;
                  return (
                    <button
                      key={track.id}
                      type="button"
                      onClick={() => onSelectTrack(track.id)}
                      className={`text-left px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                        selected
                          ? 'bg-white/12 border-amber-400/70 text-white'
                          : 'bg-white/[0.03] border-white/8 text-slate-300 hover:bg-white/[0.07]'
                      }`}
                    >
                      <div className="text-xs md:text-sm font-semibold truncate">{track.name}</div>
                      <div className="text-[11px] text-slate-400 truncate hidden md:block">
                        {track.location}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="md:col-span-5 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-400">Sports Car</span>
                <span className="text-slate-300 font-medium">{activeCar.subtitle}</span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {CAR_SPECS.map((car) => {
                  const selected = car.id === selectedCarId;
                  return (
                    <button
                      key={car.id}
                      type="button"
                      onClick={() => onSelectCar(car.id)}
                      className={`px-2.5 py-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                        selected
                          ? 'bg-white/12 border-white/50 text-white'
                          : 'bg-white/[0.03] border-white/8 text-slate-300 hover:bg-white/[0.07]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: car.hex }}
                        />
                        <span className="text-xs font-semibold truncate">{car.name}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-3 gap-3 pt-1">
                {[
                  { label: 'Top Speed', val: activeCar.stats.speed },
                  { label: 'Accel', val: activeCar.stats.accel },
                  { label: 'Handling', val: activeCar.stats.handling },
                ].map((stat) => (
                  <div key={stat.label}>
                    <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                      <span>{stat.label}</span>
                      <span className="font-[family-name:var(--font-mono)] tabular-nums text-slate-200">
                        {stat.val}
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-200"
                        style={{ width: `${stat.val}%`, backgroundColor: activeCar.hex }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="md:col-span-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={onStartSoloRace}
                className="w-full flex items-center justify-center gap-2 bg-[#EF4444] hover:bg-[#DC2626] active:scale-[0.99] text-white font-[family-name:var(--font-display)] font-bold text-base tracking-wide py-3.5 px-5 rounded-xl shadow-lg transition-all cursor-pointer whitespace-nowrap"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Start Race</span>
              </button>
              <div className="text-[11px] text-center text-slate-400 leading-tight">
                WASD / Arrows · Space Drift · Shift Nitro
              </div>
            </div>
          </div>
        )}

        {/* MULTIPLAYER TAB — NOT IN ROOM */}
        {lobbyTab === 'multiplayer' && !room && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
            <div className="md:col-span-5 space-y-3">
              <div>
                <label htmlFor="driver-name" className="block text-xs font-medium text-slate-400 mb-1">
                  Driver Name
                </label>
                <input
                  id="driver-name"
                  type="text"
                  maxLength={16}
                  value={driverName}
                  onChange={(e) => onChangeDriverName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full bg-white/[0.06] border border-white/15 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!wsConnected}
                  onClick={onCreateRoom}
                  className="flex-1 bg-[#EF4444] hover:bg-[#DC2626] disabled:opacity-50 text-white font-semibold text-xs py-2.5 px-4 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                >
                  Create Room
                </button>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={6}
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="Room Code (e.g. AB12C)"
                  className="flex-1 bg-white/[0.06] border border-white/15 rounded-xl px-3 py-2 text-xs font-[family-name:var(--font-mono)] text-white uppercase placeholder:normal-case placeholder:text-slate-500 focus:outline-none focus:border-white/40"
                />
                <button
                  type="button"
                  disabled={!wsConnected || joinCode.trim().length < 3}
                  onClick={() => onJoinRoom(joinCode.trim())}
                  className="bg-white/12 hover:bg-white/20 disabled:opacity-40 text-white font-semibold text-xs py-2 px-4 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                >
                  Join
                </button>
              </div>

              {roomError && (
                <div className="text-xs text-red-400">{roomError}</div>
              )}
            </div>

            <div className="md:col-span-7 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">Open Rooms</span>
                <button
                  type="button"
                  onClick={onRefreshRooms}
                  className="inline-flex items-center gap-1 text-xs text-slate-300 hover:text-white cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Refresh</span>
                </button>
              </div>

              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                {openRooms.length === 0 ? (
                  <div className="bg-white/[0.03] border border-white/8 rounded-xl px-4 py-5 text-center text-xs text-slate-400">
                    No open rooms right now. Create a room and share the code with friends.
                  </div>
                ) : (
                  openRooms.map((r) => {
                    const tName = TRACK_CONFIGS.find((t) => t.id === r.trackId)?.name ?? r.trackId;
                    return (
                      <div
                        key={r.code}
                        className="flex items-center justify-between gap-3 bg-white/[0.04] border border-white/10 rounded-xl px-3.5 py-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white truncate">
                            {r.hostName}&apos;s Room ·{' '}
                            <span className="font-[family-name:var(--font-mono)] text-amber-400">
                              {r.code}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {tName} · {r.playerCount}/{r.maxPlayers} racers ·{' '}
                            {r.status === 'racing' ? 'In Race' : 'In Lobby'}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={r.status === 'racing' || r.playerCount >= r.maxPlayers}
                          onClick={() => onJoinRoom(r.code)}
                          className="bg-white/12 hover:bg-white/20 disabled:opacity-40 text-white text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer whitespace-nowrap"
                        >
                          Join
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* MULTIPLAYER TAB — IN ROOM LOBBY */}
        {lobbyTab === 'multiplayer' && room && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            {/* Room Info & Racers */}
            <div className="md:col-span-5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Room</span>
                  <span className="font-[family-name:var(--font-mono)] text-sm font-bold text-amber-400">
                    {room.code}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="inline-flex items-center gap-1 text-[11px] text-slate-300 hover:text-white bg-white/8 px-2 py-1 rounded-md cursor-pointer"
                  >
                    {copiedCode ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedCode ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={onLeaveRoom}
                  className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-400 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Leave</span>
                </button>
              </div>

              <div className="space-y-1 max-h-32 overflow-y-auto">
                {room.players.map((p) => {
                  const pCar = CAR_SPECS.find((c) => c.id === p.carId) ?? CAR_SPECS[0];
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between bg-white/[0.04] border border-white/8 rounded-lg px-3 py-1.5 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: pCar.hex }}
                        />
                        <span className="font-medium text-white truncate">
                          {p.name}
                          {p.id === selfId ? ' (You)' : ''}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 shrink-0">
                        {p.isHost ? 'Host' : pCar.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Car & Track Settings inside Room */}
            <div className="md:col-span-4 space-y-2.5">
              <div>
                <div className="text-xs font-medium text-slate-400 mb-1.5">Your Car</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {CAR_SPECS.map((car) => {
                    const selected = car.id === selectedCarId;
                    return (
                      <button
                        key={car.id}
                        type="button"
                        onClick={() => onSelectCar(car.id)}
                        className={`px-2 py-2 rounded-lg border text-left transition-colors cursor-pointer ${
                          selected
                            ? 'bg-white/12 border-white/50 text-white'
                            : 'bg-white/[0.03] border-white/8 text-slate-300 hover:bg-white/[0.07]'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-sm shrink-0"
                            style={{ backgroundColor: car.hex }}
                          />
                          <span className="text-[11px] font-semibold truncate">{car.name}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-slate-400 mb-1.5">
                  Circuit {!isHost && '(Host chooses)'}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {TRACK_CONFIGS.map((t) => {
                    const selected = t.id === room.trackId;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={!isHost}
                        onClick={() => onSelectTrack(t.id)}
                        className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium truncate transition-colors ${
                          selected
                            ? 'bg-white/12 border-amber-400/70 text-white'
                            : 'bg-white/[0.03] border-white/8 text-slate-400'
                        } ${isHost ? 'cursor-pointer hover:bg-white/[0.08]' : 'cursor-default'}`}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Host Launch or Guest Wait */}
            <div className="md:col-span-3 flex flex-col gap-2">
              {isHost ? (
                <>
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={room.fillWithAi}
                      onChange={(e) => onToggleAiFill(e.target.checked)}
                      className="rounded accent-red-500"
                    />
                    <span>Fill grid with AI rivals</span>
                  </label>
                  <button
                    type="button"
                    onClick={onStartMultiplayerRace}
                    className="w-full flex items-center justify-center gap-2 bg-[#EF4444] hover:bg-[#DC2626] text-white font-[family-name:var(--font-display)] font-bold text-sm py-3 px-4 rounded-xl shadow-lg transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>Start Race</span>
                  </button>
                </>
              ) : (
                <div className="bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-3 text-center text-xs text-slate-300">
                  Waiting for host to start the race...
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
