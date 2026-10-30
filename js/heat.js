// ============================================================================
//  彩田公园 · 热力图图层（纯密度，不渲染业务明细）
// ============================================================================
import * as THREE from 'three';
import { groundHeight, surfaceAt, PATHS, pathDist, distToPolyline } from './terrain.js?v=3';

const W = 300, D = 250;                 // 世界范围
const X0 = -150, Z0 = -115;
const RES = 300;                        // 场分辨率
const CW = 300, CH = 250;               // 画布分辨率

export const RAMPS = {
  people: {
    stops: [
      [0.00, [0, 0, 0, 0]],
      [0.12, [43, 108, 255, 120]],
      [0.32, [0, 200, 255, 170]],
      [0.52, [57, 224, 138, 200]],
      [0.70, [255, 226, 77, 205]],
      [0.85, [255, 138, 59, 225]],
      [1.00, [255, 59, 48, 245]]
    ],
    min: '0 人/㎡', mid: '0.6', max: '1.5+'
  },
  event: {
    stops: [
      [0.00, [0, 0, 0, 0]],
      [0.14, [108, 76, 255, 130]],
      [0.42, [255, 95, 109, 195]],
      [0.70, [255, 176, 32, 210]],
      [1.00, [255, 240, 180, 240]]
    ],
    min: '0 起/㎡', mid: '0.4', max: '1.2+'
  }
};

function rampColor(ramp, t) {
  const s = ramp.stops;
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < s.length - 1; i++) {
    if (t <= s[i + 1][0]) {
      const f = (t - s[i][0]) / (s[i + 1][0] - s[i][0] || 1);
      const a = s[i][1], b = s[i + 1][1];
      return [0, 1, 2, 3].map(k => a[k] + (b[k] - a[k]) * f);
    }
  }
  return s[s.length - 1][1];
}

// ---------------------------------------------------------------------------
export function createHeatLayer(spots, rampKey, profile) {
  const ramp = RAMPS[rampKey];
  const canvas = document.createElement('canvas');
  canvas.width = CW; canvas.height = CH;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(CW, CH);

  // 场（世界分辨率）
  const field = new Float32Array(RES * RES);
  const landMask = new Uint8Array(RES * RES);

  const R = RES;
  for (let j = 0; j < R; j++) {
    const z = Z0 + (j / (R - 1)) * D;
    for (let i = 0; i < R; i++) {
      const x = X0 + (i / (R - 1)) * W;
      const idx = j * R + i;
      const surf = surfaceAt(x, z);
      landMask[idx] = (surf === 'water') ? 0 : 1;
      let v = 0;
      for (const s of spots) {
        const d2 = (x - s[0]) * (x - s[0]) + (z - s[1]) * (z - s[1]);
        const sigma = s[2] * 0.5;
        v += s[3] * Math.exp(-d2 / (2 * sigma * sigma));
      }
      // 园路走廊：人员沿路流动
      const pd = pathDist(x, z);
      const corridor = Math.max(0, 1 - pd.d / (pd.path.w * 0.85));
      v += corridor * corridor * 0.34 * (rampKey === 'people' ? 1 : 0.35);
      field[idx] = v;
    }
  }

  // 平滑（三次盒式模糊）——形成连续的密度团块
  (function blur() {
    const tmp = new Float32Array(RES * RES);
    for (let pass = 0; pass < 3; pass++) {
      for (let j = 0; j < RES; j++) {
        for (let i = 0; i < RES; i++) {
          let s = 0, c = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= RES || jj >= RES) continue;
            s += field[jj * RES + ii]; c++;
          }
          tmp[j * RES + i] = s / c;
        }
      }
      field.set(tmp);
    }
  })();

  // 贴地网格
  const geo = new THREE.BufferGeometry();
  const verts = [], uvs = [], idxs = [];
  const seg = 120;
  for (let j = 0; j <= seg; j++) {
    for (let i = 0; i <= seg; i++) {
      const x = X0 + (i / seg) * W, z = Z0 + (j / seg) * D;
      verts.push(x, groundHeight(x, z) + 0.45, z);
      uvs.push(i / seg, 1 - j / seg);
    }
  }
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
      idxs.push(a, c, b, b, c, d);
    }
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idxs);
  geo.computeVertexNormals();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, opacity: 0.94,
    blending: THREE.NormalBlending, side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 5;
  mesh.visible = false;

  let lastHour = -1, stats = { people: 0, peak: 0, total: 0 };

  function update(hour) {
    if (Math.abs(hour - lastHour) < 0.01) return;
    lastHour = hour;
    const h = Math.floor(hour) % 24;
    const frac = hour - h;
    const p0 = profile[h], p1 = profile[(h + 1) % 24];
    const k = p0 + (p1 - p0) * frac;

    // 归一化
    let mx = 0;
    for (let i = 0; i < field.length; i++) if (landMask[i] && field[i] > mx) mx = field[i];
    const norm = Math.max(mx * k * 0.42, 1e-5);

    const data = img.data;
    for (let j = 0; j < CH; j++) {
      for (let i = 0; i < CW; i++) {
        const fi = Math.min(R - 1, Math.round((i / (CW - 1)) * (R - 1)));
        const fj = Math.min(R - 1, Math.round((j / (CH - 1)) * (R - 1)));
        const idx = fj * R + fi;
        let t = field[idx] * k / norm;
        t = Math.pow(Math.max(0, Math.min(1.35, t)), 0.72);
        const o = (j * CW + i) * 4;
        if (!landMask[idx] || t < 0.03) { data[o + 3] = 0; continue; }
        const c = rampColor(ramp, t);
        data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = c[3];
      }
    }
    ctx.putImageData(img, 0, 0);
    tex.needsUpdate = true;

    // 统计：面积加权平均密度 * 园区面积
    let sum = 0;
    for (let i = 0; i < field.length; i++) if (landMask[i]) sum += field[i];
    const mean = (sum / field.length) * k / norm;
    stats = {
      peak: +(mean * 1.9).toFixed(2),
      mean: +mean.toFixed(2),
      total: Math.round(mean * 52000 * (rampKey === 'people' ? 1.0 : 0.06))
    };
  }

  return { mesh, update, stats: () => stats, ramp };
}
