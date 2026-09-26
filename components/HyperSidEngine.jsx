
import React, { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { PARTICLE_VERTEX_SHADER, PARTICLE_FRAGMENT_SHADER, CRT_FRAGMENT_SHADER, CRT_VERTEX_SHADER } from './HyperSidShaders';

const HyperSidEngine = ({ player, isPlaying = true }) => {
    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    const rendererRef = useRef(null);
    const sceneRef = useRef(null);
    const cameraRef = useRef(null);
    const composerRef = useRef(null);
    const particleSystems = useRef([]);
    const frameId = useRef(0);

    useEffect(() => {
        if (!containerRef.current) return;
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;

        // 1. Setup Scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x020205);
        sceneRef.current = scene;

        const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);
        camera.position.z = 50;
        cameraRef.current = camera;

        const renderer = new THREE.WebGLRenderer({ 
            canvas: canvasRef.current, 
            antialias: false,
            powerPreference: "high-performance"
        });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        rendererRef.current = renderer;

        // 2. Setup Post-Processing
        const composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene, camera));

        // Bloom for neon glow
        const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 1.5, 0.4, 0.85);
        composer.addPass(bloomPass);

        // CRT / Chromatic Aberration Pass
        const crtPass = new ShaderPass({
            uniforms: {
                tDiffuse: { value: null },
                tPersistence: { value: null },
                resolution: { value: new THREE.Vector2(w, h) },
                time: { value: 0 },
                persistenceDecay: { value: 0.92 }
            },
            vertexShader: CRT_VERTEX_SHADER,
            fragmentShader: CRT_FRAGMENT_SHADER
        });
        composer.addPass(crtPass);
        composerRef.current = composer;

        // 3. Create Particle Systems for 3 Voices
        const colors = [
            new THREE.Color(0x00ffff), // Voice 1: Cyan
            new THREE.Color(0xff00ff), // Voice 2: Magenta
            new THREE.Color(0xffaa00)  // Voice 3: Amber
        ];

        particleSystems.current = colors.map((color, i) => {
            const count = 2000;
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(count * 3);
            const phases = new Float32Array(count);
            const velocities = new Float32Array(count * 3);

            for(let j=0; j<count; j++) {
                positions[j*3] = (Math.random() - 0.5) * 60;
                positions[j*3+1] = (Math.random() - 0.5) * 20 + (i - 1) * 15;
                positions[j*3+2] = (Math.random() - 0.5) * 10;
                phases[j] = Math.random() * Math.PI * 2;
                velocities[j*3] = (Math.random() - 0.5) * 0.5;
                velocities[j*3+1] = 0;
                velocities[j*3+2] = 0;
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
            geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    time: { value: 0 },
                    amplitude: { value: 0 },
                    color: { value: color }
                },
                vertexShader: PARTICLE_VERTEX_SHADER,
                fragmentShader: PARTICLE_FRAGMENT_SHADER,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            });

            const points = new THREE.Points(geometry, material);
            scene.add(points);
            return { mesh: points, material, geometry };
        });

        // 4. Animation Loop
        const animate = () => {
            const time = performance.now() * 0.001;
            
            // Fetch Real Voice State
            const vStates = player?.volatileVoiceStates || [{level:0, freq:0}, {level:0, freq:0}, {level:0, freq:0}];
            
            particleSystems.current.forEach((sys, i) => {
                const state = vStates[i] || { level: 0, freq: 0 };
                const level = state.level || 0;
                
                // Update Uniforms
                sys.material.uniforms.time.value = time;
                // Amplitude driven by envelope level
                sys.material.uniforms.amplitude.value = 1.0 + level * 5.0; 
                
                // Modulate color brightness by level
                const baseColor = colors[i];
                sys.material.uniforms.color.value.copy(baseColor).multiplyScalar(0.5 + level * 2.0);

                // Rotate system based on frequency
                const freqNorm = (state.freq || 0) / 65535;
                sys.mesh.rotation.y += 0.002 + freqNorm * 0.05;
                sys.mesh.rotation.z = Math.sin(time * 0.5) * 0.1;
                
                // Jitter positions for active notes
                if (level > 0.01) {
                    const positions = sys.geometry.attributes.position.array;
                    for(let k=0; k<positions.length; k+=3) {
                        positions[k] += (Math.random()-0.5) * 0.1 * level;
                    }
                    sys.geometry.attributes.position.needsUpdate = true;
                }
            });

            crtPass.uniforms.time.value = time;
            composer.render();
            frameId.current = requestAnimationFrame(animate);
        };
        
        animate();

        // Resize Handler
        const handleResize = () => {
            if (!containerRef.current) return;
            const nw = containerRef.current.clientWidth;
            const nh = containerRef.current.clientHeight;
            camera.aspect = nw / nh;
            camera.updateProjectionMatrix();
            renderer.setSize(nw, nh);
            composer.setSize(nw, nh);
            crtPass.uniforms.resolution.value.set(nw, nh);
        };
        window.addEventListener('resize', handleResize);

        return () => {
            cancelAnimationFrame(frameId.current);
            window.removeEventListener('resize', handleResize);
            if (rendererRef.current) rendererRef.current.dispose();
            if (sceneRef.current) sceneRef.current.clear();
        };
    }, [player]);

    return (
        <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-black">
            <canvas ref={canvasRef} className="block w-full h-full" />
            <div className="absolute top-4 left-4 z-10 pointer-events-none">
                <h2 className="text-cyan-500 font-black text-xs tracking-[0.5em] uppercase glow-text">HYPER_SID_ENGINE</h2>
                <span className="text-[9px] text-slate-500 font-mono">WEBGL2_PARTICLE_COMPUTE</span>
            </div>
        </div>
    );
};

export default HyperSidEngine;
