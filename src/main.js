import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { inspectPly } from './ply.js';
import { Player } from './player.js';
import { getSplatBounds } from './splat-bounds.js';
import { createAvatar } from './avatar.js';
import { createMonitoring } from './monitoring.js';
import { downloadScene, describeLoadError } from './scene-download.js';
import { defaultScene } from './default-scene.js';
import './style.css';

const $ = id => document.getElementById(id);
const status = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
const scene = new THREE.Scene();
scene.background = new THREE.Color('#111a18');
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.03, 10000);
let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }); }
catch (error) { status('无法启用 WebGL2，请使用支持硬件加速的桌面浏览器。', true); throw error; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.domElement.tabIndex = 0;
$('viewport').appendChild(renderer.domElement);
const spark = new SparkRenderer({ renderer, lodSplatCount: 1000000 });
scene.add(spark);
scene.add(new THREE.HemisphereLight(0xd6eee3, 0x28372b, 3));
const light = new THREE.DirectionalLight(0xffeccd, 3);
light.position.set(8, 15, 4);
scene.add(light);
const grid = new THREE.GridHelper(200, 200, 0x4b6652, 0x263a30);
grid.material.transparent = true;
grid.material.opacity = 0.42;
scene.add(grid);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
const player = new Player();
const keys = new Set();
const spawn = new THREE.Vector3(0, 0, 5);
const character = createAvatar();
const avatar = character.root;
avatar.visible = false;
scene.add(avatar);
let mode = 'orbit', model = null, localBounds = null, loadSequence = 0, bundledModel = false;
let roaming = false, dragLook = false;
let bounds = new THREE.Box3(new THREE.Vector3(-8, 0, -8), new THREE.Vector3(8, 4, 8));
const demo = new THREE.Group();
scene.add(demo);
function makeDemo() {
  for (let i = 0; i < 18; i++) {
    const angle = i / 18 * Math.PI * 2;
    const h = 1.5 + (Math.sin(i * 8) + 1) * 1.2;
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.8, h, 0.8), new THREE.MeshStandardMaterial({ color: i % 3 ? 0x405c4e : 0x93b78e, roughness: 0.7 }));
    block.position.set(Math.cos(angle) * 7, h / 2, Math.sin(angle) * 7);
    demo.add(block);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.045, 12, 96), new THREE.MeshStandardMaterial({ color: 0xb2e29d, emissive: 0x294520 }));
  ring.position.y = 2.6;
  demo.add(ring);
}
makeDemo();
const monitoring = createMonitoring({
  onOpen() {
    roaming = false;
    dragLook = false;
    keys.clear();
    player.velocity.set(0, 0, 0);
    document.exitPointerLock?.();
    orbit.enabled = false;
    $('enter').hidden = true;
  },
  onClose() {
    orbit.enabled = mode === 'orbit';
    $('enter').hidden = mode === 'orbit';
  },
});
monitoring.setScene(null, false);

