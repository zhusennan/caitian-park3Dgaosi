// ============================================================================
//  彩田公园 · 界面层（详情面板 / 平面索引 / 图例 / 时间轴 / 监控画面模拟）
// ============================================================================
import { CAMERAS, PIPES, PIPE_TYPES, RECON, EVENT_TYPES, HOUR_PROFILE, EVENT_PROFILE } from './data.js?v=4';
import { PARK, LAKE, PATHS, ROADS, COURTS, PLAZAS, PARKING, BUILDINGS, groundHeight, lakeNorm } from './terrain.js?v=4';
import { RAMPS } from './heat.js?v=4';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// ---------------------------------------------------------------------------
//  监控画面模拟
// ---------------------------------------------------------------------------
// 真实监控画面素材（园区实拍）
const CAM_IMG = new Image();
CAM_IMG.decoding = 'async';
CAM_IMG.src = './assets/camera-real.jpg?v=1';
let CAM_IMG_OK = false;
CAM_IMG.onload = () => { CAM_IMG_OK = true; };
CAM_IMG.onerror = () => { CAM_IMG_OK = false; };

// 监控画面模拟器：真实照片 + CCTV 叠加层
class FeedSim {
  constructor(canvas, cam, w, h, bg) {
    this.c = canvas; this.cam = cam; this.ctx = canvas.getContext('2d');
    this.c.width = w || 320; this.c.height = h || 180;
    this.S = this.c.width / 320;
    this.bg = bg || null;      // 该机位的实景取景渲染结果
    this.t = 0; this.raf = null; this.hour = 14;
    // 每路摄像头取景窗口（模拟不同安装位置与朝向）
    const i = cam.index || 1;
    const a = i * 2.39996;
    const rr = 0.08 + 0.17 * (((i * 37) % 46) / 46);
    const typeZoom = cam.type === '球机' ? 0.0 : (cam.type === '枪机' ? 0.55 : 0.25);
    this.crop = {
      cx: 0.5 + Math.cos(a) * rr,
      cy: 0.52 + Math.sin(a) * rr * 0.62,
      zoom: 1.12 + typeZoom + ((i * 17) % 7) / 7 * 0.45
    };
    this.people = Array.from({ length: 5 }, () => ({ x: Math.random(), y: 0.5 + Math.random() * 0.35, s: 0.5 + Math.random() * 0.5 }));
  }
  setHour(h) { this.hour = h; }

  drawPhoto() {
    const g = this.ctx, W = 320, H = 180;
    if (this.bg) {
      g.drawImage(this.bg, 0, 0, W, H);
      return;
    }
    const IW = CAM_IMG.naturalWidth || 1228, IH = CAM_IMG.naturalHeight || 920;
    const z = this.crop.zoom;
    const aspect = W / H;
    let sh = IH / z, sw = sh * aspect;
    if (sw > IW) { sw = IW; sh = sw / aspect; }
    let sx = this.crop.cx * IW - sw / 2;
    let sy = this.crop.cy * IH - sh / 2;
    sx = Math.max(0, Math.min(IW - sw, sx));
    sy = Math.max(0, Math.min(IH - sh, sy));
    // 轻微曝光差异，避免所有点位画面完全一致
    const bright = 0.94 + ((this.cam.index * 13) % 7) / 7 * 0.12;
    g.filter = 'brightness(' + bright.toFixed(2) + ') saturate(0.98) contrast(1.03)';
    g.drawImage(CAM_IMG, sx, sy, sw, sh, 0, 0, W, H);
    g.filter = 'none';
  }

  drawFallback() {
    const g = this.ctx, W = 320, H = 180;
    const night = this.hour < 6.2 || this.hour > 18.6;
    const sky = g.createLinearGradient(0, 0, 0, H * 0.55);
    if (night) { sky.addColorStop(0, '#0b1420'); sky.addColorStop(1, '#16202b'); }
    else { sky.addColorStop(0, '#7fa8cf'); sky.addColorStop(1, '#c6d8e4'); }
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    const gr = g.createLinearGradient(0, H * 0.5, 0, H);
    gr.addColorStop(0, '#5c7347'); gr.addColorStop(1, '#3f5433');
    g.fillStyle = gr; g.fillRect(0, H * 0.5, W, H * 0.5);
    g.fillStyle = '#8b8577';
    g.beginPath();
    g.moveTo(W * 0.28, H); g.lineTo(W * 0.44, H * 0.52);
    g.lineTo(W * 0.62, H * 0.52); g.lineTo(W * 0.86, H);
    g.closePath(); g.fill();
    for (let i = 0; i < 9; i++) {
      const x = (i * 37 + 11) % W, y = H * 0.52 + ((i * 53) % 26);
      g.fillStyle = 'rgba(38,58,28,.72)';
      g.beginPath(); g.ellipse(x, y, 14 + (i * 7) % 16, 12 + (i * 5) % 14, 0, 0, Math.PI * 2); g.fill();
    }
  }

