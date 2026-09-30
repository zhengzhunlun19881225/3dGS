import * as T from 'three';
import { dyno } from '@sparkjsdev/spark';
import { createSurfaceAtlas } from './surface-atlas.js';
import { SurfaceState } from './surface-state.js';
import { surfaceShading } from './surface-shader.js';

export function createGroundWeather(){
  const atlas=createSurfaceAtlas(),state=new SurfaceState(),amount=new T.Vector4();
  const uniforms={
    groundAtlas:{value:atlas.texture},groundRect:{value:atlas.rect},groundMode:{value:0},groundFloor:{value:0},
    groundTolerance:{value:.35},groundAmount:{value:amount},groundTime:{value:0},
    groundSnowLight:{value:new T.Color(1,1,1)},groundSkyLight:{value:new T.Color()},groundEye:{value:new T.Vector3()},
  };
  const inputs={
    atlas:dyno.dynoSampler2D(atlas.texture),rect:dyno.dynoVec4(atlas.rect),mode:dyno.dynoFloat(0),floorY:dyno.dynoFloat(0),
    tolerance:dyno.dynoFloat(.35),amount:dyno.dynoVec4(amount),time:dyno.dynoFloat(0),
    snowLight:dyno.dynoVec3(new T.Color()),skyLight:dyno.dynoVec3(new T.Color()),eye:dyno.dynoVec3(uniforms.groundEye.value),
  };
  let records=[],model=null,splatModifier=null,previousActive=false;
  function restore(){
    for(const {material,compile,key} of records){material.onBeforeCompile=compile;material.customProgramCacheKey=key;material.needsUpdate=true;}
    records=[];
    if(model&&splatModifier){
      const key=model.covSplats?'covWorldModifiers':'worldModifiers';
      model[key]=model[key]?.filter(modifier=>modifier!==splatModifier);model.updateGenerator();
    }
    splatModifier=null;model=null;
  }
  function patchMaterials(root){
    const seen=new Set(records.map(record=>record.material));
    root.traverse(object=>{
      if(!object.isMesh)return;
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        if(!material||seen.has(material)||(!material.isMeshStandardMaterial&&!material.isMeshBasicMaterial&&!material.isMeshLambertMaterial))continue;
        seen.add(material);
        const compile=material.onBeforeCompile,key=material.customProgramCacheKey;
        records.push({material,compile,key});
        material.customProgramCacheKey=()=>`${key.call(material)}:ground-weather-v1`;
        material.onBeforeCompile=(shader,renderer)=>{
          compile.call(material,shader,renderer);Object.assign(shader.uniforms,uniforms);
          shader.vertexShader='varying vec3 vWeatherWorld;\n'+shader.vertexShader;
          shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','vWeatherWorld=(modelMatrix*vec4(transformed,1.0)).xyz;\n#include <project_vertex>');
          shader.fragmentShader=`varying vec3 vWeatherWorld;
            uniform sampler2D groundAtlas;uniform vec4 groundRect,groundAmount;
            uniform float groundMode,groundFloor,groundTolerance,groundTime;
            uniform vec3 groundSnowLight,groundSkyLight,groundEye;\n${surfaceShading}\n`+shader.fragmentShader;
          shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
            diffuseColor.rgb=shadeWeatherGround(diffuseColor.rgb,vWeatherWorld,groundEye,groundAtlas,groundRect,
              groundMode,groundFloor,groundTolerance,groundAmount,groundTime,vec3(.93,.96,1),groundSkyLight);`);
        };
        material.needsUpdate=true;
      }
    });
  }
  return {
    state,atlas,uniforms,
    get active(){return state.wetness+state.snow>.0001;},
    setModel(next){
      restore();model=next;atlas.clear();uniforms.groundMode.value=inputs.mode.value=0;state.clear();
      if(!model)return;
      if(!model.updateGenerator){patchMaterials(model);return;}
      const field=model.covSplats?'covsplat':'gsplat',type=model.covSplats?dyno.CovSplat:dyno.Gsplat;
      const key=model.covSplats?'covWorldModifiers':'worldModifiers';
      splatModifier=dyno.dynoBlock({[field]:type},{[field]:type},values=>new dyno.Dyno({
        inTypes:{[field]:type,atlas:'sampler2D',rect:'vec4',mode:'float',floorY:'float',tolerance:'float',amount:'vec4',time:'float',snowLight:'vec3',skyLight:'vec3',eye:'vec3'},
        outTypes:{[field]:type},inputs:{...values,...inputs},globals:()=>[surfaceShading],
        statements:({inputs:i,outputs:o})=>[
          `${o[field]}=${i[field]};`,
          `${o[field]}.rgba.rgb=shadeWeatherGround(${i[field]}.rgba.rgb,${i[field]}.center,${i.eye},${i.atlas},${i.rect},${i.mode},${i.floorY},${i.tolerance},${i.amount},${i.time},${i.snowLight},${i.skyLight});`,
        ],
      }).outputs);
      // Surface appearance must be generated before distance fog is applied.
      model[key]=[splatModifier,...(model[key]??[])];model.updateGenerator();
    },
    setTerrain(root,transform){
      atlas.build(root,transform);uniforms.groundMode.value=inputs.mode.value=1;
      uniforms.groundTolerance.value=inputs.tolerance.value=atlas.tolerance;
      model?.updateVersion?.();
    },
    setFlatGround(height,root){
      atlas.clear();uniforms.groundFloor.value=inputs.floorY.value=height;
      uniforms.groundMode.value=inputs.mode.value=2;
      if(root)patchMaterials(root);
    },
    clearTerrain(){atlas.clear();uniforms.groundMode.value=inputs.mode.value=0;model?.updateVersion?.();},
    update(dt,weather,day){
      state.update(dt,weather);
      amount.set(state.wetness,state.snow,state.puddles,weather.rain);
      uniforms.groundTime.value=inputs.time.value=weather.time;
      const brightness=(.16+.84*(1-day.night))*(1-weather.darkness*.35);
      uniforms.groundSnowLight.value.setRGB(.91,.95,1).multiplyScalar(brightness).addScalar(weather.flash*.45);
      uniforms.groundSkyLight.value.copy(day.horizon).multiplyScalar(.6+.4*brightness).addScalar(weather.flash*.4);
      // The splat generator operates in sRGB; mesh shaders operate in linear.
      inputs.snowLight.value.copy(uniforms.groundSnowLight.value).convertLinearToSRGB();
      inputs.skyLight.value.copy(uniforms.groundSkyLight.value).convertLinearToSRGB();
    },
    prepare(camera){
      camera.getWorldPosition(uniforms.groundEye.value);
      const active=state.wetness+state.snow>.0001;
      if(active||previousActive)model?.updateVersion?.();previousActive=active;
    },
    dispose(){restore();atlas.dispose();},
  };
}
