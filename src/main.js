import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { inspectPly } from './ply.js';
import { ControllerRuntime } from './controller-runtime.js';
import { setupControllerUI } from './controller-ui.js';
import { getSplatBounds } from './splat-bounds.js';
import { createMonitoring } from './monitoring.js';
import { downloadScene, describeLoadError } from './scene-download.js';
import { defaultScene } from './default-scene.js';
import { createTimeSimulator } from './time-simulator.js';
import './style.css';

const scenePanel = document.getElementById('scene-panel');
const panelToggle = document.getElementById('panel-toggle');
panelToggle.addEventListener('click', () => {
  const collapsed = !scenePanel.hidden;
  scenePanel.hidden = collapsed;
  document.body.classList.toggle('panel-collapsed', collapsed);
  panelToggle.setAttribute('aria-expanded', String(!collapsed));
  panelToggle.setAttribute('aria-label', collapsed ? '展开控制面板' : '收起控制面板');
  panelToggle.title = collapsed ? '展开控制面板' : '收起控制面板';
  panelToggle.querySelector('span').hidden = !collapsed;
});

// Do not top-level await: Rollup's shared Worker chunk can depend on this module.
async function start() {

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
const timeSimulator = await createTimeSimulator(scene,renderer);
const grid = new THREE.GridHelper(200, 200, 0x4b6652, 0x263a30);
grid.material.transparent = true;
grid.material.opacity = 0.42;
grid.visible = $('grid').checked;
scene.add(grid);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
const spawn = new THREE.Vector3(0, 0, 5);
let mode = 'orbit', model = null, localBounds = null, loadSequence = 0, bundledModel = false;
let collisionWorld = null, sceneLoading = true, collisionLoading = false;
let roaming = false;
let bounds = new THREE.Box3(new THREE.Vector3(-8, 0, -8), new THREE.Vector3(8, 4, 8));
const demo = new THREE.Group();
const runtime = new ControllerRuntime({ scene, camera, controls: orbit, renderer, status, onView(next) { if (runtime.active) { mode = next; syncModeUI(); } } });
await runtime.init();
const player = runtime.controller;
updateCollisionUI();
function canRoam() { return !sceneLoading && (!bundledModel || Boolean(collisionWorld)); }
function updateCollisionUI() {
  $('ground').disabled = Boolean(collisionWorld) || (bundledModel && collisionLoading);
  $('collision-note').textContent = collisionWorld
    ? '施工区地形碰撞已启用 · 碰撞网格不可见。支持地形、胶囊碰撞、跳跃与物理交互。'
    : sceneLoading ? '正在准备场景和地形碰撞…'
      : bundledModel ? (collisionLoading ? '正在准备施工区地形碰撞…' : '碰撞网格未就绪，暂时无法进入漫游。')
      : '此场景使用可调平面地面，未配置专属碰撞网格。';
  document.querySelectorAll('[data-mode]').forEach(button => { button.disabled = button.dataset.mode !== 'orbit' && !canRoam(); });
}
async function loadCollision(sequence) {
  collisionLoading = true;
  $('retry-collision').hidden = true;
  updateCollisionUI();
  try {
    const base = `${import.meta.env.BASE_URL}collision/`;
    const response = await fetch(`${base}report.json`, { cache: 'no-cache' });
    if (!response.ok) throw new Error('缺少碰撞网格信息');
    const report = await response.json();
    if (report.source_sha256 !== defaultScene.version) throw new Error('碰撞网格与场景版本不匹配');
    const gltf = await new GLTFLoader().loadAsync(`${base}scene-collider.glb`);
    try {
      if (sequence !== loadSequence) return;
      collisionWorld = await runtime.setSceneCollision(gltf.scene, model.matrixWorld, { signal: activeDownload?.signal });
      timeSimulator.setTerrain(gltf.scene,model.matrixWorld.clone().multiply(new THREE.Matrix4().makeRotationX(Math.PI/2)));
      resetPlayer();
      status('场景已就绪 · 地形碰撞已启用，可进入第一或第三人称漫游');
    } finally {
      gltf.scene.traverse(object => {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
        else object.material?.dispose();
      });
    }
  } catch (error) {
    if (sequence !== loadSequence) return;
    status(`碰撞加载失败：${describeLoadError(error)}`, true);
    $('retry-collision').hidden = false;
    console.error(error);
  } finally {
    if (sequence === loadSequence) { collisionLoading = false; updateCollisionUI(); }
  }
}
$('retry-collision').addEventListener('click', () => loadCollision(loadSequence));
scene.add(demo);
function makeDemo() {
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#697365',roughness:.95}));
  floor.name='Demo weather ground';floor.rotation.x=-Math.PI/2;demo.add(floor);
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
timeSimulator.setFlatGround(0,demo);
const monitoring = createMonitoring({
  onOpen() {
    roaming = false;
    runtime.releaseInput?.();
    player.getVelocity().set(0, 0, 0);
    document.exitPointerLock?.();
    orbit.enabled = false;
    $('enter').hidden = true;
  },
  onClose() {
    orbit.enabled = mode !== 'first';
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
function frameSceneWithSky() {
  frameScene();
  if (bundledModel && model) {
    const scale = model.scale.x;
    // Leave room above the treeline for the sky instead of opening on a steep
    // downward view where the header hides the entire horizon.
    orbit.target.copy(spawn).addScaledVector(new THREE.Vector3(0, 8, 0), scale);
    camera.position.copy(spawn).addScaledVector(new THREE.Vector3(30, 16, 40), scale);
    orbit.update();
  }
}
function resetPlayer() {
  runtime.spawn.copy(spawn);
  runtime.reset(spawn);
  if (mode !== 'orbit') player.cam.setCamPos();
}
function syncModeUI() {
  $('crosshair').hidden = mode !== 'first';
  $('enter').hidden = mode === 'orbit' || roaming;
  $('mode-label').textContent = { orbit: '自由浏览', first: '第一人称', third: '第三人称' }[mode];
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.mode === mode);
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  });
  $('controls').textContent = mode === 'orbit' ? '左键旋转 · 右键平移 · 滚轮缩放' : 'WASD 移动 · Shift 奔跑 / 手刹 · 空格跳跃 / 刹车 · V 视角 · F 飞行 · E 上下车 · Q 监控';
}
function setMode(next) {
  if (next !== 'orbit' && !canRoam()) return;
  mode = next;
  runtime.setMode(next);
  if (next === 'orbit') { roaming = false; document.exitPointerLock?.(); }
  else { roaming = true; player.cam.setCamPos(); renderer.domElement.focus(); }
  syncModeUI();
}
function enterRoaming() {
  if (!canRoam() || monitoring.isOpen || mode === 'orbit') return;
  roaming = true;
  orbit.enabled = mode !== 'first';
  renderer.domElement.focus();
  $('enter').hidden = true;
}
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
$('enter').textContent = '继续漫游';
$('enter').addEventListener('click', enterRoaming);
const controllerUI = setupControllerUI({runtime,canControl:canRoam,enter:enterRoaming,getMode:()=>mode,setMode,status,monitoring});
$('speed').addEventListener('input', () => { const speed=Number($('speed').value); player.setPlayerSpeed(speed*100); player.setPlayerRunSpeed(speed*100*2.16); $('speed-value').textContent = `${speed.toFixed(1)} m/s`; });
$('distance').addEventListener('input', () => { const distance=Number($('distance').value); player.setMaxCamDistance(distance*100); $('distance-value').textContent = `${distance.toFixed(1)} m`; });
$('grid').addEventListener('change', () => { grid.visible = $('grid').checked; });
$('ground').addEventListener('change', () => {
  if (collisionWorld) return;
  const value = Number($('ground').value);
  if (!Number.isFinite(value)) return;
  spawn.y = value;
  timeSimulator.setGroundHeight(spawn.y);
  timeSimulator.setFlatGround(spawn.y);
  runtime.setFlatGround(value).catch(error => status(error.message, true));
  grid.position.y = value;
  resetPlayer();
});
$('frame').addEventListener('click', () => { setMode('orbit'); frameScene(); });
$('sky-view').addEventListener('click', () => {
  setMode('orbit');
  // Keep the user's position; just aim toward the visible sun or moon.
  // Avoid OrbitControls' singularity when the body is exactly at the zenith.
  const direction = timeSimulator.getCelestialDirection();
  if (direction.y > .999) direction.set(.015, 1, .015).normalize();
  orbit.target.copy(camera.position).addScaledVector(direction, 100);
  orbit.update();
});
$('sky-return').addEventListener('click', () => { setMode('orbit'); frameSceneWithSky(); });
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
  timeSimulator.setGroundHeight(spawn.y);
  if(bundledModel)timeSimulator.clearTerrain();
  else if(model.isMesh)timeSimulator.setTerrain(model);
  else timeSimulator.setFlatGround(spawn.y);
  $('ground').value = spawn.y.toFixed(2);
  grid.position.y = spawn.y;
  if (collisionWorld && bundledModel) { collisionWorld = null; setMode('orbit'); loadCollision(loadSequence); }
  resetPlayer();
  if (mode === 'orbit') {
    frameSceneWithSky();
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
  sceneLoading = true;
  $('retry-collision').hidden = true;
  setMode('orbit');
  updateCollisionUI();
  name ||= file?.name || 'scene.ply';
  document.exitPointerLock?.();
  roaming = false;
  runtime.releaseInput?.();
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
    runtime.clearScene();
    collisionWorld = null;
    model = candidate;
    timeSimulator.setModel(model);
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
    if (bundledModel) {
      status('场景已加载 · 正在准备隐藏碰撞网格…');
      await loadCollision(sequence);
    } else { await runtime.setFlatGround(spawn.y); status('场景已就绪 · 当前使用平面地面'); }
  } catch (error) {
    if (candidate && candidate !== model) disposeModel(candidate);
    if (sequence !== loadSequence || download.signal.aborted) return;
    status(`加载失败：${describeLoadError(error)}`, true);
    $('retry-load').hidden = false;
    console.error(error);
  } finally {
    if (sequence === loadSequence) { sceneLoading = false; updateCollisionUI(); }
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
  runtime.update(dt, monitoring.isOpen || !roaming);
  controllerUI.update();
  timeSimulator.update(dt, camera);
  $('motion-state').hidden = mode === 'orbit';
  if (mode !== 'orbit') $('motion-state').textContent = `${player.getIsFlying() ? '飞行' : player.getIsOnGround() ? '贴地' : '空中'} · 高度 ${runtime.feet.y.toFixed(2)} m`;
  monitoring.update(camera, innerWidth, innerHeight);
  if (!monitoring.renderPreview(renderer, scene, time, viewCamera => timeSimulator.render(viewCamera))) {
    timeSimulator.render(camera);
    renderer.render(scene, camera);
  }
  frames++;
  if (time - fpsStart > 1000) { $('fps').textContent = `${Math.round(frames * 1000 / (time - fpsStart))} FPS`; fpsStart = time; frames = 0; }
});
await runtime.setFlatGround(0, demo);
sceneLoading = false;
runtime.setMode('orbit');
resetPlayer();
frameScene();
updateCollisionUI();
if (!new URLSearchParams(location.search).has('demo')) loadScene({ ...defaultScene, url: `${import.meta.env.BASE_URL}scene.ply?v=${defaultScene.version}` });

}
start().catch(error => {
  console.error(error);
  const output = document.getElementById('status');
  output.textContent = `初始化失败：${describeLoadError(error)}`;
  output.classList.add('error');
});
