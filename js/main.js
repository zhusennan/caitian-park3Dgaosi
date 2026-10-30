// ============================================================================
//  彩田公园数字孪生平台 Demo · 主程序
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { buildParkScene, buildWater, buildTerrainBase, buildBuildingBase } from './park.js?v=4';
import { createCameraLayer } from './cameras.js?v=4';
import { createPipeLayer } from './pipes.js?v=4';
import { createHeatLayer } from './heat.js?v=4';
import { createUI } from './ui.js?v=4';
import {
  CAMERAS, PIPES, PEOPLE_SPOTS, EVENT_SPOTS, HOUR_PROFILE, EVENT_PROFILE,
  PRESETS, SCENE_LABELS, PIPE_TYPES
} from './data.js?v=4';
import { groundHeight, headingAt, PATHS, PARK } from './terrain.js?v=4';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const state = {
  hour: 14,
  playing: false,
  preset: 0,
  layers: {
    gs: true, cams: true, 'heat-people': false, 'heat-event': false,
    'pipe-above': false, 'pipe-below': false, labels: true, minimap: false
  },
  selectedCam: null,
  selectedPipe: null,
  xray: false,
  top: false,
  walk: false,
  detail: 'overview'
};

// ---------------------------------------------------------------------------
//  渲染器 / 场景
// ---------------------------------------------------------------------------
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const BG = new THREE.Color(0x93a9bb);
const scene = new THREE.Scene();
scene.background = BG;
scene.fog = new THREE.Fog(BG, 460, 1500);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.4, 3000);
camera.position.set(26, 132, 248);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.target.set(0, 2, 16);
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 6;
controls.maxDistance = 620;
controls.screenSpacePanning = false;

scene.add(new THREE.HemisphereLight(0xdbe9f5, 0x4a5344, 1.15));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.35);
sun.position.set(120, 180, 90);
scene.add(sun);

// ---------------------------------------------------------------------------
//  3D 高斯实景材质
// ---------------------------------------------------------------------------
const splatMat = new THREE.ShaderMaterial({
  uniforms: {
    uPointScale: { value: 800 },
    uOpacity: { value: 1 },
    uGroundFade: { value: 1 },
    uSizeScale: { value: 1.9 },
    uFogColor: { value: BG.clone() },
    uFogNear: { value: 460 },
    uFogFar: { value: 1500 }
  },
  vertexShader: /* glsl */`
    attribute vec3 color;
    attribute float aSize;
    attribute float aFlag;
    uniform float uPointScale;
    uniform float uSizeScale;
    uniform float uOpacity;
    uniform float uGroundFade;
    varying vec3 vCol;
    varying float vA;
    varying float vFog;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float dist = max(-mv.z, 0.05);
      gl_Position = projectionMatrix * mv;
      float maxPx = mix(22.0, 150.0, aFlag);   // 地表高斯近处收敛，避免特写穿帮
      gl_PointSize = clamp(aSize * uSizeScale * uPointScale / dist, 0.9, maxPx);
      vCol = color;
      vA = uOpacity * mix(uGroundFade, 1.0, aFlag);
      vFog = dist;
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 uFogColor;
    uniform float uFogNear;
    uniform float uFogFar;
    varying vec3 vCol;
    varying float vA;
    varying float vFog;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float r2 = dot(c, c) * 4.0;
      if (r2 > 1.0) discard;
      float a = smoothstep(1.0, 0.45, sqrt(r2));
      float alpha = a * vA;
      if (alpha < 0.035) discard;
      vec3 col = mix(vCol, uFogColor, clamp((vFog - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0));
      gl_FragColor = vec4(col, alpha);
    }`,
  transparent: true,
  depthTest: true,
  depthWrite: true
});

let splatMesh = null;
let gaussCount = 0;

// ---------------------------------------------------------------------------
//  图层对象
// ---------------------------------------------------------------------------
const water = buildWater();
scene.add(water);

const terrainBase = buildTerrainBase();
scene.add(terrainBase);

