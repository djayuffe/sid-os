
import * as THREE from 'three';

const DIE_V_SHADER = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vStress;
varying float vTransient;
varying float vHeat;
varying float vAge;
varying float vPhase;

uniform sampler2D uFieldTex;
uniform sampler2D uStressTex;
uniform sampler2D uThermalTex;
uniform sampler2D uAgingTex;
uniform float uTime;

void main() {
    vUv = uv;
    vec4 field = texture2D(uFieldTex, uv);
    vec4 stressData = texture2D(uStressTex, uv);
    vec4 thermal = texture2D(uThermalTex, uv);
    vec4 aging = texture2D(uAgingTex, uv);
    
    vStress = stressData.r;
    vTransient = stressData.g; 
    vHeat = thermal.r;
    vAge = aging.r;
    vPhase = field.a;
    
    float energy = length(field.rgb) * 0.12;
    
    vec3 pos = position;
    // STABILIZED PULSE-TOUCH DEFORMATION
    float touchRipple = sin(uv.x * 120.0 + uTime * 60.0 + vPhase * 30.0) * cos(uv.y * 120.0 + uTime * 50.0);
    float displacement = (energy * 0.35) + (touchRipple * (energy + vTransient * 0.04) * 0.3);
    // HARD STABILITY CLAMP
    pos.z += clamp(displacement, -0.015, 0.02);
    
    vNormal = normalize(normalMatrix * normal);
    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

// Helper for lightning noise
const NOISE_FUNC = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash(i + vec2(0,0)), hash(i + vec2(1,0)), u.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
float lightning(vec2 uv, float seed, float time) {
    // Generate jagged lines based on domain warping
    float n = noise(uv * 10.0 + vec2(0.0, time * 10.0));
    float thickness = 0.02;
    float bolt = 1.0 / (abs(uv.x - n * 0.5 - 0.5) + thickness);
    // Mask with noise to create segments
    return bolt * step(0.6, noise(uv * 20.0 + seed));
}
`;

// 6581 (NMOS): Organic, noisy, warm, diffusion-heavy + TESLA ARCS
const DIE_F_SHADER_6581 = `
uniform sampler2D uFieldTex;
uniform sampler2D uFluxTex;
uniform sampler2D uLithoTex;
uniform sampler2D uStressTex;
uniform sampler2D uThermalTex;
uniform sampler2D uAgingTex;
uniform float uTime;

uniform float uPotentialScale;
uniform float uCurrentScale;
uniform float uThermalScale;
uniform float uBreakdownScale;
uniform float uHazeScale;
uniform float uSparkScale;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vStress;
varying float vTransient;
varying float vHeat;
varying float vAge;
varying float vPhase;

${NOISE_FUNC}

void main() {
    vec4 field = texture2D(uFieldTex, vUv);
    vec4 litho = texture2D(uLithoTex, vUv);
    
    // ORGANIC NMOS GRAIN
    float grain = hash(vUv * 8192.0 + uTime) * 0.08;
    vec2 dUv = vUv + grain * 0.005;
    
    // Diffusion layers (Warm/Copper tones)
    vec3 diff = vec3(0.15, 0.08, 0.02) * litho.r;
    vec3 poly = vec3(0.25, 0.15, 0.10) * litho.g;
    vec3 metal = vec3(0.60, 0.50, 0.40) * litho.b;
    
    vec3 base = vec3(0.02, 0.01, 0.005) + diff + poly + metal;
    
    // Plasma-like Energy Field
    float plasma = noise(dUv * 20.0 + uTime * 2.0);
    vec3 energy = vec3(1.0, 0.6, 0.2) * field.r * uPotentialScale * (0.8 + plasma * 0.4);
    
    // Thermal Bloom (Red shift)
    vec3 heat = vec3(1.0, 0.2, 0.0) * vHeat * uThermalScale * 2.0;
    
    // Spark/Breakdown (Yellow/White) - TESLA ARCS
    float sparkMask = step(0.98, noise(vUv * 100.0 + uTime * 50.0)) * vTransient;
    
    // Procedural Surface Lightning
    float arc = 0.0;
    if (vStress > 0.5) {
        arc = lightning(vUv, vPhase, uTime) * (vStress - 0.5);
    }
    
    vec3 spark = vec3(1.0, 0.9, 0.7) * (sparkMask + arc * 2.0) * uSparkScale * 10.0;

    vec3 final = base + energy + heat + spark;
    
    // Analog Haze
    final += vec3(0.1, 0.05, 0.0) * vAge * uHazeScale;

    // Soft Fresnel
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - max(0.0, dot(vNormal, viewDir)), 2.0);
    final += vec3(0.3, 0.15, 0.05) * fresnel;

    // ACES Tone mapping
    final = final / (vec3(1.0) + final);
    gl_FragColor = vec4(final, 1.0);
}
`;

// 8580 (HMOS): Digital, sharp, cool, grid-heavy + TESLA ARCS
const DIE_F_SHADER_8580 = `
uniform sampler2D uFieldTex;
uniform sampler2D uFluxTex;
uniform sampler2D uLithoTex;
uniform sampler2D uStressTex;
uniform sampler2D uThermalTex;
uniform sampler2D uAgingTex;
uniform float uTime;

