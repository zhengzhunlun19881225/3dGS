import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CollisionWorld } from '../src/collision-world.js';
import { Player } from '../src/player.js';

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const floor = (y = 0, size = 50) => new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2).translate(0, y, 0);
const box = (x, y, z, sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
function world(...geometries) {
  const clean = geometries.map(geometry => {
    const g = geometry.toNonIndexed();
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    return g;
  });
  const merged = mergeGeometries(clean);
  const result = new CollisionWorld(merged);
  clean.forEach(g => g.dispose()); merged.dispose(); geometries.forEach(g => g.dispose());
  return result;
}
function player(collider, position = v()) {
  const p = new Player(); p.collisionWorld = collider; p.reset(position); return p;
}
function walk(p, seconds, keys = [], fps = 60) {
  for (let i = 0; i < seconds * fps; i++) p.update(1 / fps, new Set(keys));
}

test('capsule stops at thin walls while sprinting and slides sideways', () => {
  const w = world(floor(), box(0, 2, -2, 30, 4, 0.05));
  const p = player(w); p.speed = 15;
  walk(p, 1, ['KeyW', 'ShiftLeft'], 20);
  assert.ok(p.position.z > -1.68 && p.position.z < -1.5, `${p.position.toArray()}`);
  assert.ok(p.position.y < 0.01);
  walk(p, 0.25, ['KeyW', 'KeyD'], 60);
  assert.ok(p.position.x > 1);
  assert.ok(p.position.z > -1.68);
  w.dispose();
});

test('capsule follows sloped ground uphill and below the old flat floor', () => {
  const ramp = floor().rotateZ(Math.atan(0.3));
  const w = world(ramp);
  const p = player(w);
  walk(p, 2, ['KeyD']);
  assert.ok(p.position.x > 4.8 && p.position.y > 1.4, `${p.position.toArray()}`);
  assert.ok(p.grounded);
  walk(p, 4, ['KeyA']);
  assert.ok(p.position.x < -4 && p.position.y < -1, `${p.position.toArray()}`);
  assert.ok(p.grounded);
  w.dispose();
});

test('walks over a small step but cannot step through a low ceiling', () => {
  const step = () => box(2, 0.1, 0, 2, 0.2, 10);
  const w = world(floor(), step());
  const p = player(w);
  walk(p, 0.85, ['KeyD']);
  assert.ok(p.position.x > 1.7 && p.position.y > 0.19, `${p.position.toArray()}`);
  w.dispose();
  const low = world(floor(), step(), box(2, 2.04, 0, 6, 0.2, 10));
  const q = player(low);
  walk(q, 1, ['KeyD']);
  assert.ok(q.position.x < 1.0, `${q.position.toArray()}`);
  low.dispose();
});

test('jump lands on the mesh, cannot double jump, and stops at a ceiling', () => {
  const w = world(floor(2));
  const p = player(w, v(0, 2, 0));
  p.jump(); walk(p, 0.15);
  assert.ok(p.position.y > 2.4 && !p.grounded);
  const vy = p.velocity.y; p.jump(); assert.equal(p.velocity.y, vy);
  walk(p, 1);
  assert.ok(Math.abs(p.position.y - 2) < 0.01 && p.grounded);
  w.dispose();
  const ceiling = world(floor(), box(0, 2.1, 0, 10, 0.2, 10));
  const q = player(ceiling); q.jump();
  let maxY = 0;
  for (let i = 0; i < 60; i++) { q.update(1 / 120, new Set()); maxY = Math.max(maxY, q.position.y); }
  assert.ok(maxY <= 0.16, `head penetrated ceiling: ${maxY}`);
  walk(q, 1); assert.ok(q.grounded);
  ceiling.dispose();
});

test('leaving the local collision area falls then recovers instead of using an invisible plane', () => {
  const w = world(floor(0, 4));
  const p = player(w);
  let recoveries = 0, lowest = 0;
  p.onRecover = () => recoveries++;
  for (let i = 0; i < 180; i++) {
    p.update(1 / 60, new Set(['KeyD']));
    lowest = Math.min(lowest, p.position.y);
  }
  assert.ok(lowest < -1 && recoveries > 0);
  assert.ok(p.safePosition.x <= 2);
  w.dispose();
});

test('third-person camera retracts before walls from either side', () => {
  const w = world(box(0, 2, 2, 10, 4, 0.1));
  const result = w.clipCamera(v(0, 1.6, 0), v(0, 2, 4));
  assert.ok(result.z < 1.8 && result.z > 1.5);
  const reverse = w.clipCamera(v(0, 1.6, 4), v(0, 2, 0));
  assert.ok(reverse.z > 2.2);
  w.dispose();
});

test('real generated GLB matches source transforms and supports terrain walking', async () => {
  const bytes = await readFile(new URL('../model-gs-ply/collision/scene-collider.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const transform = new THREE.Matrix4().makeTranslation(10, 7, -3)
    .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
    .multiply(new THREE.Matrix4().makeScale(2, 2, 2));
  const w = CollisionWorld.fromGLTF(gltf.scene, transform);
  assert.ok(Math.abs(w.ground(v(10, 12.2, -3), 0.5, 1).height - (7 + 2 * 2.57438)) < 0.003);
  w.setTransform(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  const p = player(w, v(0, 2.5, 0));
  let min = p.position.y, max = min;
  for (let i = 0; i < 120; i++) {
    p.update(1 / 60, new Set(['KeyD']));
    min = Math.min(min, p.position.y); max = Math.max(max, p.position.y);
  }
  assert.ok(p.position.x > 3, `terrain walk stuck: ${p.position.toArray()}`);
  assert.ok(max - min > 0.15, `terrain height unchanged: ${min}, ${max}`);
  assert.ok(Number.isFinite(p.position.y) && p.grounded);
  assert.equal(gltf.scene.parent, null, 'collider must never join the visible scene');
  w.dispose();
});
