
import React, { useEffect, useRef, memo, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { 
  Activity, Zap, Thermometer, ShieldCheck, Sliders, Maximize2, Minimize2, 
  Radio, Info, RotateCcw, AlertCircle, Layers, Cpu, Eye, EyeOff, Binary, 
  Waves, Filter, Volume2, GitBranch, Repeat, Shuffle, CircuitBoard
} from 'lucide-react';
import { SidPlayer } from '../services/sidService';

// =============================================================================
// CONSTANTS
// =============================================================================

const CAMERA_CONFIG = {
  FOV: 28,
  NEAR: 0.001,
  FAR: 10,
  POSITION: new THREE.Vector3(0.14, 0.1, 0.14),
  TARGET: new THREE.Vector3(0, 0.003, 0),
} as const;

// =============================================================================
// ULTRA-ACCURATE STATE INTERFACE
// =============================================================================

interface UltraAccurateVoiceState {
  freq: number;
  pulseWidth: number;
  control: number;
  attackDecay: number;
  sustainRelease: number;
  accumulator: number;
  lfsr: number;
  envelope: number;
  envelopePhase: number;
  gateState: boolean;
  testBit: boolean;
  syncBit: boolean;
  ringModBit: boolean;
  triangleBit: boolean;
  sawtoothBit: boolean;
  pulseBit: boolean;
  noiseBit: boolean;
  waveformCount: number;
  isCombined: boolean;
  floatingOutput: number;
  peakLevel: number;
  rmsLevel: number;
}

interface UltraAccurateFilterState {
  cutoffLow: number;
  cutoffHigh: number;
  cutoff11bit: number;
  resonance: number;
  filterMode: number;
  volume: number;
  voiceRouting: number;
  z1: number;
  z2: number;
  actualCutoffHz: number;
  resonanceQ: number;
  lpActive: boolean;
  bpActive: boolean;
  hpActive: boolean;
  voice1Routed: boolean;
  voice2Routed: boolean;
  voice3Routed: boolean;
  extInRouted: boolean;
}

interface UltraAccurateState {
  cycles: number;
  sampleRate: number;
  clockRate: number;
  model: '6581' | '8580';
  voices: UltraAccurateVoiceState[];
  filter: UltraAccurateFilterState;
  osc3Output: number;
  env3Output: number;
  dieTemperature: number;
  powerConsumption: number;
  supplyVoltage: number;
  registerActivity: number[];
  recentWrites: Array<{ reg: number; val: number; cycle: number }>;
  thermalMap: Float32Array;
  currentFlow: Float32Array;
  totalEnergy: number; // New metric for lighting
}

// =============================================================================
// ULTRA-REALISTIC SHADERS (MODEL SPECIFIC)
// =============================================================================

// Common Vertex Shader
const COMMON_VERT = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPos;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SHADERS_6581 = {
  ACCUMULATOR_FRAG: `
    varying vec2 vUv;
    varying vec3 vNormal;
    uniform float uAccumulator;
    uniform float uTestBit;
    uniform float uSyncActive;
    uniform float uTime;
    
    // 6581: Analog/Plasma/Warm
    void main() {
      float phase = fract(float(uAccumulator) / 16777216.0);
      float angle = atan(vUv.y - 0.5, vUv.x - 0.5);
      float radius = length(vUv - 0.5) * 2.0;
      
      float plasma = sin(angle * 10.0 + uTime * 5.0 + phase * 20.0) * 0.5 + 0.5;
      float ring = smoothstep(0.6, 0.8, radius) * smoothstep(1.0, 0.8, radius);
      
      vec3 coreColor = vec3(1.0, 0.4, 0.1); // Amber
      vec3 activeColor = vec3(1.0, 0.8, 0.2); // Hot Yellow
      
      vec3 color = mix(coreColor, activeColor, plasma * ring);
      
      // Noise/Grain for 6581 dirt
      float grain = fract(sin(dot(vUv.xy ,vec2(12.9898,78.233))) * 43758.5453);
      color += grain * 0.1;
      
      if (uTestBit > 0.5) color *= vec3(0.5, 0.0, 0.0); // Dim red on test
      if (uSyncActive > 0.5) color += vec3(1.0, 1.0, 1.0) * step(0.9, sin(uTime * 50.0));
      
      gl_FragColor = vec4(color * ring, 1.0);
    }
  `,
  FILTER_FRAG: `
    varying vec2 vUv;
    uniform float uCutoff;
    uniform float uResonance;
    uniform float uTime;
    uniform float uEnergy;
    
    // 6581: Organic/Fluid/Distortion
    void main() {
      float cNorm = uCutoff / 2047.0;
      
      // Fluid distortion based on resonance
      vec2 p = vUv * 5.0;
      float distortion = sin(p.x + uTime + cos(p.y + uTime)) * uResonance;
      
      float intensity = smoothstep(0.0, 1.0, 1.0 - abs(vUv.x - cNorm + distortion * 0.05));
      
      vec3 warm = vec3(0.8, 0.3, 0.1);
      vec3 hot = vec3(1.0, 0.9, 0.4);
      
      vec3 color = mix(warm, hot, intensity * uEnergy);
      color += vec3(0.1, 0.05, 0.0) * uResonance; // Base glow
      
      gl_FragColor = vec4(color * 0.8, 1.0);
    }
  `
};

const SHADERS_8580 = {
  ACCUMULATOR_FRAG: `
    varying vec2 vUv;
    uniform float uAccumulator;
    uniform float uTestBit;
    uniform float uSyncActive;
    uniform float uTime;
    
    // 8580: Digital/Laser/Cool
    void main() {
      float phase = fract(float(uAccumulator) / 16777216.0);
      float dist = length(vUv - 0.5);
      
      // Sharp segmented ring
      float segment = step(0.1, fract(atan(vUv.y - 0.5, vUv.x - 0.5) / 6.28 * 16.0 + phase));
      float ring = step(0.35, dist) * step(dist, 0.45);
      
      vec3 neon = vec3(0.0, 0.8, 1.0); // Cyan
      vec3 sync = vec3(1.0, 0.0, 1.0); // Magenta
      
      vec3 color = neon * ring * segment;
      
      // Clean, no noise
      if (uSyncActive > 0.5) color = mix(color, sync, 0.8);
      if (uTestBit > 0.5) color *= 0.0;
      
      gl_FragColor = vec4(color, 1.0);
    }
  `,
  FILTER_FRAG: `
    varying vec2 vUv;
    uniform float uCutoff;
    uniform float uResonance;
    uniform float uTime;
    uniform float uEnergy;
    
    // 8580: Grid/Precision/Matrix
    void main() {
      float cNorm = uCutoff / 2047.0;
      
      // Grid pattern
      vec2 grid = abs(fract(vUv * 20.0 - vec2(uTime * 0.5, 0.0)) - 0.5);
      float line = 1.0 - smoothstep(0.0, 0.1, min(grid.x, grid.y));
      
      float activeRegion = step(vUv.x, cNorm);
      
      vec3 cool = vec3(0.0, 0.2, 0.5);
      vec3 bright = vec3(0.0, 1.0, 0.8);
      
      vec3 color = mix(cool, bright, activeRegion * (0.5 + uResonance * 0.5));
      color += line * vec3(0.5, 0.8, 1.0) * activeRegion * 0.5;
      
      gl_FragColor = vec4(color, 1.0);
    }
  `
};

// =============================================================================
// STATE EXTRACTION
// =============================================================================

function extractUltraAccurateState(player: SidPlayer | null, cycles: number): UltraAccurateState | null {
  if (!player) return null;
  
  const regs = player.volatileRegs || new Array(32).fill(0);
  const vStates = player.volatileVoiceStates || [];
  const physics = player.volatilePhysics || { temp: 28, power: 0.7, vSupply: 12 };
  
  let totalEnergy = 0;

  const voices: UltraAccurateVoiceState[] = [0, 1, 2].map(i => {
    const base = i * 7;
    const vState = vStates[i] || { level: 0, state: 0, freq: 0, pw: 0, ctrl: 0, phase: 0 };
    const ctrl = regs[base + 4] || 0;
    const waveformBits = (ctrl >> 4) & 0x0F;
    const waveformCount = [
      (waveformBits & 0x01) ? 1 : 0, 
      (waveformBits & 0x02) ? 1 : 0, 
      (waveformBits & 0x04) ? 1 : 0, 
      (waveformBits & 0x08) ? 1 : 0, 
    ].reduce((a, b) => a + b, 0);
    
    totalEnergy += vState.level || 0;

    return {
      freq: regs[base] | (regs[base + 1] << 8),
      pulseWidth: regs[base + 2] | ((regs[base + 3] & 0x0F) << 8),
      control: ctrl,
      attackDecay: regs[base + 5],
      sustainRelease: regs[base + 6],
      accumulator: vState.phase || 0,
      lfsr: 0x7FFFF8,
      envelope: Math.round((vState.level || 0) * 255),
      envelopePhase: vState.state || 0,
      gateState: (ctrl & 0x01) !== 0,
      testBit: (ctrl & 0x08) !== 0,
      syncBit: (ctrl & 0x02) !== 0,
      ringModBit: (ctrl & 0x04) !== 0,
      triangleBit: (ctrl & 0x10) !== 0,
      sawtoothBit: (ctrl & 0x20) !== 0,
      pulseBit: (ctrl & 0x40) !== 0,
      noiseBit: (ctrl & 0x80) !== 0,
      waveformCount,
      isCombined: waveformCount > 1,
      floatingOutput: 0,
      peakLevel: player.volatileVoicePeaks?.[i] || 0,
      rmsLevel: player.volatileVoiceRms?.[i] || 0,
    };
  });
  
  const cutoff = regs[21] | ((regs[22] & 0x07) << 8);
  const res = (regs[23] >> 4) & 0x0F;
  const filterMode = (regs[24] >> 4) & 0x07;
  const voiceRouting = regs[23] & 0x0F;
  
  const filter: UltraAccurateFilterState = {
    cutoffLow: regs[21],
    cutoffHigh: regs[22],
    cutoff11bit: cutoff,
    resonance: res,
    filterMode,
    volume: regs[24] & 0x0F,
    voiceRouting,
    z1: 0,
    z2: 0,
    actualCutoffHz: 220 + (cutoff / 2047) * 15000,
    resonanceQ: res / 15,
    lpActive: (filterMode & 0x01) !== 0,
    bpActive: (filterMode & 0x02) !== 0,
    hpActive: (filterMode & 0x04) !== 0,
    voice1Routed: (voiceRouting & 0x01) !== 0,
    voice2Routed: (voiceRouting & 0x02) !== 0,
    voice3Routed: (voiceRouting & 0x04) !== 0,
    extInRouted: (voiceRouting & 0x08) !== 0,
  };
  
  return {
    cycles,
    sampleRate: 48000,
    clockRate: 985248,
    model: '6581',
    voices,
    filter,
    osc3Output: regs[0x1B] || 0,
    env3Output: regs[0x1C] || 0,
    dieTemperature: physics.temp,
    powerConsumption: physics.power,
    supplyVoltage: physics.vSupply,
    registerActivity: new Array(32).fill(0),
    recentWrites: [],
    thermalMap: new Float32Array(256 * 256),
    currentFlow: new Float32Array(100),
    totalEnergy: totalEnergy / 3.0
  };
}

class UltraAccurateSidArchitecture {
  private group: THREE.Group;
  private components: Map<string, THREE.Object3D> = new Map();
  private voiceAccumulators: THREE.Mesh[] = [];
  private filterStates: THREE.Mesh[] = [];
  private thermalTexture: THREE.DataTexture;
  private model: '6581' | '8580';
  
  constructor(model: '6581' | '8580') {
    this.model = model;
    this.group = new THREE.Group();
    this.group.name = 'ULTRA_ACCURATE_SID';
    this.thermalTexture = this.createThermalTexture();
    this.buildArchitecture();
  }
  
  private buildArchitecture(): void {
    const shaders = this.model === '6581' ? SHADERS_6581 : SHADERS_8580;

    // Substrate
    this.buildSubstrate();

    // Voices
    for (let i = 0; i < 3; i++) {
        const voiceGroup = new THREE.Group();
        // Position logic same as before...
        const pos = [{x: 0.15, y: 0.22}, {x: 0.50, y: 0.22}, {x: 0.85, y: 0.22}][i];
        
        // Accumulator with Model-Specific Shader
        const accumGeo = new THREE.PlaneGeometry(0.002, 0.002);
        const accumMat = new THREE.ShaderMaterial({
            vertexShader: COMMON_VERT,
            fragmentShader: shaders.ACCUMULATOR_FRAG,
            uniforms: {
                uAccumulator: { value: 0 },
                uTestBit: { value: 0 },
                uSyncActive: { value: 0 },
                uTime: { value: 0 }
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        });
        const accum = new THREE.Mesh(accumGeo, accumMat);
        accum.rotation.x = -Math.PI/2;
        voiceGroup.add(accum);
        this.voiceAccumulators[i] = accum;

        // Position group
        const x = (pos.x - 0.5) * 0.008;
        const z = (pos.y - 0.5) * 0.006;
        voiceGroup.position.set(x, 0.0002, z);
        this.group.add(voiceGroup);
    }

    // Filter with Model-Specific Shader
    const filterGeo = new THREE.PlaneGeometry(0.004, 0.002);
    const filterMat = new THREE.ShaderMaterial({
        vertexShader: COMMON_VERT,
        fragmentShader: shaders.FILTER_FRAG,
        uniforms: {
            uCutoff: { value: 0 },
            uResonance: { value: 0 },
            uTime: { value: 0 },
            uEnergy: { value: 0 }
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
    });
    const filter = new THREE.Mesh(filterGeo, filterMat);
    filter.rotation.x = -Math.PI/2;
    filter.position.set(0, 0.0002, (0.62 - 0.5) * 0.006);
    this.group.add(filter);
    this.filterStates.push(filter);
  }
  
  private buildSubstrate(): void {
    const geo = new THREE.BoxGeometry(0.008, 0.0003, 0.006);
    const mat = new THREE.MeshStandardMaterial({
        color: this.model === '6581' ? 0x2a1a0a : 0x0a1a2a, // Brownish for 6581, Blueish for 8580
        roughness: 0.3,
        metalness: 0.8
    });
    const sub = new THREE.Mesh(geo, mat);
    this.group.add(sub);
  }
  
  private createThermalTexture(): THREE.DataTexture {
    const size = 32;
    const data = new Uint8Array(size * size * 4);
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return texture;
  }
  
  public update(state: UltraAccurateState | null, time: number): void {
    if (!state) return;
    
    // Update Voices
    state.voices.forEach((voice, i) => {
      if (this.voiceAccumulators[i]) {
        const mat = this.voiceAccumulators[i].material as THREE.ShaderMaterial;
        mat.uniforms.uAccumulator.value = voice.accumulator;
        mat.uniforms.uTestBit.value = voice.testBit ? 1.0 : 0.0;
        mat.uniforms.uSyncActive.value = voice.syncBit ? 1.0 : 0.0;
        mat.uniforms.uTime.value = time;
      }
    });

    // Update Filter
    if (this.filterStates[0]) {
        const mat = this.filterStates[0].material as THREE.ShaderMaterial;
        mat.uniforms.uCutoff.value = state.filter.cutoff11bit;
        mat.uniforms.uResonance.value = state.filter.resonance / 15.0;
        mat.uniforms.uTime.value = time;
        mat.uniforms.uEnergy.value = state.totalEnergy;
    }
  }
  
  public getGroup(): THREE.Group { return this.group; }
  public dispose(): void {
    this.thermalTexture.dispose();
    this.group.traverse((obj: any) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose());
        else obj.material.dispose();
      }
    });
  }
}

