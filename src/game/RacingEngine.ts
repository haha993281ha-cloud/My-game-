import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CAR_SPECS, RIVAL_PROFILES, TRACK_CONFIGS } from './configs';
import { buildRaceCarModel, CarMeshRig } from './carModel';
import { createContactShadowTexture } from './textures';
import { buildTrackScene, BuiltTrack, projectPointToTrack } from './trackBuilder';
import { RacingAudioEngine } from './audio';
import {
  CameraMode,
  CarSpec,
  ControlInputState,
  GamePhase,
  RacerHudDot,
  RacerResult,
  RaceTelemetry,
  TrackConfig,
} from './types';

import type { RemoteRacerSnapshot, RoomStatePayload } from './multiplayerTypes';

interface RacerEntity {
  id: string;
  name: string;
  carName: string;
  colorHex: string;
  isPlayer: boolean;
  isRemote: boolean;
  rig: CarMeshRig;
  maxSpeedMs: number;
  accel: number;
  handling: number;
  driftGrip: number;
  skill: number;
  preferredLane: number;

  // Physics state
  x: number;
  z: number;
  heading: number; // 0 = facing -Z
  vx: number;
  vz: number;
  steerAngle: number;
  wheelSpin: number;
  nitro: number;
  isBoosting: boolean;
  isDrifting: boolean;

  // Track progress state
  hintIndex: number;
  lastS: number;
  totalProgress: number;
  currentLap: number;
  lapStartMs: number;
  bestLapMs: number | null;
  finishTimeMs: number | null;
  finished: boolean;

  // Remote interpolation targets
  targetX: number;
  targetZ: number;
  targetHeading: number;
  targetVx: number;
  targetVz: number;
  targetSteerAngle: number;
}

interface ParticleItem {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  scale: number;
  color: THREE.Color;
}

export interface EngineCallbacks {
  onTelemetry: (telemetry: RaceTelemetry) => void;
  onPhaseChange: (phase: GamePhase) => void;
  onRaceFinish: (results: RacerResult[]) => void;
  onContextLost: (lost: boolean) => void;
  onCameraChange?: (mode: CameraMode) => void;
  onLocalSnapshot?: (snapshot: Omit<RemoteRacerSnapshot, 'id' | 'name' | 'carId'>) => void;
}

// Reusable math objects (Zero GC in render loop)
const _vForward = new THREE.Vector3();
const _vRight = new THREE.Vector3();
const _camDesiredPos = new THREE.Vector3();
const _camDesiredLook = new THREE.Vector3();
const _camCurrentLook = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _sparkColor = new THREE.Color(0xfbbf24);
const _nitroColor = new THREE.Color(0x38bdf8);
const _smokeColor = new THREE.Color(0xcbd5e1);
const _dustColor = new THREE.Color(0x9ca3af);

export class RacingEngine {
  private container: HTMLElement;
  private callbacks: EngineCallbacks;
  private audio = new RacingAudioEngine();

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private keyLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private pmremEnvTex: THREE.Texture | null = null;
  private contactShadowTex!: THREE.CanvasTexture;

  private isSoftwareGl = false;
  private maxAnisotropy = 1;
  private frameId = 0;
  private disposed = false;
  private contextLost = false;
  private lastTimestamp = 0;

  private trackConfig: TrackConfig = TRACK_CONFIGS[0];
  private playerCarSpec: CarSpec = CAR_SPECS[0];
  private builtTrack: BuiltTrack | null = null;
  private racers: RacerEntity[] = [];

  // Particle InstancedMesh
  private particleMesh!: THREE.InstancedMesh;
  private particles: ParticleItem[] = [];
  private particleCursor = 0;

  // Game state
  private phase: GamePhase = 'menu';
  private isMultiplayer = false;
  private cameraMode: CameraMode = 'chase';
  private countdownTimer = 3.2;
  private lastCountdownBeep = 4;
  private raceElapsedMs = 0;
  private lapBannerText: string | null = null;
  private lapBannerTimer = 0;
  private menuOrbitAngle = 0.65;
  private lastHudEmit = 0;

  private inputs: ControlInputState = {
    throttle: false,
    brake: false,
    left: false,
    right: false,
    drift: false,
    boost: false,
  };
  private touchInputs: Partial<ControlInputState> = {};

  constructor(container: HTMLElement, callbacks: EngineCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.initRendererAndScene();
    this.initParticles();
    this.loadTrackAndGrid(this.trackConfig, this.playerCarSpec);
    this.bindEvents();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.lastTimestamp = performance.now();
    this.tick(this.lastTimestamp);
  }

  private detectSoftwareWebGL(): boolean {
    try {
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    } catch {
      return true;
    }
  }

  private initRendererAndScene(): void {
    this.isSoftwareGl = this.detectSoftwareWebGL();

    const renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !this.isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    renderer.setSize(width, height);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

    const scene = new THREE.Scene();
    this.scene = scene;

    // Mandatory Studio Environment Reflection (RoomEnvironment)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    this.pmremEnvTex = envTex;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(62, width / height, 0.25, 1600);
    this.camera = camera;

    // 3-Point Outdoor Lighting Rig (Warm Key + Cool Sky/Ground Hemisphere + Rim)
    const hemi = new THREE.HemisphereLight(0x9dd4ff, 0x262626, 0.75);
    scene.add(hemi);
    this.hemiLight = hemi;

    const key = new THREE.DirectionalLight(0xfff1d6, 2.0);
    key.castShadow = !this.isSoftwareGl;
    key.shadow.mapSize.width = 2048;
    key.shadow.mapSize.height = 2048;
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 340;
    const d = 65;
    key.shadow.camera.left = -d;
    key.shadow.camera.right = d;
    key.shadow.camera.top = d;
    key.shadow.camera.bottom = -d;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    scene.add(key.target);
    this.keyLight = key;

    this.contactShadowTex = createContactShadowTexture();
  }