const buildingBase = buildBuildingBase();
scene.add(buildingBase);

const camLayer = createCameraLayer(CAMERAS);
scene.add(camLayer.group);

const pipeLayer = createPipeLayer(PIPES);
scene.add(pipeLayer.group);

const heatPeople = createHeatLayer(PEOPLE_SPOTS, 'people', HOUR_PROFILE);
const heatEvent = createHeatLayer(EVENT_SPOTS, 'event', EVENT_PROFILE);
scene.add(heatPeople.mesh, heatEvent.mesh);

// 场景标注（HTML）
const labelHost = document.createElement('div');
labelHost.id = 'labels';
$('#app').appendChild(labelHost);
const labels = SCENE_LABELS.map(l => {
  const el = document.createElement('div');
  el.className = 'wlabel ' + (l.kind || 'tag');
  el.textContent = l.text;
  labelHost.appendChild(el);
  return { el, pos: new THREE.Vector3(...l.pos) };
});

// ---------------------------------------------------------------------------
//  UI
// ---------------------------------------------------------------------------
const app = {
  get hour() { return state.hour; },
  selectCamera: (cam, fly) => selectCamera(cam, fly),
  flyTo: (x, z) => flyToPoint(x, z),
  captureCamView: (cam) => captureCamView(cam)
};
const ui = createUI(app);
ui.overview();

// ---------------------------------------------------------------------------
//  交互
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
raycaster.params.Points.threshold = 2;
const pointer = new THREE.Vector2();
let downPos = null;

function updatePointer(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
}
// 屏幕空间命中：点到摄像头编号牌即可（远距离更可靠）
const _proj = new THREE.Vector3();
function pickCamByScreen(px, py) {
  if (!state.layers.cams) return null;
  let best = null, bestD = 26;
  for (const it of camLayer.items) {
    it.spr.getWorldPosition(_proj);
    _proj.project(camera);
    if (_proj.z > 1) continue;
    const sx = (_proj.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-_proj.y * 0.5 + 0.5) * window.innerHeight;
    const d = Math.hypot(sx - px, sy - py);
    if (d < bestD) { bestD = d; best = it.cam; }
  }
  return best;
}

function pickAt(e) {
  updatePointer(e);
  if (state.layers.cams) {
    const near = pickCamByScreen(e.clientX, e.clientY);
    if (near) return { type: 'cam', obj: near };
  }
  raycaster.setFromCamera(pointer, camera);
  if (state.layers.cams) {
    const hit = raycaster.intersectObjects(camLayer.pickables, false);
    if (hit.length) return { type: 'cam', obj: hit[0].object.userData.cam };
  }
  if (state.layers['pipe-above'] || state.layers['pipe-below']) {
    const hit = raycaster.intersectObjects(pipeLayer.pickables, false);
    if (hit.length) return { type: 'pipe', obj: hit[0].object.userData.pipe };
  }
  return null;
}

renderer.domElement.addEventListener('pointerdown', (e) => { downPos = { x: e.clientX, y: e.clientY }; renderer.domElement.classList.add('dragging'); });
window.addEventListener('pointerup', (e) => {
  renderer.domElement.classList.remove('dragging');
  if (!downPos || state.walk) { downPos = null; return; }
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  downPos = null;
  if (moved > 5) return;
  if (document.querySelector('.modal.open')) { downPos = null; return; }  // 弹窗打开时不拾取场景
  const hit = pickAt(e);
  if (!hit) { clearSelection(); return; }
  if (hit.type === 'cam') selectCamera(hit.obj, true);
  else selectPipe(hit.obj);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (state.walk) return;
  if (downPos) return;
  const hit = pickAt(e);
  renderer.domElement.classList.toggle('picking', !!hit);
});

