import * as THREE from 'three';

/**
 * ProceduralTextures
 * ----------------------------------------------------------------------
 * Generador y caché de texturas `CanvasTexture` reutilizables con soporte de
 * `RepeatWrapping` y filtrado anisotrópico para enriquecer superficies 3D
 * (piedra labrada, madera con vetas/zunchos, tejas curvas asiáticas, agua
 * animada, césped con pétalos y suelos/estandartes) a 60 FPS.
 */

const _textureCache = new Map();

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finalizeTexture(canvas, { srgb = true, repeatX = 1, repeatY = 1, wrap = true, anisotropy = 4 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (wrap) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
  }
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Piedra labrada con juntas de mortero, biseles luminosos y desgaste sutil.
 */
export function createCutStoneTexture({
  baseColor = '#66707d',
  mortarColor = '#28303a',
  highlightColor = '#8d9bae',
  cols = 4,
  rows = 4,
  repeatX = 1,
  repeatY = 1,
  seed = 17,
  withBump = false,
} = {}) {
  const key = `stone|${baseColor}|${mortarColor}|${highlightColor}|${cols}|${rows}|${repeatX}|${repeatY}|${seed}|${withBump}`;
  if (_textureCache.has(key)) return _textureCache.get(key);

  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const rng = mulberry32(seed);

  let bumpCv = null;
  let b = null;
  if (withBump) {
    bumpCv = document.createElement('canvas');
    bumpCv.width = bumpCv.height = size;
    b = bumpCv.getContext('2d');
    b.fillStyle = '#909090';
    b.fillRect(0, 0, size, size);
  }

  g.fillStyle = baseColor;
  g.fillRect(0, 0, size, size);

  const cellW = size / cols;
  const cellH = size / rows;

  // Variación tonal por sillar alternando hiladas desfasadas
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (cellW * 0.5);
    for (let c = -1; c <= cols; c++) {
      const x = c * cellW + offset;
      const y = r * cellH;
      const delta = (rng() - 0.5) * 0.16;
      g.fillStyle = delta >= 0
        ? `rgba(255,250,240,${delta.toFixed(3)})`
        : `rgba(18,22,28,${(-delta).toFixed(3)})`;
      g.fillRect(x + 3, y + 3, cellW - 6, cellH - 6);

      // Filo superior iluminado estilo anime cel-shaded
      g.strokeStyle = highlightColor;
      g.globalAlpha = 0.28;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x + 4, y + 5);
      g.lineTo(x + cellW - 4, y + 5);
      g.stroke();
      g.globalAlpha = 1;

      // Grietas o desgaste leve en algunas piedras
      if (rng() > 0.62) {
        g.strokeStyle = mortarColor;
        g.globalAlpha = 0.35;
        g.lineWidth = 2;
        g.beginPath();
        const sx = x + cellW * (0.25 + rng() * 0.5);
        const sy = y + cellH * (0.2 + rng() * 0.3);
        g.moveTo(sx, sy);
        g.lineTo(sx + (rng() - 0.5) * 26, sy + 14 + rng() * 20);
        g.stroke();
        g.globalAlpha = 1;
      }

      // Junta de mortero
      g.strokeStyle = mortarColor;
      g.lineWidth = 5;
      g.strokeRect(x, y, cellW, cellH);

      if (b) {
        b.strokeStyle = '#2c2c2c';
        b.lineWidth = 6;
        b.strokeRect(x, y, cellW, cellH);
      }
    }
  }

  // Manchas suaves de erosión mineral
  for (let i = 0; i < 140; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const rad = 8 + rng() * 28;
    g.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(20,24,30,0.05)';
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }

  const colorMap = finalizeTexture(cv, { srgb: true, repeatX, repeatY });
  const result = withBump
    ? { colorMap, bumpMap: finalizeTexture(bumpCv, { srgb: false, repeatX, repeatY }) }
    : colorMap;
  _textureCache.set(key, result);
  return result;
}

/**
 * Madera estilizada con duelas/tablones, vetas onduladas y zunchos metálicos remachados opcionales.
 */
