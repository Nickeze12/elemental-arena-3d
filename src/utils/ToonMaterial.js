import * as THREE from 'three';

/**
 * ToonMaterial
 * ------------------------------------------------------------
 * Sistema de sombreado Cel-Shaded / Anime:
 *  - `getToonGradientMap()`: DataTexture 1D de 3 tonos luminosos
 *    (`[0.55, 0.82, 1.0]`, sin sombras negras) con filtrado `NearestFilter`.
 *  - `createToonMaterial(color, extra)`: instancia un `THREE.MeshToonMaterial`
 *    (soporta `flatShading: true` para rocas facetadas).
 *  - `createEnergyVFXMaterial(options)`: ShaderMaterial orgánico/volumétrico para
 *    fluidos y energía (fuego, agua líquida, viento, niebla, rayos, esporas y aura
 *    psíquica), con gradiente Fresnel suave y SIN contorno negro de tinta.
 *  - `addOutline(mesh, thickness = 0.012, color = 0x1b2028)`: añade un contorno
 *    fino de tinta gris-azulado oscuro (`THREE.BackSide`) solo a materia sólida.
 */

let sharedGradientMap = null;
const outlineMaterials = new Map();

/**
 * Devuelve la textura de gradiente de 3 tonos luminosos `[0.55, 0.82, 1.0]`.
 * @returns {THREE.DataTexture}
 */
export function getToonGradientMap() {
  if (sharedGradientMap) return sharedGradientMap;

  const s0 = Math.round(0.55 * 255); // 140: sombra clara y limpia
  const s1 = Math.round(0.82 * 255); // 209: tono medio luminoso
  const s2 = 255;                    // 255: luz plena
  const data = new Uint8Array([
    s0, s0, s0, 255,
    s1, s1, s1, 255,
    s2, s2, s2, 255,
  ]);

  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  sharedGradientMap = tex;
  return tex;
}

/**
 * Crea un `THREE.MeshToonMaterial` con el gradiente de 3 tonos luminosos.
 * Soporta `flatShading: true` para geometrías de roca facetada.
 * @param {THREE.ColorRepresentation} color
 * @param {object} [extra]
 * @returns {THREE.MeshToonMaterial}
 */
export function createToonMaterial(color, extra = {}) {
  const { flatShading = false, ...rest } = extra;
  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: getToonGradientMap(),
    emissive: '#ffcf80',
    emissiveIntensity: 0,
    flatShading: !!flatShading,
    ...rest,
  });
  mat.userData.flatShading = !!flatShading;
  return mat;
}

/**
 * Crea un ShaderMaterial orgánico sin contorno negro para fluidos, llamas, viento,
 * esporas, niebla, rayos y energía psíquica.
 * Soporta gradiente núcleo -> borde (Fresnel), desvanecimiento suave de bordes
 * (`softEdge`), desvanecimiento en extremos UV (`fadeEnds`), textura opcional (`map`)
 * y `AdditiveBlending` para núcleos incandescentes.
 *
 * @param {object} [options]
 * @param {THREE.ColorRepresentation} [options.coreColor='#ffffff']
 * @param {THREE.ColorRepresentation} [options.rimColor='#ff8800']
 * @param {number} [options.opacity=0.88]
 * @param {boolean} [options.additive=false]
 * @param {boolean} [options.flatShading=false]
 * @param {number} [options.fresnelPower=2.0]
 * @param {number} [options.rimIntensity=1.0]
 * @param {boolean} [options.softEdge=false] si es true, los bordes rasantes se desvanecen suavemente (ideal para niebla/nubes)
 * @param {boolean} [options.fadeEnds=false] si es true, atenúa alfa cerca de uv.x = 0 y 1 (cintas de viento/agua)
 * @param {boolean} [options.fadeEndsY=false] si es true, atenúa alfa cerca de uv.y = 0 y 1
 * @param {THREE.Texture|null} [options.map=null]
 * @param {number} [options.mapStrength=0.55]
 * @param {THREE.Side} [options.side=THREE.DoubleSide]
 * @param {boolean} [options.depthWrite=false]
 * @returns {THREE.ShaderMaterial}
 */
