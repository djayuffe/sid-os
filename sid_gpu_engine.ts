
import * as THREE from 'three';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  MOS_CORE_HYPERVISOR_V19.0 (TESLA_COIL_COMPUTE)             ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║ High-Density Silicon Physics Pipeline:                      ║
 * ║ • BIT_UNPACK       : Real-time Ctrl Reg (Gate/Sync/Ring)    ║
 * ║ • TESLA_ARC        : Dielectric breakdown simulation        ║
 * ║ • FLUX_TEAR        : Hard Sync field disruption physics     ║
 * ║ • RT_PROJECTION    : Direct Reg->Tex mapping (PW/Filt/Res)  ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

export class SidGpuEngine {
    private renderer: THREE.WebGLRenderer;
    private scene: THREE.Scene;
    private camera: THREE.OrthographicCamera;
    
    public decodedTarget: THREE.WebGLRenderTarget;
    public stateTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
    public thermalTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
    public fieldTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
    public fluxTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
    public lithoTarget: THREE.WebGLRenderTarget; 
    public stressTarget: THREE.WebGLRenderTarget;
    public agingTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
    public arcTarget: THREE.WebGLRenderTarget;
    
    private decodeMat: THREE.ShaderMaterial;
    private stateMat: THREE.ShaderMaterial;
    private thermalMat: THREE.ShaderMaterial;
    private fieldMat: THREE.ShaderMaterial;
    private fluxMat: THREE.ShaderMaterial;
    private lithoMat: THREE.ShaderMaterial;
    private stressMat: THREE.ShaderMaterial;
    private agingMat: THREE.ShaderMaterial;
    private arcMat: THREE.ShaderMaterial;

    private regTexture: THREE.DataTexture;
    private currentIdx: number = 0;
    private quad: THREE.Mesh;

