// Adapted from ck42bb/procedural-weather-threejs @ 26ad580 (MIT).
// Flat numeric profiles keep transitions independent of the rendering engine.
const profile=(label,rain,snow,fog,lightning,darkness,wind,cloud,dust=0,aurora=0)=>
  Object.freeze({label,rain,snow,fog,lightning,darkness,wind,cloud,dust,aurora});
export const WEATHER_PRESETS=Object.freeze({
  clear:profile('晴朗',0,0,0,0,0,.5,.25),
  cloudy:profile('多云',0,0,.002,0,.2,.8,.6),
  drizzle:profile('毛毛雨',.3,0,.004,0,.3,.7,.72),
  rain:profile('下雨',.7,0,.006,.1,.5,1.2,.85),
  heavyRain:profile('大雨',1,0,.01,.3,.7,1.8,.95),
  storm:profile('雷暴',1,0,.015,.8,.85,2.5,1),
  lightSnow:profile('小雪',0,.3,.003,0,.15,.6,.55),
  snow:profile('降雪',0,.7,.006,0,.3,1,.75),
  blizzard:profile('暴风雪',0,1,.025,0,.6,3,1),
  fog:profile('浓雾',0,0,.03,0,.25,.2,.6),
  sandstorm:profile('沙尘暴',0,0,.02,.1,.5,3,.75,1),
  aurora:profile('极光',0,0,0,0,0,.3,.12,0,1),
});
const keys=Object.keys(WEATHER_PRESETS.clear).filter(key=>key!=='label');
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
export class WeatherState {
  constructor(initial='cloudy') {
    if(!WEATHER_PRESETS[initial])throw new RangeError(`Unknown weather: ${initial}`);
    this.target=initial;this.values={...WEATHER_PRESETS[initial]};
    this.from={...this.values};this.to={...this.values};this.elapsed=0;this.duration=0;
  }
  get progress(){return this.duration===0?1:Math.min(1,this.elapsed/this.duration);}
  setWeather(name,seconds=3){
    if(!WEATHER_PRESETS[name])throw new RangeError(`Unknown weather: ${name}`);
    if(!Number.isFinite(seconds)||seconds<0)throw new RangeError('Invalid transition duration');
    this.from={...this.values};this.to={...WEATHER_PRESETS[name]};this.target=name;
    this.elapsed=0;this.duration=seconds;
    if(seconds===0)this.values={...this.to};
  }
  update(dt){
    if(!Number.isFinite(dt)||dt<0)throw new RangeError('Invalid weather delta');
    this.elapsed=Math.min(this.duration,this.elapsed+dt);
    const p=this.progress,t=p*p*(3-2*p);
    for(const key of keys)this.values[key]=this.from[key]+(this.to[key]-this.from[key])*t;
    this.values.label=this.to.label;
    return this.values;
  }
}

// Intensity controls precipitation/haze/flash, not the day clock or solar angle.
export function sampleWeather(values,{intensity=1,wind=1,cloud=values.cloud}={}) {
  const strength=clamp(Number.isFinite(intensity)?intensity:1,0,1.5);
  const result={...values,cloud:clamp(cloud,0,1),wind:values.wind*clamp(wind,0,3)};
  for(const key of ['rain','snow','dust','aurora','lightning'])result[key]=clamp(values[key]*strength,0,1);
  result.fog=values.fog*strength;result.darkness=clamp(values.darkness*strength,0,.92);
  return result;
}
