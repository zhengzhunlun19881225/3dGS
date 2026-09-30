import { Color, Vector3, MathUtils } from 'three';

// Artistic local day cycle: 06:00 sunrise and 18:00 sunset, independent of date/location.
const stops = [
  [0, '#060e29', '#142344', '#080d18', '#739aca', .10],
  [5, '#101b45', '#783b55', '#17182a', '#ac7799', .18],
  [6, '#605486', '#ff874c', '#4d3438', '#ff995e', .58],
  [7, '#639fd0', '#ffd0a0', '#727c83', '#ffcf9b', .86],
  [11, '#267ac6', '#b8dfff', '#8babb9', '#ffffff', 1],
  [15, '#3886c7', '#c4e3f4', '#8babb9', '#fff4e4', 1],
  [17, '#6873a6', '#ffb273', '#685460', '#ffbd82', .78],
  [18, '#5c406a', '#ff743e', '#4b2d39', '#ff8654', .5],
  [19, '#111932', '#77384a', '#161623', '#aa7186', .17],
  [20, '#060e29', '#142344', '#080d18', '#739aca', .10],
  [24, '#060e29', '#142344', '#080d18', '#739aca', .10],
].map(([hour,top,horizon,bottom,tint,brightness])=>({hour,top:new Color(top),horizon:new Color(horizon),bottom:new Color(bottom),tint:new Color(tint),brightness}));
export const wrapHour = hour => ((hour % 24) + 24) % 24;
export function formatHour(hour) {
  const minutes = Math.round(MathUtils.clamp(hour,0,24)*60);
  return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
}
export function sampleDay(hour) {
  const h=wrapHour(hour),angle=(h-6)/12*Math.PI;
  const index=stops.findIndex(stop=>stop.hour>h),a=stops[index-1],b=stops[index];
  const fraction=(h-a.hour)/(b.hour-a.hour),t=fraction*fraction*(3-2*fraction);
  const color=key=>a[key].clone().lerp(b[key],t);
  const elevation=Math.sin(angle),daylight=Math.max(0,elevation);
  const twilight=MathUtils.smoothstep(elevation,-.26,.2);
  return {hour:h,sunDirection:new Vector3(Math.cos(angle),elevation,0),
    top:color('top'),horizon:color('horizon'),bottom:color('bottom'),
    sunColor:new Color('#ff8654').lerp(new Color('#fff8ed'),MathUtils.smoothstep(elevation,0,.65)),
    sunIntensity:3.2*Math.pow(daylight,.65),ambientIntensity:.14+2.6*twilight,
    moonIntensity:.18*(1-twilight),night:1-twilight,
    splatTint:color('tint').multiplyScalar(MathUtils.lerp(a.brightness,b.brightness,t)),
    phase:h<5||h>=19?'夜晚':h<7?'日出':h<11?'上午':h<15?'正午':h<17?'下午':'日落'};
}
export function advanceHour(hour,seconds,cycleMinutes) {
  return wrapHour(hour+Math.max(0,seconds)*24/(Math.max(.1,cycleMinutes)*60));
}