    constructor(renderer: THREE.WebGLRenderer) {
        this.renderer = renderer;
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        const opts = { 
            format: THREE.RGBAFormat, 
            type: THREE.FloatType, 
            minFilter: THREE.LinearFilter, 
            magFilter: THREE.LinearFilter 
        };

        // Increased resolution for higher precision simulation
        this.decodedTarget = new THREE.WebGLRenderTarget(32, 1, opts);
        this.stateTargets = [new THREE.WebGLRenderTarget(32, 8, opts), new THREE.WebGLRenderTarget(32, 8, opts)];
        
        // 512x512 for Thermal/Stress/Aging (was 256)
        this.thermalTargets = [new THREE.WebGLRenderTarget(512, 512, opts), new THREE.WebGLRenderTarget(512, 512, opts)];
        this.stressTarget = new THREE.WebGLRenderTarget(512, 512, opts);
        this.agingTargets = [new THREE.WebGLRenderTarget(512, 512, opts), new THREE.WebGLRenderTarget(512, 512, opts)];
        
        // 1024x1024 for Field/Flux (was 512)
        this.fieldTargets = [new THREE.WebGLRenderTarget(1024, 1024, opts), new THREE.WebGLRenderTarget(1024, 1024, opts)];
        this.fluxTargets = [new THREE.WebGLRenderTarget(1024, 1024, opts), new THREE.WebGLRenderTarget(1024, 1024, opts)];
        
        this.lithoTarget = new THREE.WebGLRenderTarget(2048, 2048, opts);
        this.arcTarget = new THREE.WebGLRenderTarget(256, 1, opts); // Increased Arc resolution

        this.regTexture = new THREE.DataTexture(new Float32Array(32 * 4), 32, 1, THREE.RGBAFormat, THREE.FloatType);

        this.decodeMat = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: { uRegs: { value: this.regTexture } },
            vertexShader: `void main() { gl_Position = vec4(position, 1.0); }`,
            fragmentShader: `
                precision highp float;
                uniform sampler2D uRegs;
                out vec4 outColor;
                void main() {
                    ivec2 t = ivec2(gl_FragCoord.xy);
                    vec4 r = texelFetch(uRegs, t, 0);
                    outColor = vec4(r.r / 255.0, r.g / 255.0, r.b / 255.0, 1.0);
                }
            `
        });

        this.stateMat = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: { 
                uDec: { value: null }, 
                uPrev: { value: null }, 
                uDt: { value: 0 }, 
                uTime: { value: 0 },
                uClock: { value: 985248.0 } 
            },
            vertexShader: `void main() { gl_Position = vec4(position, 1.0); }`,
            fragmentShader: `
                precision highp float;
                uniform sampler2D uDec;
                uniform sampler2D uPrev;
                uniform float uDt;
                uniform float uTime;
                uniform float uClock;
                out vec4 outColor;

                void main() {
                    ivec2 t = ivec2(gl_FragCoord.xy);
                    vec4 prev = texelFetch(uPrev, t, 0);
                    vec4 res = prev;

                    if (t.y == 0) {
                        int v = t.x / 7;
                        if (v < 3) {
                            // --- VOICE PROCESSING (0..20) ---
                            float f0 = texelFetch(uDec, ivec2(v*7, 0), 0).r * 255.0;
                            float f1 = texelFetch(uDec, ivec2(v*7+1, 0), 0).r * 255.0;
                            float freq = f0 + f1 * 256.0;
                            
                            // Pulse Width
                            float pw0 = texelFetch(uDec, ivec2(v*7+2, 0), 0).r * 255.0;
                            float pw1 = texelFetch(uDec, ivec2(v*7+3, 0), 0).r * 255.0;
                            float pw = (pw0 + (pw1 * 256.0)) / 4095.0;

                            // Control Register Analysis
                            // Bit 0: Gate, Bit 1: Sync, Bit 2: Ring, Bit 3: Test
                            int ctrlInt = int(texelFetch(uDec, ivec2(v*7+4, 0), 0).r * 255.0);
                            float gate = float(ctrlInt & 1);
                            float sync = float((ctrlInt >> 1) & 1);
                            float ring = float((ctrlInt >> 2) & 1);
                            float test = float((ctrlInt >> 3) & 1);

                            // High-Precision phase accumulation
                            float inc = clamp((freq * uClock * uDt) / 16777216.0, 0.0, 1.0);
                            
                            // Apply Sync (Visual tear simulation)
                            if(sync > 0.5) inc *= 1.5; 

                            res.r = fract(prev.r + inc); 
                            res.g = pw;
                            
                            // Pack Control State into Blue Channel for physics shaders
                            // R=Gate(0.1), G=Sync(0.2), B=Ring(0.4), A=Test(0.8)
                            res.b = (gate * 0.1) + (sync * 0.2) + (ring * 0.4) + (test * 0.8);
                            
                            res.a = freq / 16384.0; // A = Freq Norm
                        }
                        else if (t.x >= 21 && t.x <= 24) {
                            // --- FILTER PROCESSING (21..24) ---
                            float cutLo = texelFetch(uDec, ivec2(21, 0), 0).r * 255.0;
                            float cutHi = texelFetch(uDec, ivec2(22, 0), 0).r * 255.0;
                            float cutoff = (cutLo + cutHi * 256.0) / 2047.0;
                            
                            float resVal = texelFetch(uDec, ivec2(23, 0), 0).r * 255.0;
                            float resonance = floor(resVal / 16.0) / 15.0;
                            
                            float modeVol = texelFetch(uDec, ivec2(24, 0), 0).r * 255.0;
                            
                            res.r = cutoff;
                            res.g = resonance;
                            res.b = modeVol; // Packed Mode/Vol
                            res.a = 1.0;
                        }
                    }
                    outColor = res;
                }
            `
        });

        this.lithoMat = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: `out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
            fragmentShader: `
                precision highp float;
                in vec2 vUv;
                out vec4 outColor;
                float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                float noise(vec2 p) {
                    vec2 i = floor(p); vec2 f = fract(p);
                    vec2 u = f*f*(3.0-2.0*f);
                    return mix(mix(hash(i + vec2(0,0)), hash(i + vec2(1,0)), u.x),
                               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
                }
                void main() {
                    // Generate die layout map (Diffusion, Poly, Metal, Vias)
                    float diffusion = step(0.65, noise(vUv * 800.0 + noise(vUv * 200.0))) * 0.1;
                    float polysilicon = step(0.82, noise(vUv * 1200.0)) * 0.12;
                    float metal = step(0.97, fract(vUv.x * 3000.0)) * 0.04 + step(0.97, fract(vUv.y * 1500.0)) * 0.02;
                    float vias = step(0.999, fract(vUv.x * 512.0) * fract(vUv.y * 512.0)) * 0.6;
                    outColor = vec4(diffusion, polysilicon, metal, vias);
                }
            `
        });

        this.fieldMat = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: { uState: { value: null }, uPrevField: { value: null }, uThermal: { value: null }, uTime: { value: 0 }, uDt: { value: 0 } },
            vertexShader: `out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
            fragmentShader: `
                precision highp float;
                uniform sampler2D uState;
                uniform sampler2D uPrevField;
                uniform sampler2D uThermal;
                uniform float uTime;
                uniform float uDt;
                in vec2 vUv;
                out vec4 outColor;

                vec3 hsv2rgb(vec3 c) {
                    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
                    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
                }

                void main() {
                    vec4 field = texture(uPrevField, vUv);
                    float heat = texture(uThermal, vUv).r;
                    vec2 p = vUv * 2.0 - 1.0;
                    
                    // Filter influence on field
                    vec4 filt = texture(uState, vec2(22.0/32.0, 0.125));
                    float cutoff = filt.r;
                    float res = filt.g;
                    
                    for(int i=0; i<3; i++) {
                        vec4 s = texture(uState, vec2(float(i*7)/32.0, 0.125));
                        float phase = s.r;
                        float pw = s.g;
                        
                        // Unpack Ctrl Bits from Blue Channel
                        float ctrlPack = s.b;
                        bool isGate = ctrlPack > 0.05;
                        bool isSync = ctrlPack > 0.15;
                        bool isRing = ctrlPack > 0.35;
                        
                        float freqNorm = s.a;
                        
                        vec3 voiceColor = hsv2rgb(vec3(freqNorm * 4.2, 0.88, 1.0));
                        if (isRing) voiceColor = vec3(1.0, 0.2, 0.8); // Ring mod = Magenta
                        
                        // Modulate position/shape with Pulse Width
                        float subfrw = sin(uTime * 4.0 + phase * 12.0) * 0.01;
                        float pulse = sin(uTime * 14.0 + phase * 62.8 + subfrw);
                        
                        // Hard Sync tears the field visually
                        if (isSync) pulse *= step(0.5, fract(uTime * 20.0));

                        float widthMod = (pw - 0.5) * 0.5;
                        vec2 nodePos = vec2(-0.8 + float(i)*0.8 + widthMod, pulse * (0.008 + heat * 0.025));
                        
                        float d = length(p - nodePos) - 0.18;
                        
                        if(d < 0.0) {
                            float energy = (1.0 - abs(d)*6.0);
                            // Gate adds sharp burst
                            float intensity = 10.0 + (isGate ? 5.0 : 0.0) + res * 2.0;
                            field.rgb += log(vec3(1.0) + (voiceColor * energy * intensity));
                            field.a = mix(field.a, phase, 0.15); 
                        }
                    }

                    // Global decay with filter influence
                    float decay = clamp(0.75 - heat * 0.03 - (cutoff * 0.05), 0.0, 0.99);
                    field.rgb *= decay; 
                    outColor = clamp(field, 0.0, 50.0);
                }
            `
        });

        this.fluxMat = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: { uField: { value: null }, uPrevFlux: { value: null }, uDt: { value: 0 } },
            vertexShader: `out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
            fragmentShader: `
                precision highp float;
                uniform sampler2D uField;
                uniform sampler2D uPrevFlux;
                in vec2 vUv;
                out vec4 outColor;
                void main() {
                    outColor = mix(texture(uPrevFlux, vUv), texture(uField, vUv), 0.18);
                }
            `
        });

        this.thermalMat = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: { uState: { value: null }, uPrevThermal: { value: null }, uDt: { value: 0 } },
            vertexShader: `out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
            fragmentShader: `
                precision highp float;
                uniform sampler2D uState;
                uniform sampler2D uPrevThermal;
                uniform float uDt;
                in vec2 vUv;
                out vec4 outColor;
                void main() {
                    vec2 e = 1.0 / 512.0 * vec2(1.0, 0.0);
                    float t0 = texture(uPrevThermal, vUv).r;
                    // Heat Diffusion
                    float t1 = texture(uPrevThermal, vUv + e.xy).r;
                    float t2 = texture(uPrevThermal, vUv - e.xy).r;
                    float t3 = texture(uPrevThermal, vUv + e.yx).r;
                    float t4 = texture(uPrevThermal, vUv - e.yx).r;
                    float diff = (t1 + t2 + t3 + t4) * 0.25 - t0;
                    
                    float heat = 0.0;
                    
                    // Voice Heat (High frequency switching generates heat)
                    for(int i=0; i<3; i++) {
                        vec4 s = texture(uState, vec2(float(i*7)/32.0, 0.125));
                        float d = length(vUv - vec2(0.42 + float(i)*0.08, 0.5)) - 0.14;
                        if(d < 0.0) heat += s.a * 0.35; 
                    }
                    
                    // Filter Heat (Resonance drives analog warmth)
                    vec4 filt = texture(uState, vec2(22.0/32.0, 0.125));
                    float res = filt.g;
                    // Filter area is on the right side of the die
                    float dFilt = length(vUv - vec2(0.8, 0.5)) - 0.25;
                    if(dFilt < 0.0) heat += res * 0.8; // High resonance = High heat

                    float next = t0 + diff * 0.38 + heat * uDt * 10.0 - 0.00012;
                    outColor = vec4(clamp(next, 0.0, 6.0), 0.0, 0.0, 1.0);
                }
            `
        });

        this.stressMat = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: { uField: { value: null }, uPrevField: { value: null }, uAging: { value: null }, uDt: { value: 0 } },
            vertexShader: `out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
            fragmentShader: `
                precision highp float;
                uniform sampler2D uField;
                uniform sampler2D uPrevField;
                uniform sampler2D uAging;
                uniform float uDt;
                in vec2 vUv;
                out vec4 outColor;
                void main() {
                    vec2 e = vec2(1.0/1024.0, 0.0);
                    vec4 f = texture(uField, vUv);
                    vec4 pf = texture(uPrevField, vUv);
                    // Spatial gradient for stress map
                    vec4 fx = texture(uField, vUv + e.xy);
                    vec4 fy = texture(uField, vUv + e.yx);
                    float age = texture(uAging, vUv).r;
                    
                    // Transient detection (dV/dt)
                    vec3 dE = log(vec3(1.0001) + f.rgb) - log(vec3(1.0001) + pf.rgb);
                    float transient = length(dE) * 35.0;
                    
                    // Dielectric Stress (Voltage gradient + Transients)
                    float stress = (length(fx.rgb - f.rgb) + length(fy.rgb - f.rgb) + transient) * (0.35 + age * 30.0);
                    
                    // Boost stress significantly if transients are high (Tesla Arc Trigger)
                    if(transient > 2.0) stress += 5.0;

                    outColor = vec4(stress, transient, age, 1.0);
                }
            `
        });

        this.arcMat = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: { uStress: { value: null }, uTime: { value: 0 } },
            vertexShader: `void main() { gl_Position = vec4(position, 1.0); }`,
            fragmentShader: `
                precision highp float;
                uniform sampler2D uStress;
                uniform float uTime;
                out vec4 outColor;
                
                float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

                void main() {
                    // Random sampling for arc seeds based on stress map
                    float id = gl_FragCoord.x / 256.0;
                    
                    // Jitter sample position over time
                    vec2 seedUv = vec2(id, fract(uTime * 0.1 + id * 13.37));
                    vec4 s = texture(uStress, seedUv);
                    
                    // Trigger arc if stress is high (Dielectric Breakdown threshold)
                    float trigger = step(0.95, (s.r + s.g) * hash(vec2(id, uTime)));
                    
                    // R = Intensity, G = Length/Sustain
                    outColor = vec4(s.r * trigger * 20.0, s.g * trigger * 10.0, trigger, 1.0);
                }
            `
        });

        this.agingMat = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: { uThermal: { value: null }, uPrevAging: { value: null }, uDt: { value: 0 } },
            vertexShader: `out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
            fragmentShader: `
                precision highp float;
                uniform sampler2D uThermal;
                uniform sampler2D uPrevAging;
                uniform float uDt;
                in vec2 vUv;
                out vec4 outColor;
                void main() {
                    float t = texture(uThermal, vUv).r;
                    float age = texture(uPrevAging, vUv).r;
                    // Arrhenius equation approximation for silicon aging based on heat
                    outColor = vec4(clamp(age + (t * t * 0.00006) * uDt * 25.0, 0.0, 1.0), 0.0, 0.0, 1.0);
                }
            `
        });

        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
        this.scene.add(this.quad);
        
        this.renderer.setRenderTarget(this.lithoTarget);
        this.quad.material = this.lithoMat;
        this.renderer.render(this.scene, this.camera);
    }

    public step(dt: number, time: number, regs: number[] | Uint8Array, clockFreq: number) {
        const data = new Float32Array(32 * 4);
        for (let i = 0; i < 32; i++) { data[i * 4] = regs[i] || 0; }
        this.regTexture.image.data = data;
        this.regTexture.needsUpdate = true;

        const nextIdx = 1 - this.currentIdx;
        const prevField = this.fieldTargets[this.currentIdx].texture;
        const prevFlux = this.fluxTargets[this.currentIdx].texture;
        const prevAging = this.agingTargets[this.currentIdx].texture;

        const passes = [
            { mat: this.decodeMat, target: this.decodedTarget, inputs: {} },
            { mat: this.stateMat, target: this.stateTargets[nextIdx], inputs: { uDec: this.decodedTarget.texture, uPrev: this.stateTargets[this.currentIdx].texture, uDt: dt, uTime: time, uClock: clockFreq } },
            { mat: this.thermalMat, target: this.thermalTargets[nextIdx], inputs: { uState: this.stateTargets[nextIdx].texture, uPrevThermal: this.thermalTargets[this.currentIdx].texture, uDt: dt } },
            { mat: this.fieldMat, target: this.fieldTargets[nextIdx], inputs: { uState: this.stateTargets[nextIdx].texture, uPrevField: prevField, uThermal: this.thermalTargets[nextIdx].texture, uTime: time, uDt: dt } },
            { mat: this.fluxMat, target: this.fluxTargets[nextIdx], inputs: { uField: this.fieldTargets[nextIdx].texture, uPrevFlux: prevFlux, uDt: dt } },
            { mat: this.agingMat, target: this.agingTargets[nextIdx], inputs: { uThermal: this.thermalTargets[nextIdx].texture, uPrevAging: prevAging, uDt: dt } },
            { mat: this.stressMat, target: this.stressTarget, inputs: { uField: this.fieldTargets[nextIdx].texture, uPrevField: prevField, uAging: this.agingTargets[nextIdx].texture, uDt: dt } },
            { mat: this.arcMat, target: this.arcTarget, inputs: { uStress: this.stressTarget.texture, uTime: time } }
        ];

        passes.forEach(p => {
            this.quad.material = p.mat;
            Object.entries(p.inputs).forEach(([k, v]) => { p.mat.uniforms[k].value = v; });
            this.renderer.setRenderTarget(p.target);
            this.renderer.render(this.scene, this.camera);
        });

        this.renderer.setRenderTarget(null);
        this.currentIdx = nextIdx;
    }

    public get state() { return this.stateTargets[this.currentIdx].texture; }
    public get thermal() { return this.thermalTargets[this.currentIdx].texture; }
    public get field() { return this.fieldTargets[this.currentIdx].texture; }
    public get flux() { return this.fluxTargets[this.currentIdx].texture; }
    public get litho() { return this.lithoTarget.texture; }
    public get stress() { return this.stressTarget.texture; }
    public get arcs() { return this.arcTarget.texture; }
    public get aging() { return this.agingTargets[this.currentIdx].texture; }

    public dispose() {
        this.decodedTarget.dispose();
        this.stateTargets.forEach(t => t.dispose());
        this.thermalTargets.forEach(t => t.dispose());
        this.fieldTargets.forEach(t => t.dispose());
        this.fluxTargets.forEach(t => t.dispose());
        this.lithoTarget.dispose();
        this.stressTarget.dispose();
        this.agingTargets.forEach(t => t.dispose());
        this.arcTarget.dispose();
        this.regTexture.dispose();
    }
}
