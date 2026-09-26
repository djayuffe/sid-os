
import React, { useEffect, useRef, memo, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
// Fix: Import Cpu icon from lucide-react
import { Cpu } from 'lucide-react';
import { SidPlayer, SID_REG } from '../services/sidService';

const REG_GROUPS = [
    { start: 0, end: 6, row: 1.5, col: -1, color: 0x00ffff, label: "OSC_CORE_V1", desc: "Freq/PW/Ctrl/AD/SR" },
    { start: 7, end: 13, row: 0.5, col: -1, color: 0xff00ff, label: "OSC_CORE_V2", desc: "Freq/PW/Ctrl/AD/SR" },
    { start: 14, end: 20, row: -0.5, col: -1, color: 0xffaa00, label: "OSC_CORE_V3", desc: "Freq/PW/Ctrl/AD/SR" },
    { start: 21, end: 24, row: 1.5, col: 1, color: 0x00ff00, label: "FILTER_LOGIC", desc: "Cutoff/Res/Mode/Vol" },
    { start: 25, end: 28, row: 0.5, col: 1, color: 0xff4400, label: "ANALOG_CONV", desc: "POTX/POTY/OSC3/ENV3" },
    { start: 29, end: 31, row: -0.5, col: 1, color: 0x6366f1, label: "SYSTEM_MAPPED", desc: "Bus/Reserved/IO" }
];

const REG_NAMES: Record<number, string> = {
    [SID_REG.V1_FREQ_LO]: "FREQ_LO", [SID_REG.V1_FREQ_HI]: "FREQ_HI", [SID_REG.V1_PW_LO]: "PW_LO", [SID_REG.V1_PW_HI]: "PW_HI", [SID_REG.V1_CTRL]: "CTRL", [SID_REG.V1_AD]: "ATT_DEC", [SID_REG.V1_SR]: "SUS_REL",
    [SID_REG.V2_FREQ_LO]: "FREQ_LO", [SID_REG.V2_FREQ_HI]: "FREQ_HI", [SID_REG.V2_PW_LO]: "PW_LO", [SID_REG.V2_PW_HI]: "PW_HI", [SID_REG.V2_CTRL]: "CTRL", [SID_REG.V2_AD]: "ATT_DEC", [SID_REG.V2_SR]: "SUS_REL",
    [SID_REG.V3_FREQ_LO]: "FREQ_LO", [SID_REG.V3_FREQ_HI]: "FREQ_HI", [SID_REG.V3_PW_LO]: "PW_LO", [SID_REG.V3_PW_HI]: "PW_HI", [SID_REG.V3_CTRL]: "CTRL", [SID_REG.V3_AD]: "ATT_DEC", [SID_REG.V3_SR]: "SUS_REL",
    [SID_REG.FC_LO]: "CUT_LO", [SID_REG.FC_HI]: "CUT_HI", [SID_REG.RES_FILT]: "RES_RT", [SID_REG.MODE_VOL]: "MODE_VOL",
    [SID_REG.POT_X]: "POT_X", [SID_REG.POT_Y]: "POT_Y", [SID_REG.OSC3]: "OSC_3", [SID_REG.ENV3]: "ENV_3",
    29: "MISC_1", 30: "MISC_2", 31: "MISC_3"
};

const DIE_VERTEX_SHADER = `
precision highp float;
varying vec2 vUv;
varying float vActivity;
varying float vDepth;
attribute float regIdx;
uniform sampler2D uActivityTex;
uniform float time;

float fetchActivity(float idx) {
  float u = (idx + 0.5) / 32.0;
  return texture2D(uActivityTex, vec2(u, 0.5)).r;
}

void main() {
    vUv = uv;
    float act = fetchActivity(regIdx);
    vActivity = act;
    
    vec3 pos = position;
    // PHYSICAL LAYER DISPLACEMENT
    float disp = act * 0.8 * sin(uv.x * 20.0 + uv.y * 15.0 + time * 8.0);
    pos.z += disp;
    vDepth = pos.z;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const DIE_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
varying float vActivity;
varying float vDepth;
uniform vec3 groupColor;
uniform float time;

void main() {
    // Silicon base structure
    vec3 base = vec3(0.01, 0.02, 0.04);
    
    // Etched logic gates simulation
    float gates = step(0.95, fract(vUv.x * 20.0)) * 0.1 + step(0.95, fract(vUv.y * 20.0)) * 0.1;
    base += gates;

    // Electron flow visualization
    float flow = smoothstep(0.4, 0.6, sin(vUv.y * 30.0 - time * 12.0));
    vec3 activeCol = mix(base, groupColor, vActivity);
    activeCol += groupColor * flow * vActivity * 0.4;

    // HDR Emission
    float intensity = pow(vActivity, 2.5) * 5.0;
    vec3 color = activeCol + (groupColor * intensity);
    
    // Depth-based surface oxidation
    color += vec3(0.1, 0.2, 0.4) * (vDepth * 2.0);
    
    gl_FragColor = vec4(color, 1.0);
}
`;

interface SidChipVisualizerProps {
  player: SidPlayer | null;
  model: '6581' | '8580';
  isPlaying: boolean;
}

const SidChipVisualizer: React.FC<SidChipVisualizerProps> = memo(({ player, model, isPlaying }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<SidPlayer | null>(player);
  const [hoveredReg, setHoveredReg] = useState<number | null>(null);
  
  useEffect(() => { playerRef.current = player; }, [player]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(6, 4, 10);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ 
        canvas, 
        antialias: true,
        powerPreference: "high-performance",
        alpha: true 
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // 32-slot activity data texture
    const activityData = new Uint8Array(32 * 4);
    const activityTex = new THREE.DataTexture(activityData, 32, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    activityTex.minFilter = THREE.NearestFilter;
    activityTex.magFilter = THREE.NearestFilter;
    activityTex.needsUpdate = true;

    const prevRegs = new Uint8Array(32);
    const activityLevels = new Float32Array(32);
    const regMeshes: THREE.Mesh[] = [];

    // Construct functional silicon blocks
    REG_GROUPS.forEach(group => {
        const count = group.end - group.start + 1;
        for (let i = 0; i < count; i++) {
            const regIdx = group.start + i;
            const geometry = new THREE.BoxGeometry(0.75, 0.75, 0.15, 12, 12, 2);
            const regIdxArr = new Float32Array(geometry.attributes.position.count).fill(regIdx);
            geometry.setAttribute('regIdx', new THREE.BufferAttribute(regIdxArr, 1));

            const material = new THREE.ShaderMaterial({
                vertexShader: DIE_VERTEX_SHADER,
                fragmentShader: DIE_FRAGMENT_SHADER,
                uniforms: {
                    uActivityTex: { value: activityTex },
                    groupColor: { value: new THREE.Color(group.color) },
                    time: { value: 0 }
                }
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(
                (group.col * 2.5) + (i * 0.9) - (count * 0.45), 
                group.row * 1.5, 
                0
            );
            mesh.userData = { regIdx };
            scene.add(mesh);
            regMeshes.push(mesh);
        }
    });

    // Raycaster for HUD interactivity
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    
    const onMouseMove = (event: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(regMeshes);
        if (intersects.length > 0) {
            setHoveredReg(intersects[0].object.userData.regIdx);
        } else {
            setHoveredReg(null);
        }
    };
    canvas.addEventListener('mousemove', onMouseMove);
    
    const handleResize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();

      const regs = playerRef.current ? playerRef.current.volatileRegs : new Array(32).fill(0);
      for(let i=0; i<32; i++) {
          const val = regs[i] ?? 0;
          if (val !== prevRegs[i]) activityLevels[i] = 1.0;
          else activityLevels[i] *= 0.94; // Decay
          prevRegs[i] = val;
          activityData[i * 4] = (activityLevels[i] * 255) | 0;
          activityData[i * 4 + 3] = 255;
      }
      activityTex.needsUpdate = true;
      
      const time = performance.now() / 1000.0;
      regMeshes.forEach(mesh => {
          (mesh.material as THREE.ShaderMaterial).uniforms.time.value = time;
      });

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('mousemove', onMouseMove);
      ro.disconnect();
      controls.dispose();
      regMeshes.forEach(m => { m.geometry.dispose(); (m.material as THREE.Material).dispose(); });
      activityTex.dispose();
      renderer.dispose();
    };
  }, []);

  const currentRegValue = hoveredReg !== null ? (player?.volatileRegs[hoveredReg] ?? 0) : null;

  return (
    <div ref={containerRef} className="w-full h-full bg-transparent font-mono overflow-hidden relative rounded-xl shadow-2xl group border border-white/5">
      {/* 3D HUD OVERLAY */}
      <div className="absolute top-6 left-6 z-40 flex flex-col gap-1 pointer-events-none transition-all duration-500">
          <h3 className="text-[16px] font-black text-white tracking-[0.4em] uppercase italic glow-text flex items-center gap-3">
              <Cpu className="w-5 h-5 text-cyan-400" /> SILICON_DIE_TOPOLOGY
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-cyan-500 font-black uppercase tracking-[0.3em]">GATE_ARRAY_MAP: MOS_{model}</span>
            <div className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-emerald-500 animate-pulse shadow-[0_0_12px_emerald]' : 'bg-slate-800'}`}></div>
          </div>
      </div>

      {/* REGISTER PROPERTY HUD */}
      {hoveredReg !== null && (
          <div className="absolute top-6 right-6 z-50 bg-black/80 backdrop-blur-xl border border-cyan-500/50 p-4 rounded-xl shadow-[0_0_40px_rgba(34,211,238,0.2)] animate-in fade-in zoom-in-95 duration-100 min-w-[180px]">
              <div className="flex flex-col gap-1">
                  <span className="text-[8px] text-cyan-600 font-black uppercase tracking-widest">BUS_ADDR_$${hoveredReg.toString(16).toUpperCase()}</span>
                  <div className="flex items-baseline justify-between">
                      <span className="text-white font-black text-xl tracking-tighter">{REG_NAMES[hoveredReg]}</span>
                      <span className="text-cyan-400 font-mono font-black text-lg">${currentRegValue?.toString(16).toUpperCase().padStart(2, '0')}</span>
                  </div>
                  <div className="h-0.5 bg-slate-900 rounded-full mt-2 overflow-hidden">
                      <div className="h-full bg-cyan-500 shadow-[0_0_10px_cyan] transition-all" style={{ width: `${((currentRegValue ?? 0) / 255) * 100}%` }}></div>
                  </div>
              </div>
          </div>
      )}
      
      {/* COMPONENT LEGEND */}
      <div className="absolute bottom-6 left-6 z-40 grid grid-cols-2 gap-x-8 gap-y-2 pointer-events-none bg-black/40 p-4 rounded-2xl border border-white/5 backdrop-blur-md opacity-0 group-hover:opacity-100 transition-all duration-500">
          {REG_GROUPS.map(g => (
              <div key={g.label} className="flex items-start gap-3">
                  <div className="w-2.5 h-2.5 rounded-sm mt-1 shadow-sm" style={{ backgroundColor: `#${g.color.toString(16).padStart(6, '0')}` }}></div>
                  <div className="flex flex-col">
                    <span className="text-[8px] font-black text-white tracking-[0.2em] uppercase leading-none">{g.label}</span>
                    <span className="text-[6px] text-slate-500 font-bold uppercase tracking-tight">{g.desc}</span>
                  </div>
              </div>
          ))}
      </div>

      <div className="absolute bottom-6 right-6 pointer-events-none opacity-40 group-hover:opacity-100 transition-opacity">
          <span className="text-[7px] text-slate-700 font-black uppercase tracking-widest">GPU_ACCELERATED_MAPPING_STABLE</span>
      </div>

      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block cursor-crosshair" />
    </div>
  );
});

export default SidChipVisualizer;
