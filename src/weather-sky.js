import { Color, MathUtils, Quaternion, Vector2, Vector3 } from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { weatherAtmosphere,weatherUniforms,updateWeatherUniforms } from './weather-atmosphere.js';

// Sky's daylight scattering is combined with a moving cloud sheet and a lunar
// disc in one opaque background pass. Clouds can occlude both celestial bodies
// without fighting Spark's transparent splats or the monitoring render camera.
const weatherFunctions = /* glsl */`
uniform float skyExposure, nightBlend, dayBlend, cloudCover;
uniform vec2 cloudOffset;
uniform vec3 nightTop, nightHorizon, groundColor, cloudLight, cloudShadow;

float skyHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float skyNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(skyHash(i), skyHash(i + vec2(1, 0)), u.x),
             mix(skyHash(i + vec2(0, 1)), skyHash(i + vec2(1)), u.x), u.y);
}
float cloudFbm(vec2 p) {
  float value = 0.0, weight = 0.52;
  for (int i = 0; i < 5; i++) {
    value += weight * skyNoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(7.3, 2.1);
    weight *= 0.5;
  }
  return value;
}
float moonSurface(vec2 uv) {
  float surface = 0.76 + 0.13 * skyNoise(uv * 34.0);
  surface -= 0.3 * smoothstep(0.36, 0.64, cloudFbm(uv * 3.7 + 17.0));
  vec2 cell = floor(uv * 7.0);
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      vec2 id = cell + vec2(float(x), float(y));
      vec2 center = id + vec2(skyHash(id + 8.0), skyHash(id + 29.0));
      float radius = 0.10 + 0.18 * skyHash(id + 52.0);
      float dist = length(uv * 7.0 - center);
      surface -= 0.13 * (1.0 - smoothstep(radius * 0.45, radius, dist));
      surface += 0.1 * (1.0 - smoothstep(0.0, radius * 0.2, abs(dist - radius)));
    }
  }
  return surface;
}
`;

const weatherComposite = /* glsl */`
vec3 hdr = max(retColor * skyExposure, vec3(0.0));
vec3 daylight = clamp((hdr * (2.51 * hdr + 0.03)) / (hdr * (2.43 * hdr + 0.59) + 0.14), 0.0, 1.0);
// Art-directed clear blue at altitude; preserve the scattering around sunset
// and the sun itself. Values here are linear RGB, converted once at output.
vec3 clearBlue = mix(vec3(0.43, 0.68, 0.89), vec3(0.018, 0.20, 0.56), pow(max(direction.y, 0.0), 0.45));
daylight = mix(daylight, clearBlue, 0.75 * dayBlend * (1.0 - smoothstep(0.994, 0.9998, cosTheta)));
vec3 nightColor = mix(nightHorizon, nightTop, pow(max(direction.y, 0.0), 0.55));
vec3 skyColor = mix(daylight, nightColor, nightBlend);

// A large enough disc to read in a roaming view, with surface detail and halo.
vec3 moonDirection = -vSunDirection;
float moonFacing = dot(direction, moonDirection);
float moonVisibility = smoothstep(-0.025, 0.07, moonDirection.y) * nightBlend;
skyColor += vec3(0.13, 0.19, 0.30) * pow(max(moonFacing, 0.0), 650.0) * moonVisibility;
if (moonFacing > 0.9994 && moonVisibility > 0.0) {
  vec3 lunarRight = normalize(cross(vec3(0, 0, 1), moonDirection));
  vec3 lunarUp = cross(moonDirection, lunarRight);
  vec2 uv = vec2(dot(direction, lunarRight), dot(direction, lunarUp)) / 0.025;
  float radius2 = dot(uv, uv);
  float edge = 1.0 - smoothstep(0.96, 1.0, radius2);
  vec3 normal = vec3(uv, sqrt(max(0.0, 1.0 - radius2)));
  float lighting = 0.4 + 0.6 * max(dot(normal, normalize(vec3(-0.35, 0.25, 1.0))), 0.0);
  vec3 lunarColor = vec3(0.92, 0.94, 1.0) * moonSurface(uv) * lighting;
  skyColor = mix(skyColor, lunarColor, edge * moonVisibility);
}

// A wind-advected cloud layer: perspective compression at the horizon,
// multiple noise scales for soft edges, and sun-facing silver highlights.
if (direction.y > 0.0 && cloudCover > 0.0) {
  vec2 uv = direction.xz / (direction.y + 0.14) * 2.2 + cloudOffset;
  float shape = cloudFbm(uv);
  float threshold = mix(0.72, 0.25, cloudCover);
  float density = smoothstep(threshold, threshold + 0.20, shape);
  float detail = skyNoise(uv * 11.0);
  density *= 0.87 + 0.13 * detail;
  float lightSample = cloudFbm(uv + vec2(-0.17, 0.23));
  float lighting = clamp(0.6 + (shape - lightSample) * 3.5, 0.0, 1.0);
  vec3 clouds = mix(cloudShadow, cloudLight, lighting);
  clouds += cloudLight * pow(max(cosTheta, 0.0), 12.0) * (1.0 - density) * 0.32;
  float opacity = density * smoothstep(0.0, 0.075, direction.y);
  // Thin clouds transmit a little light around the sun and moon.
  skyColor = mix(skyColor, clouds, opacity * 0.96);
}
skyColor = mix(skyColor, groundColor, smoothstep(0.0, 0.45, -direction.y));
gl_FragColor = vec4(applyWeatherSky(skyColor,direction), 1.0);
`;

