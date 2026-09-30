import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleDay,formatHour,advanceHour } from '../src/day-cycle.js';
test('sun rises east at six, peaks at noon and sets west at eighteen',()=>{
  const rise=sampleDay(6),noon=sampleDay(12),set=sampleDay(18),night=sampleDay(0);
  assert.ok(rise.sunDirection.x>.99&&Math.abs(rise.sunDirection.y)<1e-8);
  assert.ok(noon.sunDirection.y>.99&&noon.sunIntensity>3);
  assert.ok(set.sunDirection.x<-.99&&Math.abs(set.sunDirection.y)<1e-8);
  assert.equal(night.sunIntensity,0);assert.ok(night.moonIntensity>0);
  assert.ok(noon.ambientIntensity>night.ambientIntensity);
});
test('color transitions are continuous and midnight loops without jumps',()=>{
  for(const boundary of [0,5,6,7,11,15,17,18,19,20,24]){
    const a=sampleDay(boundary-.0001),b=sampleDay(boundary+.0001);
    for(const key of ['top','horizon','bottom','splatTint'])assert.ok(a[key].toArray().every((v,i)=>Math.abs(v-b[key].toArray()[i])<.001),`${boundary} ${key}`);
  }
  assert.deepEqual(sampleDay(0),sampleDay(24));
  assert.ok(sampleDay(6).horizon.r>sampleDay(6).horizon.b);
  assert.ok(sampleDay(12).top.b>sampleDay(12).top.r);
});
test('playback uses elapsed seconds, wraps midnight, and formats endpoint correctly',()=>{
  assert.equal(formatHour(8),'08:00');assert.equal(formatHour(6.5),'06:30');assert.equal(formatHour(24),'24:00');
  assert.equal(advanceHour(23,10,1),3);
  let hour=8;for(let i=0;i<600;i++)hour=advanceHour(hour,1/60,3);
  assert.ok(Math.abs(hour-advanceHour(8,10,3))<1e-8);
});
