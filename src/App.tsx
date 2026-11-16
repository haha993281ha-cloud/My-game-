/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { LobbyTab, PreRaceMenu } from './components/PreRaceMenu';
import { RaceHud } from './components/RaceHud';
import { ResultsModal } from './components/ResultsModal';
import { CAR_SPECS, TRACK_CONFIGS } from './game/configs';
import { MultiplayerClient } from './game/multiplayerClient';
import type { RoomStatePayload, RoomSummary } from './game/multiplayerTypes';
import { RacingEngine } from './game/RacingEngine';
import {
  CameraMode,
  ControlInputState,
  GamePhase,
  RacerResult,
  RaceTelemetry,
} from './game/types';

const BEST_LAPS_STORAGE_KEY = 'sahanur_racing_best_laps_v1';
const DRIVER_NAME_STORAGE_KEY = 'sahanur_racing_driver_name_v1';

const INITIAL_TELEMETRY: RaceTelemetry = {
  speedKmh: 0,
  rpmRatio: 0.2,
  gear: 1,
  nitro: 100,
  isBoosting: false,
  isDrifting: false,
  position: 6,
  totalRacers: 6,
  lap: 1,
  totalLaps: 3,
  currentLapMs: 0,
  bestLapMs: null,
  totalRaceMs: 0,
  countdownValue: 3,
  wrongWay: false,
  lapNotification: null,
  dots: [],
};

