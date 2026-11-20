import * as THREE from 'three';
import { createToonMaterial, addOutline } from '../utils/ToonMaterial.js';
import { createAtmosphereSystem } from './SkyAndAtmosphere.js';
import { createTurnedBarrelMesh, markNoCollision } from './SanctuaryProps.js';
import { createColiseumFloorTextures, createCutStoneTexture } from '../utils/ProceduralTextures.js';
import { createLayeredFlame } from '../utils/FlameGeometry.js';

/**
 * Arena
 * ------------------------------------------------------------
 * Plataforma circular de piedra tallada suspendida sobre un abismo,
 * rodeada por un Coliseo monumental con arcadas, columnas torneadas,
 * graderíos escalonados, pebeteros encendidos y 4 estandartes elementales.
 *  - Superficie superior en y = 0, radio 30, grosor 3.
 *  - Plataforma central levemente elevada (altura 0.65, radio 5.5) y
 *    2 plataformas laterales elevadas (altura 1.6, 7.5 × 9.0) con rampas de piedra.
 *  - 10 barriles de madera Cel-Shaded torneados y destructibles (hp 15).
 *  - 4 pilares monumentales con fuste tallado cerca del borde (obstáculos / cobertura).
 *  - Anillo de Coliseo exterior (radio ~62) con arcos, tribunas, pebeteros y estandartes.
 */
export class Arena {
  static RADIUS = 30;
  static HEIGHT = 3;

  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'Arena';
    scene.add(this.group);

    /** Datos de colisión de los pilares: { x, z, radius, top } */
    this.pillars = [];
    /** Plataformas elevadas laterales con rampas: { cx, halfX, halfZ, height, rampHalfX, rampEndZ } */
    this.platforms = [];
    /** Barriles destructibles de madera */
    this.barrels = [];
    this.barrelsPassive = false;
    this.onBarrelBreak = null;
    /** Meshes contra los que la cámara evita atravesar */
    this.cameraColliders = [];
    /** Meshes contra los que se calcula el punto de mira (suelo + plataformas + pilares + barriles) */
    this.aimColliders = [];
    /** Obstáculos dinámicos registrados (muros, etc.) */
    this.obstacles = new Set();
    /** Rocas flotantes decorativas animadas */
    this.floatingRocks = [];

    /** Referencias opcionales para VFX y audio al romper barriles */
    this.vfx = null;
    this.sound = null;
    /** Atmósfera y luces propias del escenario */
    this._atmosphere = null;
    this._lights = [];
    this._braziers = [];
    this.hasAbyss = true;
    this.supportsDangerRing = true;

    this._time = 0;

