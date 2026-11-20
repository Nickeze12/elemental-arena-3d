import * as THREE from 'three';
import { createToonMaterial, createEnergyVFXMaterial, addOutline } from '../utils/ToonMaterial.js';
import { createCutStoneTexture, createWoodPlankTexture } from '../utils/ProceduralTextures.js';
import {
  createJaggedStalagmite,
  createStoneSlab,
  createTectonicShardCluster,
  createRuggedBoulder,
  createEarthOrbitRocksGroup,
  createEarthRockTrapGroup,
  ROCK_PALETTE,
} from '../utils/RockGeometry.js';
import { createLayeredFlame } from '../utils/FlameGeometry.js';
import { createWaterCometOrb, createCrystallineIceSpear } from '../utils/WaterGeometry.js';
import { createWindRibbonTube } from '../utils/AirGeometry.js';
import {
  createLeafBladeGeometry,
  createOrganicVineTubeGeometry,
  createRootClusterGroup,
  NATURE_PALETTE,
} from '../utils/NatureGeometry.js';
import { createHypnoticSpiralGroup, createRuneHaloGroup } from '../utils/PsychicGeometry.js';
import { createMistClusterGroup, createZigzagBoltGeometry } from '../utils/StormGeometry.js';
import {
  LIGHT_PALETTE,
  createRefractionPrismGroup,
  createLightStunStarsGroup,
} from '../utils/LightGeometry.js';
import {
  SHADOW_PALETTE,
  createShadowScytheGeo,
} from '../utils/ShadowGeometry.js';

const OUTLINE_COLOR = 0x1b2028;

const ELEMENT_PALETTES = {
  fire: {
    main: '#e84a27',
    accent: '#ffbe3b',
    core: '#fff5b0',
    dark: '#421614',
    emissive: '#ff6a1a',
  },
  water: {
    main: '#00a8e8',
    accent: '#9cf6ff',
    core: '#ffffff',
    dark: '#143354',
    emissive: '#38d6ff',
  },
  earth: {
    main: '#7a8a42',
    accent: '#f0b849',
    core: '#fff0b3',
    dark: '#3b4222',
    emissive: '#f29f24',
  },
  air: {
    main: '#7be0f5',
    accent: '#f7fcff',
    core: '#ffffff',
    dark: '#2a5a6e',
    emissive: '#b8f4ff',
  },
  nature: {
    main: '#2d6a4f',
    accent: '#4ade80',
    core: '#f0fdf4',
    dark: '#3d281f',
    emissive: '#22c55e',
  },
  psychic: {
    main: '#7e22ce',
    accent: '#e879f9',
    core: '#f3e8ff',
    dark: '#2c0b47',
    emissive: '#d946ef',
  },
  storm: {
    main: '#334155',
    accent: '#fde047',
    core: '#e0f2fe',
    dark: '#0f172a',
    emissive: '#38bdf8',
  },
  light: {
    main: '#f8fafc',
    accent: '#facc15',
    core: '#ffffff',
    dark: '#334155',
    emissive: '#38bdf8',
  },
  shadow: {
    main: '#1e1b4b',
    accent: '#f43f5e',
    core: '#a78bfa',
    dark: '#09090b',
    emissive: '#6d28d9',
  },
};

/**
 * MonsterMesh
 * ------------------------------------------------------------
 * Modelos esculpidos orgánicos y volumétricos para Supervivencia:
 *  - 'spirit'   : Espíritu Elemental con cuerpo fluido en gota/llama invertida, cola
 *                 serpentina translúcida (`fadeEnds`), máscara espiritual tallada y adornos.
 *  - 'golem'    : Guardián Elemental esculpido con placas de textura procedural, fisura
 *                 en el pecho con núcleo elemental pulsante y extremidades torneadas.
 *  - 'colossus' : Titán Ancestral (1.45x) con gran reactor expuesto en el pecho,
 *                 corona dorsal de monolitos, halo rúnico aditivo y guanteletes con aura.
 */
export class MonsterMesh {
  constructor({ type = 'spirit', element = 'fire' } = {}) {
    this.type = type;
    this.element = element;
    this.root = new THREE.Group();
    this.root.name = `Monster_${type}_${element}`;

    this.materials = [];
    this._energyMats = [];
    this._disposables = [];
    this._animatedUpdatables = [];
    this._palette = ELEMENT_PALETTES[element] || ELEMENT_PALETTES.fire;

    this.time = Math.random() * 10;
    this._flash = 0;
    this._flashColor = '#ffcf80';
    this._hitFlash = 0;
    this._telegraphCharge = 0;

    this._isFrozen = false;
    this._isBurning = false;
    this._isRooted = false;
    this._isPoisoned = false;
    this._isConfused = false;
    this._isStunned = false;

    this._burnFlames = [];
    this._poisonSpores = [];
    this._rootGroup = null;
    this._stunStars = null;
    this._poisonGroup = null;
    this._confusedSpiral = null;
    this._freezeCrystal = null;
    this._spiritTail = null;
    this._reactorMesh = null;

    this.action = null;

    this.bodyPivot = new THREE.Group();
    this.root.add(this.bodyPivot);

    this._parts = {
      core: null,
      head: null,
      armL: null,
      armR: null,
      legL: null,
      legR: null,
      orbitGroup: null,
      crown: null,
      floatShoulderL: null,
      floatShoulderR: null,
    };

    if (type === 'spirit') {
      this._buildSpirit();
    } else if (type === 'colossus') {
      this._buildColossus();
    } else {
      this._buildGolem();
    }

    this._buildFreezeCrystal();
    this._buildBurnFlames();
  }

  _makeMat(color, extra = {}) {
    const m = createToonMaterial(color, extra);
    this.materials.push(m);
    this._disposables.push(m);
    return m;
  }

  _makeEnergyMat(options = {}) {
    const m = createEnergyVFXMaterial(options);
    this._energyMats.push(m);
    this._disposables.push(m);
    return m;
  }

  _trackGeo(geo) {
    this._disposables.push(geo);
    return geo;
  }

