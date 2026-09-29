import * as T from 'three';

// Rigid mesh pieces on a real bone hierarchy: no network-dependent character assets.
export function createControllerCharacter() {
  const model = new T.Group();
  const mat = color => new T.MeshStandardMaterial({ color, roughness: .8 });
  const green = mat(0x9ac779), dark = mat(0x293b43), skin = mat(0xc9906c), boot = mat(0x202726);
  function bone(name, parent, x, y, z = 0) { const b = new T.Bone(); b.name = name; b.position.set(x,y,z); parent.add(b); return b; }
  function box(parent, material, size, pos) { const m = new T.Mesh(new T.BoxGeometry(...size), material); m.position.set(...pos); parent.add(m); return m; }
  const hips = bone('Hips', model, 0, .9);
  box(hips, dark, [.36,.2,.25], [0,0,0]);
  box(hips, green, [.46,.49,.28], [0,.32,0]);
  const head = bone('Head', hips, 0,.76);
  const face = new T.Mesh(new T.SphereGeometry(.145,16,12),skin); face.scale.y=1.15; head.add(face);
  box(head, boot, [.29,.09,.27], [0,.15,0]);
  // Controller forward is +Z.
  for (const x of [-.048,.048]) box(head, boot, [.023,.025,.015], [x,.035,.137]);
  for (const [side, sign] of [['Left',1],['Right',-1]]) {
    const arm = bone(`${side}Arm`, hips, sign*.3,.51);
    box(arm,green,[.12,.29,.13],[0,-.14,0]);
    const forearm = bone(`${side}ForeArm`,arm,0,-.29);
    box(forearm,green,[.10,.26,.11],[0,-.13,0]);
    box(forearm,skin,[.10,.12,.10],[0,-.31,0]);
    const thigh = bone(`${side}UpLeg`,hips,sign*.105,-.02);
    box(thigh,dark,[.17,.40,.18],[0,-.2,0]);
    const leg = bone(`${side}Leg`,thigh,0,-.40);
    box(leg,dark,[.14,.38,.15],[0,-.19,0]);
    const foot = bone(`${side}Foot`,leg,0,-.39);
    box(foot,boot,[.17,.13,.29],[0,-.025,.06]);
    bone(`${side}Toe`,foot,0,-.03,.18);
  }
  const qtrack = (name, times, angles, axis = 'x') => new T.QuaternionKeyframeTrack(`${name}.quaternion`, times, angles.flatMap(a => new T.Quaternion().setFromEuler(new T.Euler(axis==='x'?a:0,0,axis==='z'?a:0)).toArray()));
  function gait(name, duration, stride) {
    const times = [0,.25,.5,.75,1].map(t=>t*duration), tracks=[];
    for(const [side,sgn] of [['Left',1],['Right',-1]]) {
      const a=[0,1,0,-1,0].map(v=>v*sgn*stride);
      tracks.push(qtrack(`${side}UpLeg`,times,a),qtrack(`${side}Leg`,times,a.map(v=>Math.max(0,-v)*1.3)),qtrack(`${side}Arm`,times,a.map(v=>-v*.7)));
    }
    return new T.AnimationClip(name,duration,tracks);
  }
  const pose=(name,arm,leg,knee)=>new T.AnimationClip(name,1,[...['Left','Right'].flatMap(s=>[qtrack(`${s}Arm`,[0,1],[arm,arm]),qtrack(`${s}UpLeg`,[0,1],[leg,leg]),qtrack(`${s}Leg`,[0,1],[knee,knee])])]);
  const animations=[gait('Idle',2,0),gait('Walk',.9,.5),gait('Run',.55,.85),gait('Careful',1.3,.28),pose('Jump',-.5,-.3,.7),pose('Hover',-.4,-.1,.2),pose('Fly',-1.5,-.1,.15),pose('Drive',-1.1,-1.2,1.3),new T.AnimationClip('Wave',1.6,[qtrack('RightArm',[0,.4,.8,1.2,1.6],[0,2.6,2.1,2.6,0],'z')])];
  return {model,animations};
}

export function createVehicleModel() {
  // Chassis forward is +X; loader rotates nothing. Four independent wheel nodes.
  const model = new T.Group();
  const bodyMat=new T.MeshStandardMaterial({color:0xdcab58,roughness:.5});
  function box(size,pos,material=bodyMat) {const m=new T.Mesh(new T.BoxGeometry(...size),material);m.position.set(...pos);model.add(m);}
  box([4,.45,1.8],[0,.85,0]);
  box([1.6,.55,1.65],[-.5,1.33,0]);
  const glass=new T.MeshStandardMaterial({color:0x43616a,metalness:.2,roughness:.2});
  box([.06,.5,1.55],[.32,1.35,0],glass);
  const wheelsNames=[];
  for(const [name,x,z] of [['LF',1.3,-.95],['RF',1.3,.95],['LR',-1.3,-.95],['RR',-1.3,.95]]) {
    const wheel=new T.Mesh(new T.CylinderGeometry(.38,.38,.24,20),new T.MeshStandardMaterial({color:0x202427}));
    wheel.rotation.x=Math.PI/2;wheel.position.set(x,.38,z);wheel.name=name;model.add(wheel);wheelsNames.push(name);
  }
  return {model,wheelsNames};
}
