import * as THREE from 'three';
import { createToonMaterial, addOutline } from '../utils/ToonMaterial.js';
import { mulberry32 } from './Arena.js';
import { createAtmosphereSystem } from './SkyAndAtmosphere.js';
import {
  createCutStoneTexture,
  createWoodPlankTexture,
  createAsianRoofTileTexture,
  createStylizedWaterTexture,
  createGrassAndPetalsTexture,
} from '../utils/ProceduralTextures.js';
import {
  markNoCollision,
  createSpiritTreeHero,
  createPlazaSpiritPost,
  createStonePathLantern,
  createStylizedBush,
  createReedCluster,
  createWallPropsCluster,
  createCurvedEastRoof,
  createEarthBuildingDetail,
  createZigguratPyramid,
  createVolcanoMountain,
  createOrnamentalBrazier,
  createSkyTempleIsland,
  createBridgeDecor,
  createTurnedBarrelMesh,
} from './SanctuaryProps.js';

/**
 * ElementalMap — "Santuario de las Cuatro Naciones"
 * ----------------------------------------------------------------------
 * Mapa abierto Cel-Shaded / Anime de 116 × 116 unidades (X, Z ∈ [-58, +58])
 * cerrado por murallas perimetrales, iluminación diurna vibrante y 5 sectores:
 *  - Centro (0, 0): Plaza elevada del Árbol Espíritu (Bonsái gigante + 6 postes).
 *  - Norte (Z < -18): Distrito Tierra (torii olivo, edificios escalables con rampas,
 *    muros de cobertura, 3 pirámides monumentales en el horizonte).
 *  - Este (X > +18): Distrito Fuego (torii carmesí, pagoda de 3 niveles con terraza
 *    caminable, 3 pabellones con braseros animados, 2 volcanes con lava en horizonte).
 *  - Oeste (X < -18): Distrito Agua (arco blanco/azul acero, canales de agua somera
 *    que salpican al caminar, 3 puentes elevados de piedra, 3 edificios blancos).
 *  - Sur (Z > +18): Patio del Aire (explanada dorada, 2 pabellones abiertos con
 *    columnas, 7 islas flotantes de conos invertidos en el cielo con nubes).
 */
export class ElementalMap {
  static HALF_SIZE = 58;
  static PLAYABLE_HALF = 56.6;

  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'ElementalMap';
    scene.add(this.group);

    // Colecciones compatibles con la interfaz unificada de Arena
    this.pillars = [];
    this.platforms = [];
    this.barrels = [];
    this.barrelsPassive = false;
    this.onBarrelBreak = null;
    this.cameraColliders = [];
    this.aimColliders = [];
    this.obstacles = new Set();

    // Colisionadores específicos del Santuario
    this.boxColliders = [];
    this.cylColliders = [];
    this.ramps = [];
    this.waterZones = [];

    // Animaciones ambientales
    this._braziers = [];
    this._smokePuffs = [];
    this._skyIslands = [];
    this._spiritOrbs = [];
    this._treeVines = [];
    this._treeMotes = [];
    this._gateBanners = [];
    this._prayerFlags = [];
    this._waterTex = null;
    this._waterShoreRings = [];
    this._atmosphere = null;
    this._time = 0;

    this.vfx = null;
    this.sound = null;
    this.hasAbyss = false;
    this.supportsDangerRing = false;

    this._setupAtmosphere();
    this._buildBaseFloorAndWalls();
    this._buildCenterPlaza();
    this._buildEarthDistrict();
    this._buildFireDistrict();
    this._buildWaterDistrict();
    this._buildAirDistrict();
    this._buildBarrels();
    this._buildEnvironmentalProps();

