export interface MultiplayerPlayerLobby {
  id: string;
  name: string;
  carId: string;
  slotIndex: number;
  isHost: boolean;
  connected: boolean;
}

export interface RemoteRacerSnapshot {
  id: string;
  name: string;
  carId: string;
  x: number;
  z: number;
  heading: number;
  vx: number;
  vz: number;
  steerAngle: number;
  isDrifting: boolean;
  isBoosting: boolean;
  totalProgress: number;
  currentLap: number;
  bestLapMs: number | null;
  finishTimeMs: number | null;
  finished: boolean;
}

export interface RoomSummary {
  code: string;
  trackId: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  status: 'lobby' | 'racing';
}

export interface RoomStatePayload {
  code: string;
  trackId: string;
  hostId: string;
  status: 'lobby' | 'racing';
  fillWithAi: boolean;
  players: MultiplayerPlayerLobby[];
}

export type ClientWsMessage =
  | { type: 'room:create'; name: string; carId: string; trackId: string }
  | { type: 'room:join'; code: string; name: string; carId: string }
  | { type: 'room:leave' }
  | { type: 'room:update_car'; carId: string }
  | { type: 'room:update_track'; trackId: string }
  | { type: 'room:toggle_ai'; fillWithAi: boolean }
  | { type: 'room:start' }
  | { type: 'room:return_lobby' }
  | { type: 'player:state'; snapshot: Omit<RemoteRacerSnapshot, 'id' | 'name' | 'carId'> };

export type ServerWsMessage =
  | { type: 'connected'; clientId: string }
  | { type: 'room:joined'; room: RoomStatePayload; selfId: string }
  | { type: 'room:state'; room: RoomStatePayload }
  | { type: 'room:left' }
  | { type: 'room:error'; message: string }
  | { type: 'race:start'; room: RoomStatePayload; startAtServerMs: number }
  | { type: 'race:snapshots'; snapshots: RemoteRacerSnapshot[] };
