/*! Volumetric Clouds & Atmosphere — Copyright (c) 2026 Leonardo Soares Gonçalves.
 * MIT License. Full notice: third-party/leoawen-volumetric-clouds-LICENSE.txt.
 * Source and pinned revision: src/vendor/leoawen/SOURCE.md. */
export const CloudGeneratorShader = {
            vertexShader: /* glsl */ `
                #include <common>
                #include <logdepthbuf_pars_vertex>
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    #include <logdepthbuf_vertex>
                }
            `,
            fragmentShader: /* glsl */ `
                precision highp float;
                #include <common>
                #include <logdepthbuf_pars_fragment>

                varying vec2 vUv;
                
                uniform float uSliceZ; // Current Bake Slice (0 to 1)
                
                // --- LAYER 1 PARAMETERS (PERLIN - GENERAL SHAPE) ---
                uniform float uRepeat1; 
                uniform float uScale1;  
                uniform float uSeed1;
                
                // --- LAYER 2 PARAMETERS (WORLEY - "POPCORN" STRUCTURE) ---
                uniform float uRepeat2;
                uniform float uScale2;
                uniform float uSeed2;

                uniform float uMixStrength; // Strength of "popcorn" over base
                
                uniform float uContrast;   
                uniform float uErosion;    

                // --- Noise Functions ---

                // Random Hash 3D
                vec3 hash33(vec3 p) {
                    p = vec3( dot(p,vec3(127.1,311.7, 74.7)),
                            dot(p,vec3(269.5,183.3,246.1)),
                            dot(p,vec3(113.5,271.9,124.6)));
                    return -1.0 + 2.0*fract(sin(p)*43758.5453123);
                }

                // Hash for Worley (0..1)
                vec3 hash33_worley(vec3 p) {
                    p = vec3( dot(p,vec3(127.1,311.7, 74.7)),
                              dot(p,vec3(269.5,183.3,246.1)),
                              dot(p,vec3(113.5,271.9,124.6)));
                    return fract(sin(p)*43758.5453123);
                }

                // Periodic Perlin Noise (Smooth, smoke-like)
                float periodicNoise(vec3 p, float period) {
                    vec3 pi = floor(p);
                    vec3 pf = fract(p);
                    vec3 w = pf * pf * (3.0 - 2.0 * pf);
                    
                    vec3 p0 = mod(pi, period);
                    vec3 p1 = mod(pi + vec3(1.0), period);
                    
                    float n000 = dot(hash33(vec3(p0.x, p0.y, p0.z)), pf - vec3(0.0, 0.0, 0.0));
                    float n100 = dot(hash33(vec3(p1.x, p0.y, p0.z)), pf - vec3(1.0, 0.0, 0.0));
                    float n010 = dot(hash33(vec3(p0.x, p1.y, p0.z)), pf - vec3(0.0, 1.0, 0.0));
                    float n110 = dot(hash33(vec3(p1.x, p1.y, p0.z)), pf - vec3(1.0, 1.0, 0.0));
                    float n001 = dot(hash33(vec3(p0.x, p0.y, p1.z)), pf - vec3(0.0, 0.0, 1.0));
                    float n101 = dot(hash33(vec3(p1.x, p0.y, p1.z)), pf - vec3(1.0, 0.0, 1.0));
                    float n011 = dot(hash33(vec3(p0.x, p1.y, p1.z)), pf - vec3(0.0, 1.0, 1.0));
                    float n111 = dot(hash33(vec3(p1.x, p1.y, p1.z)), pf - vec3(1.0, 1.0, 1.0));
                    
                    return mix(mix(mix(n000, n100, w.x), mix(n010, n110, w.x), w.y),
                            mix(mix(n001, n101, w.x), mix(n011, n111, w.x), w.y), w.z);
                }

                // FBM Perlin (Accumulates octaves)
                float fbmPerlin(vec3 p, float repeat, float scale) {
                    float f = 0.0;
                    float amp = 0.5;
                    float currentPeriod = repeat * scale;
                    vec3 currentPos = p * scale;
                    
                    for(int i = 0; i < 4; i++) { 
                        f += amp * periodicNoise(currentPos, currentPeriod);
                        currentPos *= 2.0; 
                        currentPeriod *= 2.0; 
                        amp *= 0.5;
                    }
                    return f + 0.5; // Normalize 0..1
                }

                // Periodic Worley Noise (Cellular/Bubbles)
                // Returns 1.0 at cell center, 0.0 at edge
                float worleyNoise(vec3 p, float period) {
                    vec3 id = floor(p);
                    vec3 f = fract(p);
                    float minDist = 1.0;
                    
                    for(int x = -1; x <= 1; x++) {
                        for(int y = -1; y <= 1; y++) {
                            for(int z = -1; z <= 1; z++) {
                                vec3 neighbor = vec3(float(x), float(y), float(z));
                                vec3 tileId = mod(id + neighbor, period); // Perfect Tiling
                                vec3 point = hash33_worley(tileId + vec3(uSeed2 * 10.0)); // Layer 2 Seed
                                
                                vec3 diff = neighbor + point - f;
                                float dist = length(diff);
                                minDist = min(minDist, dist);
                            }
                        }
                    }
                    // Invert to get "Bubbles" (Billowy)
                    return 1.0 - clamp(minDist, 0.0, 1.0);
                }

                // FBM Worley (Accumulates bubbles of different sizes)
                float fbmWorley(vec3 p, float repeat, float scale) {
                    float f = 0.0;
                    float amp = 0.5; // Weight of larger bubble
                    float currentPeriod = repeat * scale;
                    vec3 currentPos = p * scale;
                    
                    // 3 Octaves of Worley are enough for structure
                    for(int i = 0; i < 3; i++) {
                        f += amp * worleyNoise(currentPos, currentPeriod);
                        currentPos *= 2.0; 
                        currentPeriod *= 2.0;
                        amp *= 0.5;
                    }
                    // Worley accumulates high values, normalize slightly
                    return f * 0.8; 
                }

                // Remap Function (Essential for mixing Perlin and Worley)
                // Remaps value 'v' from range 'minOld-maxOld' to 'minNew-maxNew'
                float remap(float v, float minOld, float maxOld, float minNew, float maxNew) {
                    return minNew + (v - minOld) * (maxNew - minNew) / (maxOld - minOld);
                }

                void main() {
                    #include <logdepthbuf_fragment>

                    vec2 uv = vUv;
                    
                    // --- GENERATION LAYER 1 (BASE PERLIN) ---
                    // Defines general "smoke" shape
                    vec3 pos1 = vec3(uv.x, uSliceZ, uv.y) * uRepeat1;
                    float baseCloud = fbmPerlin(pos1 + vec3(uSeed1*10.0), uRepeat1, uScale1);
                    
                    // --- GENERATION LAYER 2 (WORLEY STRUCTURE) ---
                    // Defines "blobs" inside cloud
                    vec3 pos2 = vec3(uv.x, uSliceZ, uv.y) * uRepeat2;
                    float structure = fbmWorley(pos2, uRepeat2, uScale2);
                    
                    // --- MIX ---
                    // Base defines WHERE cloud is. Worley sculpts the shape.
                    // If uMixStrength is high, clouds are very "bubbly".
                    // If low, they are smoother.
                    
                    float finalNoise = mix(baseCloud, structure, uMixStrength);
                    
                    // --- EROSION AND CONTRAST ---
                    float f = mix(finalNoise, finalNoise * finalNoise, uErosion);
                    
                    // Apply Contrast (Sponge)
                    float cloudDensity = (uContrast * (f - 0.5)) + 0.5;
                    
                    float visible = clamp(cloudDensity, 0.0, 1.0); 
                    gl_FragColor = vec4(visible, visible, visible, 1.0);
                }
            `
        };

