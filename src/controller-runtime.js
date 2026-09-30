import * as T from 'three';
import { playerController } from 'three-player-controller';
import { FootIK } from 'three-player-controller/foot-ik';
import { createVehicleModel } from './controller-assets.js';
import { loadSciFiCharacter } from './scifi-character.js';
import { StreamingColliders } from './streaming-colliders.js';

export const defaultKeys={forward:'KeyW',backward:'KeyS',left:'KeyA',right:'KeyD',sprint:'ShiftLeft',jump:'Space',toggleView:'KeyV',toggleFly:'KeyF',toggleVehicle:'KeyE'};
export function disposeObject(root){root.removeFromParent();root.traverse(o=>{o.geometry?.dispose();for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])m.dispose();});}
export async function waitForCollider(controller,handle,{signal,timeout=30000}={}) {
  const start=performance.now();
  while(!controller.collisionWorld.get(handle.id)?.ready){
    if(signal?.aborted)throw new DOMException('碰撞构建已取消','AbortError');
    if(handle.id<0||!controller.collisionWorld.get(handle.id))throw new Error('碰撞体已移除或网格为空');
    if(performance.now()-start>timeout)throw new Error('碰撞构建超时，请重试');
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  return handle;
}
export class ControllerRuntime {
  constructor({scene,camera,controls,renderer,status,onView}){Object.assign(this,{scene,camera,controls,renderer,status,onView});this.controller=new playerController();this.props=[];this.platforms=[];this.sceneHandles=[];this.spawn=new T.Vector3();this.safe=new T.Vector3();this.elapsed=0;this.active=false;this.revision=0;}
  async init({character}={}){
    const asset=character??await loadSciFiCharacter(`${import.meta.env.BASE_URL}characters/Xbot.glb`);
    await this.controller.init({scene:this.scene,camera:this.camera,controls:this.controls,initPos:new T.Vector3(0,2,5),playerModelConfig:{...asset,scale:.01,idleAnim:'Idle',walkAnim:'Walk',runAnim:'Run',jumpAnim:'Jump',flyIdleAnim:'Hover',flyAnim:'Fly',drivingAnim:'Drive',headBoneName:'Head',gravity:-1400,jumpHeight:520,speed:300,runSpeed:650,flySpeed:800},minCamDistance:5,maxCamDistance:400,thirdMouseMode:4,enableZoom:true,enableOverShoulderView:true,camOverShoulderOffsetRatio:.08,enableSpringCamera:true,springCameraTime:.12,isShowMobileControls:false});
    // Own input focus/lifecycle: upstream global key listeners also fire in text fields.
    this.controller.offAllEvent();this.controller.isupdate=true;
    // Snap obstruction correction immediately; spring smoothing still follows the target.
    this.controller.cam.collisionLerp=1;
    // Pointer lock is optional (the in-app browser can reject it). Own its promise
    // instead of letting the upstream fire-and-forget request become unhandled.
    this.controller.cam.setPointerLock=()=>{
      const canvas=this.controls.domElement;
      if(!this.controller.getIsFirstPerson()){document.exitPointerLock?.();return;}
      if(!canvas?.requestPointerLock||globalThis.matchMedia?.('(pointer:coarse)').matches)return;
      try{Promise.resolve(canvas.requestPointerLock()).catch(()=>this.status('第一人称已开启 · 按住鼠标拖动转向'));}
      catch{this.status('第一人称已开启 · 按住鼠标拖动转向');}
    };
    this.controller.onViewChange=first=>this.onView?.(first?'first':'third');
    this.ik=new FootIK({skeleton:{hips:'Hips',legs:{left:{upper:'LeftUpLeg',lower:'LeftLeg',foot:'LeftFoot',toe:'LeftToe'},right:{upper:'RightUpLeg',lower:'RightLeg',foot:'RightFoot',toe:'RightToe'}}},soleSkinThickness:1,maxFootRaise:35,maxFootDrop:35,maxPelvisDrop:25,maxPelvisRaise:20,predictivePlacement:true,straightPoleEnabled:true,plantedHeightSpeed:200,penetrationLiftSpeed:200});
    this.controller.use(this.ik);
    this.controller.registerAnimation('wave','Wave',{loop:false,clampWhenFinished:true});
    this.controller.registerLocomotionSet('careful',{idle:'CarefulIdle',walking:'Careful',walking_backward:'Careful',running:'CarefulRun',jumping:'CarefulJump',flyidle:'CarefulHover',flying:'CarefulFly'});
    this.controller.setColliderDebug(false);this.controller.setPlayerCapsuleDebug(false);
    this.controller.setDynamicBodyDebug(false);this.controller.setVehiclePhysicsDebug(false);
    this.controller.getPlayerModel().visible=false;
  }
  get feet(){const p=this.controller.getPlayerCapsule().getWorldPosition(new T.Vector3());p.y-=this.controller.getCapsuleGroundHeight();return p;}
  reset(position=this.spawn){this.releaseInput?.();this.controller.isFlying=false;this.controller.reset(position.clone().add(new T.Vector3(0,this.controller.getCapsuleGroundHeight()+.15,0)));this.safe.copy(position);this.controller.playerIsOnGround=false;}
  setMode(mode){
    this.active=mode!=='orbit';this.releaseInput?.();
    const c=this.controller;
    if(!this.active){if(c.getIsFirstPerson())c.changeView();c.getPlayerModel().visible=false;this.camera.clearViewOffset();this.controls.enabled=true;this.controls.enablePan=true;this.controls.enableZoom=true;this.controls.minDistance=.1;this.controls.maxDistance=Infinity;}
    else {if(c.getIsFirstPerson()!==(mode==='first'))c.changeView();c.getPlayerModel().visible=mode==='third';this.controls.enablePan=false;this.controls.minDistance=.1;this.controls.maxDistance=Infinity;c.cam.initControls();c.cam.setOverShoulder(!c.getIsFirstPerson()&&c.enableOverShoulderView);}
  }
  async setSceneCollision(source,matrix,{signal}={}){
    const revision=++this.revision;
    const group=new T.Group();group.matrixAutoUpdate=false;group.matrix.copy(matrix).multiply(new T.Matrix4().makeRotationX(Math.PI/2));group.add(source);group.updateMatrixWorld(true);
    const handle=this.controller.addCollider({motion:'static',shape:{kind:'mesh',source:group},useWorker:true});
    try{await waitForCollider(this.controller,handle,{signal});if(revision!==this.revision)throw new DOMException('过期碰撞','AbortError');
      for(const old of this.sceneHandles)this.controller.removeCollider(old);this.sceneHandles=[handle];this.reset();return handle;
    }catch(e){this.controller.removeCollider(handle);throw e;}
    finally{group.remove(source);}
  }
  clearScene(){this.revision++;for(const h of this.sceneHandles)this.controller.removeCollider(h);this.sceneHandles=[];this.tiles?.dispose();this.tiles=null;this.clearProps();this.clearPlatforms();
    // Vehicle system owns wheel/chassis colliders and their visual resources.
    this.clearVehicles();
  }
  clearVehicles(){if(this.controller.getControllerMode()===1)this.reset();const vehicles=[...this.controller.getAllVehicles()];this.controller.vehicle.destroy();for(const v of vehicles)disposeObject(v.vehicleGroup);}
  async setFlatGround(y=0,demo){for(const h of this.sceneHandles)this.controller.removeCollider(h);this.sceneHandles=[];
    const floor=new T.Mesh(new T.BoxGeometry(200,.2,200));floor.position.y=y-.1;floor.updateMatrixWorld(true);
    const sources=demo?[floor,demo]:[floor];const handle=this.controller.addCollider({motion:'static',shape:{kind:'mesh',source:sources},useWorker:true});this.sceneHandles=[handle];await waitForCollider(this.controller,handle);floor.geometry.dispose();floor.material.dispose();}
  clearPlatforms(){for(const p of this.platforms){this.controller.removeCollider(p.handle);disposeObject(p.mesh);}this.platforms=[];}
  async addPlatform(){if(this.platforms.length>=4){this.status('最多四个移动平台，请先清除已有平台');return;}const c=this.controller;const mesh=new T.Mesh(new T.BoxGeometry(3,.3,3),new T.MeshStandardMaterial({color:0x7faca7,roughness:.7}));const origin=this.feet;origin.x+=4;origin.y+=.35;mesh.position.copy(origin);this.scene.add(mesh);mesh.updateMatrixWorld(true);const handle=c.addCollider({motion:'kinematic',shape:{kind:'mesh',source:mesh},follow:mesh,useWorker:true});this.platforms.push({mesh,handle,origin});await waitForCollider(c,handle);this.status('移动平台已放置在玩家右侧，可跳上平台随行');}
  addProp(kind){if(this.props.length>=24){const old=this.props.shift();this.controller.removeCollider(old.handle);disposeObject(old.mesh);}
    const sphere=kind==='sphere',r=.38;const mesh=new T.Mesh(sphere?new T.SphereGeometry(1,20,12):new T.BoxGeometry(1,1,1),new T.MeshStandardMaterial({color:sphere?0xe1b66f:0x83b6ce,roughness:.5}));
    const direction=this.camera.getWorldDirection(new T.Vector3());direction.y=0;direction.normalize();mesh.position.copy(this.feet).addScaledVector(direction,2).add(new T.Vector3(0,2.3,0));this.scene.add(mesh);
    const handle=this.controller.addCollider({motion:'dynamic',shape:sphere?{kind,radius:r,position:mesh.position.clone()}:{kind,halfExtents:new T.Vector3(.4,.4,.4),position:mesh.position.clone()},mesh,density:1,restitution:sphere?.6:.12,friction:.7,gravity:-14,velocity:direction.multiplyScalar(2),angularVelocity:new T.Vector3(.4,.2,0)});this.props.push({mesh,handle});this.status(sphere?'已投放动态球体':'已投放动态盒体');}
  clearProps(){for(const p of this.props){this.controller.removeCollider(p.handle);disposeObject(p.mesh);}this.props=[];}
  async addVehicle(){if(this.controller.getAllVehicles().length>=2){this.status('最多两辆车；靠近车辆按 E 上车');return;}
    const asset=createVehicleModel();const pos=this.feet;pos.x+=4;pos.y+=.4;
    const v=await this.controller.loadVehicleModel({...asset,position:pos,scale:.7,modelRotation:0,driverSeatPosition:new T.Vector3(.1,1.4,.1),driverSeatRotation:Math.PI/2,followVehicleDirection:true,suspension:{maxTravel:.4,stiffness:24,compression:2.6,relaxation:3,frictionSlip:8},steering:{maxSteerAngle:.55},grip:{maxG:1.1,handbrakeRearFriction:.3},power:{maxSpeed:55,acceleration:7,deceleration:10}});
    if(!v)throw new Error('车辆初始化失败');this.status('车辆已放置在右侧 · 靠近按 E 上车，空格刹车，Shift 手刹');return v;
  }
  async setCharacter({model,animations,idleAnim,walkAnim,runAnim,jumpAnim,headBoneName,skeleton}){
    if(!model||!animations?.length)throw new Error('角色必须包含模型和动画');
    for(const name of [idleAnim,walkAnim,runAnim,jumpAnim])if(!animations.some(clip=>clip.name===name))throw new Error(`找不到动画：${name}`);
    this.releaseInput?.();if(this.controller.getControllerMode()===1)this.reset();
    const old=this.controller.getPlayerModel();
    this.controller.unuse(this.ik);this.ik.dispose();
    await this.controller.switchPlayerModel({model,animations,scale:.01,idleAnim,walkAnim,runAnim,jumpAnim,headBoneName,flyIdleAnim:idleAnim,flyAnim:runAnim,drivingAnim:idleAnim,firstPersonCameraOffset:headBoneName?undefined:[0,40,30]});
    disposeObject(old);
    this.ik=new FootIK({skeleton,predictivePlacement:true,straightPoleEnabled:true});this.controller.use(this.ik);this.reset();
  }
  async loadTiles(url){this.tiles?.dispose();this.tiles=new StreamingColliders({url,scene:this.scene,camera:this.camera,renderer:this.renderer,controller:this.controller,anchor:this.feet,onStatus:this.status});}
  update(dt,paused=false){
    const c=this.controller;this.tiles?.update(this.feet);
    if(!this.active||paused)return;
    this.elapsed+=dt;
    for(const p of this.platforms){p.mesh.position.copy(p.origin);p.mesh.position.y+=.7*(1+Math.sin(this.elapsed*.7));p.mesh.position.z+=Math.sin(this.elapsed*.4)*2;p.mesh.updateMatrixWorld(true);}
    if(this.tiles?.pendingNear){this.status('正在构建附近瓦片碰撞，请稍候…');return;}
    // TPC clamps dt at 1/40. Substep explicitly so low FPS does not slow simulation.
    let remaining=Math.min(dt,.1);while(remaining>1e-5){const step=Math.min(remaining,1/60);c.update(step);remaining-=step;}
    const feet=this.feet;
    if(c.getIsOnGround()&&!c.getIsFlying()&&c.getControllerMode()===0)this.safe.copy(feet);
    if(c.getControllerMode()===0&&feet.y<this.safe.y-15&&!c.getIsFlying()){this.reset(this.safe);this.status('已离开有效地形，返回最近安全位置');}
    c.getPlayerModel().visible=!c.getIsFirstPerson();
    for(let i=this.props.length-1;i>=0;i--)if(this.props[i].mesh.position.y<this.spawn.y-35){const p=this.props.splice(i,1)[0];c.removeCollider(p.handle);disposeObject(p.mesh);}
  }
}
