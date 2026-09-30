import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ControllerRuntime } from '../src/controller-runtime.js';
import { prepareSciFiCharacter } from '../src/scifi-character.js';
const characterBytes=await readFile(new URL('../model-gs-ply/characters/Xbot.glb',import.meta.url));
// No renderer or browser automation: exercise the actual controller and physics in Node.
const events={addEventListener(){},removeEventListener(){}};
globalThis.window={...events,innerWidth:1280,innerHeight:720};
globalThis.document={...events,exitPointerLock(){},pointerLockElement:null};
globalThis.requestAnimationFrame=()=>0;
function mesh(size,pos){const m=new T.Mesh(new T.BoxGeometry(...size),new T.MeshBasicMaterial());m.position.set(...pos);m.updateMatrixWorld(true);return m;}
async function setup(){
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(60,16/9,.03,1000);camera.position.set(0,2,4);
 const controls={target:new T.Vector3(0,1,0),domElement:{...events},update(){camera.lookAt(this.target);camera.updateMatrixWorld(true);},getAzimuthalAngle(){return 0;},getPolarAngle(){return Math.PI/2;}};
 const runtime=new ControllerRuntime({scene,camera,controls,renderer:{},status(){}});
 const gltf=await new GLTFLoader().parseAsync(characterBytes.buffer.slice(characterBytes.byteOffset,characterBytes.byteOffset+characterBytes.byteLength),'');
 await runtime.init({character:prepareSciFiCharacter(gltf)});
 const c=runtime.controller;c.addCollider({motion:'static',shape:{kind:'mesh',source:mesh([100,.2,100],[0,-.1,0])}});
 runtime.active=true;runtime.reset(new T.Vector3());
 for(let i=0;i<60;i++)await c.update(1/60);
 return {runtime,c,camera,scene};
}
async function tick(c,n){for(let i=0;i<n;i++)await c.update(1/60);}
test('TPC capsule ground, jump, no double-jump, landing and real Foot IK bones',async()=>{
 const {c,runtime}=await setup();assert.equal(c.getIsOnGround(),true);assert.ok(Math.abs(runtime.feet.y)<.02);
 assert.ok(runtime.ik.getFootIKWeight('left')>.9);assert.ok(c.getPlayerModel().getObjectByName('LeftFoot').isBone);
 c.setInput({jump:true});await tick(c,10);assert.ok(runtime.feet.y>.4);assert.equal(c.getIsOnGround(),false);
 const vy=c.getVelocity().y;c.setInput({jump:true});assert.equal(c.getVelocity().y,vy);c.setInput({jump:false});await tick(c,100);assert.ok(Math.abs(runtime.feet.y)<.02);c.destroy();
});
test('Xbot has human scale, a live idle pose and an eye-height forward-looking first person camera',async()=>{
 const {c,runtime,camera,scene}=await setup();const model=c.getPlayerModel();scene.updateMatrixWorld(true);
 const box=new T.Box3().setFromObject(model,true),size=box.getSize(new T.Vector3());
 assert.ok(size.y>1.6&&size.y<1.95,`height ${size.y}`);
 assert.ok(size.x<.9,`idle arms must not stay in T-pose: ${size.x}`);
 assert.ok(box.min.y>=-.03&&box.min.y<.08,`sole height ${box.min.y}`);
 assert.equal(c.animation.state.getClip().name,'Idle');assert.ok(c.animation.state.getEffectiveWeight()>.9);
 runtime.setMode('first');scene.updateMatrixWorld(true);const eye=camera.getWorldPosition(new T.Vector3());assert.ok(eye.y>1.45&&eye.y<1.85,`eye ${eye.y}`);assert.equal(model.visible,false);
 const forward=new T.Vector3(0,0,1).applyQuaternion(c.getPlayerCapsule().quaternion);
 const view=camera.getWorldDirection(new T.Vector3());assert.ok(view.dot(forward)>.95,`first-person camera must face forwards: ${view.toArray()} vs ${forward.toArray()}`);
 runtime.setMode('third');assert.equal(model.visible,true);
 for(const set of ['careful','default']){c.switchLocomotionSet(set,0);await tick(c,20);assert.ok(c.animation.state.getEffectiveWeight()>.9);}
 c.destroy();
});
test('Xbot visual facing follows forward movement across camera headings',async()=>{
 for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]){
  const {c,runtime,camera,scene}=await setup();runtime.setMode('third');
  camera.position.set(Math.sin(yaw)*4,1.6,Math.cos(yaw)*4);c.controls.target.set(0,1.4,0);c.controls.update();
  const start=runtime.feet.clone();c.setInput({moveY:1});await tick(c,60);scene.updateMatrixWorld(true);
  const movement=runtime.feet.clone().sub(start).setY(0).normalize();
  // Compare the visible model's forward direction with actual displacement.
  const facing=new T.Vector3(0,0,1).applyQuaternion(c.getPlayerModel().getWorldQuaternion(new T.Quaternion())).setY(0).normalize();
  assert.ok(facing.dot(movement)>.95,`heading ${yaw}: facing ${facing.toArray()}, movement ${movement.toArray()}`);
  c.destroy();
 }
});
test('TPC walking, running, wall collision and flying',async()=>{
 const {c,runtime}=await setup();c.setInput({moveX:1});await tick(c,30);const walk=c.getPosition().x;assert.ok(walk>1.2&&walk<1.7);
 c.setInput({shift:true});await tick(c,30);assert.ok(c.getPosition().x-walk>2.8);
 c.setInput({moveX:0,shift:false});runtime.reset(new T.Vector3());c.addCollider({motion:'static',shape:{kind:'mesh',source:mesh([.06,4,20],[2,2,0])}});c.setInput({moveX:1,shift:true});await tick(c,90);assert.ok(c.getPosition().x<1.8&&c.getPosition().x>1.5,`${c.getPosition().toArray()}`);
 c.setInput({moveX:0,shift:false,toggleFly:true,jump:true});await tick(c,30);assert.equal(c.getIsFlying(),true);assert.ok(runtime.feet.y>2);c.destroy();
});
test('TPC sphere and box settle and are removed',async()=>{
 const {c,runtime}=await setup();runtime.addProp('sphere');runtime.addProp('box');assert.equal(c.getDynamicBodies().length,2);await tick(c,300);
 for(const {mesh} of runtime.props){assert.ok(mesh.position.y>.25&&mesh.position.y<1,`${mesh.position.toArray()}`);assert.ok(mesh.quaternion.toArray().every(Number.isFinite));}
 runtime.clearProps();assert.equal(c.getDynamicBodies().length,0);c.destroy();
});
test('TPC kinematic platform carries grounded player',async()=>{
 const {c,runtime}=await setup();const platform=mesh([4,.4,4],[0,1,0]);const h=c.addCollider({motion:'kinematic',shape:{kind:'mesh',source:platform},follow:platform});runtime.reset(new T.Vector3(0,1.2,0));await tick(c,90);assert.ok(runtime.feet.y>1.19);
 for(let i=0;i<60;i++){platform.position.x+=.015;platform.position.y+=.01;platform.updateMatrixWorld(true);await c.update(1/60);}
 assert.ok(c.getPosition().x>.8,`${c.getPosition().toArray()}`);assert.ok(runtime.feet.y>1.7);c.removeCollider(h);c.destroy();
});
test('TPC animation override, locomotion sets, views and spring camera',async()=>{
 const {c,runtime}=await setup();c.switchLocomotionSet('careful');assert.equal(c.getCurrentLocomotionSet(),'careful');c.playAnimation('wave',{force:true});assert.equal(c.getCurrentPlayerAnimationName(),'Wave');
 c.changeView();assert.equal(c.getIsFirstPerson(),true);c.changeView();assert.equal(c.getIsFirstPerson(),false);assert.equal(c.cam.enableSpringCamera,true);assert.equal(c.enableOverShoulderView,true);c.destroy();
});
test('TPC vehicle four-wheel suspension, boarding, throttle, brake, exit and cleanup',async()=>{
 const {c,runtime}=await setup();const v=await runtime.addVehicle();assert.equal(v.vehicleController.numWheels(),4);await tick(c,180);
 const pos=v.vehicleGroup.position.clone();runtime.reset(pos.clone().add(new T.Vector3(0,0,2)));await tick(c,60);c.setInput({toggleVehicle:true});assert.equal(c.getControllerMode(),1);
 c.setInput({moveY:1});await tick(c,180);const driven=v.vehicleGroup.position.distanceTo(pos);assert.ok(driven>1,`distance ${driven}`);
 c.setInput({moveY:0,jump:true,shift:true});await tick(c,180);assert.ok(Math.hypot(v.chassisBody.linvel().x,v.chassisBody.linvel().z)<.2);
 c.setInput({jump:false,shift:false,toggleVehicle:true});assert.equal(c.getControllerMode(),0);runtime.clearVehicles();assert.equal(c.getAllVehicles().length,0);c.destroy();
});
test('TPC actual generated terrain matches source transform and stays invisible',async()=>{
 const {c,runtime,scene}=await setup();c.clearColliders();const data=await readFile(new URL('../model-gs-ply/collision/scene-collider.glb',import.meta.url));const gltf=await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
 gltf.scene.updateMatrixWorld(true);const h=c.addCollider({motion:'static',shape:{kind:'mesh',source:gltf.scene}});assert.equal(c.collisionWorld.get(h.id).ready,true);assert.equal(h.collisionMesh.parent,null);assert.ok(!scene.children.includes(gltf.scene));runtime.reset(new T.Vector3(0,3,0));await tick(c,180);assert.equal(c.getIsOnGround(),true);assert.ok(runtime.feet.y>0&&runtime.feet.y<5);c.destroy();
});
test('TPC camera retracts before walls while spring follow remains enabled',async()=>{
 const {c,camera}=await setup();c.addCollider({motion:'static',shape:{kind:'mesh',source:mesh([10,5,.1],[0,2,2])}});
 camera.position.set(0,1.5,4);c.controls.target.set(0,1.5,0);camera.updateMatrixWorld(true);c.cam.updateWithRaycast(new T.Vector3(0,1.5,0),4,.1);
 assert.ok(camera.position.z<1.96,`${camera.position.toArray()}`);c.destroy();
});
test('TPC rigid bodies exchange collision impulses',async()=>{
 const {c}=await setup();const a=mesh([.8,.8,.8],[2,.42,2]),b=mesh([.8,.8,.8],[3.1,.42,2]);
 c.addCollider({motion:'dynamic',shape:{kind:'sphere',radius:.4,position:a.position.clone()},mesh:a,velocity:new T.Vector3(4,0,0),restitution:.6,friction:.05,gravity:-14});
 c.addCollider({motion:'dynamic',shape:{kind:'box',halfExtents:new T.Vector3(.4,.4,.4),position:b.position.clone()},mesh:b,restitution:.3,friction:.05,gravity:-14});
 await tick(c,60);assert.ok(b.position.x>3.5,`box was not pushed: ${b.position.x}`);assert.ok(a.position.x<b.position.x+.8);c.destroy();
});
test('custom character replacement keeps capsule and skeleton plugin working',async()=>{
 const {createControllerCharacter}=await import('../src/controller-assets.js');const {c,runtime}=await setup();const old=c.getPlayerModel();const asset=createControllerCharacter();
 await runtime.setCharacter({...asset,idleAnim:'Idle',walkAnim:'Walk',runAnim:'Run',jumpAnim:'Jump'});await tick(c,90);
 assert.notEqual(c.getPlayerModel(),old);assert.equal(c.getPlayerModel(),asset.model);assert.equal(c.getIsOnGround(),true);assert.ok(runtime.ik.getFootIKWeight('left')>.9);c.destroy();
});