uniform float uPotentialScale;
uniform float uCurrentScale;
uniform float uThermalScale;
uniform float uBreakdownScale;
uniform float uHazeScale;
uniform float uSparkScale;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vStress;
varying float vTransient;
varying float vHeat;
varying float vAge;
varying float vPhase;

${NOISE_FUNC}

void main() {
    vec4 field = texture2D(uFieldTex, vUv);
    vec4 litho = texture2D(uLithoTex, vUv);
    
    // SHARP HMOS GRID
    vec2 grid = abs(fract(vUv * 128.0) - 0.5);
    float gridLine = 1.0 - smoothstep(0.45, 0.5, max(grid.x, grid.y));
    
    // Lithography (Cool/Silver/Blue tones)
    vec3 diff = vec3(0.02, 0.05, 0.1) * litho.r;
    vec3 poly = vec3(0.1, 0.2, 0.3) * litho.g;
    vec3 metal = vec3(0.5, 0.6, 0.7) * litho.b;
    
    vec3 base = vec3(0.005, 0.01, 0.02) + diff + poly + metal;
    base += vec3(0.0, 0.1, 0.2) * gridLine * 0.1;
    
    // Laser-like Energy Field
    float pulse = step(0.5, sin(vUv.y * 200.0 + uTime * 20.0));
    vec3 energy = vec3(0.0, 0.8, 1.0) * field.r * uPotentialScale * (0.5 + pulse * 0.5);
    energy += vec3(0.5, 0.0, 1.0) * field.g * uPotentialScale; // Secondary field
    
    // Logic switching breakdown (Sharp Cyan/White)
    float switchNoise = step(0.99, fract(sin(dot(vUv, vec2(12.9898,78.233))) * 43758.5453 + uTime));
    
    // Procedural Surface Lightning (Cool Blue)
    float arc = 0.0;
    if (vStress > 0.6) {
        arc = lightning(vUv, vPhase * 2.0, uTime * 1.5) * (vStress - 0.6);
    }

    vec3 spark = vec3(0.8, 1.0, 1.0) * (switchNoise + arc * 2.0) * vTransient * uSparkScale * 15.0;
    
    vec3 final = base + energy + spark;
    
    // Cold Fresnel
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - max(0.0, dot(vNormal, viewDir)), 3.0);
    final += vec3(0.0, 0.3, 0.5) * fresnel;

    // Digital Tone mapping
    final = final / (vec3(0.8) + final);
    gl_FragColor = vec4(final, 1.0);
}
`;

const FILAMENT_V_SHADER = `
varying float vLife;
varying vec3 vColor;
uniform sampler2D uArcBuffer;
uniform float uTime;

// 3D Curl Noise Approximation for Jagged Lightning
vec3 curlNoise(vec3 p) {
    const float e = 0.1;
    vec3 dx = vec3(e, 0.0, 0.0);
    vec3 dy = vec3(0.0, e, 0.0);
    vec3 dz = vec3(0.0, 0.0, e);
    
    float p_x0 = sin(p.y * 10.0 + p.z * 12.0);
    float p_x1 = sin((p.y + dy.y) * 10.0 + p.z * 12.0);
    float p_y0 = cos(p.x * 11.0 + p.z * 13.0);
    float p_y1 = cos((p.x + dx.x) * 11.0 + p.z * 13.0);
    float p_z0 = sin(p.x * 9.0 + p.y * 14.0);
    float p_z1 = sin((p.x + dx.x) * 9.0 + p.y * 14.0);

    float x = p_z1 - p_z0 - (p_y1 - p_y0);
    float y = p_x1 - p_x0 - (p_z1 - p_z0);
    float z = p_y1 - p_y0 - (p_x1 - p_x0);

    return normalize(vec3(x, y, z));
}

