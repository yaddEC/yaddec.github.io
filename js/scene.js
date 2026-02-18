/* scene.js — spirale + sections, noclip (T) */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PointerLockControls } from 'https://unpkg.com/three@0.159.0/examples/jsm/controls/PointerLockControls.js';

import { addStarfield, hue } from './starfield.js';
import { addGridGround }    from './gridGround.js';
import { PhysicsWorld }     from './physicsWorld.js';

// Fonts
import { FontLoader }   from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { createVHSPass }  from './VHS_PP.js';

// Opacity helpers
import {
  createNeonMaterial,
  syncNeon,
  setDistanceFadeEnabled,
  fadeOpacity,
  setOpacity
} from './neonMaterial.js';

/*=================== constants ===================*/
const PLAYER_RADIUS = 0.35;
const PLAYER_HEIGHT = 1.5;
const PLAYER_MASS   = 180;
const GROUND_SPEED  = 5;
const AIR_SPEED     = 4;
const JUMP_SPEED    = 6;

const GRAB_RANGE    = 3;
const HOLD_DISTANCE = 3;
const MAX_FORCE     = 15 * PLAYER_MASS;
const MAX_W         = 4;
const ANCHOR_LERP   = 12;

const FIXED_STEP    = 1 / 60;

// Anti-flick caméra (PointerLock)
const MAX_MOUSE_DELTA = 150;
const WARMUP_AFTER_LOCK = 2;

// ===== Spawn plus loin sur +Z (change ici si besoin) =====
const SPAWN_Z = 30;

// helpers
const v3 = (x,y,z)=> new THREE.Vector3(x,y,z);

/*==================================================*/
class App {
  constructor(canvas) {
    this.canvas   = canvas;
    this.renderer = this.initRenderer();
    this.scene    = this.initScene();
    this.camera   = this.initCamera();
    this.controls = this.initControls();
    this.physics  = new PhysicsWorld();

    // post
    this.composer = null;
    this.vhsPass  = null;

    // === Matériaux ===
    const worldFade = { enabled: true, near: 18, far: 80, minAlpha: 0.0 };

    this.worldNeon = createNeonMaterial({
      intensity: 0.9, saturation: 1.0, rimStrength: 1.2, rimPower: 2.0,
      distanceFade: worldFade
    });

    this.neonMatCube  = createNeonMaterial({
      intensity: 1.6, saturation: 1.2, distanceFade: worldFade
    });

    // Titres opaques (pas de distance fade, pas de transparence)
    this.titleNeon = createNeonMaterial({
      intensity: 0.74, saturation: 0.8, rimStrength: 1.5, rimPower: 2.0,
      distanceFade: { enabled: false }
    });
    // Force l’opacité "vraiment opaque"
    this.titleNeon.transparent = false;
    this.titleNeon.depthWrite  = true;

    // Liste pour la synchro couleur/temps
    this._neonMats = [this.worldNeon, this.neonMatCube, this.titleNeon];

    this.keys      = Object.create(null);
    this.accum     = 0;
    this.raycaster = new THREE.Raycaster();

    // physgun
    this.anchorBody     = null;
    this.grabConstraint = null;
    this.grabbedBody    = null;
    this.grabPivot      = null;

    // audio
    this.listener     = null;
    this.audioLoader  = null;
    this.amb          = null;
    this.vhs          = null;
    this.audioReady   = false;
    this.audioPlaying = false;

    // objects
    this.grabbable = new Map();
    this.floatGroup = null;
    this._floatLetters = [];
    this._titleYaw = 0; // yaw courant lissé du groupe de titres

    // grounded cache
    this.grounded = false;

    // Noclip
    this.noclip      = false;
    this.flySpeed    = 10;
    this._storedMask = 3;

    // Cannon materials
    this.matGround = new CANNON.Material('ground');
    this.matPlayer = new CANNON.Material('player');
    this.matObject = new CANNON.Material('object');

    // Animations (dt, t)
    this.anim = [];

    // Parcours parent
    this.parkourGroup = new THREE.Group();
    this.scene.add(this.parkourGroup);

    this.groundedBody = null;
    this.groundedCarrierVel = new CANNON.Vec3(0,0,0);

    // Defaults
    const dcm = this.physics.world.defaultContactMaterial;
    dcm.friction = 0.3;
    dcm.restitution = 0.0;
    dcm.contactEquationStiffness = 1e7;
    dcm.contactEquationRelaxation = 4;
    dcm.frictionEquationStiffness = 1e7;
    dcm.frictionEquationRelaxation = 4;

    // Pairs spécifiques
    this.physics.world.addContactMaterial(new CANNON.ContactMaterial(
      this.matPlayer, this.matGround, { friction: 0.0, restitution: 0.0 }
    ));
    this.physics.world.addContactMaterial(new CANNON.ContactMaterial(
      this.matPlayer, this.matObject, { friction: 0.0, restitution: 0.0 }
    ));
    this.physics.world.addContactMaterial(new CANNON.ContactMaterial(
      this.matObject, this.matGround, { friction: 0.6, restitution: 0.0 }
    ));
    this.physics.world.addContactMaterial(new CANNON.ContactMaterial(
      this.matObject, this.matObject, { friction: 0.4, restitution: 0.0 }
    ));

    this.initAudio();
    this.initEnvironment();
    this.initPost();

    this._plIgnoreFirstAfterLock = false;
    this._plWarmup = 0;

    this.bindEvents();
    this.prev = performance.now();
    requestAnimationFrame(this.loop.bind(this));
  }