  draw() {
    const g = this.ctx, W = 320, H = 180;
    g.setTransform(this.S, 0, 0, this.S, 0, 0);
    if (CAM_IMG_OK && CAM_IMG.complete && CAM_IMG.naturalWidth) this.drawPhoto();
    else this.drawFallback();

    // 镜头暗角
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.42)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);

    // 噪点
    g.globalAlpha = 0.045;
    for (let i = 0; i < 260; i++) {
      g.fillStyle = Math.random() > 0.5 ? '#fff' : '#000';
      g.fillRect(Math.random() * W, Math.random() * H, 1.3, 1.3);
    }
    g.globalAlpha = 1;

    // 时间戳 / 设备号
    const d = new Date(2026, 9, 30, Math.floor(this.hour), Math.floor((this.hour % 1) * 60));
    const ts = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}`;
    g.font = '11px monospace'; g.textAlign = 'left';
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(4, 26, 96, 14);
    g.fillStyle = 'rgba(255,255,255,.94)';
    g.fillText(this.cam.id, 8, 37);
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(4, H - 18, 122, 14);
    g.fillStyle = 'rgba(255,255,255,.94)';
    g.fillText(ts, 8, H - 7);
    g.textAlign = 'right';
    g.fillStyle = 'rgba(0,0,0,.40)'; g.fillRect(W - 136, H - 18, 132, 14);
    g.fillStyle = 'rgba(255,255,255,.78)';
    g.fillText('HIKVISION  ' + this.cam.res, W - 8, H - 7);

  }
  start() { if (!this.raf) this.loop(); }
  stop() { clearTimeout(this.raf); this.raf = null; }
  loop() {
    this.draw();
    this.raf = setTimeout(() => requestAnimationFrame(() => this.loop()), 110);
  }
}

// ---------------------------------------------------------------------------
export function createUI(app) {
  const detailBody = $('#detailBody');
  const detailTitle = $('#detailTitle');
  let feed = null;

  // 渲染详情并复位滚动位置
  function setDetail(title, html) {
    detailTitle.textContent = title;
    detailBody.innerHTML = html;
    detailBody.scrollTop = 0;
  }

  // ---- 图层统计回填 -------------------------------------------------------
  const online = CAMERAS.filter(c => c.status === '在线').length;
  const offline = CAMERAS.length - online;
  const statsEl = document.querySelector('.layer-item[data-layer="cams"] .layer-stats');
  if (statsEl) statsEl.innerHTML = `<span>在线 ${online}</span><span>离线 ${offline}</span><span>共 ${CAMERAS.length} 路</span>`;

  const pipeTotal = PIPES.reduce((a, p) => a + (p.len || 0), 0);

  // ---- 监控点位列表 -------------------------------------------------------
  const camModal = $('#camModal');
  const camSearch = $('#camSearch');
  const camArea = $('#camArea');
  const camListBody = $('#camListBody');
  const camCount = $('#camListCount');
  let camStatusFilter = '全部';
  let selectedCamId = null;

  const camAreas = Array.from(new Set(CAMERAS.map(c => c.area)));
  camArea.innerHTML = '<option value="全部">全部区域</option>' +
    camAreas.map(a => `<option value="${a}">${a}</option>`).join('');

  function renderCamList() {
    const q = (camSearch.value || '').trim().toLowerCase();
    const area = camArea.value;
    const list = CAMERAS.filter(c =>
      (camStatusFilter === '全部' || c.status === camStatusFilter) &&
      (area === '全部' || c.area === area) &&
      (!q || c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) ||
        c.area.toLowerCase().includes(q) || c.type.toLowerCase().includes(q))
    );
    camCount.textContent = list.length + ' / ' + CAMERAS.length;
    camListBody.innerHTML = list.length ? list.map(c => `
      <div class="cam-row${c.id === selectedCamId ? ' sel' : ''}" data-cam-id="${c.id}">
        <div class="num">${c.index}</div>
        <div class="nm">${c.name}<i>${c.id}</i></div>
        <div class="ar">${c.area}</div>
        <div class="tp">${c.type}</div>
        <div class="st"><b class="${c.status === '在线' ? 'on' : 'off'}">${c.status}</b></div>
      </div>`).join('') : '<div class="cam-empty">未找到匹配的点位</div>';
    camListBody.querySelectorAll('[data-cam-id]').forEach(el => {
      el.addEventListener('click', () => {
        const cam = CAMERAS.find(c => c.id === el.dataset.camId);
        if (!cam) return;
        selectedCamId = cam.id;
        closeCamList();
        app.selectCamera(cam, true);
      });
    });
  }

  function openCamList() {
    camModal.classList.add('open');
    renderCamList();
    setTimeout(() => camSearch.focus(), 60);
  }
  function closeCamList() { camModal.classList.remove('open'); }

  // 遮罩判定用坐标（按下点是否落在卡片外），避免目标元素判定受层级影响
  function onBackdrop(e, modal, cardSel) {
    const card = modal.querySelector(cardSel);
    if (!card) return false;
    const r = card.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    return !inside;
  }
  let camBackdropDown = false;
  camModal.addEventListener('pointerdown', e => { camBackdropDown = onBackdrop(e, camModal, '.modal-card'); });
  camModal.addEventListener('click', e => {
    if (camBackdropDown && onBackdrop(e, camModal, '.modal-card')) closeCamList();
    camBackdropDown = false;
  });
  $('#camModalClose').addEventListener('click', closeCamList);
  camSearch.addEventListener('input', renderCamList);
  camArea.addEventListener('change', renderCamList);
  $('#camStatusChips').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $$('#camStatusChips .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    camStatusFilter = chip.dataset.status;
    renderCamList();
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeCamList(); });

  // ---- 监控画面弹窗 -------------------------------------------------------
  const videoModal = $('#videoModal');
  let videoFeed = null;
  let videoCam = null;

  function renderVideoInfo(cam) {
    $('#videoTitle').textContent = cam.name;
    $('#videoSub').innerHTML =
      `<span>${cam.id}</span><span>${cam.area}</span><span>${cam.type} · ${cam.res}</span>` +
      (cam.status === '在线'
        ? '<span style="color:var(--ok)">● 在线</span>'
        : '<span style="color:var(--danger)">● 离线</span>');
    $('#videoInfo').innerHTML = `
      <dl class="kv">
        <dt>设备编号</dt><dd>${cam.id}</dd>
        <dt>点位名称</dt><dd>${cam.name}</dd>
        <dt>所属区域</dt><dd>${cam.area}</dd>
        <dt>设备类型</dt><dd>${cam.type}（${cam.fov}）</dd>
        <dt>安装方式</dt><dd>${cam.mount} · 立杆高 ${cam.poleH}m</dd>
        <dt>分辨率</dt><dd>${cam.res} @ ${cam.fps}fps</dd>
        <dt>码流</dt><dd>${cam.bitrate}</dd>
        <dt>接入协议</dt><dd>${cam.protocol}</dd>
        <dt>存储策略</dt><dd>${cam.storage}</dd>
        <dt>供电</dt><dd>${cam.power}</dd>
        <dt>投运时间</dt><dd>${cam.install}</dd>
        <dt>坐标</dt><dd>X ${cam.x.toFixed(1)} / Z ${cam.z.toFixed(1)}</dd>
      </dl>`;
    const flowN = Math.round(HOUR_PROFILE[Math.floor(app.hour) % 24] * 900 * (cam.type === '球机' ? 1.2 : 0.9));
    $('#videoStat').innerHTML =
      `<span>当前画面人流 <b>${flowN}</b></span>
       <span>今日事件 <b>${Math.round(flowN * 0.06)}</b></span>
       <span>在线率 <b>${cam.status === '在线' ? '99.2%' : '—'}</b></span>
       <span>录像存储 <b>${cam.storage.replace(' 天循环存储', ' 天')}</b></span>`;
  }

  // 让画布像素尺寸与容器严格一致，杜绝裁切与拉伸
  function fitVideoCanvas() {
    const c = $('#videoCanvas');
    const box = c.parentElement;
    const w = Math.max(320, Math.round(box.clientWidth || 640));
    const h = Math.max(180, Math.round(w * 9 / 16));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; return true; }
    return false;
  }

  function openVideo(cam) {
    videoCam = cam;
    renderVideoInfo(cam);
    videoModal.classList.add('open');
    fitVideoCanvas();
    if (videoFeed) videoFeed.stop();
    let bg = null;
    try { bg = app.captureCamView ? app.captureCamView(cam) : null; } catch (e) { bg = null; }
    videoFeed = new FeedSim($('#videoCanvas'), cam, $('#videoCanvas').width, $('#videoCanvas').height, bg);
    videoFeed.setHour(app.hour);
    videoFeed.start();
  }
  function closeVideo() {
    videoModal.classList.remove('open');
    if (videoFeed) { videoFeed.stop(); videoFeed = null; }
  }
  function stepVideo(delta) {
    if (!videoCam) return;
    const i = CAMERAS.findIndex(c => c.id === videoCam.id);
    const next = CAMERAS[(i + delta + CAMERAS.length) % CAMERAS.length];
    openVideo(next);
    app.selectCamera(next, true);
  }
  $('#videoModalClose').addEventListener('click', closeVideo);
  $('#videoClose2').addEventListener('click', closeVideo);
  $('#videoPrev').addEventListener('click', () => stepVideo(-1));
  $('#videoNext').addEventListener('click', () => stepVideo(1));
  // 仅当按下与抬起都落在遮罩上时才关闭，避免"打开瞬间的 click"误关
  let videoBackdropDown = false;
  videoModal.addEventListener('pointerdown', e => { videoBackdropDown = onBackdrop(e, videoModal, '.video-card'); });
  videoModal.addEventListener('click', e => {
    if (videoBackdropDown && onBackdrop(e, videoModal, '.video-card')) closeVideo();
    videoBackdropDown = false;
  });
  window.addEventListener('resize', () => {
    if (!videoModal.classList.contains('open')) return;
    if (fitVideoCanvas() && videoCam) openVideo(videoCam);
  });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeVideo(); closeCamList(); }
    if (videoModal.classList.contains('open')) {
      if (e.key === 'ArrowLeft') stepVideo(-1);
      if (e.key === 'ArrowRight') stepVideo(1);
    }
  });

  // ---- 详情面板 -----------------------------------------------------------
  function overview() {
    setDetail('园区总览', `
      <div class="mini-stat">
        <div><b>${RECON.area}</b><span>实景重建面积</span></div>
        <div><b>${CAMERAS.length}</b><span>监控点位</span></div>
        <div><b>${(pipeTotal / 1000).toFixed(1)}km</b><span>管网总长</span></div>
      </div>
      <div class="card">
        <div class="card-title">监控接入概览</div>
        <dl class="kv">
          <dt>点位总数</dt><dd>${CAMERAS.length} 路</dd>
          <dt>在线 / 离线</dt><dd>${online} / ${offline}</dd>
          <dt>设备类型</dt><dd>球机 ${CAMERAS.filter(c => c.type === '球机').length} · 枪机 ${CAMERAS.filter(c => c.type === '枪机').length} · 半球 ${CAMERAS.filter(c => c.type === '半球').length}</dd>
          <dt>接入协议</dt><dd>GB28181 / ONVIF / RTSP</dd>
          <dt>录像存储</dt><dd>30 天循环存储</dd>
        </dl>
      </div>
      <div class="card">
        <div class="card-title">监控点位列表 <span style="float:right;font-size:10px;color:var(--text-3)">点击切换</span></div>
        <div class="cam-scroll" id="camMiniList">
          ${CAMERAS.map(c => `
            <div class="cam-mini" data-cam="${c.id}">
              <div class="num">${c.index}</div>
              <div class="t">${c.name}</div>
              <div class="d">${c.area}</div>
              <div class="s ${c.status === '在线' ? 'on' : 'off'}"></div>
            </div>`).join('')}
        </div>
        <button class="btn-ghost" id="openCamList">打开完整列表（搜索 / 筛选 / 切换）</button>
      </div>
    `);
    bindCamLinks();
  }

  function cameraDetail(cam) {
    const st = cam.status === '在线' ? '<span class="badge on">在线</span>' : '<span class="badge off">离线</span>';
    const hour = app.hour;
    const flow = Math.round(HOUR_PROFILE[Math.floor(hour) % 24] * 900 * (cam.type === '球机' ? 1.2 : 0.9));
    setDetail(cam.name, `
      <div class="feed">
        <canvas id="feedCanvas"></canvas>
        <div class="scan"></div>
        <div class="rec"><i></i>REC</div>
        <div class="ts" id="feedTs"></div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;margin-top:9px;flex-wrap:wrap">
        ${st}<span class="pipe-chip" style="--c:#4aa8ff"><i></i>${cam.type} · ${cam.res}</span>
      </div>
      <dl class="kv">
        <dt>设备编号</dt><dd>${cam.id}</dd>
        <dt>点位名称</dt><dd>${cam.name}</dd>
        <dt>所属区域</dt><dd>${cam.area}</dd>
        <dt>设备类型</dt><dd>${cam.type}（${cam.fov}）</dd>
        <dt>安装方式</dt><dd>${cam.mount} · 立杆高 ${cam.poleH}m</dd>
        <dt>分辨率</dt><dd>${cam.res} @ ${cam.fps}fps</dd>
        <dt>码流</dt><dd>${cam.bitrate} · ${cam.protocol}</dd>
        <dt>存储策略</dt><dd>${cam.storage}</dd>
        <dt>供电</dt><dd>${cam.power}</dd>
        <dt>投运时间</dt><dd>${cam.install}</dd>
        <dt>坐标</dt><dd>X ${cam.x.toFixed(1)} / Z ${cam.z.toFixed(1)}</dd>
      </dl>
      <div class="mini-stat">
        <div><b>${flow}</b><span>当前画面人流</span></div>
        <div><b>${Math.round(flow * 0.06)}</b><span>今日事件</span></div>
        <div><b>${cam.status === '在线' ? '99.2%' : '—'}</b><span>在线率</span></div>
      </div>`);
    if (feed) feed.stop();
    feed = new FeedSim($('#feedCanvas'), cam);
    feed.setHour(app.hour);
    feed.start();
  }

  function pipeDetail(p) {
    const t = PIPE_TYPES[p.type];
    const hex = '#' + t.color.toString(16).padStart(6, '0');
    setDetail(p.name, `
      <div style="display:flex;gap:8px;align-items:center;margin:6px 0 4px;flex-wrap:wrap">
        <span class="pipe-chip" style="--c:${hex}"><i></i>${t.name}</span>
        <span class="pipe-chip">${p.layer === 'below' ? '地下敷设' : '地上敷设'}</span>
      </div>
      <dl class="kv">
        <dt>管线编号</dt><dd>${p.id}</dd>
        <dt>介质类型</dt><dd>${t.name}</dd>
        <dt>规格</dt><dd>${t.dia}</dd>
        <dt>管材</dt><dd>${t.mat}</dd>
        <dt>埋深 / 高度</dt><dd>${p.depth.toFixed(1)} m</dd>
        <dt>管线长度</dt><dd>${p.len} m</dd>
        <dt>敷设方式</dt><dd>${p.layer === 'below' ? '开挖沟槽 + 管顶回填' : '架空 / 地面管沟'}</dd>
        <dt>起讫</dt><dd>(${p.points[0][0]}, ${p.points[0][1]}) → (${p.points[p.points.length - 1][0]}, ${p.points[p.points.length - 1][1]})</dd>
        <dt>关联设施</dt><dd>${p.type === 'power' ? '开闭所 2 座 / 箱变 11 台' : p.type === 'water' ? '给水泵房 1 座 / 阀门井 24 座' : p.type === 'rain' ? '雨水井 38 座' : p.type === 'sewer' ? '检查井 16 座 / 提升泵站 1 座' : p.type === 'comm' ? '光交箱 6 座' : '照明控制箱 14 台'}</dd>
        <dt>状态</dt><dd>在用 · 2026-03 竣工验收</dd>
      </dl>
      <div class="card">
        <div class="card-title">图层提示</div>
        <div style="font-size:11px;color:var(--text-2);line-height:1.7">
          地下管线在地表半透明（透视）模式下显示，虚线为管线本体、实心圆环为埋深定位标记。<br/>
          点击地图上的其它管线可继续查看。
        </div>
      </div>`);
  }

  function heatDetail(kind) {
    const isP = kind === 'people';
    const prof = isP ? HOUR_PROFILE : EVENT_PROFILE;
    const h = Math.floor(app.hour) % 24;
    const peak = Math.round(prof[h] * (isP ? 1286 : 42));
    setDetail(isP ? '人员分布热力图' : '事件分布热力图', `
      <div class="mini-stat">
        <div><b>${isP ? peak.toLocaleString() : peak}</b><span>${isP ? '当前在园人数' : '当前时段事件数'}</span></div>
        <div><b>${isP ? '1.5' : '1.2'}</b><span>峰值密度 /㎡</span></div>
        <div><b>${isP ? '5' : '4'}</b><span>热点区域</span></div>
      </div>
      <dl class="kv">
        <dt>图层类型</dt><dd>${isP ? '人员密度热力（纯密度）' : '事件密度热力（纯密度）'}</dd>
        <dt>数据来源</dt><dd>${isP ? '园区客流感知业务数据' : '园区事件中心业务数据'}</dd>
        <dt>统计口径</dt><dd>按 5m×5m 网格聚合，单位人/㎡</dd>
        <dt>更新频率</dt><dd>5 分钟滚动刷新</dd>
        <dt>渲染方式</dt><dd>地形贴合 + 密度色阶（无业务明细）</dd>
        <dt>当前时段</dt><dd>${String(h).padStart(2, '0')}:00 · 时段系数 ${prof[h]}</dd>
      </dl>
      <div class="card">
        <div class="card-title">时段分布（24h 系数）</div>
        ${hourBars(prof)}
      </div>
      ${isP ? '' : `<div class="card">
        <div class="card-title">事件类型占比（源业务系统）</div>
        <table class="tbl"><thead><tr><th>类型</th><th>占比</th></tr></thead><tbody>
        ${EVENT_TYPES.map(e => `<tr><td>${e.name}</td><td>${e.pct}%</td></tr>`).join('')}
        </tbody></table>
      </div>`}
      <div class="card">
        <div class="card-title">说明</div>
        <div style="font-size:11px;color:var(--text-2);line-height:1.7">
          热力图仅呈现空间密度，不叠加任何业务明细字段；拖动底部时间轴可查看不同时段的密度分布。
        </div>
      </div>`);
  }

  function hourBars(prof) {
    const mx = Math.max(...prof);
    return `<div style="display:flex;align-items:flex-end;gap:2px;height:52px">${prof.map((v, i) => `
      <div title="${i}时 ${v}" style="flex:1;height:${(v / mx * 100).toFixed(0)}%;background:${i === Math.floor(app.hour) % 24 ? 'var(--accent)' : 'rgba(74,168,255,.45)'};border-radius:2px 2px 0 0"></div>`).join('')}</div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-3);margin-top:4px"><span>0时</span><span>6时</span><span>12时</span><span>18时</span><span>23时</span></div>`;
  }

  function bindCamLinks() {
    $$('[data-cam]').forEach(el => el.addEventListener('click', () => {
      const cam = CAMERAS.find(c => c.id === el.dataset.cam);
      if (cam) { selectedCamId = cam.id; app.selectCamera(cam, true); }
    }));
    const openBtn = $('#openCamList');
    if (openBtn) openBtn.addEventListener('click', openCamList);
  }

  // ---- 图例 ---------------------------------------------------------------
  function setLegend(kind) {
    const r = RAMPS[kind];
    const c = $('#legendCanvas'), g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, c.width, 0);
    r.stops.forEach(s => { if (s[0] > 0) grd.addColorStop(s[0], `rgba(${s[1][0]},${s[1][1]},${s[1][2]},1)`); });
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = grd; g.fillRect(0, 0, c.width, c.height);
    $('#legendTitle').textContent = kind === 'people' ? '人员密度（人/㎡）' : '事件密度（起/㎡）';
    $('#legendMin').textContent = r.min; $('#legendMid').textContent = r.mid; $('#legendMax').textContent = r.max;
    $('#legend').style.display = kind ? 'block' : 'none';
  }

  // ---- 平面索引 -----------------------------------------------------------
  const mm = $('#mmCanvas'), mg = mm.getContext('2d');
  const MW = mm.width, MH = mm.height;
  const mx0 = -152, mx1 = 152, mz0 = -116, mz1 = 136;
  const SX = (x) => (x - mx0) / (mx1 - mx0) * MW;
  const SZ = (z) => (z - mz0) / (mz1 - mz0) * MH;

  function drawMinimap(state) {
    mg.fillStyle = '#0a1118'; mg.fillRect(0, 0, MW, MH);
    // 绿地
    mg.fillStyle = '#132318'; mg.fillRect(0, 0, MW, MH);
    // 水体
    mg.fillStyle = '#123640';
    mg.beginPath();
    mg.ellipse(SX(LAKE.cx), SZ(LAKE.cz), LAKE.rx * 0.7 / (mx1 - mx0) * MW, LAKE.rz * 0.7 / (mz1 - mz0) * MH, 0, 0, Math.PI * 2);
    mg.fill();
    // 道路
    mg.fillStyle = '#2b3038';
    mg.fillRect(0, SZ(ROADS[0].z - ROADS[0].w / 2), MW, ROADS[0].w / (mz1 - mz0) * MH);
    // 园路
    mg.strokeStyle = 'rgba(190,175,140,.55)'; mg.lineWidth = 2.2; mg.lineJoin = 'round';
    for (const p of PATHS) {
      mg.beginPath();
      p.points.forEach(([x, z], i) => i ? mg.lineTo(SX(x), SZ(z)) : mg.moveTo(SX(x), SZ(z)));
      mg.stroke();
    }
    // 硬化场地
    mg.fillStyle = 'rgba(190,185,170,.28)';
    for (const p of PLAZAS) mg.fillRect(SX(p.x0), SZ(p.z0), (p.x1 - p.x0) / (mx1 - mx0) * MW, (p.z1 - p.z0) / (mz1 - mz0) * MH);
    for (const p of COURTS) mg.fillRect(SX(p.x0), SZ(p.z0), (p.x1 - p.x0) / (mx1 - mx0) * MW, (p.z1 - p.z0) / (mz1 - mz0) * MH);
    mg.fillStyle = 'rgba(150,150,150,.25)';
    mg.fillRect(SX(PARKING.x0), SZ(PARKING.z0), (PARKING.x1 - PARKING.x0) / (mx1 - mx0) * MW, (PARKING.z1 - PARKING.z0) / (mz1 - mz0) * MH);
    // 管网
    if (state.pipesOn) {
      mg.strokeStyle = 'rgba(255,176,32,.55)'; mg.lineWidth = 1.2;
      for (const p of PIPES) {
        mg.beginPath();
        p.points.forEach(([x, z], i) => i ? mg.lineTo(SX(x), SZ(z)) : mg.moveTo(SX(x), SZ(z)));
        mg.stroke();
      }
    }
    // 摄像头
    if (state.camsOn) {
      for (const c of CAMERAS) {
        mg.fillStyle = c.status === '在线' ? '#39e08a' : '#ff5f6d';
        mg.beginPath(); mg.arc(SX(c.x), SZ(c.z), 2.1, 0, Math.PI * 2); mg.fill();
      }
    }
    // 视锥
    if (state.camsOn && state.camPos) {
      const [px, pz] = state.camPos;
      mg.strokeStyle = 'rgba(62,230,200,.9)'; mg.lineWidth = 1.4;
      mg.beginPath(); mg.moveTo(SX(px), SZ(pz)); mg.lineTo(SX(px + 26), SZ(pz - 18)); mg.stroke();
      mg.beginPath(); mg.moveTo(SX(px), SZ(pz)); mg.lineTo(SX(px - 26), SZ(pz - 18)); mg.stroke();
      mg.fillStyle = '#3ee6c8';
      mg.beginPath(); mg.arc(SX(px), SZ(pz), 3.2, 0, Math.PI * 2); mg.fill();
    }
    // 边框
    mg.strokeStyle = 'rgba(120,180,220,.25)'; mg.lineWidth = 1; mg.strokeRect(.5, .5, MW - 1, MH - 1);
  }
  mm.addEventListener('click', (e) => {
    const r = mm.getBoundingClientRect();
    const x = mx0 + ((e.clientX - r.left) / r.width) * (mx1 - mx0);
    const z = mz0 + ((e.clientY - r.top) / r.height) * (mz1 - mz0);
    app.flyTo(x, z);
  });

  // ---- Toast --------------------------------------------------------------
  let toastEl = null, toastTimer = null;
  function toast(msg) {
    if (toastEl) toastEl.remove();
    toastEl = document.createElement('div');
    toastEl.className = 'toast'; toastEl.textContent = msg;
    $('#app').appendChild(toastEl);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl && toastEl.remove(); toastEl = null; }, 2200);
  }

  return {
    overview, cameraDetail, pipeDetail, heatDetail, setLegend, drawMinimap, toast, bindCamLinks,
    openCamList, closeCamList, renderCamList, openVideo, closeVideo,
    setSelected: (id) => { selectedCamId = id; }
  };
}
