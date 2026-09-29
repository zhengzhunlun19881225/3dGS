import * as THREE from 'three';

// A grounded controller with frame-rate-independent acceleration and gravity.
// The support surface is a configurable horizontal plane, not the splat geometry.
export class Player {
  position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  ground = 0;
  speed = 3;
  eyeHeight = 1.65;
  grounded = true;
  reset(position) {
    this.position.copy(position);
    this.position.y = this.ground;
    this.velocity.set(0, 0, 0);
    this.grounded = true;
  }
  look(dx, dy) {
    this.yaw -= dx * 0.002;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.002, -1.35, 1.35);
  }
  jump() {
    if (this.grounded) { this.velocity.y = 5; this.grounded = false; }
  }
  update(dt, keys) {
    const x = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
    const z = Number(keys.has('KeyS')) - Number(keys.has('KeyW'));
    const direction = new THREE.Vector3(x, 0, z).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const speed = this.speed * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2 : 1);
    const factor = 1 - Math.exp(-14 * dt);
    this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, direction.x * speed, factor);
    this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, direction.z * speed, factor);
    this.velocity.y -= 14 * dt;
    this.position.addScaledVector(this.velocity, dt);
    if (this.position.y <= this.ground) {
      this.position.y = this.ground;
      this.velocity.y = 0;
      this.grounded = true;
    } else this.grounded = false;
  }
}
