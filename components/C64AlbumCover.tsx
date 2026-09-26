
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { SidHeader } from '../types';
import { Upload, Image as ImageIcon, RefreshCw, Maximize, Check, Move, ZoomIn, Wallpaper } from 'lucide-react';

// C64 Palette (Pepto)
const C64_PALETTE = [
    [0, 0, 0],       // Black
    [255, 255, 255], // White
    [136, 0, 0],     // Red
    [170, 255, 238], // Cyan
    [204, 68, 204],  // Purple
    [0, 204, 85],    // Green
    [0, 0, 170],     // Blue
    [238, 238, 119], // Yellow
    [221, 136, 85],  // Orange
    [102, 68, 0],    // Brown
    [255, 119, 119], // Light Red
    [51, 51, 51],    // Dark Grey
    [119, 119, 119], // Grey
    [170, 255, 102], // Light Green
    [0, 136, 255],   // Light Blue
    [187, 187, 187]  // Light Grey
];

const BAYER_MATRIX_4x4 = [
    [ 0,  8,  2, 10],
    [12,  4, 14,  6],
    [ 3, 11,  1,  9],
    [15,  7, 13,  5]
];

interface C64AlbumSettings {
    scale: number;
    x: number;
    y: number;
    dither: number;
}

interface C64AlbumCoverProps {
    header?: SidHeader;
    isPlaying: boolean;
    imageSrc: string | null;
    setImageSrc: (src: string | null) => void;
    settings: C64AlbumSettings;
    setSettings: (s: C64AlbumSettings) => void;
    onSetWallpaper: (dataUrl: string) => void;
}

