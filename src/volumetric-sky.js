import * as T from 'three';
import { CloudGeneratorShader, DetailGeneratorShader, WeatherGeneratorShader } from './vendor/leoawen/shaders.js';
import { volumetricFragment } from './volumetric-shader.js';
import { weatherUniforms,updateWeatherUniforms } from './weather-atmosphere.js';

const fullscreenVertex = `varying vec2 vUv;
void main(){vUv=uv;gl_Position=vec4(position.xy,1.0,1.0);}`;
const uniformsFrom = values => Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{value}]));
export const skyQuality = {
  low: { scale: .33, width: 640, steps: 40 },
  balanced: { scale: .5, width: 960, steps: 64 },
  high: { scale: .7, width: 1280, steps: 96 },
};

// Original GPU slice-baking technique, reduced to 128³/32³ for local roaming.
// Yield between batches so startup does not freeze the UI. All temporary
// render state and GPU resources are restored even when baking fails.
async function bakeNoise(renderer, shader, values, size, volume = true, red = false) {
  const material = new T.ShaderMaterial({...shader,uniforms:uniformsFrom(values),depthTest:false,depthWrite:false,toneMapped:false});
  const geometry = new T.PlaneGeometry(1,1), scene = new T.Scene();
  const camera = new T.OrthographicCamera(-.5,.5,.5,-.5,0,1);
  scene.add(new T.Mesh(geometry,material));
  const target = new T.WebGLRenderTarget(size,size,{depthBuffer:false});
  const data = new Uint8Array(size*size*(volume?size:1)*(red?1:4));
  const pixels = new Uint8Array(size*size*4);
  try {
    for(let z=0;z<(volume?size:1);z++) {
      if(volume)material.uniforms.uSliceZ.value=z/size;
      const previous=renderer.getRenderTarget();
      const viewport=renderer.getViewport(new T.Vector4()),scissor=renderer.getScissor(new T.Vector4()),scissorTest=renderer.getScissorTest();
      try {
        renderer.setRenderTarget(target);renderer.setScissorTest(false);
        renderer.render(scene,camera);
        renderer.readRenderTargetPixels(target,0,0,size,size,pixels);
      } finally {
        renderer.setRenderTarget(previous);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
      }
      if(red)for(let i=0;i<size*size;i++)data[z*size*size+i]=pixels[i*4];
      else data.set(pixels,z*size*size*4);
      if(z%8===7)await new Promise(resolve=>setTimeout(resolve,0));
    }
    const texture=volume?new T.Data3DTexture(data,size,size,size):new T.DataTexture(data,size,size);
    texture.format=red?T.RedFormat:T.RGBAFormat;
    texture.minFilter=T.LinearMipmapLinearFilter;texture.magFilter=T.LinearFilter;
    texture.generateMipmaps=true;texture.unpackAlignment=1;
    texture.wrapS=texture.wrapT=T.RepeatWrapping;
    if(volume)texture.wrapR=T.RepeatWrapping;
    texture.needsUpdate=true;
    return texture;
  } finally {target.dispose();geometry.dispose();material.dispose();}
}

