// ============================================================================
//  彩田公园 · 3D 高斯实景重建场景（程序化生成高斯点云）
//  模拟真实 3DGS 数据：带位置/颜色/尺度/方向的高斯点，边缘柔化、噪声抖动
// ============================================================================
import * as THREE from 'three';
import {
  PARK, LAKE, WATER_Y, BUILDINGS, CITY, COURTS, PLAZAS, PARKING, PATHS, ROADS,
  groundHeight, baseHeight, lakeNorm, surfaceAt, pathDist, pointInRect,
  rng, clamp, lerp, smoothstep, fbm, hash2, valueNoise, samplePolyline, polylineLength
} from './terrain.js?v=4';
import { CAMERAS } from './data.js?v=4';
import { headingAt } from './terrain.js?v=4';

// ---------------------------------------------------------------------------
//  点云累加器
// ---------------------------------------------------------------------------
class SplatAccum {
  constructor() { this.p = []; this.c = []; this.s = []; this.f = []; this.n = 0; }
  add(x, y, z, size, r, g, b, flag = 1) {
    this.p.push(x, y, z); this.c.push(r, g, b); this.s.push(size); this.f.push(flag); this.n++;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(this.s, 1));
    g.setAttribute('aFlag', new THREE.Float32BufferAttribute(this.f, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------------------
//  调色板
// ---------------------------------------------------------------------------
const C = {
  grassA: [0.30, 0.44, 0.20], grassB: [0.44, 0.58, 0.27], grassDark: [0.20, 0.33, 0.15],
  path: [0.60, 0.56, 0.48], pathDark: [0.49, 0.45, 0.39],
  plaza: [0.55, 0.54, 0.51], plazaLine: [0.44, 0.43, 0.41],
  road: [0.21, 0.22, 0.24], roadLight: [0.30, 0.31, 0.33],
  walk: [0.50, 0.49, 0.46],
  parking: [0.25, 0.26, 0.27],
  water: [0.13, 0.19, 0.13],
  bark: [0.28, 0.21, 0.14],
  leaf: [0.22, 0.42, 0.15], leafLight: [0.38, 0.56, 0.20], leafDark: [0.15, 0.31, 0.12],
  autumn: [0.72, 0.52, 0.16], palm: [0.30, 0.48, 0.18],
  brick: [0.44, 0.44, 0.45], concrete: [0.66, 0.66, 0.64], wood: [0.44, 0.30, 0.19],
  steel: [0.34, 0.35, 0.37], glass: [0.30, 0.42, 0.52], apartment: [0.50, 0.49, 0.47],
  car: [0.85, 0.85, 0.87]
};
const jitter = (v, a = 0.06) => v * (1 + (rng() - 0.5) * 2 * a);

// ---------------------------------------------------------------------------
//  地面高斯
// ---------------------------------------------------------------------------
function groundSample(x, z, step) {
  const h = groundHeight(x, z);
  const surf = surfaceAt(x, z);
  let col = C.grassA, size = step * 0.74;

  if (surf === 'water') { col = C.water; }
  else if (surf === 'road') {
    const road = ROADS[0];
    const off = z - road.z;
    col = C.road;
    if (Math.abs(off) < 0.28 && Math.abs(((x % 6) + 6) % 6 - 3) < 1.6) col = [0.78, 0.72, 0.30];
    else if (Math.abs(off) > 5.2 && Math.abs(off) < 5.7) col = [0.80, 0.80, 0.78];
    size = step * 0.72;
  }
  else if (surf === 'sidewalk') {
    col = C.walk;
    if (Math.abs(((x % 2) + 2) % 2 - 1) < 0.12 || Math.abs(((z % 2) + 2) % 2 - 1) < 0.12) col = [0.48, 0.47, 0.45];
    size = step * 0.72;
  }
  else if (surf === 'path') {
    col = Math.abs(((x + z) % 3 + 3) % 3 - 1.5) < 0.35 ? C.pathDark : C.path;
    size = step * 0.72;
  }
  else if (surf === 'plaza') {
    const grid = (Math.abs((x % 4) + 4) % 4) < 0.14 || (Math.abs((z % 4) + 4) % 4) < 0.14;
    col = grid ? C.plazaLine : C.plaza;
    size = step * 0.72;
  }
  else if (surf === 'court') {
    const c = COURTS.find(cc => pointInRect(x, z, cc));
    const inLine = Math.abs((x - c.x0) % 11.5) < 0.22 || Math.abs((z - c.z0) % 11.5) < 0.22;
    col = inLine ? [0.88, 0.88, 0.86] : c.color;
    size = step * 0.72;
  }
  else if (surf === 'parking') {
    const stall = Math.abs(((x - PARKING.x0) % 2.6 + 2.6) % 2.6 - 1.3) < 0.12;
    col = stall ? [0.78, 0.78, 0.75] : C.parking;
    size = step * 0.72;
  }
  else if (surf === 'building' || surf === 'city') {
    const b = (BUILDINGS.concat(CITY)).find(bb => pointInRect(x, z, bb));
    col = b && b.style === 'glass' ? [0.19, 0.20, 0.22] : (b && b.style === 'apartment' ? [0.36, 0.36, 0.35] : [0.42, 0.42, 0.41]);
    size = step * 0.72;
  }
  else {
    const n = fbm(x * 0.035, z * 0.035, 3);
    const n2 = valueNoise(x * 0.22, z * 0.22);
    if (n > 0.58) col = C.grassB;
    else if (n < 0.34) col = C.grassDark;
    else col = C.grassA;
    if (n2 > 0.86) col = C.leafLight;
    const ld = lakeNorm(x, z);
    if (ld < 1.35) col = [col[0] * 0.85, col[1] * 0.95, col[2] * 0.82];
  }
  return { h, surf, col, size };
}

function addGround(acc, step) {
  const x0 = -152, x1 = 152, z0 = -116, z1 = 136;
  for (let x = x0; x <= x1; x += step) {
    for (let z = z0; z <= z1; z += step) {
      const jx = x + (rng() - 0.5) * step * 0.9;
      const jz = z + (rng() - 0.5) * step * 0.9;
      const s = groundSample(jx, jz, step);
      const y = s.h + (s.surf === 'road' ? 0.06 : 0.04);
      acc.add(jx, y, jz, s.size, jitter(s.col[0], 0.10), jitter(s.col[1], 0.10), jitter(s.col[2], 0.10), 0);
    }
  }
}

// 实景基底网格（高斯点下方的实体地形，避免掠射角透视穿帮）
export function buildTerrainBase() {
  const nx = 210, nz = 170;
  const x0 = -152, x1 = 152, z0 = -116, z1 = 136;
  const pos = [], col = [], idx = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + (i / nx) * (x1 - x0);
      const z = z0 + (j / nz) * (z1 - z0);
      const s = groundSample(x, z, 1);
      pos.push(x, s.h - 0.05, z);
      col.push(s.col[0] * 0.94, s.col[1] * 0.94, s.col[2] * 0.94);
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.MeshBasicMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = -2;
  return mesh;
}

// ---------------------------------------------------------------------------
//  植被
// ---------------------------------------------------------------------------
function addTree(acc, x, z, kind, scale = 1) {
  const gy = groundHeight(x, z);
  const r = rng;
  if (kind === 'palm') {
    const h = (6 + r() * 5) * scale;
    for (let i = 0; i < 26; i++) {
      const t = i / 26, yy = gy + t * h;
      acc.add(x + Math.sin(t * 3) * 0.25, yy, z + Math.cos(t * 2) * 0.2, 0.55,
        jitter(C.bark[0], .1), jitter(C.bark[1], .1), jitter(C.bark[2], .1));
    }
    // 扇形叶
    for (let f = 0; f < 9; f++) {
      const a = (f / 9) * Math.PI * 2 + r();
      const len = (2.2 + r() * 1.8) * scale;
      const tipX = x + Math.cos(a) * len, tipZ = z + Math.sin(a) * len;
      const steps = 9;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const px = lerp(x, tipX, t), pz = lerp(z, tipZ, t);
        const py = gy + h + Math.sin(t * Math.PI) * 0.7 - t * t * 1.6;
        acc.add(px, py, pz, 0.55 * scale, jitter(C.palm[0], .12), jitter(C.palm[1], .12), jitter(C.palm[2], .12));
      }
    }
    return;
  }
  if (kind === 'shrub') {
    const rad = (0.9 + r() * 0.8) * scale;
    for (let i = 0; i < 45; i++) {
      const u = r() * Math.PI * 2, v = Math.acos(2 * r() - 1);
      const rr = rad * (0.75 + r() * 0.35);
      acc.add(x + rr * Math.sin(v) * Math.cos(u), gy + rad * 0.7 + rr * Math.cos(v) * 0.8, z + rr * Math.sin(v) * Math.sin(u),
        0.42, jitter(C.leaf[0], .16), jitter(C.leaf[1], .16), jitter(C.leaf[2], .16));
    }
    return;
  }
  // 乔木
  const trunkH = (2.2 + r() * 2.6) * scale;
  const rad = (2.4 + r() * 2.4) * scale;
  const th = (2.6 + r() * 2.2) * scale;
  const auto = r() < 0.16;
  for (let i = 0; i < 18; i++) {
    const t = i / 18;
    acc.add(x + Math.sin(t * 5) * 0.18, gy + t * trunkH, z + Math.cos(t * 4) * 0.15, 0.5,
      jitter(C.bark[0], .12), jitter(C.bark[1], .12), jitter(C.bark[2], .12));
  }
  const count = Math.round(155 + rad * 54);
  for (let i = 0; i < count; i++) {
    const u = r() * Math.PI * 2, v = Math.acos(2 * r() - 1);
    const shell = 0.88 + r() * 0.22;
    const px = x + rad * shell * Math.sin(v) * Math.cos(u);
    const pz = z + rad * shell * Math.sin(v) * Math.sin(u);
    const py = gy + trunkH + th * 0.55 + rad * 0.62 * Math.cos(v) * shell;
    let col = r() < 0.34 ? C.leafLight : (r() < 0.5 ? C.leafDark : C.leaf);
    if (auto) col = r() < 0.5 ? C.autumn : C.leafLight;
    acc.add(px, py, pz, 0.44 * scale, jitter(col[0], .18), jitter(col[1], .18), jitter(col[2], .18));
  }
}

// 摄像头视域数据（机位 + 朝向），建场时计算一次
let CAM_VIEWS = null;
function camViews() {
  if (!CAM_VIEWS) {
    CAM_VIEWS = CAMERAS.map(c => {
      const h = headingAt(c.x, c.z);
      return { x: c.x, z: c.z, fx: Math.cos(h), fz: Math.sin(h) };
    });
  }
  return CAM_VIEWS;
}

// 树木净空判定：园路可视 + 摄像头视域通视
function blockedForView(x, z, canopyR) {
  const pd = pathDist(x, z);
  if (pd.d < canopyR + 1.4) return true;                 // 园路净空
  const views = camViews();
  for (let i = 0; i < views.length; i++) {
    const c = views[i];
    const dx = x - c.x, dz = z - c.z;
    const dist = Math.hypot(dx, dz);
    if (dist < canopyR + 3.5) return true;               // 机位周边净空
    if (dist < 30) {                                     // 视线走廊净空
      const along = dx * c.fx + dz * c.fz;
      const lateral = Math.abs(-dx * c.fz + dz * c.fx);
      if (along > 0.5 && along < 28 && lateral < 4.2 + canopyR * 0.6) return true;
    }
  }
  return false;
}

function plantVegetation(acc) {
  const r = rng;
  // 主体林地
  let placed = 0, guard = 0;
  while (placed < 560 && guard < 26000) {
    guard++;
    const x = -128 + r() * 256, z = -98 + r() * 166;
    const surf = surfaceAt(x, z);
    if (surf !== 'grass') continue;
    const dens = fbm(x * 0.016 + 10, z * 0.016 - 4, 3);
    const nearLake = 1 - smoothstep(1.0, 2.4, lakeNorm(x, z));
    const p = 0.30 + dens * 0.85 + nearLake * 0.30;
    if (r() > p) continue;
    const kind = r() < 0.10 ? 'palm' : (r() < 0.24 ? 'shrub' : 'tree');
    const scale = 0.85 + r() * 0.5;
    const canopyR = kind === 'shrub' ? 1.2 : (2.4 + r() * 2.4) * scale;
    if (blockedForView(x, z, canopyR)) continue;
    addTree(acc, x, z, kind, scale);
    placed++;
  }
  // 行道树（沿园路，树冠不侵占路面）
  for (const path of PATHS) {
    const samples = samplePolyline(path.points, 9);
    for (let i = 1; i < samples.length; i += 1) {
      const [x, z] = samples[i];
      if (rng() < 0.42) {
        const off = path.w / 2 + 4.2 + rng() * 1.4;
        const nx = x + off * Math.cos(i * 0.7), nz = z + off * Math.sin(i * 0.7);
        if (surfaceAt(nx, nz) === 'grass' && !blockedForView(nx, nz, 3.2)) addTree(acc, nx, nz, 'tree', 0.85);
      }
    }
  }
  // 广场树阵
  for (let i = 0; i < 22; i++) {
    const x = -26 + (i % 11) * 5.2 + rng() * 1.5;
    const z = i < 11 ? 66 + rng() * 2 : 47 + rng() * 2;
    if (blockedForView(x, z, 3.6)) continue;
    addTree(acc, x, z, rng() < 0.3 ? 'palm' : 'tree', 0.9);
  }
  // 城市道路行道树
  for (let x = -140; x < 140; x += 11) {
    const tx = x + rng() * 2, tz = 69.5 + rng();
    if (blockedForView(tx, tz, 3.4)) continue;
    addTree(acc, tx, tz, 'tree', 0.9);
  }
  // 建筑周边绿化
  for (const b of BUILDINGS) {
    for (let i = 0; i < 8; i++) {
      const x = b.x0 - 3 + rng() * (b.x1 - b.x0 + 6);
      const z = b.z0 - 3 + rng() * (b.z1 - b.z0 + 6);
      if (surfaceAt(x, z) === 'grass' && !blockedForView(x, z, 1.4)) addTree(acc, x, z, 'shrub', 1.1);
    }
  }
}

// ---------------------------------------------------------------------------
//  建筑
// ---------------------------------------------------------------------------
function addBoxShell(acc, x0, z0, x1, z1, h, style, groundY) {
  const r = rng;
  const styleCol = style === 'brick' ? C.brick : style === 'wood' ? C.wood : style === 'steel' ? C.steel
    : style === 'glass' ? C.glass : style === 'apartment' ? C.apartment : C.concrete;
  const step = 0.9;
  const faces = [
    { fixed: 'x', v: x0, n: [-1, 0] }, { fixed: 'x', v: x1, n: [1, 0] },
    { fixed: 'z', v: z0, n: [0, -1] }, { fixed: 'z', v: z1, n: [0, 1] }
  ];
  for (const f of faces) {
    const a0 = f.fixed === 'x' ? z0 : x0, a1 = f.fixed === 'x' ? z1 : x1;
    const len = a1 - a0;
    const n = Math.max(2, Math.round(len / step));
    const floors = Math.max(1, Math.round(h / 3.2));
    for (let i = 0; i < n; i++) {
      const a = a0 + (i + 0.5) * (len / n);
      const x = f.fixed === 'x' ? f.v : a, z = f.fixed === 'x' ? a : f.v;
      const rows = Math.max(2, Math.round(h / 1.05));
      for (let k = 0; k < rows; k++) {
        const y = groundY + (k + 0.5) * (h / rows);
        const fl = Math.floor((y - groundY) / 3.2);
        let col = styleCol.slice();
        // 窗格
        // 立面点与建筑底座贴图同色，仅少量亮灯窗，保持与实景一致
        if ((style === 'glass' || style === 'apartment') && r() < 0.07) {
          col = [0.88, 0.80, 0.55];
        }
        if (style === 'brick') {
          const mortar = Math.abs((y - groundY) % 0.75) < 0.14;
          if (mortar) col = [0.55, 0.55, 0.55];
        }
        acc.add(x + f.n[0] * 0.12, y, z + f.n[1] * 0.12, 0.40,
          jitter(col[0], .1), jitter(col[1], .1), jitter(col[2], .1));
      }
    }
  }
  // 屋顶
  const rn = Math.max(3, Math.round((x1 - x0) / 1.2)), mz = Math.max(3, Math.round((z1 - z0) / 1.2));
  for (let i = 0; i < rn; i++) {
    for (let j = 0; j < mz; j++) {
      const x = x0 + (i + 0.5) * ((x1 - x0) / rn), z = z0 + (j + 0.5) * ((z1 - z0) / mz);
      const roofCol = style === 'brick' ? [0.40, 0.40, 0.41] : style === 'wood' ? [0.36, 0.30, 0.16] : [0.50, 0.50, 0.49];
      acc.add(x, groundY + h + 0.05, z, 0.42, jitter(roofCol[0], .1), jitter(roofCol[1], .1), jitter(roofCol[2], .1));
    }
  }
}

function addBuildings(acc) {
  const r = rng;
  for (const b of BUILDINGS) {
    const gy = groundHeight((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
    addBoxShell(acc, b.x0, b.z0, b.x1, b.z1, b.h, b.style, gy);
    if (b.id === 'B1') { // 屋面空调外机
      for (let i = 0; i < 5; i++) {
        const x = b.x0 + 2 + i * 4, z = b.z0 + 2.2;
        addBoxShell(acc, x, z, x + 2.2, z + 1.4, 1.2, 'steel', gy + b.h);
      }
    }
    if (b.id === 'B2') { // 绿荫茶室：绿色屋顶
      for (let i = 0; i < 60; i++) {
        const x = b.x0 + r() * (b.x1 - b.x0), z = b.z0 + r() * (b.z1 - b.z0);
        acc.add(x, gy + b.h + 0.25, z, 0.6, jitter(0.30, .12), jitter(0.48, .12), jitter(0.26, .12));
      }
    }
    if (b.id === 'B7') { // 钢构看台
      for (let i = 0; i < 4; i++) {
        const y = gy + i * 1.0;
        for (let k = 0; k < 26; k++) {
          acc.add(b.x0 + k * 0.7, y, b.z0 + i * 2.2, 0.5, jitter(.42, .1), jitter(.44, .1), jitter(.46, .1));
        }
      }
    }
  }
  for (const c of CITY) {
    const gy = baseHeight((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2);
    addBoxShell(acc, c.x0, c.z0, c.x1, c.z1, c.h, c.style, gy);
  }
}

// ---------------------------------------------------------------------------
//  建筑实体底座（避免近景高斯气泡穿帮，窗格由贴图承担）
// ---------------------------------------------------------------------------
function facadeTexture(style) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const base = style === 'brick' ? '#6e6e70' : style === 'wood' ? '#7a5738'
    : style === 'steel' ? '#5b5f66' : style === 'glass' ? '#5d7f96'
    : style === 'apartment' ? '#83817c' : '#9b9b96';
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  // 细微噪点
  for (let i = 0; i < 900; i++) {
    g.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.05).toFixed(3) + ')';
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  if (style === 'brick') {
    for (let y = 0; y < 256; y += 12) {
      g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(0, y, 256, 2);
      g.fillStyle = 'rgba(0,0,0,.10)';
      for (let x = (y / 12) % 2 ? 0 : 16; x < 256; x += 32) g.fillRect(x, y, 1.5, 12);
    }
  } else if (style === 'glass' || style === 'apartment') {
    const cols = 8, rows = 6;
    const cw = 256 / cols, rh = 256 / rows;
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        const lit = Math.random() < 0.14;
        g.fillStyle = lit ? 'rgba(240,214,150,.85)' : (style === 'glass' ? 'rgba(30,52,68,.85)' : 'rgba(38,44,48,.88)');
        g.fillRect(k * cw + cw * 0.16, r * rh + rh * 0.18, cw * 0.68, rh * 0.5);
      }
      g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(0, r * rh + rh * 0.72, 256, 2);
    }
  } else {
    const cols = 4, rows = 4;
    const cw = 256 / cols, rh = 256 / rows;
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        g.fillStyle = 'rgba(36,44,52,.72)';
        g.fillRect(k * cw + cw * 0.24, r * rh + rh * 0.22, cw * 0.5, rh * 0.42);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildBuildingBase() {
  const group = new THREE.Group();
  const cache = {};
  for (const b of BUILDINGS.concat(CITY)) {
    if (!cache[b.style]) cache[b.style] = facadeTexture(b.style);
    const tex = cache[b.style].clone();
    tex.needsUpdate = true;
    const w = b.x1 - b.x0, d = b.z1 - b.z0, h = b.h;
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv;
    const scales = [[d / 9, h / 5], [d / 9, h / 5], [w / 9, d / 9], [w / 9, d / 9], [w / 9, h / 5], [w / 9, h / 5]];
    for (let i = 0; i < uv.count; i++) {
      const sc = scales[Math.floor(i / 4)];
      uv.setXY(i, uv.getX(i) * sc[0], uv.getY(i) * sc[1]);
    }
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff });
    const mesh = new THREE.Mesh(geo, mat);
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const gy = BUILDINGS.indexOf(b) >= 0 ? groundHeight(cx, cz) : baseHeight(cx, cz);
    mesh.position.set(cx, gy + h / 2 - 0.15, cz);
    group.add(mesh);
    // 屋顶（复用立面贴图，避免俯视时出现大片平板）
    const roofGeo = new THREE.BoxGeometry(w * 1.02, 0.4, d * 1.02);
    const ruv = roofGeo.attributes.uv;
    const rsc = [[d / 14, 1], [d / 14, 1], [w / 14, d / 14], [w / 14, d / 14], [w / 14, 1], [w / 14, 1]];
    for (let i = 0; i < ruv.count; i++) {
      const sc = rsc[Math.floor(i / 4)];
      ruv.setXY(i, ruv.getX(i) * sc[0], ruv.getY(i) * sc[1]);
    }
    const roofMat = new THREE.MeshBasicMaterial({
      map: tex.clone(),
      color: b.style === 'wood' ? 0x8fd08a : 0xb9b9b4
    });
    roofMat.map.needsUpdate = true;
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(cx, gy + h + 0.05, cz);
    group.add(roof);
  }
  group.renderOrder = -1;
  return group;
}

// ---------------------------------------------------------------------------
//  构筑物与设施
// ---------------------------------------------------------------------------
// 是否靠近摄像头（用于设施避让）
function nearCamera(x, z, d) {
  for (const c of CAMERAS) {
    const dx = x - c.x, dz = z - c.z;
    if (dx * dx + dz * dz < d * d) return true;
  }
  return false;
}

function addPole(acc, x, z, h, color, r = 0.18) {
  for (let i = 0; i < Math.max(6, h * 3); i++) {
    const t = i / Math.max(6, h * 3);
    acc.add(x, groundHeight(x, z) + t * h, z, r,
      jitter(color[0], .08), jitter(color[1], .08), jitter(color[2], .08));
  }
}
function addGlobeLamp(acc, x, z, h = 4.2) {
  const gy = groundHeight(x, z);
  addPole(acc, x, z, h, [0.16, 0.17, 0.18], 0.2);
  for (let i = 0; i < 26; i++) {
    const u = rng() * Math.PI * 2, v = Math.acos(2 * rng() - 1);
    const rr = 0.52 * (0.8 + rng() * 0.3);
    acc.add(x + rr * Math.sin(v) * Math.cos(u), gy + h + rr * Math.cos(v), z + rr * Math.sin(v) * Math.sin(u),
      0.42, jitter(0.80, .05), jitter(0.79, .05), jitter(0.72, .06));
  }
}
function addBench(acc, x, z, rot) {
  const gy = groundHeight(x, z);
  for (let i = 0; i < 10; i++) {
    const t = i / 9 - 0.5;
    const px = x + Math.cos(rot) * t * 1.8, pz = z + Math.sin(rot) * t * 1.8;
    acc.add(px, gy + 0.45, pz, 0.4, jitter(.42, .1), jitter(.32, .1), jitter(.22, .1));
  }
  for (const s of [-0.7, 0.7]) {
    acc.add(x + Math.sin(rot) * s, gy + 0.22, z - Math.cos(rot) * s, 0.3, jitter(.3, .1), jitter(.3, .1), jitter(.3, .1));
  }
}
function addCar(acc, x, z, rot, color) {
  const gy = groundHeight(x, z);
  const L = 4.4, W = 1.85;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const put = (u, v, y, col, s) => {
    acc.add(x + cs * u - sn * v, gy + y, z + sn * u + cs * v, s,
      jitter(col[0], .06), jitter(col[1], .06), jitter(col[2], .06));
  };
  // 车身
  for (let i = 0; i < 26; i++) {
    const u = -L / 2 + (i / 25) * L;
    for (const v of [-W / 2, W / 2]) put(u, v, 0.62, color, 0.5);
  }
  for (let i = 0; i < 8; i++) {
    const u = -L / 2 + (i / 7) * L;
    put(u, -W / 2, 0.62, color, 0.5); put(u, W / 2, 0.62, color, 0.5);
  }
  // 车顶 / 座舱
  for (let i = 0; i < 14; i++) {
    const u = -L / 4 + (i / 13) * (L / 2);
    put(u, -W / 2 + 0.2, 1.18, [0.16, 0.18, 0.2], 0.45);
    put(u, W / 2 - 0.2, 1.18, [0.16, 0.18, 0.2], 0.45);
  }
  for (let i = 0; i < 8; i++) {
    const u = -L / 4 + (i / 7) * (L / 2);
    put(u, 0, 1.25, color, 0.45);
  }
  // 车轮
  for (const su of [-L / 3, L / 3]) for (const sv of [-W / 2, W / 2]) put(su, sv, 0.3, [0.1, 0.1, 0.11], 0.45);
}
function addProps(acc) {
  const r = rng;
  // 路灯（沿主路与园路）
  for (const path of PATHS) {
    const samples = samplePolyline(path.points, 16);
    for (const [x, z] of samples) {
      if (r() < 0.55) {
        const side = r() < 0.5 ? 1 : -1;
        const nx = x + side * (path.w / 2 + 1.1), nz = z + side * 0.4;
        if (nearCamera(nx, nz, 8)) continue;        // 避让摄像头，保证视域通视
        addGlobeLamp(acc, nx, nz, 4.2);
      }
    }
  }
  for (let x = -120; x < 125; x += 26) {
    if (nearCamera(x, 71.5, 8)) continue;
    addGlobeLamp(acc, x, 71.5, 6.5);
  }
  // 长椅
  for (const path of PATHS) {
    const samples = samplePolyline(path.points, 22);
    for (const [x, z] of samples) {
      if (r() < 0.4) {
        const bx = x + (r() - 0.5) * 2, bz = z + (r() - 0.5) * 2;
        if (!nearCamera(bx, bz, 3.5)) addBench(acc, bx, bz, r() * Math.PI);
      }
    }
  }
  // 广场廊架
  for (let i = 0; i < 6; i++) {
    const x = -14 + i * 5.6;
    for (const z of [46, 52]) addPole(acc, x, z, 3.6, [0.55, 0.44, 0.30], 0.26);
  }
  for (let i = 0; i < 6; i++) {
    const x = -14 + i * 5.6;
    for (let k = 0; k < 5; k++) {
      acc.add(x, groundHeight(x, 49) + 3.65, 46 + k * 1.5, 0.5, jitter(.58, .08), jitter(.47, .08), jitter(.32, .08));
    }
  }
  // 篮球架
  for (const c of COURTS) {
    const cx = (c.x0 + c.x1) / 2;
    for (const side of [c.z0 + 1.5, c.z1 - 1.5]) {
      addPole(acc, cx, side, 3.6, [0.28, 0.28, 0.3], 0.22);
      acc.add(cx, groundHeight(cx, side) + 3.9, side, 0.6, jitter(.75, .1), jitter(.42, .1), jitter(.18, .1));
    }
  }
  // 停车位车辆
  const carCols = [[.86, .86, .88], [.12, .12, .14], [.55, .57, .6], [.7, .16, .16], [.15, .28, .55], [.9, .9, .92]];
  for (let i = 0; i < 34; i++) {
    const x = PARKING.x0 + 3 + (i % 17) * 3.4, z = PARKING.z0 + 4 + Math.floor(i / 17) * 14 + r() * 1.5;
    addCar(acc, x, z, Math.PI / 2, carCols[i % carCols.length]);
  }
  // 道路车流
  for (let i = 0; i < 16; i++) {
    const x = -140 + i * 18 + r() * 6, z = ROADS[0].z + (i % 2 ? 4.5 : -4.5);
    addCar(acc, x, z, Math.PI / 2, carCols[(i + 3) % carCols.length]);
  }
  // 栈桥（跨湖）
  const bridgeZ = -30, bx0 = 26, bx1 = 68;
  for (let x = bx0; x <= bx1; x += 1.2) {
    const gy = Math.max(WATER_Y, groundHeight(x, bridgeZ));
    for (let z = bridgeZ - 1.6; z <= bridgeZ + 1.6; z += 0.8) {
      acc.add(x, gy + 0.9, z, 0.55, jitter(.60, .07), jitter(.50, .07), jitter(.38, .07));
    }
  }
  for (let x = bx0; x <= bx1; x += 3) {
    for (const z of [bridgeZ - 1.7, bridgeZ + 1.7]) {
      const gy = Math.max(WATER_Y, groundHeight(x, z));
      for (let i = 0; i < 8; i++) acc.add(x, gy + 1.1 + i * 0.16, z, 0.3, jitter(.4, .1), jitter(.42, .1), jitter(.45, .1));
    }
  }
  // 湖心亭
  const px = 46, pz = -2, pgy = WATER_Y;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    addPole(acc, px + Math.cos(a) * 2.6, pz + Math.sin(a) * 2.6, 3.2, [0.45, 0.32, 0.2], 0.22);
  }
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2, rr = 3.2 * Math.sqrt(r());
    acc.add(px + Math.cos(a) * rr, pgy + 3.5, pz + Math.sin(a) * rr, 0.5, jitter(.32, .1), jitter(.46, .1), jitter(.26, .1));
  }
  // 游乐园（儿童游乐区）
  for (let i = 0; i < 3; i++) {
    const x = -96 + i * 12, z = -46;
    for (let k = 0; k < 30; k++) {
      const a = r() * Math.PI * 2, rr = 5 * Math.sqrt(r());
      acc.add(x + Math.cos(a) * rr, groundHeight(x, z) + 0.6 + r() * 4, z + Math.sin(a) * rr, 0.5,
        jitter(.75, .12), jitter(.42, .12), jitter(.2, .12));
    }
  }
}