const SliderField: React.FC<{ label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; icon?: React.ReactNode; }> = memo(({ label, value, min, max, step, onChange, icon }) => {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between px-0.5">
        <label className="text-[6px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">{icon}{label}</label>
        <span className="text-[6px] font-mono text-cyan-600 tabular-nums">{value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} className="w-full h-0.5 bg-slate-900 accent-cyan-500 cursor-crosshair" />
    </div>
  );
});
SliderField.displayName = 'SliderField';

interface Props { player: SidPlayer | null; isPlaying: boolean; sidModel?: '6581' | '8580'; visualLead?: number; interpolatedCycles?: number; }

const UltraAccurateSidVisualizer: React.FC<Props> = memo(({ player, isPlaying, sidModel = '6581', visualLead = 0, interpolatedCycles = 0 }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const architectureRef = useRef<UltraAccurateSidArchitecture | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rafRef = useRef<number>(0);
  const [gfx, setGfx] = useState({ bloom: 2.2, ssao: 1.0, detail: 1.0 });
  const [layers, setLayers] = useState([{ id: 'substrate', name: 'Silicon', visible: true }, { id: 'package', name: 'Package', visible: true }]);
  const [error, setError] = useState<Error | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [stats, setStats] = useState<UltraAccurateState | null>(null);
  
  // Dynamic Lights Refs
  const sunLight = useRef<THREE.DirectionalLight>(null);
  const fillLight = useRef<THREE.PointLight>(null);

  const updateGfx = useCallback((key: string, value: number) => setGfx(prev => ({ ...prev, [key]: value })), []);
  const toggleLayer = useCallback((id: string) => setLayers(prev => prev.map(l => (l.id === id ? { ...l, visible: !l.visible } : l))), []);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    let mounted = true;
    try {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x000104);
      scene.fog = new THREE.FogExp2(0x000104, 5.0);
      sceneRef.current = scene;
      const camera = new THREE.PerspectiveCamera(CAMERA_CONFIG.FOV, 1, CAMERA_CONFIG.NEAR, CAMERA_CONFIG.FAR);
      camera.position.copy(CAMERA_CONFIG.POSITION);
      cameraRef.current = camera;
      const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, antialias: true, powerPreference: 'high-performance' });
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.8;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      rendererRef.current = renderer;
      scene.add(new THREE.AmbientLight(0x0a0a15, 0.5));
      
      const sun = new THREE.DirectionalLight(0xffffff, 2.0); 
      sun.position.set(0.2, 0.4, 0.3); 
      scene.add(sun);
      (sunLight as any).current = sun;
      
      const fill = new THREE.PointLight(0x00f2ff, 1.0, 0.5); 
      fill.position.set(-0.15, 0.08, -0.15); 
      scene.add(fill);
      (fillLight as any).current = fill;

      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const ssaoPass = new SSAOPass(scene, camera); ssaoPass.kernelRadius = 0.8; composer.addPass(ssaoPass);
      const bloomPass = new UnrealBloomPass(new THREE.Vector2(1024, 1024), gfx.bloom, 0.3, 0.9); composer.addPass(bloomPass);
      const fxaaPass = new ShaderPass(FXAAShader); composer.addPass(fxaaPass);
      composer.addPass(new OutputPass());
      composerRef.current = composer;
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.dampingFactor = 0.05; controls.minDistance = 0.003; controls.maxDistance = 0.2;
      controls.target.copy(CAMERA_CONFIG.TARGET); controlsRef.current = controls;
      
      const arch = new UltraAccurateSidArchitecture(sidModel as '6581' | '8580'); 
      scene.add(arch.getGroup()); 
      architectureRef.current = arch;
      
      const grid = new THREE.GridHelper(0.02, 40, 0x002233, 0x001122); grid.position.y = -0.002;
      (grid.material as THREE.Material).opacity = 0.2; (grid.material as THREE.Material).transparent = true; scene.add(grid);
      
      const handleResize = () => {
        if (!mounted || !containerRef.current) return;
        const w = Math.max(1, containerRef.current.clientWidth);
        const h = Math.max(1, containerRef.current.clientHeight);
        const dpr = Math.min(2.5, window.devicePixelRatio || 1);
        renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); composer.setSize(w, h);
        camera.aspect = w / h; camera.updateProjectionMatrix();
        fxaaPass.uniforms['resolution'].value.set(1 / (w * dpr), 1 / (h * dpr));
      };
      const ro = new ResizeObserver(handleResize); ro.observe(containerRef.current); handleResize();
      
      const animate = (timeMs: number) => {
        if (!mounted) return;
        rafRef.current = requestAnimationFrame(animate);
        const time = timeMs / 1000; 
        const cycles = (player?.volatileCycles || 0) + visualLead;
        const state = extractUltraAccurateState(player, cycles);
        
        if (state) { 
            setStats(state); 
            architectureRef.current?.update(state, time); 
            
            // REACTIVE LIGHTING BASED ON ENERGY & MODEL
            const energy = state.totalEnergy;
            
            if (sidModel === '6581') {
                // 6581: Warm, pulsing heat
                if (fillLight.current) {
                    fillLight.current.color.setHSL(0.05 + energy * 0.1, 1.0, 0.5); // Orange -> Yellow
                    fillLight.current.intensity = 1.0 + energy * 2.0;
                }
                if (sunLight.current) {
                    sunLight.current.color.setHSL(0.02, 1.0, 0.8);
                    sunLight.current.intensity = 2.0 + energy;
                }
            } else {
                // 8580: Cool, electric precision
                if (fillLight.current) {
                    fillLight.current.color.setHSL(0.5 + energy * 0.1, 1.0, 0.5); // Cyan -> Blue
                    fillLight.current.intensity = 1.0 + energy * 2.0;
                }
                if (sunLight.current) {
                    sunLight.current.color.setHSL(0.6, 0.8, 0.9);
                    sunLight.current.intensity = 2.0 + energy;
                }
            }
        }
        
        controls.update(); composer.render();
      };
      rafRef.current = requestAnimationFrame(animate); setIsReady(true);
      return () => {
        mounted = false; cancelAnimationFrame(rafRef.current); ro.disconnect();
        architectureRef.current?.dispose(); composer.dispose(); controls.dispose(); renderer.dispose();
      };
    } catch (err) { console.error('Setup error:', err); setError(err instanceof Error ? err : new Error('Failed')); }
  }, [sidModel, layers, gfx.bloom, visualLead, player]);

  if (error) return <div className="w-full h-full bg-black flex items-center justify-center"><div className="flex flex-col items-center gap-4 text-red-400"><AlertCircle className="w-16 h-16" /><h2 className="text-xl font-black uppercase">Error</h2><p className="text-sm text-slate-400">{error.message}</p></div></div>;

  return (
    <div ref={containerRef} className="w-full h-full bg-black relative rounded-xl overflow-hidden group">
      <canvas ref={canvasRef} className="w-full h-full block" style={{ opacity: isReady ? 1 : 0, transition: 'opacity 0.3s' }} />
      {!isReady && <div className="absolute inset-0 flex items-center justify-center"><div className="flex flex-col items-center gap-4"><CircuitBoard className="w-12 h-12 text-cyan-500 animate-pulse" /><span className="text-sm text-slate-400 uppercase font-bold">Building Ultra-Accurate Architecture...</span></div></div>}
      <div className="absolute top-6 left-6 z-10 flex flex-col gap-3">
        <div className="flex items-center gap-4">
            <Binary className={`w-5 h-5 animate-pulse ${sidModel==='6581'?'text-amber-500':'text-cyan-400'}`} />
            <span className={`text-[14px] font-black tracking-[0.5em] uppercase ${sidModel==='6581'?'text-amber-100':'text-cyan-100'}`}>ULTRA_ACCURATE_{sidModel}</span>
        </div>
        {stats && <div className="bg-black/80 border border-white/5 rounded-xl p-3 space-y-2">
            <div className="text-[7px] text-slate-500 uppercase font-black">DIE STATUS</div>
            <div className="grid grid-cols-2 gap-2 text-[9px]">
              <div><div className="text-slate-600 text-[6px]">TEMP</div><div className={`font-black ${stats.dieTemperature > 50 ? 'text-red-400' : 'text-cyan-400'}`}>{stats.dieTemperature.toFixed(1)}°C</div></div>
              <div><div className="text-slate-600 text-[6px]">POWER</div><div className="font-black text-amber-400">{stats.powerConsumption.toFixed(2)}W</div></div>
            </div>
          </div>}
      </div>
      <div className="absolute top-6 right-6 z-20 w-56 flex flex-col gap-3 p-4 bg-black/70 backdrop-blur-2xl border border-white/5 rounded-2xl opacity-0 group-hover:opacity-100 transition-all duration-500">
        <div className="flex items-center gap-2 border-b border-white/10 pb-2"><Sliders className="w-4 h-4 text-cyan-400" /><span className="text-[9px] font-black text-white uppercase">Controls</span></div>
        <div className="border-t border-white/10 pt-3 space-y-3">
          <SliderField label="BLOOM" value={gfx.bloom} min={0} max={5} step={0.1} onChange={v => updateGfx('bloom', v)} icon={<Radio className="w-2.5 h-2.5" />} />
          <SliderField label="SSAO" value={gfx.ssao} min={0} max={2} step={0.1} onChange={v => updateGfx('ssao', v)} icon={<Layers className="w-2.5 h-2.5" />} />
        </div>
      </div>
    </div>
  );
});

export default UltraAccurateSidVisualizer;