export async function createVolumetricSky(renderer) {
  const textures=[];
  try {
    textures.push(await bakeNoise(renderer,CloudGeneratorShader,{
      uSliceZ:0,uRepeat1:2,uScale1:1,uSeed1:0,uRepeat2:8,uScale2:1,uSeed2:.1,
      uMixStrength:.3,uErosion:.3,uContrast:1.8,
    },128,true,true));
    textures.push(await bakeNoise(renderer,DetailGeneratorShader,{
      uSliceZ:0,uScaleR:2,uScaleG:4,uScaleB:8,uSeed:.2,
    },32));
    textures.push(await bakeNoise(renderer,WeatherGeneratorShader,{
      uScaleR:11,uSeedR:.3,uPersistR:0,uOffsetR:new T.Vector2(),
      uScaleG:2,uSeedG:0,uPersistG:.5,uOffsetG:new T.Vector2(10,0),
    },64,false));
  } catch(error) {textures.forEach(texture=>texture.dispose());throw error;}

  const uniforms=uniformsFrom({
    uTexture:textures[0],uDetailTexture:textures[1],tWeatherMap:textures[2],
    uWindOffset:new T.Vector3(.17,.31,.09),uWeatherOffset:new T.Vector2(.2,.1),
    uCameraPos:new T.Vector3(),uInverseViewMatrix:new T.Matrix4(),uInverseProjectionMatrix:new T.Matrix4(),
    uPlanetRadius:6371000,uPlanetCenter:new T.Vector3(0,-6371000,0),uAtmosphereRadius:6471000,
    uRayleighCoeff:new T.Vector3(5.802e-6,13.558e-6,33.100e-6),uMieCoeff:new T.Vector3(3.996e-6,3.996e-6,3.996e-6),
    uOzoneCoeff:new T.Vector3(.650e-6,1.881e-6,.085e-6),uRayleighScaleHeight:8000,uMieScaleHeight:1200,
    uSunDirection:new T.Vector3(1,1,0).normalize(),uSunIntensity:20,uExposure:.8,
    uCloudBaseOffset:1800,uCloudHeight:1800,uWeatherHeightMax:1800,uWeatherHeightCurve:.1,
    uDensityScale:1.1,uAbsorp:8,uThreshold:0,uEdgeSoftness:.18,uShadowOffset:200,
    uCloudScale:1,uGlobalScaleFactor:.00018,uDetailScale:8,uErosionStrength:.35,uLodDistance:100000,
    uPopcornMode:true,uBaseLodMinDist:5000,uBaseLodMaxDist:120000,uBaseLodMaxLevel:3,
    uPowderScale:1,uPowderIntensity:1,uPhaseIntensity:.9,uPhaseG:.6,
    uCoverage:1,uCovBottomShape:.15,uCovBottomCurve:.5,uCovTopShape:.75,
    uCloudBottom:.06,uCloudTop:.8,uFadeCovBottom:.02,uFadeCovStart:.65,uFadeCovEnd:1,
    uWeatherEnabled:true,uWeatherRepeat:45,uWeatherPoleTilt:Math.PI/3,uWeatherPoleMask:.1,uWeatherGEnabled:false,
    uMaxDistance:120000,uRaySteps:64,uNight:0,
    uNightTop:new T.Color(),uNightHorizon:new T.Color(),uGround:new T.Color(),
  });
  const material=new T.ShaderMaterial({vertexShader:fullscreenVertex,fragmentShader:volumetricFragment,uniforms,depthWrite:false,depthTest:false,toneMapped:false});
  Object.assign(uniforms,weatherUniforms());
  const geometry=new T.PlaneGeometry(2,2),passScene=new T.Scene(),passCamera=new T.Camera();
  passScene.add(new T.Mesh(geometry,material));
  const target=new T.WebGLRenderTarget(1,1,{depthBuffer:false,type:T.HalfFloatType,minFilter:T.LinearFilter,magFilter:T.LinearFilter});
  const display=new T.ShaderMaterial({
    vertexShader:fullscreenVertex,fragmentShader:`varying vec2 vUv;uniform sampler2D skyTexture;uniform vec2 texel;
      void main(){
        vec3 center=texture2D(skyTexture,vUv).rgb,sum=center*2.0;float weights=2.0;
        for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){
          vec3 sampleColor=texture2D(skyTexture,vUv+vec2(float(x),float(y))*texel).rgb;
          float weight=exp(-length(sampleColor-center)*8.0);
          sum+=sampleColor*weight;weights+=weight;
        }
        gl_FragColor=vec4(sum/weights,1.0);
        #include <colorspace_fragment>
      }`,
    uniforms:{skyTexture:{value:target.texture},texel:{value:new T.Vector2()}},depthWrite:false,depthTest:false,toneMapped:false,
  });
  const mesh=new T.Mesh(geometry,display);mesh.name='Leoawen volumetric cloud atmosphere';mesh.frustumCulled=false;mesh.renderOrder=-1000;
  let quality='balanced',groundY=0;
  const size=new T.Vector2(),cameraPosition=new T.Vector3();
  return {
    mesh,
    setGroundHeight(height){groundY=height;},
    setWeather(state){updateWeatherUniforms(uniforms,state);},
    setDay(state){
      uniforms.uSunDirection.value.copy(state.sunDirection);
      uniforms.uNight.value=1-T.MathUtils.smoothstep(state.sunDirection.y,-.18,-.015);
      uniforms.uNightTop.value.copy(state.top);uniforms.uNightHorizon.value.copy(state.horizon);
      uniforms.uGround.value.copy(state.bottom);
    },
    update(dt,coverage,speed,nextQuality='balanced',angle=.46){
      quality=skyQuality[nextQuality]?nextQuality:'balanced';
      uniforms.uCoverage.value=coverage*1.3;
      uniforms.uWindOffset.value.addScaledVector(new T.Vector3(Math.cos(angle)*.0022,-.0005,Math.sin(angle)*.0022),dt*speed);
      uniforms.uWeatherOffset.value.x-=Math.cos(angle)*dt*speed*.0001;
      uniforms.uWeatherOffset.value.y-=Math.sin(angle)*dt*speed*.0001;
    },
    render(camera){
      const preset=skyQuality[quality];
      renderer.getDrawingBufferSize(size);
      const width=Math.max(1,Math.min(preset.width,Math.round(size.x*preset.scale)));
      const height=Math.max(1,Math.round(width*size.y/size.x));
      if(target.width!==width||target.height!==height)target.setSize(width,height);
      display.uniforms.texel.value.set(1/width,1/height);
      camera.updateMatrixWorld();camera.getWorldPosition(cameraPosition);
      uniforms.uCameraPos.value.copy(cameraPosition);uniforms.uCameraPos.value.y-=groundY;
      // Keep the sky's local sea level under the character's terrain datum.
      uniforms.uCameraPos.value.y=Math.max(2,uniforms.uCameraPos.value.y);
      uniforms.uInverseViewMatrix.value.copy(camera.matrixWorld);
      uniforms.uInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
      uniforms.uRaySteps.value=preset.steps;
      const previous=renderer.getRenderTarget();
      const viewport=renderer.getViewport(new T.Vector4()),scissor=renderer.getScissor(new T.Vector4()),scissorTest=renderer.getScissorTest();
      try{renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.render(passScene,passCamera);}
      finally{renderer.setRenderTarget(previous);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);}
    },
    dispose(){mesh.removeFromParent();textures.forEach(texture=>texture.dispose());target.dispose();material.dispose();display.dispose();geometry.dispose();},
  };
}