const C64AlbumCover: React.FC<C64AlbumCoverProps> = ({ 
    header, isPlaying, imageSrc, setImageSrc, settings, setSettings, onSetWallpaper 
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sourceImgRef = useRef<HTMLImageElement | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [isActiveMode, setIsActiveMode] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });
    const [showControls, setShowControls] = useState(true);

    // Load Image Element from prop URL
    useEffect(() => {
        if (imageSrc) {
            const img = new Image();
            img.onload = () => {
                sourceImgRef.current = img;
                renderFrame();
            };
            img.src = imageSrc;
        } else {
            sourceImgRef.current = null;
            renderFrame(); // Render procedural fallback
        }
    }, [imageSrc]);

    const renderFrame = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = 320;
        const h = 200;
        canvas.width = w;
        canvas.height = h;

        // --- 1. Draw Content (Image or Procedural) ---
        if (sourceImgRef.current) {
            const img = sourceImgRef.current;
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, w, h);

            if (img.width > 0 && img.height > 0) {
                // Calculate 'Cover' Aspect Fit
                const aspect = img.width / img.height;
                const targetAspect = w / h;
                let baseScale = 1;
                
                if (aspect > targetAspect) {
                    baseScale = h / img.height;
                } else {
                    baseScale = w / img.width;
                }

                const scale = baseScale * settings.scale;
                
                ctx.save();
                ctx.translate(w / 2 + settings.x, h / 2 + settings.y);
                ctx.scale(scale, scale);
                ctx.drawImage(img, -img.width / 2, -img.height / 2);
                ctx.restore();

                // Get ImageData for Dithering
                const imgData = ctx.getImageData(0, 0, w, h);
                const data = imgData.data;

                // --- 2. Dither & Quantize ---
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const i = (y * w + x) * 4;
                        const mapVal = BAYER_MATRIX_4x4[y % 4][x % 4];
                        const threshold = (mapVal / 16 - 0.5) * settings.dither * 255;

                        const dR = Math.max(0, Math.min(255, data[i] + threshold));
                        const dG = Math.max(0, Math.min(255, data[i+1] + threshold));
                        const dB = Math.max(0, Math.min(255, data[i+2] + threshold));

                        let bestDist = Infinity;
                        let bestCol = C64_PALETTE[0];

                        // Simple Euclidean color match
                        for (const col of C64_PALETTE) {
                            const dist = (dR - col[0])**2 + (dG - col[1])**2 + (dB - col[2])**2;
                            if (dist < bestDist) {
                                bestDist = dist;
                                bestCol = col;
                            }
                        }

                        data[i] = bestCol[0];
                        data[i+1] = bestCol[1];
                        data[i+2] = bestCol[2];
                    }
                }
                ctx.putImageData(imgData, 0, 0);
            }

        } else {
            // Procedural Fallback
            ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#111111'; 
            ctx.fillRect(0, 0, w, 20); ctx.fillRect(0, h-20, w, 20);
            ctx.fillRect(0, 0, 20, h); ctx.fillRect(w-20, 0, 20, h);

            ctx.font = '20px monospace';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            
            const title = header?.song || "UNKNOWN TITLE";
            const author = header?.author || "UNKNOWN AUTHOR";
            
            ctx.fillStyle = '#444'; ctx.fillText(title.substring(0, 20).toUpperCase(), w/2 + 2, h/2 - 20 + 2);
            ctx.fillStyle = '#EEEE77'; ctx.fillText(title.substring(0, 20).toUpperCase(), w/2, h/2 - 20);
            ctx.fillStyle = '#777777'; ctx.font = '12px monospace';
            ctx.fillText(author.substring(0, 30).toUpperCase(), w/2, h/2 + 10);

            if (!isActiveMode) {
                ctx.fillStyle = '#CC44CC'; ctx.fillText("DROP IMAGE", w/2, h - 30);
            }
            ctx.fillStyle = 'rgba(0,0,0,0.2)';
            for(let y=0; y<h; y+=2) ctx.fillRect(0, y, w, 1);
        }

        // --- 3. Overlays ---
        if (!isActiveMode) {
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(0, h-12, w, 12);
            ctx.font = '8px monospace';
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'left';
            ctx.fillText((header?.song || "TRACK").toUpperCase(), 4, h-3);
        }

    }, [sourceImgRef.current, settings, isActiveMode, header]);

    // Redraw when deps change
    useEffect(() => {
        renderFrame();
    }, [renderFrame]);

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (ev) => setImageSrc(ev.target?.result as string);
            reader.readAsDataURL(file);
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (ev) => setImageSrc(ev.target?.result as string);
            reader.readAsDataURL(file);
        }
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (!sourceImgRef.current || isActiveMode) return;
        setIsDragging(true);
        dragStart.current = { x: e.clientX - settings.x, y: e.clientY - settings.y };
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDragging) {
            setSettings({
                ...settings,
                x: e.clientX - dragStart.current.x,
                y: e.clientY - dragStart.current.y
            });
        }
    };

    const handleMouseUp = () => setIsDragging(false);

    const handleWheel = (e: React.WheelEvent) => {
        if (!sourceImgRef.current || isActiveMode) return;
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        const newScale = Math.max(0.1, settings.scale + delta);
        setSettings({ ...settings, scale: newScale });
    };

    const triggerSetWallpaper = () => {
        if (canvasRef.current) {
            onSetWallpaper(canvasRef.current.toDataURL());
        }
    };

    return (
        <div 
            className={`absolute inset-0 flex flex-col items-center justify-center bg-[#000] overflow-hidden ${dragOver ? 'ring-4 ring-cyan-500 z-50' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => isActiveMode && setIsActiveMode(false)}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
        >
            <canvas 
                ref={canvasRef} 
                className="absolute inset-0 w-full h-full image-pixelated pointer-events-none"
                style={{ objectFit: 'cover' }}
            />
            
            {/* CRT Overlay */}
            <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[size:100%_2px,3px_100%] z-10 opacity-50 mix-blend-overlay"></div>

            {/* Controls Bar */}
            <div className={`absolute bottom-8 flex flex-col gap-2 bg-black/80 p-3 rounded-2xl border border-white/10 backdrop-blur-md transition-all duration-500 z-20 ${isActiveMode ? 'translate-y-32 opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'}`}>
                
                <div className="flex gap-4 items-center">
                    <label className="flex items-center gap-2 cursor-pointer hover:text-cyan-400 transition-colors">
                        <Upload className="w-4 h-4" />
                        <span className="text-[10px] font-bold">IMAGE</span>
                        <input type="file" className="hidden" accept="image/*" onChange={handleFileSelect} />
                    </label>
                    
                    <div className="w-px h-4 bg-white/20"></div>

                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-400">DITHER</span>
                        <input 
                            type="range" min="0" max="1" step="0.05" 
                            value={settings.dither} 
                            onChange={(e) => setSettings({ ...settings, dither: parseFloat(e.target.value) })}
                            className="w-16 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                        />
                    </div>

                    <div className="w-px h-4 bg-white/20"></div>

                    <div className="flex items-center gap-2">
                        <ZoomIn className="w-3 h-3 text-slate-400" />
                        <input 
                            type="range" min="0.1" max="3" step="0.1" 
                            value={settings.scale} 
                            onChange={(e) => setSettings({ ...settings, scale: parseFloat(e.target.value) })}
                            className="w-16 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                        />
                    </div>

                    <div className="w-px h-4 bg-white/20"></div>

                    <button 
                        onClick={() => { setImageSrc(null); setSettings({scale: 1, x:0, y:0, dither:0.2}); }}
                        className="hover:text-red-400 transition-colors"
                        title="Reset"
                    >
                        <RefreshCw className="w-3 h-3" />
                    </button>
                </div>

                <div className="h-px w-full bg-white/10 my-1"></div>

                <div className="flex gap-2">
                    <button 
                        onClick={triggerSetWallpaper}
                        className="flex-1 flex items-center justify-center gap-2 text-pink-400 hover:text-pink-300 transition-colors text-[10px] font-black bg-pink-900/20 rounded py-2 border border-pink-500/30 hover:bg-pink-900/40"
                    >
                        <Wallpaper className="w-3 h-3" /> SET BG
                    </button>
                    <button 
                        onClick={(e) => { e.stopPropagation(); setIsActiveMode(true); }}
                        className="flex-1 flex items-center justify-center gap-2 text-emerald-400 hover:text-emerald-300 transition-colors text-[10px] font-black bg-emerald-900/20 rounded py-2 border border-emerald-500/30 hover:bg-emerald-900/40"
                    >
                        <Check className="w-3 h-3" /> DONE
                    </button>
                </div>
            </div>

            {/* Hint */}
            <div className={`absolute top-4 text-[10px] font-mono text-slate-500 opacity-50 bg-black/40 px-2 py-1 rounded transition-opacity duration-500 ${isActiveMode ? 'opacity-0' : ''}`}>
                DRAG TO PAN • SCROLL TO ZOOM
            </div>
        </div>
    );
};

export default C64AlbumCover;
