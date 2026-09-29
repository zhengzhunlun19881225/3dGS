import { Box3, Vector3, Quaternion } from 'three';
import { TilesRenderer } from '3d-tiles-renderer';

// A loaded tile and its collision share the same world transform. Hidden/unloaded
// tiles immediately release their handles; stale worker results are discarded by TPC.
export class StreamingColliders {
  constructor({url,scene,camera,renderer,controller,anchor,onStatus=()=>{}}) {
    this.controller=controller;this.camera=camera;this.renderer=renderer;this.records=new Map();this.onStatus=onStatus;
    this.tiles=new TilesRenderer(url);this.tiles.setCamera(camera);this.tiles.setResolutionFromRenderer(camera,renderer);
    this.tiles.errorTarget=8;this.tiles.group.position.copy(anchor);scene.add(this.tiles.group);
    this.tiles.addEventListener('load-model',({scene:model})=>this.records.set(model,{model,visible:false,handle:null,box:new Box3()}));
    this.tiles.addEventListener('tile-visibility-change',({scene:model,visible})=>{const r=this.records.get(model);if(r){r.visible=visible;if(!visible)this.remove(r);}});
    this.tiles.addEventListener('dispose-model',({scene:model})=>{const r=this.records.get(model);if(r)this.remove(r);this.records.delete(model);});
    this.tiles.addEventListener('load-error',({error})=>{this.error=error?.message||'瓦片加载失败';onStatus(`3DTiles：${this.error}`);});
    this.tiles.addEventListener('load-tileset',()=>{
      if(this.rebased)return;
      const box=new Box3();if(!this.tiles.getBoundingBox(box))return;
      this.rebased=true;
      const center=box.getCenter(new Vector3());
      if(center.length()>1e5){
        const q=new Quaternion().setFromUnitVectors(center.clone().normalize(),new Vector3(0,1,0));
        this.tiles.group.quaternion.copy(q);
        this.tiles.group.position.copy(anchor).sub(center.applyQuaternion(q));
      }
    });
  }
  remove(r){if(r.handle)this.controller.removeCollider(r.handle);r.handle=null;}
  update(position){
    const {tiles}=this;tiles.setResolutionFromRenderer(this.camera,this.renderer);tiles.update();tiles.group.updateMatrixWorld(true);
    let ready=0,pending=0;
    for(const r of this.records.values()){
      if(!r.visible)continue;
      r.box.setFromObject(r.model);const d=r.box.distanceToPoint(position);
      if(!r.handle&&d<60)r.handle=this.controller.addCollider({motion:'kinematic',shape:{kind:'mesh',source:r.model},follow:r.model,useWorker:true});
      if(r.handle&&d>85)this.remove(r);
      if(r.handle){if(this.controller.collisionWorld.get(r.handle.id)?.ready)ready++;else pending++;}
    }
    this.readyCount=ready;this.pendingCount=pending;
    // Stop traversal into a tile whose geometry has appeared but collision is pending.
    this.pendingNear=[...this.records.values()].some(r=>r.handle&&!this.controller.collisionWorld.get(r.handle.id)?.ready&&r.box.distanceToPoint(position)<4);
  }
  dispose(){for(const r of this.records.values())this.remove(r);this.records.clear();this.tiles.group.removeFromParent();this.tiles.dispose();}
}
