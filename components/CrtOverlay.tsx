
import React from 'react';

const CrtOverlay: React.FC = () => {
  return (
    <div className="pointer-events-none fixed inset-0 z-[1000] w-full h-full overflow-hidden select-none crt-container">
        
        {/* 1. Curved Vignette (Dark corners + rounded physical screen) */}
        <div className="absolute inset-0 z-[60] vignette"></div>
        
        {/* 2. Scanlines (The horizontal beam traces) */}
        <div className="absolute inset-0 z-40 opacity-[0.25] pointer-events-none mix-blend-multiply scanlines"></div>

        {/* 3. Aperture Grille / Phosphor Mesh (RGB Triads) */}
        <div className="absolute inset-0 z-50 opacity-[0.15] pointer-events-none mix-blend-color-dodge aperture"></div>

        {/* 4. Chromatic Aberration & Glow (Simulates electron beam spread) */}
        <div className="absolute inset-0 z-30 pointer-events-none mix-blend-screen opacity-[0.08] glow-aberration"></div>

        {/* 5. Signal Noise (RF Interference / Snow) */}
        <div className="absolute inset-0 z-20 opacity-[0.04] animate-noise pointer-events-none mix-blend-overlay"></div>

        {/* 6. Rolling Hum Bar (60Hz Mains Hum Interference) */}
        <div className="absolute inset-0 z-20 bg-gradient-to-b from-transparent via-white/5 to-transparent h-[15vh] w-full animate-scanline pointer-events-none mix-blend-screen opacity-[0.15]"></div>

        {/* 7. Interlacing Flicker */}
        <div className="absolute inset-0 z-[100] bg-white animate-flicker pointer-events-none mix-blend-overlay opacity-[0.03]"></div>

        <style>{`
            .crt-container {
                /* Barrel Distortion (Curvature) */
                /* Note: Real curvature requires WebGL/Canvas or heavy SVG filters. 
                   This uses a radial gradient hack to simulate depth/curvature darkening at edges. */
                background: radial-gradient(circle at center, transparent 60%, rgba(0,0,0,0.4) 100%);
            }

            .vignette {
                background: radial-gradient(circle, rgba(0,0,0,0) 60%, rgba(0,0,0,0.85) 100%);
                box-shadow: inset 0 0 150px rgba(0,0,0,0.9);
            }

            .scanlines {
                background: linear-gradient(
                    to bottom,
                    rgba(255,255,255,0),
                    rgba(255,255,255,0) 50%,
                    rgba(0,0,0,0.5) 50%,
                    rgba(0,0,0,0.5)
                );
                background-size: 100% 4px;
            }

            .aperture {
                background-image: linear-gradient(90deg, rgba(255, 0, 0, 0.5), rgba(0, 255, 0, 0.5), rgba(0, 0, 255, 0.5));
                background-size: 3px 100%;
            }

            .glow-aberration {
                background: radial-gradient(circle at center, rgba(34, 211, 238, 0.4) 0%, transparent 80%);
                filter: blur(10px) contrast(1.2);
            }

            @keyframes scanline {
                0% { transform: translateY(-100%); }
                100% { transform: translateY(1000%); }
            }

            @keyframes noise {
                0%, 100% { background-position: 0 0; }
                10% { background-position: -5% -10%; }
                20% { background-position: -15% 5%; }
                30% { background-position: 7% -25%; }
                40% { background-position: 20% 25%; }
                50% { background-position: -25% 10%; }
                60% { background-position: 15% 5%; }
                70% { background-position: 0% 15%; }
                80% { background-position: 25% 35%; }
                90% { background-position: -10% 10%; }
            }

            @keyframes flicker {
                0% { opacity: 0.02; }
                5% { opacity: 0.05; }
                10% { opacity: 0.02; }
                15% { opacity: 0.06; }
                20% { opacity: 0.02; }
                50% { opacity: 0.02; }
                55% { opacity: 0.05; }
                60% { opacity: 0.02; }
                100% { opacity: 0.02; }
            }

            .animate-scanline {
                animation: scanline 8s linear infinite;
            }

            .animate-noise {
                animation: noise 0.2s steps(2) infinite;
                background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
            }

            .animate-flicker {
                animation: flicker 0.1s infinite;
            }
            
            /* Chromatic Aberration Shift Simulation on Text/Elements below (Global effect) */
            /* This targets the body or app container usually, but here we simulate it via a mix-blend overlay with offset */
            .crt-container::before {
                content: " ";
                display: block;
                position: absolute;
                top: 0;
                left: 0;
                bottom: 0;
                right: 0;
                background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06));
                z-index: 2;
                background-size: 100% 2px, 3px 100%;
                pointer-events: none;
            }
        `}</style>
    </div>
  );
};

export default CrtOverlay;
