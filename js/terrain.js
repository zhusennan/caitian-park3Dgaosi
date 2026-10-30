// ============================================================================
//  彩田公园 · 地形与场地模型
//  坐标系：X 东西向(-130~130) / Y 天向 / Z 南北向(-100~100)，单位=米
//  园区用地 260m × 200m ≈ 5.0 万㎡
// ============================================================================

export const PARK = {
  minX: -130, maxX: 130, minZ: -100, maxZ: 70,
  area: 52000,                       // ㎡
  name: '彩田公园'
};

export const LAKE = { cx: 48, cz: -8, rx: 46, rz: 34 };
export const WATER_Y = 0.25;

// ---- 确定性随机 ------------------------------------------------------------
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rng = mulberry32(20261030);

// ---- 数学 ------------------------------------------------------------------
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
export function hash2(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
export function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm(x, y, oct = 3) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * valueNoise(x * f, y * f); f *= 2.03; amp *= 0.5; }
  return s;
}

// ---- 地形高度 --------------------------------------------------------------
export function baseHeight(x, z) {
  let h = 1.3 * Math.sin(x * 0.027) * Math.cos(z * 0.033) + 0.85 * Math.sin(x * 0.021 + z * 0.024);
  // 北侧缓坡山丘（对应参考图中公园北部的山体）
  h += 9.0 * smoothstep(28, 96, -z) * (0.55 + 0.45 * Math.cos((x - 10) * 0.017));
  // 东南侧微地形下沉
  h -= 1.3 * smoothstep(28, 82, x) * (0.5 + 0.5 * Math.sin(z * 0.03));
  return h;
}
export function lakeNorm(x, z) {
  return Math.hypot((x - LAKE.cx) / LAKE.rx, (z - LAKE.cz) / LAKE.rz);
}
export function groundHeight(x, z) {
  const d = lakeNorm(x, z);
  const basin = 5.4 * smoothstep(1.04, 0.24, d);
  return baseHeight(x, z) - basin;
}
export function isWater(x, z) {
  return groundHeight(x, z) < WATER_Y - 0.05 && lakeNorm(x, z) < 1.0;
}

// ---- 路网 (所有路径中心线，w = 宽度) --------------------------------------
export const ROADS = [
  { name: '彩田路', w: 19, axis: 'x', z: 83.5, from: -130, to: 130, surface: 'asphalt' },
  { name: '北侧规划路', w: 14, axis: 'x', z: -104, from: -130, to: 130, surface: 'asphalt' }
];

export const PATHS = [
  { id: 'P1', name: '中央主轴步道', w: 7.0, points: [[-3, 70], [-3, 44], [1, 18], [6, -12], [9, -40], [3, -62], [-6, -84]] },
  { id: 'P2', name: '环湖主环道', w: 5.5, points: [[-3, 44], [-30, 30], [-58, 8], [-72, -24], [-58, -52], [-20, -66], [12, -70], [38, -58], [64, -40], [82, -14], [84, 12], [66, 30], [34, 40], [4, 44], [-3, 44]] },
  { id: 'P3', name: '彩田湖滨水栈道', w: 4.5, points: [[26, 6], [30, -22], [44, -40], [64, -44], [84, -30], [92, -8], [88, 14], [70, 22], [46, 20], [30, 6]] },
  { id: 'P4', name: '运动区连接道', w: 4.5, points: [[-30, 44], [-56, 30], [-80, 12], [-92, -12], [-86, -40], [-62, -60]] },
  { id: 'P5', name: '停车区连接道', w: 5.0, points: [[62, 62], [42, 50], [22, 38], [6, 30]] },
  { id: 'P6', name: '北坡登山道', w: 3.5, points: [[9, -40], [30, -54], [58, -66], [86, -74]] },
  { id: 'P7', name: '花海西侧步道', w: 3.5, points: [[-62, -60], [-48, -76], [-26, -88], [4, -94]] },
  { id: 'P8', name: '东岸步道', w: 4.0, points: [[84, 12], [92, 30], [96, 48], [92, 62]] }
];

// ---- 硬质场地 --------------------------------------------------------------
export const PLAZAS = [
  { id: 'Z1', name: '主入口广场', x0: -30, z0: 44, x1: 30, z1: 70, style: 'stone' },
  { id: 'Z2', name: '湖畔广场', x0: 36, z0: 12, x1: 62, z1: 30, style: 'stone' },
  { id: 'Z3', name: '健身广场', x0: -96, z0: -6, x1: -66, z1: 24, style: 'rubber' }
];

export const COURTS = [
  { id: 'C1', name: '篮球场', x0: -118, z0: -6, x1: -74, z1: 22, color: [0.24, 0.42, 0.62] },
  { id: 'C2', name: '网球场', x0: -120, z0: 30, x1: -86, z1: 56, color: [0.30, 0.52, 0.40] },
  { id: 'C3', name: '羽毛球场', x0: -116, z0: -46, x1: -92, z1: -16, color: [0.55, 0.36, 0.24] }
];

export const PARKING = { id: 'PK', name: '公园停车场', x0: 64, z0: 26, x1: 122, z1: 66 };