export function createWoodPlankTexture({
  baseColor = '#9b6336',
  grainColor = '#5e3819',
  highlightColor = '#c48652',
  planks = 8,
  withHoops = false,
  repeatX = 1,
  repeatY = 1,
  seed = 23,
} = {}) {
  const key = `wood|${baseColor}|${grainColor}|${highlightColor}|${planks}|${withHoops}|${repeatX}|${repeatY}|${seed}`;
  if (_textureCache.has(key)) return _textureCache.get(key);

  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const rng = mulberry32(seed);

  g.fillStyle = baseColor;
  g.fillRect(0, 0, size, size);

  const plankW = size / planks;
  for (let p = 0; p < planks; p++) {
    const x = p * plankW;
    const shade = (rng() - 0.5) * 0.14;
    g.fillStyle = shade >= 0
      ? `rgba(255,220,175,${shade.toFixed(3)})`
      : `rgba(38,20,8,${(-shade).toFixed(3)})`;
    g.fillRect(x, 0, plankW, size);

    // Vetas longitudinales curvas
    for (let k = 0; k < 5; k++) {
      const gx = x + 6 + rng() * (plankW - 12);
      g.strokeStyle = k % 2 === 0 ? grainColor : highlightColor;
      g.globalAlpha = k % 2 === 0 ? 0.36 : 0.22;
      g.lineWidth = 2 + rng() * 2;
      g.beginPath();
      g.moveTo(gx, 0);
      g.bezierCurveTo(
        gx + (rng() - 0.5) * 14,
        size * 0.33,
        gx + (rng() - 0.5) * 14,
        size * 0.66,
        gx,
        size
      );
      g.stroke();
    }
    g.globalAlpha = 1;

    // Nudo ocasional de madera
    if (rng() > 0.55) {
      const kx = x + plankW * (0.3 + rng() * 0.4);
      const ky = size * (0.2 + rng() * 0.6);
      g.strokeStyle = grainColor;
      g.globalAlpha = 0.42;
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(kx, ky, 5, 11, 0, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }

    // Junta entre duelas/tablones
    g.fillStyle = grainColor;
    g.fillRect(x - 1.5, 0, 3, size);
  }

  // Zunchos de hierro remachados integrados en la textura si es barril
  if (withHoops) {
    for (const bandY of [size * 0.22, size * 0.78]) {
      g.fillStyle = '#2d343e';
      g.fillRect(0, bandY - 18, size, 36);
      g.fillStyle = '#4c5766';
      g.fillRect(0, bandY - 14, size, 6);
      g.fillStyle = '#181c22';
      g.fillRect(0, bandY + 12, size, 6);
      // Remaches metálicos por cada duela
      for (let p = 0; p < planks; p++) {
        const rx = (p + 0.5) * plankW;
        g.fillStyle = '#8b96a6';
        g.beginPath();
        g.arc(rx, bandY, 5, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  const tex = finalizeTexture(cv, { srgb: true, repeatX, repeatY });
  _textureCache.set(key, tex);
  return tex;
}

/**
 * Tejas curvas asiáticas esmaltadas (*kawara*) con reflejo de esmalte superior.
 */
export function createAsianRoofTileTexture({
  baseColor = '#31465c',
  ridgeColor = '#517191',
  shadeColor = '#1c2938',
  repeatX = 4,
  repeatY = 3,
  seed = 31,
} = {}) {
  const key = `tiles|${baseColor}|${ridgeColor}|${shadeColor}|${repeatX}|${repeatY}|${seed}`;
  if (_textureCache.has(key)) return _textureCache.get(key);

  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const rng = mulberry32(seed);

  g.fillStyle = baseColor;
  g.fillRect(0, 0, size, size);

  const rows = 8;
  const cols = 10;
  const rH = size / rows;
  const cW = size / cols;

  for (let r = 0; r < rows; r++) {
    const y = r * rH;
    // Sombra bajo cada hilada de tejas
    g.fillStyle = shadeColor;
    g.globalAlpha = 0.45;
    g.fillRect(0, y + rH - 8, size, 8);
    g.globalAlpha = 1;

    for (let c = 0; c < cols; c++) {
      const x = c * cW;
      const tone = (rng() - 0.5) * 0.12;
      if (tone > 0) {
        g.fillStyle = `rgba(255,255,255,${tone.toFixed(3)})`;
        g.fillRect(x + 2, y + 2, cW - 4, rH - 10);
      }

      // Canal curvo vertical y borde inferior festoneado
      g.strokeStyle = ridgeColor;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(x + cW * 0.5, y);
      g.lineTo(x + cW * 0.5, y + rH);
      g.stroke();

      g.strokeStyle = shadeColor;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(x + cW * 0.5, y + rH - 10, cW * 0.48, 0.15, Math.PI - 0.15);
      g.stroke();
    }
  }

  const tex = finalizeTexture(cv, { srgb: true, repeatX, repeatY });
  _textureCache.set(key, tex);
  return tex;
}

/**
 * Agua estilizada Cel-Shaded con cáusticas en red, estelas y espuma para animar en `update(dt)`.
 */
export function createStylizedWaterTexture({
  baseColor = '#25aef2',
  deepColor = '#198bd4',
  foamColor = '#effcff',
  repeatX = 2.5,
  repeatY = 2.5,
  seed = 314,
} = {}) {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const rng = mulberry32(seed);

  g.fillStyle = baseColor;
  g.fillRect(0, 0, size, size);

  // Manchas profundas suaves
  for (let i = 0; i < 24; i++) {
    g.fillStyle = deepColor;
    g.globalAlpha = 0.25;
    g.beginPath();
    g.ellipse(rng() * size, rng() * size, 32 + rng() * 54, 18 + rng() * 34, rng() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  // Cáusticas celulares en patrón envolvente 3x3 para tiling perfecto
  g.strokeStyle = 'rgba(182, 244, 255, 0.52)';
  g.lineWidth = 4.5;
  const nodes = [];
  for (let i = 0; i < 18; i++) {
    nodes.push({ x: rng() * size, y: rng() * size, r: 28 + rng() * 34 });
  }
  for (const n of nodes) {
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        g.beginPath();
        g.arc(n.x + ox, n.y + oy, n.r, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }

  // Líneas de corriente y destellos de espuma blanca estilizada
  for (let i = 0; i < 26; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const w = 44 + rng() * 75;
    g.strokeStyle = foamColor;
    g.globalAlpha = 0.62;
    g.lineWidth = 3.5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + w * 0.5, y - 9, x + w, y);
    g.stroke();
  }
  g.globalAlpha = 1;

  return finalizeTexture(cv, { srgb: true, repeatX, repeatY });
}

/**
 * Césped vibrante con matas de hierba y pétalos de cerezo/espíritu estilizados.
 */
export function createGrassAndPetalsTexture({
  baseColor = '#4aa84f',
  darkGreen = '#35853d',
  lightGreen = '#79db62',
  petalColors = ['#ffd6e7', '#fff5bf', '#d7ffcf'],
  repeatX = 2,
  repeatY = 2,
  seed = 41,
} = {}) {
  const key = `grass|${baseColor}|${darkGreen}|${lightGreen}|${repeatX}|${repeatY}|${seed}`;
  if (_textureCache.has(key)) return _textureCache.get(key);

  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const rng = mulberry32(seed);

  g.fillStyle = baseColor;
  g.fillRect(0, 0, size, size);

  for (let i = 0; i < 80; i++) {
    g.fillStyle = i % 2 === 0 ? darkGreen : lightGreen;
    g.globalAlpha = 0.34;
    g.beginPath();
    g.ellipse(rng() * size, rng() * size, 12 + rng() * 28, 8 + rng() * 20, rng() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  // Briznas estilizadas en 'V'
  for (let i = 0; i < 160; i++) {
    const x = rng() * size;
    const y = rng() * size;
    g.strokeStyle = i % 3 === 0 ? lightGreen : darkGreen;
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - 4, y - 9);
    g.moveTo(x, y);
    g.lineTo(x + 4, y - 8);
    g.stroke();
  }

  // Pétalos dispersos
  for (let i = 0; i < 56; i++) {
    const x = rng() * size;
    const y = rng() * size;
    g.fillStyle = petalColors[i % petalColors.length];
    g.beginPath();
    g.ellipse(x, y, 4.5, 2.5, rng() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }

  const tex = finalizeTexture(cv, { srgb: true, repeatX, repeatY });
  _textureCache.set(key, tex);
  return tex;
}

/**
 * Suelo radial monumental del Coliseo de la Arena Clásica (piedra pizarra labrada,
 * anillos concéntricos grabados, emblema central y chevrons perimetrales).
 */
export function createColiseumFloorTextures(R = 30) {
  const key = `coliseum_floor|${R}`;
  if (_textureCache.has(key)) return _textureCache.get(key);

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

  g.fillStyle = '#5c6673';
  g.fillRect(0, 0, size, size);
  b.fillStyle = '#808080';
  b.fillRect(0, 0, size, size);

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
  for (let i = 0; i < 36000; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const v = rng();
    g.fillStyle = v > 0.5 ? 'rgba(180,195,212,0.10)' : 'rgba(25,30,38,0.14)';
    g.fillRect(x, y, 2, 2);
    b.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
    b.fillRect(x, y, 2, 2);
  }

  const ringRadii = [5.5, 10.5, 16.5, 22.5, 26.2, 28.1];
  const drawGroove = (ctx, stroke, width) => {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  for (let ri = 0; ri < ringRadii.length - 1; ri++) {
    const r0 = ringRadii[ri] * scale;
    const r1 = ringRadii[ri + 1] * scale;
    const segs = 12 + ri * 6;
    const offset = rng() * Math.PI;
    for (let s = 0; s < segs; s++) {
      const a = offset + (s / segs) * Math.PI * 2;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
      drawGroove(g, 'rgba(26,32,40,0.65)', 3.5);
      b.beginPath();
      b.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      b.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
      drawGroove(b, '#3e3e3e', 4);
    }
  }

  for (const rr of ringRadii) {
    const r = rr * scale;
    g.beginPath();
    g.arc(c, c, r, 0, Math.PI * 2);
    drawGroove(g, 'rgba(22,28,36,0.85)', 10);
    g.beginPath();
    g.arc(c, c, r + 6, 0, Math.PI * 2);
    drawGroove(g, 'rgba(218,175,98,0.45)', 2.5);

    b.beginPath();
    b.arc(c, c, r, 0, Math.PI * 2);
    drawGroove(b, '#1e1e1e', 10);
  }

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

  const emb = 4.6 * scale;
  g.save();
  g.translate(c, c);
  g.fillStyle = 'rgba(208,150,52,0.84)';
  g.beginPath();
  g.arc(0, 0, emb, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(28,34,42,0.9)';
  g.lineWidth = 10;
  g.stroke();
  g.rotate(Math.PI / 4);
  g.fillStyle = 'rgba(72,82,94,0.92)';
  g.fillRect(-emb * 0.56, -emb * 0.56, emb * 1.12, emb * 1.12);
  g.fillStyle = 'rgba(232,182,78,0.92)';
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

  const dr0 = 28.0 * scale;
  const dr1 = 29.8 * scale;
  g.beginPath();
  g.arc(c, c, (dr0 + dr1) / 2, 0, Math.PI * 2);
  drawGroove(g, 'rgba(198,142,48,0.88)', dr1 - dr0);
  const marks = 80;
  for (let s = 0; s < marks; s++) {
    const a = (s / marks) * Math.PI * 2;
    const w = ((Math.PI * 2) / marks) * 0.32;
    g.fillStyle = s % 2 === 0 ? 'rgba(186,52,32,0.9)' : 'rgba(52,60,72,0.9)';
    g.beginPath();
    g.moveTo(c + Math.cos(a - w) * dr0, c + Math.sin(a - w) * dr0);
    g.lineTo(c + Math.cos(a) * dr1, c + Math.sin(a) * dr1);
    g.lineTo(c + Math.cos(a + w) * dr0, c + Math.sin(a + w) * dr0);
    g.closePath();
    g.fill();
  }
  g.beginPath();
  g.arc(c, c, 29.88 * scale, 0, Math.PI * 2);
  drawGroove(g, 'rgba(26,32,40,0.95)', 0.32 * scale);

  const result = {
    colorMap: finalizeTexture(color, { srgb: true, wrap: false, anisotropy: 8 }),
    bumpMap: finalizeTexture(bump, { srgb: false, wrap: false, anisotropy: 8 }),
  };
  _textureCache.set(key, result);
  return result;
}

/**
 * Textura sutil de tejido textil neutral (escala de blancos/grises suaves)
 * diseñada para multiplicarse limpio con `.color` de túnicas, pantalones y
 * fajines sin alterar el matiz ni oscurecer los colores anime/cel-shaded.
 */
export function createFabricWeaveTexture({
  repeatX = 4,
  repeatY = 4,
  contrast = 0.085,
  seed = 109,
} = {}) {
  const key = `fabric|${repeatX}|${repeatY}|${contrast}|${seed}`;
  if (_textureCache.has(key)) return _textureCache.get(key);

  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const rng = mulberry32(seed);

  // Base blanca cálida neutra para preservar fidelidad cromática al tintar en MeshToonMaterial
  g.fillStyle = '#fcfcfc';
  g.fillRect(0, 0, size, size);

  const c = Math.max(0.02, Math.min(0.22, contrast));
  const step = 8;

  // Trama horizontal y urdimbre vertical con alternancia de hilo suave (tejido tipo lino/seda marcial)
  for (let y = 0; y < size; y += step) {
    const shade = Math.round(255 - (rng() * 0.65 + 0.35) * c * 210);
    g.fillStyle = `rgba(${shade},${shade},${shade},0.42)`;
    g.fillRect(0, y, size, 3);
    g.fillStyle = `rgba(255,255,255,0.32)`;
    g.fillRect(0, y + 3, size, 1.5);
  }

  for (let x = 0; x < size; x += step) {
    const shade = Math.round(255 - (rng() * 0.65 + 0.35) * c * 210);
    g.fillStyle = `rgba(${shade},${shade},${shade},0.36)`;
    g.fillRect(x, 0, 3, size);
    g.fillStyle = `rgba(255,255,255,0.28)`;
    g.fillRect(x + 3, 0, 1.5, size);
  }

  // Ligero patrón diagonal de sarga y fibras orgánicas repetibles en mosaico
  g.strokeStyle = `rgba(218,220,224,${(c * 1.45).toFixed(3)})`;
  g.lineWidth = 1.2;
  for (let i = -size; i < size * 2; i += 16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + size, size);
    g.stroke();
  }

  const tex = finalizeTexture(cv, { srgb: true, repeatX, repeatY, anisotropy: 4 });
  _textureCache.set(key, tex);
  return tex;
}