  /*----------- init -----------*/
  initRenderer() {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas });
    r.setPixelRatio(window.devicePixelRatio);
    r.setSize(window.innerWidth, window.innerHeight);
    if (this.composer) this.composer.setSize(window.innerWidth, window.innerHeight);
    r.setClearColor(0x000000, 1);
    return r;
  }
  initScene() {
    const s = new THREE.Scene();
    s.background = new THREE.Color(0x000000);
    s.fog = new THREE.FogExp2(0x000000, 0.002);
    return s;
  }
  initCamera() {
    const c = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    c.position.set(0, 1.6, SPAWN_Z);
    return c;
  }
  initControls() {
    const ctl = new PointerLockControls(this.camera, this.canvas);
    this.scene.add(ctl.getObject());
    return ctl;
  }

  initAudio() {
    this.listener = new THREE.AudioListener();
    this.camera.add(this.listener);
    this.audioLoader = new THREE.AudioLoader();
    this.amb = new THREE.Audio(this.listener);
    this.vhs = new THREE.Audio(this.listener);
    const load = (url, audio) => new Promise((resolve, reject) => {
      this.audioLoader.load(url, buffer => {
        audio.setBuffer(buffer); audio.setLoop(true); audio.setVolume(0); resolve();
      }, undefined, reject);
    });
    Promise.all([ load('/assets/mp3/ambient.mp3', this.amb), load('/assets/mp3/VHS.mp3', this.vhs) ])
      .then(() => {
        this.audioReady = true;
        if (this.controls.isLocked) this.startAmbience();
      })
      .catch(err => console.error('Audio load error:', err));
  }

  initPost() {
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const vhsPass = createVHSPass();
    composer.addPass(vhsPass);
    this.composer = composer;
    this.vhsPass  = vhsPass;
  }

  /*---------------- décor, joueur, objets -----------------------*/
  initEnvironment() {
    // Sol physique : box fine
    const G = { x: 2000, y: 0.05, z: 2000 };
    const groundShape = new CANNON.Box(new CANNON.Vec3(G.x/2, G.y/2, G.z/2));
    const groundBody  = new CANNON.Body({ mass: 0, material: this.matGround });
    groundBody.addShape(groundShape);
    groundBody.position.set(0, -G.y/2, 0);
    groundBody.isGround = true;
    groundBody.collisionFilterGroup = 2;
    groundBody.collisionFilterMask  = 1;
    this.physics.world.addBody(groundBody);

    // Sol visuel
    const groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshStandardMaterial({ color: 0x000000 })
    );
    groundMesh.rotation.x = -Math.PI / 2;
    this.scene.add(groundMesh);

    // grille + étoiles + lumière
    this.floor       = addGridGround(this.scene);
    this.updateStars = addStarfield(this.scene);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));

    // cube test grabbable (distance fade ON)
    const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.neonMatCube);
    cube.position.set(0, 4, SPAWN_Z - 11); // petit repère proche du spawn
    this.scene.add(cube);
    const cubeBody = this.physics.add(cube, this.boxShapeFromMesh(cube), { mass: 160 });
    cubeBody.material = this.matObject;
    cubeBody.linearDamping  = 0.02;
    cubeBody.angularDamping = 0.6;
    cubeBody.allowSleep = true;
    cubeBody.sleepSpeedLimit = 0.05;
    cubeBody.sleepTimeLimit  = 0.3;
    this.grabbable.set(cube, cubeBody);

    // Joueur
    const pBody = new CANNON.Body({
      mass: PLAYER_MASS, fixedRotation: true, linearDamping: 0.2, allowSleep: false, material: this.matPlayer
    });
    const spineHalfY = (PLAYER_HEIGHT / 2) - PLAYER_RADIUS;
    const spine = new CANNON.Box(new CANNON.Vec3(PLAYER_RADIUS * 0.85, spineHalfY, PLAYER_RADIUS * 0.85));
    pBody.addShape(spine, new CANNON.Vec3(0, 0, 0));
    const overlap = PLAYER_RADIUS * 0.15;
    const endOffset = spineHalfY - overlap * 0.5;
    pBody.addShape(new CANNON.Sphere(PLAYER_RADIUS), new CANNON.Vec3(0, +endOffset, 0));
    pBody.addShape(new CANNON.Sphere(PLAYER_RADIUS), new CANNON.Vec3(0, -endOffset, 0));
    pBody.position.set(0, PLAYER_HEIGHT / 2 + 2, SPAWN_Z);
    this.physics.world.addBody(pBody);
    this.playerBody = pBody;

    // ----- Titres flottants (OPAQUES) -----
    this.floatGroup = new THREE.Group();
    this.scene.add(this.floatGroup);

    this.titlePivot = new THREE.Group();   // pivot interne (yaw only)
    this.floatGroup.add(this.titlePivot);

    this._floatLetters.length = 0;

    const camForward = new THREE.Vector3();
    this.camera.getWorldDirection(camForward); camForward.y = 0; camForward.normalize();
    const pivot = new THREE.Vector3(this.playerBody.position.x, 2.5, this.playerBody.position.z)
      .add(camForward.clone().multiplyScalar(6));
    this.floatGroup.position.copy(pivot);

    const loader = new FontLoader();

    const SIZE_LAST=3.0, SIZE_NAME=2.4, SIZE_ROLE=0.55;
    const DEPTH_LAST=0.80, DEPTH_NAME=0.70, DEPTH_ROLE=0.28;
    const SPACE_LAST=0.30, SPACE_NAME=0.26, SPACE_ROLE=0.08;

    // offsets Z locaux minimes
    const Z_LAST=-0.02, Z_NAME=-0.04, Z_ROLE=-0.06;
    const Y_BASE = 2.5;
    const Y_NAME=3.8, Y_ROLE=1.5;

    // --- helper pivot X pour une rangée ---
    this._setRowPivotX = (meshes, fraction) => {
      if (!meshes || !meshes.length) return;
      let minX = +Infinity, maxX = -Infinity;
      const tmpBB = new THREE.Box3();
      for (const m of meshes) {
        tmpBB.setFromObject(m);
        minX = Math.min(minX, tmpBB.min.x);
        maxX = Math.max(maxX, tmpBB.max.x);
      }
      const width = (maxX - minX) || 1e-6;
      const pivotX = minX + width * fraction;
      for (const m of meshes) m.position.x -= pivotX; // pivot local à 0
    };

    const makeRow = (font, text, size, depth, spacing, zLocal, yLocal) => {
      const rowMeshes = [];
      let totalW = 0; const parts = [];
      for (const ch of text) {
        if (ch === ' ') { const w = size * 0.55; totalW += w + spacing; parts.push({ch, w, geom:null}); continue; }
        const g = new TextGeometry(ch, { font, size, height: depth, curveSegments: 8 });
        g.computeBoundingBox();
        const bb = g.boundingBox;
        const w = bb.max.x - bb.min.x;
        totalW += w + spacing;
        parts.push({ch, w, geom:g});
      }
      totalW -= spacing;

      // centré localement
      let xLocal = - totalW / 2;
      for (const p of parts) {
        if (p.ch === ' ') { xLocal += p.w + spacing; continue; }
        p.geom.computeBoundingBox();
        const bb = p.geom.boundingBox;
        const yOff = -0.5 * (bb.max.y + bb.min.y);
        const zOff = -0.5 * (bb.max.z + bb.min.z);
        p.geom.translate(0, yOff, zOff);

        const mesh = new THREE.Mesh(p.geom, this.titleNeon);
        mesh.position.set(xLocal + p.w / 2, Y_BASE + yLocal, zLocal); // position locale au pivot
        this.titlePivot.add(mesh);

        const baseLocal = mesh.position.clone();
        this._floatLetters.push({
          mesh,
          baseLocal,
          amp: 0.07 + Math.random() * 0.05,
          phase: Math.random() * Math.PI * 2,
          freq: 0.7 + Math.random() * 0.5
        });

        rowMeshes.push(mesh);
        xLocal += p.w + spacing;
      }
      return rowMeshes;
    };

    loader.load('https://unpkg.com/three@0.159.0/examples/fonts/helvetiker_bold.typeface.json', (font) => {
      const rowDechaux = makeRow(font, 'DECHAUX', SIZE_LAST, DEPTH_LAST, SPACE_LAST, Z_LAST, Y_NAME);
      const rowYann    = makeRow(font, 'Yann',    SIZE_NAME, DEPTH_NAME, SPACE_NAME, Z_NAME, Y_NAME + 3.8);
      const rowRole    = makeRow(font, 'GAME DEV',SIZE_ROLE, DEPTH_ROLE, SPACE_ROLE, Z_ROLE, Y_ROLE);

      // Pivot ~entre C et H : ~60% de la largeur visuelle
      this._setRowPivotX(rowDechaux, 0.60);

      // Aligner les autres lignes sur ce pivot
      const tmpGetPivot = (meshes, fraction) => {
        let minX = +Infinity, maxX = -Infinity; const bb = new THREE.Box3();
        for (const m of meshes) { bb.setFromObject(m); minX = Math.min(minX, bb.min.x); maxX = Math.max(maxX, bb.max.x); }
        const width = (maxX - minX) || 1e-6;
        return minX + width * fraction;
      };
      const pivotX = tmpGetPivot(rowDechaux, 0.60);
      const pivotYann = tmpGetPivot(rowYann, 0.50);
      const pivotRole = tmpGetPivot(rowRole, 0.50);
      for (const m of rowYann) m.position.x -= pivotYann - pivotX;
      for (const m of rowRole) m.position.x -= pivotRole - pivotX;
    });

  

    // Parcours (démarre à la plateforme)
    this.buildParkour(v3(0, 1.6, 60));
  }

  boxShapeFromMesh(mesh) {
    const s = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
    return new CANNON.Box(new CANNON.Vec3(s.x / 2, s.y / 2, s.z / 2));
  }

  /*==================== PARKOUR ====================*/
  buildParkour(startPlatformPos) {
    // Variantes néon (distance fade ON)
    const worldFade = { enabled: true, near: 30, far: 65, minAlpha: 0.0 };
    this.neonVariants = [
      createNeonMaterial({ intensity: 1.4, saturation: 1.2, rimStrength: 1.6, rimPower: 1.0, distanceFade: worldFade }),
      createNeonMaterial({ intensity: 0.9, saturation: 0.9, rimStrength: 1.2, rimPower: 0.5, distanceFade: worldFade }),
      createNeonMaterial({ intensity: 0.3, saturation: 0.7, rimStrength: 1.0, rimPower: 2.0, distanceFade: worldFade }),
      createNeonMaterial({ intensity: 1.2, saturation: 0.4, rimStrength: 1.0, rimPower: 2.0, distanceFade: worldFade }),
      createNeonMaterial({ intensity: 2.0, saturation: 0.8, rimStrength: 1.4, rimPower: 1.0, distanceFade: worldFade }),
    ];
    this._neonMats.push(...this.neonVariants);

    // 1) Spirale — centrée relative au début de parcours
    // (ancienne diff: 22 - 8 = 14 en Z)
    const spiralCenter = v3(startPlatformPos.x, startPlatformPos.y, startPlatformPos.z + 14);
    const spiral = this.addSpiral(spiralCenter, {
      steps: 28,
      baseRadius: 15,
      dTheta: THREE.MathUtils.degToRad(18),
      baseDY: 0.42,
    },{
      startIndex: 10, every: 2, period: 3.2, onRatio: 0.55, phaseStep: 0.6
    });

    let section = this.addStaticZigZagAfterSpiral(spiral.end.clone(), spiral.tangent.clone());
    section = this.addBarsAfterSpiral(section.end, section.tangent, {
      count: 9, length: 8.5, gap: 3.0, startGap: 4.0, yOffset: 0.6
    });

    section = this.addMovingZigZagAfterSpiral(
      section.end.clone(),
      section.tangent.clone(),
      { count: 6, yOffset: 0.6, firstFwd: 2.0, gapFwd: 7.5, padLen: 3.0, padWid: 3.22, thickness: 0.30, sideOff: 0.9, amp: 1.0, speed: 0.9, phaseStep: Math.PI * 0.6 }
    );

    section = this.addRotatingSweeperSection(section.end, section.tangent, {
      len: 20.0, wid: 1.6, thick: 0.35, yOffset: 1.0, startGap: 10.0, exitGap: 12.0, omega: 0.3, spheres: 0,
      rMin: 0.45, rMax: 0.95, spreadFwd: 11.0, spreadSide: 1, spreadUp: 1
    });
    section = this.addRotatingSweeperSection(section.end, section.tangent, {
      len: 20.0, wid: 1.6, thick: 0.35, yOffset: 0.6, startGap: 6.0, exitGap: 12.0, omega: 0.4, spheres: 0,
      rMin: 0.45, rMax: 0.95, spreadFwd: 11.0, spreadSide: 1, spreadUp: 1
    });
    section = this.addRotatingSweeperSection(section.end, section.tangent, {
      len: 20.0, wid: 1.6, thick: 0.35, yOffset: 0.6, startGap: 6.0, exitGap: 12.0, omega: 0.6, spheres: 0,
      rMin: 0.45, rMax: 0.95, spreadFwd: 11.0, spreadSide: 1, spreadUp: 1
    });
    section = this.addRotatingSweeperSection(section.end, section.tangent, {
      len: 20.0, wid: 1.6, thick: 0.35, yOffset: 0.6, startGap: 6.0, exitGap: 12.0, omega: 0.4, spheres: 0,
      rMin: 0.45, rMax: 0.95, spreadFwd: 11.0, spreadSide: 1, spreadUp: 1
    });

    section = this.addSweepingWallsCorridor(section.end, section.tangent, {
      length: 42, width: 6.5, wallCount: 9, wallGap: 4.2,
      sweepAmp: 20.0, sweepSpeed: 2.0, startGap: 4.0,
      wallScaleX: [0.8, 0.5],
      wallScaleZ: [5.8, 5.5]
    });
  }

  // ---------- SHARED BUILDERS ----------
  _box(meshSize, mat) {
    return new THREE.Mesh(new THREE.BoxGeometry(meshSize.x, meshSize.y, meshSize.z), mat);
  }
  _addStaticPlatform(pos, size, matIndex=0, quat=null) {
    const mat = this.neonVariants[matIndex % this.neonVariants.length];
    const mesh = this._box(size, mat);
    mesh.position.copy(pos);
    if (quat) mesh.quaternion.copy(quat);
    this.parkourGroup.add(mesh);

    const shape = new CANNON.Box(new CANNON.Vec3(size.x/2, size.y/2, size.z/2));
    const body  = new CANNON.Body({ mass: 0, material: this.matGround });
    body.addShape(shape);
    body.position.copy(mesh.position);
    body.quaternion.copy(mesh.quaternion);
    body.isGround = true;
    body.collisionFilterGroup = 2;
    body.collisionFilterMask  = 1;
    this.physics.world.addBody(body);
    return { mesh, body };
  }
  _dir(from, to) {
    return new THREE.Vector3().subVectors(to, from).normalize();
  }
  _stepAlong(pos, dir, dist, dy=0) {
    return pos.clone().add(dir.clone().multiplyScalar(dist)).add(new THREE.Vector3(0, dy, 0));
  }

  _addKinematicBox(pos, size, matIndex = 0, quat = null) {
    const mat  = this.neonVariants[matIndex % this.neonVariants.length];
    const mesh = this._box(size, mat);
    mesh.position.copy(pos);
    if (quat) mesh.quaternion.copy(quat);
    this.parkourGroup.add(mesh);

    const shape = new CANNON.Box(new CANNON.Vec3(size.x/2, size.y/2, size.z/2));
    const body  = new CANNON.Body({ type: CANNON.Body.KINEMATIC, material: this.matGround });
    body.addShape(shape);
    body.position.copy(mesh.position);
    body.quaternion.copy(mesh.quaternion);

    body.isGround = true;
    body.collisionFilterGroup = 2;
    body.collisionFilterMask  = 1;

    this.physics.world.addBody(body);
    return { mesh, body };
  }

  // ---------- 1) Spirale (avec spawn/despawn en fade) ----------
  addSpiral(
    center,
    { steps, baseRadius, dTheta, baseDY },
    blinkOpts = { startIndex: 10, every: 2, period: 3.2, onRatio: 0.55, phaseStep: 0.6, fadeDur: 0.35 }
  ) {
    let theta   = Math.PI * 0.25;
    let prevPos = null;
    let endPos  = null;

    const startIndex = blinkOpts?.startIndex ?? 10;
    const every      = blinkOpts?.every      ?? 2;
    const period     = blinkOpts?.period     ?? 3.2;
    const onRatio    = blinkOpts?.onRatio    ?? 0.55;
    const phaseStep  = blinkOpts?.phaseStep  ?? 0.6;
    const fadeDur    = blinkOpts?.fadeDur    ?? 0.35;

    for (let i = 0; i < steps; i++) {
      const radius    = baseRadius + Math.sin(i*0.6) * 0.8;
      const y         = center.y + i * (baseDY + Math.sin(i*0.35)*0.05);
      const stepTheta = dTheta * (0.86 + Math.sin(i*0.31)*0.18);
      const x         = center.x + Math.cos(theta) * radius;
      const z         = center.z + Math.sin(theta) * radius;

      const w    = 1.2 + (1.0 + Math.sin(i*0.9))*0.5;
      const size = v3(w, 0.35, w);
      const p    = v3(x, y, z);

      const seg = this._addStaticPlatform(p, size, i);

      // Blink: fade in/out + collision mask
      const shouldBlink = (i >= startIndex) && ((i - startIndex) % every === 0);
      if (shouldBlink) {
        seg.mesh.material = seg.mesh.material.clone();
        this._neonMats.push(seg.mesh.material);

        seg.mesh.material.transparent = true;
        seg.mesh.material.depthWrite  = false;

        setOpacity(seg.mesh.material, 1.0);
        seg.mesh.visible = true;
        seg.body.collisionFilterMask = 1;

        const phase = (i - startIndex) * phaseStep;
        let lastState = true;
        let cancel = null;

        this.anim.push((dt, t) => {
          const tt = (t + phase) % period;
          const on = tt < period * onRatio;

          if (on !== lastState) {
            lastState = on;
            if (cancel) cancel();

            if (on) {
              seg.body.collisionFilterMask = 1;
              seg.mesh.visible = true;
              cancel = fadeOpacity(seg.mesh.material, 1.0, fadeDur);
            } else {
              cancel = fadeOpacity(seg.mesh.material, 0.0, fadeDur, () => {
                seg.body.collisionFilterMask = 0;
                seg.mesh.visible = false; // skip drawcall
              });
            }
          }
        });
      }

      prevPos = endPos;
      endPos  = p;
      theta  += stepTheta;
    }

    let tangent = new THREE.Vector3(1,0,0);
    if (prevPos && endPos) tangent = this._dir(prevPos, endPos);

    return { end: endPos, tangent };
  }

  // ---------- 2) Section statique ----------
  addStaticZigZagAfterSpiral(startPos, forwardDir) {
    const fwd = new THREE.Vector3(forwardDir.x, 0, forwardDir.z).normalize();
    const up  = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();

    const yLevel = startPos.y + 0.6;
    const thickness = 0.30;
    const padLen    = 3.0;
    const padWid    = 0.25;
    const firstFwd  = 4.0;
    const gapFwd    = 5.5;
    const sideOff   = 0.7;

    let center = new THREE.Vector3(startPos.x, yLevel, startPos.z);
    let lastPos = center.clone();

    for (let i = 0; i < 6; i++) {
      const advance = (i === 0 ? firstFwd : gapFwd);
      center.addScaledVector(fwd, advance);
      const lateral = (i % 2 === 0 ? -sideOff : sideOff);
      const pos = center.clone().addScaledVector(right, lateral);
      pos.y = yLevel;

      this._addStaticPlatform(pos, v3(padLen, thickness, padWid), 100 + i);
      lastPos = pos.clone();
    }

    return { end: lastPos, tangent: fwd.clone() };
  }

  // ==================== BARRE SIMPLE ====================
  addBarsAfterSpiral(startPos, forwardDir, {
    count = 8, length = 8.0, width = 0.35, height = 0.30, gap = 3.2, yOffset = 0.6, startGap = 3.0
  } = {}) {
    const fwd = new THREE.Vector3(forwardDir.x, 0, forwardDir.z).normalize();
    const yaw = Math.atan2(fwd.x, fwd.z);

    let pos = new THREE.Vector3(startPos.x, startPos.y + yOffset, startPos.z)
                .addScaledVector(fwd, startGap);

    let lastPos = pos.clone();

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(length, height, width),
        this.neonVariants[i % this.neonVariants.length]
      );
      mesh.position.copy(pos);
      mesh.rotation.y = yaw;
      this.parkourGroup.add(mesh);

      const shape = new CANNON.Box(new CANNON.Vec3(length/2, height/2, width/2));
      const body  = new CANNON.Body({ mass: 0, material: this.matGround });
      body.addShape(shape);
      body.position.set(pos.x, pos.y, pos.z);
      body.quaternion.setFromEuler(0, yaw, 0, 'XYZ');

      body.isGround = true;
      body.collisionFilterGroup = 2;
      body.collisionFilterMask  = 1;

      this.physics.world.addBody(body);

      pos = pos.clone().addScaledVector(fwd, gap);
      lastPos.copy(pos);
    }

    return { end: lastPos.clone(), tangent: fwd.clone() };
  }

  addMovingZigZagAfterSpiral(startPos, forwardDir, opts = {}) {
    const {
      count = 6, yOffset = 0.6, firstFwd = 4.0, gapFwd = 5.5,
      padLen = 3.0, padWid = 5.20, thickness = 5.30, sideOff = 0.7,
      amp = 0.9, speed = 1.1, phaseStep = Math.PI * 0.5,
    } = opts;

    const fwd = new THREE.Vector3(forwardDir.x, 0, forwardDir.z).normalize();
    const up  = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();

    const yLevel = startPos.y + yOffset;
    const center = new THREE.Vector3(startPos.x, yLevel, startPos.z);

    let lastPos = startPos.clone();

    for (let i = 0; i < count; i++) {
      center.addScaledVector(fwd, i === 0 ? firstFwd : gapFwd);
      const baseLat = (i % 2 === 0 ? -sideOff : sideOff);
      const basePos = center.clone().addScaledVector(right, baseLat);
      basePos.y = yLevel;

      const seg = this._addKinematicBox(basePos, v3(padLen, thickness, padWid), i);
      seg.body.isGround = true;
      seg.body.collisionFilterGroup = 2;
      seg.body.collisionFilterMask  = 1;

      const phase = i * phaseStep;
      this.anim.push((dt, t) => {
        const s = Math.sin(t * speed + phase);
        const c = Math.cos(t * speed + phase);

        const x = basePos.x + right.x * (amp * s);
        const y = basePos.y + right.y * (amp * s);
        const z = basePos.z + right.z * (amp * s);

        seg.body.position.set(x, y, z);
        seg.mesh.position.set(x, y, z);

        const vx = right.x * (amp * speed * c);
        const vy = right.y * (amp * speed * c);
        const vz = right.z * (amp * speed * c);
        seg.body.velocity.set(vx, vy, vz);
      });

      lastPos.copy(basePos);
    }

    return { end: lastPos.clone(), tangent: fwd.clone() };
  }

  addRotatingSweeperSection(startPos, forwardDir, {
    len=18.0, wid=1.4, thick=0.35, yOffset=0.6, startGap=6.0, exitGap=10.0,
    omega=0.9, spheres=10, rMin=0.45, rMax=0.95, spreadFwd=10.0, spreadSide=7.0, spreadUp=1.8
  } = {}) {
    const fwd = new THREE.Vector3(forwardDir.x, 0, forwardDir.z).normalize();
    const up  = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    const yaw = Math.atan2(fwd.x, fwd.z);

    const center = startPos.clone().addScaledVector(fwd, startGap);
    center.y = startPos.y + yOffset;

    const matIndex = Math.floor(Math.random() * 4);
    const bar = this._addKinematicBox(center, v3(len, thick, wid), matIndex);
    bar.body.isGround = true;
    bar.body.collisionFilterGroup = 2;
    bar.body.collisionFilterMask  = 1;

    bar.body._angCenter = new CANNON.Vec3(center.x, center.y, center.z);
    bar.body._angVelVec = new CANNON.Vec3(0, omega, 0);

    this.anim.push((dt, t) => {
      const angle = t * omega;
      const q = new CANNON.Quaternion();
      q.setFromAxisAngle(new CANNON.Vec3(0,1,0), angle + yaw);
      bar.body.quaternion.copy(q);
      bar.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      bar.body.position.copy(bar.body._angCenter);
      bar.mesh.position.set(bar.body.position.x, bar.body.position.y, bar.body.position.z);
      bar.body.angularVelocity.copy(bar.body._angVelVec);
    });

    for (let i = 0; i < spheres; i++) {
      const r = THREE.MathUtils.lerp(rMin, rMax, Math.random());
      const offF = (Math.random()*2-1) * spreadFwd;
      const offS = (Math.random()*2-1) * spreadSide;
      const offY = (Math.random()*2-1) * spreadUp;

      const p = center.clone().addScaledVector(fwd, offF).addScaledVector(right, offS);
      p.y += offY;

      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 18), this.neonVariants[(i+1)%this.neonVariants.length]);
      m.position.copy(p);
      this.parkourGroup.add(m);

      const b = new CANNON.Body({ mass: 0, material: this.matObject });
      b.addShape(new CANNON.Sphere(r));
      b.position.set(p.x, p.y, p.z);
      b.isGround = false;
      b.collisionFilterGroup = 1;
      b.collisionFilterMask  = 3;
      this.physics.world.addBody(b);
    }

    const end = center.clone().addScaledVector(fwd, exitGap);
    return { end, tangent: fwd.clone() };
  }

  addSweepingWallsCorridor(startPos, forwardDir, opts = {}) {
    const {
      length=40, width=6, thickness=0.35, yOffset=0.6,
      wallCount=8, wallGap=4.5, wallDepth=0.5, wallHeight=3.0,
      wallScaleX=1.0, wallScaleZ=1.0,
      sweepAmp=4.0, sweepSpeed=1.2, phaseStep=Math.PI/3, startGap=3.0,
    } = opts;

    const pick = (spec, i) => {
      if (typeof spec === 'function') return +spec(i);
      if (Array.isArray(spec)) { const [a,b] = spec; return a + Math.random()*(b-a); }
      return +spec;
    };

    const fwd = new THREE.Vector3(forwardDir.x, 0, forwardDir.z).normalize();
    const up  = new THREE.Vector3(0,1,0);
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    const yaw = Math.atan2(fwd.x, fwd.z);

    const yLevel = startPos.y + yOffset;
    const floorCenter = startPos.clone().addScaledVector(fwd, length * 0.5);
    floorCenter.y = yLevel;

    const floor = this._addStaticPlatform(floorCenter, new THREE.Vector3(width, thickness, length), 0);
    floor.mesh.rotation.y = yaw;
    floor.body.quaternion.setFromEuler(0, yaw, 0, 'XYZ');

    const firstCenter = startPos.clone().addScaledVector(fwd, startGap);
    firstCenter.y = yLevel + wallHeight / 2;

    for (let i = 0; i < wallCount; i++) {
      const base = firstCenter.clone().addScaledVector(fwd, i * wallGap);

      const sx = Math.max(0.01, pick(wallScaleX, i));
      const sz = Math.max(0.01, pick(wallScaleZ, i));

      const sizeX = width * 0.9 * sx;
      const sizeY = wallHeight;
      const sizeZ = wallDepth * sz;

      const seg = this._addKinematicBox(base, new THREE.Vector3(sizeX, sizeY, sizeZ), i);
      seg.body.material = this.matObject;
      seg.body.isGround = false;

      seg.mesh.rotation.y = yaw;
      seg.body.quaternion.setFromEuler(0, yaw, 0, 'XYZ');

      const phase = i * phaseStep;
      this.anim.push((dt, t) => {
        const s = Math.sin(t * sweepSpeed + phase);
        const c = Math.cos(t * sweepSpeed + phase);

        const x = base.x + right.x * (sweepAmp * s);
        const y = base.y;
        const z = base.z + right.z * (sweepAmp * s);

        seg.body.position.set(x, y, z);
        seg.mesh.position.set(x, y, z);

        const vx = right.x * (sweepAmp * sweepSpeed * c);
        const vz = right.z * (sweepAmp * sweepSpeed * c);
        seg.body.velocity.set(vx, 0, vz);
      });
    }

    const end = startPos.clone().addScaledVector(fwd, length);
    end.y = yLevel;
    return { end, tangent: fwd.clone() };
  }

  /*---------------- events ------------------*/
  bindEvents() {
    ['keydown', 'keyup'].forEach(type =>
      document.addEventListener(type, e => {
        this.keys[e.code] = type === 'keydown';
        if (e.code === 'Space') e.preventDefault();
      })
    );

    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT') this.toggleNoclip();
    });

    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('auxclick',    e => e.preventDefault());

    this.controls.addEventListener('lock', () => {
      this._plIgnoreFirstAfterLock = true;
      this._plWarmup = WARMUP_AFTER_LOCK;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.controls.isLocked) return;
      if (this._plIgnoreFirstAfterLock) { this._plIgnoreFirstAfterLock = false; e.stopImmediatePropagation(); e.preventDefault(); return; }
      if (this._plWarmup > 0)            { this._plWarmup--;                 e.stopImmediatePropagation(); e.preventDefault(); return; }
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      if (Math.abs(dx) > MAX_MOUSE_DELTA || Math.abs(dy) > MAX_MOUSE_DELTA) {
        e.stopImmediatePropagation(); e.preventDefault(); return;
      }
    }, { capture: true });

    window.addEventListener('blur', () => this.releaseGrab());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseGrab(); });
    this.controls.addEventListener('unlock', () => this.releaseGrab());

    document.addEventListener('mousedown', e => { if (e.button === 2) this.tryGrab(); });
    document.addEventListener('mouseup',   e => { if (e.button === 2) this.releaseGrab(); });

    document.getElementById('enter-3d').addEventListener('click',  () => {
      document.body.classList.add('in-3d');
      this.controls.lock();
      this.startAmbience();
    });
    this.canvas.addEventListener('click', () => {
      if (!this.controls.isLocked) this.controls.lock();
      this.startAmbience();
    });
    this.controls.addEventListener('unlock', () => {
      document.body.classList.remove('in-3d');
      this.stopAmbience();
    });

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      if (this.composer) this.composer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  /*---------------- ambiance audio ------------------*/
  fadeTo(audio, target, seconds) {
    if (!audio || !audio.gain) return;
    const ctx = this.listener.context;
    const now = ctx.currentTime;
    const g = audio.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(target, now + seconds);
  }
  startAmbience() {
    try { if (this.listener.context.state === 'suspended') this.listener.context.resume(); } catch {}
    if (!this.audioReady || this.audioPlaying) return;
    if (!this.amb.isPlaying) this.amb.play();
    if (!this.vhs.isPlaying) this.vhs.play();
    this.audioPlaying = true;
    this.fadeTo(this.amb, 0.25, 4);
    this.fadeTo(this.vhs, 0.60, 0);
  }
  stopAmbience() {
    if (!this.audioPlaying) return;
    const dur = 0.8;
    this.fadeTo(this.amb, 0.0, dur);
    this.fadeTo(this.vhs, 0.0, dur);
    setTimeout(() => {
      try { this.amb.pause(); } catch {}
      try { this.vhs.stop(); } catch {}
      this.audioPlaying = false;
    }, (dur * 1000) + 50);
  }

  /*=============== phys-gun ====================*/
  updateAnchor(dt) {
    if (!this.anchorBody) return;
    const target = new THREE.Vector3();
    this.camera.getWorldDirection(target).multiplyScalar(HOLD_DISTANCE).add(this.camera.position);
    const cur = this.anchorBody.position;
    const vel = target.sub(cur).multiplyScalar(ANCHOR_LERP);
    this.anchorBody.velocity.set(vel.x, vel.y, vel.z);
  }
  tryGrab() {
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const hit = this.raycaster.intersectObjects([...this.grabbable.keys()], false)[0];
    if (!hit || hit.distance > GRAB_RANGE) return;
    const body = this.grabbable.get(hit.object);
    if (!body || body.mass > PLAYER_MASS) return;
    if (body.fixedRotation) {
      body.fixedRotation = false;
      if (body.updateMassProperties) body.updateMassProperties();
    }
    this.anchorBody = new CANNON.Body({ type: CANNON.Body.KINEMATIC });
    const holdPos = new THREE.Vector3();
    this.camera.getWorldDirection(holdPos).multiplyScalar(HOLD_DISTANCE).add(this.camera.position);
    this.anchorBody.position.copy(holdPos);
    this.anchorBody.velocity.setZero();
    this.physics.world.addBody(this.anchorBody);
    const local = new CANNON.Vec3().copy(hit.point).vsub(body.position);
    body.quaternion.conjugate().vmult(local, local);
    this.grabPivot = local;
    this.grabConstraint = new CANNON.PointToPointConstraint(
      body, this.grabPivot,
      this.anchorBody, new CANNON.Vec3(),
      MAX_FORCE
    );
    this.physics.world.addConstraint(this.grabConstraint);
    body.angularDamping = 0.9;
    this.grabbedBody = body;
  }
  releaseGrab() {
    if (this.grabConstraint) {
      this.physics.world.removeConstraint(this.grabConstraint);
      this.grabConstraint = null;
    }
    if (this.grabbedBody) {
      this.grabbedBody.angularDamping = 0.1;
      this.grabbedBody = null;
    }
    if (this.anchorBody) {
      this.physics.world.removeBody(this.anchorBody);
      this.anchorBody = null;
    }
    this.grabPivot = null;
  }
  orientGrabbed(dt) {
    if (!this.grabbedBody) return;
    const body = this.grabbedBody;
    const desired = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(body.position, this.camera.position, this.camera.up)
    );
    const current = new THREE.Quaternion(
      body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w
    );
    current.rotateTowards(desired, dt * 2);
    body.quaternion.set(current.x, current.y, current.z, current.w);
    const w = body.angularVelocity; const len = w.length();
    if (len > MAX_W) w.scale(MAX_W / len, w);
  }

  /*---------------- noclip ------------------*/
  toggleNoclip() {
    this.noclip = !this.noclip;
    if (this.noclip) {
      this._storedMask = this.playerBody.collisionFilterMask;
      this.playerBody.collisionFilterMask = 0;
      this.playerBody.velocity.set(0,0,0);
      this.playerBody.angularVelocity.set(0,0,0);
      this.playerBody.type = CANNON.Body.KINEMATIC;
      console.log('Noclip ON');
    } else {
      this.playerBody.type = CANNON.Body.DYNAMIC;
      this.playerBody.collisionFilterMask = this._storedMask ?? 3;
      console.log('Noclip OFF');
    }
  }

  /*---------------- grounded + move -------------*/
  computeGrounded() {
    const eps  = 0.03;
    const span = 0.05;

    const spineHalfY = (PLAYER_HEIGHT / 2) - PLAYER_RADIUS;
    const footY = this.playerBody.position.y - (spineHalfY + PLAYER_RADIUS);

    const from = new CANNON.Vec3(this.playerBody.position.x, footY + eps, this.playerBody.position.z);
    const to   = new CANNON.Vec3(from.x, from.y - span, from.z);

    const result = new CANNON.RaycastResult();
    const hit = this.physics.world.raycastClosest(
      from, to,
      { skipBackfaces:false, checkCollisionResponse:true, collisionFilterGroup:1, collisionFilterMask:2 },
      result
    );

    this.grounded = !!(hit && result.body && result.body.isGround);
    this.groundedBody = this.grounded ? result.body : null;

    // Vitesse d’emport du support (linéaire + due à la rotation)
    this.groundedCarrierVel.set(0,0,0);

    if (this.groundedBody && this.groundedBody.type === CANNON.Body.KINEMATIC) {
      if (this.groundedBody.velocity) this.groundedCarrierVel.vadd(this.groundedBody.velocity, this.groundedCarrierVel);

      const ang = this.groundedBody._angVelVec;
      const ctr = this.groundedBody._angCenter;
      if (ang && ctr) {
        const rp = new CANNON.Vec3(
          this.playerBody.position.x - ctr.x,
          this.playerBody.position.y - ctr.y,
          this.playerBody.position.z - ctr.z
        );
        const cx = ang.y * rp.z - ang.z * rp.y;
        const cy = ang.z * rp.x - ang.x * rp.z;
        const cz = ang.x * rp.y - ang.y * rp.x;
        this.groundedCarrierVel.vadd(new CANNON.Vec3(cx, cy, cz), this.groundedCarrierVel);
      }
    }
  }

  move(dt) {
    if (this.noclip) {
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward).normalize();

      const up = new THREE.Vector3(0,1,0);
      const right = new THREE.Vector3().crossVectors(forward, up).normalize();
      const flatForward = new THREE.Vector3(forward.x, 0, forward.z).normalize();

      const ix = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);
      const iz = (this.keys['KeyW'] ? 1 : 0) - (this.keys['KeyS'] ? 1 : 0);
      const iy = (this.keys['Space'] ? 1 : 0) - (this.keys['ControlLeft'] ? 1 : 0);

      const speed = this.keys['ShiftLeft'] ? 12 : 6;
      const moveVec = new THREE.Vector3()
        .addScaledVector(flatForward, iz)
        .addScaledVector(right, ix)
        .addScaledVector(up, iy);

      if (moveVec.lengthSq() > 0) moveVec.normalize().multiplyScalar(speed * dt);

      this.playerBody.velocity.set(0,0,0);
      this.playerBody.position.x += moveVec.x;
      this.playerBody.position.y += moveVec.y;
      this.playerBody.position.z += moveVec.z;
      return;
    }

    const ix = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);
    const iz = (this.keys['KeyW'] ? 1 : 0) - (this.keys['KeyS'] ? 1 : 0);

    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0,1,0)).normalize();

    this.computeGrounded();
    if (this.grounded && this.keys['Space']) {
      this.playerBody.velocity.y = JUMP_SPEED;
    }

    let desired = new THREE.Vector3()
      .addScaledVector(forward, iz)
      .addScaledVector(right, ix);

    if (desired.lengthSq() > 0) {
      desired.normalize().multiplyScalar(this.grounded ? GROUND_SPEED : AIR_SPEED);
    }

    const vx = desired.x + this.groundedCarrierVel.x;
    const vz = desired.z + this.groundedCarrierVel.z;

    this.playerBody.velocity.x = vx;
    this.playerBody.velocity.z = vz;
    this.playerBody.linearDamping = this.grounded ? 0.2 : 0.4;
  }

  /*---------------- loop -------------------*/
  loop(now) {
    const dt = (now - this.prev) / 1000;
    this.prev = now;

    const t = performance.now() * 0.001;
    for (const fn of this.anim) fn(dt, t);

    if (this.controls.isLocked) this.move(dt);
    this.updateAnchor(dt);
    this.orientGrabbed(dt);

    this.accum += dt;
    while (this.accum >= FIXED_STEP) {
      this.physics.step(FIXED_STEP);
      this.accum -= FIXED_STEP;
    }

    // Billboard des titres (yaw only, smooth) + flottement local
    if (this.floatGroup) {
      const toCam = new THREE.Vector3().subVectors(this.camera.position, this.floatGroup.position);
      toCam.y = 0;
      if (toCam.lengthSq() > 1e-6) {
        toCam.normalize();
        const targetYaw = Math.atan2(toCam.x, toCam.z);
        let delta = targetYaw - this._titleYaw;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta)); // wrap [-pi, pi]
        this._titleYaw += delta * Math.min(1, dt * 4.5);      // lissage

        // Flottement des lettres (local au pivot)
        if (this._floatLetters && this._floatLetters.length) {
          const tt = performance.now() * 0.001;
          for (const L of this._floatLetters) {
            L.mesh.position.y = L.baseLocal.y + Math.sin(tt * L.freq + L.phase) * L.amp;
            L.mesh.rotation.z = Math.sin(tt * (L.freq * 0.6) + L.phase) * 0.02;
          }
        }

        // Tourne UNIQUEMENT le pivot interne :
        this.titlePivot.rotation.set(0, this._titleYaw, 0);
      }
    }

    if (this.vhsPass) this.vhsPass.uniforms.time.value += dt;

    this.controls.getObject().position.set(
      this.playerBody.position.x,
      this.playerBody.position.y + 0.5,
      this.playerBody.position.z
    );

    this.updateStars(dt);
    this.floor.updateHue(hue);
    this.floor.update(this.camera);
    this.scene.background.setHSL(hue, 1, 0.03);

    if (this._neonMats) {
      syncNeon(this._neonMats, hue, performance.now() * 0.001);
    }

    this.composer.render();
    requestAnimationFrame(this.loop.bind(this));
  }
}

/*---------------- start ----------------------*/
document.addEventListener('DOMContentLoaded', () => {
  new App(document.getElementById('three-canvas'));
});
