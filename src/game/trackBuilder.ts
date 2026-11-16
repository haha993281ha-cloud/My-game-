import * as THREE from 'three';
import { TrackConfig } from './types';
import {
  createAsphaltTexture,
  createBannerTexture,
  createCheckeredTexture,
  createCurbTexture,
  createSkyDomeTexture,
} from './textures';

export interface TrackSample {
  index: number;
  s: number; // distance along track in meters
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  curvature: number; // radians per sample
}

export interface TrackProjection {
  sampleIndex: number;
  s: number;
  lateralOffset: number; // + right, - left
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  closestPoint: THREE.Vector3;
  curvatureAhead: number;
}

export interface BuiltTrack {
  group: THREE.Group;
  samples: TrackSample[];
  totalLength: number;
  roadWidth: number;
  barrierHalfWidth: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  minimapPoints: { x: number; z: number }[];
  startLightMats: THREE.MeshStandardMaterial[];
  dispose: () => void;
}

const SAMPLE_COUNT = 640;
const _up = new THREE.Vector3(0, 1, 0);
const _delta = new THREE.Vector3();

export function projectPointToTrack(
  track: BuiltTrack,
  x: number,
  z: number,
  hintIndex?: number,
): TrackProjection {
  const { samples, totalLength } = track;
  const n = samples.length;

  let bestIdx = 0;
  let bestDistSq = Infinity;

  if (hintIndex !== undefined && hintIndex >= 0 && hintIndex < n) {
    const windowRadius = 32;
    for (let offset = -windowRadius; offset <= windowRadius; offset++) {
      const idx = (hintIndex + offset + n) % n;
      const p = samples[idx].point;
      const dx = x - p.x;
      const dz = z - p.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = idx;
      }
    }
  }

  // Fallback full scan if far from hint
  if (bestDistSq > 900 || hintIndex === undefined) {
    for (let i = 0; i < n; i++) {
      const p = samples[i].point;
      const dx = x - p.x;
      const dz = z - p.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = i;
      }
    }
  }

  const sample = samples[bestIdx];
  _delta.set(x - sample.point.x, 0, z - sample.point.z);
  const along = _delta.dot(sample.tangent);
  const lateralOffset = _delta.dot(sample.right);

  let s = sample.s + along;
  if (s < 0) s += totalLength;
  if (s >= totalLength) s -= totalLength;

  // Look ahead curvature for AI braking
  let maxCurv = 0;
  for (let k = 2; k <= 26; k += 3) {
    const ahead = samples[(bestIdx + k) % n];
    const absC = Math.abs(ahead.curvature);
    if (absC > maxCurv) maxCurv = absC;
  }

  return {
    sampleIndex: bestIdx,
    s,
    lateralOffset,
    tangent: sample.tangent,
    right: sample.right,
    closestPoint: sample.point,
    curvatureAhead: maxCurv,
  };
}

