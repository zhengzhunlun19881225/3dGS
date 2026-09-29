import * as THREE from 'three';
import { cameras } from './cameras.js';
import './monitoring.css';

const cameraIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="6" width="12" height="12" rx="3"/><path d="m15 10 6-3v10l-6-3z"/><circle cx="9" cy="12" r="2"/></svg>';

export function createMonitoring({ onOpen, onClose }) {
  const layer = document.createElement('div');
  layer.className = 'monitor-markers';
  layer.setAttribute('aria-label', '场景监控点位');
  document.body.appendChild(layer);
  const dock = document.createElement('aside');
  dock.className = 'monitor-dock';
  dock.innerHTML = '<div class="monitor-dock-title"><span>场景监控</span><span>03 点位</span></div><div class="monitor-list"></div><p>点击场景图标查看画面</p>';
  document.body.appendChild(dock);
  const dialog = document.createElement('dialog');
  dialog.className = 'monitor-dialog';
  dialog.setAttribute('aria-labelledby', 'monitor-title');
  dialog.innerHTML = `
    <header class="monitor-header"><div class="monitor-heading-icon">${cameraIcon}</div><div><div class="monitor-eyebrow">SITE MONITORING</div><h2 id="monitor-title"></h2></div><button class="monitor-close" aria-label="关闭监控画面">×</button></header>
    <div class="monitor-screen"><canvas class="monitor-preview" width="960" height="540" aria-label="监控点位的场景模拟画面"></canvas><video class="monitor-video" controls playsinline muted hidden></video><div class="monitor-osd"><span class="monitor-badge"></span><time></time></div><div class="monitor-watermark"></div><div class="monitor-message" role="status" hidden></div></div>
    <footer class="monitor-footer"><div class="monitor-description"></div><nav class="monitor-switcher" aria-label="切换监控点位"></nav></footer>`;
  document.body.appendChild(dialog);
  const preview = dialog.querySelector('canvas');
  const ctx = preview.getContext('2d');
  const video = dialog.querySelector('video');
  const message = dialog.querySelector('.monitor-message');
  const feedCamera = new THREE.PerspectiveCamera(65, 16 / 9, 0.05, 10000);
  let selected = null, enabled = true, lastFrame = -Infinity, lastSecond = -1, opener = null;
  const entries = cameras.map((config, index) => {
    const marker = document.createElement('button');
    marker.className = 'monitor-marker';
    marker.setAttribute('aria-label', `打开${config.name}监控`);
    marker.innerHTML = `<span class="monitor-pin">${cameraIcon}</span><span class="monitor-pin-label">${config.id.slice(-2)} · ${config.name}</span><span class="monitor-stem"></span>`;
    marker.hidden = true;
    layer.appendChild(marker);
    const listButton = document.createElement('button');
    listButton.innerHTML = `${cameraIcon}<span>${config.name}</span><small>${config.videoUrl ? '视频' : '演示'}</small>`;
    dock.querySelector('.monitor-list').appendChild(listButton);
    const switchButton = document.createElement('button');
    switchButton.textContent = config.id;
    switchButton.setAttribute('aria-label', `切换到${config.name}`);
    dialog.querySelector('nav').appendChild(switchButton);
    const entry = { config, marker, listButton, switchButton, position: new THREE.Vector3(), target: new THREE.Vector3(), screen: new THREE.Vector3(), index };
    for (const button of [marker, listButton, switchButton]) button.addEventListener('click', () => open(entry));
    return entry;
  });

  function clearVideo() {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  function open(entry) {
    if (!enabled) return;
    if (!dialog.open) {
      opener = document.activeElement;
      onOpen();
      dialog.showModal();
    }
    selected = entry;
    lastFrame = -Infinity;
    lastSecond = -1;
    clearVideo();
    const { config } = entry;
    dialog.querySelector('h2').textContent = config.name;
    dialog.querySelector('.monitor-watermark').textContent = config.id;
    dialog.querySelector('.monitor-badge').textContent = config.videoUrl ? '视频源' : '场景模拟 · 非真实监控';
    dialog.querySelector('.monitor-description').textContent = config.videoUrl ? `${config.id} · 已配置视频源` : `${config.id} · 演示点位 / 当前画面由三维场景实时渲染`;
    for (const item of entries) item.switchButton.setAttribute('aria-pressed', String(item === entry));
    message.hidden = true;
    preview.hidden = Boolean(config.videoUrl);
    video.hidden = !config.videoUrl;
    feedCamera.position.copy(entry.position);
    feedCamera.lookAt(entry.target);
    if (config.videoUrl) {
      message.hidden = false;
      message.textContent = '正在连接视频源…';
      video.src = config.videoUrl;
      video.play().catch(() => { if (selected === entry) { message.hidden = false; message.textContent = '点击视频播放按钮开始观看'; } });
    }
    dialog.querySelector('.monitor-close').focus();
  }
  video.addEventListener('playing', () => { message.hidden = true; });
  video.addEventListener('error', () => {
    if (!selected?.config.videoUrl || !video.getAttribute('src')) return;
    message.textContent = '视频暂时无法播放，请检查视频源是否可用。';
    message.hidden = false;
  });
  dialog.querySelector('.monitor-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
  dialog.addEventListener('close', () => {
    clearVideo();
    selected = null;
    onClose();
    if (opener?.isConnected) opener.focus();
  });

  return {
    get isOpen() { return dialog.open; },
    // Call after scene transforms so markers stay attached to source-space points.
    setScene(model, bundled) {
      enabled = !model || bundled;
      dock.hidden = !enabled;
      layer.hidden = !enabled;
      if (dialog.open) dialog.close();
      entries.forEach(entry => {
        if (model) {
          entry.position.fromArray(entry.config.position).applyMatrix4(model.matrixWorld);
          entry.target.fromArray(entry.config.target).applyMatrix4(model.matrixWorld);
        } else {
          const angle = entry.index * Math.PI * 2 / 3;
          entry.position.set(Math.cos(angle) * 5, 3, Math.sin(angle) * 5);
          entry.target.set(0, 1, 0);
        }
      });
    },
    update(camera, width, height) {
      if (!enabled) return;
      camera.updateMatrixWorld();
      entries.forEach(entry => {
        entry.screen.copy(entry.position).project(camera);
        const p = entry.screen;
        const x = (p.x + 1) * width / 2;
        const y = (1 - p.y) * height / 2;
        entry.marker.hidden = dialog.open || p.z < -1 || p.z > 1 || x < 35 || x > width - 35 || y < 110 || y > height - 70;
        entry.marker.style.left = `${x}px`;
        entry.marker.style.top = `${y}px`;
      });
    },
    openCentered() {
      if (!enabled || dialog.open) return false;
      const entry = entries.filter(item => !item.marker.hidden).find(item => {
        const rect = item.marker.querySelector('.monitor-pin').getBoundingClientRect();
        return Math.hypot(rect.left + rect.width / 2 - innerWidth / 2, rect.top + rect.height / 2 - innerHeight / 2) < 36;
      });
      if (!entry) return false;
      open(entry);
      return true;
    },
    renderPreview(renderer, scene, time) {
      if (!dialog.open || !selected) return false;
      if (Math.floor(time / 1000) !== lastSecond) {
        lastSecond = Math.floor(time / 1000);
        dialog.querySelector('time').textContent = new Date().toLocaleString('zh-CN', { hour12: false });
      }
      if (selected.config.videoUrl) return false;
      // Only render the monitoring view while the modal is open; avoid sorting
      // millions of splats for two competing cameras every frame.
      if (time - lastFrame > 1000 / 15) {
        lastFrame = time;
        feedCamera.lookAt(selected.target);
        feedCamera.rotateY(Math.sin(time * 0.00015) * 0.12);
        renderer.render(scene, feedCamera);
        ctx.drawImage(renderer.domElement, 0, 0, preview.width, preview.height);
      }
      return true;
    },
  };
}