  private initParticles(): void {
    const count = 200;
    const geo = new THREE.SphereGeometry(0.32, 7, 7);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const instanced = new THREE.InstancedMesh(geo, mat, count);
    instanced.frustumCulled = false;

    for (let i = 0; i < count; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: -50,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        scale: 0.01,
        color: new THREE.Color(0xffffff),
      });
      _dummy.position.set(0, -50, 0);
      _dummy.scale.setScalar(0.001);
      _dummy.updateMatrix();
      instanced.setMatrixAt(i, _dummy.matrix);
      instanced.setColorAt(i, _smokeColor);
    }
    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
    this.scene.add(instanced);
    this.particleMesh = instanced;
  }

  private spawnParticle(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    scale: number,
    maxLife: number,
    color: THREE.Color,
  ): void {
    const p = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % this.particles.length;
    p.active = true;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.scale = scale;
    p.life = maxLife;
    p.maxLife = maxLife;
    p.color.copy(color);
  }

  private clearRacers(): void {
    for (const r of this.racers) {
      this.scene.remove(r.rig.root);
      r.rig.disposables.geometries.forEach((g) => g.dispose());
      r.rig.disposables.materials.forEach((m) => m.dispose());
    }
    this.racers = [];
  }

  public loadTrackAndGrid(trackCfg: TrackConfig, carSpec: CarSpec): void {
    this.trackConfig = trackCfg;
    this.playerCarSpec = carSpec;

    if (this.builtTrack) {
      this.scene.remove(this.builtTrack.group);
      this.builtTrack.dispose();
      this.builtTrack = null;
    }

    this.builtTrack = buildTrackScene(trackCfg, this.maxAnisotropy, this.isSoftwareGl);
    this.scene.add(this.builtTrack.group);

    // Atmosphere & lighting sync
    this.scene.background = new THREE.Color(trackCfg.fogColor);
    this.scene.fog = new THREE.FogExp2(trackCfg.fogColor, trackCfg.fogDensity);
    this.keyLight.color.setHex(trackCfg.sunColor);
    this.keyLight.intensity = trackCfg.sunIntensity;
    this.hemiLight.color.setHex(trackCfg.hemiSkyColor);
    this.hemiLight.groundColor.setHex(trackCfg.hemiGroundColor);
    this.hemiLight.intensity = trackCfg.hemiIntensity;

    this.spawnGridRacers();
    this.updateSunFollow();
  }

  private spawnGridRacers(): void {
    this.clearRacers();
    if (!this.builtTrack) return;

    const { samples, totalLength } = this.builtTrack;
    const totalCount = 6; // 5 AI rivals + player starting P6

    const sampleAtDistance = (distFromStart: number) => {
      let wrapped = distFromStart % totalLength;
      if (wrapped < 0) wrapped += totalLength;
      const idx = Math.floor((wrapped / totalLength) * samples.length) % samples.length;
      return { sample: samples[idx], idx, wrapped };
    };

    // Place 5 AI ahead on grid slots 0..4, and player in slot 5
    for (let slot = 0; slot < totalCount; slot++) {
      const isPlayer = slot === totalCount - 1;
      const row = Math.floor(slot / 2);
      const colSide = slot % 2 === 0 ? -3.4 : 3.4;
      const distBehindLine = 8 + row * 9.5;

      const { sample, idx, wrapped } = sampleAtDistance(-distBehindLine);
      const x = sample.point.x + sample.right.x * colSide;
      const z = sample.point.z + sample.right.z * colSide;
      const heading = Math.atan2(-sample.tangent.x, -sample.tangent.z);

      if (isPlayer) {
        const rig = buildRaceCarModel(
          this.playerCarSpec.primaryColor,
          this.playerCarSpec.accentColor,
          this.contactShadowTex,
          this.isSoftwareGl,
        );
        rig.root.position.set(x, 0, z);
        rig.root.rotation.y = heading;
        this.scene.add(rig.root);

        this.racers.push({
          id: 'player',
          name: 'You',
          carName: this.playerCarSpec.name,
          colorHex: this.playerCarSpec.hex,
          isPlayer: true,
          isRemote: false,
          rig,
          maxSpeedMs: this.playerCarSpec.maxSpeedKmh / 3.6,
          accel: this.playerCarSpec.acceleration,
          handling: this.playerCarSpec.handling,
          driftGrip: this.playerCarSpec.driftGrip,
          skill: 1.0,
          preferredLane: colSide,
          x,
          z,
          heading,
          vx: 0,
          vz: 0,
          steerAngle: 0,
          wheelSpin: 0,
          nitro: 100,
          isBoosting: false,
          isDrifting: false,
          hintIndex: idx,
          lastS: wrapped,
          totalProgress: -distBehindLine,
          currentLap: 1,
          lapStartMs: 0,
          bestLapMs: null,
          finishTimeMs: null,
          finished: false,
          targetX: x,
          targetZ: z,
          targetHeading: heading,
          targetVx: 0,
          targetVz: 0,
          targetSteerAngle: 0,
        });
      } else {
        const profile = RIVAL_PROFILES[slot];
        const rig = buildRaceCarModel(
          profile.color,
          0xf8fafc,
          this.contactShadowTex,
          this.isSoftwareGl,
        );
        rig.root.position.set(x, 0, z);
        rig.root.rotation.y = heading;
        this.scene.add(rig.root);

        this.racers.push({
          id: `ai-${slot}`,
          name: profile.name,
          carName: 'GT Rival',
          colorHex: profile.hex,
          isPlayer: false,
          isRemote: false,
          rig,
          maxSpeedMs: (242 + profile.skill * 34) / 3.6,
          accel: 26 + profile.skill * 6,
          handling: 1.05,
          driftGrip: 0.94,
          skill: profile.skill,
          preferredLane: (slot % 2 === 0 ? -1 : 1) * (1.5 + (slot % 3) * 1.4),
          x,
          z,
          heading,
          vx: 0,
          vz: 0,
          steerAngle: 0,
          wheelSpin: 0,
          nitro: 100,
          isBoosting: false,
          isDrifting: false,
          hintIndex: idx,
          lastS: wrapped,
          totalProgress: -distBehindLine,
          currentLap: 1,
          lapStartMs: 0,
          bestLapMs: null,
          finishTimeMs: null,
          finished: false,
          targetX: x,
          targetZ: z,
          targetHeading: heading,
          targetVx: 0,
          targetVz: 0,
          targetSteerAngle: 0,
        });
      }
    }

    // Snap chase lookAt target to player
    const player = this.getPlayer();
    if (player) {
      _camCurrentLook.set(player.x, 1.3, player.z);
    }
  }

  private spawnMultiplayerGrid(room: RoomStatePayload, selfId: string): void {
    this.clearRacers();
    if (!this.builtTrack) return;

    const { samples, totalLength } = this.builtTrack;
    const sampleAtDistance = (distFromStart: number) => {
      let wrapped = distFromStart % totalLength;
      if (wrapped < 0) wrapped += totalLength;
      const idx = Math.floor((wrapped / totalLength) * samples.length) % samples.length;
      return { sample: samples[idx], idx, wrapped };
    };

    const humanPlayers = [...room.players].sort((a, b) => a.slotIndex - b.slotIndex);
    const occupiedSlots = new Set<number>();

    for (const mp of humanPlayers) {
      const slot = mp.slotIndex;
      occupiedSlots.add(slot);
      const row = Math.floor(slot / 2);
      const colSide = slot % 2 === 0 ? -3.4 : 3.4;
      const distBehindLine = 8 + row * 9.5;
      const { sample, idx, wrapped } = sampleAtDistance(-distBehindLine);
      const x = sample.point.x + sample.right.x * colSide;
      const z = sample.point.z + sample.right.z * colSide;
      const heading = Math.atan2(-sample.tangent.x, -sample.tangent.z);

      const spec = CAR_SPECS.find((c) => c.id === mp.carId) ?? CAR_SPECS[0];
      const isSelf = mp.id === selfId;
      if (isSelf) {
        this.playerCarSpec = spec;
      }

      const rig = buildRaceCarModel(
        spec.primaryColor,
        spec.accentColor,
        this.contactShadowTex,
        this.isSoftwareGl,
      );
      rig.root.position.set(x, 0, z);
      rig.root.rotation.y = heading;
      this.scene.add(rig.root);

      this.racers.push({
        id: mp.id,
        name: isSelf ? `${mp.name} (You)` : mp.name,
        carName: spec.name,
        colorHex: spec.hex,
        isPlayer: isSelf,
        isRemote: !isSelf,
        rig,
        maxSpeedMs: spec.maxSpeedKmh / 3.6,
        accel: spec.acceleration,
        handling: spec.handling,
        driftGrip: spec.driftGrip,
        skill: 1.0,
        preferredLane: colSide,
        x,
        z,
        heading,
        vx: 0,
        vz: 0,
        steerAngle: 0,
        wheelSpin: 0,
        nitro: 100,
        isBoosting: false,
        isDrifting: false,
        hintIndex: idx,
        lastS: wrapped,
        totalProgress: -distBehindLine,
        currentLap: 1,
        lapStartMs: 0,
        bestLapMs: null,
        finishTimeMs: null,
        finished: false,
        targetX: x,
        targetZ: z,
        targetHeading: heading,
        targetVx: 0,
        targetVz: 0,
        targetSteerAngle: 0,
      });
    }

    if (room.fillWithAi) {
      let aiIdx = 0;
      for (let slot = 0; slot < 6; slot++) {
        if (occupiedSlots.has(slot)) continue;
        const profile = RIVAL_PROFILES[aiIdx % RIVAL_PROFILES.length];
        aiIdx++;
        const row = Math.floor(slot / 2);
        const colSide = slot % 2 === 0 ? -3.4 : 3.4;
        const distBehindLine = 8 + row * 9.5;
        const { sample, idx, wrapped } = sampleAtDistance(-distBehindLine);
        const x = sample.point.x + sample.right.x * colSide;
        const z = sample.point.z + sample.right.z * colSide;
        const heading = Math.atan2(-sample.tangent.x, -sample.tangent.z);

        const rig = buildRaceCarModel(
          profile.color,
          0xf8fafc,
          this.contactShadowTex,
          this.isSoftwareGl,
        );
        rig.root.position.set(x, 0, z);
        rig.root.rotation.y = heading;
        this.scene.add(rig.root);

        this.racers.push({
          id: `ai-${slot}`,
          name: profile.name,
          carName: 'GT Rival',
          colorHex: profile.hex,
          isPlayer: false,
          isRemote: false,
          rig,
          maxSpeedMs: (242 + profile.skill * 34) / 3.6,
          accel: 26 + profile.skill * 6,
          handling: 1.05,
          driftGrip: 0.94,
          skill: profile.skill,
          preferredLane: (slot % 2 === 0 ? -1 : 1) * (1.5 + (slot % 3) * 1.4),
          x,
          z,
          heading,
          vx: 0,
          vz: 0,
          steerAngle: 0,
          wheelSpin: 0,
          nitro: 100,
          isBoosting: false,
          isDrifting: false,
          hintIndex: idx,
          lastS: wrapped,
          totalProgress: -distBehindLine,
          currentLap: 1,
          lapStartMs: 0,
          bestLapMs: null,
          finishTimeMs: null,
          finished: false,
          targetX: x,
          targetZ: z,
          targetHeading: heading,
          targetVx: 0,
          targetVz: 0,
          targetSteerAngle: 0,
        });
      }
    }

    const player = this.getPlayer();
    if (player) {
      _camCurrentLook.set(player.x, 1.3, player.z);
    }
  }

  private getPlayer(): RacerEntity | undefined {
    return this.racers.find((r) => r.isPlayer);
  }

  public setSelection(trackId: string, carId: string): void {
    const t = TRACK_CONFIGS.find((c) => c.id === trackId) ?? TRACK_CONFIGS[0];
    const c = CAR_SPECS.find((s) => s.id === carId) ?? CAR_SPECS[0];
    if (t.id !== this.trackConfig.id || c.id !== this.playerCarSpec.id) {
      this.loadTrackAndGrid(t, c);
    }
  }

  public startRace(): void {
    this.isMultiplayer = false;
    this.audio.init();
    this.spawnGridRacers();
    this.phase = 'countdown';
    this.countdownTimer = 3.4;
    this.lastCountdownBeep = 4;
    this.raceElapsedMs = 0;
    this.lapBannerText = null;
    this.lapBannerTimer = 0;
    this.callbacks.onPhaseChange('countdown');
    this.emitHudTelemetry();
  }

  public startMultiplayerRace(room: RoomStatePayload, selfId: string): void {
    this.isMultiplayer = true;
    const track = TRACK_CONFIGS.find((t) => t.id === room.trackId) ?? TRACK_CONFIGS[0];
    const selfPlayer = room.players.find((p) => p.id === selfId);
    const selfCar = CAR_SPECS.find((c) => c.id === selfPlayer?.carId) ?? this.playerCarSpec;

    if (track.id !== this.trackConfig.id) {
      this.loadTrackAndGrid(track, selfCar);
    } else {
      this.trackConfig = track;
      this.playerCarSpec = selfCar;
    }

    this.audio.init();
    this.spawnMultiplayerGrid(room, selfId);
    this.phase = 'countdown';
    this.countdownTimer = 3.4;
    this.lastCountdownBeep = 4;
    this.raceElapsedMs = 0;
    this.lapBannerText = null;
    this.lapBannerTimer = 0;
    this.callbacks.onPhaseChange('countdown');
    this.emitHudTelemetry();
  }

  public applyRemoteSnapshots(snapshots: RemoteRacerSnapshot[]): void {
    if (!this.isMultiplayer) return;
    for (const snap of snapshots) {
      const r = this.racers.find((item) => item.id === snap.id);
      if (!r || r.isPlayer) continue;
      r.targetX = snap.x;
      r.targetZ = snap.z;
      r.targetHeading = snap.heading;
      r.targetVx = snap.vx;
      r.targetVz = snap.vz;
      r.targetSteerAngle = snap.steerAngle;
      r.isDrifting = snap.isDrifting;
      r.isBoosting = snap.isBoosting;
      r.totalProgress = snap.totalProgress;
      r.currentLap = snap.currentLap;
      r.bestLapMs = snap.bestLapMs;
      r.finishTimeMs = snap.finishTimeMs;
      r.finished = snap.finished;
    }
  }

  public togglePause(): void {
    if (this.phase === 'racing') {
      this.phase = 'paused';
      this.audio.updateTelemetry(0, false, false, 0, false);
      this.callbacks.onPhaseChange('paused');
    } else if (this.phase === 'paused') {
      this.phase = 'racing';
      this.lastTimestamp = performance.now();
      this.callbacks.onPhaseChange('racing');
    }
  }

  public returnToMenu(): void {
    this.isMultiplayer = false;
    this.phase = 'menu';
    this.audio.updateTelemetry(0, false, false, 0, false);
    this.spawnGridRacers();
    this.callbacks.onPhaseChange('menu');
  }

  public cycleCamera(): CameraMode {
    const order: CameraMode[] = ['chase', 'far', 'hood'];
    const next = order[(order.indexOf(this.cameraMode) + 1) % order.length];
    this.cameraMode = next;
    this.callbacks.onCameraChange?.(next);
    return next;
  }

  public getCameraMode(): CameraMode {
    return this.cameraMode;
  }

  public setMuted(mute: boolean): void {
    this.audio.setMuted(mute);
  }

  public setTouchControl(key: keyof ControlInputState, active: boolean): void {
    this.audio.init();
    this.touchInputs[key] = active;
  }

  public getMinimapGeometry(): { points: { x: number; z: number }[]; bounds: BuiltTrack['bounds'] } | null {
    if (!this.builtTrack) return null;
    return {
      points: this.builtTrack.minimapPoints,
      bounds: this.builtTrack.bounds,
    };
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);

    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
  }

  private handleContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
    this.callbacks.onContextLost(true);
  };

  private handleContextRestored = (): void => {
    this.contextLost = false;
    this.callbacks.onContextLost(false);
    this.lastTimestamp = performance.now();
  };

  private handleResize = (): void => {
    if (this.disposed) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.inputs.throttle = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.inputs.brake = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.inputs.left = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.inputs.right = true;
        break;
      case 'Space':
        this.inputs.drift = true;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
      case 'KeyN':
        this.inputs.boost = true;
        break;
      case 'KeyC':
        if (this.phase === 'racing' || this.phase === 'countdown') {
          this.cycleCamera();
        }
        break;
      case 'Escape':
      case 'KeyP':
        if (this.phase === 'racing' || this.phase === 'paused') {
          this.togglePause();
        }
        break;
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.inputs.throttle = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.inputs.brake = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.inputs.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.inputs.right = false;
        break;
      case 'Space':
        this.inputs.drift = false;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
      case 'KeyN':
        this.inputs.boost = false;
        break;
    }
  };

  private updateSunFollow(): void {
    const player = this.getPlayer();
    const cx = player ? player.x : 0;
    const cz = player ? player.z : 0;
    const [sx, sy, sz] = this.trackConfig.sunPosition;
    this.keyLight.position.set(cx + sx, sy, cz + sz);
    this.keyLight.target.position.set(cx, 0, cz);
    this.keyLight.target.updateMatrixWorld();
  }

  private updateRacerPhysics(
    r: RacerEntity,
    throttle: boolean,
    brake: boolean,
    steerInput: number,
    drift: boolean,
    boost: boolean,
    dt: number,
  ): void {
    if (!this.builtTrack) return;

    // Forward & Right vectors in XZ plane (heading=0 faces -Z)
    const sinH = Math.sin(r.heading);
    const cosH = Math.cos(r.heading);
    _vForward.set(-sinH, 0, -cosH);
    _vRight.set(cosH, 0, -sinH);

    let forwardSpeed = r.vx * _vForward.x + r.vz * _vForward.z;
    let lateralSpeed = r.vx * _vRight.x + r.vz * _vRight.z;

    // Nitro boost logic
    const canBoost = boost && r.nitro > 4 && forwardSpeed > 8;
    r.isBoosting = canBoost;
    if (canBoost) {
      r.nitro = Math.max(0, r.nitro - 28 * dt);
    } else {
      r.nitro = Math.min(100, r.nitro + (drift && Math.abs(lateralSpeed) > 3.5 ? 14 : 6.5) * dt);
    }

    // Track projection for surface & boundary detection
    const proj = projectPointToTrack(this.builtTrack, r.x, r.z, r.hintIndex);
    r.hintIndex = proj.sampleIndex;

    const roadHalf = this.builtTrack.roadWidth * 0.5;
    const offRoad = Math.abs(proj.lateralOffset) > roadHalf + 0.8;

    const topSpeed = r.maxSpeedMs * (canBoost ? 1.24 : 1.0) * (offRoad ? 0.68 : 1.0);
    const accelPower = r.accel * (canBoost ? 1.55 : 1.0);

    // Longitudinal acceleration / braking / reverse
    if (throttle) {
      const speedRatio = THREE.MathUtils.clamp(forwardSpeed / topSpeed, 0, 1);
      const effectiveAccel = accelPower * (1.0 - 0.55 * speedRatio * speedRatio);
      forwardSpeed += effectiveAccel * dt;
    } else if (brake) {
      if (forwardSpeed > 1.5) {
        forwardSpeed -= 44 * dt;
      } else {
        forwardSpeed = Math.max(-18, forwardSpeed - 18 * dt);
      }
    } else {
      // Natural aerodynamic & rolling drag
      forwardSpeed *= Math.exp(-0.9 * dt);
    }

    // Cap max speed smoothly
    if (forwardSpeed > topSpeed) {
      forwardSpeed = THREE.MathUtils.damp(forwardSpeed, topSpeed, 4.0, dt);
    }

    // Steering response scales with speed
    const speedFactor = THREE.MathUtils.clamp(Math.abs(forwardSpeed) / 14, 0, 1);
    const highSpeedStability = 1.0 - THREE.MathUtils.clamp(Math.abs(forwardSpeed) / 95, 0, 0.36);
    const dirSign = forwardSpeed >= -0.5 ? 1 : -1;
    const manualDrift = drift && Math.abs(forwardSpeed) > 14 && Math.abs(steerInput) > 0.1;
    const naturalSlide = Math.abs(lateralSpeed) > 5.0 && Math.abs(forwardSpeed) > 16;
    const isDrifting = manualDrift || naturalSlide;
    r.isDrifting = isDrifting;

    const turnRate =
      steerInput *
      2.35 *
      r.handling *
      speedFactor *
      highSpeedStability *
      (isDrifting ? 1.26 : 1.0) *
      dirSign;
    r.heading += turnRate * dt;

    // Recompute basis after yaw update
    const nSin = Math.sin(r.heading);
    const nCos = Math.cos(r.heading);
    _vForward.set(-nSin, 0, -nCos);
    _vRight.set(nCos, 0, -nSin);

    // Lateral tire grip (drifting lets rear slide smoothly)
    const grip = isDrifting ? 2.4 : 8.2 * r.driftGrip;
    lateralSpeed *= Math.exp(-grip * dt);
    if (offRoad) {
      forwardSpeed *= Math.exp(-1.5 * dt);
    }

    r.vx = _vForward.x * forwardSpeed + _vRight.x * lateralSpeed;
    r.vz = _vForward.z * forwardSpeed + _vRight.z * lateralSpeed;

    r.x += r.vx * dt;
    r.z += r.vz * dt;

    // Barrier collision containment
    const postProj = projectPointToTrack(this.builtTrack, r.x, r.z, r.hintIndex);
    r.hintIndex = postProj.sampleIndex;
    const maxLat = this.builtTrack.barrierHalfWidth;

    if (Math.abs(postProj.lateralOffset) > maxLat) {
      const sign = Math.sign(postProj.lateralOffset);
      const excess = Math.abs(postProj.lateralOffset) - maxLat;
      r.x -= postProj.right.x * sign * excess;
      r.z -= postProj.right.z * sign * excess;

      // Remove outward normal velocity + subtle bounce & speed scrape
      const vOut = r.vx * postProj.right.x * sign + r.vz * postProj.right.z * sign;
      if (vOut > 0) {
        r.vx -= postProj.right.x * sign * vOut * 1.25;
        r.vz -= postProj.right.z * sign * vOut * 1.25;
        r.vx *= 0.88;
        r.vz *= 0.88;
        if (r.isPlayer && vOut > 4) {
          this.audio.playCollision(vOut / 20);
        }
        if (vOut > 3) {
          this.spawnParticle(
            r.x + postProj.right.x * sign * 0.9,
            0.55,
            r.z + postProj.right.z * sign * 0.9,
            (Math.random() - 0.5) * 6,
            2 + Math.random() * 4,
            (Math.random() - 0.5) * 6,
            0.45,
            0.32,
            _sparkColor,
          );
        }
      }
    }

    // Update unwrapped track progress & lap count
    let deltaS = postProj.s - r.lastS;
    if (deltaS < -this.builtTrack.totalLength * 0.5) {
      deltaS += this.builtTrack.totalLength;
    } else if (deltaS > this.builtTrack.totalLength * 0.5) {
      deltaS -= this.builtTrack.totalLength;
    }
    r.lastS = postProj.s;
    r.totalProgress += deltaS;

    const computedLap = Math.max(1, Math.floor(r.totalProgress / this.builtTrack.totalLength) + 1);
    if (computedLap > r.currentLap && !r.finished) {
      // Completed a lap!
      if (r.currentLap >= 1) {
        const lapTime = this.raceElapsedMs - r.lapStartMs;
        if (lapTime > 5000 && (r.bestLapMs === null || lapTime < r.bestLapMs)) {
          r.bestLapMs = lapTime;
        }
        r.lapStartMs = this.raceElapsedMs;
      }

      if (computedLap > this.trackConfig.laps) {
        r.finished = true;
        r.finishTimeMs = this.raceElapsedMs;
        r.currentLap = this.trackConfig.laps;
      } else {
        r.currentLap = computedLap;
        if (r.isPlayer) {
          this.lapBannerText =
            computedLap === this.trackConfig.laps ? 'FINAL LAP' : `LAP ${computedLap} / ${this.trackConfig.laps}`;
          this.lapBannerTimer = 2.4;
        }
      }
    }

    // Visual Rig Animations (chassis roll/pitch, steering wheels, spinning rims, brake lights, flames)
    r.rig.root.position.set(r.x, 0, r.z);
    r.rig.root.rotation.y = r.heading;

    const targetSteer = steerInput * 0.38;
    r.steerAngle = THREE.MathUtils.damp(r.steerAngle, targetSteer, 14, dt);
    r.rig.frontLeftSteer.rotation.y = r.steerAngle;
    r.rig.frontRightSteer.rotation.y = r.steerAngle;

    r.wheelSpin -= (forwardSpeed / 0.35) * dt;
    for (let w = 0; w < r.rig.wheels.length; w++) {
      r.rig.wheels[w].rotation.x = r.wheelSpin;
    }

    // Body roll on lateral G & pitch under accel/brake
    const targetRoll = THREE.MathUtils.clamp(-lateralSpeed * 0.012 - steerInput * 0.025, -0.09, 0.09);
    const targetPitch = brake ? -0.032 : throttle || canBoost ? 0.024 : 0;
    r.rig.chassisGroup.rotation.z = THREE.MathUtils.damp(r.rig.chassisGroup.rotation.z, targetRoll, 10, dt);
    r.rig.chassisGroup.rotation.x = THREE.MathUtils.damp(r.rig.chassisGroup.rotation.x, targetPitch, 10, dt);

    // Brake light glow
    r.rig.tailLightMat.emissiveIntensity = brake ? 4.2 : 1.3;

    // Nitro boost flames
    const showFlame = r.isBoosting;
    r.rig.flameLeft.visible = showFlame;
    r.rig.flameRight.visible = showFlame;
    if (showFlame) {
      const flicker = 0.85 + Math.random() * 0.45;
      r.rig.flameLeft.scale.set(1, 1, flicker);
      r.rig.flameRight.scale.set(1, 1, flicker);
      if (Math.random() < 0.65) {
        this.spawnParticle(
          r.x - _vForward.x * 2.45 + (Math.random() - 0.5) * 0.5,
          0.32,
          r.z - _vForward.z * 2.45 + (Math.random() - 0.5) * 0.5,
          -r.vx * 0.12,
          0.5 + Math.random(),
          -r.vz * 0.12,
          0.55,
          0.25,
          _nitroColor,
        );
      }
    }

    // Rear-tire procedural drift smoke & friction sparks whenever isDrifting is true
    if (r.isDrifting || (offRoad && Math.abs(forwardSpeed) > 8)) {
      const rearCenterX = r.x - _vForward.x * 1.36;
      const rearCenterZ = r.z - _vForward.z * 1.36;
      const tireHalfTrack = 0.98;
      const smokeTint = offRoad ? _dustColor : _smokeColor;

      if (r.isDrifting) {
        for (const side of [-1, 1]) {
          const wx = rearCenterX + _vRight.x * (tireHalfTrack * side);
          const wz = rearCenterZ + _vRight.z * (tireHalfTrack * side);

          this.spawnParticle(
            wx + (Math.random() - 0.5) * 0.22,
            0.16,
            wz + (Math.random() - 0.5) * 0.22,
            -_vForward.x * 2.2 + (Math.random() - 0.5) * 1.6,
            0.9 + Math.random() * 1.1,
            -_vForward.z * 2.2 + (Math.random() - 0.5) * 1.6,
            0.78 + Math.random() * 0.35,
            0.46 + Math.random() * 0.14,
            smokeTint,
          );
        }

        // Subtle hot friction sparks from the loaded outside rear tire during aggressive drifts
        if (Math.abs(lateralSpeed) > 4.0 && Math.random() < 0.45) {
          const outerSide = lateralSpeed >= 0 ? -1 : 1;
          const sx = rearCenterX + _vRight.x * (tireHalfTrack * outerSide);
          const sz = rearCenterZ + _vRight.z * (tireHalfTrack * outerSide);
          this.spawnParticle(
            sx,
            0.14,
            sz,
            -_vForward.x * 5.0 + (Math.random() - 0.5) * 3.0,
            1.8 + Math.random() * 2.2,
            -_vForward.z * 5.0 + (Math.random() - 0.5) * 3.0,
            0.26,
            0.22,
            _sparkColor,
          );
        }
      } else if (Math.random() < 0.55) {
        const side = Math.random() > 0.5 ? 1 : -1;
        this.spawnParticle(
          rearCenterX + _vRight.x * (tireHalfTrack * side) + (Math.random() - 0.5) * 0.3,
          0.18,
          rearCenterZ + _vRight.z * (tireHalfTrack * side) + (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 1.4,
          0.7 + Math.random() * 0.8,
          (Math.random() - 0.5) * 1.4,
          0.85,
          0.48,
          smokeTint,
        );
      }
    }
  }

  private updateRemoteRacer(r: RacerEntity, dt: number): void {
    // Extrapolate slightly with velocity then damp smoothly toward authoritative remote snapshot
    r.x = THREE.MathUtils.damp(r.x + r.targetVx * dt * 0.35, r.targetX, 14, dt);
    r.z = THREE.MathUtils.damp(r.z + r.targetVz * dt * 0.35, r.targetZ, 14, dt);

    let angleDiff = r.targetHeading - r.heading;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    r.heading += angleDiff * (1 - Math.exp(-14 * dt));

    r.vx = THREE.MathUtils.damp(r.vx, r.targetVx, 12, dt);
    r.vz = THREE.MathUtils.damp(r.vz, r.targetVz, 12, dt);
    r.steerAngle = THREE.MathUtils.damp(r.steerAngle, r.targetSteerAngle, 14, dt);

    r.rig.root.position.set(r.x, 0, r.z);
    r.rig.root.rotation.y = r.heading;
    r.rig.frontLeftSteer.rotation.y = r.steerAngle;
    r.rig.frontRightSteer.rotation.y = r.steerAngle;

    const sinH = Math.sin(r.heading);
    const cosH = Math.cos(r.heading);
    _vForward.set(-sinH, 0, -cosH);
    _vRight.set(cosH, 0, -sinH);

    const forwardSpeed = r.vx * _vForward.x + r.vz * _vForward.z;
    r.wheelSpin -= (forwardSpeed / 0.35) * dt;
    for (let w = 0; w < r.rig.wheels.length; w++) {
      r.rig.wheels[w].rotation.x = r.wheelSpin;
    }

    r.rig.flameLeft.visible = r.isBoosting;
    r.rig.flameRight.visible = r.isBoosting;
    if (r.isBoosting) {
      const flicker = 0.85 + Math.random() * 0.45;
      r.rig.flameLeft.scale.set(1, 1, flicker);
      r.rig.flameRight.scale.set(1, 1, flicker);
    }

    if (r.isDrifting) {
      const rearCenterX = r.x - _vForward.x * 1.36;
      const rearCenterZ = r.z - _vForward.z * 1.36;
      for (const side of [-1, 1]) {
        this.spawnParticle(
          rearCenterX + _vRight.x * (0.98 * side) + (Math.random() - 0.5) * 0.2,
          0.16,
          rearCenterZ + _vRight.z * (0.98 * side) + (Math.random() - 0.5) * 0.2,
          -_vForward.x * 2.0 + (Math.random() - 0.5) * 1.4,
          0.9 + Math.random(),
          -_vForward.z * 2.0 + (Math.random() - 0.5) * 1.4,
          0.76,
          0.42,
          _smokeColor,
        );
      }
    }
  }

  private updateAiDriver(r: RacerEntity, dt: number): void {
    if (!this.builtTrack) return;

    const proj = projectPointToTrack(this.builtTrack, r.x, r.z, r.hintIndex);
    const { samples, totalLength } = this.builtTrack;

    // Look ahead along the track spline
    const lookDist = 22;
    let targetS = proj.s + lookDist;
    if (targetS >= totalLength) targetS -= totalLength;
    const targetIdx = Math.floor((targetS / totalLength) * samples.length) % samples.length;
    const targetSample = samples[targetIdx];

    // Check if another car is directly ahead to nudge lane offset
    let dynamicLane = r.preferredLane;
    for (const other of this.racers) {
      if (other === r) continue;
      const dx = other.x - r.x;
      const dz = other.z - r.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < 180) {
        const dotFwd = dx * -Math.sin(r.heading) + dz * -Math.cos(r.heading);
        if (dotFwd > 0 && dotFwd < 13) {
          dynamicLane = proj.lateralOffset > 0 ? -3.8 : 3.8;
          break;
        }
      }
    }

    const tx = targetSample.point.x + targetSample.right.x * dynamicLane;
    const tz = targetSample.point.z + targetSample.right.z * dynamicLane;

    const desiredHeading = Math.atan2(-(tx - r.x), -(tz - r.z));
    let angleDiff = desiredHeading - r.heading;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const steerInput = THREE.MathUtils.clamp(angleDiff * 1.85, -1, 1);

    // Corner speed control
    const speed = Math.hypot(r.vx, r.vz);
    const cornerSeverity = proj.curvatureAhead; // ~0 on straights, ~0.12-0.35 on sharp corners
    const targetCornerSpeed = cornerSeverity > 0.1 ? THREE.MathUtils.clamp(68 - cornerSeverity * 175, 24, 72) : 90;

    // Subtle competitive rubber-banding relative to player
    const player = this.getPlayer();
    let paceBoost = 1.0;
    if (player && !r.finished) {
      const gap = player.totalProgress - r.totalProgress;
      if (gap > 55) paceBoost = 1.07;
      else if (gap < -85) paceBoost = 0.94;
    }

    const wantThrottle = speed < targetCornerSpeed * paceBoost;
    const wantBrake = speed > targetCornerSpeed * 1.18;
    const wantBoost = cornerSeverity < 0.04 && r.nitro > 60 && paceBoost > 1.02;

    this.updateRacerPhysics(r, wantThrottle, wantBrake, steerInput, false, wantBoost, dt);
  }

  private resolveCarCollisions(): void {
    const minDist = 2.6;
    const minDistSq = minDist * minDist;

    for (let i = 0; i < this.racers.length; i++) {
      for (let j = i + 1; j < this.racers.length; j++) {
        const a = this.racers[i];
        const b = this.racers[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dSq = dx * dx + dz * dz;
        if (dSq > 0.0001 && dSq < minDistSq) {
          const dist = Math.sqrt(dSq);
          const nx = dx / dist;
          const nz = dz / dist;
          const overlap = (minDist - dist) * 0.5;

          a.x -= nx * overlap;
          a.z -= nz * overlap;
          b.x += nx * overlap;
          b.z += nz * overlap;

          // Impulse exchange along collision normal
          const rvx = b.vx - a.vx;
          const rvz = b.vz - a.vz;
          const velAlongNormal = rvx * nx + rvz * nz;
          if (velAlongNormal < 0) {
            const impulse = -velAlongNormal * 0.65;
            a.vx -= nx * impulse;
            a.vz -= nz * impulse;
            b.vx += nx * impulse;
            b.vz += nz * impulse;

            if ((a.isPlayer || b.isPlayer) && Math.abs(velAlongNormal) > 3) {
              this.audio.playCollision(Math.abs(velAlongNormal) / 18);
            }
          }
        }
      }
    }
  }

  private updateParticles(dt: number): void {
    let dirty = false;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      dirty = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        _dummy.position.set(0, -50, 0);
        _dummy.scale.setScalar(0.001);
        _dummy.updateMatrix();
        this.particleMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const ratio = p.life / p.maxLife;
      const s = p.scale * (1.25 - ratio * 0.5);
      _dummy.position.set(p.x, p.y, p.z);
      _dummy.scale.setScalar(s);
      _dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, _dummy.matrix);
      this.particleMesh.setColorAt(i, p.color);
    }
    if (dirty) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
      if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    }
  }

  private updateCamera(dt: number): void {
    const player = this.getPlayer();
    if (!player) return;

    if (this.phase === 'menu') {
      this.menuOrbitAngle += dt * 0.28;
      const radius = 6.2;
      const cx = player.x + Math.sin(this.menuOrbitAngle) * radius;
      const cz = player.z + Math.cos(this.menuOrbitAngle) * radius;
      this.camera.position.set(cx, 2.35, cz);
      this.camera.lookAt(player.x, 0.78, player.z);
      if (Math.abs(this.camera.fov - 52) > 0.1) {
        this.camera.fov = 52;
        this.camera.updateProjectionMatrix();
      }
      return;
    }

    const sinH = Math.sin(player.heading);
    const cosH = Math.cos(player.heading);
    _vForward.set(-sinH, 0, -cosH);

    const speed = Math.hypot(player.vx, player.vz);
    const speedNorm = THREE.MathUtils.clamp(speed / 75, 0, 1);

    if (this.cameraMode === 'hood') {
      _camDesiredPos.set(
        player.x + _vForward.x * 0.45,
        1.18,
        player.z + _vForward.z * 0.45,
      );
      _camDesiredLook.set(
        player.x + _vForward.x * 24,
        0.95,
        player.z + _vForward.z * 24,
      );
      this.camera.position.copy(_camDesiredPos);
      this.camera.lookAt(_camDesiredLook);
    } else {
      const dist = this.cameraMode === 'far' ? 10.6 : 7.6;
      const height = this.cameraMode === 'far' ? 4.2 : 3.05;

      _camDesiredPos.set(
        player.x - _vForward.x * dist,
        height,
        player.z - _vForward.z * dist,
      );
      _camDesiredLook.set(
        player.x + _vForward.x * 8.5,
        1.15,
        player.z + _vForward.z * 8.5,
      );

      this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _camDesiredPos.x, 9, dt);
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _camDesiredPos.y, 9, dt);
      this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _camDesiredPos.z, 9, dt);

      _camCurrentLook.x = THREE.MathUtils.damp(_camCurrentLook.x, _camDesiredLook.x, 12, dt);
      _camCurrentLook.y = THREE.MathUtils.damp(_camCurrentLook.y, _camDesiredLook.y, 12, dt);
      _camCurrentLook.z = THREE.MathUtils.damp(_camCurrentLook.z, _camDesiredLook.z, 12, dt);
      this.camera.lookAt(_camCurrentLook);
    }

    const targetFov = 60 + speedNorm * 14 + (player.isBoosting ? 7 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 7, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  private updateGantryLights(countdownVal: number): void {
    if (!this.builtTrack) return;
    const mats = this.builtTrack.startLightMats;
    if (this.phase === 'countdown') {
      const litCount = countdownVal === 3 ? 2 : countdownVal === 2 ? 4 : countdownVal === 1 ? 5 : 0;
      for (let i = 0; i < mats.length; i++) {
        mats[i].emissive.setHex(countdownVal === 0 ? 0x22c55e : 0xef4444);
        mats[i].emissiveIntensity = countdownVal === 0 ? 3.5 : i < litCount ? 3.2 : 0.0;
      }
    } else {
      for (let i = 0; i < mats.length; i++) {
        mats[i].emissiveIntensity = 0.0;
      }
    }
  }

  private computeStandings(): RacerEntity[] {
    return [...this.racers].sort((a, b) => {
      if (a.finished && b.finished) {
        return (a.finishTimeMs ?? 0) - (b.finishTimeMs ?? 0);
      }
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.totalProgress - a.totalProgress;
    });
  }

  private emitHudTelemetry(): void {
    const player = this.getPlayer();
    if (!player || !this.builtTrack) return;

    const sorted = this.computeStandings();
    const position = sorted.findIndex((r) => r.isPlayer) + 1;

    const speedMs = Math.hypot(player.vx, player.vz);
    const speedKmh = Math.round(speedMs * 3.6);

    // Compute realistic 6-speed gearbox & RPM ratio
    const maxKmh = this.playerCarSpec.maxSpeedKmh * 1.18;
    const normSpeed = THREE.MathUtils.clamp(speedKmh / maxKmh, 0, 1);
    const gear = speedKmh < 5 ? 1 : Math.min(6, Math.floor(normSpeed * 5.6) + 1);
    const gearMin = (gear - 1) / 6;
    const gearMax = gear / 6;
    const rpmRatio =
      speedKmh < 5
        ? 0.22 + (this.inputs.throttle ? 0.3 : 0)
        : THREE.MathUtils.clamp(0.32 + ((normSpeed - gearMin) / (gearMax - gearMin)) * 0.65, 0.2, 0.99);

    // Wrong way detection
    const proj = projectPointToTrack(this.builtTrack, player.x, player.z, player.hintIndex);
    const fwdDot =
      -Math.sin(player.heading) * proj.tangent.x + -Math.cos(player.heading) * proj.tangent.z;
    const wrongWay = speedMs > 6 && fwdDot < -0.35;

    const dots: RacerHudDot[] = this.racers.map((r) => ({
      id: r.id,
      x: r.x,
      z: r.z,
      isPlayer: r.isPlayer,
      color: r.colorHex,
    }));

    const countdownDisplay =
      this.phase === 'countdown' ? Math.max(0, Math.ceil(this.countdownTimer - 0.4)) : 0;

    this.callbacks.onTelemetry({
      speedKmh,
      rpmRatio,
      gear,
      nitro: Math.round(player.nitro),
      isBoosting: player.isBoosting,
      isDrifting: player.isDrifting,
      position,
      totalRacers: this.racers.length,
      lap: player.currentLap,
      totalLaps: this.trackConfig.laps,
      currentLapMs: Math.max(0, this.raceElapsedMs - player.lapStartMs),
      bestLapMs: player.bestLapMs,
      totalRaceMs: this.raceElapsedMs,
      countdownValue: countdownDisplay,
      wrongWay,
      lapNotification: this.lapBannerTimer > 0 ? this.lapBannerText : null,
      dots,
    });
  }

  private finishRace(): void {
    this.phase = 'finished';
    this.audio.updateTelemetry(0, false, false, 0, false);
    this.callbacks.onPhaseChange('finished');

    const sorted = this.computeStandings();
    const player = this.getPlayer();
    const results: RacerResult[] = sorted.map((r, idx) => {
      // Estimate remaining time cleanly for AI still on track when player finishes
      let totalTime = r.finishTimeMs ?? this.raceElapsedMs;
      if (!r.finished && this.builtTrack) {
        const remainingMeters = Math.max(
          0,
          this.trackConfig.laps * this.builtTrack.totalLength - r.totalProgress,
        );
        const estSpeed = Math.max(38, r.maxSpeedMs * 0.85);
        totalTime = this.raceElapsedMs + (remainingMeters / estSpeed) * 1000;
      }
      return {
        id: r.id,
        name: r.name,
        carName: r.carName,
        colorHex: r.colorHex,
        isPlayer: r.isPlayer,
        position: idx + 1,
        totalTimeMs: Math.round(totalTime),
        bestLapMs: r.bestLapMs ?? (player?.bestLapMs ? Math.round(player.bestLapMs * (1 + idx * 0.015)) : null),
        finished: r.finished,
      };
    });

    this.callbacks.onRaceFinish(results);
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick = (timestamp: number): void => {
    if (this.disposed) return;

    const rawDt = (timestamp - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestamp;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

    if (!this.contextLost) {
      if (this.phase === 'countdown') {
        this.countdownTimer -= dt;
        const beepStage = Math.max(0, Math.ceil(this.countdownTimer - 0.4));
        if (beepStage < this.lastCountdownBeep && beepStage >= 0) {
          this.lastCountdownBeep = beepStage;
          this.audio.playCountdownBeep(beepStage === 0);
        }
        this.updateGantryLights(beepStage);

        if (this.countdownTimer <= 0.4) {
          this.phase = 'racing';
          this.callbacks.onPhaseChange('racing');
          this.updateGantryLights(-1);
        }
        this.updateCamera(dt);
      } else if (this.phase === 'racing') {
        this.raceElapsedMs += dt * 1000;
        if (this.lapBannerTimer > 0) this.lapBannerTimer -= dt;

        const throttle = this.inputs.throttle || Boolean(this.touchInputs.throttle);
        const brake = this.inputs.brake || Boolean(this.touchInputs.brake);
        const left = this.inputs.left || Boolean(this.touchInputs.left);
        const right = this.inputs.right || Boolean(this.touchInputs.right);
        const drift = this.inputs.drift || Boolean(this.touchInputs.drift);
        const boost = this.inputs.boost || Boolean(this.touchInputs.boost);
        const steerInput = (left ? 1 : 0) - (right ? 1 : 0);

        for (const r of this.racers) {
          if (r.isPlayer) {
            this.updateRacerPhysics(r, throttle, brake, steerInput, drift, boost, dt);
          } else if (r.isRemote) {
            this.updateRemoteRacer(r, dt);
          } else {
            this.updateAiDriver(r, dt);
          }
        }

        this.resolveCarCollisions();
        this.updateParticles(dt);
        this.updateSunFollow();
        this.updateCamera(dt);

        const player = this.getPlayer();
        if (player) {
          if (this.isMultiplayer && this.callbacks.onLocalSnapshot) {
            this.callbacks.onLocalSnapshot({
              x: player.x,
              z: player.z,
              heading: player.heading,
              vx: player.vx,
              vz: player.vz,
              steerAngle: player.steerAngle,
              isDrifting: player.isDrifting,
              isBoosting: player.isBoosting,
              totalProgress: player.totalProgress,
              currentLap: player.currentLap,
              bestLapMs: player.bestLapMs,
              finishTimeMs: player.finishTimeMs,
              finished: player.finished,
            });
          }

          const speedKmh = Math.hypot(player.vx, player.vz) * 3.6;
          const rpm = THREE.MathUtils.clamp(speedKmh / (this.playerCarSpec.maxSpeedKmh * 1.15), 0.1, 1);
          const sinH = Math.sin(player.heading);
          const cosH = Math.cos(player.heading);
          const latSpeed = Math.abs(player.vx * cosH + player.vz * -sinH);
          const driftInt = THREE.MathUtils.clamp((latSpeed - 3.5) / 10, 0, 1);
          this.audio.updateTelemetry(rpm, throttle, player.isBoosting, driftInt, true);

          if (player.finished) {
            this.finishRace();
          }
        }
      } else {
        this.updateCamera(dt);
      }

      // Emit React HUD updates at ~24Hz so React never causes frame jitter
      if (timestamp - this.lastHudEmit > 40) {
        this.lastHudEmit = timestamp;
        this.emitHudTelemetry();
      }

      this.renderer.render(this.scene, this.camera);
    }

    if (this.isSoftwareGl) {
      this.afterDraw(() => this.tick(performance.now()));
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);

    this.clearRacers();
    this.builtTrack?.dispose();
    this.particleMesh.geometry.dispose();
    (this.particleMesh.material as THREE.Material).dispose();
    this.contactShadowTex.dispose();
    this.pmremEnvTex?.dispose();
    this.audio.dispose();

    this.renderer.dispose();
    if (canvas.parentElement === this.container) {
      this.container.removeChild(canvas);
    }
  }
}
