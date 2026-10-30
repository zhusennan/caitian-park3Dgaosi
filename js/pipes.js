// ============================================================================
//  彩田公园 · 管网展示图层（地上 + 地下）
// ============================================================================
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { groundHeight } from './terrain.js?v=5';
import { PIPE_TYPES } from './data.js?v=5';

function labelSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 96);
  g.font = 'bold 44px "PingFang SC",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = g.measureText(text).width + 34;
  g.fillStyle = 'rgba(8,16,22,.86)';
  g.beginPath();
  g.roundRect(128 - w / 2, 18, w, 60, 30);
  g.fill();
  g.strokeStyle = color; g.lineWidth = 4; g.stroke();
  g.fillStyle = color;
  g.fillText(text, 128, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false }));
  s.scale.set(7.4, 2.8, 1);
  s.renderOrder = 800;
  return s;
}

export function createPipeLayer(pipes) {
  const group = new THREE.Group();
  const below = new THREE.Group(); below.name = 'pipeBelow';
  const above = new THREE.Group(); above.name = 'pipeAbove';
  group.add(below, above);
  const pickables = [];
  const items = [];
  const materials = [];

  const curveOf = (pts, depth) => {
    const v = pts.map(([x, z]) => new THREE.Vector3(x, groundHeight(x, z) + depth, z));
    return new THREE.CatmullRomCurve3(v, false, 'catmullrom', 0.2);
  };

  for (const p of pipes) {
    const t = PIPE_TYPES[p.type];
    const hex = '#' + t.color.toString(16).padStart(6, '0');
    const curve = curveOf(p.points, p.depth);
    const SAMPLES = Math.max(24, Math.round(p.points.length * 14));
    const pts3 = curve.getPoints(SAMPLES).map(v => [v.x, v.y, v.z]);

    const mat = new LineMaterial({
      color: t.color,
      linewidth: p.layer === 'below' ? 1.5 : 0.65,
      worldUnits: true,
      transparent: true,
      opacity: p.layer === 'below' ? 0.96 : 0.92,
      dashed: p.layer === 'below',
      dashSize: 2.4,
      gapSize: 1.5,
      dashScale: 1,
      depthWrite: false,
      depthTest: p.layer !== 'below'
    });
    materials.push(mat);
    const geo = new LineGeometry();
    geo.setPositions(pts3.flat());
    const line = new Line2(geo, mat);
    line.computeLineDistances();
    line.renderOrder = p.layer === 'below' ? 30 : 12;
    (p.layer === 'below' ? below : above).add(line);

    // 拾取体
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, SAMPLES, 1.3, 6, false),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    tube.userData.pipe = p;
    (p.layer === 'below' ? below : above).add(tube);
    pickables.push(tube);

    // 埋深标注
    if (p.layer === 'below') {
      const mid = curve.getPoint(0.5);
      const spr = labelSprite(`${p.depth.toFixed(1)}m`, hex);
      spr.position.set(mid.x, mid.y + 1.6, mid.z);
      below.add(spr);
      // 地面投影标记
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.1, 1.7, 20),
        new THREE.MeshBasicMaterial({ color: t.color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(mid.x, groundHeight(mid.x, mid.z) + 0.2, mid.z);
      below.add(ring);
    } else {
      const mid = curve.getPoint(0.5);
      const spr = labelSprite(`${p.name.slice(0, 10)}`, hex);
      spr.position.set(mid.x, mid.y + 2.2, mid.z);
      spr.scale.set(8.4, 3.1, 1);
      above.add(spr);
    }

    // 长度
    let len = 0;
    for (let i = 0; i < pts3.length - 1; i++) len += Math.hypot(pts3[i + 1][0] - pts3[i][0], pts3[i + 1][1] - pts3[i][1], pts3[i + 1][2] - pts3[i][2]);
    p.len = Math.round(len);

    items.push({ pipe: p, line, tube, mat });
  }

  function setResolution(w, h) {
    for (const m of materials) m.resolution.set(w, h);
  }
  function select(pipe) {
    for (const it of items) {
      const on = it.pipe === pipe;
      it.mat.linewidth = on ? (it.pipe.layer === 'below' ? 3.2 : 1.4) : (it.pipe.layer === 'below' ? 1.5 : 0.65);
      it.mat.opacity = on ? 1 : (it.pipe.layer === 'below' ? 0.95 : 0.9);
    }
  }
  function clear() {
    for (const it of items) {
      it.mat.linewidth = it.pipe.layer === 'below' ? 1.5 : 0.65;
      it.mat.opacity = it.pipe.layer === 'below' ? 0.95 : 0.9;
    }
  }

  return { group, below, above, items, pickables, setResolution, select, clear };
}