function clearSelection() {
  state.selectedCam = null; state.selectedPipe = null; state.detail = 'overview';
  camLayer.clear(); pipeLayer.clear();
  ui.overview();
}
function selectCamera(cam, fly) {
  state.selectedCam = cam; state.selectedPipe = null; state.detail = 'overview';
  camLayer.select(cam); pipeLayer.clear();
  ui.setSelected && ui.setSelected(cam.id);
  ui.openVideo(cam);        // 中间弹窗展示监控画面
  ui.overview();            // 右侧抽屉回到园区总览
  if (fly) {
    const gy = groundHeight(cam.x, cam.z);
    // 从园区内侧看向摄像头，避免机位落在建筑/道路外侧
    let dx = 0 - cam.x, dz = 0 - cam.z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    const dist = 32;
    flyTo(
      new THREE.Vector3(cam.x + dx * dist, gy + 16, cam.z + dz * dist),
      new THREE.Vector3(cam.x, gy + Math.min(cam.poleH - 0.6, 5.2), cam.z),
      1100
    );
  }
}
function selectPipe(p) {
  state.selectedPipe = p; state.selectedCam = null; state.detail = 'pipe';
  pipeLayer.select(p); camLayer.clear();
  ui.pipeDetail(p);
}

// ---------------------------------------------------------------------------
//  相机动画
// ---------------------------------------------------------------------------
let anim = null;
function flyTo(pos, target, dur = 1200) {
  anim = { t: 0, dur, p0: camera.position.clone(), p1: pos, t0: controls.target.clone(), t1: target };
}
function flyToPoint(x, z) {
  const gy = groundHeight(x, z);
  flyTo(new THREE.Vector3(x, gy + 95, z + 62), new THREE.Vector3(x, gy, z), 900);
  ui.toast(`定位到 X ${x.toFixed(0)} / Z ${z.toFixed(0)}`);
}

// 第一人称漫游
const walk = { yaw: 0, pitch: -0.12, pos: new THREE.Vector3(), keys: {}, dragging: false, lx: 0, ly: 0 };
function enterWalk() {
  state.walk = true;
  walk.pos.set(-3, groundHeight(-3, 60) + 1.68, 60);
  walk.yaw = Math.PI; walk.pitch = -0.05;
  controls.enabled = false;
  ui.toast('已进入第一人称漫游：W/A/S/D 移动，按住鼠标拖动转向');
}
function exitWalk() {
  state.walk = false;
  controls.enabled = true;
  const p = walk.pos.clone();
  flyTo(new THREE.Vector3(p.x + 20, p.y + 26, p.z + 34), new THREE.Vector3(p.x, p.y, p.z), 800);
}
window.addEventListener('keydown', (e) => {
  walk.keys[e.code] = true;
  if (e.code === 'Escape' && state.walk) exitWalk();
});
window.addEventListener('keyup', (e) => { walk.keys[e.code] = false; });
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!state.walk) return;
  walk.dragging = true; walk.lx = e.clientX; walk.ly = e.clientY;
});
window.addEventListener('pointermove', (e) => {
  if (!state.walk || !walk.dragging) return;
  walk.yaw -= (e.clientX - walk.lx) * 0.004;
  walk.pitch = Math.max(-1.2, Math.min(1.0, walk.pitch - (e.clientY - walk.ly) * 0.003));
  walk.lx = e.clientX; walk.ly = e.clientY;
});
window.addEventListener('pointerup', () => { walk.dragging = false; });

function updateWalk(dt) {
  const speed = 9 * dt;
  const fwd = new THREE.Vector3(Math.sin(walk.yaw), 0, Math.cos(walk.yaw));
  const right = new THREE.Vector3(Math.cos(walk.yaw), 0, -Math.sin(walk.yaw));
  let mv = new THREE.Vector3();
  if (walk.keys['KeyW'] || walk.keys['ArrowUp']) mv.add(fwd);
  if (walk.keys['KeyS'] || walk.keys['ArrowDown']) mv.sub(fwd);
  if (walk.keys['KeyA'] || walk.keys['ArrowLeft']) mv.sub(right);
  if (walk.keys['KeyD'] || walk.keys['ArrowRight']) mv.add(right);
  if (mv.lengthSq() > 0) walk.pos.addScaledVector(mv.normalize(), speed);
  walk.pos.x = Math.max(-140, Math.min(140, walk.pos.x));
  walk.pos.z = Math.max(-105, Math.min(95, walk.pos.z));
  walk.pos.y = groundHeight(walk.pos.x, walk.pos.z) + 1.68;
  camera.position.copy(walk.pos);
  const look = new THREE.Vector3(
    walk.pos.x - Math.sin(walk.yaw) * Math.cos(walk.pitch),
    walk.pos.y + Math.sin(walk.pitch),
    walk.pos.z - Math.cos(walk.yaw) * Math.cos(walk.pitch)
  );
  camera.lookAt(look);
}

