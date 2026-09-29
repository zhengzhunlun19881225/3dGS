import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = id => document.getElementById(id);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#111917');
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xe7fff6, 0x233b35, 2.5));
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.position.set(20, 40, 30);
scene.add(sun);
const grid = new THREE.GridHelper(100, 50, 0x51675c, 0x26372e);
grid.position.y = -8;
scene.add(grid);
const marker = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffc85e, depthTest: false }));
marker.renderOrder = 10;
marker.visible = false;
scene.add(marker);
let collider, pointCloud;
const wire = new THREE.Group();
scene.add(wire);
const material = new THREE.MeshStandardMaterial({ color: 0x76c4ad, roughness: 0.85, side: THREE.DoubleSide, transparent: true, opacity: 0.7, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const base = `${import.meta.env.BASE_URL}collision/`;
function view(position, target) {
  camera.position.set(...position);
  orbit.target.set(...target);
  orbit.update();
}
view([48, 45, 56], [0, 2.5, 0]);
$('overview').onclick = () => view([64, 65, 76], [0, 1, 0]);
$('spawn').onclick = () => view([23, 22, 30], [0, 2.5, 0]);
$('top').onclick = () => view([0, 100, 0.01], [0, 0, 0]);
$('surface').onchange = event => { if (collider) collider.visible = event.target.checked; };
$('points').onchange = event => { if (pointCloud) pointCloud.visible = event.target.checked; };
$('wire').onchange = event => { wire.visible = event.target.checked; };
$('opacity').oninput = event => { material.opacity = Number(event.target.value); };
wire.visible = false;

try {
  const [gltf, reportResponse, pointResponse] = await Promise.all([
    new GLTFLoader().loadAsync(`${base}scene-collider.glb`),
    fetch(`${base}report.json`), fetch(`${base}source-preview.bin`),
  ]);
  if (!reportResponse.ok || !pointResponse.ok) throw new Error('预览数据读取失败，请先生成碰撞网格。');
  const report = await reportResponse.json();
  collider = gltf.scene;
  collider.traverse(object => {
    if (!object.isMesh) return;
    if (!object.geometry.getAttribute('normal')) object.geometry.computeVertexNormals();
    object.material = material;
    const lines = new THREE.LineSegments(new THREE.WireframeGeometry(object.geometry), new THREE.LineBasicMaterial({ color: 0x192d26, transparent: true, opacity: 0.45 }));
    object.updateWorldMatrix(true, false);
    lines.applyMatrix4(object.matrixWorld);
    wire.add(lines);
  });
  scene.add(collider);
  const values = new Float32Array(await pointResponse.arrayBuffer());
  if (values.length !== report.preview_points * 6) throw new Error('源点云预览大小不匹配');
  const geometry = new THREE.BufferGeometry();
  const buffer = new THREE.InterleavedBuffer(values, 6);
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
  geometry.setAttribute('color', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
  pointCloud = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.13, vertexColors: true }));
  scene.add(pointCloud);
  $('faces').textContent = report.triangles.toLocaleString();
  $('size').textContent = `${(report.glb_bytes / 1048576).toFixed(2)} MB`;
  $('status').textContent = '本地网格已就绪 · 左键旋转 / 右键平移 / 滚轮缩放';
} catch (error) {
  $('status').textContent = `加载失败：${error.message}`;
  console.error(error);
}

renderer.domElement.addEventListener('dblclick', event => {
  if (!collider?.visible) return;
  const pointer = new THREE.Vector2(event.clientX / innerWidth * 2 - 1, 1 - event.clientY / innerHeight * 2);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(pointer, camera);
  const hit = ray.intersectObject(collider, true)[0];
  if (!hit) { $('picked').textContent = '此处没有碰撞表面。'; marker.visible = false; return; }
  marker.position.copy(hit.point);
  marker.visible = true;
  const p = hit.point;
  $('picked').textContent = `原始 PLY 坐标：X ${p.x.toFixed(2)} / Y ${(-p.z).toFixed(2)} / Z ${p.y.toFixed(2)}`;
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => { orbit.update(); renderer.render(scene, camera); });
