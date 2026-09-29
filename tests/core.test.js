import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { inspectPly } from '../src/ply.js';
import { Player } from '../src/player.js';
import { getSplatBounds } from '../src/splat-bounds.js';

const buffer = text => new TextEncoder().encode(text).buffer;
test('distinguishes Gaussian, compressed Gaussian, mesh, and point PLY headers', () => {
  const header = 'ply\nformat binary_little_endian 1.0\nelement vertex 10\n';
  assert.equal(inspectPly(buffer(header + 'property float x\nend_header\n')).type, 'points');
  assert.equal(inspectPly(buffer(header + 'element face 3\nend_header\n')).type, 'mesh');
  for (const names of [['f_dc_0', 'opacity', 'scale_0', 'rot_0'], ['packed_position', 'packed_rotation', 'packed_scale', 'packed_color']]) {
    assert.equal(inspectPly(buffer(header + names.map(n => `property float ${n}\n`).join('') + 'end_header\n')).type, 'gaussian');
  }
  assert.throws(() => inspectPly(buffer('invalid')), /PLY/);
  assert.throws(() => inspectPly(buffer('ply\nelement vertex 0\nend_header\n')), /顶点/);
});
test('walking follows yaw, normalizes diagonal input, and is stable across frame rates', () => {
  function walk(keys, rate = 60, yaw = 0) {
    const p = new Player(); p.yaw = yaw;
    for (let i = 0; i < rate; i++) p.update(1 / rate, new Set(keys));
    return p.position;
  }
  const straight = walk(['KeyW']);
  assert.ok(straight.z < -2.7);
  assert.ok(Math.abs(straight.length() - walk(['KeyW', 'KeyD']).length()) < 0.001);
  assert.ok(straight.distanceTo(walk(['KeyW'], 120)) < 0.02);
  assert.ok(walk(['KeyW'], 60, Math.PI / 2).x < -2.7);
});
test('jump returns to configured ground, cannot double jump, and reset cancels motion', () => {
  const p = new Player(); p.ground = 4; p.reset(new THREE.Vector3(2, 0, 3));
  p.jump(); p.update(0.1, new Set());
  const vy = p.velocity.y; p.jump(); assert.equal(p.velocity.y, vy);
  assert.ok(p.position.y > 4);
  for (let i = 0; i < 120; i++) p.update(1 / 60, new Set());
  assert.equal(p.position.y, 4); assert.equal(p.grounded, true);
  p.velocity.set(1, 2, 3); p.reset(new THREE.Vector3()); assert.equal(p.velocity.length(), 0);
});
test('Gaussian bounds use the LoD array when the original array is empty', () => {
  const centers = [new THREE.Vector3(-2, 1, 0), new THREE.Vector3(3, 5, 1), new THREE.Vector3(NaN, 0, 0)];
  const lod = { getNumSplats: () => centers.length, getSplat: i => ({ center: centers[i] }) };
  const box = getSplatBounds({ packedSplats: { lodSplats: lod }, splats: { forEachSplat: () => {} } });
  assert.deepEqual(box.min.toArray(), [-2, 1, 0]);
  assert.deepEqual(box.max.toArray(), [3, 5, 1]);
});