// ---------------------------------------------------------------------------
//  图层控制
// ---------------------------------------------------------------------------
function applyLayers() {
  if (splatMesh) splatMesh.visible = state.layers.gs;
  camLayer.group.visible = state.layers.cams;
  heatPeople.mesh.visible = state.layers['heat-people'];
  heatEvent.mesh.visible = state.layers['heat-event'];
  pipeLayer.above.visible = state.layers['pipe-above'];
  pipeLayer.below.visible = state.layers['pipe-below'];
  labelHost.style.display = state.layers.labels ? 'block' : 'none';
  // 透视状态由 setXray 统一控制（地表半透明）
  splatMat.uniforms.uGroundFade.value = state.xray ? 0.22 : 1.0;
  // 图例
  if (state.layers['heat-people']) ui.setLegend('people');
  else if (state.layers['heat-event']) ui.setLegend('event');
  else $('#legend').style.display = 'none';
}
// 地下管网透视开关（左侧图层与右侧工具栏共用同一状态）
function setXray(on) {
  state.xray = on;
  splatMat.uniforms.uGroundFade.value = on ? 0.22 : 1.0;
  const btn = document.querySelector('[data-tool="xray"]');
  if (btn) btn.classList.toggle('active', on);
}

$$('[data-layer-toggle]').forEach(el => {
  el.addEventListener('change', () => {
    const key = el.dataset.layerToggle;
    state.layers[key] = el.checked;
    if (key === 'pipe-below') {
      // 打开 = 管网展示 + 地表半透明；关闭 = 同时退出半透明
      setXray(el.checked);
    }
    applyLayers();
    if (key === 'heat-people' || key === 'heat-event') {
      if (state.layers['heat-people'] || state.layers['heat-event']) {
        const kind = state.layers['heat-people'] ? 'people' : 'event';
        if (state.detail === 'overview' || state.detail === 'heat') { state.detail = 'heat'; ui.heatDetail(kind); }
      } else if (state.detail === 'heat') {
        // 热力图关闭 → 右侧抽屉同步回到总览
        state.detail = 'overview';
        ui.overview();
      }
    }
  });
});
// 面板收起 / 展开（折叠后标题条与按钮始终可见，可再次展开）
function togglePanel(sel, collapsedBtn, expandedBtn) {
  const p = $(sel);
  const collapsed = p.classList.toggle('collapsed');
  const btn = p.querySelector('.collapse');
  if (btn) btn.textContent = collapsed ? collapsedBtn : expandedBtn;
  p.querySelector('.panel-head').title = collapsed ? '点击展开' : '点击收起';
}
$('#collapseLeft').addEventListener('click', (e) => {
  e.stopPropagation();
  togglePanel('#panelLeft', '›', '‹');
});
$('#collapseRight').addEventListener('click', (e) => {
  e.stopPropagation();
  togglePanel('#panelRight', '‹', '›');
});
// 折叠状态下点击标题条可展开
['#panelLeft', '#panelRight'].forEach((sel, i) => {
  $(sel + ' .panel-head').addEventListener('click', (e) => {
    if (e.target.closest('.collapse')) return;
    if ($(sel).classList.contains('collapsed')) togglePanel(sel, i === 0 ? '›' : '‹', i === 0 ? '‹' : '›');
  });
});