void main() {
    // Sample arc intensity from GPU simulation
    // Using random X coord per instance to pick different stress points
    vec4 arc = texture2D(uArcBuffer, vec2(fract(float(gl_InstanceID) * 0.13), 0.5));
    vLife = arc.r;
    vColor = vec3(0.05, 0.45, 1.0); 
    
    vec3 pos = position;
    float seed = float(gl_InstanceID);
    
    // Jagged Lightning Displacement using Curl Noise
    if (vLife > 0.1) {
        vec3 noise = curlNoise(pos * 20.0 + uTime * 5.0 + seed);
        pos += noise * vLife * 0.015; // Jitter magnitude
        
        // Random drift
        pos.x += sin(uTime * 800.0 + seed) * 0.005 * vLife;
        pos.z += cos(uTime * 900.0 + seed) * 0.005 * vLife;
    }
    
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
}
`;

const FILAMENT_F_SHADER = `
varying float vLife;
varying vec3 vColor;
void main() {
    if(vLife < 0.001) discard;
    // Core is white, edge is blue/purple
    vec3 col = mix(vColor, vec3(1.0), vLife * 0.8);
    gl_FragColor = vec4(col * vLife * 80.0, 1.0); // Extremely bright emission
}
`;

export function buildPhotonicSid(params: { model: string, accent: THREE.Color }) {
    const group = new THREE.Group();
    const L = 0.0386, W = 0.014, H = 0.0039;

    const packageMat = new THREE.MeshPhysicalMaterial({ 
        color: 0x000000, 
        roughness: 0.998, 
        metalness: 0.995, 
        clearcoat: 1.0,
        clearcoatRoughness: 0.03
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), packageMat);
    body.position.y = H/2;
    group.add(body);

    // Select Unique Pixel Shader based on Model
    const fragmentShader = params.model === '8580' ? DIE_F_SHADER_8580 : DIE_F_SHADER_6581;

    const dieMat = new THREE.ShaderMaterial({
        vertexShader: DIE_V_SHADER,
        fragmentShader: fragmentShader,
        uniforms: { 
            uFieldTex: { value: null }, 
            uFluxTex: { value: null }, 
            uLithoTex: { value: null }, 
            uStressTex: { value: null }, 
            uThermalTex: { value: null },
            uAgingTex: { value: null },
            uTime: { value: 0 },
            uPotentialScale: { value: 1.0 },
            uCurrentScale: { value: 1.0 },
            uThermalScale: { value: 1.0 },
            uBreakdownScale: { value: 1.0 },
            uHazeScale: { value: 1.0 },
            uSparkScale: { value: 1.0 }
        },
        transparent: true
    });
    const die = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.96, W * 0.998, 256, 128), dieMat);
    die.rotation.x = -Math.PI / 2;
    die.position.y = H + 0.0001;
    group.add(die);

    const arcMat = new THREE.ShaderMaterial({
        vertexShader: FILAMENT_V_SHADER,
        fragmentShader: FILAMENT_F_SHADER,
        uniforms: { uArcBuffer: { value: null }, uTime: { value: 0 } },
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
    });
    const arcGeo = new THREE.CylinderGeometry(0.000005, 0.000005, L * 1.3, 8, 1);
    const filaments = new THREE.InstancedMesh(arcGeo, arcMat, 128);
    filaments.position.y = H + 0.005;
    group.add(filaments);

    (group as any).tick = (dt: number, time: number, 
        state: THREE.Texture, 
        field: THREE.Texture, 
        flux: THREE.Texture,
        litho: THREE.Texture,
        stress: THREE.Texture, 
        arcs: THREE.Texture, 
        thermal: THREE.Texture, 
        aging: THREE.Texture,
        regs: number[] | Uint8Array,
        gfxParams?: any) => {
            
        dieMat.uniforms.uFieldTex.value = field;
        dieMat.uniforms.uFluxTex.value = flux;
        dieMat.uniforms.uLithoTex.value = litho;
        dieMat.uniforms.uStressTex.value = stress;
        dieMat.uniforms.uThermalTex.value = thermal;
        dieMat.uniforms.uAgingTex.value = aging;
        dieMat.uniforms.uTime.value = time;

        if (gfxParams) {
            dieMat.uniforms.uPotentialScale.value = gfxParams.potential ?? 1.0;
            dieMat.uniforms.uCurrentScale.value = gfxParams.current ?? 1.0;
            dieMat.uniforms.uThermalScale.value = gfxParams.thermal ?? 1.0;
            dieMat.uniforms.uBreakdownScale.value = gfxParams.breakdown ?? 1.0;
            dieMat.uniforms.uHazeScale.value = gfxParams.haze ?? 1.0;
            dieMat.uniforms.uSparkScale.value = gfxParams.sparks ?? 1.0;
        }
        
        arcMat.uniforms.uArcBuffer.value = arcs;
        arcMat.uniforms.uTime.value = time;
        
        const matrix = new THREE.Matrix4();
        for(let i=0; i<128; i++) {
            matrix.makeTranslation((Math.random()-0.5)*0.038, 0, (Math.random()-0.5)*0.014);
            filaments.setMatrixAt(i, matrix);
        }
        filaments.instanceMatrix.needsUpdate = true;
    };

    return group;
}