export const DetailGeneratorShader = {
            vertexShader: /* glsl */ `
                #include <common>
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                precision highp float;
                varying vec2 vUv;

                // Current slice of 3D volume (0.0 to 1.0)
                uniform float uSliceZ;
                
                // Repetition settings for each channel (LOD)
                uniform float uScaleR; // Base scale (e.g., 4.0)
                uniform float uScaleG; // Medium scale (e.g., 8.0)
                uniform float uScaleB; // Fine scale (e.g., 16.0)
                
                uniform float uSeed;

                // --- Hash Function for Randomness (vec3 -> vec3) ---
                vec3 hash33(vec3 p) {
                    p = vec3( dot(p,vec3(127.1,311.7, 74.7)),
                              dot(p,vec3(269.5,183.3,246.1)),
                              dot(p,vec3(113.5,271.9,124.6)));
                    return fract(sin(p)*43758.5453123);
                }

                // --- Periodic Worley Noise (Tileable) ---
                // Calculates distance to nearest random point in grid
                // Returns: 1.0 - distance (to create convex spheres/popcorn)
                float worleyNoise(vec3 uv, float freq) {
                    vec3 id = floor(uv);
                    vec3 f = fract(uv);
                    
                    float minDist = 1.0;
                    
                    // Search neighbors (3x3x3)
                    for(int x = -1; x <= 1; x++) {
                        for(int y = -1; y <= 1; y++) {
                            for(int z = -1; z <= 1; z++) {
                                vec3 neighbor = vec3(float(x), float(y), float(z));
                                
                                // Tiling secret (Seamless repetition):
                                // Use 'mod' to connect right edge to left edge
                                vec3 tileId = mod(id + neighbor, freq);
                                
                                vec3 point = hash33(tileId + vec3(uSeed)); // Random point in cell
                                
                                // Optional animation (zero if static bake desired)
                                // point = 0.5 + 0.5 * sin(uSeed + 6.2831 * point); 
                                
                                vec3 diff = neighbor + point - f;
                                float dist = length(diff);
                                
                                minDist = min(minDist, dist);
                            }
                        }
                    }
                    
                    // Invert (1.0 - dist) to have white centers (convex)
                    // Crucial for "Popcorn/Billowy" effect
                    return 1.0 - clamp(minDist, 0.0, 1.0);
                }

                // Simplified FBM for Worley (direct sampling per channel for control)
                
                void main() {
                    // 3D Coordinate based on UV and Z Slice
                    vec3 pos = vec3(vUv.x, uSliceZ, vUv.y);
                    
                    // --- CHANNEL R (Coarse Detail) ---
                    // Multiply pos by scale to define frequency
                    float r = worleyNoise(pos * uScaleR, uScaleR);
                    
                    // --- CHANNEL G (Medium Detail) ---
                    float g = worleyNoise(pos * uScaleG, uScaleG);
                    
                    // --- CHANNEL B (Fine Detail) ---
                    float b = worleyNoise(pos * uScaleB, uScaleB);
                    
                    // Write 3 detail levels to RGB channels
                    gl_FragColor = vec4(r, g, b, 1.0);
                }
            `
        };