    this._setupAtmosphere();
    this._buildPlatform();
    this._buildElevatedTerrain();
    this._buildPillars();
    this._buildBarrels();
    this._buildColiseum();
    this._buildFloatingRocks();
  }

  /** Asigna referencias a VFXManager y SoundManager para efectos al romper barriles */
  setEffects(vfx, sound) {
    this.vfx = vfx;
    this.sound = sound;
  }

  // ============================================================
  //  Atmósfera: cúpula degradada, cordilleras, nubes y luz suave
  // ============================================================
  _setupAtmosphere() {
    this._atmosphere = createAtmosphereSystem(this.scene, 'coliseum');
    this.sky = this._atmosphere.skyDome;
    this.sun = this._atmosphere.sun;
    this._lights = this._atmosphere.lights;
    this._fog = this._atmosphere.fog;
    this._fogColor = this._atmosphere.fogColor;
    this.applyAtmosphere();
  }

  applyAtmosphere() {
    if (this._atmosphere) this._atmosphere.apply();
  }

  setVisible(visible) {
    this.group.visible = visible;
    if (this._atmosphere) this._atmosphere.setVisible(visible);
  }

  // ============================================================
  //  Plataforma principal
  // ============================================================
  _buildPlatform() {
    const R = Arena.RADIUS;
    const H = Arena.HEIGHT;

    // --- Superficie superior con textura procedural de losas radiales ---
    const { colorMap, bumpMap } = createColiseumFloorTextures(R);
    const topMat = new THREE.MeshStandardMaterial({
      map: colorMap,
      bumpMap,
      bumpScale: 2.0,
      roughness: 0.9,
      metalness: 0.0,
    });
    const top = new THREE.Mesh(new THREE.CircleGeometry(R, 128), topMat);
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    top.name = 'ArenaFloor';
    this.group.add(top);
    this.floor = top;
    this.aimColliders.push(top);

    // --- Lateral de sillería tallada + moldura inferior ---
    const sideCutTex = createCutStoneTexture({
      baseColor: '#6d7886',
      mortarColor: '#252b34',
      repeatX: 16,
      repeatY: 1,
    });
    const sideMat = new THREE.MeshStandardMaterial({
      map: sideCutTex,
      bumpMap: createRockTexture(),
      bumpScale: 2.4,
      roughness: 0.92,
      color: '#7d8896',
    });
    const side = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.97, H, 128, 1, true), sideMat);
    side.position.y = -H / 2;
    side.receiveShadow = true;
    side.castShadow = true;
    this.group.add(side);

    // Moldura del borde superior en contraste bronce/ocre cálido + ménsulas talladas bajo el borde
    const lipMat = createToonMaterial('#c89238');
    const lip = new THREE.Mesh(new THREE.TorusGeometry(R - 0.02, 0.16, 12, 128), lipMat);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = -0.09;
    lip.receiveShadow = true;
    this.group.add(lip);

    const corbelMat = createToonMaterial('#47515e');
    const corbelGeo = new THREE.BoxGeometry(0.95, 1.35, 0.85);
    const corbelCount = 32;
    for (let i = 0; i < corbelCount; i++) {
      const a = (i / corbelCount) * Math.PI * 2;
      const corbel = new THREE.Mesh(corbelGeo, corbelMat);
      corbel.position.set(Math.cos(a) * (R - 0.12), -0.95, Math.sin(a) * (R - 0.12));
      corbel.rotation.y = -a + Math.PI / 2;
      corbel.castShadow = true;
      corbel.receiveShadow = true;
      markNoCollision(corbel);
      this.group.add(corbel);
    }

    // Anillo luminoso de alerta de borde (Ring-Out danger pulse)
    const dangerGeo = new THREE.RingGeometry(R - 1.95, R - 0.15, 96, 1);
    dangerGeo.rotateX(-Math.PI / 2);
    this.dangerRingMat = new THREE.MeshBasicMaterial({
      color: '#ff2a1f',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const dangerRing = new THREE.Mesh(dangerGeo, this.dangerRingMat);
    dangerRing.position.y = 0.025;
    dangerRing.renderOrder = 1;
    this.group.add(dangerRing);
    this._dangerLevel = 0;

    // --- Base rocosa colgante (cono irregular hacia el abismo) ---
    const baseGeo = new THREE.ConeGeometry(R * 0.97, 18, 28, 6, true);
    jitterGeometry(baseGeo, 1.4, (v) => v.y > -8.9);
    baseGeo.computeVertexNormals();
    const baseMat = new THREE.MeshStandardMaterial({
      color: '#6e5a48',
      roughness: 1,
      flatShading: true,
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.rotation.x = Math.PI; // Punta hacia abajo
    base.position.y = -H - 9;
    this.group.add(base);
  }

  // ============================================================
  //  Relieve y Plataformas Elevadas con Rampas de Piedra
  // ============================================================
  _buildElevatedTerrain() {
    const platStoneTex = createCutStoneTexture({
      baseColor: '#7b8896',
      mortarColor: '#303945',
      repeatX: 4,
      repeatY: 2,
    });
    const stoneMat = createToonMaterial('#82909e', { map: platStoneTex });
    const stoneDarkMat = createToonMaterial('#566373', {
      map: createCutStoneTexture({
        baseColor: '#5c6978',
        mortarColor: '#28303b',
        repeatX: 4,
        repeatY: 1,
      }),
    });
    const ochreMat = createToonMaterial('#c89238');

    const terrainGroup = new THREE.Group();
    terrainGroup.name = 'ElevatedTerrain';

    // 1. Plataforma central esculpida con gradas suaves (altura 0.65, radio 5.5 + talud hasta r = 6.95)
    const centerGroup = new THREE.Group();
    const centerDeck = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 0.65, 36), stoneMat);
    centerDeck.position.y = 0.325;
    centerGroup.add(centerDeck);

    // Faldón en talud suave alrededor del centro para subir caminando sin trabas desde cualquier ángulo
    const centerSlope = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 6.95, 0.64, 36), stoneDarkMat);
    centerSlope.position.y = 0.32;
    centerGroup.add(centerSlope);

    // Molduras concéntricas doradas sobre la plataforma central
    const centerTrim = new THREE.Mesh(new THREE.TorusGeometry(5.46, 0.09, 10, 48), ochreMat);
    centerTrim.rotation.x = Math.PI / 2;
    centerTrim.position.y = 0.63;
    centerGroup.add(centerTrim);

    const innerInlay = new THREE.Mesh(new THREE.RingGeometry(3.05, 3.35, 36), ochreMat);
    innerInlay.rotation.x = -Math.PI / 2;
    innerInlay.position.y = 0.658;
    centerGroup.add(innerInlay);

    addOutline(centerGroup, 0.022, 0x1b2028);
    centerGroup.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        this.aimColliders.push(o);
      }
    });
    terrainGroup.add(centerGroup);

    // 2. Dos plataformas laterales elevadas simétricas (altura 1.6, ancho 7.5, largo 9.0) con rampas anchas Norte/Sur
    const sideHeight = 1.6;
    const widthX = 7.5;
    const lengthZ = 9.0;
    const rampHalfX = 2.85;
    const rampLen = 4.5;
    const halfZ = lengthZ * 0.5;
    const rampEndZ = halfZ + rampLen;

    // Geometría de rampa prismática biselada en YZ (base 0..rampLen -> alto 0..sideHeight)
    const rampShape = new THREE.Shape();
    rampShape.moveTo(0, 0);
    rampShape.lineTo(rampLen, 0);
    rampShape.lineTo(0, sideHeight);
    rampShape.closePath();
    const rampGeo = new THREE.ExtrudeGeometry(rampShape, {
      depth: rampHalfX * 2,
      bevelEnabled: false,
    });
    rampGeo.translate(0, 0, -rampHalfX);
    rampGeo.rotateY(-Math.PI / 2);

    const pilasterGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0, 0.0),
        new THREE.Vector2(0.56, 0.0),
        new THREE.Vector2(0.54, 0.2),
        new THREE.Vector2(0.4, 0.35),
        new THREE.Vector2(0.36, sideHeight - 0.22),
        new THREE.Vector2(0.5, sideHeight - 0.1),
        new THREE.Vector2(0.52, sideHeight + 0.05),
        new THREE.Vector2(0.0, sideHeight + 0.05),
      ],
      16
    );

    for (const sign of [-1, 1]) {
      const cx = sign * 15.5;
      const platGroup = new THREE.Group();
      platGroup.position.set(cx, 0, 0);

      // Bloque principal
      const deckMesh = new THREE.Mesh(new THREE.BoxGeometry(widthX, sideHeight, lengthZ), stoneMat);
      deckMesh.position.y = sideHeight * 0.5;
      platGroup.add(deckMesh);

      // Cornisa superior ocre y moldura media
      const capRim = new THREE.Mesh(new THREE.BoxGeometry(widthX + 0.2, 0.15, lengthZ + 0.2), ochreMat);
      capRim.position.y = sideHeight - 0.075;
      platGroup.add(capRim);

      // Zócalo inferior oscuro en la base
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(widthX + 0.36, 0.3, lengthZ + 0.36), stoneDarkMat);
      plinth.position.y = 0.15;
      platGroup.add(plinth);

      // 4 pilastras torneadas en las esquinas exteriores
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const pil = new THREE.Mesh(pilasterGeo, stoneDarkMat);
          pil.position.set(sx * (widthX * 0.5 - 0.08), 0, sz * (halfZ - 0.08));
          platGroup.add(pil);
        }
      }

      // Rampa Sur (+Z) y Rampa Norte (-Z)
      const rampSouth = new THREE.Mesh(rampGeo, stoneDarkMat);
      rampSouth.position.set(0, 0, halfZ);
      platGroup.add(rampSouth);

      const rampNorth = new THREE.Mesh(rampGeo, stoneDarkMat);
      rampNorth.position.set(0, 0, -halfZ);
      rampNorth.rotation.y = Math.PI;
      platGroup.add(rampNorth);

      // Muretes laterales inclinados (bordillos) flanqueando las rampas
      const curbLen = Math.hypot(rampLen, sideHeight);
      const curbPitch = Math.atan2(sideHeight, rampLen);
      for (const zDir of [1, -1]) {
        for (const xSide of [-1, 1]) {
          const curb = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, curbLen), stoneMat);
          curb.position.set(xSide * (rampHalfX + 0.12), sideHeight * 0.5 + 0.04, zDir * (halfZ + rampLen * 0.5));
          curb.rotation.x = zDir * curbPitch;
          platGroup.add(curb);
        }
      }

      // Peldaños visuales sobre las rampas para lectura Cel-Shaded de la pendiente
      for (let s = 0; s < 5; s++) {
        const u = (s + 0.5) / 5;
        const stepZ = halfZ + u * rampLen;
        const stepY = sideHeight * (1 - u);
        for (const zDir of [1, -1]) {
          const riser = new THREE.Mesh(new THREE.BoxGeometry(rampHalfX * 2 + 0.06, 0.07, 0.22), ochreMat);
          riser.position.set(0, stepY, zDir * stepZ);
          platGroup.add(riser);
        }
      }

      addOutline(platGroup, 0.025, 0x1b2028);
      platGroup.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          this.aimColliders.push(o);
          this.cameraColliders.push(o);
        }
      });

      terrainGroup.add(platGroup);
      this.platforms.push({
        cx,
        halfX: widthX * 0.5,
        halfZ,
        height: sideHeight,
        rampHalfX,
        rampEndZ,
      });
    }

    this.group.add(terrainGroup);
  }

  // ============================================================
  //  Pilares monumentales tallados (LatheGeometry + textura de sillería)
  // ============================================================
  _buildPillars() {
    const count = 4;
    const ringRadius = Arena.RADIUS - 6.5; // 23.5 u, simétrico a 45°..315° sin tapar plataformas ni spawns
    const rockMat = createToonMaterial('#6e7b8a', {
      map: createCutStoneTexture({
        baseColor: '#758291',
        mortarColor: '#2a313b',
        repeatX: 3,
        repeatY: 4,
      }),
    });
    const darkMat = createToonMaterial('#49535e');
    const ochreMat = createToonMaterial('#c89238');

    // Perfil torneado clásico con plinto, toro, fuste éntasis, collarín y equino
    const shaftGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0, 0.0),
        new THREE.Vector2(1.98, 0.0),
        new THREE.Vector2(1.98, 0.42),
        new THREE.Vector2(1.76, 0.56),
        new THREE.Vector2(1.82, 0.72),
        new THREE.Vector2(1.56, 0.92),
        new THREE.Vector2(1.52, 2.4),
        new THREE.Vector2(1.44, 4.4),
        new THREE.Vector2(1.32, 6.2),
        new THREE.Vector2(1.42, 6.38),
        new THREE.Vector2(1.66, 6.66),
        new THREE.Vector2(1.72, 6.95),
        new THREE.Vector2(0.0, 6.95),
      ],
      20
    );

    const ringGeo = new THREE.TorusGeometry(1.54, 0.085, 8, 24);
    ringGeo.rotateX(Math.PI / 2);

    const bowlGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0, 0.0),
        new THREE.Vector2(0.65, 0.0),
        new THREE.Vector2(0.55, 0.25),
        new THREE.Vector2(1.12, 0.62),
        new THREE.Vector2(1.18, 0.75),
        new THREE.Vector2(0.92, 0.75),
        new THREE.Vector2(0.75, 0.48),
        new THREE.Vector2(0.0, 0.48),
      ],
      18
    );

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(angle) * ringRadius;
      const z = Math.sin(angle) * ringRadius;

      const pillar = new THREE.Group();
      pillar.position.set(x, 0, z);
      pillar.rotation.y = angle;

      const shaft = new THREE.Mesh(shaftGeo, rockMat);
      pillar.add(shaft);

      const bandLow = new THREE.Mesh(ringGeo, ochreMat);
      bandLow.position.y = 0.88;
      const bandHigh = new THREE.Mesh(ringGeo, ochreMat);
      bandHigh.scale.setScalar(0.92);
      bandHigh.position.y = 6.22;
      pillar.add(bandLow, bandHigh);

      // Remate de pebetero de piedra en la cima del pilar
      const bowl = new THREE.Mesh(bowlGeo, darkMat);
      bowl.position.y = 6.95;
      pillar.add(bowl);

      const top = 6.95;

      // Piedras redondeadas de acento en la base (decoración sin colisión)
      const pebble = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 1), darkMat);
      pebble.scale.set(1.2, 0.72, 1.0);
      pebble.position.set(1.98, 0.22, 0.52);
      pebble.rotation.set(0.2, 0.8, 0.1);
      markNoCollision(pebble);
      pillar.add(pebble);

      pillar.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          this.cameraColliders.push(o);
          this.aimColliders.push(o);
        }
      });
      addOutline(pillar, 0.036, 0x161210);

      this.group.add(pillar);
      this.pillars.push({ x, z, radius: 1.6, top });
    }
  }

  // ============================================================
  //  Barriles de Madera Torneados y Destructibles (10 unidades)
  // ============================================================
  _buildBarrels() {
    const spots = [
      // Parejas cerca de los 4 pilares exteriores
      { x: 12.2, z: 12.8 },
      { x: 13.4, z: 12.0 },
      { x: -12.4, z: 12.6 },
      { x: -13.6, z: 11.8 },
      { x: 12.4, z: -12.6 },
      { x: 13.6, z: -11.9 },
      { x: -12.2, z: -12.8 },
      { x: -13.4, z: -12.0 },
      // Pareja flanqueando las plataformas laterales elevadas
      { x: 9.6, z: 2.2 },
      { x: -9.6, z: -2.2 },
    ];

    const h = 1.15;
    const r = 0.48;

    spots.forEach((pt, idx) => {
      const bGroup = createTurnedBarrelMesh(r, h, idx % 2 === 1);
      bGroup.name = `Barrel_${idx}`;
      bGroup.position.set(pt.x, 0, pt.z);
      bGroup.rotation.y = idx * 0.85;

      bGroup.traverse((o) => {
        if (o.isMesh) {
          this.aimColliders.push(o);
        }
      });

      this.group.add(bGroup);
      this.barrels.push({
        id: idx,
        mesh: bGroup,
        position: bGroup.position,
        radius: r + 0.04,
        height: h,
        hp: 15,
        maxHp: 15,
        alive: true,
      });
    });
  }

  /** Restaura todos los barriles destructibles al iniciar o reiniciar etapa */
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

  /** Destruye un barril por ID cuando el Host replica `BARREL_DESTROYED` */
  breakBarrelById(barrelId) {
    const b = this.barrels.find((item) => item && item.id === barrelId);
    if (b) this._breakBarrel(b, true);
  }

  /** Daña un barril concreto y lo destruye si su vida llega a 0 */
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

  /** Comprueba si una esfera (p. ej. proyectil) impacta contra algún barril intacto */
  testBarrelSphere(pos, radius, damage = 15) {
    for (const b of this.barrels) {
      if (!b.alive) continue;
      if (pos.y - radius > b.height + 0.08 || pos.y + radius < -0.1) continue;
      const dx = pos.x - b.position.x;
      const dz = pos.z - b.position.z;
      const d = Math.hypot(dx, dz);
      const minDist = b.radius + radius;
      if (d <= minDist) {
        const nx = d > 1e-4 ? dx / d : 0;
        const nz = d > 1e-4 ? dz / d : 1;
        this.damageBarrel(b, damage);
        return {
          type: 'barrel',
          barrel: b,
          point: new THREE.Vector3(b.position.x + nx * b.radius, THREE.MathUtils.clamp(pos.y, 0.2, b.height), b.position.z + nz * b.radius),
          normal: new THREE.Vector3(nx, 0.25, nz).normalize(),
        };
      }
    }
    return null;
  }

  /** Daña todos los barriles dentro de un radio esférico (para ondas, abanicos, tornados o dash) */
  damageBarrelsInSphere(center, radius, damage = 15) {
    for (const b of this.barrels) {
      if (!b.alive) continue;
      if (center.y - radius > b.height + 0.15 || center.y + radius < -0.2) continue;
      const d = Math.hypot(center.x - b.position.x, center.z - b.position.z);
      if (d <= b.radius + radius) {
        this.damageBarrel(b, damage);
      }
    }
  }

  // ============================================================
  //  Anillo exterior de Coliseo monumental (arcadas, tribunas, pebeteros y estandartes)
  // ============================================================
  _buildColiseum() {
    const coliseum = new THREE.Group();
    coliseum.name = 'ColiseumRing';

    const cutStone = createCutStoneTexture({
      baseColor: '#768494',
      mortarColor: '#313a47',
      repeatX: 20,
      repeatY: 3,
    });
    const colStone = createToonMaterial('#7c8a9b', { map: cutStone, side: THREE.DoubleSide });
    const colDark = createToonMaterial('#505b6b', { map: cutStone, side: THREE.DoubleSide });
    const colOchre = createToonMaterial('#c99438', { side: THREE.DoubleSide });
    const colBowlMat = createToonMaterial('#2a313a');

    const R = 62;

    // Muro perimetral inferior que emerge del abismo
    const lowerWall = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R * 0.94, 28, 72, 1, true),
      colDark
    );
    lowerWall.position.y = -4;
    coliseum.add(lowerWall);

    // Cornisa ocre tallada que separa el muro del graderío
    const belt = new THREE.Mesh(new THREE.TorusGeometry(R, 0.95, 10, 72), colOchre);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 10;
    coliseum.add(belt);

    // 3 niveles de gradas escalonadas (tribunas con bancas visibles)
    const tiers = [
      { r: R + 1.8, y: 12.6, h: 4.0 },
      { r: R + 4.8, y: 16.5, h: 4.1 },
      { r: R + 8.0, y: 20.6, h: 4.8 },
    ];
    for (let t = 0; t < tiers.length; t++) {
      const tr = tiers[t];
      const tierWall = new THREE.Mesh(
        new THREE.CylinderGeometry(tr.r, tr.r - 1.5, tr.h, 72, 1, true),
        t % 2 === 0 ? colStone : colDark
      );
      tierWall.position.y = tr.y;
      coliseum.add(tierWall);

      // Ledge horizontal de asiento
      const bench = new THREE.Mesh(
        new THREE.TorusGeometry(tr.r - 0.75, 0.42, 6, 72),
        colOchre
      );
      bench.rotation.x = Math.PI / 2;
      bench.position.y = tr.y - tr.h * 0.45;
      coliseum.add(bench);
    }

    // Arcos arquitectónicos reales entre los 20 pilares perimetrales
    const pillarCount = 20;
    const stepAngle = (Math.PI * 2) / pillarCount;
    const spanDist = 2 * (R - 0.7) * Math.sin(stepAngle * 0.5);
    const halfSpan = spanDist * 0.5;
    const archR = halfSpan - 1.35;

    const archShape = new THREE.Shape();
    archShape.moveTo(-halfSpan, 0);
    archShape.lineTo(-archR, 0);
    archShape.absarc(0, 0, archR, Math.PI, 0, true);
    archShape.lineTo(halfSpan, 0);
    archShape.lineTo(halfSpan, archR + 2.4);
    archShape.lineTo(-halfSpan, archR + 2.4);
    archShape.closePath();

    const archGeo = new THREE.ExtrudeGeometry(archShape, {
      depth: 2.3,
      bevelEnabled: true,
      bevelThickness: 0.14,
      bevelSize: 0.12,
      bevelSegments: 2,
      curveSegments: 16,
    });
    archGeo.translate(0, 0, -1.15);

    for (let i = 0; i < pillarCount; i++) {
      const aMid = ((i + 0.5) / pillarCount) * Math.PI * 2;
      const ax = Math.cos(aMid) * (R - 0.7);
      const az = Math.sin(aMid) * (R - 0.7);
      const arch = new THREE.Mesh(archGeo, colStone);
      arch.position.set(ax, 14.5, az);
      arch.rotation.y = -aMid + Math.PI / 2;
      addOutline(arch, 0.08, 0x161210);
      coliseum.add(arch);
    }

    // 20 columnas monumentales torneadas alrededor del Coliseo + pebeteros encendidos
    const colLatheGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0, 0.0),
        new THREE.Vector2(2.45, 0.0),
        new THREE.Vector2(2.45, 2.2),
        new THREE.Vector2(1.95, 3.0),
        new THREE.Vector2(1.88, 16.0),
        new THREE.Vector2(1.7, 29.0),
        new THREE.Vector2(2.15, 30.2),
        new THREE.Vector2(2.38, 31.6),
        new THREE.Vector2(0.0, 31.6),
      ],
      18
    );
    const colBrazierGeo = new THREE.CylinderGeometry(2.1, 1.35, 1.25, 14);

    for (let i = 0; i < pillarCount; i++) {
      const a = (i / pillarCount) * Math.PI * 2;
      const bx = Math.cos(a) * (R - 0.7);
      const bz = Math.sin(a) * (R - 0.7);
      const bGroup = new THREE.Group();
      bGroup.position.set(bx, -6.5, bz);
      bGroup.rotation.y = -a + Math.PI / 2;

      const bMesh = new THREE.Mesh(colLatheGeo, colStone);
      const cMesh = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.4, 4.4), colOchre);
      cMesh.position.y = 32.1;
      bGroup.add(bMesh, cMesh);

      // Pebeteros con llama animada en 10 pilares alternos (y especialmente flanqueando los estandartes)
      if (i % 2 === 0) {
        const bowl = new THREE.Mesh(colBrazierGeo, colBowlMat);
        bowl.position.y = 33.4;
        bGroup.add(bowl);

        const flame = createLayeredFlame(0.85, 2.9, i * 1.7 + 2, 0.22, 0.035);
        flame.group.position.y = 34.0;
        bGroup.add(flame.group);
        this._braziers.push({ flameGroup: flame.group, phase: i * 1.1 });
      }

      addOutline(bGroup, 0.08, 0x161210);
      coliseum.add(bGroup);
    }

    // 4 Estandartes verticales colgantes con los emblemas de los 4 Elementos
    const banners = [
      { element: 'earth', angle: 0, color: '#3f7a38', accent: '#d8a63c' },           // Norte (+Z): Verde Tierra
      { element: 'fire', angle: Math.PI, color: '#b52828', accent: '#f5a638' },      // Sur (-Z): Rojo Fuego
      { element: 'air', angle: Math.PI / 2, color: '#e6b832', accent: '#fff2c2' },   // Este (+X): Amarillo Aire
      { element: 'water', angle: -Math.PI / 2, color: '#2466a8', accent: '#9be0ff' }, // Oeste (-X): Azul Agua
    ];

    this.banners = [];
    for (const b of banners) {
      const bannerGroup = new THREE.Group();
      const dist = R - 4.2;
      bannerGroup.position.set(Math.sin(b.angle) * dist, 15.6, Math.cos(b.angle) * dist);
      bannerGroup.rotation.y = b.angle + Math.PI;

      const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 9.2, 16), colOchre);
      crossbar.rotation.z = Math.PI / 2;
      crossbar.position.y = 7.6;
      bannerGroup.add(crossbar);

      const bannerTex = createBannerTexture(b.element, b.color, b.accent);
      const clothGeo = new THREE.PlaneGeometry(7.8, 16.2, 6, 14);
      clothGeo.userData.baseZ = new Float32Array(clothGeo.attributes.position.count);
      const cp = clothGeo.attributes.position;
      for (let k = 0; k < cp.count; k++) {
        clothGeo.userData.baseZ[k] = cp.getZ(k);
      }

      const clothMat = new THREE.MeshStandardMaterial({
        map: bannerTex,
        roughness: 0.85,
        side: THREE.DoubleSide,
      });
      const cloth = new THREE.Mesh(clothGeo, clothMat);
      cloth.position.y = -0.8;
      bannerGroup.add(cloth);

      this.banners.push({ cloth, baseGeo: clothGeo, phase: b.angle });
      coliseum.add(bannerGroup);
    }

    this.group.add(coliseum);
  }

  // ============================================================
  //  Rocas flotantes en el abismo (decorativas)
  // ============================================================
  _buildFloatingRocks() {
    const mat = new THREE.MeshStandardMaterial({ color: '#7d6650', roughness: 1, flatShading: true });
    const rng = mulberry32(1337);
    for (let i = 0; i < 20; i++) {
      const size = 1.2 + rng() * 3.8;
      const geo = new THREE.DodecahedronGeometry(size, 0);
      jitterGeometry(geo, size * 0.25, () => true, rng);
      geo.computeVertexNormals();
      const rock = new THREE.Mesh(geo, mat);
      const a = rng() * Math.PI * 2;
      const d = 46 + rng() * 50;
      rock.position.set(Math.cos(a) * d, -20 + rng() * 28, Math.sin(a) * d);
      rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      rock.userData = {
        baseY: rock.position.y,
        phase: rng() * Math.PI * 2,
        spin: (rng() - 0.5) * 0.2,
      };
      this.floatingRocks.push(rock);
      this.group.add(rock);
    }
  }

  // ============================================================
  //  API de física para entidades (suelo, plataformas, rampas, barriles)
  // ============================================================

  getGroundHeightAt(x, currentY, z) {
    let ground = -Infinity;
    const tolerance = 0.2;
    const r = Math.hypot(x, z);

    // Plataforma principal
    if (r <= Arena.RADIUS && currentY >= -tolerance) {
      ground = 0;
    }

    // Plataforma central elevada (radio 5.5, altura 0.65) + bisel caminable hasta r = 6.95
    if (r <= 5.5 && currentY >= 0.65 - 0.42) {
      ground = Math.max(ground, 0.65);
    } else if (r > 5.5 && r <= 6.95 && currentY >= -tolerance) {
      const bevelH = THREE.MathUtils.clamp(0.65 * ((6.95 - r) / 1.45), 0, 0.65);
      if (currentY >= bevelH - 0.42) {
        ground = Math.max(ground, bevelH);
      }
    }

    // 2 plataformas laterales elevadas + rampas Norte/Sur
    for (const pl of this.platforms) {
      const dx = Math.abs(x - pl.cx);
      const az = Math.abs(z);
      if (dx <= pl.halfX && az <= pl.halfZ) {
        if (currentY >= pl.height - 0.38) {
          ground = Math.max(ground, pl.height);
        }
      } else if (dx <= pl.rampHalfX && az > pl.halfZ && az <= pl.rampEndZ) {
        const rampY = pl.height * ((pl.rampEndZ - az) / (pl.rampEndZ - pl.halfZ));
        if (currentY >= rampY - 0.55) {
          ground = Math.max(ground, rampY);
        }
      }
    }

    // Cima de los 4 pilares
    for (const p of this.pillars) {
      if (Math.hypot(x - p.x, z - p.z) <= p.radius && currentY >= p.top - tolerance) {
        ground = Math.max(ground, p.top);
      }
    }

    // Obstáculos dinámicos (muros)
    for (const o of this.obstacles) {
      ground = Math.max(ground, o.getTopAt(x, z, currentY));
    }
    return ground;
  }

  getGroundHeight(x, z, prevY) {
    return this.getGroundHeightAt(x, prevY, z);
  }

  /**
   * Encuentra un punto libre en la plataforma central elevada para reaparición tras caída.
   */
  getSafeRespawnPosition(fighters = [], excludeId = null) {
    const candidates = [new THREE.Vector3(0, 0.65, 0)];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      candidates.push(new THREE.Vector3(Math.cos(a) * 2.8, 0.65, Math.sin(a) * 2.8));
    }
    for (const c of candidates) {
      let occupied = false;
      for (const f of fighters) {
        if (!f || !f.isAlive || f.id === excludeId) continue;
        if (Math.hypot(f.position.x - c.x, f.position.z - c.z) < 1.35) {
          occupied = true;
          break;
        }
      }
      if (!occupied) return c;
    }
    return candidates[0];
  }

  /** Prueba colisión de esfera (proyectiles) contra plataformas elevadas y rampas */
  testPlatformSphere(pos, radius) {
    // Plataforma central
    const r = Math.hypot(pos.x, pos.z);
    if (r <= 5.5 + radius && pos.y - radius <= 0.65 && pos.y >= 0.05) {
      if (pos.y > 0.45 && r <= 5.5) {
        return {
          type: 'platform',
          point: new THREE.Vector3(pos.x, 0.65, pos.z),
          normal: new THREE.Vector3(0, 1, 0),
        };
      }
    }

    // Plataformas laterales y rampas
    for (const pl of this.platforms) {
      const lx = pos.x - pl.cx;
      const cx = THREE.MathUtils.clamp(lx, -pl.halfX, pl.halfX);
      const cy = THREE.MathUtils.clamp(pos.y, 0, pl.height);
      const cz = THREE.MathUtils.clamp(pos.z, -pl.halfZ, pl.halfZ);
      const dx = lx - cx;
      const dy = pos.y - cy;
      const dz = pos.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= radius * radius) {
        const normal = new THREE.Vector3(dx, dy, dz);
        if (normal.lengthSq() > 1e-6) normal.normalize();
        else normal.set(0, 1, 0);
        return {
          type: 'platform',
          point: new THREE.Vector3(pl.cx + cx, cy, cz),
          normal,
        };
      }

      // Rampas Norte/Sur
      const az = Math.abs(pos.z);
      if (Math.abs(lx) <= pl.rampHalfX + radius && az > pl.halfZ && az <= pl.rampEndZ) {
        const rampY = pl.height * ((pl.rampEndZ - az) / (pl.rampEndZ - pl.halfZ));
        if (pos.y - radius <= rampY && pos.y >= 0.05) {
          return {
            type: 'platform',
            point: new THREE.Vector3(pos.x, rampY, pos.z),
            normal: new THREE.Vector3(0, 0.94, Math.sign(pos.z) * 0.34).normalize(),
          };
        }
      }
    }
    return null;
  }

  addObstacle(obstacle) {
    this.obstacles.add(obstacle);
  }

  removeObstacle(obstacle) {
    this.obstacles.delete(obstacle);
  }

  /** Restaura todos los barriles y elementos destructibles del escenario */
  resetDestructibles() {
    this.restoreBarrels();
  }

  /** Devuelve los meshes válidos para raycasting de apuntado */
  getRaycastTargets() {
    return this.aimColliders;
  }

  /** Devuelve puntos de aparición seguros distribuidos sobre la Arena Clásica */
  getSpawnPoints(count = 2) {
    if (count <= 2) {
      return [
        new THREE.Vector3(0, 0, 12),
        new THREE.Vector3(0, 0, -12),
      ].slice(0, Math.max(1, count));
    }
    const pts = [];
    const radius = 16;
    for (let i = 0; i < count; i++) {
      const angle = Math.PI / 2 + (i / count) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = Math.max(0, this.getGroundHeightAt(x, 4, z));
      pts.push(new THREE.Vector3(x, y, z));
    }
    return pts;
  }

  getBoundsRadius() {
    return Arena.RADIUS;
  }

  isOutOfBounds(x, z, margin = 0) {
    return Math.hypot(x, z) > Arena.RADIUS - margin;
  }

  clampToPlayableArea(pos, margin = 1.0) {
    const maxR = Math.max(1, Arena.RADIUS - margin);
    const r = Math.hypot(pos.x, pos.z);
    if (r > maxR && r > 1e-4) {
      pos.x = (pos.x / r) * maxR;
      pos.z = (pos.z / r) * maxR;
    }
    return pos;
  }

  isObstacleAt(x, z, margin = 0) {
    return this.getPillarAt(x, z, margin) !== null;
  }

  isWaterAt() {
    return false;
  }

  getPatrolPoints() {
    if (!this._patrolPoints) {
      this._patrolPoints = [
        new THREE.Vector3(0, 0.65, 0),
        new THREE.Vector3(0, 0, 14),
        new THREE.Vector3(0, 0, -14),
        new THREE.Vector3(-15, 1.6, 0),
        new THREE.Vector3(15, 1.6, 0),
      ];
    }
    return this._patrolPoints;
  }

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
    const horizLen2 = dx * dx + dz * dz;
    if (horizLen2 > 1e-4) {
      for (const p of this.pillars) {
        const t = THREE.MathUtils.clamp(((p.x - ax) * dx + (p.z - az) * dz) / horizLen2, 0, 1);
        const cx = ax + dx * t;
        const cz = az + dz * t;
        const cy = ay + dy * t;
        if (cy <= p.top && Math.hypot(p.x - cx, p.z - cz) <= p.radius * 0.95) {
          return false;
        }
      }
    }
    return true;
  }

  /** Comprueba impacto esférico de proyectiles contra barriles, plataformas, pilares y suelo */
  checkProjectileHit(pos, radius, barrelDamage = 15) {
    const bHit = this.testBarrelSphere(pos, radius, barrelDamage);
    if (bHit) return bHit;

    const plHit = this.testPlatformSphere(pos, radius);
    if (plHit) return plHit;

    for (const p of this.pillars) {
      const dx = pos.x - p.x;
      const dz = pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < p.radius + radius && pos.y - radius < p.top && pos.y + radius > -0.5) {
        if (pos.y > p.top - radius * 0.5 && d < p.radius) {
          return { type: 'pillar', pillar: p, point: new THREE.Vector3(pos.x, p.top, pos.z), normal: new THREE.Vector3(0, 1, 0) };
        }
        const nx = d > 1e-5 ? dx / d : 1;
        const nz = d > 1e-5 ? dz / d : 0;
        return {
          type: 'pillar',
          pillar: p,
          point: new THREE.Vector3(p.x + nx * p.radius, pos.y, p.z + nz * p.radius),
          normal: new THREE.Vector3(nx, 0, nz),
        };
      }
    }

    const R = Arena.RADIUS;
    const r2d = Math.hypot(pos.x, pos.z);
    if (r2d <= R && pos.y - radius <= 0 && pos.y > -Arena.HEIGHT) {
      return { type: 'floor', point: new THREE.Vector3(pos.x, 0, pos.z), normal: new THREE.Vector3(0, 1, 0) };
    }
    if (r2d <= R + radius && r2d > R && pos.y < 0 && pos.y > -Arena.HEIGHT) {
      const nx = pos.x / r2d;
      const nz = pos.z / r2d;
      return { type: 'floor', point: new THREE.Vector3(nx * R, pos.y, nz * R), normal: new THREE.Vector3(nx, 0, nz) };
    }
    return null;
  }

  getPillarAt(x, z, margin = 0) {
    for (const p of this.pillars) {
      if (Math.hypot(x - p.x, z - p.z) <= p.radius + margin) return p;
    }
    return null;
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
    // 1. Pilares
    for (const p of this.pillars) {
      if (prevY >= p.top - 0.05) continue;
      const dx = pos.x - p.x;
      const dz = pos.z - p.z;
      const dist = Math.hypot(dx, dz);
      const minDist = p.radius + radius;
      if (dist < minDist && dist > 1e-5) {
        const nx = dx / dist;
        const nz = dz / dist;
        pos.x = p.x + nx * minDist;
        pos.z = p.z + nz * minDist;
        if (vel) {
          const vn = vel.x * nx + vel.z * nz;
          if (vn < 0) {
            vel.x -= vn * nx;
            vel.z -= vn * nz;
          }
        }
      }
    }

    // 2. Paredes laterales de plataformas elevadas y costados de rampas
    for (const pl of this.platforms) {
      if (prevY < pl.height - 0.36 && pos.y >= -0.3) {
        const lx = pos.x - pl.cx;
        const cx = THREE.MathUtils.clamp(lx, -pl.halfX, pl.halfX);
        const cz = THREE.MathUtils.clamp(pos.z, -pl.halfZ, pl.halfZ);
        let dx = lx - cx;
        let dz = pos.z - cz;
        let d = Math.hypot(dx, dz);
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
          const px = pl.halfX - Math.abs(lx);
          const pz = pl.halfZ - Math.abs(pos.z);
          if (px <= pz) {
            const sx = Math.sign(lx) || 1;
            pos.x = pl.cx + sx * (pl.halfX + radius);
          } else {
            const sz = Math.sign(pos.z) || 1;
            pos.z = sz * (pl.halfZ + radius);
          }
        }
      }

      // Costados laterales de las rampas (impide atravesar el lateral del prisma de rampa)
      const az = Math.abs(pos.z);
      if (az > pl.halfZ && az < pl.rampEndZ) {
        const rampY = pl.height * ((pl.rampEndZ - az) / (pl.rampEndZ - pl.halfZ));
        if (prevY < rampY - 0.38 && pos.y >= -0.2) {
          const lx = pos.x - pl.cx;
          if (Math.abs(lx) < pl.rampHalfX + radius && Math.abs(lx) > pl.rampHalfX - 0.5) {
            const sx = Math.sign(lx) || 1;
            pos.x = pl.cx + sx * (pl.rampHalfX + radius);
            if (vel && vel.x * sx < 0) vel.x = 0;
          }
        }
      }
    }

    // 3. Barriles destructibles intactos
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

    // 4. Borde exterior de la plataforma al caer
    if (prevY < -0.25 && pos.y < -0.25) {
      const r = Math.hypot(pos.x, pos.z);
      const minR = Arena.RADIUS + radius;
      if (r < minR && r > Arena.RADIUS - 0.5) {
        pos.x = (pos.x / r) * minR;
        pos.z = (pos.z / r) * minR;
      }
    }

    // 5. Obstáculos dinámicos (muros de tierra)
    for (const o of this.obstacles) o.resolveCylinder(pos, radius, vel, prevY);
  }

  setEdgeDanger(level) {
    this._dangerLevel = THREE.MathUtils.clamp(level, 0, 1);
  }

  /** Animaciones ambientales */
  update(dt, cameraPosition) {
    this._time += dt;
    if (this._atmosphere) {
      this._atmosphere.update(dt, cameraPosition);
    }
    for (const rock of this.floatingRocks) {
      const u = rock.userData;
      rock.position.y = u.baseY + Math.sin(this._time * 0.4 + u.phase) * 0.8;
      rock.rotation.y += u.spin * dt;
    }
    for (const br of this._braziers) {
      const f = Math.sin(this._time * 12.0 + br.phase) * 0.14 + Math.cos(this._time * 19.0 + br.phase) * 0.08;
      if (br.flameGroup) {
        br.flameGroup.scale.set(1 + f * 0.34, 1 + f * 0.78, 1 + f * 0.34);
        br.flameGroup.rotation.y += dt * 1.6;
      }
    }
    if (this.banners) {
      for (const b of this.banners) {
        const pos = b.baseGeo.attributes.position;
        const baseZ = b.baseGeo.userData.baseZ;
        if (baseZ) {
          for (let i = 0; i < pos.count; i++) {
            const py = pos.getY(i);
            const px = pos.getX(i);
            const drop = THREE.MathUtils.clamp((8.1 - py) / 16.2, 0, 1);
            const wave = Math.sin(this._time * 2.2 + b.phase + py * 0.45 + px * 0.3) * 0.42 * drop * drop;
            pos.setZ(i, baseZ[i] + wave);
          }
          pos.needsUpdate = true;
          b.baseGeo.computeVertexNormals();
        }
      }
    }
    if (this.dangerRingMat) {
      if (this._dangerLevel > 0.01) {
        const pulse = 0.5 + 0.5 * Math.sin(this._time * 11.0);
        this.dangerRingMat.opacity = this._dangerLevel * (0.22 + 0.52 * pulse);
      } else {
        this.dangerRingMat.opacity = 0;
      }
    }
  }
}

