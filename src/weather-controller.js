import * as T from 'three';
import { dyno } from '@sparkjsdev/spark';
import { WEATHER_PRESETS,WeatherState,sampleWeather } from './weather-state.js';
import { createPrecipitation } from './weather-particles.js';
import { createGroundWeather } from './ground-weather.js';

// Weather controller adapted from ck42bb @ 26ad580 (MIT). GPU particles keep
// fixed buffers; changing weather only updates uniforms and visibility.
export function createWeatherController(scene,renderer){
  const $=id=>document.getElementById(id),machine=new WeatherState('cloudy');
  const previousFog=scene.fog,fog=new T.FogExp2('#9daebd',0);scene.fog=fog;
  const ground=createGroundWeather();
  const particles=[createPrecipitation(scene,0,16000),createPrecipitation(scene,1,6500),createPrecipitation(scene,2,4500)];
  for(const system of particles)Object.assign(system.uniforms,{
    surfaceAtlas:ground.uniforms.groundAtlas,surfaceRect:ground.uniforms.groundRect,
    surfaceMode:ground.uniforms.groundMode,surfaceFloor:ground.uniforms.groundFloor,
  });
  const wind=new T.Vector3(),offset=new T.Vector3(),center=new T.Vector3();
  const fogCamera=dyno.dynoVec3(new T.Vector3()),fogColor=dyno.dynoVec3(new T.Color());
  const fogDensity=dyno.dynoFloat(0);
  let time=0,groundHeight=0,cloudOverride=null,autoRemaining=60,nextStrike=3,flashLife=0,bolt=null,model=null,modifiers=[],renderedFog=0;
  let current={...machine.values,night:0,time:0,flash:0,angle:0,fogColor:new T.Color()};
  const listeners=[];
  function listen(element,type,callback){element.addEventListener(type,callback);listeners.push(()=>element.removeEventListener(type,callback));}
  const select=$('weather-preset');
  for(const [value,{label}] of Object.entries(WEATHER_PRESETS)){const option=new Option(label,value);select.add(option);}
  select.value=machine.target;
  function choose(name){
    // A manual cloud override is the visible starting point of the next blend.
    if(cloudOverride!==null)machine.values.cloud=cloudOverride;
    machine.setWeather(name,Number($('weather-transition').value));
    select.value=name;cloudOverride=null;autoRemaining=Number($('weather-interval').value);nextStrike=3;
  }
  listen(select,'change',()=>choose(select.value));
  document.querySelectorAll('[data-weather]').forEach(button=>listen(button,'click',()=>choose(button.dataset.weather)));
  listen($('cloud-cover'),'input',()=>{cloudOverride=Number($('cloud-cover').value);});
  listen($('weather-auto'),'change',()=>{autoRemaining=Number($('weather-interval').value);});
  listen($('weather-interval'),'change',()=>{autoRemaining=Number($('weather-interval').value);});
  listen($('weather-reset'),'click',()=>{
    $('weather-auto').checked=false;$('weather-intensity').value=1;$('cloud-speed').value=1;
    $('wind-direction').value=25;$('weather-lightning').checked=true;choose('clear');
  });
  listen($('weather-lightning'),'change',()=>{if(!$('weather-lightning').checked){flashLife=0;removeBolt();}});
  listen($('surface-wetness'),'input',event=>ground.state.setWetness(Number(event.target.value)));
  listen($('surface-snow'),'input',event=>ground.state.setSnow(Number(event.target.value)));
  listen($('surface-clear'),'click',()=>ground.state.clear());

  function removeBolt(){if(bolt){bolt.removeFromParent();bolt.geometry.dispose();bolt.material.dispose();bolt=null;}}
  function strike(){
    removeBolt();
    const angle=Math.random()*Math.PI*2,distance=35+Math.random()*30;
    const start=new T.Vector3(center.x+Math.cos(angle)*distance,Math.max(center.y,groundHeight)+65,center.z+Math.sin(angle)*distance);
    const end=new T.Vector3(start.x+8,groundHeight,start.z+4),points=[];
    // Explicit segments prevent spurious connections between branch endpoints.
    function subdivide(a,b,depth,jitter){
      if(depth===0){points.push(a,b);return;}
      const mid=a.clone().lerp(b,.4+Math.random()*.2);
      mid.x+=(Math.random()-.5)*jitter;mid.z+=(Math.random()-.5)*jitter;
      subdivide(a,mid,depth-1,jitter*.6);subdivide(mid,b,depth-1,jitter*.6);
      if(depth>2&&Math.random()<.3)subdivide(mid,mid.clone().add(new T.Vector3(jitter,-jitter,jitter*.4)),depth-2,jitter*.4);
    }
    subdivide(start,end,5,12);
    bolt=new T.LineSegments(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color:'#dcddff',transparent:true,depthWrite:false,toneMapped:false}));
    bolt.renderOrder=99;scene.add(bolt);flashLife=.22;
  }

  function detachModel(){
    if(model){
      for(const {key,modifier} of modifiers)model[key]=model[key]?.filter(item=>item!==modifier);
      model.updateGenerator?.();
    }
    modifiers=[];model=null;
  }
  function makeFogModifier(type,field){
    return dyno.dynoBlock({[field]:type},{[field]:type},inputs=>new dyno.Dyno({
      inTypes:{[field]:type,eye:'vec3',color:'vec3',density:'float'},outTypes:{[field]:type},
      inputs:{...inputs,eye:fogCamera,color:fogColor,density:fogDensity},
      statements:({inputs:i,outputs:o})=>[
        `${o[field]} = ${i[field]};`,
        `${o[field]}.rgba.rgb = mix(${i[field]}.rgba.rgb, ${i.color}, 1.0-exp(-pow(length(${i[field]}.center-${i.eye})*${i.density},2.0)));`,
      ],
    }).outputs);
  }
  function setModel(next){
    detachModel();model=next;ground.setModel(next);
    if(!model?.updateGenerator)return;
    const key=model.covSplats?'covWorldModifiers':'worldModifiers';
    const modifier=makeFogModifier(model.covSplats?dyno.CovSplat:dyno.Gsplat,model.covSplats?'covsplat':'gsplat');
    model[key]=[...(model[key]??[]),modifier];modifiers.push({key,modifier});model.updateGenerator();
  }

  return {
    get state(){return current;},
    setModel,
    setGroundHeight(value){groundHeight=value;},
    setTerrain(root,transform){ground.setTerrain(root,transform);$('surface-source').textContent='地形地表 · 随雨雪累积，可拖动预览';},
    setFlatGround(height,root){ground.setFlatGround(height,root);$('surface-source').textContent='平面地表 · 随雨雪累积，可拖动预览';},
    clearTerrain(){ground.clearTerrain();$('surface-source').textContent='正在准备地表…';},
    update(dt,day){
      time+=dt;
      if($('weather-auto').checked){
        autoRemaining-=dt;
        if(autoRemaining<=0){
          const candidates=Object.keys(WEATHER_PRESETS).filter(key=>key!==machine.target&&(key!=='aurora'||day.night>.5));
          choose(candidates[Math.floor(Math.random()*candidates.length)]);
        }
      }
      machine.update(dt);
      current={...sampleWeather(machine.values,{
        intensity:Number($('weather-intensity').value),wind:Number($('cloud-speed').value),cloud:cloudOverride??machine.values.cloud,
      }),night:day.night,time,angle:T.MathUtils.degToRad(Number($('wind-direction').value)),flash:0,fogColor:fog.color};
      const windSpeed=current.wind*5*(1+.2*Math.sin(time*.5));
      wind.set(Math.cos(current.angle)*windSpeed,0,Math.sin(current.angle)*windSpeed);
      offset.addScaledVector(wind,dt*.65);
      if($('weather-lightning').checked){
        nextStrike-=dt*current.lightning;
        if(nextStrike<=0&&current.lightning>.05){strike();nextStrike=2+Math.random()*6;}
      }
      flashLife=Math.max(0,flashLife-dt);
      current.flash=flashLife>0?Math.pow(flashLife/.22,2):0;
      if(bolt){bolt.material.opacity=current.flash;if(flashLife===0)removeBolt();}
      ground.update(dt,current,day);
      fog.color.set('#a2b4c5').lerp(new T.Color('#c4a060'),current.dust)
        .multiplyScalar((.13+.87*(1-day.night))*(1-current.darkness*.6));
      fog.color.lerp(new T.Color('#d8e3ff'),current.flash*.6);
      fog.density=current.fog;
      fogDensity.value=current.fog;
      // Spark stores colors as sRGB until its final rasterization pass.
      fogColor.value.copy(fog.color).convertLinearToSRGB();
      const strengths=[current.rain,current.snow,current.dust];
      particles.forEach((system,i)=>{
        const u=system.uniforms;system.mesh.visible=strengths[i]>.001;
        u.time.value=time;u.intensity.value=strengths[i];u.windForce.value.copy(wind);u.windOffset.value.copy(offset);
        u.groundHeight.value=groundHeight;u.pixelRatio.value=renderer.getPixelRatio();
        u.lightLevel.value=.3+.7*(1-day.night)+current.flash;
      });
      if(cloudOverride===null)$('cloud-cover').value=current.cloud;
      $('weather-intensity-value').textContent=`${Math.round(Number($('weather-intensity').value)*100)}%`;
      $('wind-direction-value').textContent=`${$('wind-direction').value}°`;
      $('wind-speed-value').textContent=`${windSpeed.toFixed(1)} m/s`;
      const progress=machine.progress<1?` · 过渡 ${Math.round(machine.progress*100)}%`:'';
      const auto=$('weather-auto').checked?` · ${Math.ceil(autoRemaining)} 秒后切换`:'';
      const nightHint=machine.target==='aurora'&&day.night<.5?' · 夜间可见，可切至 22:00':'';
      $('weather-status').textContent=`${WEATHER_PRESETS[machine.target].label}${progress}${auto}${nightHint}`;
      $('surface-wetness').value=ground.state.wetness;
      $('surface-snow').value=ground.state.snow;
      $('surface-wetness-value').textContent=`${Math.round(ground.state.wetness*100)}%`;
      $('surface-snow-value').textContent=`${Math.round(ground.state.snow*100)}%`;
      document.querySelectorAll('[data-weather]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.weather===machine.target)));
      return current;
    },
    prepare(camera){
      ground.prepare(camera);
      camera.getWorldPosition(center);
      for(const system of particles)system.uniforms.anchor.value.copy(center).add(new T.Vector3(0,8,0));
      fogCamera.value.copy(center);
      // World modifier uniforms affect generated splat colors, not just the
      // final material. Mark the generator dirty for movement and fog changes.
      if(model?.updateVersion&&(current.fog>0||renderedFog!==current.fog))model.updateVersion();
      renderedFog=current.fog;
    },
    dispose(){
      detachModel();ground.dispose();removeBolt();particles.forEach(system=>system.dispose());listeners.forEach(remove=>remove());
      if(scene.fog===fog)scene.fog=previousFog;
    },
  };
}