function frameScene() {
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3()).length();
  const fov = Math.min(camera.fov * Math.PI / 180, 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect));
  const distance = Math.max(4, size / (2 * Math.sin(fov / 2)));
  camera.position.copy(center).add(new THREE.Vector3(0.65, 0.42, 0.85).normalize().multiplyScalar(distance));
  camera.far = Math.max(1000, distance * 12);
  camera.updateProjectionMatrix();
  orbit.target.copy(center);
  orbit.update();
}
function resetPlayer() {
  player.reset(spawn);
  player.yaw = 0;
  player.pitch = 0;
  updatePlayerCamera(true);
}
function updatePlayerCamera(immediate = false, dt = 1 / 60) {
  if (mode === 'orbit') return;
  const eye = player.position.clone().add(new THREE.Vector3(0, player.eyeHeight, 0));
  const rotation = new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ');
  const offset = mode === 'third' ? new THREE.Vector3(0, 0.4, Number($('distance').value)).applyEuler(rotation) : new THREE.Vector3();
  const target = eye.clone().add(offset);
  if (immediate || mode === 'first') camera.position.copy(target);
  else camera.position.lerp(target, 1 - Math.exp(-12 * dt));
  camera.position.y = Math.max(player.ground + 0.15, camera.position.y);
  camera.quaternion.setFromEuler(rotation);
  avatar.position.copy(player.position);
  avatar.rotation.y = player.yaw;
}
function setMode(next) {
  const old = mode;
  mode = next;
  keys.clear();
  orbit.enabled = mode === 'orbit';
  avatar.visible = mode === 'third';
  $('crosshair').hidden = mode !== 'first';
  $('enter').hidden = mode === 'orbit' || roaming;
  const labels = { orbit: '自由浏览', first: '第一人称', third: '第三人称' };
  $('mode-label').textContent = labels[mode];
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.mode === mode);
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  });
  $('controls').innerHTML = mode === 'orbit' ? '左键旋转 <i>·</i> 右键平移 <i>·</i> 滚轮缩放' : 'W A S D 移动 <i>·</i> Shift 加速 <i>·</i> 空格跳跃 <i>·</i> V 视角 <i>·</i> E 查看监控';
  if (mode === 'orbit') {
    roaming = false;
    document.exitPointerLock?.();
    if (old !== 'orbit') {
      orbit.target.copy(player.position).add(new THREE.Vector3(0, 1, 0));
      camera.position.add(new THREE.Vector3(3, 3, 5));
      orbit.update();
    }
  } else updatePlayerCamera(true);
}
async function lockPointer() {
  if (monitoring.isOpen || mode === 'orbit' || roaming) return;
  renderer.domElement.focus();
  try { await renderer.domElement.requestPointerLock(); }
  catch { enableDragControls(); }
}
function enableDragControls() {
  if (monitoring.isOpen || mode === 'orbit') return;
  roaming = true;
  $('enter').hidden = true;
  status('漫游已开启 · WASD 移动，按住鼠标拖动转向，Esc 退出');
}
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
$('enter').addEventListener('click', lockPointer);
renderer.domElement.addEventListener('click', () => {
  if (document.pointerLockElement === renderer.domElement && monitoring.openCentered()) return;
  lockPointer();
});
document.addEventListener('pointerlockchange', () => {
  keys.clear();
  roaming = document.pointerLockElement === renderer.domElement;
  $('enter').hidden = monitoring.isOpen || mode === 'orbit' || roaming;
});
document.addEventListener('pointerlockerror', enableDragControls);
renderer.domElement.addEventListener('mousedown', () => { dragLook = true; });
window.addEventListener('mouseup', () => { dragLook = false; });
document.addEventListener('mousemove', event => { if (roaming && (document.pointerLockElement === renderer.domElement || dragLook)) player.look(event.movementX, event.movementY); });
window.addEventListener('keydown', event => {
  if (monitoring.isOpen) return;
  if (event.code === 'Escape') { roaming = false; dragLook = false; keys.clear(); $('enter').hidden = mode === 'orbit'; }
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(event.target.tagName)) return;
  if (event.code === 'KeyE' && !event.repeat && monitoring.openCentered()) { event.preventDefault(); return; }
  if (event.code === 'KeyV' && !event.repeat) {
    setMode(mode === 'first' ? 'third' : 'first');
    return;
  }
  if (!roaming || mode === 'orbit') return;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.code === 'Space' && !event.repeat) player.jump();
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); dragLook = false; });
document.addEventListener('visibilitychange', () => keys.clear());
$('speed').addEventListener('input', () => { player.speed = Number($('speed').value); $('speed-value').textContent = `${player.speed.toFixed(1)} m/s`; });
$('distance').addEventListener('input', () => { $('distance-value').textContent = `${Number($('distance').value).toFixed(1)} m`; });
$('grid').addEventListener('change', () => { grid.visible = $('grid').checked; });
$('ground').addEventListener('change', () => {
  const value = Number($('ground').value);
  if (!Number.isFinite(value)) return;
  player.ground = value;
  grid.position.y = value;
  resetPlayer();
});
$('frame').addEventListener('click', () => { setMode('orbit'); frameScene(); });
$('respawn').addEventListener('click', resetPlayer);

