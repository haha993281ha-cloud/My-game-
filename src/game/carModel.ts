import * as THREE from 'three';

export interface CarMeshRig {
  root: THREE.Group;
  chassisGroup: THREE.Group;
  frontLeftSteer: THREE.Group;
  frontRightSteer: THREE.Group;
  wheels: THREE.Group[];
  tailLightMat: THREE.MeshStandardMaterial;
  flameLeft: THREE.Mesh;
  flameRight: THREE.Mesh;
  disposables: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] };
}

export function buildRaceCarModel(
  primaryColor: number,
  accentColor: number,
  contactShadowTex: THREE.Texture,
  isSoftwareGl: boolean,
): CarMeshRig {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const root = new THREE.Group();
  const chassisGroup = new THREE.Group();
  root.add(chassisGroup);

  // Materials with distinct PBR roughness/metalness contrast
  const bodyPaintMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: primaryColor,
      metalness: 0.72,
      roughness: 0.22,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
    }),
  );

  const accentPaintMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: accentColor,
      metalness: 0.45,
      roughness: 0.25,
      clearcoat: 0.9,
      clearcoatRoughness: 0.1,
    }),
  );

  const carbonMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x161920,
      metalness: 0.25,
      roughness: 0.68,
    }),
  );

  const glassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x0b1220,
      metalness: 0.1,
      roughness: 0.06,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      transparent: true,
      opacity: 0.88,
    }),
  );

  const alloyMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd1d5db,
      metalness: 0.92,
      roughness: 0.18,
    }),
  );

  const tireMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x141518,
      metalness: 0.04,
      roughness: 0.86,
    }),
  );

  const caliperMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xef4444,
      metalness: 0.4,
      roughness: 0.35,
    }),
  );

  const headlightMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xe0f2fe,
      emissiveIntensity: 2.2,
      roughness: 0.1,
    }),
  );

  const tailLightMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x991b1b,
      emissive: 0xef4444,
      emissiveIntensity: 1.4,
      roughness: 0.2,
    }),
  );

  // 1. Ground Contact Shadow Plane (prevents floating look)
  const shadowPlane = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(2.7, 5.1)),
    trackMat(
      new THREE.MeshBasicMaterial({
        map: contactShadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.55,
      }),
    ),
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.02;
  root.add(shadowPlane);

  // Car faces -Z forward! (Length ~4.35m, Width ~2.02m)
  // 2. Sculpted Wedge Main Hull via ExtrudeGeometry (side profile extruded along X)
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-2.12, 0.24); // front nose bottom (-Z)
  hullShape.lineTo(-2.05, 0.44); // front nose tip
  hullShape.lineTo(-1.15, 0.64); // hood crest
  hullShape.lineTo(-0.4, 0.72); // cowl
  hullShape.lineTo(1.15, 0.78); // rear fenders
  hullShape.lineTo(2.05, 0.74); // tail deck
  hullShape.lineTo(2.12, 0.34); // rear bumper
  hullShape.lineTo(-2.12, 0.24);

  const hullGeo = trackGeo(
    new THREE.ExtrudeGeometry(hullShape, {
      depth: 1.72,
      bevelEnabled: true,
      bevelThickness: 0.09,
      bevelSize: 0.07,
      bevelSegments: 3,
    }),
  );
  hullGeo.center();
  // Rotate so X is width (1.72 + bevels), Z is length (-2.12 to +2.12), Y is height
  hullGeo.rotateY(Math.PI / 2);
  const hullMesh = new THREE.Mesh(hullGeo, bodyPaintMat);
  hullMesh.position.set(0, 0.52, 0);
  hullMesh.castShadow = !isSoftwareGl;
  hullMesh.receiveShadow = true;
  chassisGroup.add(hullMesh);

  // 3. Racing Center Stripe Accent along Hood & Roof
  const stripeGeo = trackGeo(new THREE.BoxGeometry(0.32, 0.03, 3.85));
  const stripeMesh = new THREE.Mesh(stripeGeo, accentPaintMat);
  stripeMesh.position.set(0, 0.82, 0.04);
  chassisGroup.add(stripeMesh);

  // 4. Sculpted Cockpit Cabin Canopy (glass + painted roof cap)
  const cabinShape = new THREE.Shape();
  cabinShape.moveTo(-0.88, 0.0);
  cabinShape.lineTo(-0.28, 0.44);
  cabinShape.lineTo(0.58, 0.44);
  cabinShape.lineTo(1.25, 0.02);
  cabinShape.closePath();

  const cabinGeo = trackGeo(
    new THREE.ExtrudeGeometry(cabinShape, {
      depth: 1.18,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.06,
      bevelSegments: 2,
    }),
  );
  cabinGeo.center();
  cabinGeo.rotateY(Math.PI / 2);
  const cabinMesh = new THREE.Mesh(cabinGeo, glassMat);
  cabinMesh.position.set(0, 0.96, 0.14);
  cabinMesh.castShadow = !isSoftwareGl;
  chassisGroup.add(cabinMesh);

  // Painted Roof Crown
  const roofGeo = trackGeo(new THREE.BoxGeometry(1.06, 0.06, 0.92));
  const roofMesh = new THREE.Mesh(roofGeo, bodyPaintMat);
  roofMesh.position.set(0, 1.2, 0.2);
  chassisGroup.add(roofMesh);

  // 5. Carbon Fiber Front Splitter & Side Skirts
  const splitterGeo = trackGeo(new THREE.BoxGeometry(1.96, 0.06, 0.55));
  const splitter = new THREE.Mesh(splitterGeo, carbonMat);
  splitter.position.set(0, 0.21, -2.02);
  chassisGroup.add(splitter);

  const sideSkirtGeo = trackGeo(new THREE.BoxGeometry(1.98, 0.11, 2.3));
  const sideSkirt = new THREE.Mesh(sideSkirtGeo, carbonMat);
  sideSkirt.position.set(0, 0.23, 0.0);
  chassisGroup.add(sideSkirt);

  // 6. Aerodynamic Side Intake Pods
  const podGeo = trackGeo(new THREE.BoxGeometry(0.18, 0.34, 1.55));
  const podLeft = new THREE.Mesh(podGeo, carbonMat);
  podLeft.position.set(-0.96, 0.48, 0.22);
  chassisGroup.add(podLeft);

  const podRight = new THREE.Mesh(podGeo, carbonMat);
  podRight.position.set(0.96, 0.48, 0.22);
  chassisGroup.add(podRight);

  // 7. Rear Carbon Diffuser
  const diffuserGeo = trackGeo(new THREE.BoxGeometry(1.66, 0.16, 0.25));
  const diffuser = new THREE.Mesh(diffuserGeo, carbonMat);
  diffuser.position.set(0, 0.26, 2.08);
  chassisGroup.add(diffuser);

  // 8. GT Rear Wing + Twin Swan-Neck Uprights
  const wingBladeGeo = trackGeo(new THREE.BoxGeometry(1.94, 0.05, 0.34));
  const wingBlade = new THREE.Mesh(wingBladeGeo, carbonMat);
  wingBlade.position.set(0, 1.14, 1.98);
  wingBlade.rotation.x = 0.12;
  wingBlade.castShadow = !isSoftwareGl;
  chassisGroup.add(wingBlade);

  const endplateGeo = trackGeo(new THREE.BoxGeometry(0.04, 0.22, 0.4));
  const endplateL = new THREE.Mesh(endplateGeo, accentPaintMat);
  endplateL.position.set(-0.97, 1.12, 1.98);
  chassisGroup.add(endplateL);

  const endplateR = new THREE.Mesh(endplateGeo, accentPaintMat);
  endplateR.position.set(0.97, 1.12, 1.98);
  chassisGroup.add(endplateR);

  const uprightGeo = trackGeo(new THREE.BoxGeometry(0.05, 0.38, 0.14));
  const uprightL = new THREE.Mesh(uprightGeo, carbonMat);
  uprightL.position.set(-0.46, 0.94, 1.92);
  chassisGroup.add(uprightL);

  const uprightR = new THREE.Mesh(uprightGeo, carbonMat);
  uprightR.position.set(0.46, 0.94, 1.92);
  chassisGroup.add(uprightR);

  // 9. LED Headlights & Taillight Bar
  const headGeo = trackGeo(new THREE.BoxGeometry(0.38, 0.09, 0.08));
  const headL = new THREE.Mesh(headGeo, headlightMat);
  headL.position.set(-0.66, 0.48, -2.14);
  headL.rotation.y = 0.18;
  chassisGroup.add(headL);

  const headR = new THREE.Mesh(headGeo, headlightMat);
  headR.position.set(0.66, 0.48, -2.14);
  headR.rotation.y = -0.18;
  chassisGroup.add(headR);

  const tailGeo = trackGeo(new THREE.BoxGeometry(1.62, 0.08, 0.07));
  const tailBar = new THREE.Mesh(tailGeo, tailLightMat);
  tailBar.position.set(0, 0.64, 2.13);
  chassisGroup.add(tailBar);

  // 10. Twin Chrome Exhausts & Animated Boost Flames
  const exhaustGeo = trackGeo(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 12));
  exhaustGeo.rotateX(Math.PI / 2);
  const exL = new THREE.Mesh(exhaustGeo, alloyMat);
  exL.position.set(-0.42, 0.28, 2.16);
  chassisGroup.add(exL);

  const exR = new THREE.Mesh(exhaustGeo, alloyMat);
  exR.position.set(0.42, 0.28, 2.16);
  chassisGroup.add(exR);

  const flameGeo = trackGeo(new THREE.ConeGeometry(0.09, 0.55, 10));
  flameGeo.rotateX(Math.PI / 2);
  const flameMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.9,
    }),
  );
  const flameLeft = new THREE.Mesh(flameGeo, flameMat);
  flameLeft.position.set(-0.42, 0.28, 2.46);
  flameLeft.visible = false;
  chassisGroup.add(flameLeft);

  const flameRight = new THREE.Mesh(flameGeo, flameMat);
  flameRight.position.set(0.42, 0.28, 2.46);
  flameRight.visible = false;
  chassisGroup.add(flameRight);

  // 11. 4 Composite Wheel Assemblies (Tire + Rim + Spokes + Brake Caliper)
  const wheelRadius = 0.35;
  const wheelWidth = 0.27;
  const tireGeo = trackGeo(new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 24));
  tireGeo.rotateZ(Math.PI / 2);

  const rimGeo = trackGeo(new THREE.CylinderGeometry(0.22, 0.22, wheelWidth + 0.02, 16));
  rimGeo.rotateZ(Math.PI / 2);

  const spokeGeo = trackGeo(new THREE.BoxGeometry(wheelWidth + 0.035, 0.36, 0.045));
  const caliperGeo = trackGeo(new THREE.BoxGeometry(0.12, 0.14, 0.16));

  const createWheel = (isLeft: boolean): THREE.Group => {
    const wheelSpin = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = !isSoftwareGl;
    wheelSpin.add(tire);

    const rim = new THREE.Mesh(rimGeo, alloyMat);
    wheelSpin.add(rim);

    // 3 cross spokes for clear wheel rotation visual cue
    for (let s = 0; s < 3; s++) {
      const spoke = new THREE.Mesh(spokeGeo, alloyMat);
      spoke.rotation.x = (s * Math.PI) / 3;
      wheelSpin.add(spoke);
    }

    const caliper = new THREE.Mesh(caliperGeo, caliperMat);
    caliper.position.set(isLeft ? 0.03 : -0.03, 0.06, 0.12);
    wheelSpin.add(caliper);

    return wheelSpin;
  };

  const frontLeftSteer = new THREE.Group();
  frontLeftSteer.position.set(-0.96, wheelRadius, -1.36);
  const flWheel = createWheel(true);
  frontLeftSteer.add(flWheel);
  root.add(frontLeftSteer);

  const frontRightSteer = new THREE.Group();
  frontRightSteer.position.set(0.96, wheelRadius, -1.36);
  const frWheel = createWheel(false);
  frontRightSteer.add(frWheel);
  root.add(frontRightSteer);

  const rlWheel = createWheel(true);
  rlWheel.position.set(-0.98, wheelRadius, 1.36);
  root.add(rlWheel);

  const rrWheel = createWheel(false);
  rrWheel.position.set(0.98, wheelRadius, 1.36);
  root.add(rrWheel);

  return {
    root,
    chassisGroup,
    frontLeftSteer,
    frontRightSteer,
    wheels: [flWheel, frWheel, rlWheel, rrWheel],
    tailLightMat,
    flameLeft,
    flameRight,
    disposables: { geometries, materials },
  };
}
