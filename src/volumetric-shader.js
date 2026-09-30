import { CloudVolumeShader, FinalCompositorShader } from './vendor/leoawen/shaders.js';
import { weatherAtmosphere } from './weather-atmosphere.js';

// Reuse the upstream density model and atmosphere integrator. Deferred scene
// depth and temporal reprojection are intentionally replaced by a sky-only pass.
const cloudSource = CloudVolumeShader.fragmentShader;
const atmosphereSource = FinalCompositorShader.fragmentShader;
const declarations = new Map();
for (const source of [cloudSource, atmosphereSource]) {
  for (const match of source.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)) declarations.set(match[1], match[0]);
}
let cloudFunctions = cloudSource.slice(cloudSource.indexOf('float remap('), cloudSource.indexOf('void main()'));
cloudFunctions = cloudFunctions
  .replace('(maxOld - minOld)', 'max(0.0001, maxOld - minOld)')
  .replace('smoothstep(0.0, uFadeCovBottom, heightPercent)', 'smoothstep(0.0, max(0.001, uFadeCovBottom), heightPercent)');
const atmosphereFunctions = atmosphereSource.slice(atmosphereSource.indexOf('vec3 getLightTransmittance('), atmosphereSource.indexOf('vec3 getWorldPosition('));
const solarDisc = atmosphereSource.slice(atmosphereSource.indexOf('vec3 GetSunDisc('), atmosphereSource.indexOf('void main()'));