function transformModel() {
  if (!model || !localBounds) return;
  const scale = Number($('scale').value);
  if (!Number.isFinite(scale) || scale < 0.0001 || scale > 10000) { $('scale').value = model.scale.x; return; }
  model.position.set(0, 0, 0);
  model.scale.setScalar(scale);
  const rotation = { y: 0, '-y': Math.PI, z: -Math.PI / 2, '-z': Math.PI / 2 }[$('up-axis').value];
  model.rotation.set(rotation, 0, 0);
  model.updateMatrixWorld(true);
  bounds = localBounds.clone().applyMatrix4(model.matrixWorld);
  // Recenter to avoid precision loss and use the lower bound as a provisional floor.
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -bounds.min.y, -center.z);
  model.updateMatrixWorld(true);
  monitoring.setScene(model, bundledModel);
  bounds = localBounds.clone().applyMatrix4(model.matrixWorld);
  const size = bounds.getSize(new THREE.Vector3());
  grid.scale.setScalar(Math.max(1, Math.max(size.x, size.z) / 150));
  spawn.set(0, 0, Math.min(size.z * 0.25, 5));
  // Source-space ground estimate near the origin of the user's supplied survey scene.
  if (bundledModel) spawn.set(0, 0, 2.5).applyMatrix4(model.matrixWorld);
  player.ground = spawn.y;
  $('ground').value = player.ground.toFixed(2);
  grid.position.y = player.ground;
  resetPlayer();
  if (mode === 'orbit') {
    frameScene();
    if (bundledModel) {
      orbit.target.copy(spawn);
      camera.position.copy(spawn).add(new THREE.Vector3(30, 25, 40).multiplyScalar(scale));
      orbit.update();
    }
  }
}
$('scale').addEventListener('change', transformModel);
$('up-axis').addEventListener('change', transformModel);
function disposeModel(object) {
  object.removeFromParent();
  if (object instanceof SplatMesh) object.dispose();
  else { object.geometry?.dispose(); object.material?.dispose(); }
}
let activeDownload = null, lastLoadRequest = null;
async function loadScene(request) {
  let { file, url, name, expectedBytes } = request;
  lastLoadRequest = request;
  activeDownload?.abort();
  const download = new AbortController();
  activeDownload = download;
  $('retry-load').hidden = true;
  const sequence = ++loadSequence;
  name ||= file?.name || 'scene.ply';
  document.exitPointerLock?.();
  roaming = false;
  keys.clear();
  status(`正在读取 ${name}…`);
  let candidate;
  try {
    if (url) {
      const blob = await downloadScene(url, {
        expectedBytes, signal: download.signal,
        onProgress(received, total, attempt) {
          if (sequence !== loadSequence) return;
          const mb = bytes => (bytes / 1048576).toFixed(1);
          status(`${attempt ? `重试 ${attempt}/2 · ` : ''}下载场景 ${mb(received)}${total ? ` / ${mb(total)} MB（${Math.floor(received / total * 100)}%）` : ' MB'}，请保持页面打开`);
        },
      });
      if (sequence !== loadSequence) return;
      file = new File([blob], name, { type: 'application/octet-stream' });
    }
    let info;
    if (/\.ply$/i.test(name)) {
      const header = await file.slice(0, 65536).arrayBuffer();
      info = inspectPly(header);
    } else if (/\.(spz|splat|ksplat)$/i.test(name)) info = { type: 'gaussian' };
    else throw new Error('请选择 PLY、SPZ、SPLAT 或 KSPLAT 文件。');
    if (sequence !== loadSequence) return;
    if (info.type === 'gaussian') {
      status('模型下载完整 · 正在解析并构建细节层级，请稍候…');
      const objectUrl = file ? URL.createObjectURL(file) : null;
      try {
        candidate = new SplatMesh({ url: objectUrl || url, fileName: name, fileType: name.split('.').at(-1).toLowerCase(), lod: true, onProgress: event => {
          if (sequence !== loadSequence) return;
          const progress = event.total ? `${Math.round(event.loaded / event.total * 100)}%` : `${(event.loaded / 1048576).toFixed(0)} MB`;
          status(`解析高斯数据 ${progress} · 随后构建细节层级`);
        } });
        await candidate.initialized;
      } finally { if (objectUrl) URL.revokeObjectURL(objectUrl); }
    } else {
      const buffer = await file.arrayBuffer();
      const geometry = new PLYLoader().parse(buffer);
      geometry.computeBoundingBox();
      if (info.type === 'mesh') {
        geometry.computeVertexNormals();
        candidate = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: geometry.hasAttribute('color'), color: geometry.hasAttribute('color') ? 0xffffff : 0xb2c7ad, side: THREE.DoubleSide }));
      } else {
        candidate = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.025, vertexColors: geometry.hasAttribute('color'), color: geometry.hasAttribute('color') ? 0xffffff : 0xb2e29d, sizeAttenuation: true }));
      }
    }
    if (sequence !== loadSequence) { disposeModel(candidate); return; }
    const candidateBounds = candidate instanceof SplatMesh ? getSplatBounds(candidate) : candidate.geometry.boundingBox.clone();
    if (candidateBounds.isEmpty() || ![...candidateBounds.min, ...candidateBounds.max].every(Number.isFinite)) throw new Error('模型没有可显示的有效坐标。');
    if (model) disposeModel(model);
    model = candidate;
    bundledModel = Boolean(url);
    localBounds = candidateBounds;
    scene.add(model);
    demo.visible = false;
    $('scale').value = 1;
    // The bundled survey scene is Z-up; imports can be corrected with the axis selector.
    $('up-axis').value = url ? 'z' : info.type === 'gaussian' ? '-y' : 'y';
    setMode('orbit');
    transformModel();
    $('scene-name').textContent = name;
    $('file-type').textContent = { gaussian: '3DGS', mesh: 'MESH', points: 'POINT CLOUD' }[info.type];
    const count = info.vertices ?? candidate.numSplats ?? candidate.splats?.getNumSplats();
    $('count').textContent = count ? `${count.toLocaleString()} ${info.type === 'gaussian' ? '高斯点' : '顶点'}` : '场景已加载';
    status('场景已就绪 · 可调整向上轴与地面高度，再进入漫游');
  } catch (error) {
    if (candidate && candidate !== model) disposeModel(candidate);
    if (sequence !== loadSequence || download.signal.aborted) return;
    status(`加载失败：${describeLoadError(error)}`, true);
    $('retry-load').hidden = false;
    console.error(error);
  }
}
$('retry-load').addEventListener('click', () => { if (lastLoadRequest) loadScene(lastLoadRequest); });
$('import-button').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', event => { const file = event.target.files[0]; if (file) loadScene({ file }); event.target.value = ''; });
let dragDepth = 0;
window.addEventListener('dragenter', event => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) { dragDepth++; $('drop-zone').hidden = false; } });
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('drop-zone').hidden = true; } });
window.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('drop-zone').hidden = true; const file = event.dataTransfer.files[0]; if (file) loadScene({ file }); });
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); renderer.setAnimationLoop(null); status('显卡上下文已丢失，请刷新页面后重试。', true); });
let previous = 0, fpsStart = 0, frames = 0;
renderer.setAnimationLoop(time => {
  const dt = Math.min((time - previous) / 1000 || 0, 0.05);
  previous = time;
  if (!monitoring.isOpen && mode === 'orbit') orbit.update();
  else if (!monitoring.isOpen) {
    if (roaming) player.update(dt, keys);
    updatePlayerCamera(false, dt);
  }
  character.animate(dt, roaming ? Math.hypot(player.velocity.x, player.velocity.z) : 0, player.grounded);
  monitoring.update(camera, innerWidth, innerHeight);
  if (!monitoring.renderPreview(renderer, scene, time)) renderer.render(scene, camera);
  frames++;
  if (time - fpsStart > 1000) { $('fps').textContent = `${Math.round(frames * 1000 / (time - fpsStart))} FPS`; fpsStart = time; frames = 0; }
});
resetPlayer();
frameScene();
if (!new URLSearchParams(location.search).has('demo')) loadScene({ ...defaultScene, url: `${import.meta.env.BASE_URL}scene.ply?v=${defaultScene.version}` });