// 工具栏
$$('.toolbar button').forEach(btn => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.tool;
    if (tool === 'view3d') {
      state.top = false;
      $$('.toolbar button').forEach(b => b.classList.toggle('active', b === btn));
      const p = PRESETS[state.preset];
      flyTo(new THREE.Vector3(...p.cam), new THREE.Vector3(...p.target), 900);
    } else if (tool === 'top') {
      state.top = !state.top;
      btn.classList.toggle('active', state.top);
      if (state.top) flyTo(new THREE.Vector3(0, 330, 1), new THREE.Vector3(0, 0, 0), 900);
      else { const p = PRESETS[state.preset]; flyTo(new THREE.Vector3(...p.cam), new THREE.Vector3(...p.target), 900); }
    } else if (tool === 'walk') {
      state.walk ? exitWalk() : enterWalk();
      btn.classList.toggle('active', state.walk);
    } else if (tool === 'xray') {
      const on = !state.xray;
      const cb = document.querySelector('[data-layer-toggle="pipe-below"]');
      cb.checked = on;
      state.layers['pipe-below'] = on;
      setXray(on);
      applyLayers();
      ui.toast(on ? '地下管网透视已开启：地表半透明 + 管网展示' : '已退出地下管网透视');
    } else if (tool === 'minimap') {
      const on = !state.layers.minimap;
      state.layers.minimap = on;
      $('#minimap').classList.toggle('show', on);
      document.body.classList.toggle('minimap-open', on);
      btn.classList.toggle('active', on);
    } else if (tool === 'cams') {
      ui.openCamList();
    } else if (tool === 'annotate') {
      const cb = document.querySelector('[data-layer-toggle="labels"]');
      cb.checked = !cb.checked;
      state.layers.labels = cb.checked;
      applyLayers();
      btn.classList.toggle('active', cb.checked);
    } else if (tool === 'shot') {
      renderer.render(scene, camera);
      const a = document.createElement('a');
      a.download = `彩田公园_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.png`;
      a.href = renderer.domElement.toDataURL('image/png');
      a.click();
      ui.toast('已保存当前视角截图');
    } else if (tool === 'reset') {
      const p = PRESETS[state.preset];
      flyTo(new THREE.Vector3(...p.cam), new THREE.Vector3(...p.target), 900);
      clearSelection();
      ui.toast('视角已重置');
    }
  });
});

// 场景切换
function setPreset(i) {
  state.preset = (i + PRESETS.length) % PRESETS.length;
  const p = PRESETS[state.preset];
  $('#sceneCurrent').textContent = p.name;
  flyTo(new THREE.Vector3(...p.cam), new THREE.Vector3(...p.target), 1300);
}
$('#scenePrev').addEventListener('click', () => setPreset(state.preset - 1));
$('#sceneNext').addEventListener('click', () => setPreset(state.preset + 1));

// 时间轴
const hourSlider = $('#hourSlider');
const ticks = $('#tlTicks');
[0, 6, 12, 18, 23].forEach(h => {
  const s = document.createElement('span'); s.textContent = h + '时'; ticks.appendChild(s);
});
function setHour(h, fromSlider = false) {
  state.hour = h;
  if (!fromSlider) hourSlider.value = h;
  heatPeople.update(h);
  heatEvent.update(h);
  const hh = Math.floor(h), mm = Math.floor((h % 1) * 60);
  $('#tlHour').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const now = new Date(2026, 9, 30);
  const total = Math.round(HOUR_PROFILE[hh] * 1286);
  $('#tlNow').innerHTML = `当前在园人数 <b>${total.toLocaleString()}</b>`;
  const d = new Date();
  $('#clock').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  if (state.detail === 'heat') {
    const kind = state.layers['heat-people'] ? 'people' : 'event';
    ui.heatDetail(kind);
  }
}
hourSlider.addEventListener('input', (e) => setHour(parseFloat(e.target.value), true));
$('#playBtn').addEventListener('click', () => {
  state.playing = !state.playing;
  $('#playIcon').innerHTML = state.playing
    ? '<path fill="currentColor" d="M7 5h4v14H7zM13 5h4v14h-4z"/>'
    : '<path fill="currentColor" d="M8 5v14l11-7z"/>';
});