// ---------------------------------------------------------------------------
//  对外接口
// ---------------------------------------------------------------------------
export function buildParkScene(onProgress) {
  const acc = new SplatAccum();
  const steps = [
    ['构建园区地表高斯点云', () => addGround(acc, 0.58)],
    ['解算植被与景观树', () => plantVegetation(acc)],
    ['构建建筑与城市界面', () => addBuildings(acc)],
    ['装配设施构筑物与车辆', () => addProps(acc)]
  ];
  let i = 0;
  return new Promise(resolve => {
    function tick() {
      if (i >= steps.length) {
        onProgress && onProgress(1, '实景模型就绪');
        resolve({ geometry: acc.build(), count: acc.n });
        return;
      }
      const [label, fn] = steps[i];
      onProgress && onProgress(i / steps.length, label);
      fn();
      i++;
      setTimeout(tick, 16);
    }
    tick();
  });
}

// ---------------------------------------------------------------------------
export function buildWater() {
  const g = new THREE.CircleGeometry(1, 128);
  {
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const a = Math.atan2(y, x);
      const k = 1 + 0.085 * Math.sin(a * 3.0 + 0.7) + 0.055 * Math.sin(a * 7.0 + 2.1) + 0.03 * Math.sin(a * 13.0);
      pos.setXY(i, x * k, y * k);
    }
    g.computeVertexNormals();
  }
  const m = new THREE.MeshStandardMaterial({
    color: 0x2f7f86, transparent: true, opacity: 0.82, roughness: 0.18, metalness: 0.35,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.set(LAKE.rx * 0.70, LAKE.rz * 0.70, 1);
  mesh.position.set(LAKE.cx, WATER_Y, LAKE.cz);
  mesh.renderOrder = -1;
  return mesh;
}