export function createEnergyVFXMaterial(options = {}) {
  const {
    coreColor = '#ffffff',
    rimColor = '#ff8800',
    opacity = 0.88,
    additive = false,
    flatShading = false,
    fresnelPower = 2.0,
    rimIntensity = 1.0,
    softEdge = false,
    fadeEnds = false,
    fadeEndsY = false,
    map = null,
    mapStrength = 0.55,
    side = THREE.DoubleSide,
    depthWrite = false,
  } = options;

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uCoreColor: { value: new THREE.Color(coreColor) },
      uRimColor: { value: new THREE.Color(rimColor) },
      uOpacity: { value: opacity },
      uFresnelPower: { value: fresnelPower },
      uRimIntensity: { value: rimIntensity },
      uSoftEdge: { value: softEdge ? 1.0 : 0.0 },
      uFadeEndsX: { value: fadeEnds ? 1.0 : 0.0 },
      uFadeEndsY: { value: fadeEndsY ? 1.0 : 0.0 },
      uHasMap: { value: map ? 1.0 : 0.0 },
      uMap: { value: map },
      uMapStrength: { value: mapStrength },
      uMapOffset: { value: new THREE.Vector2(0, 0) },
      uMapRepeat: { value: new THREE.Vector2(1, 1) },
      uGlowBoost: { value: additive ? 1.25 : 1.08 },
    },
  ]);

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: !!depthWrite,
    side,
    fog: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: /* glsl */ `
      varying vec3 vNormalView;
      varying vec3 vViewPos;
      varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vNormalView = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCoreColor;
      uniform vec3 uRimColor;
      uniform float uOpacity;
      uniform float uFresnelPower;
      uniform float uRimIntensity;
      uniform float uSoftEdge;
      uniform float uFadeEndsX;
      uniform float uFadeEndsY;
      uniform float uHasMap;
      uniform sampler2D uMap;
      uniform float uMapStrength;
      uniform vec2 uMapOffset;
      uniform vec2 uMapRepeat;
      uniform float uGlowBoost;

      varying vec3 vNormalView;
      varying vec3 vViewPos;
      varying vec2 vUv;
      #include <fog_pars_fragment>

      void main() {
        vec3 n = normalize(vNormalView);
        vec3 v = normalize(vViewPos);
        float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
        float fresnel = pow(1.0 - ndv, uFresnelPower);

        vec3 col = mix(uCoreColor, uRimColor, clamp(fresnel * uRimIntensity, 0.0, 1.0));
        float alpha = uOpacity;

        if (uHasMap > 0.5) {
          vec2 texUv = vUv * uMapRepeat + uMapOffset;
          vec4 texCol = texture2D(uMap, texUv);
          col = mix(col, texCol.rgb * 1.15 + uRimColor * 0.2, uMapStrength);
          alpha *= mix(1.0, texCol.a, 0.55);
        }

        if (uSoftEdge > 0.5) {
          // Desvanecimiento suave hacia los bordes silueta (sin cortes duros)
          alpha *= pow(ndv, 0.72);
        } else {
          alpha *= mix(0.88, 1.08, fresnel * 0.65);
        }

        if (uFadeEndsX > 0.5) {
          alpha *= smoothstep(0.0, 0.14, vUv.x) * (1.0 - smoothstep(0.84, 1.0, vUv.x));
        }
        if (uFadeEndsY > 0.5) {
          alpha *= smoothstep(0.0, 0.16, vUv.y) * (1.0 - smoothstep(0.82, 1.0, vUv.y));
        }

        col *= uGlowBoost;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });

  // Proxies compatibles para lecturas/escrituras de opacidad o color desde controladores existentes
  Object.defineProperty(mat, 'opacity', {
    get() {
      return uniforms.uOpacity.value;
    },
    set(val) {
      uniforms.uOpacity.value = val;
    },
  });
  Object.defineProperty(mat, 'color', {
    get() {
      return uniforms.uCoreColor.value;
    },
  });

  mat.userData.isEnergyVFX = true;
  mat.userData.noOutline = true;
  mat.userData.flatShading = !!flatShading;
  return mat;
}

function getOutlineMaterial(thickness = 0.012, color = 0x1b2028, useOutlineNormal = false) {
  const hex = new THREE.Color(color).getHexString();
  const key = `${thickness.toFixed(4)}_${hex}_${useOutlineNormal ? 's' : 'n'}`;
  let mat = outlineMaterials.get(key);
  if (mat) return mat;

  mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uThickness: { value: thickness },
        uColor: { value: new THREE.Color(color) },
      },
    ]),
    vertexShader: /* glsl */ `
      uniform float uThickness;
      ${useOutlineNormal ? 'attribute vec3 outlineNormal;' : ''}
      #include <fog_pars_vertex>
      void main() {
        vec3 n = normalize(${useOutlineNormal ? 'outlineNormal' : 'normal'});
        vec3 displaced = position + n * uThickness;
        vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      #include <fog_pars_fragment>
      void main() {
        gl_FragColor = vec4(uColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });

  outlineMaterials.set(key, mat);
  return mat;
}

/**
 * Añade un contorno fino estilo anime (`THREE.BackSide`) alrededor de un Mesh o Group.
 * @param {THREE.Object3D} target
 * @param {number} [thickness=0.012] grosor fino por defecto (usar ~0.014 en rocas)
 * @param {THREE.ColorRepresentation} [color=0x1b2028] tinta gris-azulado oscuro
 */
export function addOutline(target, thickness = 0.012, color = 0x1b2028) {
  if (!target) return target;

  const applyToMesh = (mesh) => {
    if (!mesh.isMesh || mesh.userData.isOutline || mesh.userData.noOutline) return;
    if (mesh.material?.userData?.noOutline || mesh.material?.userData?.isEnergyVFX) return;
    for (const c of mesh.children) {
      if (c.userData && c.userData.isOutline) return;
    }
    const hasSmoothAttr = !!(mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.outlineNormal);
    const outlineMat = getOutlineMaterial(thickness, color, hasSmoothAttr);
    const outlineMesh = new THREE.Mesh(mesh.geometry, outlineMat);
    outlineMesh.name = `${mesh.name || 'Mesh'}_Outline`;
    outlineMesh.userData.isOutline = true;
    outlineMesh.castShadow = false;
    outlineMesh.receiveShadow = false;
    outlineMesh.raycast = () => {};
    mesh.add(outlineMesh);
  };

  if (target.isMesh) {
    applyToMesh(target);
  } else {
    target.traverse((child) => {
      if (child.isMesh) applyToMesh(child);
    });
  }
  return target;
}