export function createWeatherSky() {
  const sky = new Sky(), material = sky.material, uniforms = material.uniforms;
  material.depthTest = false;
  material.toneMapped = false;
  Object.assign(uniforms, {
    ...weatherUniforms(),
    skyExposure: { value: .18 }, nightBlend: { value: 0 }, dayBlend: { value: 0 },
    nightTop: { value: new Color() }, nightHorizon: { value: new Color() }, groundColor: { value: new Color() },
    cloudOffset: { value: new Vector2(3.4, 8.1) }, cloudCover: { value: .6 },
    cloudLight: { value: new Color() }, cloudShadow: { value: new Color() },
  });
  uniforms.turbidity.value = 2.5;
  uniforms.rayleigh.value = 2.5;
  uniforms.mieCoefficient.value = .005;
  uniforms.mieDirectionalG.value = .8;
  // The original solar disc is only ~0.5 degrees; enlarge it for this visual
  // simulator so it remains legible on a laptop or phone (not astronomy scale).
  material.fragmentShader = (weatherAtmosphere + weatherFunctions + material.fragmentShader)
    .replace('0.999956676946448443553574619906976478926848692873900859324', '0.99982')
    .replace('gl_FragColor = vec4( retColor, 1.0 );', weatherComposite);
  sky.name = 'Sky with moving clouds, sun and moon';
  sky.frustumCulled = false; sky.renderOrder = -1000; sky.matrixAutoUpdate = false;
  const center = new Vector3(), scale = new Vector3(), rotation = new Quaternion();
  sky.onBeforeRender = (_renderer, _scene, camera) => {
    camera.getWorldPosition(center);
    scale.setScalar(camera.far * .9);
    sky.matrixWorld.compose(center, rotation, scale);
  };
  const white = new Color('#ffffff'), dayShadow = new Color('#7e9ebd');
  const nightLight = new Color('#697b9a'), nightShadow = new Color('#17273e');
  return {
    mesh: sky,
    setWeather(state){updateWeatherUniforms(uniforms,state);},
    setDay(state) {
      const elevation = state.sunDirection.y;
      const night = 1 - MathUtils.smoothstep(elevation, -.18, -.015);
      const day = MathUtils.smoothstep(elevation, 0, .4);
      uniforms.sunPosition.value.copy(state.sunDirection).multiplyScalar(450000);
      uniforms.skyExposure.value = MathUtils.lerp(.65, .18, MathUtils.smoothstep(elevation, 0, .35));
      uniforms.nightBlend.value = night; uniforms.dayBlend.value = day;
      uniforms.nightTop.value.copy(state.top); uniforms.nightHorizon.value.copy(state.horizon);
      uniforms.groundColor.value.copy(state.bottom);
      uniforms.cloudLight.value.copy(state.sunColor).lerp(white, day).lerp(nightLight, night);
      uniforms.cloudShadow.value.copy(state.horizon).multiplyScalar(.45).lerp(dayShadow, day).lerp(nightShadow, night);
    },
    update(dt, coverage, speed, angle=.34) {
      uniforms.cloudCover.value = coverage;
      uniforms.cloudOffset.value.x += dt * speed * Math.cos(angle) * .048;
      uniforms.cloudOffset.value.y += dt * speed * Math.sin(angle) * .048;
    },
    dispose() { sky.removeFromParent(); sky.geometry.dispose(); material.dispose(); },
  };
}