export const WeatherGeneratorShader = {
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                precision highp float;
                varying vec2 vUv;

                // Channel R Uniforms (Coverage)
                uniform float uScaleR;
                uniform float uSeedR;
                uniform float uPersistR;
                uniform vec2 uOffsetR;

                // Channel G Uniforms (Type)
                uniform float uScaleG;
                uniform float uSeedG;
                uniform float uPersistG;
                uniform vec2 uOffsetG;

                // --- Noise Functions ---
                vec3 hash33(vec3 p) {
                    p = vec3( dot(p,vec3(127.1,311.7, 74.7)),
                              dot(p,vec3(269.5,183.3,246.1)),
                              dot(p,vec3(113.5,271.9,124.6)));
                    return -1.0 + 2.0*fract(sin(p)*43758.5453123);
                }

                float periodicNoise(vec3 p, float period) {
                    vec3 pi = floor(p);
                    vec3 pf = fract(p);
                    vec3 w = pf * pf * (3.0 - 2.0 * pf);
                    
                    // Modulo ensures tiling (seamless repetition)
                    vec3 p0 = mod(pi, period);
                    vec3 p1 = mod(pi + vec3(1.0), period);
                    
                    float n000 = dot(hash33(vec3(p0.x, p0.y, p0.z)), pf - vec3(0.0, 0.0, 0.0));
                    float n100 = dot(hash33(vec3(p1.x, p0.y, p0.z)), pf - vec3(1.0, 0.0, 0.0));
                    float n010 = dot(hash33(vec3(p0.x, p1.y, p0.z)), pf - vec3(0.0, 1.0, 0.0));
                    float n110 = dot(hash33(vec3(p1.x, p1.y, p0.z)), pf - vec3(1.0, 1.0, 0.0));
                    
                    float n001 = dot(hash33(vec3(p0.x, p0.y, p1.z)), pf - vec3(0.0, 0.0, 1.0));
                    float n101 = dot(hash33(vec3(p1.x, p0.y, p1.z)), pf - vec3(1.0, 0.0, 1.0));
                    float n011 = dot(hash33(vec3(p0.x, p1.y, p1.z)), pf - vec3(0.0, 1.0, 1.0));
                    float n111 = dot(hash33(vec3(p1.x, p1.y, p1.z)), pf - vec3(1.0, 1.0, 1.0));
                    
                    return mix(mix(mix(n000, n100, w.x), mix(n010, n110, w.x), w.y),
                               mix(mix(n001, n101, w.x), mix(n011, n111, w.x), w.y), w.z);
                }

                // Custom 2D FBM (using Z as seed offset)
                float fbm(vec2 uv, float scale, float seed, float persistence, vec2 offset) {
                    float f = 0.0;
                    float amp = 0.5;
                    float currentScale = scale;
                    vec3 pos = vec3(uv, seed); // Use Z as "Temporal Seed"
                    
                    // Accumulate noise (Octaves)
                    for(int i = 0; i < 4; i++) {
                        // Offset animates noise if needed
                        vec3 samplePos = (pos + vec3(offset, 0.0)) * currentScale;
                        
                        // Call 3D periodic noise, varying only X and Y
                        f += amp * periodicNoise(samplePos, currentScale);
                        
                        samplePos *= 2.0;
                        currentScale *= 2.0;
                        amp *= persistence; // Controls roughness
                    }
                    // Normalize -1..1 to 0..1
                    return f + 0.5;
                }

                void main() {
                    vec2 uv = vUv;
                    
                    // --- CHANNEL R (COVERAGE) ---
                    float cov = fbm(uv, uScaleR, uSeedR, uPersistR, uOffsetR);
                    // Increase contrast to better define areas
                    cov = smoothstep(0.2, 0.8, cov); 

                    // --- CHANNEL G (TYPE/HEIGHT) ---
                    float type = fbm(uv, uScaleG, uSeedG, uPersistG, uOffsetG);
                    
                    gl_FragColor = vec4(cov, type, 0.0, 1.0);
                }
            `
        };

export const CloudVolumeShader = {
            vertexShader: /* glsl */ `
                out vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                precision highp float;
                precision highp sampler3D;

                layout(location = 0) out vec4 pc_FragColor; 
                layout(location = 1) out vec4 pc_FragDepth; 

                varying vec2 vUv;

                // --- GENERAL UNIFORMS ---
                uniform mat4 uInverseViewMatrix;
                uniform mat4 uInverseProjectionMatrix;
                uniform vec3 uCameraPos;
                uniform sampler2D tDepth; 
                uniform float uLogDepthBufFC;
                
                // --- TEXTURES ---
                uniform sampler2D tBlueNoise;   
                uniform vec2 uBlueNoiseOffset;             
                uniform sampler3D uTexture;       
                uniform sampler3D uDetailTexture; 
                uniform sampler2D tWeatherMap;
                uniform vec3 uWindOffset;
                
                // --- ENVIRONMENT ---
                uniform vec3 uSunDirection;     
                uniform float uSunIntensity;    
                uniform vec3 uPlanetCenter; 
                uniform float uPlanetRadius;
                uniform float uAtmosphereRadius;
                uniform vec3 uRayleighCoeff;
                uniform vec3 uMieCoeff;
                uniform float uRayleighScaleHeight;
                
                // --- CLOUD CONTROLS ---
                uniform float uCloudBaseOffset;
                uniform float uCloudHeight;
                uniform float uDensityScale;
                uniform float uAbsorp;
                uniform float uThreshold;

                // Uniform for Shadow Offset
                uniform float uShadowOffset;
                
                // Edge Softness Envelope
                uniform float uEdgeSoftness; 

                uniform float uCloudScale;         
                uniform float uGlobalScaleFactor;
                
                // EROSION
                uniform float uDetailScale;        
                uniform float uErosionStrength;    
                uniform float uLodDistance;        
                uniform bool uPopcornMode;

                // --- BASE LOD SYSTEM UNIFORMS ---
                uniform float uBaseLodMinDist;
                uniform float uBaseLodMaxDist;
                uniform float uBaseLodMaxLevel;

                // VISUALS
                uniform float uSkylightAbsorption;
                uniform float uPowderScale;
                uniform float uPowderIntensity;
                uniform float uPhaseIntensity;
                uniform float uPhaseG;
                uniform float uOpacityClamp;
                
                uniform float uCoverage;
                uniform float uCovBottomShape;
                uniform float uCovBottomCurve;
                uniform float uCovTopShape;
                uniform float uCloudBottom;
                uniform float uCloudTop;
                uniform float uFadeCovBottom;
                uniform float uFadeCovStart;
                uniform float uFadeCovEnd;
                
                uniform bool uWeatherEnabled;
                uniform vec2 uWeatherOffset;
                uniform float uWeatherRepeat;
                uniform float uWeatherPoleTilt;
                uniform float uWeatherPoleMask;
                uniform bool uWeatherGEnabled;
                uniform float uWeatherHeightMax;
                uniform float uWeatherHeightCurve;

                // OPTIMIZATION
                uniform float uSteps;           
                uniform float uMaxIterations;   
                uniform float uInitialStep;     
                uniform float uStepGrowth;      
                uniform float uSpaceSkipRatio;  
                uniform float uMaxDistance;     
                
                uniform sampler2D tPreviousCloud;
                uniform mat4 uPreviousViewProjectionMatrix;
                uniform float uBlendFactor;
                uniform float uGhostingSuppression;
                uniform float uGhostingDistanceCutoff;
                uniform float uFrame;

                // --- HELPER FUNCTIONS ---
                
                float remap(float v, float minOld, float maxOld, float minNew, float maxNew) {
                    return minNew + (v - minOld) * (maxNew - minNew) / (maxOld - minOld);
                }

                vec3 rotateX(vec3 v, float angle) {
                    float s = sin(angle); float c = cos(angle);
                    return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
                }

                float getLinearDepth(float fragCoordZ) {
                    float viewZ = -1.0 * (exp2(fragCoordZ / (uLogDepthBufFC * 0.5)) - 1.0);
                    return viewZ;
                }

                // Ray-Sphere Intersection
                vec2 hitSphere(vec3 orig, vec3 dir, vec3 center, float radius) {
                    vec3 oc = orig - center;
                    float b = dot(oc, dir);
                    float c = dot(oc, oc) - radius * radius;
                    float h = b * b - c;
                    if (h < 0.0) return vec2(-1.0);
                    h = sqrt(h);
                    return vec2(-b - h, -b + h);
                }

                // Henyey-Greenstein Phase Function
                float hg(float g, float cosTheta) {
                    float g2 = g * g;
                    return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
                }

                // Dual Phase Function (Forward + Backward scattering)
                float phaseFunction(float cosTheta) {
                    return mix(hg(uPhaseG, cosTheta), hg(-0.2, cosTheta), 0.5);
                }

                // Calculates Sunlight Color reaching a point inside the atmosphere
                vec3 getSunColorAtPoint(vec3 pointPos, vec3 sunDir) {
                    vec2 planetHit = hitSphere(pointPos, sunDir, uPlanetCenter, uPlanetRadius * 0.995);
                    if (planetHit.x > 0.0) return vec3(0.0); // Blocked by planet

                    float altitude = length(pointPos - uPlanetCenter) - uPlanetRadius;
                    vec3 up = normalize(pointPos - uPlanetCenter);
                    float rawCos = dot(up, sunDir);
                    float cosTheta = clamp(rawCos, -1.0, 1.0);
                    if (cosTheta < -0.1) return vec3(0.0); 

                    // Air Mass approximation
                    float airMass = 1.0 / (max(cosTheta, 0.05) + 0.15 * pow(93.885 - acos(max(cosTheta, 0.0)) * 57.29, -1.253));
                    float density = exp(-altitude / uRayleighScaleHeight);
                    vec3 scattering = (uRayleighCoeff * 1.5 + uMieCoeff * 0.5) * airMass * density;
                    vec3 transmittance = exp(-scattering * 15000.0); 

                    return transmittance * uSunIntensity;
                }

                // --- [CRITICAL] CLOUD SAMPLING FUNCTION WITH SOFT EDGE ---
                // Returns density (0.0 to 1.0)
                float sampleCloud(vec3 p) {
                    float distToCenter = length(p - uPlanetCenter);
                    float altitude = distToCenter - uPlanetRadius;
                    
                    if(altitude < uCloudBaseOffset || altitude > (uCloudBaseOffset + uCloudHeight)) return 0.0;

                    // 1. WEATHER DATA
                    vec4 weatherData = vec4(1.0, 0.0, 0.0, 0.0); 
                    float polarMask = 1.0; 

                    if (uWeatherEnabled) {
                        vec3 dir = (p - uPlanetCenter) / distToCenter;
                        vec3 dirRotated = rotateX(dir, uWeatherPoleTilt);
                        float u = (atan(dirRotated.z, dirRotated.x) / (2.0 * 3.14159)) + 0.5;
                        float v = (asin(dirRotated.y) / 3.14159) + 0.5;
                        vec2 uv = vec2(u, v);
                        vec2 finalUV = (uv * uWeatherRepeat) + uWeatherOffset;
                        weatherData = texture2D(tWeatherMap, finalUV);
                        float poleProximity = abs(dirRotated.y);
                        polarMask = 1.0 - smoothstep(1.0 - uWeatherPoleMask, 1.0, poleProximity);
                    }

                    float mapCoverage = smoothstep(0.2, 0.8, weatherData.r) * polarMask;
                    if (mapCoverage <= 0.01) return 0.0;

                    // Dynamic Height Calculation
                    float heightModulator = pow(mapCoverage, uWeatherHeightCurve);
                    float localCloudHeight = uWeatherHeightMax * heightModulator;
                    float heightPercent = (altitude - uCloudBaseOffset) / localCloudHeight;
                    if(heightPercent > 1.0) return 0.0;

                    // 2. BASE SHAPE
                    vec3 noiseCoord = ((p - uPlanetCenter) * (uGlobalScaleFactor * uCloudScale)) + uWindOffset;
                    
                    // --- [MANUAL LOD IMPLEMENTATION START] ---
                    // 1. Calculate real distance from point (p) to camera
                    float distToCam = distance(p, uCameraPos);

                    // 2. Calculate interpolation factor (0.0 = close, 1.0 = far)
                    // If distToCam < Min, lodFactor is 0. If > Max, it is 1.
                    float lodFactor = clamp((distToCam - uBaseLodMinDist) / (uBaseLodMaxDist - uBaseLodMinDist), 0.0, 1.0);

                    // 3. Define target Mipmap level
                    // Level 0 = Original Res (256), Level 4 = Low Res (16)
                    float targetLod = mix(0.0, uBaseLodMaxLevel, lodFactor);

                    // 4. Sample texture forcing specific LOD
                    // NOTE: textureLod only works if texture has mipmaps generated
                    float baseDensity = textureLod(uTexture, noiseCoord, targetLod).r;
                    // --- [MANUAL LOD IMPLEMENTATION END] ---

                    // 3. VERTICAL SHAPING AND COVERAGE
                    float mapType = weatherData.g; 
                    float localShapeBase = uCovBottomShape;
                    float localShapeTop = uCovTopShape;

                    if (uWeatherGEnabled) {
                        localShapeTop = mix(uCovTopShape, min(1.0, uCovTopShape + (mapType * 0.8)), mapType);
                        localShapeBase = mix(uCovBottomShape, uCovBottomShape + (mapType * 0.1), mapType); 
                    }

                    float shapeBottom = pow(smoothstep(0.0, localShapeBase, heightPercent), uCovBottomCurve);
                    float shapeTop = 1.0 - smoothstep(localShapeTop, 1.0, heightPercent);

                    // --- NEW DUAL FADE LOGIC (BASE AND TOP) ---
                    // 1. Fade In (Base): Increase coverage from 0 to 1
                    float fadeIn = smoothstep(0.0, uFadeCovBottom, heightPercent);                  
                    // 2. Fade Out (Top): Decrease coverage from 1 to 0
                    float fadeOut = 1.0 - smoothstep(uFadeCovStart, uFadeCovEnd, heightPercent);                   
                    // Combine: Cloud only exists where BOTH allow
                    float verticalFadeCov = fadeIn * fadeOut;
                    
                    float dynamicCoverage = (mapCoverage * uCoverage) * verticalFadeCov * shapeBottom * shapeTop;
                    
                    // --- SMART REMAP ---
                    // Instead of hard cutting, we remap the noise so coverage edge is 0.
                    float density = remap(baseDensity, 1.0 - dynamicCoverage, 1.0, 0.0, 1.0);
                    
                    // Optimization: If negative (outside cloud), exit early.
                    if (density <= 0.0) return 0.0;

                    // 4. DETAIL EROSION
                    // Apply erosion BEFORE final edge smoothing
                    if (density > 0.0) {
                        vec3 detailCoord = noiseCoord * uDetailScale;
                        float distCamera = distance(p, uCameraPos);
                        float lodFactor = clamp(distCamera / uLodDistance, 0.0, 1.0);

                        if (lodFactor < 1.0) {
                            vec3 detailNoise = texture(uDetailTexture, detailCoord).rgb;
                            float highFreqFBM = detailNoise.r * 0.625 + detailNoise.g * 0.25 + detailNoise.b * 0.125;
                            float erosionPattern = uPopcornMode ? (1.0 - highFreqFBM) : highFreqFBM;
                            float currentStrength = uErosionStrength * (1.0 - lodFactor);
                            
                            // Apply erosion remapping current density
                            density = remap(density, erosionPattern * currentStrength, 1.0, 0.0, 1.0);
                        }
                    }

                    // Final Vertical Fades (Hard clamp)
                    float bottomFade = smoothstep(0.0, uCloudBottom, heightPercent);
                    float topFade = 1.0 - smoothstep(uCloudTop, 1.0, heightPercent);
                    density *= bottomFade * topFade;

                    return density; // Returns raw density (can be > 0 but < threshold)
                }

                void main() {
                    vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0); 
                    vec4 clip = uInverseProjectionMatrix * ndc;
                    vec4 view = uInverseViewMatrix * (clip / clip.w);
                    vec3 worldDir = normalize(view.xyz - uCameraPos);

                    float depthLog = texture(tDepth, vUv).r; 
                    float geometryViewZ = abs(getLinearDepth(depthLog));
                    float geoDist = geometryViewZ / dot(worldDir, (uInverseViewMatrix * vec4(0.0, 0.0, -1.0, 0.0)).xyz);
                    if (depthLog >= 1.0) geoDist = 1e20;

                    vec3 ro = uCameraPos;
                    vec3 rd = worldDir;
                    
                    float rPlanet = uPlanetRadius;                    
                    float rBase   = uPlanetRadius + uCloudBaseOffset; 
                    float rTop    = rBase + uCloudHeight;             

                    // Sphere Intersections
                    vec2 hitOuter = hitSphere(ro, rd, uPlanetCenter, rTop);   
                    vec2 hitInner = hitSphere(ro, rd, uPlanetCenter, rBase);  
                    vec2 hitSolid = hitSphere(ro, rd, uPlanetCenter, rPlanet);

                    if (hitOuter.y < 0.0) { 
                        pc_FragColor = vec4(0.0);
                        pc_FragDepth = vec4(1e20, 0.0, 0.0, 1.0);
                        return;
                    }

                    float tNear = max(0.0, hitOuter.x);
                    float tFar  = hitOuter.y;
                    float distCam = length(ro - uPlanetCenter);

                    if (distCam < rBase) {
                        if (hitInner.y > 0.0) tNear = max(tNear, hitInner.y);
                    }
                    if (hitSolid.x > 0.0) tFar = min(tFar, hitSolid.x);
                    if (geoDist < tNear) {
                        pc_FragColor = vec4(0.0);
                        pc_FragDepth = vec4(geoDist, 0.0, 0.0, 1.0);
                        return;
                    }
                    tFar = min(tFar, geoDist);
                    tFar = min(tFar, tNear + uMaxDistance);

                    // Blue Noise (Dithering to reduce banding)
                    vec2 noiseUV = gl_FragCoord.xy / 256.0;
                    float noiseSliding = texture(tBlueNoise, noiseUV + uBlueNoiseOffset).r;
                    float noiseStatic = texture(tBlueNoise, noiseUV).r;

                    float t = tNear;
                    float currentStep = uInitialStep; 
                    
                    vec4 cloudColor = vec4(0.0);
                    
                    float sunDot = dot(rd, uSunDirection);
                    float phaseVal = phaseFunction(sunDot);
                    
                    float hitSteps = 0.0;
                    float weightedDepth = 0.0;
                    float totalAlpha = 0.0;

                    // --- RAYMARCHING LOOP ---
                    for(int i = 0; i < 1024; i++) {
                        if (float(i) >= uMaxIterations) break; 
                        if (t >= tFar) break;
                        
                        if (cloudColor.a >= uOpacityClamp) {
                            cloudColor.a = 1.0; 
                            break;       
                        }

                        // Jitter the step based on TAA state
                        float activeNoise = (t < uGhostingDistanceCutoff) ? noiseStatic : noiseSliding;
                        float sampleT = t + (currentStep * activeNoise);

                        if (sampleT >= tFar) break;

                        vec3 pos = ro + rd * sampleT;
                        float rawDens = sampleCloud(pos); 
                        
                        // --- [SOFT EDGE IMPLEMENTATION] ---
                        // Use smoothstep with variable width (uEdgeSoftness).
                        // If uEdgeSoftness is high, slow transition (smoke).
                        // uThreshold defines where noise starts counting as "cloud".
                        
                        float finalDens = smoothstep(uThreshold, uThreshold + uEdgeSoftness, rawDens);

                        // --- VOLUMETRIC LIGHTING LOGIC ---

                        if (finalDens > 0.001) {
                            
                            // 1. Shadows and Direct Lighting
                            float shadowOffset = max(currentStep, uShadowOffset); 
                            vec3 shadowPos = pos + uSunDirection * shadowOffset;
                            float shadowRaw = sampleCloud(shadowPos);
                            float shadowDens = shadowRaw; 
                            
                            // Beer's Law (Absorption)
                            float beerLaw = exp(-shadowDens * uAbsorp);
                            // Powder Effect (Darker edges looking at sun)
                            float powderTerm = 1.0 - exp(-shadowDens * uPowderScale * 2.0);
                            float illuminationDecay = beerLaw * mix(1.0, powderTerm * 2.0 + 1.0, uPowderIntensity);
                            
                            vec3 sunColorAtPoint = getSunColorAtPoint(pos, uSunDirection);
                            vec3 directLight = sunColorAtPoint * illuminationDecay * phaseVal * uPhaseIntensity;
                            
                            // --- [DAY/NIGHT CORRECTION] ---
                            vec3 pointUp = normalize(pos - uPlanetCenter);
                            float sunElevation = dot(pointUp, uSunDirection);
                            
                            // Gradient: 1.0 day, 0.0 deep night
                            float dayNightFactor = smoothstep(-0.1, 0.1, sunElevation);

                            // 2. Dynamic Ambient Lighting
                            float altFactor = clamp((length(pos - uPlanetCenter) - rBase) / uCloudHeight, 0.0, 1.0);
                            
                            // Base Gradient (Dark blue bottom, light top)
                            vec3 ambientBase = mix(vec3(0.0, 0.05, 0.15), vec3(0.1, 0.2, 0.4), altFactor);
                            
                            // Add minimum light for star/moon simulation
                            vec3 nightAmbient = vec3(0.002, 0.002, 0.005); 
                            vec3 finalAmbientColor = mix(nightAmbient, ambientBase, dayNightFactor);

                            float skyOcclusion = exp(-shadowDens * uSkylightAbsorption * 0.5);
                            vec3 internalScattering = vec3(1.0 + finalDens * 0.5); 
                            
                            vec3 ambientLight = finalAmbientColor * skyOcclusion * internalScattering * 0.8;
                            
                            // Light Sum
                            vec3 totalLight = directLight + ambientLight;
                            
                            // 3. Accumulation
                            float d = finalDens * uDensityScale * currentStep * 0.001;
                            float stepAlpha = 1.0 - exp(-d);

                            float stepContribution = stepAlpha * (1.0 - cloudColor.a);
                            
                            weightedDepth += sampleT * stepContribution;
                            totalAlpha += stepContribution;

                            cloudColor.rgb += totalLight * stepAlpha * (1.0 - cloudColor.a);
                            cloudColor.a += stepAlpha * (1.0 - cloudColor.a);
                            
                            t += currentStep;
                            hitSteps += 1.0;

                            // Quality Control: Stop if enough samples hit
                            if (hitSteps >= uSteps) break; 
                            
                        } else {
                            // Space Skipping (Jump empty space)
                            t += currentStep * uSpaceSkipRatio;
                        }
                        
                        // Geometric Step Growth (Optimization for planets)
                        currentStep *= uStepGrowth;
                        currentStep = min(currentStep, 3000.0); // Safety cap
                    }

                    vec4 currentColor = cloudColor;
                    float outputDepth = (totalAlpha > 0.01) ? (weightedDepth / totalAlpha) : geoDist;
                    
                    // --- TAA (TEMPORAL ANTI-ALIASING) REPROJECTION ---
                    float reprojDepth = (totalAlpha > 0.01) ? outputDepth : min(geoDist, tFar);
                    vec3 worldPos = uCameraPos + (rd * reprojDepth);
                    vec4 prevClip = uPreviousViewProjectionMatrix * vec4(worldPos, 1.0);
                    vec2 prevUv = (prevClip.xy / prevClip.w) * 0.5 + 0.5;
                    bool isInside = (prevUv.x > 0.0 && prevUv.x < 1.0 && prevUv.y > 0.0 && prevUv.y < 1.0);

                    if (isInside) {
                        vec4 history = texture(tPreviousCloud, prevUv);
                        float alphaDiff = abs(currentColor.a - history.a);
                        float distFactor = smoothstep(uGhostingDistanceCutoff, uGhostingDistanceCutoff * 2.0, reprojDepth);
                        float effectiveSuppression = mix(0.0001, uGhostingSuppression, distFactor);
                        float motionWeight = 1.0 - smoothstep(0.0, effectiveSuppression, alphaDiff);
                        float finalBlend = min(uBlendFactor, 0.97) * motionWeight;
                        
                        pc_FragColor = mix(currentColor, history, finalBlend);
                    } else {
                        pc_FragColor = currentColor;
                    }

                    pc_FragDepth = vec4(outputDepth, 0.0, 0.0, 1.0);
                }
            `
        };

export const FinalCompositorShader = {
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position, 1.0);
                }
            `,
            // Fragment Shader - Atmosphere logic with leak correction
            fragmentShader: /* glsl */ `
                precision highp float;

                // --- Inputs ---
                uniform sampler2D tScene;        
                uniform sampler2D tClouds;       
                uniform sampler2D tCloudDepth; 
                uniform sampler2D tDepth;
                uniform sampler2D tGodRays;
                uniform sampler2D tSunVisibility; // <--- THIS IS THE KEY (Result of 13-point sample)

                uniform float uLogDepthBufFC;
                uniform float uExposure;
                uniform vec3 uSunPhysicalColor; 
                uniform float uGodRaysIntensity;
                uniform mat4 uInverseProjectionMatrix;
                uniform mat4 uInverseViewMatrix;
                uniform vec3 uCameraPos;
                uniform vec3 uSunDirection;
                uniform float uSunIntensity; 
                uniform vec3 uRayleighCoeff;
                uniform vec3 uMieCoeff;
                uniform vec3 uOzoneCoeff;
                uniform float uAtmosphereRadius;
                uniform float uPlanetRadius;
                uniform vec3 uPlanetCenter;
                uniform float uRayleighScaleHeight; 
                uniform float uMieScaleHeight;

                varying vec2 vUv;
                #define PI 3.14159265359

                vec2 hitSphere(vec3 rayStart, vec3 rayDir, vec3 sphereCenter, float sphereRadius) {
                    vec3 oc = rayStart - sphereCenter;
                    float b = dot(oc, rayDir);
                    float c = dot(oc, oc) - (sphereRadius * sphereRadius);
                    float h = (b * b) - c;
                    if (h < 0.0) return vec2(-1.0);
                    h = sqrt(h);
                    return vec2(-b - h, -b + h);
                }
                
                vec3 getLightTransmittance(vec3 position, vec3 lightDir) {
                    float altitude = length(position - uPlanetCenter) - uPlanetRadius;
                    if (altitude > (uAtmosphereRadius - uPlanetRadius)) return vec3(1.0);

                    vec2 planetIntersect = hitSphere(position, lightDir, uPlanetCenter, uPlanetRadius - 100.0);
                    if (planetIntersect.x > 0.0) return vec3(0.0);

                    float rawCos = dot(normalize(position - uPlanetCenter), lightDir);
                    float cosTheta = clamp(rawCos, -1.0, 1.0);

                    float airMass = 1.0 / (max(cosTheta, 0.0) + 0.015 * pow(93.885 - acos(max(cosTheta, 0.0)) * 57.29, -1.253));
                    
                    float densR = exp(-max(0.0, altitude) / uRayleighScaleHeight); 
                    float densM = exp(-max(0.0, altitude) / uMieScaleHeight); 
                    float densO = max(0.0, 1.0 - abs(altitude - 25000.0) / 15000.0);
                    
                    vec3 opticalDepth = (uRayleighCoeff * densR * uRayleighScaleHeight + 
                                        uMieCoeff * densM * uMieScaleHeight + 
                                        uOzoneCoeff * densO * 15000.0) * airMass;
                                                
                    return exp(-opticalDepth);
                }

                // --- UPDATED Atmospheric Integration Function ---
                // Now receives 'sunVisibility' to control Mie scattering brightness
                vec3 GetAtmosphere(vec3 rayStart, vec3 rayDir, float rayLength, float sunVisibility, out vec3 totalTransmittance) {
                    vec2 atmosIntersection = hitSphere(rayStart, rayDir, uPlanetCenter, uAtmosphereRadius);
                    if (atmosIntersection.y < 0.0) { 
                        totalTransmittance = vec3(1.0); 
                        return vec3(0.0); 
                    }

                    float tMin = max(0.0, atmosIntersection.x);
                    float tMax = min(rayLength, atmosIntersection.y);
                    
                    vec2 planetIntersection = hitSphere(rayStart, rayDir, uPlanetCenter, uPlanetRadius);
                    if (planetIntersection.x > 0.0 && planetIntersection.x < tMax) {
                        tMax = planetIntersection.x;
                    }

                    if (tMax <= tMin) { 
                        totalTransmittance = vec3(1.0); 
                        return vec3(0.0); 
                    }

                    const int NUM_STEPS = 16;
                    float stepSize = (tMax - tMin) / float(NUM_STEPS);
                    float t = tMin + stepSize * 0.5;

                    vec3 totalScattering = vec3(0.0);
                    totalTransmittance = vec3(1.0);

                    float costh = dot(rayDir, uSunDirection);
                    float phaseR = (3.0 / (16.0 * PI)) * (1.0 + costh * costh);
                    float g = 0.85; 
                    float phaseM = (3.0 / (8.0 * PI)) * ((1.0 - g*g) * (1.0 + costh*costh)) / ((2.0 + g*g) * pow(1.0 + g*g - 2.0*g*costh, 1.5));

                    // Multiply Mie phase (bright halo) by sun visibility.
                    // If sun is hidden (sunVisibility ~ 0.0), phaseM becomes zero.
                    // This removes light "leaking" through mountains/terrain.
                    float activePhaseM = phaseM * sunVisibility;

                    for (int i = 0; i < NUM_STEPS; ++i) {
                        vec3 p = rayStart + rayDir * t;
                        float height = length(p - uPlanetCenter) - uPlanetRadius;
                        height = max(0.0, height);

                        float dR = exp(-height / uRayleighScaleHeight);
                        float dM = exp(-height / uMieScaleHeight);
                        float dO = max(0.0, 1.0 - abs(height - 25000.0) / 15000.0);
                        
                        vec3 sigmaExtinction = uRayleighCoeff * dR + uMieCoeff * dM * 1.1 + uOzoneCoeff * dO;
                        
                        // Use activePhaseM here instead of raw phaseM
                        vec3 sigmaScattering = uRayleighCoeff * dR * phaseR + uMieCoeff * dM * activePhaseM;
                        
                        vec3 stepTransmittance = exp(-sigmaExtinction * stepSize);
                        vec3 sunTransmittance = getLightTransmittance(p, uSunDirection);
                        
                        totalScattering += sigmaScattering * sunTransmittance * totalTransmittance * stepSize;
                        totalTransmittance *= stepTransmittance;
                        t += stepSize;
                    }
                    return totalScattering * uSunIntensity;
                }

                vec3 getWorldPosition(float depth, vec2 uv) {
                    float viewZ = -1.0 * (exp2(depth / (uLogDepthBufFC * 0.5)) - 1.0);
                    vec4 ndcRay = vec4(uv * 2.0 - 1.0, 1.0, 1.0);
                    vec4 viewRay = uInverseProjectionMatrix * ndcRay;
                    viewRay.xyz /= viewRay.w;
                    vec3 rayDirView = normalize(viewRay.xyz);
                    float dist = abs(viewZ) / abs(rayDirView.z);
                    vec3 rayDirWorld = (uInverseViewMatrix * vec4(rayDirView, 0.0)).xyz;
                    return uCameraPos + (normalize(rayDirWorld) * dist);
                }

                vec3 GetSunDisc(vec3 rayDir, vec3 sunDir, vec3 sunColor) {
                    float costh = dot(rayDir, sunDir);
                    float core = smoothstep(0.99985, 0.99995, costh);
                    float glow = pow(max(costh, 0.0), 9000.0) * 0.5;
                    return (vec3(core) + vec3(glow)) * sunColor * 10.0;
                }
                
                void main() {
                    vec4 sceneData = texture2D(tScene, vUv);
                    float depth = texture2D(tDepth, vUv).r;
                    vec4 cloudData = texture2D(tClouds, vUv);
                    float cloudDepth = texture2D(tCloudDepth, vUv).r; 

                    // --- STEP 1: Read the 13-point system result ---
                    // Read the smooth value (0.0 to 1.0) indicating if sun is visible.
                    float sunVis = texture2D(tSunVisibility, vec2(0.5)).r;
                    
                    vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
                    vec4 viewRay = uInverseProjectionMatrix * ndc;
                    vec3 rayDir = normalize((uInverseViewMatrix * vec4(viewRay.xyz, 0.0)).xyz);
                    vec3 rayStart = uCameraPos;

                    float rayLength = 1.0e10; 
                    bool isSky = true;
                    if (depth < 1.0) {
                        vec3 worldPos = getWorldPosition(depth, vUv);
                        rayLength = length(worldPos - rayStart);
                        isSky = false;
                    }

                    vec3 totalTransmittance;
                    
                    // --- STEP 2: Pass 'sunVis' to atmosphere calculation ---
                    // This ensures the sun's atmospheric glow fades if sun is occluded.
                    vec3 atmosphereColor = GetAtmosphere(rayStart, rayDir, rayLength, sunVis, totalTransmittance);
                    
                    vec3 finalComposite;
                    
                    if (isSky) {
                        finalComposite = atmosphereColor;
                        vec2 sunBlockCheck = hitSphere(rayStart, uSunDirection, uPlanetCenter, uPlanetRadius - 1000.0);
                        if (sunBlockCheck.x < 0.0) {
                            vec3 sunPhysicalColor = getLightTransmittance(rayStart, uSunDirection) * uSunIntensity;
                            finalComposite += GetSunDisc(rayDir, uSunDirection, sunPhysicalColor);
                        }
                    } else {
                        // Blend solid scene with atmospheric fog
                        finalComposite = atmosphereColor + (sceneData.rgb * totalTransmittance);
                    }

                    // Blend clouds on top
                    if (cloudData.a > 0.01 && cloudDepth < rayLength) {
                        vec3 cloudTransmittance;
                        
                        // --- STEP 3: Pass 'sunVis' to fog over clouds as well ---
                        vec3 cloudFog = GetAtmosphere(rayStart, rayDir, cloudDepth, sunVis, cloudTransmittance);
                        
                        vec3 bgAttenuated = finalComposite * (1.0 - cloudData.a);
                        vec3 cloudAttenuated = cloudData.rgb * cloudTransmittance;
                        vec3 fogOnCloud = cloudFog * cloudData.a;
                        
                        finalComposite = bgAttenuated + cloudAttenuated + fogOnCloud;
                    }

                    // God Rays and Tone Mapping
                    vec3 godRaysColor = texture2D(tGodRays, vUv).rgb;
                    
                    // Note: 'sunVis' is already used for God Rays here, as before
                    finalComposite += godRaysColor * uSunPhysicalColor * uGodRaysIntensity * sunVis;

                    // Exposure and Filmic Tone Mapping
                    finalComposite *= uExposure;
                    float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
                    finalComposite = clamp((finalComposite * (a * finalComposite + b)) / (finalComposite * (c * finalComposite + d) + e), 0.0, 1.0);
                    
                    // Gamma Correction
                    gl_FragColor = vec4(pow(finalComposite, vec3(1.0 / 2.2)), 1.0);
                }
            `
        };