function loadBestLaps(): Record<string, number> {
  try {
    const raw = localStorage.getItem(BEST_LAPS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

function loadDriverName(): string {
  try {
    return localStorage.getItem(DRIVER_NAME_STORAGE_KEY) || 'Sahanur';
  } catch {
    return 'Sahanur';
  }
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RacingEngine | null>(null);
  const mpRef = useRef<MultiplayerClient | null>(null);

  const [phase, setPhase] = useState<GamePhase>('menu');
  const [lobbyTab, setLobbyTab] = useState<LobbyTab>('solo');
  const [driverName, setDriverName] = useState<string>(() => loadDriverName());
  const [selectedTrackId, setSelectedTrackId] = useState<string>(TRACK_CONFIGS[0].id);
  const [selectedCarId, setSelectedCarId] = useState<string>(CAR_SPECS[0].id);
  const [cameraMode, setCameraMode] = useState<CameraMode>('chase');
  const [muted, setMuted] = useState<boolean>(false);
  const [telemetry, setTelemetry] = useState<RaceTelemetry>(INITIAL_TELEMETRY);
  const [results, setResults] = useState<RacerResult[]>([]);
  const [bestLapsByTrack, setBestLapsByTrack] = useState<Record<string, number>>(() => loadBestLaps());
  const [isNewBestLap, setIsNewBestLap] = useState<boolean>(false);
  const [contextLost, setContextLost] = useState<boolean>(false);

  // Multiplayer state
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [room, setRoom] = useState<RoomStatePayload | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [openRooms, setOpenRooms] = useState<RoomSummary[]>([]);
  const [roomError, setRoomError] = useState<string | null>(null);

  const [minimap, setMinimap] = useState<{
    points: { x: number; z: number }[];
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  } | null>(null);

  const selectedTrackRef = useRef(selectedTrackId);
  selectedTrackRef.current = selectedTrackId;

  const selectedCarRef = useRef(selectedCarId);
  selectedCarRef.current = selectedCarId;

  const roomRef = useRef(room);
  roomRef.current = room;

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const engine = new RacingEngine(container, {
      onTelemetry: (next) => setTelemetry(next),
      onPhaseChange: (nextPhase) => setPhase(nextPhase),
      onCameraChange: (nextCam) => setCameraMode(nextCam),
      onContextLost: (lost) => setContextLost(lost),
      onLocalSnapshot: (snapshot) => {
        mpRef.current?.sendPlayerSnapshot(snapshot);
      },
      onRaceFinish: (raceResults) => {
        setResults(raceResults);
        const player = raceResults.find((r) => r.isPlayer);
        if (player?.bestLapMs) {
          const trackId = roomRef.current ? roomRef.current.trackId : selectedTrackRef.current;
          setBestLapsByTrack((prev) => {
            const existing = prev[trackId];
            if (!existing || player.bestLapMs! < existing) {
              const updated = { ...prev, [trackId]: player.bestLapMs! };
              setIsNewBestLap(true);
              try {
                localStorage.setItem(BEST_LAPS_STORAGE_KEY, JSON.stringify(updated));
              } catch {
                // ignore storage quota errors
              }
              return updated;
            }
            setIsNewBestLap(false);
            return prev;
          });
        } else {
          setIsNewBestLap(false);
        }
      },
    });

    engineRef.current = engine;
    setMinimap(engine.getMinimapGeometry());

    const mp = new MultiplayerClient({
      onConnectionChange: (connected) => setWsConnected(connected),
      onRoomJoined: (joinedRoom, id) => {
        setRoomError(null);
        setRoom(joinedRoom);
        setSelfId(id);
        setSelectedTrackId(joinedRoom.trackId);
        engine.setSelection(joinedRoom.trackId, selectedCarRef.current);
        setMinimap(engine.getMinimapGeometry());
      },
      onRoomState: (updatedRoom) => {
        setRoom(updatedRoom);
        setSelectedTrackId(updatedRoom.trackId);
        engine.setSelection(updatedRoom.trackId, selectedCarRef.current);
        setMinimap(engine.getMinimapGeometry());
        if (updatedRoom.status === 'lobby') {
          engine.returnToMenu();
        }
      },
      onRoomLeft: () => {
        setRoom(null);
        setSelfId(null);
        engine.returnToMenu();
      },
      onRoomError: (message) => {
        setRoomError(message);
      },
      onRaceStart: (startedRoom) => {
        setRoom(startedRoom);
        setIsNewBestLap(false);
        setSelfId((currentSelfId) => {
          if (currentSelfId) {
            engine.startMultiplayerRace(startedRoom, currentSelfId);
            setMinimap(engine.getMinimapGeometry());
          }
          return currentSelfId;
        });
      },
      onSnapshots: (snapshots) => {
        engine.applyRemoteSnapshots(snapshots);
      },
    });

    mpRef.current = mp;
    mp.connect();

    return () => {
      mp.disconnect();
      mpRef.current = null;
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const refreshRooms = useCallback(async () => {
    if (!mpRef.current) return;
    const list = await mpRef.current.fetchOpenRooms();
    setOpenRooms(list);
  }, []);

  useEffect(() => {
    if (lobbyTab === 'multiplayer' && !room && phase === 'menu') {
      void refreshRooms();
    }
  }, [lobbyTab, room, phase, refreshRooms]);

  const handleChangeDriverName = useCallback((name: string) => {
    setDriverName(name);
    try {
      localStorage.setItem(DRIVER_NAME_STORAGE_KEY, name);
    } catch {
      // ignore
    }
  }, []);

  const handleSelectTrack = useCallback(
    (trackId: string) => {
      setSelectedTrackId(trackId);
      if (room && selfId && room.hostId === selfId) {
        mpRef.current?.send({ type: 'room:update_track', trackId });
      } else {
        engineRef.current?.setSelection(trackId, selectedCarId);
        setMinimap(engineRef.current?.getMinimapGeometry() ?? null);
      }
    },
    [selectedCarId, room, selfId],
  );

  const handleSelectCar = useCallback(
    (carId: string) => {
      setSelectedCarId(carId);
      engineRef.current?.setSelection(selectedTrackId, carId);
      if (room) {
        mpRef.current?.send({ type: 'room:update_car', carId });
      }
    },
    [selectedTrackId, room],
  );

  const handleStartSoloRace = useCallback(() => {
    setIsNewBestLap(false);
    engineRef.current?.startRace();
  }, []);

  const handleCreateRoom = useCallback(() => {
    setRoomError(null);
    mpRef.current?.send({
      type: 'room:create',
      name: driverName,
      carId: selectedCarId,
      trackId: selectedTrackId,
    });
  }, [driverName, selectedCarId, selectedTrackId]);

  const handleJoinRoom = useCallback(
    (code: string) => {
      setRoomError(null);
      mpRef.current?.send({
        type: 'room:join',
        code,
        name: driverName,
        carId: selectedCarId,
      });
    },
    [driverName, selectedCarId],
  );

  const handleLeaveRoom = useCallback(() => {
    mpRef.current?.send({ type: 'room:leave' });
    setRoom(null);
    setSelfId(null);
    void refreshRooms();
  }, [refreshRooms]);

  const handleToggleAiFill = useCallback((fill: boolean) => {
    mpRef.current?.send({ type: 'room:toggle_ai', fillWithAi: fill });
  }, []);

  const handleStartMultiplayerRace = useCallback(() => {
    mpRef.current?.send({ type: 'room:start' });
  }, []);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      engineRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const handleCycleCamera = useCallback(() => {
    const next = engineRef.current?.cycleCamera();
    if (next) setCameraMode(next);
  }, []);

  const handleTogglePause = useCallback(() => {
    engineRef.current?.togglePause();
  }, []);

  const handleExitToMenu = useCallback(() => {
    if (room && selfId && room.hostId === selfId) {
      mpRef.current?.send({ type: 'room:return_lobby' });
    }
    engineRef.current?.returnToMenu();
  }, [room, selfId]);

  const handleTouchInput = useCallback((key: keyof ControlInputState, active: boolean) => {
    engineRef.current?.setTouchControl(key, active);
  }, []);

  const isMultiplayer = Boolean(room);
  const isRoomHost = Boolean(room && selfId && room.hostId === selfId);
  const displayTrackId = room ? room.trackId : selectedTrackId;
  const activeTrack = TRACK_CONFIGS.find((t) => t.id === displayTrackId) ?? TRACK_CONFIGS[0];

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#090B10]">
      {/* Isolated WebGL Canvas Mount */}
      <div ref={canvasMountRef} className="absolute inset-0 w-full h-full" />

      {/* Pre-Race Garage, Circuit & Multiplayer Dock */}
      {phase === 'menu' && (
        <PreRaceMenu
          selectedTrackId={selectedTrackId}
          selectedCarId={selectedCarId}
          bestLapsByTrack={bestLapsByTrack}
          muted={muted}
          lobbyTab={lobbyTab}
          driverName={driverName}
          wsConnected={wsConnected}
          room={room}
          selfId={selfId}
          openRooms={openRooms}
          roomError={roomError}
          onChangeTab={setLobbyTab}
          onChangeDriverName={handleChangeDriverName}
          onSelectTrack={handleSelectTrack}
          onSelectCar={handleSelectCar}
          onToggleMute={handleToggleMute}
          onStartSoloRace={handleStartSoloRace}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onLeaveRoom={handleLeaveRoom}
          onRefreshRooms={refreshRooms}
          onToggleAiFill={handleToggleAiFill}
          onStartMultiplayerRace={handleStartMultiplayerRace}
        />
      )}

      {/* Active Race / Countdown / Pause HUD */}
      {(phase === 'countdown' || phase === 'racing' || phase === 'paused') && (
        <RaceHud
          phase={phase}
          telemetry={telemetry}
          cameraMode={cameraMode}
          muted={muted}
          isMultiplayer={isMultiplayer}
          minimap={minimap}
          onCycleCamera={handleCycleCamera}
          onToggleMute={handleToggleMute}
          onTogglePause={handleTogglePause}
          onRestart={handleStartSoloRace}
          onExitToMenu={handleExitToMenu}
          onTouchInput={handleTouchInput}
        />
      )}

      {/* Post-Race Final Standings */}
      {phase === 'finished' && (
        <ResultsModal
          trackName={activeTrack.name}
          results={results}
          isNewBestLap={isNewBestLap}
          isMultiplayer={isMultiplayer}
          isRoomHost={isRoomHost}
          onRaceAgain={isMultiplayer ? handleStartMultiplayerRace : handleStartSoloRace}
          onOpenGarage={handleExitToMenu}
        />
      )}

      {/* WebGL Context Lost Fallback */}
      {contextLost && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#090B10]/95 p-6 text-center">
          <div className="max-w-sm space-y-2">
            <h2 className="font-[family-name:var(--font-display)] text-xl font-bold text-white">
              Graphics Context Restoring
            </h2>
            <p className="text-sm text-slate-400">
              WebGL rendering was temporarily interrupted. Waiting for GPU recovery.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
