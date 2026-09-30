import * as T from 'three';
import { createWeatherSky } from './weather-sky.js';
import { createVolumetricSky } from './volumetric-sky.js';
import { sampleDay,formatHour,advanceHour } from './day-cycle.js';
import { createWeatherController } from './weather-controller.js';

export async function createTimeSimulator(scene,renderer) {
  const $=id=>document.getElementById(id);
  let hour=8,playing=false,model=null,state;
  const sunlight=new T.DirectionalLight(0xffffff,3),ambient=new T.HemisphereLight(0xffffff,0x263748,2);
  const moonlight=new T.DirectionalLight(0xa1c5ff,.15);
  scene.add(sunlight,sunlight.target,ambient,moonlight,moonlight.target);
  const sky=createWeatherSky(),center=new T.Vector3();
  scene.add(sky.mesh);
  let volume=null;
  try {
    volume=await createVolumetricSky(renderer);
    scene.add(volume.mesh);
    $('sky-status').textContent='体积云已就绪';
  } catch(error) {
    console.error('Volumetric sky initialization failed',error);
    $('sky-engine').value='lightweight';
    $('sky-engine').querySelector('[value="volumetric"]').disabled=true;
    $('sky-status').textContent='体积云初始化失败，已切换轻量云';
  }
  function activeSky(){return volume&&$('sky-engine').value==='volumetric'?volume:sky;}
  function syncSky(){const active=activeSky();sky.mesh.visible=active===sky;if(volume)volume.mesh.visible=active===volume;}
  $('sky-engine').addEventListener('change',()=>{
    syncSky();$('sky-status').textContent=activeSky()===volume?'体积云已就绪':'轻量云 · 更低渲染开销';
    $('sky-quality').disabled=activeSky()!==volume;
  });
  syncSky();
  const weather=createWeatherController(scene,renderer);
  function applyEnvironment(){
    const w=weather.state;
    sky.setWeather(w);volume?.setWeather(w);
    sunlight.intensity=state.sunIntensity*(1-w.darkness*.85)+w.flash*4;
    ambient.intensity=state.ambientIntensity*(1-w.darkness*.55)+w.flash*2;
    moonlight.intensity=state.moonIntensity*(1-w.darkness*.7);
    if(model?.recolor)model.recolor.copy(state.splatTint).multiplyScalar(1-w.darkness*.62).addScalar(w.flash*.65);
  }
  function refresh(){
    state=sampleDay(hour);
    sky.setDay(state);
    volume?.setDay(state);
    $('sky-view').textContent=state.sunDirection.y>=0?'☀ 查看太阳':'☾ 查看月亮';
    sunlight.color.copy(state.sunColor);sunlight.intensity=state.sunIntensity;
    ambient.color.copy(state.horizon);ambient.groundColor.copy(state.bottom);ambient.intensity=state.ambientIntensity;
    moonlight.intensity=state.moonIntensity;
    weather.update(0,state);applyEnvironment();
    $('time-hour').value=hour;
    $('time-hour').setAttribute('aria-valuetext',`${formatHour(hour)} ${state.phase}`);
    $('time-value').textContent=formatHour(hour);$('time-phase').textContent=state.phase;
    $('sun-altitude').textContent=`太阳高度 ${Math.round(Math.asin(state.sunDirection.y)*180/Math.PI)}°`;
    $('time-play').textContent=playing?'Ⅱ 暂停':'▶ 自动播放';$('time-play').setAttribute('aria-pressed',String(playing));
    document.querySelectorAll('[data-hour]').forEach(button=>button.setAttribute('aria-pressed',String(Math.abs(hour-Number(button.dataset.hour))<.01)));
  }
  $('time-hour').addEventListener('input',e=>{hour=Number(e.target.value);playing=false;refresh();});
  $('time-play').addEventListener('click',()=>{playing=!playing;refresh();});
  document.querySelectorAll('[data-hour]').forEach(button=>button.addEventListener('click',()=>{hour=Number(button.dataset.hour);playing=false;refresh();}));
  $('time-reset').addEventListener('click',()=>{hour=8;playing=false;refresh();});
  refresh();
  return {
    getCelestialDirection(){return state.sunDirection.clone().multiplyScalar(state.sunDirection.y>=0?1:-1);},
    setGroundHeight(height){volume?.setGroundHeight(height);weather.setGroundHeight(height);},
    setTerrain(root,transform){weather.setTerrain(root,transform);},
    setFlatGround(height,root){weather.setFlatGround(height,root);},
    clearTerrain(){weather.clearTerrain();},
    render(camera){weather.prepare(camera);if(activeSky()===volume)volume.render(camera);},
    setModel(next){if(model?.recolor)model.recolor.setRGB(1,1,1);model=next;weather.setModel(next);refresh();},
    update(dt,camera){
      if(playing&&!document.hidden){hour=advanceHour(hour,Math.min(dt,.1),Number($('time-duration').value));refresh();}
      if(!document.hidden){
        const elapsed=Math.min(dt,.1),w=weather.update(elapsed,state);
        applyEnvironment();
        sky.update(elapsed,w.cloud,w.wind,w.angle);volume?.update(elapsed,w.cloud,w.wind,$('sky-quality').value,w.angle);
      }
      camera.getWorldPosition(center);
      sunlight.target.position.copy(center);sunlight.position.copy(center).addScaledVector(state.sunDirection,100);
      moonlight.target.position.copy(center);moonlight.position.copy(center).addScaledVector(state.sunDirection,-100);
    },
    dispose(){weather.dispose();sky.dispose();volume?.dispose();for(const object of [sunlight,sunlight.target,ambient,moonlight,moonlight.target])object.removeFromParent();},
  };
}
