import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';

const UP = new THREE.Vector3(0, 1, 0);
const SKIN = 0.002;
export const WALKABLE_Y = Math.cos(50 * Math.PI / 180);

// Geometry and BVH only: this object never creates a renderable Mesh or joins a Scene.
export class CollisionWorld {
  constructor(geometry) {
    this.source = geometry.clone();
    this.setTransform(new THREE.Matrix4());
  }
  static fromGLTF(root, sceneMatrix) {
    root.updateWorldMatrix(true, true);
    const pieces = [];
    const restoreSource = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    root.traverse(object => {
      if (!object.isMesh) return;
      const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
      for (const key of Object.keys(geometry.attributes)) if (key !== 'position') geometry.deleteAttribute(key);
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(restoreSource, object.matrixWorld));
      pieces.push(geometry);
    });
    if (!pieces.length) throw new Error('碰撞文件没有有效网格');
    const merged = mergeGeometries(pieces);
    const world = new CollisionWorld(merged);
    world.setTransform(sceneMatrix);
    merged.dispose();
    pieces.forEach(piece => piece.dispose());
    return world;
  }
  setTransform(matrix) {
    this.geometry?.dispose();
    this.geometry = this.source.clone().applyMatrix4(matrix);
    this.geometry.computeBoundingBox();
    this.bounds = this.geometry.boundingBox.clone();
    this.bvh = new MeshBVH(this.geometry, { maxLeafTris: 12 });
  }
  dispose() {
    this.geometry.dispose();
    this.source.dispose();
    this.bvh = null;
  }
  ray(origin, direction, distance) {
    return this.bvh.raycastFirst(new THREE.Ray(origin, direction), THREE.DoubleSide, 0, distance);
  }
  ground(position, above = 0.2, below = 0.3) {
    const hit = this.ray(position.clone().addScaledVector(UP, above), UP.clone().negate(), above + below);
    if (!hit) return null;
    const normal = hit.face.normal.clone();
    if (normal.y < 0) normal.negate();
    return normal.y >= WALKABLE_Y ? { height: hit.point.y, normal } : null;
  }
  resolve(position, radius, height) {
    const segment = new THREE.Line3();
    const box = new THREE.Box3();
    const triPoint = new THREE.Vector3(), capsulePoint = new THREE.Vector3();
    const normals = [];
    let grounded = false, wall = false;
    // Re-query after each pass so corner corrections cannot miss a neighbouring triangle.
    for (let pass = 0; pass < 4; pass++) {
      segment.start.copy(position).addScaledVector(UP, radius);
      segment.end.copy(position).addScaledVector(UP, height - radius);
      box.makeEmpty().expandByPoint(segment.start).expandByPoint(segment.end).expandByScalar(radius + SKIN);
      let corrected = false;
      this.bvh.shapecast({
        intersectsBounds: bounds => bounds.intersectsBox(box),
        intersectsTriangle: triangle => {
          const distance = triangle.closestPointToSegment(segment, triPoint, capsulePoint);
          if (distance >= radius + SKIN) return false;
          const faceNormal = triangle.getNormal(new THREE.Vector3());
          const normal = capsulePoint.clone().sub(triPoint);
          if (distance > 1e-8) normal.multiplyScalar(1 / distance);
          else {
            normal.copy(faceNormal);
            const center = segment.getCenter(new THREE.Vector3());
            if (normal.dot(center.sub(triangle.a)) < 0) normal.negate();
          }
          if (normal.y >= WALKABLE_Y && Math.abs(faceNormal.y) >= WALKABLE_Y) grounded = true;
          if (Math.abs(faceNormal.y) < WALKABLE_Y) wall = true;
          const correction = normal.clone().multiplyScalar(radius + SKIN - distance);
          position.add(correction);
          segment.start.add(correction);
          segment.end.add(correction);
          normals.push(normal);
          corrected = true;
          return false;
        },
      });
      if (!corrected) break;
    }
    return { grounded, wall, normals };
  }
  snap(position, radius, height, drop = 0.25, rise = 0.06) {
    const support = this.ground(position, radius + rise, drop + radius);
    if (!support) return false;
    // A sphere on a slope sits above the vertical ray hit by this geometric offset.
    const targetY = support.height + radius / support.normal.y - radius + SKIN;
    if (targetY > position.y + rise || targetY < position.y - drop) return false;
    const trial = position.clone();
    trial.y = targetY;
    const contact = this.resolve(trial, radius, height);
    if (Math.hypot(trial.x - position.x, trial.z - position.z) > 0.08 || trial.y > position.y + rise + 0.03) return false;
    position.copy(trial);
    return contact.grounded || Math.abs(trial.y - targetY) < 0.01;
  }
  spawnAt(position, radius, height) {
    const support = this.ground(position, 1.2, 6);
    if (!support) return false;
    position.y = support.height + radius / support.normal.y - radius + SKIN;
    this.resolve(position, radius, height);
    return true;
  }
  clipCamera(eye, desired, radius = 0.18) {
    const direction = desired.clone().sub(eye);
    const length = direction.length();
    if (length < 1e-6) return desired.clone();
    direction.multiplyScalar(1 / length);
    const right = new THREE.Vector3().crossVectors(direction, UP).normalize();
    const vertical = new THREE.Vector3().crossVectors(right, direction).normalize();
    let distance = length;
    // Include the camera's near-plane footprint, not just its centre ray.
    for (const offset of [new THREE.Vector3(), right.clone().multiplyScalar(radius), right.clone().multiplyScalar(-radius), vertical.clone().multiplyScalar(radius), vertical.clone().multiplyScalar(-radius)]) {
      const hit = this.ray(eye.clone().add(offset), direction, length + radius);
      if (hit) distance = Math.min(distance, Math.max(0, hit.distance - radius));
    }
    return eye.clone().addScaledVector(direction, distance);
  }
}
