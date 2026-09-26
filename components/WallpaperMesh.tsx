
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { SidPlayer } from '../services/sidService';

interface WallpaperMeshProps {
    player: SidPlayer | null;
    imageSrc: string;
    opacity?: number;
}

const VERTEX_SHADER = `
uniform float uTime;
varying vec2 vUv;
varying float vElevation;

void main() {
    vUv = uv;
    vec3 pos = position;
    
    // Radial distance from center
    float dist = distance(uv, vec2(0.5));
    
    // Ultra-smooth, non-reactive "breathing" motion
    // Low frequency, low amplitude to ensure background stability
    float flow = sin(uv.x * 2.0 + uTime * 0.15) * cos(uv.y * 1.5 + uTime * 0.1);
    float elevation = flow * 0.03;
    
    pos.z += elevation;
    vElevation = elevation;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const FRAGMENT_SHADER = `
uniform sampler2D uTexture;
uniform float uOpacity;
varying vec2 vUv;
varying float vElevation;

void main() {
    // Very subtle chromatic shift based on elevation (simulating lens dispersion)
    float shift = vElevation * 0.003; 
    
    vec4 cr = texture2D(uTexture, vUv + vec2(shift, 0.0));
    vec4 cg = texture2D(uTexture, vUv);
    vec4 cb = texture2D(uTexture, vUv - vec2(shift, 0.0));
    
    vec3 color = vec3(cr.r, cg.g, cb.b);
    
    // Smooth ambient occlusion/lighting from folds
    float light = 1.0 + vElevation * 0.2;
    color *= light;
    
    gl_FragColor = vec4(color, uOpacity);
}
`;

const WallpaperMesh: React.FC<WallpaperMeshProps> = ({ player, imageSrc, opacity = 0.4 }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const materialRef = useRef<THREE.ShaderMaterial | null>(null);
    const animationFrameRef = useRef<number>(0);

    useEffect(() => {
        if (!containerRef.current) return;

        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;

        // Scene Setup
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
        camera.position.z = 2.5; 

        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        containerRef.current.appendChild(renderer.domElement);

        // Texture Loader
        const loader = new THREE.TextureLoader();
        loader.load(imageSrc, (texture) => {
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            
            const imageAspect = texture.image.width / texture.image.height;
            
            // Calculate scale to cover screen
            const fovRad = (camera.fov * Math.PI) / 180;
            const visibleHeight = 2 * Math.tan(fovRad / 2) * camera.position.z;
            const visibleWidth = visibleHeight * camera.aspect;

            let planeW = visibleWidth;
            let planeH = visibleWidth / imageAspect;
            
            if (planeH < visibleHeight) {
                planeH = visibleHeight;
                planeW = planeH * imageAspect;
            }

            // High segment count for smooth liquid vertex displacement
            const geometry = new THREE.PlaneGeometry(planeW, planeH, 96, 96); 
            
            const material = new THREE.ShaderMaterial({
                vertexShader: VERTEX_SHADER,
                fragmentShader: FRAGMENT_SHADER,
                uniforms: {
                    uTime: { value: 0 },
                    uTexture: { value: texture },
                    uOpacity: { value: opacity }
                },
                transparent: true
            });
            materialRef.current = material;

            const mesh = new THREE.Mesh(geometry, material);
            scene.add(mesh);
        });

        sceneRef.current = scene;
        rendererRef.current = renderer;

        const animate = () => {
            const time = performance.now() * 0.001;
            
            if (materialRef.current) {
                materialRef.current.uniforms.uTime.value = time;
                materialRef.current.uniforms.uOpacity.value = opacity;
            }

            renderer.render(scene, camera);
            animationFrameRef.current = requestAnimationFrame(animate);
        };

        animate();

        const handleResize = () => {
            if (!containerRef.current || !rendererRef.current) return;
            const newW = containerRef.current.clientWidth;
            const newH = containerRef.current.clientHeight;
            camera.aspect = newW / newH;
            camera.updateProjectionMatrix();
            rendererRef.current.setSize(newW, newH);
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            cancelAnimationFrame(animationFrameRef.current);
            if (rendererRef.current && containerRef.current) {
                containerRef.current.removeChild(rendererRef.current.domElement);
                rendererRef.current.dispose();
            }
        };
    }, [imageSrc, opacity]); 

    return <div ref={containerRef} className="absolute inset-0 z-0 pointer-events-none" />;
};

export default WallpaperMesh;
