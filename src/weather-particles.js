// GPU precipitation adapted from ck42bb @ 26ad580, MIT (vendor/ck42bb).
import * as T from 'three';
import { surfaceLookup } from './surface-shader.js';

export const particleVertex=/* glsl */`
attribute vec3 aSeed;
attribute float aEnd;
uniform float time,intensity,kind,groundHeight,pixelRatio,lightLevel;
uniform vec3 windForce,windOffset,anchor;
uniform sampler2D surfaceAtlas;
uniform vec4 surfaceRect;
uniform float surfaceMode,surfaceFloor;
varying float vAlpha;
${surfaceLookup}
void main(){
  float radius=24.0,height=32.0;
  float seed=aSeed.x,t=time+aSeed.y*8.0;
  float speed=kind<.5?18.0:(kind<1.5?1.8:.2);
  vec3 p=position;
  p.y=mod(p.y-speed*(.7+seed*.6)*t-anchor.y,height)-height*.5+anchor.y;
  vec2 drift=windOffset.xz;
  if(kind>.5){drift+=vec2(sin(t*(1.0+seed)+aSeed.y),cos(t*.7+aSeed.y))*1.3;}
  p.xz=mod(p.xz+drift-anchor.xz+radius,2.0*radius)-radius+anchor.xz;
  if(kind<.5){
    p.y-=aEnd*.65;
    p.xz+=windForce.xz*aEnd*.025;
  }
  float distanceToCamera=length(p-anchor);
  vAlpha=smoothstep(seed,seed+.08,intensity)*(1.0-smoothstep(16.0,24.0,length(p.xz-anchor.xz)));
  vec4 surface=weatherSurfaceAt(p,surfaceAtlas,surfaceRect,surfaceMode,surfaceFloor);
  float impactHeight=surface.g>.01?surface.r:groundHeight;
  vAlpha*=smoothstep(.5,2.0,distanceToCamera)*smoothstep(impactHeight,impactHeight+.15,p.y);
  vAlpha*=clamp(lightLevel,.2,1.2);
  vec4 view=modelViewMatrix*vec4(p,1.0);
  gl_Position=projectionMatrix*view;
  gl_PointSize=clamp((kind<1.5?32.0:22.0)*aSeed.z*pixelRatio/max(1.0,-view.z),1.0,10.0*pixelRatio);
}
`;
const fragment=/* glsl */`
uniform float kind;
varying float vAlpha;
void main(){
  float alpha=vAlpha;
  vec3 color=vec3(.64,.73,.86);
  if(kind>.5){
    float d=length(gl_PointCoord-.5);
    alpha*=1.0-smoothstep(.1,.5,d);
    color=kind<1.5?vec3(.92,.96,1):vec3(.65,.39,.16);
  }
  alpha*=kind<.5?.42:(kind<1.5?.8:.55);
  if(alpha<.005)discard;
  gl_FragColor=vec4(color,alpha);
  #include <colorspace_fragment>
}
`;

export function createPrecipitation(scene,kind,count,random=Math.random){
  const vertices=count*(kind===0?2:1),positions=new Float32Array(vertices*3);
  const seeds=new Float32Array(vertices*3),ends=new Float32Array(vertices);
  for(let i=0;i<count;i++){
    const position=[(random()-.5)*48,random()*32,(random()-.5)*48];
    const seed=[random(),random()*Math.PI*2,.5+random()];
    for(let v=0;v<(kind===0?2:1);v++){
      const at=kind===0?i*2+v:i;positions.set(position,at*3);seeds.set(seed,at*3);ends[at]=v;
    }
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.BufferAttribute(positions,3));
  geometry.setAttribute('aSeed',new T.BufferAttribute(seeds,3));
  geometry.setAttribute('aEnd',new T.BufferAttribute(ends,1));
  const uniforms={time:{value:0},intensity:{value:0},kind:{value:kind},groundHeight:{value:0},pixelRatio:{value:1},lightLevel:{value:1},
    surfaceAtlas:{value:null},surfaceRect:{value:new T.Vector4()},surfaceMode:{value:0},surfaceFloor:{value:0},
    windForce:{value:new T.Vector3()},windOffset:{value:new T.Vector3()},anchor:{value:new T.Vector3()}};
  const material=new T.ShaderMaterial({uniforms,vertexShader:particleVertex,fragmentShader:fragment,transparent:true,depthWrite:false});
  const mesh=kind===0?new T.LineSegments(geometry,material):new T.Points(geometry,material);
  mesh.name=['Weather rain','Weather snow','Weather dust'][kind];
  mesh.frustumCulled=false;mesh.renderOrder=100;mesh.visible=false;scene.add(mesh);
  return {mesh,uniforms,dispose(){mesh.removeFromParent();geometry.dispose();material.dispose();}};
}
