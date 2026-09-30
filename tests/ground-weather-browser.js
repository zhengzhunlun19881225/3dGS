import * as T from 'three';
import { SparkRenderer,SplatMesh } from '@sparkjsdev/spark';
import { createGroundWeather } from '../src/ground-weather.js';
import { sampleDay } from '../src/day-cycle.js';
import { createPrecipitation } from '../src/weather-particles.js';

const result=document.getElementById('result'),frames=document.getElementById('frames');
const errors=[];const log=console.error;console.error=(...args)=>{errors.push(args.map(String).join(' '));log(...args);};
window.addEventListener('error',e=>result.textContent+=`\nERROR: ${e.message}`);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(){
  const renderer=new T.WebGLRenderer({preserveDrawingBuffer:true});renderer.setSize(256,256);renderer.setPixelRatio(1);
  renderer.debug.onShaderError=(gl,program,vs,fs)=>{throw new Error(gl.getProgramInfoLog(program)+'\n'+gl.getShaderInfoLog(vs)+'\n'+gl.getShaderInfoLog(fs));};
  const scene=new T.Scene();scene.background=new T.Color('#18221c');
  const camera=new T.PerspectiveCamera(50,1,.1,100);camera.position.set(0,5,.01);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const spark=new SparkRenderer({renderer});scene.add(spark);
  const model=new SplatMesh({constructSplats:splats=>{
    for(let x=-30;x<=30;x++)for(let z=-30;z<=30;z++)splats.pushSplat(new T.Vector3(x*.05,0,z*.05),new T.Vector3(.04,.012,.04),new T.Quaternion(),1,new T.Color(.38,.24,.12));
  }});
  await model.initialized;scene.add(model);
  const terrain=new T.Mesh(new T.PlaneGeometry(4,4),new T.MeshStandardMaterial());terrain.rotation.x=-Math.PI/2;
  const ground=createGroundWeather();ground.setModel(model);ground.setTerrain(terrain);
  const day=sampleDay(12),weather={rain:0,snow:0,night:0,darkness:0,flash:0,time:1};
  async function capture(label){
    for(let i=0;i<12;i++){
      ground.update(0,weather,day);ground.prepare(camera);renderer.render(scene,camera);await delay(30);
    }
    ground.prepare(camera);renderer.render(scene,camera);
    const gl=renderer.getContext(),pixels=new Uint8Array(32*32*4);gl.readPixels(112,112,32,32,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let luma=0;for(let i=0;i<pixels.length;i+=4)luma+=pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722;
    luma/=1024;
    const image=new Image();image.src=renderer.domElement.toDataURL();image.alt=label;image.title=label;frames.append(image);
    result.textContent+=`\n${label}: ${luma.toFixed(2)}`;
    if(errors.length)throw new Error(errors.join('\n'));
    return {luma,pixels};
  }
  result.textContent='WebGL2 已启动';
  const dry=await capture('干燥');
  ground.state.setWetness(1);weather.rain=1;const wet=await capture('湿润与涟漪');
  weather.time=1.5;const ripple=await capture('涟漪向外扩散');
  ground.state.clear();ground.state.setSnow(1);weather.rain=0;weather.snow=1;const snow=await capture('积雪');
  ground.state.clear();weather.snow=0;const cleared=await capture('清空');
  if(!(dry.luma>35&&wet.luma<dry.luma&&snow.luma>dry.luma*1.7&&Math.abs(cleared.luma-dry.luma)<2))throw new Error('地表像素验证失败');
  if(!wet.pixels.some((value,i)=>value!==ripple.pixels[i]))throw new Error('涟漪没有动画');
  ground.setModel(null);scene.remove(model);model.dispose();
  scene.add(terrain,new T.AmbientLight(0xffffff,2));ground.setModel(terrain);ground.setTerrain(terrain);ground.state.setSnow(1);
  await capture('普通网格积雪');
  for(const kind of [0,1,2]){
    const system=createPrecipitation(scene,kind,100);system.mesh.visible=true;system.uniforms.intensity.value=1;
    Object.assign(system.uniforms,{surfaceAtlas:ground.uniforms.groundAtlas,surfaceRect:ground.uniforms.groundRect,surfaceMode:ground.uniforms.groundMode,surfaceFloor:ground.uniforms.groundFloor});
    renderer.render(scene,camera);system.dispose();
  }
  if(errors.length)throw new Error(errors.join('\n'));
  result.textContent+='\nPASS：高斯湿润、积雪、清空恢复、涟漪动画、普通网格及三类降水着色器。';
  ground.dispose();terrain.geometry.dispose();terrain.material.dispose();spark.dispose();renderer.dispose();
}
run().catch(error=>{result.textContent+='\nFAIL: '+(error.stack||error.message);});
