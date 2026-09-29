import * as THREE from 'three';
import { WALKABLE_Y } from './collision-world.js';

// Feet are at position.y. Physics uses a capsule and small time/distance steps.
// Imported scenes without a matching collider retain the explicit plane fallback.
export class Player {
  position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  ground = 0;
  speed = 3;
  eyeHeight = 1.65;
  grounded = true;
  collisionWorld = null;
  radius = 0.3;
  height = 1.85;
  stepHeight = 0.28;
  safePosition = new THREE.Vector3();
  onRecover = () => {};
  reset(position) {
    this.position.copy(position);
    if (this.collisionWorld) {
      this.grounded = this.collisionWorld.spawnAt(this.position, this.radius, this.height);
    } else {
      this.position.y = this.ground;
      this.grounded = true;
    }
    this.safePosition.copy(this.position);
    this.velocity.set(0, 0, 0);
  }
  look(dx, dy) {
    this.yaw -= dx * 0.002;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.002, -1.35, 1.35);
  }
  jump() {
    if (this.grounded) { this.velocity.y = 5; this.grounded = false; }
  }
  update(dt, keys) {
    if (!(dt > 0)) return;
    // Even sprinting at the maximum UI speed moves less than half a radius per step.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)), Math.ceil(this.velocity.length() * dt / (this.radius * 0.4)));
    for (let i = 0; i < steps; i++) this.integrate(Math.min(dt, 0.1) / steps, keys);
  }
  integrate(dt, keys) {
    const x = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
    const z = Number(keys.has('KeyS')) - Number(keys.has('KeyW'));
    const direction = new THREE.Vector3(x, 0, z).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const speed = this.speed * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2 : 1);
    const factor = 1 - Math.exp(-14 * dt);
    this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, direction.x * speed, factor);
    this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, direction.z * speed, factor);
    this.velocity.y -= 14 * dt;
    const previous = this.position.clone();
    const wasGrounded = this.grounded;
    const descending = this.velocity.y <= 0;
    this.position.addScaledVector(this.velocity, dt);
    if (this.collisionWorld) {
      const world = this.collisionWorld;
      const movement = this.position.clone().sub(previous);
      const contact = world.resolve(this.position, this.radius, this.height);
      this.grounded = contact.grounded && descending;
      if (wasGrounded && descending && contact.wall && Math.hypot(movement.x, movement.z) > 1e-5) {
        const trial = previous.clone();
        trial.y += this.stepHeight;
        const raised = trial.clone();
        world.resolve(raised, this.radius, this.height);
        // Reject stepping through a low ceiling.
        if (raised.distanceTo(trial) < 0.01) {
          // Look one foot radius ahead to place the foot on the tread, rather
          // than dropping the capsule back onto the vertical riser at its edge.
          const horizontal = Math.hypot(movement.x, movement.z);
          trial.x += movement.x * (1 + this.radius / horizontal);
          trial.z += movement.z * (1 + this.radius / horizontal);
          world.resolve(trial, this.radius, this.height);
          const travel = p => Math.hypot(p.x - previous.x, p.z - previous.z);
          if (world.snap(trial, this.radius, this.height, this.stepHeight + 0.06, 0)
            && trial.y > previous.y + 0.025
            && trial.y <= previous.y + this.stepHeight + 0.01
            && travel(trial) > travel(this.position) + 1e-5) {
            this.position.copy(trial);
            this.grounded = true;
            this.velocity.y = 0;
            this.safePosition.copy(trial);
            return;
          }
        }
      }
      for (const normal of contact.normals) {
        // Walkable ground corrects height geometrically. Re-projecting horizontal
        // velocity on every substep would make uphill speed depend on frame rate.
        if (descending && contact.grounded && normal.y >= WALKABLE_Y) continue;
        const into = this.velocity.dot(normal);
        if (into < 0) this.velocity.addScaledVector(normal, -into);
      }
      if (!this.grounded && wasGrounded && descending) {
        this.grounded = world.snap(this.position, this.radius, this.height);
      }
      if (this.grounded) {
        this.velocity.y = 0;
        // Save only a position with a real walkable surface below its centre.
        if (world.ground(this.position, this.radius, 0.4)) this.safePosition.copy(this.position);
      }
      if (this.position.y < world.bounds.min.y - 3 || this.position.y < this.safePosition.y - 12) {
        this.position.copy(this.safePosition);
        this.velocity.set(0, 0, 0);
        this.grounded = true;
        this.onRecover();
      }
      return;
    }
    if (this.position.y <= this.ground) {
      this.position.y = this.ground;
      this.velocity.y = 0;
      this.grounded = true;
    } else this.grounded = false;
  }
}
