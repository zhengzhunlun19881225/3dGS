import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from 'three';
import { WeatherState,WEATHER_PRESETS,sampleWeather } from '../src/weather-state.js';
import { createPrecipitation } from '../src/weather-particles.js';

test('weather transitions interpolate by elapsed time and remain continuous on interruption',()=>{
  const weather=new WeatherState('clear');weather.setWeather('storm',3);
  weather.update(1.5);const middle={...weather.values};
  assert.equal(middle.rain,.5);assert.equal(middle.darkness,.425);
  weather.setWeather('snow',3);assert.deepEqual(weather.values,middle);
  weather.update(0);assert.equal(weather.values.rain,middle.rain);
  weather.update(3);assert.deepEqual(weather.values,WEATHER_PRESETS.snow);
  weather.setWeather('clear',0);assert.deepEqual(weather.values,WEATHER_PRESETS.clear);
  assert.equal(weather.progress,1);
});
test('all 12 profiles are reachable, bounded and independent of frame rate',()=>{
  assert.equal(Object.keys(WEATHER_PRESETS).length,12);
  for(const name of Object.keys(WEATHER_PRESETS)){
    const a=new WeatherState(),b=new WeatherState();a.setWeather(name,3);b.setWeather(name,3);
    for(let i=0;i<180;i++)a.update(1/60);b.update(3);
    for(const [key,value] of Object.entries(b.values))if(typeof value==='number'){
      assert.ok(Math.abs(value-a.values[key])<1e-10,`${name}: ${key}`);
      assert.ok(Number.isFinite(value)&&value>=0);
    }
  }
});
test('weather strength, wind stop and manual cloud overrides do not mutate presets',()=>{
  const w=sampleWeather(WEATHER_PRESETS.storm,{intensity:0,wind:0,cloud:.1});
  assert.equal(w.rain,0);assert.equal(w.fog,0);assert.equal(w.lightning,0);assert.equal(w.wind,0);assert.equal(w.cloud,.1);
  assert.equal(WEATHER_PRESETS.storm.rain,1);
  assert.equal(sampleWeather(WEATHER_PRESETS.blizzard,{intensity:1.5}).snow,1);
  const state=new WeatherState();assert.throws(()=>state.setWeather('invalid'),RangeError);
  assert.throws(()=>state.update(NaN),RangeError);assert.throws(()=>state.setWeather('rain',-1),RangeError);
});
test('GPU rain has matching seeds and positions for both endpoints, and disposes cleanly',()=>{
  const scene=new Scene(),rain=createPrecipitation(scene,0,100);
  const attrs=rain.mesh.geometry.attributes;
  for(const attr of Object.values(attrs))assert.equal(attr.count,200);
  for(let i=0;i<200;i+=2){
    for(const name of ['position','aSeed']){
      const a=attrs[name];assert.equal(a.getX(i),a.getX(i+1));assert.equal(a.getY(i),a.getY(i+1));assert.equal(a.getZ(i),a.getZ(i+1));
    }
    assert.equal(attrs.aEnd.getX(i),0);assert.equal(attrs.aEnd.getX(i+1),1);
  }
  let geometries=0,materials=0;
  rain.mesh.geometry.addEventListener('dispose',()=>geometries++);rain.mesh.material.addEventListener('dispose',()=>materials++);
  rain.dispose();assert.equal(scene.children.length,0);assert.equal(geometries,1);assert.equal(materials,1);
});
