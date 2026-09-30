import { Color } from 'three';

// Shared by the two sky engines. Aurora follows the reference's moving curtain
// and green/purple/pink height gradient; mapping to sky directions avoids a
// camera-following plane cutting through the Gaussian scene.
export const weatherUniforms=()=>({
  weatherDarkness:{value:0},weatherFog:{value:0},weatherFogColor:{value:new Color()},
  weatherFlash:{value:0},weatherAurora:{value:0},weatherTime:{value:0},
});
export function updateWeatherUniforms(uniforms,state){
  uniforms.weatherDarkness.value=state.darkness;
  uniforms.weatherFog.value=state.fog;
  uniforms.weatherFogColor.value.copy(state.fogColor);
  uniforms.weatherFlash.value=state.flash;
  uniforms.weatherAurora.value=state.aurora*state.night;
  uniforms.weatherTime.value=state.time;
}
export const weatherAtmosphere=/* glsl */`
uniform float weatherDarkness,weatherFog,weatherFlash,weatherAurora,weatherTime;
uniform vec3 weatherFogColor;
vec3 applyWeatherSky(vec3 color,vec3 ray){
  float luma=dot(color,vec3(.2126,.7152,.0722));
  color=mix(color,vec3(luma)*vec3(.85,.92,1.0),weatherDarkness*.75);
  color*=1.0-weatherDarkness*.75;
  if(weatherAurora>.001 && ray.y>0.0){
    float angle=atan(ray.z,ray.x),t=weatherTime;
    float base=.25+.06*sin(angle*3.0+t*.12)+.035*sin(angle*7.0-t*.2);
    float h=(ray.y-base)/.35;
    float curtain=smoothstep(0.0,.14,h)*(1.0-smoothstep(.45,1.0,h));
    float ribbons=.4+.6*pow(.5+.5*sin(angle*65.0+sin(angle*7.0+t*.3)*3.0+t*.2),3.0);
    vec3 glow=mix(vec3(.06,.9,.38),vec3(.45,.12,.8),smoothstep(.15,.8,h));
    glow=mix(glow,vec3(.8,.22,.45),smoothstep(.65,1.0,h));
    color+=glow*curtain*ribbons*weatherAurora*.65;
  }
  float horizon=1.0-smoothstep(0.0,.55,max(0.0,ray.y));
  float haze=(1.0-exp(-weatherFog*90.0))*mix(.25,1.0,horizon);
  color=mix(color,weatherFogColor,haze);
  color+=vec3(.65,.72,.9)*weatherFlash*.6;
  return color;
}
`;
