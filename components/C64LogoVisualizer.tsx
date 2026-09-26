
import React, { useEffect, useRef, memo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Cpu, Box } from 'lucide-react';

const C64LogoVisualizer: React.FC = memo(() => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        if (!container || !canvas) return;

        // --- Scene Setup ---
        const scene = new THREE.Scene();
        // Transparent background for wallpaper visibility
        
        const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
        camera.position.set(0, 0, 15);

        const renderer = new THREE.WebGLRenderer({ 
            canvas, 
            antialias: true, 
            alpha: true,
            powerPreference: 'high-performance'
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 2.0;

        // --- Lighting ---
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        scene.add(ambientLight);

        const spotLight = new THREE.SpotLight(0xffffff, 500);
        spotLight.position.set(10, 10, 10);
        spotLight.angle = 0.5;
        spotLight.penumbra = 0.5;
        scene.add(spotLight);

        const blueLight = new THREE.PointLight(0x0088ff, 200, 20);
        blueLight.position.set(-5, 5, 5);
        scene.add(blueLight);

        const redLight = new THREE.PointLight(0xff4400, 200, 20);
        redLight.position.set(5, -5, 5);
        scene.add(redLight);

        // --- C64 Logo Construction (Procedural High-Res) ---
        const logoGroup = new THREE.Group();

        const extrudeSettings = {
            depth: 1.5,
            bevelEnabled: true,
            bevelThickness: 0.1,
            bevelSize: 0.1,
            bevelSegments: 5,
            steps: 4,
            curveSegments: 64 // High resolution curves
        };

        // 1. The 'C' Blue Shape
        const cShape = new THREE.Shape();
        const outerRadius = 4;
        const innerRadius = 2.2;
        const startAngle = 0.5;
        const endAngle = Math.PI * 2 - 0.5;

        cShape.absarc(0, 0, outerRadius, startAngle, endAngle, false);
        cShape.absarc(0, 0, innerRadius, endAngle, startAngle, true); // Go back inside
        cShape.closePath();

        const cMat = new THREE.MeshPhysicalMaterial({
            color: 0x40318d, // C64 Blue
            metalness: 0.6,
            roughness: 0.2,
            clearcoat: 1.0,
            clearcoatRoughness: 0.1,
            emissive: 0x100830,
            emissiveIntensity: 0.2
        });

        const cMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(cShape, extrudeSettings), cMat);
        cMesh.position.z = -0.75; // Center depth
        logoGroup.add(cMesh);

        // 2. The Bars (Red/Orange)
        const barShape = new THREE.Shape();
        // Create a horizontal bar with rounded corners on the left
        const barW = 4.2;
        const barH = 0.8;
        const barX = 1.8;
        
        // Draw one bar
        barShape.moveTo(0, 0);
        barShape.lineTo(barW, 0);
        barShape.lineTo(barW + 0.5, barH/2); // Pointy tip simulation or flat? Standard is flat but lets skew slightly for 3D effect
        barShape.lineTo(barW, barH);
        barShape.lineTo(0, barH);
        barShape.lineTo(-0.5, barH/2);
        barShape.lineTo(0, 0);

        const barMat = new THREE.MeshPhysicalMaterial({
            color: 0xe64a4e, // C64 Red/Light Red
            metalness: 0.4,
            roughness: 0.3,
            clearcoat: 1.0,
            emissive: 0x501010,
            emissiveIntensity: 0.4
        });

        const bar1 = new THREE.Mesh(new THREE.ExtrudeGeometry(barShape, extrudeSettings), barMat);
        bar1.position.set(0.5, 0.4, -0.75);
        bar1.rotation.z = 0.1; // Slight tilt for dynamic look
        logoGroup.add(bar1);

        const bar2 = new THREE.Mesh(new THREE.ExtrudeGeometry(barShape, extrudeSettings), barMat);
        bar2.position.set(1.2, -1.6, -0.75);
        bar2.rotation.z = -0.05;
        logoGroup.add(bar2);

        // Center the group
        new THREE.Box3().setFromObject(logoGroup).getCenter(logoGroup.position).multiplyScalar(-1);
        scene.add(logoGroup);

        // --- Grid Floor ---
        const gridHelper = new THREE.GridHelper(40, 40, 0x00ffff, 0x111122);
        gridHelper.position.y = -6;
        (gridHelper.material as THREE.Material).transparent = true;
        (gridHelper.material as THREE.Material).opacity = 0.15;
        scene.add(gridHelper);

        // --- Floating Particles ---
        const particlesGeo = new THREE.BufferGeometry();
        const pCount = 200;
        const pPos = new Float32Array(pCount * 3);
        for(let i=0; i<pCount*3; i++) {
            pPos[i] = (Math.random() - 0.5) * 30;
        }
        particlesGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
        const pMat = new THREE.PointsMaterial({
            color: 0x22d3ee,
            size: 0.1,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending
        });
        const particles = new THREE.Points(particlesGeo, pMat);
        scene.add(particles);

        // --- Animation Loop ---
        let rafId: number;
        const animate = (time: number) => {
            rafId = requestAnimationFrame(animate);
            controls.update();
            
            // Bobbing effect
            logoGroup.position.y = Math.sin(time * 0.001) * 0.5;
            
            // Particle rotation
            particles.rotation.y = time * 0.0005;
            particles.rotation.z = time * 0.0002;

            // Dynamic light pulses
            blueLight.intensity = 200 + Math.sin(time * 0.005) * 50;
            redLight.intensity = 200 + Math.cos(time * 0.004) * 50;

            renderer.render(scene, camera);
        };
        animate(0);

        // --- Resize Handler ---
        const handleResize = () => {
            if (!container) return;
            camera.aspect = container.clientWidth / container.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(container.clientWidth, container.clientHeight);
        };
        window.addEventListener('resize', handleResize);

        return () => {
            cancelAnimationFrame(rafId);
            window.removeEventListener('resize', handleResize);
            renderer.dispose();
            controls.dispose();
            // Dispose geometries
            logoGroup.traverse((o: any) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) o.material.dispose();
            });
        };
    }, []);

    return (
        <div ref={containerRef} className="w-full h-full relative overflow-hidden group">
            {/* Background elements to integrate with wallpaper */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/20 to-black/60 pointer-events-none"></div>
            
            <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full" />

            {/* Overlay UI */}
            <div className="absolute bottom-12 left-12 pointer-events-none flex flex-col gap-2">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-slate-900/80 border border-white/10 rounded-2xl backdrop-blur-md shadow-[0_0_30px_rgba(0,0,0,0.5)]">
                        <Cpu className="w-8 h-8 text-cyan-400" />
                    </div>
                    <div className="flex flex-col">
                        <h1 className="text-3xl font-black text-white tracking-tighter italic glow-text">COMMODORE 64</h1>
                        <span className="text-[10px] text-cyan-500 font-bold tracking-[0.5em] uppercase">High Fidelity Model</span>
                    </div>
                </div>
                <div className="h-px w-32 bg-gradient-to-r from-cyan-500 to-transparent my-2"></div>
                <p className="text-[9px] text-slate-400 font-mono max-w-[200px] leading-relaxed">
                    Personal Computer System.<br/>
                    64K RAM System.<br/>
                    BASIC V2.
                </p>
            </div>

            <div className="absolute top-12 right-12 pointer-events-none">
                <div className="flex items-center gap-2 px-4 py-2 bg-black/60 rounded-full border border-white/10 backdrop-blur-md">
                    <Box className="w-3 h-3 text-emerald-500 animate-spin-slow" />
                    <span className="text-[8px] font-black text-white uppercase tracking-widest">3D_VIEWPORT_ACTIVE</span>
                </div>
            </div>
        </div>
    );
});

export default C64LogoVisualizer;
