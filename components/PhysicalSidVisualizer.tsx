
import React, { useEffect, useRef, memo, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Activity, Zap, Thermometer, ShieldCheck, Sliders, Maximize2, Minimize2, Radio, Info, RotateCcw, AlertCircle, Cpu, Layers } from 'lucide-react';
import { SidPlayer, getRegsAtCycle } from '../services/sidService';
import { SidGpuEngine } from '../sid_gpu_engine';
import { buildPhotonicSid } from '../sid_visual_sim';
import { ParsedTrace } from '../types';

const CAMERA_CONFIG = {
  FOV: 28, NEAR: 0.001, FAR: 10, POSITION: new THREE.Vector3(0.14, 0.1, 0.14), TARGET: new THREE.Vector3(0, 0.003, 0),
} as const;

const ScanlinesShader = {
  uniforms: { tDiffuse: { value: null }, intensity: { value: 0.5 }, count: { value: 800.0 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float intensity; uniform float count; varying vec2 vUv; void main() { vec4 color = texture2D(tDiffuse, vUv); float scanline = sin(vUv.y * count) * 0.5 + 0.5; scanline = mix(1.0, scanline, intensity); gl_FragColor = vec4(color.rgb * scanline, color.a); }`
};

export const PhysicalSidVisualizer: React.FC<any> = memo(({ player, isPlaying, model, trace, visualLead, interpolatedCycles }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<SidGpuEngine | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const rafRef = useRef<number>(0);
    const [error, setError] = useState<Error | null>(null);
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      let mounted = true;

      const onContextLost = (ev: Event) => {
        ev.preventDefault();
        console.warn("WebGL Context Lost");
        if(rafRef.current) cancelAnimationFrame(rafRef.current);
        setError(new Error("WebGL Context Lost. Reloading..."));
        setTimeout(() => window.location.reload(), 1000); 
      };
      
      canvas.addEventListener('webglcontextlost', onContextLost as any, false);

      try {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(CAMERA_CONFIG.FOV, 1, CAMERA_CONFIG.NEAR, CAMERA_CONFIG.FAR);
        camera.position.copy(CAMERA_CONFIG.POSITION);

        const renderer = new THREE.WebGLRenderer({
          canvas,
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance'
        });
        rendererRef.current = renderer;
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(container.clientWidth, container.clientHeight);

        const engine = new SidGpuEngine(renderer);
        engineRef.current = engine;

        const composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene, camera));
        composer.addPass(new ShaderPass(ScanlinesShader));

        const sid = buildPhotonicSid({ model, accent: new THREE.Color(0x00f2ff) });
        scene.add(sid);

        const animate = (time: number) => {
            if (!mounted) return;
            rafRef.current = requestAnimationFrame(animate);
            const t = time / 1000;
            const regs = player ? player.volatileRegs : new Array(32).fill(0);
            
            // Safe engine step
            if(engineRef.current) {
                engineRef.current.step(0.016, t, regs, 985248);
                // Update visuals...
                (sid as any).tick(0.016, t, engineRef.current.state, engineRef.current.field, engineRef.current.flux, engineRef.current.litho, engineRef.current.stress, engineRef.current.arcs, engineRef.current.thermal, engineRef.current.aging, regs, {});
            }
            composer.render();
        };
        
        rafRef.current = requestAnimationFrame(animate);
        setIsReady(true);

        return () => {
            mounted = false;
            cancelAnimationFrame(rafRef.current);
            canvas.removeEventListener('webglcontextlost', onContextLost as any);
            renderer.dispose();
            engine.dispose();
        };
      } catch (err) {
          setError(err as Error);
      }
    }, [model]);

    if (error) return <div className="p-10 text-red-500 bg-black text-center border border-red-900 rounded-xl">GPU Error: {error.message}</div>;

    return (
        <div ref={containerRef} className="w-full h-full bg-black rounded-xl overflow-hidden relative border border-white/5">
            {!isReady && <div className="absolute inset-0 flex items-center justify-center text-cyan-500 animate-pulse font-mono font-bold">BOOTING GPU CORE...</div>}
            <canvas ref={canvasRef} className="w-full h-full block" />
        </div>
    );
});

export default PhysicalSidVisualizer;
