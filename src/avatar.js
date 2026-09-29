import * as THREE from 'three';

// Lightweight, articulated human. Feet sit at y=0; forward is -Z.
export function createAvatar() {
  const root = new THREE.Group();
  root.name = 'Human player';
  const rig = new THREE.Group();
  root.add(rig);
  const material = color => new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const jacket = material(0x91b96e);
  const trim = material(0x33463b);
  const trousers = material(0x293b43);
  const skin = material(0xc9906c);
  const hair = material(0x30261f);
  const boots = material(0x202726);
  const eye = material(0x242b2a);
  function part(parent, geometry, mat, x, y, z, name) {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.name = name;
    parent.add(mesh);
    return mesh;
  }
  function ellipsoid(parent, mat, x, y, z, sx, sy, sz, name) {
    const mesh = part(parent, new THREE.SphereGeometry(1, 16, 12), mat, x, y, z, name);
    mesh.scale.set(sx, sy, sz);
    return mesh;
  }
  function segment(parent, mat, length, radius, name) {
    return part(parent, new THREE.CapsuleGeometry(radius, length - radius * 2, 4, 10), mat, 0, -length / 2, 0, name);
  }
  function joint(parent, x, y, z, name) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    pivot.name = name;
    parent.add(pivot);
    return pivot;
  }

  const torso = part(rig, new THREE.CylinderGeometry(0.255, 0.19, 0.48, 12), jacket, 0, 1.17, 0, 'Jacket');
  torso.scale.z = 0.66;
  ellipsoid(rig, jacket, 0, 1.39, 0, 0.25, 0.09, 0.16, 'Shoulders');
  ellipsoid(rig, trousers, 0, 0.88, 0, 0.21, 0.13, 0.15, 'Hips');
  part(rig, new THREE.BoxGeometry(0.38, 0.055, 0.25), trim, 0, 0.96, 0, 'Waistband');
  part(rig, new THREE.CylinderGeometry(0.065, 0.075, 0.12, 12), skin, 0, 1.49, 0, 'Neck');
  ellipsoid(rig, skin, 0, 1.66, 0, 0.135, 0.17, 0.135, 'Head');
  const hairCap = part(rig, new THREE.SphereGeometry(1, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), hair, 0, 1.70, 0.006, 'Hair');
  hairCap.scale.set(0.142, 0.139, 0.14);
  ellipsoid(rig, hair, 0, 1.665, 0.078, 0.13, 0.095, 0.063, 'Back of hair');
  for (const side of [-1, 1]) {
    ellipsoid(rig, skin, side * 0.134, 1.65, 0, 0.025, 0.041, 0.026, 'Ear');
    ellipsoid(rig, eye, side * 0.046, 1.685, -0.122, 0.014, 0.012, 0.012, 'Eye');
  }
  ellipsoid(rig, skin, 0, 1.65, -0.133, 0.027, 0.033, 0.028, 'Nose');
  part(rig, new THREE.BoxGeometry(0.012, 0.37, 0.015), trim, 0, 1.18, -0.151, 'Jacket zip');
  // Back seams make the default rear view read as clothing, not a single solid shape.
  part(rig, new THREE.BoxGeometry(0.32, 0.022, 0.012), trim, 0, 1.32, 0.163, 'Back shoulder seam');

  const limbs = [-1, 1].map(side => {
    const shoulder = joint(rig, side * 0.275, 1.37, 0, 'Shoulder joint');
    shoulder.rotation.z = side * 0.1;
    segment(shoulder, jacket, 0.28, 0.078, 'Upper sleeve');
    const elbow = joint(shoulder, 0, -0.27, 0, 'Elbow joint');
    segment(elbow, jacket, 0.25, 0.06, 'Lower sleeve');
    ellipsoid(elbow, skin, 0, -0.29, 0, 0.052, 0.076, 0.046, 'Hand');
    const hip = joint(rig, side * 0.112, 0.87, 0, 'Hip joint');
    segment(hip, trousers, 0.4, 0.097, 'Thigh');
    const knee = joint(hip, 0, -0.39, 0, 'Knee joint');
    segment(knee, trousers, 0.38, 0.077, 'Shin');
    ellipsoid(knee, boots, 0, -0.41, -0.045, 0.088, 0.07, 0.145, 'Boot');
    return { shoulder, elbow, hip, knee };
  });

  let phase = 0, blend = 0;
  function animate(dt, speed, grounded) {
    const target = grounded ? Math.min(speed / 2.5, 1) : 0;
    blend = THREE.MathUtils.lerp(blend, target, 1 - Math.exp(-10 * dt));
    phase += dt * Math.min(speed * 3.6, 18);
    const stride = Math.sin(phase) * blend;
    limbs.forEach(({ shoulder, elbow, hip, knee }, index) => {
      const step = index === 0 ? stride : -stride;
      hip.rotation.x = grounded ? step * 0.58 : 0.18;
      knee.rotation.x = grounded ? -Math.max(0, -step) * 0.85 : -0.45;
      shoulder.rotation.x = -step * 0.5;
      elbow.rotation.x = -0.12 - Math.max(0, step) * 0.25;
    });
    rig.position.y = Math.abs(Math.cos(phase)) * blend * 0.025;
    rig.rotation.z = stride * 0.025;
  }
  return { root, animate };
}