    // Inicia oculto hasta que MatchManager active este escenario
    this.setVisible(false);
  }

  setEffects(vfx, sound) {
    this.vfx = vfx;
    this.sound = sound;
  }

  // ====================================================================
  //  Atmósfera diurna luminosa, Sky Dome, cordilleras y nubes suaves
  // ====================================================================
  _setupAtmosphere() {
    this._atmosphere = createAtmosphereSystem(this.scene, 'sanctuary');
    this.sky = this._atmosphere.skyDome;
    this.sun = this._atmosphere.sun;
    this._lights = this._atmosphere.lights;
    this._clouds = this._atmosphere.clouds;
    this._fog = this._atmosphere.fog;
    this._fogColor = this._atmosphere.fogColor;
  }

  applyAtmosphere() {
    if (this._atmosphere) this._atmosphere.apply();
  }

  setVisible(visible) {
    this.group.visible = visible;
    if (this._atmosphere) this._atmosphere.setVisible(visible);
  }

  // ====================================================================
  //  Helpers de registro sólido y malla Cel-Shaded
  // ====================================================================
  _registerBox(cx, cz, width, depth, minY, maxY, opts = {}) {
    this.boxColliders.push({
      minX: cx - width / 2,
      maxX: cx + width / 2,
      minZ: cz - depth / 2,
      maxZ: cz + depth / 2,
      minY,
      maxY,
      blocksProjectile: opts.blocksProjectile !== false,
      walkableTop: opts.walkableTop !== false,
      tolerance: opts.tolerance ?? 0.3,
    });
    if (opts.addPlatformSummary) {
      this.platforms.push({
        cx,
        cz,
        halfX: width / 2,
        halfZ: depth / 2,
        height: maxY,
      });
    }
  }

  _registerCylinder(x, z, radius, minY, maxY, opts = {}) {
    this.cylColliders.push({
      x,
      z,
      radius,
      minY,
      maxY,
      blocksProjectile: opts.blocksProjectile !== false,
      walkableTop: opts.walkableTop !== false,
    });
    if (opts.registerPillar !== false) {
      this.pillars.push({ x, z, radius, top: maxY });
    }
  }

  _registerRamp(cx, cz, width, depth, axis, dirSign, yLow, yHigh) {
    const minX = cx - width / 2;
    const maxX = cx + width / 2;
    const minZ = cz - depth / 2;
    const maxZ = cz + depth / 2;
    this.ramps.push({ minX, maxX, minZ, maxZ, axis, dirSign, yLow, yHigh });
  }

  _addBoxMesh(x, yCenter, z, w, h, d, color, opts = {}) {
    const mat = createToonMaterial(color, opts.mat || {});
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, yCenter, z);
    mesh.castShadow = opts.castShadow !== false;
    mesh.receiveShadow = opts.receiveShadow !== false;
    if (opts.outline !== false) {
      addOutline(mesh, opts.outlineThickness ?? 0.04, opts.outlineColor ?? 0x1a1e26);
    }
    this.group.add(mesh);
    if (opts.aim !== false) this.aimColliders.push(mesh);
    if (opts.cam) this.cameraColliders.push(mesh);
    return mesh;
  }

  /** Construye escalera/rampa visual con peldaños estilizados y la registra en física */
  _buildStairRamp(cx, cz, width, depth, axis, dirSign, yLow, yHigh, color) {
    const steps = Math.max(4, Math.round((yHigh - yLow) / 0.35));
    const stepMat = createToonMaterial(color);
    const stairGroup = new THREE.Group();

    // Base sólida inclinada limpia para evitar huecos laterales
    for (let i = 0; i < steps; i++) {
      const t = (i + 1) / steps;
      const h = yLow + (yHigh - yLow) * t;
      const fracSpan = 1 / steps;
      const stepW = axis === 'x' ? width * fracSpan * 1.04 : width;
      const stepD = axis === 'z' ? depth * fracSpan * 1.04 : depth;
      const offsetRatio = -0.5 + (i + 0.5) * fracSpan;
      const sx = axis === 'x' ? cx + dirSign * offsetRatio * width : cx;
      const sz = axis === 'z' ? cz + dirSign * offsetRatio * depth : cz;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(stepW, h, stepD), stepMat);
      mesh.position.set(sx, h / 2, sz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      addOutline(mesh, 0.03, 0x1c2028);
      stairGroup.add(mesh);
      this.aimColliders.push(mesh);
    }
    this.group.add(stairGroup);
    this._registerRamp(cx, cz, width, depth, axis, dirSign, yLow, yHigh);
  }

  // ====================================================================
  //  1. Suelo 116 × 116 y Murallas Perimetrales
  // ====================================================================
  _buildBaseFloorAndWalls() {
    const H = ElementalMap.HALF_SIZE;
    const size = H * 2;
    const floorTex = createSanctuaryFloorTexture();
    const floorMat = createToonMaterial('#e5d5b5', {
      map: floorTex,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.name = 'SanctuaryFloor';
    this.group.add(floor);
    this.aimColliders.push(floor);

    // Base rocosa exterior por debajo para dar espesor si mira desde lejos
    const slabMat = createToonMaterial('#7f7565');
    const slab = new THREE.Mesh(new THREE.BoxGeometry(size + 2, 4, size + 2), slabMat);
    slab.position.y = -2.01;
    slab.receiveShadow = true;
    this.group.add(slab);

    // 4 Murallas perimetrales cerradas (-58..+58) con piedra labrada y techo curvo de tejas asiáticas
    const wallH = 7.4;
    const wallThick = 2.2;
    const wallStoneTex = createCutStoneTexture({
      baseColor: '#c8bea8',
      mortarColor: '#7a705e',
      highlightColor: '#e8dec8',
      cols: 6,
      rows: 4,
      repeatX: 12,
      repeatY: 2,
      seed: 71,
    });
    const wallTrimTex = createCutStoneTexture({
      baseColor: '#8d826e',
      mortarColor: '#4f483b',
      cols: 3,
      rows: 2,
      repeatX: 2,
      repeatY: 2,
      seed: 73,
    });
    const roofTileTex = createAsianRoofTileTexture({
      baseColor: '#3f4956',
      ridgeColor: '#66758a',
      shadeColor: '#212730',
      repeatX: 24,
      repeatY: 2,
      seed: 79,
    });
    const wallMatOpts = { map: wallStoneTex, flatShading: false };
    const trimColor = '#8d826e';
    const tileMat = createToonMaterial('#ffffff', { map: roofTileTex, flatShading: false });

    // Perfil inclinado a dos aguas con aleros curvos para coronación continua de muralla
    const wallRoofShape = new THREE.Shape();
    wallRoofShape.moveTo(-1.85, 0);
    wallRoofShape.quadraticCurveTo(-0.85, 0.25, 0, 1.05);
    wallRoofShape.quadraticCurveTo(0.85, 0.25, 1.85, 0);
    wallRoofShape.lineTo(1.75, -0.22);
    wallRoofShape.lineTo(-1.75, -0.22);
    wallRoofShape.closePath();

    const sides = [
      { x: 0, z: -H, w: size + 2, d: wallThick, alongX: true },
      { x: 0, z: H, w: size + 2, d: wallThick, alongX: true },
      { x: -H, z: 0, w: wallThick, d: size + 2, alongX: false },
      { x: H, z: 0, w: wallThick, d: size + 2, alongX: false },
    ];

    for (const s of sides) {
      this._addBoxMesh(s.x, wallH / 2, s.z, s.w, wallH, s.d, '#ffffff', {
        cam: true,
        outlineThickness: 0.045,
        mat: wallMatOpts,
      });
      const baseM = this._addBoxMesh(s.x, 0.45, s.z, s.w + 0.25, 0.9, s.d + 0.25, '#6b6355', {
        cam: false,
        aim: false,
        outlineThickness: 0.03,
      });
      markNoCollision(baseM);

      this._addBoxMesh(s.x, wallH + 0.3, s.z, s.w + 0.45, 0.6, s.d + 0.45, '#ffffff', {
        cam: false,
        outlineThickness: 0.04,
        mat: { map: wallTrimTex, flatShading: false },
      });
      const roofLen = (s.alongX ? s.w : s.d) + 0.8;
      const roofGeo = new THREE.ExtrudeGeometry(wallRoofShape, { depth: roofLen, bevelEnabled: false });
      roofGeo.translate(0, 0, -roofLen * 0.5);
      if (s.alongX) roofGeo.rotateY(Math.PI * 0.5);
      const eave = new THREE.Mesh(roofGeo, tileMat);
      eave.position.set(s.x, wallH + 0.72, s.z);
      eave.castShadow = true;
      addOutline(eave, 0.04, 0x1a1e26);
      markNoCollision(eave);
      this.group.add(eave);

      this._registerBox(s.x, s.z, s.w, s.d, 0, wallH + 1.5, {
        walkableTop: false,
      });

      // Contrafuertes de piedra labrada cada 12u
      for (let t = -48; t <= 48; t += 12) {
        const bx = s.alongX ? t : s.x - Math.sign(s.x) * 1.05;
        const bz = s.alongX ? s.z - Math.sign(s.z) * 1.05 : t;
        this._addBoxMesh(bx, 3.2, bz, 1.4, 6.4, 1.4, trimColor, {
          cam: false,
          outlineThickness: 0.035,
          mat: { map: wallTrimTex, flatShading: false },
        });
        const capB = this._addBoxMesh(bx, 6.55, bz, 1.65, 0.35, 1.65, '#6b6355', {
          cam: false,
          aim: false,
        });
        markNoCollision(capB);
        this._registerBox(bx, bz, 1.4, 1.4, 0, 6.6, { walkableTop: false });

        if (t < 48) {
          const midT = t + 6;
          const rx = s.alongX ? midT : s.x - Math.sign(s.x) * 1.12;
          const rz = s.alongX ? s.z - Math.sign(s.z) * 1.12 : midT;
          const rel = this._addBoxMesh(
            rx,
            4.2,
            rz,
            s.alongX ? 4.4 : 0.25,
            2.2,
            s.alongX ? 0.25 : 4.4,
            '#b8ad95',
            { cam: false, aim: false, outlineThickness: 0.025 }
          );
          markNoCollision(rel);
        }
      }
    }

    // Torres esquineras en los 4 vértices (±58, ±58) con techo curvo oriental real
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const tx = sx * H;
        const tz = sz * H;
        this._addBoxMesh(tx, 5.4, tz, 4.6, 10.8, 4.6, '#ffffff', {
          cam: true,
          mat: { map: wallStoneTex, flatShading: false },
        });
        this._addBoxMesh(tx, 11.0, tz, 5.2, 0.7, 5.2, '#7d725f', { cam: false });
        const towerRoof = createCurvedEastRoof(5.8, 5.8, 2.8, '#3f4b59', '#d8a642', 0x1a1e26);
        towerRoof.position.set(tx, 11.35, tz);
        this.group.add(towerRoof);
        this._registerBox(tx, tz, 4.8, 4.8, 0, 12);
      }
    }
  }

  // ====================================================================
  //  2. Centro: Plaza del Árbol Espíritu (0, 0)
  // ====================================================================
  _buildCenterPlaza() {
    const plazaGroup = new THREE.Group();
    const plazaStoneTex = createCutStoneTexture({
      baseColor: '#dbceb5',
      mortarColor: '#8d7f66',
      cols: 6,
      rows: 4,
      repeatX: 4,
      repeatY: 1,
    });
    const grassTex = createGrassAndPetalsTexture({
      baseColor: '#56b358',
      darkGreen: '#3b8c40',
      lightGreen: '#7ee068',
      repeatX: 4,
      repeatY: 4,
    });
    const stoneMat = createToonMaterial('#ffffff', { map: plazaStoneTex, flatShading: false });
    const stoneTrimMat = createToonMaterial('#a69678', { flatShading: false });
    const grassMat = createToonMaterial('#ffffff', { map: grassTex, flatShading: false });

    // Peldaño inferior (radio 13.6, alto 0.3) y plataforma principal (radio 11.4, alto 0.6)
    const lowerStep = new THREE.Mesh(new THREE.CylinderGeometry(13.6, 14.0, 0.3, 48), stoneMat);
    lowerStep.position.y = 0.15;
    lowerStep.receiveShadow = true;
    addOutline(lowerStep, 0.04, 0x26221c);

    const upperStep = new THREE.Mesh(new THREE.CylinderGeometry(11.4, 12.1, 0.34, 48), stoneMat);
    upperStep.position.y = 0.43;
    upperStep.receiveShadow = true;
    addOutline(upperStep, 0.04, 0x26221c);

    // Molduras biseladas de borde de piedra (visuales, sin colisión extra)
    const lowerRing = new THREE.Mesh(new THREE.TorusGeometry(13.65, 0.09, 6, 48), stoneTrimMat);
    lowerRing.rotation.x = Math.PI / 2;
    lowerRing.position.y = 0.3;
    markNoCollision(lowerRing);

    const upperRing = new THREE.Mesh(new THREE.TorusGeometry(11.35, 0.1, 6, 48), stoneTrimMat);
    upperRing.rotation.x = Math.PI / 2;
    upperRing.position.y = 0.6;
    markNoCollision(upperRing);

    const grassCap = new THREE.Mesh(new THREE.CylinderGeometry(10.6, 10.6, 0.06, 48), grassMat);
    grassCap.position.y = 0.61;
    grassCap.receiveShadow = true;

    plazaGroup.add(lowerStep, upperStep, lowerRing, upperRing, grassCap);
    this.aimColliders.push(lowerStep, upperStep, grassCap);
    this.platforms.push({ cx: 0, cz: 0, halfX: 11.4, halfZ: 11.4, height: 0.6 });

    // Árbol Espíritu Monumental tipo Bonsái esculpido en (0, 0)
    const tree = createSpiritTreeHero();
    plazaGroup.add(tree.group);
    for (const tm of tree.solidTrunkMeshes) {
      this.aimColliders.push(tm);
      this.cameraColliders.push(tm);
    }
    this._treeVines = tree.hangingVines;
    this._treeMotes = tree.motes;
    this._registerCylinder(0, 0, 1.75, 0, 9.0, { walkableTop: false });

    // 6 postes ceremoniales con base de piedra, travesaño y farol enrejado luminoso
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const px = Math.cos(a) * 9.8;
      const pz = Math.sin(a) * 9.8;
      const postObj = createPlazaSpiritPost();
      postObj.group.position.set(px, 0.6, pz);
      postObj.group.rotation.y = -a + Math.PI / 2;

      plazaGroup.add(postObj.group);
      this.aimColliders.push(postObj.postMesh);
      this._spiritOrbs.push({ orb: postObj.orb, halo: postObj.halo, baseScale: 1, phase: i * 1.1 });
      this._registerCylinder(px, pz, 0.35, 0, 3.6, { walkableTop: false });
    }

    this.group.add(plazaGroup);
  }

  // ====================================================================
  //  3. Norte (Z < -18): Distrito Tierra + 3 Zigurat en el horizonte
  // ====================================================================
  _buildEarthDistrict() {
    // Puerta Torii monumental de piedra verde oliva (Z = -18.5)
    this._buildToriiGate(0, -18.5, 0, '#6a7d4a', '#4d5c34', '#d8b252', 'earth');

    // 4 Edificios bajos de piedra ocre escalables mediante rampas laterales + detallado arquitectónico
    const earthBuildings = [
      {
        cx: -14, cz: -34, w: 7.5, d: 7.5, h: 2.5,
        ramp: { axis: 'x', dir: -1, offsetX: 5.75, offsetZ: 0, w: 4.0, d: 3.2 },
      },
      {
        cx: 14, cz: -34, w: 7.5, d: 7.5, h: 2.5,
        ramp: { axis: 'x', dir: 1, offsetX: -5.75, offsetZ: 0, w: 4.0, d: 3.2 },
      },
      {
        cx: -23, cz: -46, w: 8.2, d: 7.2, h: 3.1,
        ramp: { axis: 'z', dir: -1, offsetX: 0, offsetZ: 6.1, w: 3.4, d: 5.0 },
      },
      {
        cx: 23, cz: -46, w: 8.2, d: 7.2, h: 3.1,
        ramp: { axis: 'z', dir: -1, offsetX: 0, offsetZ: 6.1, w: 3.4, d: 5.0 },
      },
    ];

    for (let bi = 0; bi < earthBuildings.length; bi++) {
      const b = earthBuildings[bi];
      // Cuerpo del edificio sólido
      this._addBoxMesh(b.cx, b.h / 2, b.cz, b.w, b.h, b.d, '#d4b072', { cam: true });
      this._addBoxMesh(b.cx, b.h - 0.14, b.cz, b.w + 0.45, 0.28, b.d + 0.45, '#9d7d47', { cam: false });
      this._addBoxMesh(b.cx, 0.32, b.cz, b.w + 0.18, 0.64, b.d + 0.18, '#667b45', { cam: false });
      this._registerBox(b.cx, b.cz, b.w, b.d, 0, b.h, { addPlatformSummary: true });

      // Detalle arquitectónico Cel-Shaded (zócalos, pilastras, puertas, ventanas y almenas)
      this.group.add(createEarthBuildingDetail(b));

      // Vasijas de barro, piedras y cajas junto a un muro lateral seguro
      const sideSign = b.cx < 0 ? 1 : -1;
      const wallProps = createWallPropsCluster(100 + bi * 17);
      wallProps.position.set(b.cx + sideSign * (b.w * 0.5 + 0.8), 0, b.cz - b.d * 0.32);
      this.group.add(wallProps);

      const r = b.ramp;
      this._buildStairRamp(
        b.cx + r.offsetX,
        b.cz + r.offsetZ,
        r.w,
        r.d,
        r.axis,
        r.dir,
        0,
        b.h,
        '#b89458'
      );
    }

    // Muros bajos de cobertura táctica en piedra ocre/oliva con remates biselados
    const coverWalls = [
      { x: -6.5, z: -28, w: 4.4, d: 1.2, h: 1.45 },
      { x: 6.5, z: -28, w: 4.4, d: 1.2, h: 1.45 },
      { x: 0, z: -43, w: 6.8, d: 1.3, h: 1.55 },
    ];
    for (const cw of coverWalls) {
      this._addBoxMesh(cw.x, cw.h / 2, cw.z, cw.w, cw.h, cw.d, '#9f875c');
      this._addBoxMesh(cw.x, cw.h + 0.12, cw.z, cw.w + 0.24, 0.24, cw.d + 0.24, '#6b7e48');
      const plinth = this._addBoxMesh(cw.x, 0.18, cw.z, cw.w + 0.28, 0.36, cw.d + 0.28, '#665a44', {
        cam: false,
        aim: false,
      });
      markNoCollision(plinth);
      this._registerBox(cw.x, cw.z, cw.w, cw.d, 0, cw.h + 0.24);
    }

    // 3 Pirámides escalonadas monumentales (Zigurat) fuera de la muralla Norte (Z < -75)
    const pyramids = [
      { x: -46, z: -92, r: 22, h: 31, col: '#d1ad6d', stepCol: '#b38e4e', capCol: '#f2ca52' },
      { x: 0, z: -102, r: 28, h: 42, col: '#c79f5e', stepCol: '#a67f43', capCol: '#f4cf58' },
      { x: 46, z: -90, r: 21, h: 29, col: '#d1ad6d', stepCol: '#b38e4e', capCol: '#f2ca52' },
    ];
    for (const p of pyramids) {
      const zig = createZigguratPyramid(p.r, p.h, p.col, p.stepCol, p.capCol);
      zig.position.set(p.x, -2, p.z);
      this.group.add(zig);
    }
  }

  // ====================================================================
  //  4. Este (X > 18): Distrito Fuego + Pagoda 3 niveles + 2 Volcanes
  // ====================================================================
  _buildFireDistrict() {
    // Torii carmesí en la entrada Este (X = 18.5)
    this._buildToriiGate(18.5, 0, Math.PI / 2, '#b92622', '#262328', '#f7b239', 'fire');

    // Pagoda escalonada de 3 niveles centrada en (45, 0, 0) — Terraza inferior caminable
    const px = 45;
    const pz = 0;
    const tier1H = 2.1;
    // Nivel 1 (base caminable 10.6 × 10.6, alero azul grisáceo + barandillas de madera abiertas al Oeste)
    this._addBoxMesh(px, tier1H / 2, pz, 10.6, tier1H, 10.6, '#b72b25', { cam: true });
    this._addBoxMesh(px, tier1H - 0.14, pz, 11.4, 0.28, 11.4, '#34495e', { cam: false });
    this._registerBox(px, pz, 10.6, 10.6, 0, tier1H, { addPlatformSummary: true });

    // Barandillas de madera dorada/oscura en los 3 bordes sin rampa + pilares esquineros lacados
    const railWood = createToonMaterial('#5c3422');
    const goldMat = createToonMaterial('#f0b63a');
    for (const side of ['north', 'south', 'east']) {
      const isZ = side !== 'east';
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(isZ ? 10.2 : 0.22, 0.55, isZ ? 0.22 : 10.2),
        railWood
      );
      rail.position.set(
        side === 'east' ? px + 5.12 : px,
        tier1H + 0.28,
        side === 'north' ? pz - 5.12 : side === 'south' ? pz + 5.12 : pz
      );
      addOutline(rail, 0.025, 0x1a120d);
      markNoCollision(rail);
      this.group.add(rail);
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const cornerCol = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, tier1H, 16), createToonMaterial('#821b17'));
        cornerCol.position.set(px + sx * 5.2, tier1H * 0.5, pz + sz * 5.2);
        const capBall = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), goldMat);
        capBall.position.set(px + sx * 5.12, tier1H + 0.65, pz + sz * 5.12);
        markNoCollision(cornerCol);
        markNoCollision(capBall);
        this.group.add(cornerCol, capBall);
      }
    }

    // Rampa frontal hacia la terraza 1 desde el Oeste
    this._buildStairRamp(px - 7.4, pz, 4.4, 3.6, 'x', 1, 0, tier1H, '#c46f41');

    // Nivel 2 (cuerpo central lacado + techo curvo oriental)
    this._addBoxMesh(px, tier1H + 1.15, pz, 6.4, 2.3, 6.4, '#c7342b', { cam: true });
    this._registerBox(px, pz, 6.4, 6.4, tier1H, tier1H + 2.5, { walkableTop: false });

    const roof2 = createCurvedEastRoof(8.0, 8.0, 1.55, '#31465c', '#f0b63a', 0x161b22);
    roof2.position.set(px, tier1H + 2.3, pz);
    this.group.add(roof2);

    // Nivel 3 (torreta superior + techo curvo + aguja dorada ornamental)
    this._addBoxMesh(px, tier1H + 4.35, pz, 4.0, 1.7, 4.0, '#c7342b', { cam: false });
    const roof3 = createCurvedEastRoof(5.6, 5.6, 1.55, '#31465c', '#f0b63a', 0x161b22);
    roof3.position.set(px, tier1H + 5.2, pz);
    this.group.add(roof3);

    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.28, 1.75, 16), goldMat);
    spire.position.set(px, tier1H + 7.2, pz);
    addOutline(spire, 0.03, 0x2a1a08);
    markNoCollision(spire);
    this.group.add(spire);

    // 3 Pabellones rojos con zócalos, columnas cilíndricas suaves, techos curvos orientales y pebeteros de fuego
    const firePavilions = [
      { x: 30, z: -20, w: 6.4, d: 6.4, h: 2.7 },
      { x: 30, z: 20, w: 6.4, d: 6.4, h: 2.7 },
      { x: 43, z: -28, w: 7.0, d: 6.0, h: 2.9 },
    ];
    const lacqueredColMat = createToonMaterial('#821b17');
    for (const fp of firePavilions) {
      this._addBoxMesh(fp.x, fp.h / 2, fp.z, fp.w, fp.h, fp.d, '#ba2923', { cam: true });
      this._registerBox(fp.x, fp.z, fp.w, fp.d, 0, fp.h + 1.5, { walkableTop: false });

      // Zócalo oscuro + columnas lacadas con detalle dorado
      const baseM = this._addBoxMesh(fp.x, 0.24, fp.z, fp.w + 0.35, 0.48, fp.d + 0.35, '#423331', {
        cam: false,
        aim: false,
      });
      markNoCollision(baseM);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, fp.h, 16), lacqueredColMat);
          col.position.set(fp.x + sx * (fp.w * 0.5 + 0.02), fp.h * 0.5, fp.z + sz * (fp.d * 0.5 + 0.02));
          markNoCollision(col);
          this.group.add(col);
        }
      }

      // Techo curvo azul-grisáceo estilizado con alero levantado y caballete dorado
      const roofMesh = createCurvedEastRoof(fp.w + 1.4, fp.d + 1.4, 2.0, '#31465c', '#f0b63a', 0x151a22);
      roofMesh.position.set(fp.x, fp.h, fp.z);
      this.group.add(roofMesh);

      // Pebetero de hierro con llama multilengua delante de cada pabellón
      this._buildFlameBrazier(fp.x - fp.w / 2 - 1.35, fp.z);
    }
    this._buildFlameBrazier(px - 5.2, pz - 4.2);
    this._buildFlameBrazier(px - 5.2, pz + 4.2);

    // 2 Volcanes rocosos irregulares (`RockGeometry.js`) fuera de la muralla Este (X > 75)
    const volcanoes = [
      { x: 96, z: -30, rBase: 25, rTop: 6.2, h: 34, seed: 301 },
      { x: 102, z: 34, rBase: 29, rTop: 7.2, h: 41, seed: 509 },
    ];
    for (const v of volcanoes) {
      const volc = createVolcanoMountain(v.rBase, v.rTop, v.h, v.seed);
      volc.group.position.set(v.x, 0, v.z);
      this.group.add(volc.group);
      for (const sp of volc.smokePuffs) {
        this._smokePuffs.push({
          mesh: sp.mesh,
          baseX: 0,
          baseY: sp.baseY,
          baseZ: 0,
          phase: sp.phase,
          heightSpan: 20,
        });
      }
    }
  }

  _buildFlameBrazier(x, z) {
    const brz = createOrnamentalBrazier(x * 1.7 + z);
    brz.group.position.set(x, 0, z);
    this.group.add(brz.group);
    this._registerCylinder(x, z, 0.65, 0, 1.0, { walkableTop: false });

    this._braziers.push({
      flameGroup: brz.flame.group,
      phase: x * 0.7 + z,
    });
  }

  // ====================================================================
  //  5. Oeste (X < -18): Distrito Agua + Canales + 3 Puentes + 3 Edificios
  // ====================================================================
  _buildWaterDistrict() {
    // Arco monumental blanco y azul acero en la entrada Oeste (X = -18.5)
    this._buildToriiGate(-18.5, 0, Math.PI / 2, '#f0f6fc', '#2b5f8c', '#69d2ff', 'water');

    // Estanques/canales poco profundos con textura animada de corriente y muros de contención
    this._waterTex = createStylizedWaterTexture({ repeatX: 3, repeatY: 3 });
    const waterMat = createToonMaterial('#29b6f6', {
      map: this._waterTex,
      transparent: true,
      opacity: 0.9,
    });
    const retainingWallMat = createToonMaterial('#b7c7d6', {
      map: createCutStoneTexture({
        baseColor: '#bfd0df',
        mortarColor: '#6f879c',
        repeatX: 4,
        repeatY: 1,
      }),
    });
    const foamMat = createToonMaterial('#eefaff', {
      transparent: true,
      opacity: 0.78,
    });
    const riverRockMat = createToonMaterial('#7f94a6');

    const pools = [
      { cx: -35, cz: -15, w: 22, d: 17 }, // Estanque Norte-Oeste
      { cx: -35, cz: 15, w: 22, d: 17 },  // Estanque Sur-Oeste
      { cx: -45, cz: 0, w: 10, d: 14 },   // Canal conector Oeste
    ];

    for (const pl of pools) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(pl.w, 0.05, pl.d), waterMat);
      mesh.position.set(pl.cx, 0.025, pl.cz);
      mesh.receiveShadow = true;
      this.group.add(mesh);

      // Muros de contención de piedra tallada enmarcando los 4 lados del canal (bajo, noCollision)
      const wallH = 0.16;
      const wallT = 0.3;
      const borders = [
        [pl.cx, wallH * 0.5, pl.cz - pl.d * 0.5 - wallT * 0.5, pl.w + wallT * 2, wallH, wallT],
        [pl.cx, wallH * 0.5, pl.cz + pl.d * 0.5 + wallT * 0.5, pl.w + wallT * 2, wallH, wallT],
        [pl.cx - pl.w * 0.5 - wallT * 0.5, wallH * 0.5, pl.cz, wallT, wallH, pl.d],
        [pl.cx + pl.w * 0.5 + wallT * 0.5, wallH * 0.5, pl.cz, wallT, wallH, pl.d],
      ];
      for (const [bx, by, bz, bw, bh, bd] of borders) {
        const curb = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), retainingWallMat);
        curb.position.set(bx, by, bz);
        curb.receiveShadow = true;
        addOutline(curb, 0.02, 0x1d2d3d);
        markNoCollision(curb);
        this.group.add(curb);
      }

      // Orla sutil de espuma junto a las riberas interiores
      const foamBands = [
        [pl.cx, 0.056, pl.cz - pl.d * 0.5 + 0.18, pl.w - 0.1, 0.14],
        [pl.cx, 0.056, pl.cz + pl.d * 0.5 - 0.18, pl.w - 0.1, 0.14],
      ];
      for (const [fx, fy, fz, fw, fd] of foamBands) {
        const rim = new THREE.Mesh(new THREE.BoxGeometry(fw, 0.014, fd), foamMat);
        rim.position.set(fx, fy, fz);
        markNoCollision(rim);
        this.group.add(rim);
      }

      // Matas de juncos y piedras redondeadas de río en esquinas de cada estanque
      for (const sx of [-1, 1]) {
        const cornerX = pl.cx + sx * (pl.w * 0.44);
        const cornerZ = pl.cz - pl.d * 0.43;
        const reeds = createReedCluster(pl.cx * 3 + pl.cz + sx * 19, true);
        reeds.position.set(cornerX, 0.02, cornerZ);
        this.group.add(reeds);

        const rRock = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 8), riverRockMat);
        rRock.scale.set(1.25, 0.62, 1.05);
        rRock.position.set(cornerX - sx * 0.62, 0.12, cornerZ + 0.35);
        addOutline(rRock, 0.018, 0x203040);
        markNoCollision(rRock);
        this.group.add(rRock);
      }

      this.waterZones.push({
        minX: pl.cx - pl.w / 2,
        maxX: pl.cx + pl.w / 2,
        minZ: pl.cz - pl.d / 2,
        maxZ: pl.cz + pl.d / 2,
      });
    }

    // Pequeño muelle de madera al borde del canal Norte-Oeste (visual, al ras del bordillo)
    const dockWood = createToonMaterial('#8a5d3b', {
      map: createWoodPlankTexture({ baseColor: '#91633f', grainColor: '#58371f', repeatX: 2, repeatY: 2 }),
    });
    const dockDark = createToonMaterial('#5c3b22');
    const dockGroup = new THREE.Group();
    dockGroup.position.set(-25.8, 0.14, -22.2);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 2.2), dockWood);
    addOutline(deck, 0.022, 0x1e130b);
    dockGroup.add(deck);
    for (const dx of [-1.3, 1.3]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.65, 12), dockDark);
      post.position.set(dx, 0.12, 0.9);
      dockGroup.add(post);
    }
    markNoCollision(dockGroup);
    this.group.add(dockGroup);

    // 3 Puentes arqueados con cubierta de tablones de madera, arco parabólico y faroles azules
    const bridgeDeckMat = createToonMaterial('#9e6c43', {
      map: createWoodPlankTexture({ baseColor: '#a47047', grainColor: '#5b3920', repeatX: 2, repeatY: 4 }),
    });
    const bridges = [
      { cx: -33, cz: -15, w: 4.8, d: 19.6, axis: 'z', span: 12.6 },
      { cx: -33, cz: 15, w: 4.8, d: 19.6, axis: 'z', span: 12.6 },
      { cx: -45, cz: 0, w: 12.8, d: 4.6, axis: 'x', span: 8.4 },
    ];
    for (const br of bridges) {
      const h = 0.48;
      const deckW = br.axis === 'z' ? br.w : br.span;
      const deckD = br.axis === 'z' ? br.span : br.d;
      const deckSlab = new THREE.Mesh(new THREE.BoxGeometry(deckW, 0.12, deckD), bridgeDeckMat);
      deckSlab.position.set(br.cx, h - 0.06, br.cz);
      deckSlab.castShadow = true;
      deckSlab.receiveShadow = true;
      addOutline(deckSlab, 0.028, 0x1e140c);
      this.group.add(deckSlab);
      this.aimColliders.push(deckSlab);

      this._registerBox(br.cx, br.cz, deckW, deckD, 0, h, {
        blocksProjectile: false,
        tolerance: 0.45,
        addPlatformSummary: true,
      });

      // Detalle arquitectónico del puente (arco parabólico inferior + balaustres torneados + faroles)
      const decor = createBridgeDecor(deckW, deckD, h, br.axis);
      decor.position.set(br.cx, 0, br.cz);
      this.group.add(decor);

      const foam = new THREE.Mesh(
        new THREE.RingGeometry(1.6, 2.2, 24),
        foamMat
      );
      foam.rotation.x = -Math.PI / 2;
      foam.position.set(br.cx, 0.055, br.cz);
      markNoCollision(foam);
      this.group.add(foam);

      // Rampas de acceso en ambos extremos del puente
      const rampLen = br.axis === 'z' ? (br.d - deckD) / 2 : (br.w - deckW) / 2;
      const offset = br.axis === 'z' ? (deckD + rampLen) / 2 : (deckW + rampLen) / 2;
      const rw = br.axis === 'z' ? br.w : rampLen;
      const rd = br.axis === 'z' ? rampLen : br.d;
      this._buildStairRamp(
        br.cx - (br.axis === 'x' ? offset : 0),
        br.cz - (br.axis === 'z' ? offset : 0),
        rw,
        rd,
        br.axis,
        1,
        0,
        h,
        '#8594a6'
      );
      this._buildStairRamp(
        br.cx + (br.axis === 'x' ? offset : 0),
        br.cz + (br.axis === 'z' ? offset : 0),
        rw,
        rd,
        br.axis,
        -1,
        0,
        h,
        '#8594a6'
      );
    }

    // 3 Edificios blancos con cúpulas escalonadas, techos curvos azul acero y ventanas arqueadas
    const waterBuildings = [
      { cx: -41, cz: -36, w: 8.2, d: 7.4, h: 3.0, rampSide: 'south' },
      { cx: -27, cz: 36, w: 7.4, d: 7.4, h: 2.8, rampSide: null },
      { cx: -45, cz: 36, w: 7.6, d: 8.0, h: 3.1, rampSide: null },
    ];
    const waterStoneMat = createToonMaterial('#edf5fb', {
      map: createCutStoneTexture({
        baseColor: '#edf5fb',
        mortarColor: '#afc5d9',
        repeatX: 2,
        repeatY: 2,
      }),
    });
    const steelBlue = createToonMaterial('#35618c');
    const cyanAccent = createToonMaterial('#6ecbf5');
    const windowGlass = createToonMaterial('#1e4466');

    for (const wb of waterBuildings) {
      const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(wb.w, wb.h, wb.d), waterStoneMat);
      wallMesh.position.set(wb.cx, wb.h / 2, wb.cz);
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      addOutline(wallMesh, 0.035, 0x16222e);
      this.group.add(wallMesh);
      this.cameraColliders.push(wallMesh);
      this.aimColliders.push(wallMesh);

      this._addBoxMesh(wb.cx, wb.h - 0.14, wb.cz, wb.w + 0.5, 0.3, wb.d + 0.5, '#3b6a96', { cam: false });
      this._registerBox(wb.cx, wb.cz, wb.w, wb.d, 0, wb.h, { addPlatformSummary: true });

      // Zócalo azul acero + arcos de ventana suaves en frentes libres
      const wbBase = this._addBoxMesh(wb.cx, 0.22, wb.cz, wb.w + 0.25, 0.44, wb.d + 0.25, '#2b547a', {
        cam: false,
        aim: false,
      });
      markNoCollision(wbBase);
      for (const off of [-1.6, 1.6]) {
        const winFrame = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.2, 18), steelBlue);
        winFrame.rotation.x = Math.PI / 2;
        winFrame.position.set(wb.cx + off, wb.h * 0.58, wb.cz + (wb.cz < 0 ? wb.d * 0.5 + 0.04 : -wb.d * 0.5 - 0.04));
        const winCore = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.24, 18), windowGlass);
        winCore.rotation.x = Math.PI / 2;
        winCore.position.copy(winFrame.position);
        markNoCollision(winFrame);
        markNoCollision(winCore);
        this.group.add(winFrame, winCore);
      }

      if (wb.rampSide === 'south') {
        this._buildStairRamp(wb.cx, wb.cz + wb.d / 2 + 2.4, 3.4, 4.8, 'z', -1, 0, wb.h, '#b8cde0');
        // Cresta decorativa en borde norte de azotea (lejos de la rampa Sur)
        const crest = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.16, 10, 20, Math.PI), cyanAccent);
        crest.position.set(wb.cx, wb.h + 0.1, wb.cz - wb.d * 0.46);
        markNoCollision(crest);
        this.group.add(crest);
      } else {
        // Cúpula azul acero + techo curvo escalonado con cresta de ola
        const domeRoof = createCurvedEastRoof(wb.w + 1.0, wb.d + 1.0, 2.0, '#35618c', '#74d6ff', 0x13273b);
        domeRoof.position.set(wb.cx, wb.h, wb.cz);
        this.group.add(domeRoof);
        const capOrb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), cyanAccent);
        capOrb.position.set(wb.cx, wb.h + 2.25, wb.cz);
        markNoCollision(capOrb);
        this.group.add(capOrb);
        this._registerBox(wb.cx, wb.cz, wb.w, wb.d, wb.h, wb.h + 1.6, { walkableTop: false });
      }
    }
  }

  // ====================================================================
  //  6. Sur (Z > 18): Patio del Aire + 2 Pabellones Abiertos + 7 Islas Flotantes
  // ====================================================================
  _buildAirDistrict() {
    // 2 Pabellones abiertos con columnas talladas, techos curvos turquesa/dorado y banderines de oración
    const pavCenters = [
      { cx: -19, cz: 34 },
      { cx: 19, cz: 34 },
    ];
    const colMat = createToonMaterial('#f5e6bc', {
      map: createCutStoneTexture({ baseColor: '#f5e6bc', mortarColor: '#c9b37b', repeatX: 2, repeatY: 2 }),
    });
    const colTrim = createToonMaterial('#d1a749');
    const flagMats = [
      createToonMaterial('#f05d4e'),
      createToonMaterial('#56cfe1'),
      createToonMaterial('#ffd166'),
      createToonMaterial('#ffffff'),
    ];
    const capGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0, 0.0),
        new THREE.Vector2(0.68, 0.0),
        new THREE.Vector2(0.66, 0.12),
        new THREE.Vector2(0.52, 0.22),
        new THREE.Vector2(0.45, 0.34),
        new THREE.Vector2(0.0, 0.34),
      ],
      18
    );

    for (let pi = 0; pi < pavCenters.length; pi++) {
      const pv = pavCenters[pi];
      // Base de piedra baja transitable (0.28 alto) con textura de piedra tallada
      const pavFloorMat = createToonMaterial('#e2c574', {
        map: createCutStoneTexture({ baseColor: '#e2c574', mortarColor: '#ad9043', repeatX: 4, repeatY: 4 }),
      });
      const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.28, 9.2), pavFloorMat);
      baseMesh.position.set(pv.cx, 0.14, pv.cz);
      baseMesh.receiveShadow = true;
      addOutline(baseMesh, 0.03, 0x2b2314);
      this.group.add(baseMesh);
      this.aimColliders.push(baseMesh);
      this._registerBox(pv.cx, pv.cz, 9.2, 9.2, 0, 0.28, {
        blocksProjectile: false,
        tolerance: 0.4,
      });

      // 4 columnas esquineras libres con basa y capitel torneados
      const offsets = [-3.6, 3.6];
      for (const ox of offsets) {
        for (const oz of offsets) {
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.48, 4.2, 18), colMat);
          col.position.set(pv.cx + ox, 2.38, pv.cz + oz);
          col.castShadow = true;
          addOutline(col, 0.04, 0x2b2314);

          const baseCap = new THREE.Mesh(capGeo, colTrim);
          baseCap.position.set(pv.cx + ox, 0.28, pv.cz + oz);
          addOutline(baseCap, 0.024, 0x2b2314);
          markNoCollision(baseCap);

          const topCap = new THREE.Mesh(capGeo, colTrim);
          topCap.rotation.x = Math.PI;
          topCap.position.set(pv.cx + ox, 4.54, pv.cz + oz);
          addOutline(topCap, 0.024, 0x2b2314);
          markNoCollision(topCap);

          this.group.add(col, baseCap, topCap);
          this.aimColliders.push(col);
          this._registerCylinder(pv.cx + ox, pv.cz + oz, 0.52, 0, 4.5, { walkableTop: false });
        }
      }

      // Doble techo curvo turquesa y dorado a partir de Y = 4.5 + remate en espiral
      const roof1 = createCurvedEastRoof(9.4, 9.4, 1.75, '#3ea8a6', '#ecc149', 0x163235);
      roof1.position.set(pv.cx, 4.5, pv.cz);
      this.group.add(roof1);

      const roof2 = createCurvedEastRoof(5.4, 5.4, 1.45, '#ecc149', '#fff4c4', 0x3b2c0d);
      roof2.position.set(pv.cx, 5.9, pv.cz);
      this.group.add(roof2);

      // Banderines de oración colgando a lo largo de los costados del pabellón (animados)
      for (let f = 0; f < 5; f++) {
        const fx = pv.cx - 2.8 + f * 1.4;
        const flag = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.68, 0.04), flagMats[(f + pi) % flagMats.length]);
        flag.position.set(fx, 4.18, pv.cz - 3.6);
        markNoCollision(flag);
        this.group.add(flag);
        this._prayerFlags.push({ mesh: flag, phase: f * 0.7 + pi });
      }
    }

    // 7 Islas flotantes rocosas fracturadas (`RockGeometry.js`) con templos, árboles y cascadas
    const islandSpecs = [
      { x: -38, y: 26, z: 68, r: 5.8, h: 9.0, temple: true },
      { x: 0, y: 31, z: 80, r: 7.4, h: 11.5, temple: true },
      { x: 38, y: 27, z: 70, r: 5.6, h: 8.5, temple: true },
      { x: -20, y: 35, z: 54, r: 4.1, h: 6.4, temple: false },
      { x: 22, y: 37, z: 52, r: 4.3, h: 6.8, temple: false },
      { x: -50, y: 24, z: 46, r: 3.9, h: 6.2, temple: false },
      { x: 50, y: 25, z: 45, r: 4.0, h: 6.3, temple: false },
    ];
    for (let i = 0; i < islandSpecs.length; i++) {
      const sp = islandSpecs[i];
      const ig = createSkyTempleIsland(sp.r, sp.h, sp.temple, 400 + i * 37);
      ig.position.set(sp.x, sp.y, sp.z);
      this.group.add(ig);
      this._skyIslands.push({ group: ig, baseY: sp.y, phase: i * 0.95 });
    }
  }

  // ====================================================================
  //  Torii / Arco Monumental compuesto (basas, kasagi curvo, cuña y estandartes)
  // ====================================================================
  _buildToriiGate(x, z, rotY, mainColor, accentColor, emblemColor, element) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;

    const mainMat = createToonMaterial(mainColor, {
      map: createWoodPlankTexture({ baseColor: mainColor, grainColor: accentColor, repeatX: 1, repeatY: 3 }),
    });
    const accentMat = createToonMaterial(accentColor);
    const embMat = createToonMaterial(emblemColor);
    const darkStone = createToonMaterial('#4f4a43', {
      map: createCutStoneTexture({ baseColor: '#5b564e', mortarColor: '#2c2924', repeatX: 2, repeatY: 1 }),
    });

    const span = 4.6;
    const colH = 7.4;

    // Dos pilares laterales con basas escalonadas y columnas suaves de 18 lados
    for (const side of [-1, 1]) {
      const lx = side * span;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.85, colH, 18), mainMat);
      col.position.set(lx, colH / 2, 0);
      col.castShadow = true;
      col.receiveShadow = true;
      addOutline(col, 0.05, 0x181b20);

      const plinth = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.45, 2.1), darkStone);
      plinth.position.set(lx, 0.225, 0);
      addOutline(plinth, 0.035, 0x181b20);
      markNoCollision(plinth);

      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.12, 0.72, 18), accentMat);
      base.position.set(lx, 0.65, 0);
      addOutline(base, 0.04, 0x181b20);
      g.add(plinth, col, base);
      this.aimColliders.push(col, base);
      this.cameraColliders.push(col);

      // Posición mundial del pilar tras rotY
      const cos = Math.cos(rotY);
      const sin = Math.sin(rotY);
      const wx = x + lx * cos;
      const wz = z - lx * sin;
      this._registerCylinder(wx, wz, 0.92, 0, colH, { walkableTop: false });

      // Estandarte vertical colgante en cada columna mirando al exterior/interior
      const banner = new THREE.Mesh(new THREE.BoxGeometry(0.85, 2.4, 0.08), embMat);
      banner.position.set(lx - side * 1.15, 4.3, 0);
      addOutline(banner, 0.025, 0x181b20);
      markNoCollision(banner);
      g.add(banner);
      this._gateBanners.push({ mesh: banner, phase: side + x * 0.2 + z * 0.2 });
    }

    // Travesaño inferior (*nuki*) con cuñas laterales y cuña central (*gakuzuka*)
    const lowerBeam = new THREE.Mesh(new THREE.BoxGeometry(span * 2.55, 0.58, 0.88), mainMat);
    lowerBeam.position.y = 5.65;
    lowerBeam.castShadow = true;
    addOutline(lowerBeam, 0.05, 0x181b20);
    markNoCollision(lowerBeam);

    const centralStrut = new THREE.Mesh(new THREE.BoxGeometry(0.58, 1.65, 0.34), accentMat);
    centralStrut.position.y = 6.45;
    markNoCollision(centralStrut);

    // Dintel superior *kasagi* curvo de una sola pieza continua con extremos levantados (*sori*)
    const halfBeam = span * 1.68;
    const kasagiShape = new THREE.Shape();
    kasagiShape.moveTo(-halfBeam, 0.82);
    kasagiShape.quadraticCurveTo(0, 0.06, halfBeam, 0.82);
    kasagiShape.lineTo(halfBeam + 0.35, 1.54);
    kasagiShape.quadraticCurveTo(0, 0.82, -halfBeam - 0.35, 1.54);
    kasagiShape.closePath();

    const kasagiGeo = new THREE.ExtrudeGeometry(kasagiShape, {
      depth: 1.42,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.07,
      bevelSegments: 2,
      curveSegments: 20,
    });
    kasagiGeo.translate(0, 0, -0.71);
    const upperBeam = new THREE.Mesh(kasagiGeo, accentMat);
    upperBeam.position.y = 7.05;
    upperBeam.castShadow = true;
    addOutline(upperBeam, 0.055, 0x181b20);
    markNoCollision(upperBeam);

    // Medallón elemental central enmarcado
    const plaque = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.45, 20), embMat);
    plaque.rotation.x = Math.PI / 2;
    plaque.position.set(0, 6.45, 0);
    addOutline(plaque, 0.04, 0x1a1a1a);
    markNoCollision(plaque);

    g.add(lowerBeam, centralStrut, upperBeam, plaque);
    if (element === 'water') {
      const fin = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.25, 10, 20, Math.PI), embMat);
      fin.position.set(0, 8.05, 0);
      markNoCollision(fin);
      g.add(fin);
    }

    this.group.add(g);
  }

  // ====================================================================
  //  Props ambientales a ras de piso (faroles de piedra, arbustos, juncos)
  // ====================================================================
  _buildEnvironmentalProps() {
    // Faroles de piedra tradicionales a lo largo de las 4 calzadas principales
    const lanternSpots = [
      [-5.2, -16, '#c8f090'], [5.2, -16, '#c8f090'],
      [-5.2, -32, '#c8f090'], [5.2, -32, '#c8f090'],
      [16, -5.2, '#ffb668'], [16, 5.2, '#ffb668'],
      [31, -5.2, '#ffb668'], [31, 5.2, '#ffb668'],
      [-16, -5.2, '#9ce8ff'], [-16, 5.2, '#9ce8ff'],
      [-5.2, 16, '#fff2b0'], [5.2, 16, '#fff2b0'],
      [-5.2, 32, '#fff2b0'], [5.2, 32, '#fff2b0'],
    ];
    for (const [lx, lz, col] of lanternSpots) {
      const lantern = createStonePathLantern(col);
      lantern.position.set(lx, 0, lz);
      this.group.add(lantern);
    }

    // Grupos de arbustos estilizados y vegetación Cel-Shaded junto a esquinas, jardines y muros
    const bushSpots = [
      [-11, -18, 1.05, 'earth'], [11, -18, 1.05, 'earth'],
      [-21, -24, 1.2, 'earth'], [21, -24, 1.2, 'earth'],
      [-34, -52, 1.25, 'earth'], [34, -52, 1.25, 'earth'],
      [-18, -14, 0.95, 'water'], [-18, 14, 0.95, 'water'],
      [-52, -30, 1.15, 'water'], [-52, 30, 1.15, 'water'],
      [-26, 26, 1.05, 'air'], [26, 26, 1.05, 'air'],
      [-12, 48, 1.15, 'air'], [12, 48, 1.15, 'air'],
    ];
    bushSpots.forEach(([bx, bz, sc, tone], idx) => {
      const bush = createStylizedBush(sc, 200 + idx * 23, tone);
      bush.position.set(bx, 0, bz);
      this.group.add(bush);
    });
  }

  // ====================================================================
  //  8. Barriles destructibles torneados con textura de madera y aros metálicos
  // ====================================================================
  _buildBarrels() {
    const spots = [
      // Tierra
      [-10.5, -24], [10.5, -24], [-14, -42], [14, -42],
      // Fuego
      [23, -10], [23, 10], [34, -14], [34, 14],
      // Agua
      [-21, -8], [-21, 8], [-40, -28], [-39, 28],
      // Aire
      [-12, 26], [12, 26], [-8, 44], [8, 44],
    ];

    spots.forEach(([x, z], idx) => {
      const radius = 0.62;
      const height = 1.25;
      const bGroup = createTurnedBarrelMesh(radius, height, idx % 2 === 1);
      bGroup.position.set(x, 0, z);
      bGroup.rotation.y = idx * 0.7;

      this.group.add(bGroup);
      bGroup.traverse((o) => {
        if (o.isMesh && !this.aimColliders.includes(o)) {
          this.aimColliders.push(o);
        }
      });

      this.barrels.push({
        id: idx,
        mesh: bGroup,
        position: new THREE.Vector3(x, 0, z),
        radius,
        height,
        hp: 15,
        maxHp: 15,
        alive: true,
      });
    });
  }

  restoreBarrels() {
    for (const b of this.barrels) {
      b.hp = b.maxHp;
      b.alive = true;
      b.mesh.visible = true;
      b.mesh.traverse((o) => {
        if (o.isMesh && !this.aimColliders.includes(o)) {
          this.aimColliders.push(o);
        }
      });
    }
  }

  resetDestructibles() {
    this.restoreBarrels();
  }

  _breakBarrel(barrel, fromNetwork = false) {
    if (!barrel.alive) return;
    barrel.alive = false;
    barrel.hp = 0;
    barrel.mesh.visible = false;
    barrel.mesh.traverse((o) => {
      if (o.isMesh) {
        const idx = this.aimColliders.indexOf(o);
        if (idx >= 0) this.aimColliders.splice(idx, 1);
      }
    });
    if (this.vfx && this.vfx.spawnWoodDebris) {
      this.vfx.spawnWoodDebris(barrel.position);
    }
    if (this.sound && this.sound.playWoodBreak) {
      this.sound.playWoodBreak();
    }
    if (!fromNetwork && this.onBarrelBreak) {
      this.onBarrelBreak(barrel.id);
    }
  }

  breakBarrelById(barrelId) {
    const b = this.barrels.find((item) => item && item.id === barrelId);
    if (b) this._breakBarrel(b, true);
  }

  damageBarrel(barrel, amount = 15) {
    if (!barrel || !barrel.alive) return false;
    if (this.barrelsPassive) {
      if (this.vfx) {
        this.vfx.spawnDust(barrel.position.clone().setY(0.6), {
          count: 4,
          size: 0.4,
          speed: 1.6,
          color: '#d9c29c',
        });
      }
      return false;
    }
    barrel.hp -= amount;
    if (barrel.hp <= 0) {
      this._breakBarrel(barrel);
      return true;
    }
    if (this.vfx) {
      this.vfx.spawnDust(barrel.position.clone().setY(0.6), {
        count: 5,
        size: 0.45,
        speed: 2.0,
        color: '#d9c29c',
      });
    }
    return false;
  }

  testBarrelSphere(pos, radius, damage = 15) {
    for (const b of this.barrels) {
      if (!b.alive) continue;
      if (pos.y - radius > b.height + 0.08 || pos.y + radius < -0.1) continue;
      const dx = pos.x - b.position.x;
      const dz = pos.z - b.position.z;
      const d = Math.hypot(dx, dz);
      if (d <= b.radius + radius) {
        const nx = d > 1e-4 ? dx / d : 0;
        const nz = d > 1e-4 ? dz / d : 1;
        this.damageBarrel(b, damage);
        return {
          type: 'barrel',
          barrel: b,
          point: new THREE.Vector3(
            b.position.x + nx * b.radius,
            THREE.MathUtils.clamp(pos.y, 0.2, b.height),
            b.position.z + nz * b.radius
          ),
          normal: new THREE.Vector3(nx, 0.25, nz).normalize(),
        };
      }
    }
    return null;
  }

  damageBarrelsInSphere(center, radius, damage = 15) {
    for (const b of this.barrels) {
      if (!b.alive) continue;
      if (center.y - radius > b.height + 0.15 || center.y + radius < -0.2) continue;
      if (Math.hypot(center.x - b.position.x, center.z - b.position.z) <= b.radius + radius) {
        this.damageBarrel(b, damage);
      }
    }
  }

  // ====================================================================
  //  Interfaz Unificada de Escenario (Física, Colisiones, Spawns)
  // ====================================================================

  addObstacle(obstacle) {
    this.obstacles.add(obstacle);
  }

  removeObstacle(obstacle) {
    this.obstacles.delete(obstacle);
  }

  getRaycastTargets() {
    return this.aimColliders;
  }

  getBoundsRadius() {
    return ElementalMap.PLAYABLE_HALF;
  }

  isOutOfBounds(x, z, margin = 0) {
    const limit = ElementalMap.HALF_SIZE - margin;
    return Math.abs(x) > limit || Math.abs(z) > limit;
  }

  clampToPlayableArea(pos, margin = 1.1) {
    const limit = ElementalMap.PLAYABLE_HALF - margin;
    pos.x = THREE.MathUtils.clamp(pos.x, -limit, limit);
    pos.z = THREE.MathUtils.clamp(pos.z, -limit, limit);
    return pos;
  }

  getPillarAt(x, z, margin = 0) {
    for (const c of this.cylColliders) {
      if (Math.hypot(x - c.x, z - c.z) <= c.radius + margin) {
        return { x: c.x, z: c.z, radius: c.radius, top: c.maxY };
      }
    }
    for (const b of this.boxColliders) {
      if (
        x >= b.minX - margin &&
        x <= b.maxX + margin &&
        z >= b.minZ - margin &&
        z <= b.maxZ + margin
      ) {
        return {
          x: (b.minX + b.maxX) / 2,
          z: (b.minZ + b.maxZ) / 2,
          radius: Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5,
          top: b.maxY,
        };
      }
    }
    return null;
  }

  isObstacleAt(x, z, margin = 0) {
    return this.getPillarAt(x, z, margin) !== null;
  }

  /** Puntos de interés táctico (patrulla y navegación hacia el centro/distritos/puentes) */
  getPatrolPoints() {
    if (!this._patrolPoints) {
      this._patrolPoints = [
        // Plaza del Árbol Espíritu (anillo caminable)
        new THREE.Vector3(0, 0.6, 8.5),
        new THREE.Vector3(8.5, 0.6, 0),
        new THREE.Vector3(0, 0.6, -8.5),
        new THREE.Vector3(-8.5, 0.6, 0),
        // Entradas principales de los 4 distritos
        new THREE.Vector3(0, 0, -21),
        new THREE.Vector3(21, 0, 0),
        new THREE.Vector3(-21, 0, 0),
        new THREE.Vector3(0, 0, 21),
        // Puentes elevados del Distrito Agua
        new THREE.Vector3(-33, 0.48, -15),
        new THREE.Vector3(-33, 0.48, 15),
        new THREE.Vector3(-45, 0.48, 0),
        // Azoteas y terrazas accesibles por rampa
        new THREE.Vector3(-14, 2.5, -34),
        new THREE.Vector3(14, 2.5, -34),
        new THREE.Vector3(45, 2.1, 0),
        // Patio del Aire
        new THREE.Vector3(0, 0, 36),
      ];
    }
    return this._patrolPoints;
  }

  /**
   * Verifica línea de visión despejada a la altura del torso (`y + 1.1`) entre dos puntos,
   * detectando edificios, columnas, pagoda y murallas sólidas.
   */
  hasLineOfSight(fromPos, toPos) {
    const ax = fromPos.x;
    const ay = fromPos.y + 1.1;
    const az = fromPos.z;
    const bx = toPos.x;
    const by = toPos.y + 1.1;
    const bz = toPos.z;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1e-4) return true;

    // 1. Edificios, muros de cobertura y murallas (AABB)
    for (const box of this.boxColliders) {
      if (!box.blocksProjectile) continue;
      if (_segmentIntersectsAABB(ax, ay, az, dx, dy, dz, box.minX, box.maxX, box.minY, box.maxY, box.minZ, box.maxZ)) {
        return false;
      }
    }

    // 2. Columnas, tronco del árbol central y pilares
    const horizLen2 = dx * dx + dz * dz;
    if (horizLen2 > 1e-4) {
      for (const c of this.cylColliders) {
        if (!c.blocksProjectile) continue;
        const t = THREE.MathUtils.clamp(((c.x - ax) * dx + (c.z - az) * dz) / horizLen2, 0, 1);
        const cx = ax + dx * t;
        const cz = az + dz * t;
        const cy = ay + dy * t;
        if (cy >= c.minY && cy <= c.maxY && Math.hypot(c.x - cx, c.z - cz) <= c.radius * 0.94) {
          return false;
        }
      }
    }

    return true;
  }

  isWaterAt(x, y, z) {
    if (y > 0.22) return false;
    for (const wz of this.waterZones) {
      if (x >= wz.minX && x <= wz.maxX && z >= wz.minZ && z <= wz.maxZ) {
        return true;
      }
    }
    return false;
  }

  getGroundHeightAt(x, currentY, z) {
    const H = ElementalMap.HALF_SIZE;
    if (Math.abs(x) > H || Math.abs(z) > H) return -Infinity;

    let ground = 0;

    // Plaza central elevada (r <= 11.4 en 0.6, escalón r <= 13.6 en 0.3)
    const r = Math.hypot(x, z);
    if (r <= 11.4 && currentY >= 0.6 - 0.45) {
      ground = Math.max(ground, 0.6);
    } else if (r > 11.4 && r <= 13.6 && currentY >= 0.3 - 0.45) {
      ground = Math.max(ground, 0.3);
    }

    // Rampas / escaleras de acceso a techos, pagoda y puentes
    for (const rm of this.ramps) {
      if (x >= rm.minX && x <= rm.maxX && z >= rm.minZ && z <= rm.maxZ) {
        let t = 0;
        if (rm.axis === 'x') {
          t = (x - rm.minX) / Math.max(0.01, rm.maxX - rm.minX);
        } else {
          t = (z - rm.minZ) / Math.max(0.01, rm.maxZ - rm.minZ);
        }
        if (rm.dirSign < 0) t = 1 - t;
        t = THREE.MathUtils.clamp(t, 0, 1);
        const rampY = rm.yLow + (rm.yHigh - rm.yLow) * t;
        if (currentY >= rampY - 0.55) {
          ground = Math.max(ground, rampY);
        }
      }
    }

    // Superficies caminables de edificios, puentes y terrazas
    for (const b of this.boxColliders) {
      if (!b.walkableTop) continue;
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
        if (currentY >= b.maxY - b.tolerance - 0.12) {
          ground = Math.max(ground, b.maxY);
        }
      }
    }

    // Obstáculos dinámicos (muros de tierra del jugador/IA)
    for (const o of this.obstacles) {
      ground = Math.max(ground, o.getTopAt(x, z, currentY));
    }

    return ground;
  }

  getGroundHeight(x, z, prevY) {
    return this.getGroundHeightAt(x, prevY, z);
  }

  getSafeRespawnPosition(fighters = [], excludeId = null) {
    const candidates = this.getSpawnPoints(7);
    for (const c of candidates) {
      let occupied = false;
      for (const f of fighters) {
        if (!f || !f.isAlive || f.id === excludeId) continue;
        if (Math.hypot(f.position.x - c.x, f.position.z - c.z) < 2.2) {
          occupied = true;
          break;
        }
      }
      if (!occupied) return c.clone();
    }
    return candidates[0].clone();
  }

  getSpawnPoints(count = 4) {
    // Posiciones distribuidas entre la explanada central, los 4 distritos y diagonales seguras
    const presets = [
      new THREE.Vector3(0, 0, 26),     // Jugador: Patio del Aire (mirando hacia el Árbol)
      new THREE.Vector3(0, 0, -25),    // Distrito Tierra Norte
      new THREE.Vector3(26, 0, 0),     // Distrito Fuego Este
      new THREE.Vector3(-23, 0, 0),    // Distrito Agua Oeste
      new THREE.Vector3(20, 0, -24),   // Noreste Tierra-Fuego
      new THREE.Vector3(-22, 0, 28),   // Suroeste Agua-Aire
      new THREE.Vector3(24, 0, 25),    // Sureste Fuego-Aire
    ];
    return presets.slice(0, Math.max(1, Math.min(presets.length, count))).map((p) => p.clone());
  }

  resolveCollisions(pos, radius, arg3, arg4) {
    let vel = null;
    let prevY = pos.y;
    if (typeof arg3 === 'number') {
      prevY = arg3;
      vel = arg4 || null;
    } else {
      vel = arg3 || null;
      prevY = arg4 !== undefined ? arg4 : pos.y;
    }

    // 1. Bordes del mapa cerrado (-56.8..+56.8)
    const wallLimit = ElementalMap.PLAYABLE_HALF - radius;
    if (pos.x < -wallLimit) {
      pos.x = -wallLimit;
      if (vel && vel.x < 0) vel.x = 0;
    } else if (pos.x > wallLimit) {
      pos.x = wallLimit;
      if (vel && vel.x > 0) vel.x = 0;
    }
    if (pos.z < -wallLimit) {
      pos.z = -wallLimit;
      if (vel && vel.z < 0) vel.z = 0;
    } else if (pos.z > wallLimit) {
      pos.z = wallLimit;
      if (vel && vel.z > 0) vel.z = 0;
    }

    // 2. Escalones de la plaza central si el personaje viene desde abajo sin saltar
    const r = Math.hypot(pos.x, pos.z);
    if (prevY < -0.05 && r < 13.6 + radius) {
      // Nada especial bajo y = 0
    }

    // 3. Cajas sólidas (edificios, muros, pagoda, bloques laterales)
    for (const b of this.boxColliders) {
      if (prevY >= b.maxY - b.tolerance) continue;
      if (pos.y + 1.8 < b.minY) continue;

      const cx = THREE.MathUtils.clamp(pos.x, b.minX, b.maxX);
      const cz = THREE.MathUtils.clamp(pos.z, b.minZ, b.maxZ);
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d = Math.hypot(dx, dz);

      if (d > 1e-6 && d < radius) {
        const nx = dx / d;
        const nz = dz / d;
        const push = radius - d;
        pos.x += nx * push;
        pos.z += nz * push;
        if (vel) {
          const vn = vel.x * nx + vel.z * nz;
          if (vn < 0) {
            vel.x -= vn * nx;
            vel.z -= vn * nz;
          }
        }
      } else if (d <= 1e-6) {
        const dl = Math.abs(pos.x - b.minX);
        const dr = Math.abs(b.maxX - pos.x);
        const db = Math.abs(pos.z - b.minZ);
        const df = Math.abs(b.maxZ - pos.z);
        const m = Math.min(dl, dr, db, df);
        if (m === dl) { pos.x = b.minX - radius; if (vel && vel.x > 0) vel.x = 0; }
        else if (m === dr) { pos.x = b.maxX + radius; if (vel && vel.x < 0) vel.x = 0; }
        else if (m === db) { pos.z = b.minZ - radius; if (vel && vel.z > 0) vel.z = 0; }
        else { pos.z = b.maxZ + radius; if (vel && vel.z < 0) vel.z = 0; }
      }
    }

    // 4. Cilindros sólidos (tronco Bonsái, postes de plaza, columnas de puertas/pabellones, braseros)
    for (const c of this.cylColliders) {
      if (prevY >= c.maxY - 0.15) continue;
      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      const dist = Math.hypot(dx, dz);
      const minDist = c.radius + radius;
      if (dist < minDist && dist > 1e-5) {
        const nx = dx / dist;
        const nz = dz / dist;
        pos.x = c.x + nx * minDist;
        pos.z = c.z + nz * minDist;
        if (vel) {
          const vn = vel.x * nx + vel.z * nz;
          if (vn < 0) {
            vel.x -= vn * nx;
            vel.z -= vn * nz;
          }
        }
      }
    }

    // 5. Barriles destructibles
    for (const b of this.barrels) {
      if (!b.alive) continue;
      if (prevY >= b.height - 0.08) continue;
      const dx = pos.x - b.position.x;
      const dz = pos.z - b.position.z;
      const dist = Math.hypot(dx, dz);
      const minDist = b.radius + radius;
      if (dist < minDist && dist > 1e-5) {
        const nx = dx / dist;
        const nz = dz / dist;
        pos.x = b.position.x + nx * minDist;
        pos.z = b.position.z + nz * minDist;
        if (vel) {
          const vn = vel.x * nx + vel.z * nz;
          if (vn < 0) {
            vel.x -= vn * nx;
            vel.z -= vn * nz;
          }
        }
      }
    }

    // 6. Obstáculos dinámicos (muros elementales)
    for (const o of this.obstacles) o.resolveCylinder(pos, radius, vel, prevY);
  }

  /** Colisión de proyectiles / ondas contra barriles, edificios, pilares, rampas y suelo */
  checkProjectileHit(pos, radius, barrelDamage = 15) {
    const bHit = this.testBarrelSphere(pos, radius, barrelDamage);
    if (bHit) return bHit;

    // Colisión contra cajas sólidas (edificios, murallas, muros de cobertura)
    for (const b of this.boxColliders) {
      if (!b.blocksProjectile) continue;
      const cx = THREE.MathUtils.clamp(pos.x, b.minX, b.maxX);
      const cy = THREE.MathUtils.clamp(pos.y, b.minY, b.maxY);
      const cz = THREE.MathUtils.clamp(pos.z, b.minZ, b.maxZ);
      const dx = pos.x - cx;
      const dy = pos.y - cy;
      const dz = pos.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= radius * radius) {
        const n = new THREE.Vector3(dx, dy, dz);
        if (n.lengthSq() > 1e-6) n.normalize();
        else n.set(0, 1, 0);
        return {
          type: 'building',
          point: new THREE.Vector3(cx, cy, cz),
          normal: n,
        };
      }
    }

    // Cilindros (árbol central, columnas de puertas y pabellones, braseros)
    for (const c of this.cylColliders) {
      if (!c.blocksProjectile) continue;
      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d <= c.radius + radius && pos.y - radius <= c.maxY && pos.y + radius >= c.minY) {
        const nx = d > 1e-5 ? dx / d : 1;
        const nz = d > 1e-5 ? dz / d : 0;
        return {
          type: 'pillar',
          pillar: c,
          point: new THREE.Vector3(c.x + nx * c.radius, THREE.MathUtils.clamp(pos.y, c.minY, c.maxY), c.z + nz * c.radius),
          normal: new THREE.Vector3(nx, 0, nz),
        };
      }
    }

    // Plaza central y suelo general
    const groundY = this.getGroundHeightAt(pos.x, pos.y + 0.5, pos.z);
    if (Number.isFinite(groundY) && pos.y - radius <= groundY && pos.y >= -1.5) {
      return {
        type: 'floor',
        point: new THREE.Vector3(pos.x, groundY, pos.z),
        normal: new THREE.Vector3(0, 1, 0),
      };
    }

    return null;
  }

  setEdgeDanger() {
    // El Santuario está amurallado: no hay borde mortal
  }

  update(dt, cameraPosition) {
    this._time += dt;
    if (this._atmosphere) {
      this._atmosphere.update(dt, cameraPosition);
    }

    // Parpadeo vivo de las llamas en los pebeteros de Fuego
    for (const br of this._braziers) {
      const f = Math.sin(this._time * 13.5 + br.phase) * 0.14 + Math.cos(this._time * 21 + br.phase) * 0.08;
      if (br.flameGroup) {
        br.flameGroup.scale.set(1 + f * 0.36, 1 + f * 0.82, 1 + f * 0.36);
        br.flameGroup.rotation.y += dt * 1.9;
      }
    }

    // Corriente continua en los canales de agua
    if (this._waterTex) {
      this._waterTex.offset.x = (this._waterTex.offset.x + dt * 0.045) % 1;
      this._waterTex.offset.y = (this._waterTex.offset.y + dt * 0.015) % 1;
    }

    // Humo ascendente suave de los 2 volcanes del horizonte Este
    for (const sm of this._smokePuffs) {
      const cycle = (this._time * 0.18 + sm.phase) % 1;
      sm.mesh.position.y = sm.baseY + cycle * sm.heightSpan;
      sm.mesh.position.x = sm.baseX + Math.sin(this._time * 0.7 + sm.phase * 4) * 1.6;
      const sc = 0.75 + cycle * 1.1;
      sm.mesh.scale.setScalar(sc);
      sm.mesh.rotation.y += dt * 0.35;
    }

    // Flote suave de las 7 islas aéreas del Patio Sur
    for (const isl of this._skyIslands) {
      isl.group.position.y = isl.baseY + Math.sin(this._time * 0.55 + isl.phase) * 0.7;
    }

    // Pulso sereno de faroles, lianas y polen alrededor del Árbol Espíritu
    for (const sp of this._spiritOrbs) {
      const p = 1 + Math.sin(this._time * 2.8 + sp.phase) * 0.08;
      sp.halo.scale.setScalar(p * 1.12);
    }
    for (const vn of this._treeVines) {
      vn.pivot.rotation.z = Math.sin(this._time * 1.35 + vn.phase) * 0.08;
      vn.pivot.rotation.x = Math.cos(this._time * 1.05 + vn.phase) * 0.05;
    }
    for (const mt of this._treeMotes) {
      const ang = this._time * mt.speed + mt.phase;
      mt.mesh.position.set(
        Math.cos(ang) * mt.radius,
        mt.baseY + Math.sin(this._time * 1.4 + mt.phase) * 0.55,
        Math.sin(ang) * mt.radius
      );
      mt.mesh.rotation.y += dt * 1.5;
    }

    // Ondulación suave de estandartes y banderines con la brisa
    for (const gb of this._gateBanners) {
      gb.mesh.rotation.x = Math.sin(this._time * 2.2 + gb.phase) * 0.09;
    }
    for (const fl of this._prayerFlags) {
      fl.mesh.rotation.x = 0.12 + Math.sin(this._time * 3.8 + fl.phase) * 0.16;
    }
  }
}