export const volumetricFragment = /* glsl */ `
precision highp sampler3D;
varying vec2 vUv;
#define PI 3.14159265359
${[...declarations.values()].join('\n')}
uniform float uNight, uRaySteps;
uniform vec3 uNightTop, uNightHorizon, uGround;
${cloudFunctions}
${atmosphereFunctions}
${solarDisc}
${weatherAtmosphere}
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


vec4 marchClouds(vec3 ro, vec3 rd, out float cloudDepth) {
  cloudDepth = 1e8;
  if (uCoverage <= 0.0) return vec4(0.0);
  float rBase = uPlanetRadius + uCloudBaseOffset;
  vec2 outer = hitSphere(ro, rd, uPlanetCenter, rBase + uCloudHeight);
  vec2 inner = hitSphere(ro, rd, uPlanetCenter, rBase);
  vec2 planet = hitSphere(ro, rd, uPlanetCenter, uPlanetRadius);
  if (outer.y <= 0.0) return vec4(0.0);
  float tNear = max(0.0, outer.x), tFar = outer.y;
  if (length(ro - uPlanetCenter) < rBase) tNear = max(tNear, inner.y);
  if (planet.x > 0.0) tFar = min(tFar, planet.x);
  tFar = min(tFar, tNear + uMaxDistance);
  if (tFar <= tNear) return vec4(0.0);
  float stepSize = max(70.0, (tFar - tNear) / uRaySteps);
  // Static screen-space jitter avoids shimmer and does not need TAA history
  // shared between incompatible main/monitoring camera projections.
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float t = tNear + stepSize * jitter;
  vec4 cloud = vec4(0.0);
  float weightedDepth = 0.0;
  vec3 lightDirection = uNight > 0.5 ? -uSunDirection : uSunDirection;
  float phase = phaseFunction(dot(rd, lightDirection));
  for (int i = 0; i < 112; i++) {
    if (float(i) >= uRaySteps || t >= tFar || cloud.a > 0.995) break;
    vec3 pos = ro + rd * t;
    float density = smoothstep(uThreshold, uThreshold + uEdgeSoftness, sampleCloud(pos));
    if (density > 0.001) {
      float shadow = max(0.0, sampleCloud(pos + lightDirection * uShadowOffset));
      shadow += max(0.0, sampleCloud(pos + lightDirection * uShadowOffset * 2.5)) * .65;
      shadow += max(0.0, sampleCloud(pos + lightDirection * uShadowOffset * 5.0)) * .35;
      float beer = exp(-shadow * uAbsorp);
      float powder = 1.0 - exp(-shadow * uPowderScale * 2.0);
      float illumination = beer * mix(1.0, powder * 2.0 + 1.0, uPowderIntensity);
      vec3 sun = getSunColorAtPoint(pos, uSunDirection);
      vec3 moon = vec3(0.24, 0.31, 0.48) * uNight;
      vec3 direct = (sun + moon) * illumination * phase * uPhaseIntensity;
      float height = clamp((length(pos - uPlanetCenter) - rBase) / uCloudHeight, 0.0, 1.0);
      float day = smoothstep(-0.1, 0.1, uSunDirection.y);
      vec3 ambient = mix(vec3(0.014, 0.022, 0.04), mix(vec3(0.10, 0.16, 0.24), vec3(0.30, 0.40, 0.55), height), day);
      float alpha = 1.0 - exp(-density * uDensityScale * stepSize * 0.001);
      float contribution = alpha * (1.0 - cloud.a);
      cloud.rgb += (direct + ambient) * contribution;
      weightedDepth += t * contribution;
      cloud.a += contribution;
    }
    t += stepSize;
  }
  if (cloud.a > 0.001) cloudDepth = weightedDepth / cloud.a;
  return cloud;
}

void main() {
  vec4 viewRay = uInverseProjectionMatrix * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize((uInverseViewMatrix * vec4(viewRay.xyz, 0.0)).xyz);
  vec3 ro = uCameraPos;
  vec3 transmittance;
  // The source draws a solid planet below the horizon. This local adapter has
  // no planet mesh; extend the horizon color down to the ground instead of
  // revealing a black band from a metre-long atmospheric ray into the planet.
  vec3 atmosphereRay = normalize(vec3(rd.x, max(rd.y, .004), rd.z));
  vec3 sky = GetAtmosphere(ro, atmosphereRay, 1e9, 1.0, transmittance);
  vec3 physicalSun = getLightTransmittance(ro, uSunDirection) * uSunIntensity;
  if (uSunDirection.y > -0.015) sky += GetSunDisc(rd, uSunDirection, physicalSun);
  vec3 nightSky = mix(uNightHorizon, uNightTop, pow(max(rd.y, 0.0), 0.5));
  sky = mix(sky, nightSky, uNight);
  vec3 moonDirection = -uSunDirection;
  float moonDot = dot(rd, moonDirection);
  if (uNight > 0.01) {
    sky += vec3(0.06, 0.10, 0.18) * pow(max(moonDot, 0.0), 650.0) * uNight;
    if (moonDot > 0.9994) {
      vec3 right = normalize(cross(vec3(0,0,1), moonDirection));
      vec2 uv = vec2(dot(rd,right),dot(rd,cross(moonDirection,right))) / 0.025;
      float r2 = dot(uv,uv);
      vec3 normal = vec3(uv,sqrt(max(0.0,1.0-r2)));
      float light = 0.4 + 0.6 * max(dot(normal,normalize(vec3(-.35,.25,1))),0.0);
      vec3 lunar = vec3(.92,.94,1) * moonSurface(uv) * light;
      sky = mix(sky, lunar, (1.0-smoothstep(.96,1.0,r2))*uNight);
    }
  }
  float cloudDepth;
  vec4 clouds = marchClouds(ro,rd,cloudDepth);
  if (clouds.a > 0.001) {
    vec3 cloudTransmittance;
    vec3 cloudFog = GetAtmosphere(ro,rd,cloudDepth,1.0,cloudTransmittance);
    // Atmospheric fog is computed in linear HDR, before tone mapping.
    sky = sky * (1.0-clouds.a) + clouds.rgb * cloudTransmittance + cloudFog * clouds.a;
  }
  sky = mix(sky,uGround,smoothstep(0.0,.3,-rd.y));
  sky = max(vec3(0.0),sky*uExposure);
  sky = clamp((sky*(2.51*sky+.03))/(sky*(2.43*sky+.59)+.14),0.0,1.0);
  gl_FragColor = vec4(applyWeatherSky(sky,rd),1.0);
}
`;
