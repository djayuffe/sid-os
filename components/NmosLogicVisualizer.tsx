
import React, { useEffect, useRef, memo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SidPlayer } from '../services/sidService';

const NMOS_HDR_VERTEX_SHADER = `
precision highp float;
varying vec3 vNormal;
varying vec3 vPosition;
varying float vPower;
attribute float bitIdx;
uniform sampler2D uPowerTex; // 36x1
uniform float time;

float fetchPower(float idx) {
  float u = (idx + 0.5) / 36.0;
  return texture2D(uPowerTex, vec2(u, 0.5)).r;
}

void main() {
  vNormal = normalize(normalMatrix * normal);
  float p = fetchPower(bitIdx);
  vPower = p;
  vec3 pos = position;
  float jitter = sin(time * 50.0 + bitIdx * 10.0) * p * 0.02;
  pos.y += jitter;
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  vPosition = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const NMOS_HDR_FRAGMENT_SHADER = `
precision highp float;
varying vec3 vNormal;
varying vec3 vPosition;
varying float vPower;
uniform vec3 baseColor;
uniform float time;

void main() {
  vec3 color = baseColor * 0.2;
  // Logic Pulse Glow
  float pulse = 0.5 + 0.5 * sin(time * 20.0 + vPosition.x * 10.0);
  vec3 activeCol = mix(color, vec3(1.0), vPower * pulse);
  
  // Edge highlight
  float fresnel = pow(1.0 - max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0))), 3.0);
  activeCol += baseColor * fresnel * vPower * 2.0;
  
  gl_FragColor = vec4(activeCol, 1.0);
}
`;

const NmosLogicVisualizer: React.FC<any> = memo(({ player, isPlaying }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<SidPlayer | null>(player);
  
  useEffect(() => { playerRef.current = player; }, [player]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.z = 20;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    
    // Logic State Texture
    const powerData = new Uint8Array(36 * 4);
    const powerTex = new THREE.DataTexture(powerData, 36, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    
    const mat = new THREE.ShaderMaterial({
        vertexShader: NMOS_HDR_VERTEX_SHADER,
        fragmentShader: NMOS_HDR_FRAGMENT_SHADER,
        uniforms: {
            uPowerTex: { value: powerTex },
            baseColor: { value: new THREE.Color(0x00ff00) },
            time: { value: 0 }
        }
    });

    // Create Transistor Array
    for(let i=0; i<36; i++) {
        const geo = new THREE.BoxGeometry(0.5, 2, 0.5);
        const attr = new Float32Array(geo.attributes.position.count).fill(i);
        geo.setAttribute('bitIdx', new THREE.BufferAttribute(attr, 1));
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set((i % 12 - 5.5) * 1.5, Math.floor(i / 12) * 4 - 4, 0);
        scene.add(mesh);
    }

    let raf = 0;
    const animate = () => {
        raf = requestAnimationFrame(animate);
        const time = performance.now() / 1000;
        mat.uniforms.time.value = time;
        
        if (playerRef.current) {
            const regs = playerRef.current.volatileRegs;
            // Map Voice Control Registers (Gate/Waveform) to Visuals
            // Voice 1: Reg 4 -> Bits 0-7 mapped to index 0-7
            // Voice 2: Reg 11 -> Bits 0-7 mapped to index 12-19
            // Voice 3: Reg 18 -> Bits 0-7 mapped to index 24-31
            
            const mapReg = (regVal: number, offset: number) => {
                for(let b=0; b<8; b++) {
                    const active = (regVal >> b) & 1;
                    const idx = (offset + b) * 4;
                    powerData[idx] = active ? 255 : 0; // R
                }
            };
            
            mapReg(regs[4], 0);
            mapReg(regs[11], 12);
            mapReg(regs[18], 24);
            
            powerTex.needsUpdate = true;
        }
        
        renderer.render(scene, camera);
    };
    animate();
    
    return () => { cancelAnimationFrame(raf); renderer.dispose(); };
  }, []);

  return <div ref={containerRef} className="w-full h-full"><canvas ref={canvasRef} className="w-full h-full" /></div>;
});

export default NmosLogicVisualizer;