// ---------------------------------------------------------------------------
//  监控画面：从该摄像头机位对 3D 高斯场景取景渲染
// ---------------------------------------------------------------------------
const CAM_VIEW_W = 640, CAM_VIEW_H = 360;
const camViewRT = new THREE.WebGLRenderTarget(CAM_VIEW_W, CAM_VIEW_H, {
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter
});
camViewRT.texture.colorSpace = THREE.NoColorSpace;   // 线性输出，色调映射在 JS 内完成
const camViewCam = new THREE.PerspectiveCamera(60, CAM_VIEW_W / CAM_VIEW_H, 0.3, 2500);
const camViewBuf = new Uint8Array(CAM_VIEW_W * CAM_VIEW_H * 4);
const camViewCache = new Map();

function captureCamView(cam) {
  if (camViewCache.has(cam.id)) return camViewCache.get(cam.id);
  const gy = groundHeight(cam.x, cam.z);
  const h = headingAt(cam.x, cam.z);
  const pitch = cam.type === '半球' ? -0.32 : -0.16;
  camViewCam.fov = cam.type === '枪机' ? 52 : (cam.type === '半球' ? 100 : 82);
  camViewCam.aspect = CAM_VIEW_W / CAM_VIEW_H;
  camViewCam.updateProjectionMatrix();
  const arm = 1.05;
  camViewCam.position.set(
    cam.x + Math.cos(h) * arm,
    gy + cam.poleH - 0.45,
    cam.z + Math.sin(h) * arm
  );
  const look = 12;
  camViewCam.lookAt(
    camViewCam.position.x + Math.cos(h) * look,
    camViewCam.position.y + Math.tan(pitch) * look,
    camViewCam.position.z + Math.sin(h) * look
  );
  // 取景时隐藏业务叠加层，只保留实景
  const hide = [camLayer.group, heatPeople.mesh, heatEvent.mesh, pipeLayer.group];
  const vis = hide.map(o => o.visible);
  hide.forEach(o => { o.visible = false; });
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(camViewRT);
  renderer.render(scene, camViewCam);
  renderer.setRenderTarget(prev);
  hide.forEach((o, i) => { o.visible = vis[i]; });

  renderer.readRenderTargetPixels(camViewRT, 0, 0, CAM_VIEW_W, CAM_VIEW_H, camViewBuf);
  const cv = document.createElement('canvas');
  cv.width = CAM_VIEW_W; cv.height = CAM_VIEW_H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(CAM_VIEW_W, CAM_VIEW_H);
  const exp = renderer.toneMappingExposure * 0.86;
  const grade = [0, 0, 0];
  for (let y = 0; y < CAM_VIEW_H; y++) {
    const src = (CAM_VIEW_H - 1 - y) * CAM_VIEW_W * 4;
    const dst = y * CAM_VIEW_W * 4;
    for (let x = 0; x < CAM_VIEW_W; x++) {
      const o = src + x * 4;
      for (let k = 0; k < 3; k++) {
        // 线性 → 曝光 → ACES → sRGB
        let v = (camViewBuf[o + k] / 255) * exp;
        v = (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
        v = v < 0 ? 0 : (v > 1 ? 1 : v);
        v = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
        grade[k] = v;
      }
      // 监控成像风格：降曝光 + 轻微去饱和 + 冷色 + 轻微对比
      let lr = grade[0], lg = grade[1], lb = grade[2];
      const lum = 0.299 * lr + 0.587 * lg + 0.114 * lb;
      lr = lum + (lr - lum) * 0.80;
      lg = lum + (lg - lum) * 0.80;
      lb = lum + (lb - lum) * 0.80;
      lr *= 0.90; lg *= 0.97; lb *= 1.06;
      lr = (lr - 0.5) * 1.07 + 0.5;
      lg = (lg - 0.5) * 1.07 + 0.5;
      lb = (lb - 0.5) * 1.07 + 0.5;
      img.data[dst + x * 4] = Math.round(Math.max(0, Math.min(1, lr)) * 255);
      img.data[dst + x * 4 + 1] = Math.round(Math.max(0, Math.min(1, lg)) * 255);
      img.data[dst + x * 4 + 2] = Math.round(Math.max(0, Math.min(1, lb)) * 255);
      img.data[dst + x * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  camViewCache.set(cam.id, cv);
  return cv;
}

// ---------------------------------------------------------------------------
//  初始化
// ---------------------------------------------------------------------------
async function init() {
  const loaderFill = $('#loaderFill'), loaderText = $('#loaderText');
  const setProg = (p, label) => {
    loaderFill.style.width = Math.round(p * 100) + '%';
    if (label) loaderText.textContent = label;
  };
  setProg(0.04, '初始化渲染引擎…');
  await new Promise(r => setTimeout(r, 60));

  const { geometry, count } = await buildParkScene((p, label) => setProg(0.08 + p * 0.8, label));
  splatMesh = new THREE.Points(geometry, splatMat);
  splatMesh.frustumCulled = false;
  scene.add(splatMesh);
  gaussCount = count;
  console.log('[3DGS] 高斯点数', count);

  setProg(0.94, '装配业务图层…');
  setHour(state.hour);
  applyLayers();

  // 管线分辨率
  pipeLayer.setResolution(window.innerWidth, window.innerHeight);

  setProg(1, '就绪');
  await new Promise(r => setTimeout(r, 260));
  $('#loader').classList.add('hide');
  setTimeout(() => { $('#loader').style.display = 'none'; }, 700);
}

// ---------------------------------------------------------------------------
//  渲染循环
// ---------------------------------------------------------------------------
let last = performance.now(), fpsAcc = 0, fpsN = 0;
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (anim) {
    anim.t += dt * 1000;
    const k = Math.min(1, anim.t / anim.dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    camera.position.lerpVectors(anim.p0, anim.p1, e);
    controls.target.lerpVectors(anim.t0, anim.t1, e);
    if (k >= 1) anim = null;
  }

  if (state.walk) updateWalk(dt); else controls.update();

  // 点尺寸随视口
  const h = renderer.domElement.height;
  splatMat.uniforms.uPointScale.value = h * 0.5 / Math.tan(camera.fov * Math.PI / 360);

  // 水面微动
  water.material.opacity = 0.78 + Math.sin(now / 2600) * 0.05;

  // 标注投影
  if (state.layers.labels) {
    for (const l of labels) {
      const p = l.pos.clone().project(camera);
      const vis = p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
      l.el.style.display = vis ? 'block' : 'none';
      if (vis) {
        l.el.style.left = ((p.x * 0.5 + 0.5) * window.innerWidth) + 'px';
        l.el.style.top = ((-p.y * 0.5 + 0.5) * window.innerHeight) + 'px';
      }
    }
  }

  renderer.render(scene, camera);

  // FPS
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) {
    $('#fps').textContent = Math.round(fpsN / fpsAcc) + ' FPS · ' + gaussCount.toLocaleString() + ' 高斯点';
    fpsAcc = 0; fpsN = 0;
  }

  // 平面索引
  if (!minimapTick || now - minimapTick > 90) {
    minimapTick = now;
    ui.drawMinimap({
      camsOn: state.layers.cams, pipesOn: state.layers['pipe-above'] || state.layers['pipe-below'],
      camPos: [camera.position.x, camera.position.z]
    });
  }
}
let minimapTick = 0;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  pipeLayer.setResolution(window.innerWidth, window.innerHeight);
});

// 时间播放
setInterval(() => {
  if (!state.playing) return;
  let h = state.hour + 0.08;
  if (h > 23.5) h = 0;
  setHour(h);
}, 120);

init();
loop();

// 暴露调试接口
window.__demo = { state, scene, camera, renderer, camLayer, pipeLayer, heatPeople, heatEvent, ui, setHour, flyTo, selectCamera };
