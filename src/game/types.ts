export type GamePhase = 'menu' | 'countdown' | 'racing' | 'paused' | 'finished';

export type CameraMode = 'chase' | 'far' | 'hood';

export interface CarSpec {
  id: string;
  name: string;
  subtitle: string;
  primaryColor: number;
  accentColor: number;
  hex: string;
  maxSpeedKmh: number;
  acceleration: number; // m/s^2 base
  handling: number; // turn responsiveness multiplier
  driftGrip: number;
  stats: {
    speed: number; // 1-100 for display
    accel: number;
    handling: number;
  };
}

export interface TrackConfig {
  id: string;
  name: string;
  location: string;
  laps: number;
  roadWidth: number;
  skyTopHex: string;
  skyBottomHex: string;
  fogColor: number;
  fogDensity: number;
  groundColor: number;
  groundAccentColor: number;
  sunColor: number;
  sunIntensity: number;
  sunPosition: [number, number, number];
  hemiSkyColor: number;
  hemiGroundColor: number;
  hemiIntensity: number;
  treeColorA: number;
  treeColorB: number;
  treeStyle: 'pine' | 'desert' | 'cypress';
  hasTrackLights: boolean;
  waypoints: [number, number, number][];
}

export interface RacerHudDot {
  id: string;
  x: number;
  z: number;
  isPlayer: boolean;
  color: string;
}

export interface RaceTelemetry {
  speedKmh: number;
  rpmRatio: number; // 0..1
  gear: number; // 1..6
  nitro: number; // 0..100
  isBoosting: boolean;
  isDrifting: boolean;
  position: number; // 1..6
  totalRacers: number;
  lap: number; // 1..totalLaps
  totalLaps: number;
  currentLapMs: number;
  bestLapMs: number | null;
  totalRaceMs: number;
  countdownValue: number; // 3, 2, 1, 0 (GO)
  wrongWay: boolean;
  lapNotification: string | null;
  dots: RacerHudDot[];
}

export interface RacerResult {
  id: string;
  name: string;
  carName: string;
  colorHex: string;
  isPlayer: boolean;
  position: number;
  totalTimeMs: number;
  bestLapMs: number | null;
  finished: boolean;
}

export interface ControlInputState {
  throttle: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  drift: boolean;
  boost: boolean;
}