// ==================================================================
//  Utilidades procedurales
// ==================================================================

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function jitterGeometry(geo, amount, filter = () => true, rng = Math.random) {
  const pos = geo.attributes.position;
  const cache = new Map();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (!filter(v)) continue;
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let off = cache.get(key);
    if (!off) {
      off = [(rng() - 0.5) * amount, (rng() - 0.5) * amount, (rng() - 0.5) * amount];
      cache.set(key, off);
    }
    pos.setXYZ(i, v.x + off[0], v.y + off[1], v.z + off[2]);
  }
  pos.needsUpdate = true;
}

/**
 * Genera la textura del suelo (color + relieve) en un canvas:
 * piedra gris-azulado pizarra, anillos concéntricos grabados, emblema central
 * y franja exterior en contraste ocre cálido.
 */
function createFloorTextures(R) {
  const size = 2048;
  const c = size / 2;
  const scale = c / R;

  const color = document.createElement('canvas');
  color.width = color.height = size;
  const g = color.getContext('2d');

  const bump = document.createElement('canvas');
  bump.width = bump.height = size;
  const b = bump.getContext('2d');

  const rng = mulberry32(42);

  // --- Base de piedra gris-azulado pizarra (slate stone) con variación ---
  g.fillStyle = '#5c6673';
  g.fillRect(0, 0, size, size);
  b.fillStyle = '#808080';
  b.fillRect(0, 0, size, size);

  // Manchas suaves de color pizarra
  for (let i = 0; i < 900; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 10 + rng() * 60;
    const light = rng() > 0.5;
    g.fillStyle = light ? 'rgba(135,152,172,0.08)' : 'rgba(38,44,54,0.09)';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // Grano fino
  for (let i = 0; i < 40000; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const v = rng();
    g.fillStyle = v > 0.5 ? 'rgba(180,195,212,0.10)' : 'rgba(25,30,38,0.14)';
    g.fillRect(x, y, 2, 2);
    b.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
    b.fillRect(x, y, 2, 2);
  }

  // --- Juntas de losas: anillos de bloques + radios desfasados ---
  const ringRadii = [5.5, 10.5, 16.5, 22.5, 26.2, 28.1];
  const drawGroove = (ctx, stroke, width) => {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  for (let ri = 0; ri < ringRadii.length - 1; ri++) {
    const r0 = ringRadii[ri] * scale;
    const r1 = ringRadii[ri + 1] * scale;
    const segs = 10 + ri * 6;
    const offset = rng() * Math.PI;
    for (let s = 0; s < segs; s++) {
      const a = offset + (s / segs) * Math.PI * 2;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
      drawGroove(g, 'rgba(26,32,40,0.65)', 3);
      b.beginPath();
      b.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      b.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
      drawGroove(b, '#404040', 4);
    }
  }

  // --- Anillos concéntricos grabados (surco oscuro + filo iluminado) ---
  for (const rr of ringRadii) {
    const r = rr * scale;
    g.beginPath();
    g.arc(c, c, r, 0, Math.PI * 2);
    drawGroove(g, 'rgba(22,28,36,0.85)', 10);
    g.beginPath();
    g.arc(c, c, r + 6, 0, Math.PI * 2);
    drawGroove(g, 'rgba(218,175,98,0.42)', 2.5);

    b.beginPath();
    b.arc(c, c, r, 0, Math.PI * 2);
    drawGroove(b, '#1e1e1e', 10);
  }

  // Anillo decorativo con muescas ocre entre r=16.5 y r=22.5
  for (let s = 0; s < 56; s++) {
    const a = (s / 56) * Math.PI * 2;
    const r0 = 18.2 * scale;
    const r1 = 20.0 * scale;
    for (const [ctx, st, w] of [
      [g, 'rgba(205,152,62,0.55)', 5],
      [b, '#303030', 6],
    ]) {
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
      drawGroove(ctx, st, w);
    }
  }

  // --- Emblema central en contraste ocre cálido sobre pizarra ---
  const emb = 4.6 * scale;
  g.save();
  g.translate(c, c);
  g.fillStyle = 'rgba(208,150,52,0.82)';
  g.beginPath();
  g.arc(0, 0, emb, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(28,34,42,0.9)';
  g.lineWidth = 10;
  g.stroke();
  g.rotate(Math.PI / 4);
  g.fillStyle = 'rgba(72,82,94,0.92)';
  g.fillRect(-emb * 0.56, -emb * 0.56, emb * 1.12, emb * 1.12);
  g.fillStyle = 'rgba(232,182,78,0.9)';
  g.fillRect(-emb * 0.28, -emb * 0.28, emb * 0.56, emb * 0.56);
  g.restore();
  b.save();
  b.translate(c, c);
  b.rotate(Math.PI / 4);
  b.strokeStyle = '#2a2a2a';
  b.lineWidth = 8;
  b.strokeRect(-emb * 0.56, -emb * 0.56, emb * 1.12, emb * 1.12);
  b.strokeRect(-emb * 0.28, -emb * 0.28, emb * 0.56, emb * 0.56);
  b.restore();

  // --- Franja exterior en contraste ocre cálido y marcas de peligro (r 28 -> 30) ---
  const dr0 = 28.0 * scale;
  const dr1 = 29.8 * scale;
  g.beginPath();
  g.arc(c, c, (dr0 + dr1) / 2, 0, Math.PI * 2);
  drawGroove(g, 'rgba(198,142,48,0.85)', dr1 - dr0);
  // Marcas en forma de cuña (chevrons) escarlata y ocre dorado
  const marks = 80;
  for (let s = 0; s < marks; s++) {
    const a = (s / marks) * Math.PI * 2;
    const w = ((Math.PI * 2) / marks) * 0.32;
    g.fillStyle = s % 2 === 0 ? 'rgba(186,52,32,0.88)' : 'rgba(52,60,72,0.88)';
    g.beginPath();
    g.moveTo(c + Math.cos(a - w) * dr0, c + Math.sin(a - w) * dr0);
    g.lineTo(c + Math.cos(a) * dr1, c + Math.sin(a) * dr1);
    g.lineTo(c + Math.cos(a + w) * dr0, c + Math.sin(a + w) * dr0);
    g.closePath();
    g.fill();
  }
  // Borde exterior oscuro
  g.beginPath();
  g.arc(c, c, 29.88 * scale, 0, Math.PI * 2);
  drawGroove(g, 'rgba(26,32,40,0.95)', 0.32 * scale);

  const colorMap = new THREE.CanvasTexture(color);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.anisotropy = 8;
  const bumpMap = new THREE.CanvasTexture(bump);
  bumpMap.anisotropy = 8;
  return { colorMap, bumpMap };
}

/** Textura de roca estratificada para los laterales */
export function createRockTexture() {
  const w = 512;
  const h = 256;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  const rng = mulberry32(7);
  g.fillStyle = '#8a745c';
  g.fillRect(0, 0, w, h);
  // Estratos horizontales
  for (let y = 0; y < h; y += 6 + rng() * 18) {
    g.fillStyle = `rgba(${40 + rng() * 60},${30 + rng() * 40},${20 + rng() * 30},${0.15 + rng() * 0.25})`;
    g.fillRect(0, y, w, 2 + rng() * 6);
  }
  // Grietas verticales
  g.strokeStyle = 'rgba(30,20,12,0.5)';
  for (let i = 0; i < 40; i++) {
    let x = rng() * w;
    let y = rng() * h;
    g.lineWidth = 1 + rng() * 2;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += (rng() - 0.5) * 20;
      y += 10 + rng() * 15;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Genera la textura de un estandarte elemental colgante (Tierra, Fuego, Aire o Agua)
 * con borde dorado e insignia central.
 */
function createBannerTexture(element, bgColor, accentColor) {
  const w = 256;
  const h = 512;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');

  // Fondo del estandarte
  g.fillStyle = bgColor;
  g.fillRect(0, 0, w, h);

  // Bordes laterales y franja inferior en contraste dorado/acento
  g.strokeStyle = accentColor;
  g.lineWidth = 16;
  g.strokeRect(14, 14, w - 28, h - 28);

  g.lineWidth = 4;
  g.strokeRect(28, 28, w - 56, h - 56);

  // Medallón central oscuro para destacar el emblema
  const cx = w / 2;
  const cy = h * 0.44;
  g.fillStyle = 'rgba(16, 14, 12, 0.35)';
  g.beginPath();
  g.arc(cx, cy, 78, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = accentColor;
  g.lineWidth = 6;
  g.stroke();

  // Emblema estilizado según el elemento
  g.save();
  g.translate(cx, cy);
  g.strokeStyle = accentColor;
  g.fillStyle = accentColor;
  g.lineWidth = 8;

  if (element === 'earth') {
    // Tierra: bloque romboidal firme con cuadrado interior
    g.rotate(Math.PI / 4);
    g.strokeRect(-42, -42, 84, 84);
    g.fillRect(-18, -18, 36, 36);
  } else if (element === 'fire') {
    // Fuego: llama triple estilizada ascendente
    g.beginPath();
    g.moveTo(0, -56);
    g.quadraticCurveTo(46, -10, 26, 44);
    g.quadraticCurveTo(0, 22, -26, 44);
    g.quadraticCurveTo(-46, -10, 0, -56);
    g.fill();
  } else if (element === 'air') {
    // Aire: triple espiral de viento en triángulo
    for (let i = 0; i < 3; i++) {
      g.save();
      g.rotate((i * Math.PI * 2) / 3);
      g.beginPath();
      g.arc(0, -26, 20, 0, Math.PI * 1.45);
      g.stroke();
      g.restore();
    }
  } else if (element === 'water') {
    // Agua: luna creciente + tres ondas fluidas
    g.beginPath();
    g.arc(0, -14, 34, 0.25 * Math.PI, 1.75 * Math.PI);
    g.stroke();
    for (let k = -1; k <= 1; k++) {
      const y = 24 + k * 14;
      g.beginPath();
      g.moveTo(-36, y);
      g.quadraticCurveTo(-18, y - 10, 0, y);
      g.quadraticCurveTo(18, y + 10, 36, y);
      g.stroke();
    }
  }
  g.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