// ====================================================================
//  Textura procedural Cel-Shaded de baldosas, calzadas y Mandala del Aire
// ====================================================================
function createSanctuaryFloorTexture() {
  const size = 1024;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const g = cv.getContext('2d');
  const rng = mulberry32(404);

  const scale = size / 116;
  const c = size / 2;

  // Fondo neutro piedra arenisca cálida
  g.fillStyle = '#e7d5af';
  g.fillRect(0, 0, size, size);

  // Norte (Z < -16): Distrito Tierra — arenisca cálida y parches de hierba olivo
  g.fillStyle = '#dec48c';
  g.fillRect(0, 0, size, c - 14 * scale);
  for (let i = 0; i < 46; i++) {
    const gx = rng() * size;
    const gy = rng() * (c - 18 * scale);
    g.fillStyle = rng() > 0.4 ? 'rgba(92, 146, 68, 0.54)' : 'rgba(130, 168, 86, 0.44)';
    g.beginPath();
    g.ellipse(gx, gy, (1.8 + rng() * 4.5) * scale, (1.4 + rng() * 3.5) * scale, rng() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }

  // Este (X > 16): Distrito Fuego — losas terracota y acentos ocres
  g.fillStyle = '#d9986a';
  g.fillRect(c + 14 * scale, 0, size - (c + 14 * scale), size);
  g.fillStyle = 'rgba(235, 178, 92, 0.36)';
  g.beginPath();
  g.arc(c + 42 * scale, c, 20 * scale, 0, Math.PI * 2);
  g.fill();

  // Oeste (X < -16): Distrito Agua — losas claras azul-marfil
  g.fillStyle = '#dce6ef';
  g.fillRect(0, c - 36 * scale, c - 14 * scale, 72 * scale);

  // Sur (Z > 16): Patio del Aire — explanada amplia dorada brillante
  g.fillStyle = '#eed38b';
  g.fillRect(0, c + 14 * scale, size, size - (c + 14 * scale));

  // Variación sutil de baldosas por tono en toda la superficie (Cel-Shaded tiles)
  const tilePx = 4.0 * scale;
  for (let gx = 0; gx < size; gx += tilePx) {
    for (let gy = 0; gy < size; gy += tilePx) {
      if (rng() > 0.65) {
        g.fillStyle = rng() > 0.5 ? 'rgba(255, 252, 240, 0.08)' : 'rgba(65, 50, 34, 0.06)';
        g.fillRect(gx + 1, gy + 1, tilePx - 2, tilePx - 2);
      }
    }
  }

  // Gran Mandala / Espiral ornamental incrustado en el Patio del Aire (Z = +35)
  const mx = c;
  const my = c + 35 * scale;
  g.save();
  g.translate(mx, my);
  g.strokeStyle = 'rgba(62, 168, 166, 0.55)';
  g.lineWidth = 6;
  for (const r of [11.5 * scale, 8.2 * scale, 4.4 * scale]) {
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
  }
  // 3 espirales de viento de las Naciones del Aire
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(42, 128, 128, 0.62)';
  for (let i = 0; i < 3; i++) {
    g.save();
    g.rotate((i * Math.PI * 2) / 3);
    g.beginPath();
    g.arc(0, -6.2 * scale, 2.7 * scale, 0, Math.PI * 1.48);
    g.stroke();
    g.restore();
  }
  // Pétalos radiales en contraste dorado
  g.strokeStyle = 'rgba(182, 128, 34, 0.45)';
  g.lineWidth = 3;
  for (let p = 0; p < 8; p++) {
    const a = (p / 8) * Math.PI * 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * 4.5 * scale, Math.sin(a) * 4.5 * scale);
    g.lineTo(Math.cos(a) * 11.4 * scale, Math.sin(a) * 11.4 * scale);
    g.stroke();
  }
  g.restore();

  // Calzadas principales de piedra tallada con bordillos oscuros/claros conectando los 4 distritos
  const roadW = 8.4 * scale;
  const drawRoad = (x, y, w, h, vertical) => {
    g.fillStyle = '#cfbfa2';
    g.fillRect(x, y, w, h);
    g.fillStyle = '#9c8c72';
    if (vertical) {
      g.fillRect(x, y, 0.7 * scale, h);
      g.fillRect(x + w - 0.7 * scale, y, 0.7 * scale, h);
    } else {
      g.fillRect(x, y, w, 0.7 * scale);
      g.fillRect(x, y + h - 0.7 * scale, w, 0.7 * scale);
    }
  };
  drawRoad(c - roadW / 2, 4 * scale, roadW, size - 8 * scale, true);
  drawRoad(4 * scale, c - roadW / 2, size - 8 * scale, roadW, false);

  // Anillo exterior tallado bordeando la Plaza Central
  g.strokeStyle = 'rgba(112, 96, 74, 0.72)';
  g.lineWidth = 7;
  g.beginPath();
  g.arc(c, c, 15.2 * scale, 0, Math.PI * 2);
  g.stroke();

  // Juntas crisp de baldosas de piedra en todo el mapa
  g.strokeStyle = 'rgba(66, 56, 44, 0.16)';
  g.lineWidth = 2;
  for (let p = 0; p < size; p += tilePx) {
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, size);
    g.stroke();
    g.beginPath();
    g.moveTo(0, p);
    g.lineTo(size, p);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function _segmentIntersectsAABB(ax, ay, az, dx, dy, dz, minX, maxX, minY, maxY, minZ, maxZ) {
  let tmin = 0.01;
  let tmax = 0.99;
  const axes = [
    [ax, dx, minX, maxX],
    [ay, dy, minY, maxY],
    [az, dz, minZ, maxZ],
  ];
  for (const [o, d, mn, mx] of axes) {
    if (Math.abs(d) < 1e-6) {
      if (o < mn || o > mx) return false;
    } else {
      let t1 = (mn - o) / d;
      let t2 = (mx - o) / d;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return tmax > tmin;
}
