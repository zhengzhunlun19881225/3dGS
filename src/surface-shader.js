// Shared surface lookup for splats, regular mesh materials and precipitation.
// G = upward normal / validity; R = world height; BA = normal XZ.
export const surfaceLookup=/* glsl */`
vec4 weatherSurfaceAt(vec3 p,sampler2D atlas,vec4 rect,float mode,float floorY){
  if(mode>1.5)return vec4(floorY,1.0,0.0,0.0);
  if(mode<.5)return vec4(0.0);
  vec2 uv=(p.xz-rect.xy)*rect.zw;
  if(any(lessThan(uv,vec2(0)))||any(greaterThanEqual(uv,vec2(1))))return vec4(0.0);
  vec4 cell=texture(atlas,uv);
  // Reconstruct height on the sampled triangle's plane to avoid grid bands
  // on slopes. Invalid cells stay invalid; never bridge holes or map edges.
  if(cell.g>.01){
    vec2 size=vec2(textureSize(atlas,0));
    vec2 cellWorld=(floor(uv*size)+.5)/size/rect.zw+rect.xy;
    cell.r-=dot(cell.ba,p.xz-cellWorld)/cell.g;
  }
  return cell;
}
`;

export const surfaceShading=surfaceLookup+/* glsl */`
float groundHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float groundNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(groundHash(i),groundHash(i+vec2(1,0)),f.x),mix(groundHash(i+vec2(0,1)),groundHash(i+vec2(1)),f.x),f.y);
}
vec3 shadeWeatherGround(vec3 color,vec3 p,vec3 eye,sampler2D atlas,vec4 rect,
  float mode,float floorY,float tolerance,vec4 amount,float time,vec3 snowLight,vec3 skyLight){
  if(amount.x+amount.y<.0001)return color;
  vec4 surface=weatherSurfaceAt(p,atlas,rect,mode,floorY);
  if(surface.g<.15)return color;
  float contact=1.0-smoothstep(tolerance*.4,tolerance,abs(p.y-surface.r));
  if(contact<.001)return color;
  vec3 n=normalize(vec3(surface.b,surface.g,surface.a));
  float grain=groundNoise(p.xz*.6)*.65+groundNoise(p.xz*2.7)*.35;
  float wet=amount.x*contact;
  vec3 result=color*(1.0-wet*.32);
  // Water collects in procedural patches on flatter terrain; no flat overlay
  // sheet floating above the real slope or leaking across missing triangles.
  float puddle=amount.z*smoothstep(.82,.98,surface.g)*contact;
  puddle*=smoothstep(.60-amount.z*.32,.79-amount.z*.32,grain);
  vec3 view=normalize(eye-p+vec3(0,.00001,0));
  float fresnel=.16+.65*pow(1.0-max(0.0,dot(n,view)),3.0);
  result=mix(result,skyLight*(.8+.2*groundNoise(p.xz*1.8)),puddle*fresnel);
  // Independently phased expanding impact rings. Evaluated on the terrain's
  // own splats/triangles, so rings stay attached when cameras or players move.
  vec2 cell=floor(p.xz*1.4);
  float rings=0.0;
  if(amount.w*wet>.001){
  for(int x=-1;x<=1;x++)for(int z=-1;z<=1;z++){
    vec2 id=cell+vec2(float(x),float(z));
    float seed=groundHash(id),phase=fract(time*(.85+seed*.45)+seed*9.0);
    vec2 origin=(id+vec2(groundHash(id+13.0),groundHash(id+27.0)))/1.4;
    float distanceToRing=abs(length(p.xz-origin)-phase*.38);
    rings+=(1.0-smoothstep(.014,.044,distanceToRing))*(1.0-phase)*smoothstep(0.0,.1,phase);
  }
  }
  result+=skyLight*rings*amount.w*wet*(.16+.5*puddle);
  // Snow grows from scattered patches to continuous coverage, with the
  // original luminance retaining surface detail. Steep faces shed snow.
  float settled=smoothstep(.35,.82,surface.g);
  float coverage=smoothstep(grain*.6,grain*.6+.28,amount.y)*contact*settled;
  float luminance=dot(color,vec3(.2126,.7152,.0722));
  vec3 snow=snowLight*(.78+.2*clamp(luminance,0.0,1.0)+.02*groundNoise(p.xz*24.0));
  return mix(result,snow,coverage*.97);
}
`;
