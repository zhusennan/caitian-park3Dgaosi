// ============================================================================
//  彩田公园 · 监控摄像头图层（46 路）
// ============================================================================
import * as THREE from 'three';
import { groundHeight } from './terrain.js?v=5';

function numberTexture(n, selected = false) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.beginPath();
  g.arc(64, 64, 46, 0, Math.PI * 2);
  g.fillStyle = selected ? '#3ee6c8' : 'rgba(8,16,22,.88)';
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = selected ? '#ffffff' : 'rgba(255,255,255,.85)';
  g.stroke();
  g.fillStyle = selected ? '#04211f' : '#ffffff';
  g.font = 'bold 54px "PingFang SC",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createCameraLayer(cameras) {
  const group = new THREE.Group();
  group.name = 'cameraLayer';
  const pickables = [];
  const items = [];

  const poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa6b2, roughness: 0.6, metalness: 0.3 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xe8eef4, roughness: 0.5 });
  const offlineMat = new THREE.MeshStandardMaterial({ color: 0x6b7684, roughness: 0.8 });
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0x3ee6c8, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false
  });

  cameras.forEach((cam, i) => {
    const gy = groundHeight(cam.x, cam.z);
    const g = new THREE.Group();
    g.position.set(cam.x, gy, cam.z);

    // 立杆
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.19, cam.poleH, 8),
      cam.status === '在线' ? poleMat : offlineMat
    );
    pole.position.y = cam.poleH / 2;
    g.add(pole);

    // 支臂
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.12), poleMat);
    arm.position.set(0.55, cam.poleH - 0.15, 0);
    g.add(arm);

    // 云台 / 摄像机头
    const head = new THREE.Group();
    head.position.set(1.05, cam.poleH - 0.35, 0);
    if (cam.type === '球机') {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), cam.status === '在线' ? headMat : offlineMat);
      head.add(dome);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.18, 16), offlineMat);
      cap.position.y = 0.16; head.add(cap);
    } else if (cam.type === '半球') {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), cam.status === '在线' ? headMat : offlineMat);
      dome.rotation.x = Math.PI;
      head.add(dome);
    } else {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 1.0), cam.status === '在线' ? headMat : offlineMat);
      body.position.z = 0.3; head.add(body);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.3, 12), offlineMat);
      lens.rotation.x = Math.PI / 2; lens.position.z = 0.86; head.add(lens);
    }
    // 状态指示灯
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: cam.status === '在线' ? 0x39e08a : 0xff5f6d })
    );
    led.position.set(0.2, 0.26, 0.2);
    head.add(led);

    // 拾取体
    const pick = new THREE.Mesh(
      new THREE.SphereGeometry(3.2, 8, 6),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    pick.position.set(1.0, cam.poleH - 0.35, 0);
    pick.userData.cam = cam;
    head.add(pick);
    pickables.push(pick);

    // 编号牌
    const tex = numberTexture(cam.index);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: false }));
    spr.position.set(0, cam.poleH + 1.15, 0);
    spr.scale.set(0.026, 0.026, 0.026);
    spr.renderOrder = 900;
    spr.userData.cam = cam;
    g.add(spr);

    // 视域锥（选中显示）
    const dist = 16;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(Math.tan((cam.type === '球机' ? 70 : 46) * Math.PI / 180) * dist, dist, 20, 1, true), coneMat.clone());
    cone.rotation.z = Math.PI / 2;
    cone.rotation.y = -Math.PI / 2;
    cone.position.set(1.0 + dist / 2, cam.poleH - 0.35, 0);
    cone.visible = false;
    g.add(cone);

    group.add(g);
    items.push({ cam, group: g, head, spr, cone, tex, led });
  });

  function select(cam) {
    for (const it of items) {
      const on = it.cam === cam;
      it.cone.visible = on;
      it.spr.material.map = on ? numberTexture(it.cam.index, true) : it.tex;
      it.spr.material.needsUpdate = true;
      it.spr.scale.set(on ? 0.034 : 0.026, on ? 0.034 : 0.026, 0.026);
    }
  }
  function clear() { for (const it of items) { it.cone.visible = false; it.spr.material.map = it.tex; it.spr.material.needsUpdate = true; it.spr.scale.set(0.026, 0.026, 0.026); } }

  return { group, items, pickables, select, clear };
}
