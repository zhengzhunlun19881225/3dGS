import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SurfaceState } from '../src/surface-state.js';
import { rasterizeSurface } from '../src/surface-atlas.js';
import { createGroundWeather } from '../src/ground-weather.js';

function sample(atlas,x,z){
  const {data,width,height,bounds}=atlas,size=bounds.getSize(new T.Vector3());
  const col=Math.floor((x-bounds.min.x)/size.x*width),row=Math.floor((z-bounds.min.z)/size.z*height);
  return Array.from(data.slice((row*width+col)*4,(row*width+col)*4+4));
}
function plane(width,depth,y=0){const m=new T.Mesh(new T.PlaneGeometry(width,depth),new T.MeshStandardMaterial());m.rotation.x=-Math.PI/2;m.position.y=y;return m;}

test('rain wets terrain, fills puddles, and clears gradually after rain stops',()=>{
  const state=new SurfaceState();state.update(10,{rain:1});
  assert.ok(state.wetness>.95&&state.puddles>.7);assert.equal(state.snow,0);
  const wet=state.wetness;state.update(1,{});assert.ok(state.wetness<wet&&state.wetness>.9);
  state.update(300,{});assert.ok(state.wetness<.01&&state.puddles<.001);
  state.clear();assert.deepEqual({...state},{wetness:0,snow:0,puddles:0});
});
test('snow accumulates, persists across a weather change, and melts into moisture',()=>{
  const state=new SurfaceState();state.update(10,{snow:1});assert.ok(state.snow>.8&&state.wetness===0);
  state.update(1,{});assert.ok(state.snow>.75&&state.wetness>0);
  const before=state.snow;state.update(10,{rain:1});assert.ok(state.snow<before*.55&&state.wetness>.95);
});
test('surface accumulation is independent of frame rate and zero delta preserves it',()=>{
  for(const weather of [{rain:.7},{snow:.7}]){
    const a=new SurfaceState(),b=new SurfaceState();
    for(let i=0;i<600;i++)a.update(1/60,weather);b.update(10,weather);
    for(const key of ['wetness','snow','puddles'])assert.ok(Math.abs(a[key]-b[key])<1e-10,key);
    const previous={...a};a.update(0,{rain:1,snow:1});assert.deepEqual({...a},previous);
  }
});
test('surface atlas keeps the upper roof and leaves absent triangles invalid',()=>{
  const root=new T.Group();root.add(plane(10,10),plane(2,2,3));
  const island=plane(2,2,1);island.position.x=10;root.add(island);
  const atlas=rasterizeSurface(root,new T.Matrix4(),128);
  assert.ok(Math.abs(sample(atlas,0,0)[0]-3)<.001);
  assert.ok(Math.abs(sample(atlas,3,0)[0])<.001);
  assert.equal(sample(atlas,7,0)[1],0,'gap must not become a fake ground');
  assert.ok(sample(atlas,10,0)[1]>.99);
  root.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});
test('actual GLB surface atlas follows source rotation, scale and translation without displaying collider',async()=>{
  const bytes=await readFile(new URL('../model-gs-ply/collision/scene-collider.glb',import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const modelMatrix=new T.Matrix4().makeTranslation(10,7,-3).multiply(new T.Matrix4().makeRotationX(-Math.PI/2)).multiply(new T.Matrix4().makeScale(2,2,2));
  const atlas=rasterizeSurface(gltf.scene,modelMatrix.clone().multiply(new T.Matrix4().makeRotationX(Math.PI/2)));
  const point=sample(atlas,10,-3);
  assert.ok(point[1]>.6);assert.ok(Math.abs(point[0]-(7+2*2.57438))<.35,`surface=${point[0]}`);
  assert.equal(gltf.scene.parent,null);
  gltf.scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});
test('ground material patches restore original callbacks and detach on replacement',()=>{
  const system=createGroundWeather(),mesh=plane(4,4),compile=mesh.material.onBeforeCompile,key=mesh.material.customProgramCacheKey;
  system.setModel(mesh);assert.notEqual(mesh.material.onBeforeCompile,compile);
  system.setTerrain(mesh);assert.equal(system.atlas.ready,true);
  system.setModel(null);assert.equal(mesh.material.onBeforeCompile,compile);assert.equal(mesh.material.customProgramCacheKey,key);
  assert.equal(system.atlas.ready,false);system.dispose();mesh.geometry.dispose();mesh.material.dispose();
});