  _addPart(geo, mat, parent, x = 0, y = 0, z = 0, opts = {}) {
    this._trackGeo(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    if (opts.rot) mesh.rotation.set(opts.rot[0], opts.rot[1], opts.rot[2]);
    if (opts.scale) mesh.scale.set(opts.scale[0], opts.scale[1], opts.scale[2]);
    if (opts.castShadow) mesh.castShadow = true;
    if (opts.receiveShadow) mesh.receiveShadow = true;
    if (opts.noOutline || mat?.userData?.noOutline) {
      mesh.userData.noOutline = true;
    } else {
      addOutline(mesh, opts.outline ?? 0.012, opts.outlineColor ?? OUTLINE_COLOR);
    }
    parent.add(mesh);
    return mesh;
  }

  /** Devuelve textura de superficie sólida acorde al elemento (corteza para nature, sillería en el resto) */
  _getArmorTexture(repeatX = 2, repeatY = 2) {
    const P = this._palette;
    if (this.element === 'nature') {
      return createWoodPlankTexture({
        baseColor: '#4c3428',
        grainColor: '#291a12',
        highlightColor: '#6b4c3b',
        planks: 5,
        repeatX,
        repeatY,
      });
    }
    if (this.element === 'water') {
      return createCutStoneTexture({
        baseColor: '#7ca7cc',
        mortarColor: '#284a6e',
        repeatX,
        repeatY,
      });
    }
    if (this.element === 'psychic') {
      return createCutStoneTexture({
        baseColor: '#4c1d73',
        mortarColor: '#1d0733',
        repeatX,
        repeatY,
      });
    }
    if (this.element === 'storm') {
      return createCutStoneTexture({
        baseColor: '#3a495e',
        mortarColor: '#131a26',
        repeatX,
        repeatY,
      });
    }
    if (this.element === 'light') {
      return createCutStoneTexture({
        baseColor: '#e2e8f0',
        mortarColor: '#64748b',
        highlightColor: '#fef9c3',
        repeatX,
        repeatY,
      });
    }
    if (this.element === 'shadow') {
      return createCutStoneTexture({
        baseColor: '#18181b',
        mortarColor: '#09090b',
        highlightColor: '#6d28d9',
        repeatX,
        repeatY,
      });
    }
    if (this.element === 'fire') {
      return createCutStoneTexture({
        baseColor: '#472222',
        mortarColor: '#1f0c0b',
        repeatX,
        repeatY,
      });
    }
    return createCutStoneTexture({
      baseColor: this.type === 'colossus' ? '#36404f' : ROCK_PALETTE.mid,
      mortarColor: this.type === 'colossus' ? '#171c24' : '#2a2e33',
      repeatX,
      repeatY,
    });
  }

  // ====================================================================
  //  1. ESPÍRITU ELEMENTAL (Silueta fluida estilo Avatar + Máscara + Adornos)
  // ====================================================================
  _buildSpirit() {
    const P = this._palette;
    const isSolidMaskWood = this.element === 'nature';
    const maskMat = this._makeMat(isSolidMaskWood ? '#d8c5a3' : this.element === 'fire' ? '#f5ead6' : '#e6edf7', {
      map: isSolidMaskWood
        ? createWoodPlankTexture({ baseColor: '#c9ad84', grainColor: '#7c5d3a', repeatX: 1, repeatY: 1 })
        : undefined,
      flatShading: false,
    });
    const maskAccentMat = this._makeMat(P.dark, { flatShading: this.element === 'earth' });

    const bodyEnergyMat = this._makeEnergyMat({
      coreColor: P.core,
      rimColor: P.main,
      opacity: 0.9,
      fresnelPower: 1.75,
      rimIntensity: 1.25,
      depthWrite: false,
    });
    const veilMat = this._makeEnergyMat({
      coreColor: P.main,
      rimColor: P.accent,
      opacity: 0.42,
      softEdge: true,
      fadeEndsY: true,
      fresnelPower: 1.5,
      depthWrite: false,
    });
    const tailMat = this._makeEnergyMat({
      coreColor: P.accent,
      rimColor: P.main,
      opacity: 0.8,
      fadeEnds: true,
      fresnelPower: 1.6,
      depthWrite: false,
    });
    const eyeMat = this._makeEnergyMat({
      coreColor: '#ffffff',
      rimColor: P.accent,
      opacity: 0.98,
      additive: true,
      depthWrite: false,
    });

    const floatRoot = new THREE.Group();
    floatRoot.position.y = 1.28;
    this.bodyPivot.add(floatRoot);
    this._parts.core = floatRoot;

    // 1. Cuerpo espectral en gota / llama invertida (`LatheGeometry` suave, SIN contorno negro)
    const spiritProfile = [
      new THREE.Vector2(0.01, -0.58),
      new THREE.Vector2(0.11, -0.44),
      new THREE.Vector2(0.24, -0.22),
      new THREE.Vector2(0.36, -0.02),
      new THREE.Vector2(0.4, 0.16),
      new THREE.Vector2(0.34, 0.34),
      new THREE.Vector2(0.2, 0.5),
      new THREE.Vector2(0.06, 0.62),
      new THREE.Vector2(0.0, 0.68),
    ];
    const bodyGeo = new THREE.LatheGeometry(spiritProfile, 22);
    bodyGeo.scale(1.0, 1.0, 0.94);
    this._addPart(bodyGeo, bodyEnergyMat, floatRoot, 0, 0, 0, { noOutline: true });

    // Manto exterior luminoso suave
    const veilGeo = new THREE.LatheGeometry(spiritProfile, 20);
    veilGeo.scale(1.24, 1.12, 1.18);
    this._addPart(veilGeo, veilMat, floatRoot, 0, 0.02, 0, { noOutline: true });

    // 2. Cola serpentina afilada colgando y curvándose hacia -Z con fadeEnds
    const tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.32, 0),
      new THREE.Vector3(0.08, -0.54, -0.18),
      new THREE.Vector3(-0.08, -0.78, -0.36),
      new THREE.Vector3(0.04, -1.04, -0.52),
    ]);
    const tailGeo = createOrganicVineTubeGeometry(tailCurve, 18, 0.16, 0.012, 10);
    this._spiritTail = this._addPart(tailGeo, tailMat, floatRoot, 0, 0, 0, { noOutline: true });

    // 3. Máscara espiritual frontal esculpida (+Z) con ojos expresivos luminosos
    const head = new THREE.Group();
    head.position.set(0, 0.16, 0.3);
    floatRoot.add(head);
    this._parts.head = head;

    const maskShape = new THREE.Shape();
    maskShape.moveTo(0, -0.24);
    maskShape.quadraticCurveTo(0.2, -0.18, 0.24, 0.04);
    maskShape.quadraticCurveTo(0.24, 0.2, 0.12, 0.27);
    maskShape.lineTo(0, 0.22);
    maskShape.lineTo(-0.12, 0.27);
    maskShape.quadraticCurveTo(-0.24, 0.2, -0.24, 0.04);
    maskShape.quadraticCurveTo(-0.2, -0.18, 0, -0.24);

    const maskGeo = new THREE.ExtrudeGeometry(maskShape, {
      depth: 0.1,
      bevelEnabled: true,
      bevelThickness: 0.035,
      bevelSize: 0.028,
      bevelSegments: 2,
      curveSegments: 14,
    });
    maskGeo.translate(0, 0, -0.05);
    this._addPart(maskGeo, maskMat, head, 0, 0, 0, { outline: 0.01 });

    // Grabado nasal/frente en la máscara + ojos brillantes expresivos
    const crestGeo = new THREE.BoxGeometry(0.06, 0.16, 0.06);
    this._addPart(crestGeo, maskAccentMat, head, 0, 0.12, 0.045, { noOutline: true });

    const eyeGeo = new THREE.SphereGeometry(0.048, 10, 8);
    eyeGeo.scale(1.45, 0.52, 0.5);
    const eyeL = this._addPart(eyeGeo, eyeMat, head, 0.095, 0.02, 0.065, {
      rot: [0, 0.15, 0.24],
      noOutline: true,
    });
    this._addPart(eyeGeo, eyeMat, head, -0.095, 0.02, 0.065, {
      rot: [0, -0.15, -0.24],
      noOutline: true,
    });
    void eyeL;

    // 4. Corona / crestas elementales superiores según afinidad
    const crownGroup = new THREE.Group();
    crownGroup.position.y = 0.56;
    floatRoot.add(crownGroup);
    this._parts.crown = crownGroup;

    if (this.element === 'fire') {
      const topFlame = createLayeredFlame(0.24, 0.78, 3.1, 0.14);
      crownGroup.add(topFlame.group);
      this._disposables.push(topFlame);
      this._animatedUpdatables.push((age) => topFlame.update(age, 1.2));
    } else if (this.element === 'water') {
      const spear = createCrystallineIceSpear(4.2);
      spear.group.scale.setScalar(0.5);
      spear.group.rotation.x = -Math.PI * 0.5;
      crownGroup.add(spear.group);
      this._disposables.push(spear);
      this._animatedUpdatables.push((_age, dt) => spear.update(dt));
    } else if (this.element === 'air') {
      const windMat = this._makeEnergyMat({
        coreColor: '#ffffff',
        rimColor: '#7be0f5',
        opacity: 0.85,
        fadeEnds: true,
      });
      const ribbonGeo = createWindRibbonTube(0.32, 0.08, 0.82, 1.6, 22, 0.048);
      this._addPart(ribbonGeo, windMat, crownGroup, 0, -0.24, 0, { noOutline: true });
    } else if (this.element === 'nature') {
      const cluster = createRootClusterGroup(0.58, 0.24, 5.2);
      crownGroup.add(cluster.group);
      this._disposables.push(cluster);
    } else if (this.element === 'psychic') {
      const halo = createRuneHaloGroup(0.34, 6, 0.85);
      halo.group.rotation.x = Math.PI * 0.5;
      crownGroup.add(halo.group);
      this._disposables.push(halo);
    } else if (this.element === 'storm') {
      const mistCrown = createMistClusterGroup(0.42);
      mistCrown.group.position.y = 0.08;
      crownGroup.add(mistCrown.group);
      this._disposables.push(mistCrown);
      const topBolt = createZigzagBoltGeometry(
        new THREE.Vector3(0, 0.02, 0),
        new THREE.Vector3(0, 0.62, 0),
        { segments: 5, jitter: 0.11, radius: 0.028, seed: 19 }
      );
      this._addPart(topBolt, eyeMat, crownGroup, 0, 0, 0, { noOutline: true });
    } else if (this.element === 'light') {
      const prismCrown = createRefractionPrismGroup(0.62, false);
      prismCrown.group.position.y = 0.28;
      crownGroup.add(prismCrown.group);
      this._disposables.push(prismCrown);
      this._animatedUpdatables.push((age, dt) => prismCrown.update(dt, age));
    } else if (this.element === 'shadow') {
      const eclipseRingGeo = new THREE.TorusGeometry(0.26, 0.04, 8, 28);
      const eclipseCoreGeo = new THREE.SphereGeometry(0.18, 16, 12);
      const eclipseRingMat = this._makeEnergyMat({
        coreColor: P.core,
        rimColor: P.accent,
        opacity: 0.92,
        additive: true,
        softEdge: true,
        depthWrite: false,
      });
      const shadowCoreMat = this._makeMat(SHADOW_PALETTE.obsidian);
      this._addPart(eclipseRingGeo, eclipseRingMat, crownGroup, 0, 0.22, 0, { noOutline: true });
      this._addPart(eclipseCoreGeo, shadowCoreMat, crownGroup, 0, 0.22, 0, { noOutline: true });
    } else {
      const cluster = createTectonicShardCluster(0.7, 0.26, 7.1);
      crownGroup.add(cluster.group);
      this._disposables.push(cluster);
    }

    // 5. Tres adornos orbitales sincronizados a la calidad de las habilidades del jugador
    const orbitGroup = new THREE.Group();
    floatRoot.add(orbitGroup);
    this._parts.orbitGroup = orbitGroup;

    const solidLeafMat = this._makeMat(NATURE_PALETTE.emerald, {
      emissive: '#22c55e',
      emissiveIntensity: 0.25,
      side: THREE.DoubleSide,
    });
    const shardSolidMat = this._makeMat(P.accent, {
      flatShading: true,
      emissive: P.emissive,
      emissiveIntensity: 0.35,
    });
    const orbGlowMat = this._makeEnergyMat({
      coreColor: P.core,
      rimColor: P.accent,
      opacity: 0.92,
      additive: true,
      softEdge: true,
      depthWrite: false,
    });

    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2;
      const slot = new THREE.Group();
      slot.position.set(Math.cos(angle) * 0.86, Math.sin(i * 1.7) * 0.14, Math.sin(angle) * 0.86);

      if (this.element === 'fire') {
        const wisp = createLayeredFlame(0.11, 0.44, i * 2.3 + 1, 0.15);
        wisp.group.position.y = -0.18;
        slot.add(wisp.group);
        this._disposables.push(wisp);
        this._animatedUpdatables.push((age) => wisp.update(age, i * 1.5));
      } else if (this.element === 'water') {
        const orb = createWaterCometOrb(0.14);
        orb.group.scale.setScalar(0.75);
        orb.group.rotation.y = -angle;
        slot.add(orb.group);
        this._disposables.push(orb);
        this._animatedUpdatables.push((age, dt) => orb.update(dt, age + i));
      } else if (this.element === 'air') {
        const windMat = this._makeEnergyMat({
          coreColor: '#ffffff',
          rimColor: P.main,
          opacity: 0.84,
          fadeEnds: true,
        });
        const ribGeo = createWindRibbonTube(0.16, 0.04, 0.46, 1.15, 16, 0.036);
        this._addPart(ribGeo, windMat, slot, 0, -0.18, 0, {
          rot: [Math.PI * 0.25, angle, 0],
          noOutline: true,
        });
      } else if (this.element === 'nature') {
        const leafGeo = createLeafBladeGeometry(0.42, 0.19, 0.028);
        this._addPart(leafGeo, solidLeafMat, slot, 0, 0, 0, { rot: [0.3, angle, 0.2], outline: 0.009 });
        const sporeGeo = new THREE.SphereGeometry(0.06, 10, 8);
        this._addPart(sporeGeo, orbGlowMat, slot, 0, 0.14, 0, { noOutline: true });
      } else if (this.element === 'psychic') {
        const plasmaGeo = new THREE.SphereGeometry(0.1, 14, 10);
        this._addPart(plasmaGeo, orbGlowMat, slot, 0, 0, 0, { noOutline: true });
      } else if (this.element === 'storm') {
        const boltGeo = createZigzagBoltGeometry(
          new THREE.Vector3(0, -0.24, 0),
          new THREE.Vector3(0, 0.24, 0),
          { segments: 4, jitter: 0.09, radius: 0.024, seed: 37 + i * 13 }
        );
        this._addPart(boltGeo, eyeMat, slot, 0, 0, 0, { rot: [0.2, angle, 0.25], noOutline: true });
      } else if (this.element === 'light') {
        const miniPrism = createRefractionPrismGroup(0.32, false);
        slot.add(miniPrism.group);
        this._disposables.push(miniPrism);
        this._animatedUpdatables.push((age, dt) => miniPrism.update(dt, age + i * 1.3));
      } else if (this.element === 'shadow') {
        const scytheGeo = createShadowScytheGeo(0.32, 0.09);
        this._addPart(scytheGeo, orbGlowMat, slot, 0, 0, 0, {
          rot: [Math.PI * 0.4, angle, 0.25],
          noOutline: true,
        });
      } else {
        const shardGeo = createJaggedStalagmite(0.45, 0.14, i * 11 + 5);
        this._addPart(shardGeo, shardSolidMat, slot, 0, -0.22, 0, { rot: [0, 0, 0.28], outline: 0.01 });
      }
      orbitGroup.add(slot);
    }
  }

  // ====================================================================
  //  2. GÓLEM ELEMENTAL (Guardián esculpido en V + fisura luminosa + brazos torneados)
  // ====================================================================
  _buildGolem() {
    const P = this._palette;
    const tex = this._getArmorTexture(2, 2);
    const bodyBaseColor =
      this.element === 'earth' ? ROCK_PALETTE.mid : this.element === 'nature' ? '#4a3326' : P.dark;

    const armorMat = this._makeMat(bodyBaseColor, { map: tex, flatShading: false });
    const armorFacetMat = this._makeMat(
      this.element === 'earth' ? ROCK_PALETTE.highlight : P.main,
      { map: tex, flatShading: true }
    );
    const armorDarkMat = this._makeMat(
      this.element === 'earth' ? ROCK_PALETTE.shadow : '#252b36',
      { flatShading: false }
    );
    const energyCoreMat = this._makeEnergyMat({
      coreColor: P.core,
      rimColor: P.emissive,
      opacity: 0.98,
      additive: true,
      fresnelPower: 1.5,
      depthWrite: false,
    });

    // 1. Piernas musculosas torneadas (`LatheGeometry` suavizado + pies monolíticos)
    const thighProfile = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.26, 0.0),
      new THREE.Vector2(0.24, 0.14),
      new THREE.Vector2(0.18, 0.36),
      new THREE.Vector2(0.25, 0.62),
      new THREE.Vector2(0.21, 0.78),
      new THREE.Vector2(0.0, 0.78),
    ];
    const legGeo = new THREE.LatheGeometry(thighProfile, 14);
    legGeo.translate(0, -0.78, 0);

    for (const [key, s] of [['legL', 1], ['legR', -1]]) {
      const leg = new THREE.Group();
      leg.position.set(s * 0.4, 0.78, 0);
      this.bodyPivot.add(leg);
      this._parts[key] = leg;

      this._addPart(legGeo, armorDarkMat, leg, 0, 0, 0, { castShadow: true });
      // Rodillera facetada sólida
      const kneeGeo = createStoneSlab(0.26, 0.24, 0.16, s * 7 + 3, 0.15);
      this._addPart(kneeGeo, armorFacetMat, leg, 0, -0.44, 0.16, { outline: 0.01 });
    }

    // 2. Cintura articulada + Torso ancho en V con fisura abierta en el pecho
    const waistGeo = new THREE.CylinderGeometry(0.46, 0.38, 0.32, 14);
    this._addPart(waistGeo, armorDarkMat, this.bodyPivot, 0, 0.88, 0);

    const chest = new THREE.Group();
    chest.position.set(0, 1.38, 0);
    this.bodyPivot.add(chest);
    this._parts.core = chest;

    // Núcleo elemental pulsante en el centro del pecho (SIN borde negro)
    const innerCoreGeo = new THREE.SphereGeometry(0.44, 20, 14);
    innerCoreGeo.scale(1.02, 0.92, 0.86);
    this._reactorMesh = this._addPart(innerCoreGeo, energyCoreMat, chest, 0, 0.04, 0.06, {
      noOutline: true,
    });

    // Placa pectoral izquierda/derecha dejando fisura central luminosa expuesta
    const pecShape = new THREE.Shape();
    pecShape.moveTo(0.06, -0.36);
    pecShape.lineTo(0.56, -0.22);
    pecShape.lineTo(0.72, 0.36);
    pecShape.lineTo(0.18, 0.42);
    pecShape.lineTo(0.08, 0.12);
    pecShape.lineTo(0.14, -0.1);
    pecShape.closePath();

    const pecGeo = new THREE.ExtrudeGeometry(pecShape, {
      depth: 0.46,
      bevelEnabled: true,
      bevelThickness: 0.07,
      bevelSize: 0.05,
      bevelSegments: 2,
    });
    pecGeo.translate(0, 0, -0.18);

    const pecL = this._addPart(pecGeo, armorMat, chest, 0.02, 0.02, 0.04, {
      rot: [0.06, -0.14, 0],
      castShadow: true,
    });
    void pecL;
    this._addPart(pecGeo, armorMat, chest, -0.02, 0.02, 0.04, {
      scale: [-1, 1, 1],
      rot: [0.06, 0.14, 0],
      castShadow: true,
    });

    // Espaldar musculado redondeado dejando ranura dorsal luminosa
    const backShellGeo = new THREE.SphereGeometry(0.56, 16, 12);
    backShellGeo.scale(1.22, 0.92, 0.56);
    this._addPart(backShellGeo, armorDarkMat, chest, 0, 0.08, -0.26);

    // Grieta luminosa oblicua inferior del torso
    const fissureGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.58, 8);
    fissureGeo.rotateZ(1.28);
    this._addPart(fissureGeo, energyCoreMat, chest, 0, -0.2, 0.38, { noOutline: true });

    // 3. Cabeza monolítica esculpida + visera energética luminosa
    const head = new THREE.Group();
    head.position.set(0, 0.58, 0.16);
    chest.add(head);
    this._parts.head = head;

    const headGeo = createStoneSlab(0.44, 0.46, 0.44, 88.1, -0.16);
    this._addPart(headGeo, armorDarkMat, head, 0, -0.18, 0, { outline: 0.012 });

    const visorGeo = new THREE.CapsuleGeometry(0.036, 0.22, 4, 8);
    visorGeo.rotateZ(Math.PI * 0.5);
    this._addPart(visorGeo, energyCoreMat, head, 0, 0.06, 0.23, { noOutline: true });

    // 4. Hombros asimétricos y brazos largos torneados con antebrazos robustos y puños esculpidos
    const forearmProfile = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.24, 0.0),
      new THREE.Vector2(0.3, -0.16),
      new THREE.Vector2(0.28, -0.44),
      new THREE.Vector2(0.18, -0.7),
      new THREE.Vector2(0.0, -0.7),
    ];
    const upperArmGeo = new THREE.CylinderGeometry(0.21, 0.17, 0.56, 14);
    upperArmGeo.translate(0, -0.28, 0);
    const forearmGeo = new THREE.LatheGeometry(forearmProfile, 14);

    for (const [key, s] of [['armL', 1], ['armR', -1]]) {
      const arm = new THREE.Group();
      arm.position.set(s * 0.9, 0.34, 0.06);
      chest.add(arm);
      this._parts[key] = arm;

      // Hombrera asimétrica (cristales/roca sólida)
      const pauldron = createTectonicShardCluster(s > 0 ? 0.92 : 0.72, 0.34, s > 0 ? 19.2 : 53.7);
      pauldron.group.rotation.z = -s * 0.46;
      pauldron.group.position.set(s * 0.04, 0.12, 0);
      arm.add(pauldron.group);
      this._disposables.push(pauldron);

      this._addPart(upperArmGeo, armorDarkMat, arm, s * 0.04, -0.04, 0, { rot: [0, 0, s * 0.08] });
      this._addPart(forearmGeo, armorMat, arm, s * 0.1, -0.46, 0.05, {
        rot: [0, 0, s * 0.05],
        castShadow: true,
      });

      const knuckle = createRuggedBoulder(0.31, s * 17 + 9);
      knuckle.group.position.set(s * 0.13, -1.04, 0.1);
      knuckle.group.scale.set(0.95, 1.08, 1.0);
      arm.add(knuckle.group);
      this._disposables.push(knuckle);
    }
  }

  // ====================================================================
  //  3. COLOSO JEFE (Titán Ancestral 1.45x + Reactor + Monolitos + Halo + Guanteletes)
  // ====================================================================
  _buildColossus() {
    const P = this._palette;
    const tex = this._getArmorTexture(3, 3);
    const obsidianDark = this._makeMat('#202631', { map: tex, flatShading: false });
    const obsidianMid = this._makeMat('#364152', { map: tex, flatShading: false });
    const crystalMat = this._makeMat(P.main, {
      flatShading: true,
      emissive: P.emissive,
      emissiveIntensity: 0.42,
    });
    const energyReactorMat = this._makeEnergyMat({
      coreColor: '#ffffff',
      rimColor: P.emissive,
      opacity: 0.98,
      additive: true,
      fresnelPower: 1.5,
      rimIntensity: 1.4,
      depthWrite: false,
    });
    const energyShellMat = this._makeEnergyMat({
      coreColor: P.accent,
      rimColor: P.main,
      opacity: 0.62,
      additive: true,
      softEdge: true,
      fresnelPower: 1.8,
      depthWrite: false,
    });

    const scaleWrapper = new THREE.Group();
    scaleWrapper.scale.setScalar(1.45);
    this.bodyPivot.add(scaleWrapper);

    // 1. Piernas monumentales torneadas con rodilleras cristalinas
    const titanLegProfile = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.28, 0.0),
      new THREE.Vector2(0.24, 0.2),
      new THREE.Vector2(0.21, 0.48),
      new THREE.Vector2(0.27, 0.78),
      new THREE.Vector2(0.0, 0.78),
    ];
    const legGeo = new THREE.LatheGeometry(titanLegProfile, 16);
    legGeo.translate(0, -0.78, 0);

    for (const [key, s] of [['legL', 1], ['legR', -1]]) {
      const leg = new THREE.Group();
      leg.position.set(s * 0.4, 0.82, 0);
      scaleWrapper.add(leg);
      this._parts[key] = leg;

      this._addPart(legGeo, obsidianDark, leg, 0, 0, 0, { castShadow: true });
      const kneeCrystal = new THREE.OctahedronGeometry(0.15, 0);
      this._addPart(kneeCrystal, crystalMat, leg, 0, -0.34, 0.22, { outline: 0.01 });
    }

    // Cinturón ancestral
    const waistGeo = new THREE.CylinderGeometry(0.5, 0.42, 0.34, 16);
    this._addPart(waistGeo, obsidianDark, scaleWrapper, 0, 0.92, 0);

    // 2. Torso de Titán en "V" con Reactor Elemental grande expuesto en el pecho
    const chest = new THREE.Group();
    chest.position.set(0, 1.44, 0);
    scaleWrapper.add(chest);
    this._parts.core = chest;

    const torsoFrameProfile = [
      new THREE.Vector2(0.0, -0.48),
      new THREE.Vector2(0.46, -0.48),
      new THREE.Vector2(0.56, -0.14),
      new THREE.Vector2(0.74, 0.32),
      new THREE.Vector2(0.68, 0.48),
      new THREE.Vector2(0.0, 0.48),
    ];
    const torsoBackGeo = new THREE.LatheGeometry(torsoFrameProfile, 18);
    torsoBackGeo.scale(1.06, 1.0, 0.74);
    this._addPart(torsoBackGeo, obsidianMid, chest, 0, 0, -0.1, { outline: 0.014, castShadow: true });

    // Hombreras pectorales enmarcando la cavidad abierta del reactor
    const flankGeo = new THREE.BoxGeometry(0.36, 0.76, 0.42);
    for (const s of [-1, 1]) {
      this._addPart(flankGeo, obsidianDark, chest, s * 0.48, 0.06, 0.22, {
        rot: [0, s * 0.28, -s * 0.14],
        outline: 0.012,
      });
    }

    // Gran Reactor / Corazón Elemental Expuesto (pulsa y brilla más en Ataque en Área)
    const reactorGeo = new THREE.SphereGeometry(0.38, 22, 16);
    this._reactorMesh = this._addPart(reactorGeo, energyReactorMat, chest, 0, 0.08, 0.32, {
      noOutline: true,
    });
    const reactorAuraGeo = new THREE.SphereGeometry(0.52, 18, 14);
    this._addPart(reactorAuraGeo, energyShellMat, chest, 0, 0.08, 0.3, { noOutline: true });

    const reactorRingGeo = new THREE.TorusGeometry(0.42, 0.04, 8, 24);
    this._addPart(reactorRingGeo, crystalMat, chest, 0, 0.08, 0.34, { outline: 0.01 });

    // 3. Cabeza monolítica tallada con visera luminosa y corona de 5 espiras
    const head = new THREE.Group();
    head.position.set(0, 0.72, 0.12);
    chest.add(head);
    this._parts.head = head;

    const headGeo = createStoneSlab(0.42, 0.48, 0.42, 41.7, -0.18);
    this._addPart(headGeo, obsidianDark, head, 0, -0.18, 0, { outline: 0.012 });
    const visorGeo = new THREE.CapsuleGeometry(0.035, 0.22, 4, 8);
    visorGeo.rotateZ(Math.PI * 0.5);
    this._addPart(visorGeo, energyReactorMat, head, 0, 0.06, 0.22, { noOutline: true });

    const crown = new THREE.Group();
    crown.position.y = 0.34;
    head.add(crown);
    this._parts.crown = crown;
    for (let i = 0; i < 5; i++) {
      const a = ((i - 2) / 4) * Math.PI * 0.75;
      const spireGeo = createJaggedStalagmite(i === 2 ? 0.46 : 0.34, 0.085, i * 19 + 4);
      this._addPart(
        spireGeo,
        crystalMat,
        crown,
        Math.sin(a) * 0.18,
        0,
        Math.cos(a) * 0.08 - 0.04,
        { rot: [0, 0, -a * 0.45], outline: 0.01 }
      );
    }

    // 4. Corona dorsal de monolitos + Halo rúnico orbital (`AdditiveBlending`, SIN contorno negro)
    const dorsalGroup = new THREE.Group();
    dorsalGroup.position.set(0, 0.28, -0.34);
    chest.add(dorsalGroup);
    this._parts.orbitGroup = dorsalGroup;

    const haloGroup = createRuneHaloGroup(0.95, 8, 1.0);
    dorsalGroup.add(haloGroup.group);
    this._disposables.push(haloGroup);

    const dorsalSpireGeo = createJaggedStalagmite(0.62, 0.13, 91.3);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this._addPart(
        dorsalSpireGeo,
        crystalMat,
        dorsalGroup,
        Math.cos(a) * 1.02,
        Math.sin(a) * 1.02,
        0,
        { rot: [0, 0, a - Math.PI * 0.5], outline: 0.01 }
      );
    }

    // 5. Hombreras flotantes de monolito + Guanteletes reforzados con aura elemental en los puños
    const titanArmProfile = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.22, 0.0),
      new THREE.Vector2(0.28, -0.22),
      new THREE.Vector2(0.3, -0.52),
      new THREE.Vector2(0.22, -0.78),
      new THREE.Vector2(0.0, -0.78),
    ];
    const gauntletGeo = new THREE.LatheGeometry(titanArmProfile, 14);

    for (const [armKey, floatKey, s] of [
      ['armL', 'floatShoulderL', 1],
      ['armR', 'floatShoulderR', -1],
    ]) {
      const floatPad = new THREE.Group();
      floatPad.position.set(s * 0.98, 0.62, 0);
      chest.add(floatPad);
      this._parts[floatKey] = floatPad;

      const monolith = createTectonicShardCluster(0.76, 0.28, s * 31 + 11);
      monolith.group.rotation.z = -s * 0.38;
      floatPad.add(monolith.group);
      this._disposables.push(monolith);

      const floatCore = new THREE.SphereGeometry(0.18, 14, 10);
      this._addPart(floatCore, energyReactorMat, floatPad, 0, -0.1, 0.14, { noOutline: true });

      const arm = new THREE.Group();
      arm.position.set(s * 0.84, 0.28, 0.04);
      chest.add(arm);
      this._parts[armKey] = arm;

      this._addPart(gauntletGeo, obsidianDark, arm, s * 0.05, 0, 0, { castShadow: true });

      const fist = createRuggedBoulder(0.3, s * 23 + 2);
      fist.group.position.set(s * 0.06, -0.86, 0.08);
      arm.add(fist.group);
      this._disposables.push(fist);

      // Aura elemental brillante envolviendo el puño (SIN contorno negro)
      const fistAuraGeo = new THREE.SphereGeometry(0.4, 16, 12);
      this._addPart(fistAuraGeo, energyShellMat, arm, s * 0.06, -0.88, 0.1, { noOutline: true });
    }
  }

  // ====================================================================
  //  4. ESTADOS ALTERADOS Y TELEMETRÍA (Frozen, Burning, Rooted, Poisoned, Confused/Feared)
  // ====================================================================
  _buildFreezeCrystal() {
    const group = new THREE.Group();
    group.name = 'MonsterFreezeCrystal';
    group.visible = false;

    const iceMat = createToonMaterial('#5ce1ff', {
      flatShading: true,
      transparent: true,
      opacity: 0.62,
      emissive: '#22a8e6',
      emissiveIntensity: 0.28,
    });
    const scale = this.type === 'colossus' ? 1.55 : this.type === 'golem' ? 1.25 : 0.85;
    const core = new THREE.Mesh(this._trackGeo(new THREE.OctahedronGeometry(0.85 * scale, 0)), iceMat);
    core.scale.set(0.95, 1.4, 0.95);
    core.position.y = 1.15 * scale;
    addOutline(core, 0.014, 0x0b4b6b);
    group.add(core);

    this._disposables.push(iceMat);
    this.root.add(group);
    this._freezeCrystal = group;
  }

  _buildBurnFlames() {
    const baseY = this.type === 'colossus' ? 1.7 : this.type === 'golem' ? 1.4 : 1.25;
    const spread = this.type === 'colossus' ? 0.72 : this.type === 'golem' ? 0.56 : 0.34;
    const anchors = [
      { x: spread, y: baseY, z: 0.12 },
      { x: -spread, y: baseY, z: 0.12 },
      { x: 0, y: baseY + 0.25, z: -spread * 0.6 },
    ];
    for (let i = 0; i < anchors.length; i++) {
      const flame = createLayeredFlame(0.18, 0.58, i * 2.1 + 1, 0.16);
      flame.group.position.set(anchors[i].x, anchors[i].y, anchors[i].z);
      flame.group.visible = false;
      this.root.add(flame.group);
      this._burnFlames.push({ group: flame.group, flame, phase: i * 1.9 });
      this._disposables.push(flame);
    }
  }

  setFrozen(frozen) {
    this._isFrozen = !!frozen;
    if (this._freezeCrystal) this._freezeCrystal.visible = this._isFrozen;
    if (!this._isFrozen && this._hitFlash <= 0 && this._flash <= 0 && !this._isBurning) {
      for (const m of this.materials) m.emissiveIntensity = 0;
    }
  }

  setBurning(burning) {
    this._isBurning = !!burning;
    for (const bf of this._burnFlames) bf.group.visible = this._isBurning;
    if (!this._isBurning && this._hitFlash <= 0 && this._flash <= 0 && !this._isFrozen) {
      for (const m of this.materials) m.emissiveIntensity = 0;
    }
  }

  setRooted(rooted) {
    this._isRooted = !!rooted;
    if (this._isRooted && !this._rootGroup) {
      const group = new THREE.Group();
      group.name = 'MonsterRootVines';
      const scale = this.type === 'colossus' ? 1.65 : this.type === 'golem' ? 1.25 : 0.9;
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2 + 0.35;
        const cluster = createRootClusterGroup(0.75 * scale, 0.25 * scale, i + 2);
        cluster.group.position.set(Math.cos(ang) * 0.38 * scale, 0, Math.sin(ang) * 0.38 * scale);
        cluster.group.rotation.y = -ang;
        cluster.group.rotation.x = 0.14;
        group.add(cluster.group);
        this._disposables.push(cluster);
      }
      this.root.add(group);
      this._rootGroup = group;
    }
    if (this._rootGroup) {
      this._rootGroup.visible = this._isRooted;
    }
  }

  setPoisoned(poisoned) {
    this._isPoisoned = !!poisoned;
    if (this._isPoisoned && !this._poisonGroup) {
      const group = new THREE.Group();
      group.name = 'MonsterPoisonSpores';
      const sporeMat = this._makeEnergyMat({
        coreColor: '#f0fdf4',
        rimColor: NATURE_PALETTE.spore,
        opacity: 0.9,
        additive: true,
        softEdge: true,
        depthWrite: false,
      });
      const sporeGeo = this._trackGeo(new THREE.SphereGeometry(0.08, 10, 8));
      const scale = this.type === 'colossus' ? 1.5 : this.type === 'golem' ? 1.15 : 0.85;
      for (let i = 0; i < 8; i++) {
        const m = new THREE.Mesh(sporeGeo, sporeMat);
        m.userData.noOutline = true;
        group.add(m);
        this._poisonSpores.push({
          mesh: m,
          phase: (i / 8) * Math.PI * 2,
          speed: 1.0 + (i % 3) * 0.3,
          radius: (0.45 + (i % 3) * 0.14) * scale,
          baseHeight: 1.6 * scale,
          yOffset: (i / 8) * 1.4 * scale,
        });
      }
      this.root.add(group);
      this._poisonGroup = group;
    }
    if (this._poisonGroup) {
      this._poisonGroup.visible = this._isPoisoned;
    }
  }

  setConfused(confused) {
    this._isConfused = !!confused;
    if (this._isConfused && !this._confusedSpiral) {
      const sp = createHypnoticSpiralGroup();
      const topY = this.type === 'colossus' ? 3.2 : this.type === 'golem' ? 2.65 : 2.15;
      sp.group.position.set(0, topY, 0);
      this.root.add(sp.group);
      this._confusedSpiral = sp.group;
      this._disposables.push(sp);
    }
    if (this._confusedSpiral) {
      this._confusedSpiral.visible = this._isConfused;
    }
  }

  setFeared(feared) {
    this.setConfused(feared);
  }

  setStunned(stunned) {
    this._isStunned = !!stunned;
    if (this._isStunned && !this._stunStars) {
      const st = createLightStunStarsGroup(0.42);
      const topY = this.type === 'colossus' ? 3.25 : this.type === 'golem' ? 2.68 : 2.18;
      st.group.position.set(0, topY, 0);
      this.root.add(st.group);
      this._stunStars = st.group;
      this._disposables.push(st);
    }
    if (this._stunStars) {
      this._stunStars.visible = this._isStunned;
    }
  }

  setEarthOrbitRocks(count) {
    const next = Math.max(0, Math.min(3, Math.round(count || 0)));
    this._earthOrbitCount = next;
    if (next > 0 && !this._earthOrbitData) {
      const scale = this.type === 'colossus' ? 1.75 : this.type === 'golem' ? 1.35 : 0.95;
      const orb = createEarthOrbitRocksGroup(scale);
      this.root.add(orb.group);
      this._earthOrbitData = orb;
      this._disposables.push(orb);
    }
    if (this._earthOrbitData) {
      this._earthOrbitData.setCount(next);
    }
  }

  setEarthTrapped(trapped) {
    this._isEarthTrapped = !!trapped;
    if (this._isEarthTrapped && !this._earthTrapData) {
      const scale = this.type === 'colossus' ? 1.75 : this.type === 'golem' ? 1.35 : 0.95;
      const trap = createEarthRockTrapGroup(scale);
      this.root.add(trap.group);
      this._earthTrapData = trap;
      this._disposables.push(trap);
    }
    if (this._earthTrapData && this._earthTrapData.group) {
      this._earthTrapData.group.visible = this._isEarthTrapped;
    }
  }

  setTelegraphCharge(intensity = 0) {
    this._telegraphCharge = THREE.MathUtils.clamp(intensity, 0, 1);
  }

  setTeamRing() {
    // Los monstruos no requieren aro de equipo aliado
  }

  playAction(actionName, duration = 0.45) {
    this.action = { name: actionName, time: 0, duration };
  }

  flash(color = '#ffcf80') {
    this._flashColor = color;
    this._flash = 1;
  }

  flashHit() {
    this._hitFlash = 1;
  }

  update(dt, { state = 'idle', speed = 0 } = {}) {
    if (!this._isFrozen) {
      this.time += dt;

      for (const fn of this._animatedUpdatables) {
        fn(this.time, dt);
      }

      if (this.type === 'spirit') {
        const core = this._parts.core;
        if (core) {
          core.position.y = 1.28 + Math.sin(this.time * 3.8) * 0.16;
          core.rotation.z = Math.sin(this.time * 2.4) * 0.08;
        }
        if (this._spiritTail) {
          this._spiritTail.rotation.y = Math.sin(this.time * 5.2) * 0.22;
          this._spiritTail.rotation.x = Math.cos(this.time * 4.1) * 0.1;
        }
        if (this._parts.orbitGroup) {
          this._parts.orbitGroup.rotation.y += dt * 2.8;
        }
        if (this._parts.crown) {
          this._parts.crown.rotation.y -= dt * 1.4;
        }
      } else {
        const strideFreq = speed > 0.6 ? 7.5 : 2.2;
        const swing = speed > 0.6 ? Math.sin(this.time * strideFreq) * 0.42 : Math.sin(this.time * 2.2) * 0.06;
        if (this._parts.legL) this._parts.legL.rotation.x = swing;
        if (this._parts.legR) this._parts.legR.rotation.x = -swing;
        if (this._parts.armL) this._parts.armL.rotation.x = -swing * 0.7;
        if (this._parts.armR) this._parts.armR.rotation.x = swing * 0.7;

        if (this._parts.orbitGroup) {
          this._parts.orbitGroup.rotation.z += dt * 1.25;
        }
        if (this._parts.floatShoulderL) {
          this._parts.floatShoulderL.position.y = 0.62 + Math.sin(this.time * 3.1) * 0.08;
        }
        if (this._parts.floatShoulderR) {
          this._parts.floatShoulderR.position.y = 0.62 + Math.cos(this.time * 3.1) * 0.08;
        }
      }

      if (this._reactorMesh) {
        const pulse = 1 + Math.sin(this.time * 6.0) * 0.06 + this._telegraphCharge * 0.28;
        this._reactorMesh.scale.setScalar(pulse);
      }

      if (this.action) {
        this.action.time += dt;
        const u = this.action.time / this.action.duration;
        if (u >= 1) {
          this.action = null;
          this.bodyPivot.rotation.x = 0;
          this.bodyPivot.position.y = 0;
        } else if (this.action.name === 'stomp_seismic' || this.action.name === 'heavy_throw') {
          const raise = u < 0.72 ? u / 0.72 : 1 - (u - 0.72) / 0.28;
          if (this._parts.armL) this._parts.armL.rotation.x = -raise * 1.9;
          if (this._parts.armR) this._parts.armR.rotation.x = -raise * 1.9;
          this.bodyPivot.rotation.x = u > 0.72 ? 0.22 : -0.14 * raise;
        } else if (this.action.name === 'hit_react') {
          this.bodyPivot.rotation.x = -Math.sin(u * Math.PI) * 0.25;
        } else if (this.action.name === 'punch_right') {
          if (this._parts.armR) this._parts.armR.rotation.x = -Math.sin(u * Math.PI) * 1.45;
        }
      }
      if (state === 'dash') {
        this.bodyPivot.rotation.x = 0.24;
      } else if (!this.action) {
        this.bodyPivot.rotation.x *= Math.exp(-10 * dt);
      }
    }

    if (this._isBurning) {
      const fT = this.time * 16;
      for (const bf of this._burnFlames) {
        bf.group.scale.set(1, 0.85 + 0.3 * Math.sin(fT + bf.phase), 1);
        if (bf.flame && bf.flame.update) bf.flame.update(this.time, bf.phase);
      }
    }

    if (this._isPoisoned && this._poisonGroup) {
      for (const sp of this._poisonSpores) {
        const y = (sp.yOffset + this.time * sp.speed) % sp.baseHeight;
        const ang = sp.phase + this.time * 1.8;
        sp.mesh.position.set(Math.cos(ang) * sp.radius, y, Math.sin(ang) * sp.radius);
        const s = 0.75 + Math.sin(this.time * 8 + sp.phase) * 0.25;
        sp.mesh.scale.setScalar(s);
      }
    }

    if (this._isConfused && this._confusedSpiral) {
      this._confusedSpiral.rotation.y += dt * 5.6;
    }
    if (this._isStunned && this._stunStars) {
      this._stunStars.rotation.y -= dt * 6.4;
    }
    if ((this._earthOrbitCount || 0) > 0 && this._earthOrbitData) {
      this._earthOrbitData.update(dt, this.time);
    }

    // Brillo energético del reactor / núcleo en energía VFX
    const glowBoost = 1.15 + this._telegraphCharge * 0.95 + this._hitFlash * 1.1;
    for (const em of this._energyMats) {
      if (em.uniforms?.uGlowBoost) {
        em.uniforms.uGlowBoost.value = glowBoost;
      }
    }

    if (this._hitFlash > 0) {
      this._hitFlash = Math.max(0, this._hitFlash - dt * 4.5);
      const t = this._hitFlash;
      for (const m of this.materials) {
        m.emissive.setRGB(1.0, 0.25 + 0.7 * t, 0.2 + 0.7 * t);
        m.emissiveIntensity = t * 2.8;
      }
    } else if (this._flash > 0) {
      this._flash = Math.max(0, this._flash - dt * 1.6);
      for (const m of this.materials) {
        m.emissive.set(this._flashColor);
        m.emissiveIntensity = this._flash * this._flash * 2.2;
      }
    } else if (this._isFrozen) {
      for (const m of this.materials) {
        m.emissive.set('#4de2ff');
        m.emissiveIntensity = 0.45;
      }
    } else if (this._isBurning) {
      for (const m of this.materials) {
        m.emissive.set('#ff6a14');
        m.emissiveIntensity = 0.26;
      }
    } else {
      for (const m of this.materials) {
        if (m.emissiveIntensity > 0.7) m.emissiveIntensity = 0.35;
      }
    }
  }

  dispose() {
    for (const d of this._disposables) {
      if (d && d.dispose) d.dispose();
    }
    this._disposables.length = 0;
  }
}