export function buildTrackScene(
  config: TrackConfig,
  maxAnisotropy: number,
  isSoftwareGl: boolean,
): BuiltTrack {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };
  const trackTex = <T extends THREE.Texture>(t: T): T => {
    textures.push(t);
    return t;
  };

  // 1. Build closed CatmullRom spline
  const ctrlPts = config.waypoints.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(ctrlPts, true, 'centripetal', 0.5);
  const totalLength = curve.getLength();

  const samples: TrackSample[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const u = i / SAMPLE_COUNT;
    const pt = curve.getPointAt(u);
    const tan = curve.getTangentAt(u).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(tan, _up).normalize();

    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.z < minZ) minZ = pt.z;
    if (pt.z > maxZ) maxZ = pt.z;

    samples.push({
      index: i,
      s: u * totalLength,
      point: pt,
      tangent: tan,
      right,
      curvature: 0,
    });
  }

  // Compute discrete curvature at each sample
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const prev = samples[(i - 2 + SAMPLE_COUNT) % SAMPLE_COUNT].tangent;
    const next = samples[(i + 2) % SAMPLE_COUNT].tangent;
    const crossY = prev.z * next.x - prev.x * next.z;
    const dot = THREE.MathUtils.clamp(prev.dot(next), -1, 1);
    samples[i].curvature = Math.atan2(crossY, dot);
  }

  const roadHalf = config.roadWidth * 0.5;
  const curbWidth = 1.15;
  const barrierOffset = roadHalf + 3.4;

  // 2. Sky Gradient Dome
  const skyTex = trackTex(createSkyDomeTexture(config.skyTopHex, config.skyBottomHex));
  const skyDome = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(1200, 32, 20)),
    trackMat(
      new THREE.MeshBasicMaterial({
        map: skyTex,
        side: THREE.BackSide,
        fog: false,
      }),
    ),
  );
  group.add(skyDome);

  // 3. Rolling Terrain Ground (blended flat near the track corridor)
  const terrainSize = 1800;
  const terrainSegs = 120;
  const terrainGeo = trackGeo(
    new THREE.PlaneGeometry(terrainSize, terrainSize, terrainSegs, terrainSegs),
  );
  terrainGeo.rotateX(-Math.PI / 2);

  const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(posAttr.count * 3);
  const colA = new THREE.Color(config.groundColor);
  const colB = new THREE.Color(config.groundAccentColor);
  const tmpCol = new THREE.Color();

  // Coarse track points for fast terrain flattening check
  const coarseStep = 4;
  const coarsePts: THREE.Vector3[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i += coarseStep) {
    coarsePts.push(samples[i].point);
  }

  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);

    let minDistSq = Infinity;
    for (let j = 0; j < coarsePts.length; j++) {
      const dx = vx - coarsePts[j].x;
      const dz = vz - coarsePts[j].z;
      const dSq = dx * dx + dz * dz;
      if (dSq < minDistSq) minDistSq = dSq;
    }
    const dist = Math.sqrt(minDistSq);

    // Smooth blend from flat road apron (dist <= roadHalf + 10) to rolling hills outside
    const blend = THREE.MathUtils.smoothstep(dist, roadHalf + 10, roadHalf + 55);
    const hillWave =
      Math.sin(vx * 0.012) * Math.cos(vz * 0.012) * 14 +
      Math.sin(vx * 0.028 + 1.4) * Math.sin(vz * 0.023) * 6 +
      Math.max(0, (dist - 220) * 0.08);
    const vy = blend * hillWave - 0.12;
    posAttr.setY(i, vy);

    const mix = THREE.MathUtils.clamp(0.5 + Math.sin(vx * 0.02 + vz * 0.018) * 0.45, 0, 1);
    tmpCol.copy(colA).lerp(colB, mix);
    colors[i * 3] = tmpCol.r;
    colors[i * 3 + 1] = tmpCol.g;
    colors[i * 3 + 2] = tmpCol.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();

  const terrainMesh = new THREE.Mesh(
    terrainGeo,
    trackMat(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.94,
        metalness: 0.02,
      }),
    ),
  );
  terrainMesh.receiveShadow = true;
  group.add(terrainMesh);

  // 4. Helper to build closed ribbon geometry along the spline
  const buildRibbonGeometry = (
    offsetInner: number,
    offsetOuter: number,
    yHeight: number,
    vScale: number,
  ): THREE.BufferGeometry => {
    const vertCount = (SAMPLE_COUNT + 1) * 2;
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices: number[] = [];

    for (let i = 0; i <= SAMPLE_COUNT; i++) {
      const s = samples[i % SAMPLE_COUNT];
      const vCoord = (i / SAMPLE_COUNT) * (totalLength / vScale);

      const pInX = s.point.x + s.right.x * offsetInner;
      const pInZ = s.point.z + s.right.z * offsetInner;
      const pOutX = s.point.x + s.right.x * offsetOuter;
      const pOutZ = s.point.z + s.right.z * offsetOuter;

      const idx0 = i * 2;
      const idx1 = i * 2 + 1;

      positions[idx0 * 3] = pInX;
      positions[idx0 * 3 + 1] = yHeight;
      positions[idx0 * 3 + 2] = pInZ;

      positions[idx1 * 3] = pOutX;
      positions[idx1 * 3 + 1] = yHeight;
      positions[idx1 * 3 + 2] = pOutZ;

      normals[idx0 * 3] = 0;
      normals[idx0 * 3 + 1] = 1;
      normals[idx0 * 3 + 2] = 0;

      normals[idx1 * 3] = 0;
      normals[idx1 * 3 + 1] = 1;
      normals[idx1 * 3 + 2] = 0;

      uvs[idx0 * 2] = 0;
      uvs[idx0 * 2 + 1] = vCoord;
      uvs[idx1 * 2] = 1;
      uvs[idx1 * 2 + 1] = vCoord;

      if (i < SAMPLE_COUNT) {
        const a = idx0;
        const b = idx1;
        const c = idx0 + 2;
        const d = idx1 + 2;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return trackGeo(geo);
  };

  // Road Asphalt Ribbon
  const asphaltTex = trackTex(createAsphaltTexture(maxAnisotropy));
  const roadGeo = buildRibbonGeometry(-roadHalf, roadHalf, 0.03, 16);
  const roadMesh = new THREE.Mesh(
    roadGeo,
    trackMat(
      new THREE.MeshStandardMaterial({
        map: asphaltTex,
        roughness: 0.78,
        metalness: 0.05,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    ),
  );
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // FIA Curbs (Left & Right)
  const curbTex = trackTex(createCurbTexture(maxAnisotropy));
  const curbMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: curbTex,
      roughness: 0.72,
      metalness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  const leftCurbMesh = new THREE.Mesh(
    buildRibbonGeometry(-roadHalf - curbWidth, -roadHalf, 0.048, 5.5),
    curbMat,
  );
  leftCurbMesh.receiveShadow = true;
  group.add(leftCurbMesh);

  const rightCurbMesh = new THREE.Mesh(
    buildRibbonGeometry(roadHalf, roadHalf + curbWidth, 0.048, 5.5),
    curbMat,
  );
  rightCurbMesh.receiveShadow = true;
  group.add(rightCurbMesh);

  // Shoulder gravel / runoff strip
  const shoulderMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x3f434a,
      roughness: 0.95,
      metalness: 0.02,
    }),
  );
  group.add(
    new THREE.Mesh(buildRibbonGeometry(-barrierOffset, -roadHalf - curbWidth, 0.02, 10), shoulderMat),
  );
  group.add(
    new THREE.Mesh(buildRibbonGeometry(roadHalf + curbWidth, barrierOffset, 0.02, 10), shoulderMat),
  );

  // 5. Outer Armco Guardrail Barriers (Wall Ribbon)
  const buildBarrierWall = (offset: number, flipNormal: boolean) => {
    const vertCount = (SAMPLE_COUNT + 1) * 2;
    const positions = new Float32Array(vertCount * 3);
    const indices: number[] = [];

    for (let i = 0; i <= SAMPLE_COUNT; i++) {
      const s = samples[i % SAMPLE_COUNT];
      const bx = s.point.x + s.right.x * offset;
      const bz = s.point.z + s.right.z * offset;

      const idx0 = i * 2;
      const idx1 = i * 2 + 1;
      positions[idx0 * 3] = bx;
      positions[idx0 * 3 + 1] = 0.0;
      positions[idx0 * 3 + 2] = bz;

      positions[idx1 * 3] = bx;
      positions[idx1 * 3 + 1] = 1.05;
      positions[idx1 * 3 + 2] = bz;

      if (i < SAMPLE_COUNT) {
        if (flipNormal) {
          indices.push(idx0, idx1, idx0 + 2, idx1, idx1 + 2, idx0 + 2);
        } else {
          indices.push(idx0, idx0 + 2, idx1, idx1, idx0 + 2, idx1 + 2);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return trackGeo(geo);
  };

  const barrierMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      metalness: 0.72,
      roughness: 0.34,
      side: THREE.DoubleSide,
    }),
  );

  const leftWall = new THREE.Mesh(buildBarrierWall(-barrierOffset, false), barrierMat);
  leftWall.castShadow = !isSoftwareGl;
  leftWall.receiveShadow = true;
  group.add(leftWall);

  const rightWall = new THREE.Mesh(buildBarrierWall(barrierOffset, true), barrierMat);
  rightWall.castShadow = !isSoftwareGl;
  rightWall.receiveShadow = true;
  group.add(rightWall);

  // Red/White Barrier Top Rail Accent via Instanced Posts
  const postGeo = trackGeo(new THREE.BoxGeometry(0.24, 1.15, 0.24));
  const postMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.65,
      roughness: 0.4,
    }),
  );
  const postStep = 8;
  const postCount = Math.floor(SAMPLE_COUNT / postStep) * 2;
  const postsInstanced = new THREE.InstancedMesh(postGeo, postMat, postCount);
  const dummy = new THREE.Object3D();
  let postIdx = 0;
  for (let i = 0; i < SAMPLE_COUNT; i += postStep) {
    const s = samples[i];
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    for (const side of [-1, 1]) {
      if (postIdx >= postCount) break;
      dummy.position.set(
        s.point.x + s.right.x * (barrierOffset + 0.14 * side) * side,
        0.57,
        s.point.z + s.right.z * (barrierOffset + 0.14 * side) * side,
      );
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      postsInstanced.setMatrixAt(postIdx++, dummy.matrix);
    }
  }
  postsInstanced.instanceMatrix.needsUpdate = true;
  postsInstanced.computeBoundingSphere();
  group.add(postsInstanced);

  // 6. Start / Finish Checkered Strip & Overhead Gantry Arch
  const s0 = samples[0];
  const startYaw = Math.atan2(-s0.tangent.x, -s0.tangent.z);

  const startGroup = new THREE.Group();
  startGroup.position.set(s0.point.x, 0, s0.point.z);
  startGroup.rotation.y = startYaw;
  group.add(startGroup);

  const checkerTex = trackTex(createCheckeredTexture(maxAnisotropy));
  const checkerStrip = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(config.roadWidth - 0.6, 3.6)),
    trackMat(
      new THREE.MeshStandardMaterial({
        map: checkerTex,
        roughness: 0.6,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    ),
  );
  checkerStrip.rotation.x = -Math.PI / 2;
  checkerStrip.position.y = 0.06;
  checkerStrip.receiveShadow = true;
  startGroup.add(checkerStrip);

  // Gantry Towers & Truss
  const trussMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.78,
      roughness: 0.3,
    }),
  );
  const towerGeo = trackGeo(new THREE.BoxGeometry(1.1, 8.8, 1.1));
  const leftTower = new THREE.Mesh(towerGeo, trussMat);
  leftTower.position.set(-(roadHalf + 2.1), 4.4, 0);
  leftTower.castShadow = !isSoftwareGl;
  startGroup.add(leftTower);

  const rightTower = new THREE.Mesh(towerGeo, trussMat);
  rightTower.position.set(roadHalf + 2.1, 4.4, 0);
  rightTower.castShadow = !isSoftwareGl;
  startGroup.add(rightTower);

  const spanWidth = config.roadWidth + 5.2;
  const crossBeam = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(spanWidth, 1.2, 1.1)),
    trussMat,
  );
  crossBeam.position.set(0, 8.2, 0);
  crossBeam.castShadow = !isSoftwareGl;
  startGroup.add(crossBeam);

  const bannerTex = trackTex(createBannerTexture(maxAnisotropy));
  const bannerMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: bannerTex,
      roughness: 0.4,
      metalness: 0.1,
    }),
  );
  const bannerFront = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(spanWidth - 2.4, 1.65)), bannerMat);
  bannerFront.position.set(0, 7.65, 0.58);
  startGroup.add(bannerFront);

  const bannerBack = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(spanWidth - 2.4, 1.65)), bannerMat);
  bannerBack.position.set(0, 7.65, -0.58);
  bannerBack.rotation.y = Math.PI;
  startGroup.add(bannerBack);

  // 5 Starting Signal Lights on Gantry
  const startLightMats: THREE.MeshStandardMaterial[] = [];
  const lightBulbGeo = trackGeo(new THREE.SphereGeometry(0.24, 12, 12));
  for (let l = 0; l < 5; l++) {
    const lMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x331111,
        emissive: 0xef4444,
        emissiveIntensity: 0.0,
        roughness: 0.2,
      }),
    );
    startLightMats.push(lMat);
    const bulb = new THREE.Mesh(lightBulbGeo, lMat);
    bulb.position.set((l - 2) * 1.15, 6.45, 0.52);
    startGroup.add(bulb);
  }

  // Grandstand Bleacher beside Start Straight
  const standGroup = new THREE.Group();
  standGroup.position.set(roadHalf + 11.5, 0, 12);
  startGroup.add(standGroup);

  const standBaseMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7, metalness: 0.2 }),
  );
  const standRoofMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4, metalness: 0.4 }),
  );
  for (let tier = 0; tier < 4; tier++) {
    const tierMesh = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(2.2, 1.1 + tier * 1.1, 46)),
      standBaseMat,
    );
    tierMesh.position.set(tier * 2.0, (1.1 + tier * 1.1) * 0.5, 0);
    tierMesh.castShadow = !isSoftwareGl;
    tierMesh.receiveShadow = true;
    standGroup.add(tierMesh);
  }
  const canopy = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(10.5, 0.35, 48)), standRoofMat);
  canopy.position.set(3.2, 7.6, 0);
  canopy.rotation.z = -0.14;
  canopy.castShadow = !isSoftwareGl;
  standGroup.add(canopy);

  // 7. Instanced Trackside Trees / Environment Foliage (outside barrier)
  const treeCount = 260;
  const trunkGeo = trackGeo(new THREE.CylinderGeometry(0.32, 0.48, 3.2, 7));
  const trunkMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x4a3525, roughness: 0.92 }),
  );

  let crownGeo: THREE.BufferGeometry;
  if (config.treeStyle === 'pine') {
    crownGeo = trackGeo(new THREE.ConeGeometry(2.3, 6.5, 8));
  } else if (config.treeStyle === 'cypress') {
    crownGeo = trackGeo(new THREE.CylinderGeometry(0.6, 1.5, 7.5, 8));
  } else {
    // Desert scrub / rock spires
    crownGeo = trackGeo(new THREE.DodecahedronGeometry(2.1, 0));
  }

  const crownMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0.04,
    }),
  );

  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const crownMesh = new THREE.InstancedMesh(crownGeo, crownMat, treeCount);
  trunkMesh.castShadow = !isSoftwareGl;
  crownMesh.castShadow = !isSoftwareGl;

  const cA = new THREE.Color(config.treeColorA);
  const cB = new THREE.Color(config.treeColorB);
  const cMix = new THREE.Color();

  // Deterministic pseudo-random placement around track corridor
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  let placed = 0;
  let attempts = 0;
  while (placed < treeCount && attempts < 2000) {
    attempts++;
    const sIdx = Math.floor(rand() * SAMPLE_COUNT);
    const s = samples[sIdx];
    const side = rand() > 0.5 ? 1 : -1;
    const distFromCenter = barrierOffset + 8 + rand() * 85;
    const tx = s.point.x + s.right.x * side * distFromCenter + (rand() - 0.5) * 12;
    const tz = s.point.z + s.right.z * side * distFromCenter + (rand() - 0.5) * 12;

    // Verify not too close to ANY part of the track
    let tooClose = false;
    for (let j = 0; j < coarsePts.length; j++) {
      const dx = tx - coarsePts[j].x;
      const dz = tz - coarsePts[j].z;
      if (dx * dx + dz * dz < (barrierOffset + 6) * (barrierOffset + 6)) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    const scale = 0.85 + rand() * 0.3; // ±15% scale variation
    const yaw = rand() * Math.PI * 2;

    dummy.position.set(tx, 1.5 * scale, tz);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(placed, dummy.matrix);

    const crownY = config.treeStyle === 'desert' ? 2.1 * scale : 4.4 * scale;
    dummy.position.set(tx, crownY, tz);
    dummy.scale.set(scale * (0.9 + rand() * 0.25), scale * (0.9 + rand() * 0.3), scale);
    dummy.updateMatrix();
    crownMesh.setMatrixAt(placed, dummy.matrix);

    cMix.copy(cA).lerp(cB, rand());
    crownMesh.setColorAt(placed, cMix);
    placed++;
  }

  trunkMesh.count = placed;
  crownMesh.count = placed;
  trunkMesh.instanceMatrix.needsUpdate = true;
  crownMesh.instanceMatrix.needsUpdate = true;
  if (crownMesh.instanceColor) crownMesh.instanceColor.needsUpdate = true;
  trunkMesh.computeBoundingSphere();
  crownMesh.computeBoundingSphere();
  group.add(trunkMesh);
  group.add(crownMesh);

  // 8. Trackside Floodlight Towers (for Twilight/Alpine Dusk circuit)
  if (config.hasTrackLights) {
    const poleGeo = trackGeo(new THREE.CylinderGeometry(0.18, 0.26, 11, 8));
    const headGeo = trackGeo(new THREE.BoxGeometry(2.2, 0.7, 0.5));
    const poleMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.4 }));
    const glowMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xe0f2fe,
        emissiveIntensity: 2.5,
      }),
    );

    const lightEvery = 32;
    const count = Math.floor(SAMPLE_COUNT / lightEvery);
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, count);
    const heads = new THREE.InstancedMesh(headGeo, glowMat, count);

    for (let k = 0; k < count; k++) {
      const s = samples[k * lightEvery];
      const side = k % 2 === 0 ? 1 : -1;
      const lx = s.point.x + s.right.x * (barrierOffset + 2.2) * side;
      const lz = s.point.z + s.right.z * (barrierOffset + 2.2) * side;
      const yaw = Math.atan2(s.right.x * -side, s.right.z * -side);

      dummy.position.set(lx, 5.5, lz);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poles.setMatrixAt(k, dummy.matrix);

      dummy.position.set(lx + s.right.x * -side * 0.7, 10.9, lz + s.right.z * -side * 0.7);
      dummy.rotation.set(0.35, yaw, 0);
      dummy.updateMatrix();
      heads.setMatrixAt(k, dummy.matrix);
    }
    poles.computeBoundingSphere();
    heads.computeBoundingSphere();
    group.add(poles);
    group.add(heads);
  }

  // Minimap sampled polyline
  const minimapPoints: { x: number; z: number }[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i += 4) {
    minimapPoints.push({ x: samples[i].point.x, z: samples[i].point.z });
  }

  return {
    group,
    samples,
    totalLength,
    roadWidth: config.roadWidth,
    barrierHalfWidth: barrierOffset - 0.9,
    bounds: { minX, maxX, minZ, maxZ },
    minimapPoints,
    startLightMats,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    },
  };
}