export const BUILDINGS = [
  { id: 'B1', name: '游客服务中心', x0: -60, z0: 44, x1: -34, z1: 62, h: 6.5, style: 'brick' },
  { id: 'B2', name: '绿荫茶室', x0: 6, z0: 52, x1: 22, z1: 62, h: 4.2, style: 'wood' },
  { id: 'B3', name: '湖畔书院', x0: 0, z0: -62, x1: 20, z1: -46, h: 8.5, style: 'concrete' },
  { id: 'B4', name: '生态公厕', x0: 30, z0: 34, x1: 38, z1: 42, h: 3.4, style: 'concrete' },
  { id: 'B5', name: '运维工具房', x0: -84, z0: -30, x1: -76, z1: -22, h: 3.2, style: 'concrete' },
  { id: 'B6', name: '北门值班室', x0: -10, z0: -92, x1: -2, z1: -84, h: 3.4, style: 'concrete' },
  { id: 'B7', name: '运动看台', x0: -70, z0: 24, x1: -52, z1: 34, h: 4.0, style: 'steel' }
];

// 城市界面（公园外）
export const CITY = [
  { id: 'C1', name: '彩田城市综合体', x0: -96, z0: 100, x1: -40, z1: 128, h: 42, style: 'glass' },
  { id: 'C2', name: '彩田大厦', x0: 86, z0: 104, x1: 116, z1: 128, h: 96, style: 'glass' },
  { id: 'C3', name: '南苑住宅', x0: -140, z0: 98, x1: -104, z1: 126, h: 30, style: 'apartment' },
  { id: 'C4', name: '南苑住宅2', x0: 8, z0: 100, x1: 44, z1: 124, h: 26, style: 'apartment' },
  { id: 'C5', name: '东苑商办', x0: 124, z0: 96, x1: 158, z1: 126, h: 34, style: 'glass' }
];

// ---- 区域判定 --------------------------------------------------------------
export function pathDist(x, z) {
  let best = 1e9, bestPath = null;
  for (const p of PATHS) {
    const d = distToPolyline(x, z, p.points);
    if (d < best) { best = d; bestPath = p; }
  }
  return { d: best, path: bestPath };
}
export function distToPolyline(x, z, pts) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
    const dx = x2 - x1, dz = z2 - z1;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((x - x1) * dx + (z - z1) * dz) / len2;
    t = clamp(t, 0, 1);
    const px = x1 + t * dx, pz = z1 + t * dz;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) best = d;
  }
  return best;
}
export function polylineLength(pts) {
  let l = 0;
  for (let i = 0; i < pts.length - 1; i++) l += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return l;
}
export function pointInRect(x, z, r) { return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1; }

// 返回场地类型
export function surfaceAt(x, z) {
  // 市政道路
  for (const r of ROADS) {
    if (r.axis === 'x' && z >= r.z - r.w / 2 && z <= r.z + r.w / 2 && x >= r.from && x <= r.to) return 'road';
  }
  if (z > 92 && z < 100) return 'sidewalk';
  for (const b of BUILDINGS) if (pointInRect(x, z, b)) return 'building';
  for (const c of CITY) if (pointInRect(x, z, c)) return 'city';
  for (const c of COURTS) if (pointInRect(x, z, c)) return 'court';
  for (const p of PLAZAS) if (pointInRect(x, z, p)) return 'plaza';
  if (pointInRect(x, z, PARKING)) return 'parking';
  const pd = pathDist(x, z);
  if (pd.d < pd.path.w / 2) return 'path';
  if (isWater(x, z)) return 'water';
  return 'grass';
}
export function zoneNameAt(x, z) {
  const s = surfaceAt(x, z);
  const map = {
    road: '彩田路（城市道路）', sidewalk: '人行道', building: '建筑', city: '城市界面',
    court: '运动场地', plaza: '广场铺装', parking: '停车区', path: '园路步道', water: '彩田湖水域', grass: '园林绿地'
  };
  return map[s] || '园林绿地';
}

// ---- 摄像头朝向：沿最近园路的走向 ------------------------------------------
export function headingAt(x, z) {
  let best = 1e9, dir = [0, -1];
  for (const p of PATHS) {
    for (let i = 0; i < p.points.length - 1; i++) {
      const [x1, z1] = p.points[i], [x2, z2] = p.points[i + 1];
      const dx = x2 - x1, dz = z2 - z1;
      const len2 = dx * dx + dz * dz || 1;
      let t = ((x - x1) * dx + (z - z1) * dz) / len2;
      t = clamp(t, 0, 1);
      const px = x1 + t * dx, pz = z1 + t * dz;
      const d = Math.hypot(x - px, z - pz);
      if (d < best) { best = d; const l = Math.hypot(dx, dz) || 1; dir = [dx / l, dz / l]; }
    }
  }
  // 远离园路（如市政界面）则朝向园区中心
  if (best > 40) { const l = Math.hypot(x, z) || 1; dir = [-x / l, -z / l]; }
  return Math.atan2(dir[1], dir[0]);
}

// ---- 采样工具 --------------------------------------------------------------
export function samplePolyline(pts, spacing = 1.2) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(1, Math.round(len / spacing));
    for (let j = 0; j < n; j++) {
      const t = j / n;
      out.push([x1 + (x2 - x1) * t, z1 + (z2 - z1) * t]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
