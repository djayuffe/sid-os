
import React, { useRef, useEffect, useState, useMemo, memo } from 'react';
import { TrackerProject } from '../types';
import { Music, Move, Maximize2, Lock, ZoomIn, ZoomOut, MousePointer2 } from 'lucide-react';
import { SidPlayer } from '../services/sidService';

interface PianoRollProps {
    project: TrackerProject;
    activePatternIndex: number;
    currentRow: number;
    selectedInstId: number;
    onEdit: (row: number, channel: number, note: string, inst: number) => void;
    onSeek: (row: number) => void;
    onPreview?: (note: string, inst: number) => void;
    selectedChannel: number;
    player: SidPlayer | null;
    clockFreq: number;
}

const NOTES = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"];
const CHANNEL_COLORS = ['#22d3ee', '#f472b6', '#fbbf24']; // Cyan, Pink, Amber

// Safe Math Helpers
const CLAMP = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const SAFE_FREQ_TO_MIDI = (freq: number, clock: number) => {
    if (freq <= 0 || clock <= 0) return -1;
    const hz = (freq * clock) / 16777216;
    if (hz < 20) return -1; // Ignore sub-audio
    const note = 69 + 12 * Math.log2(hz / 440);
    return Number.isFinite(note) ? Math.round(note) : -1;
};

const PianoRoll: React.FC<PianoRollProps> = memo(({ 
    project, activePatternIndex, currentRow, selectedInstId, 
    onEdit, onSeek, onPreview, selectedChannel, player, clockFreq 
}) => {
    const gridRef = useRef<HTMLDivElement>(null);
    const keysRef = useRef<HTMLCanvasElement>(null);
    const headerRef = useRef<HTMLCanvasElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    
    // Viewport State
    const [zoomX, setZoomX] = useState(1.5);
    const [zoomY, setZoomY] = useState(1.4);
    const [scrollPos, setScrollPos] = useState({ x: 0, y: 500 });
    const [hoverInfo, setHoverInfo] = useState<{row: number, note: number, noteName: string} | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [followPlayhead, setFollowPlayhead] = useState(true);
    const lastMousePos = useRef({ x: 0, y: 0 });

    // Constants
    const KEY_WIDTH = 60;
    const HEADER_HEIGHT = 30;
    const TOTAL_NOTES = 96; 
    const COL_WIDTH_BASE = 24;
    const NOTE_HEIGHT_BASE = 14;
    
    // Derived Dimensions
    const colWidth = Math.max(5, COL_WIDTH_BASE * zoomX);
    const noteHeight = Math.max(4, NOTE_HEIGHT_BASE * zoomY);
    
    const pattern = useMemo(() => {
        if (!project || !project.subtunes || !project.subtunes[0]) return null;
        const patId = project.subtunes[0].orderList[activePatternIndex];
        return project.patterns.find(p => p.id === patId);
    }, [project, activePatternIndex]);

    const numRows = pattern ? pattern.rows.length : 64;
    const contentHeight = TOTAL_NOTES * noteHeight;

    const getNoteNameFromIdx = (idx: number) => {
        const oct = Math.floor(idx / 12);
        const n = NOTES[idx % 12];
        return `${n}${oct}`;
    };

    const getNoteIdxFromName = (name: string) => {
        if (!name || name === '---' || name === '===') return -1;
        const n = name.slice(0, 2);
        const o = parseInt(name.slice(2));
        const i = NOTES.indexOf(n);
        if (i === -1 || isNaN(o)) return -1;
        return o * 12 + i;
    };

    // --- RENDER LOOP ---
    useEffect(() => {
        const canvas = canvasRef.current;
        const keys = keysRef.current;
        const header = headerRef.current;
        const gridDiv = gridRef.current;

        if (!canvas || !keys || !header || !gridDiv) return;

        const ctx = canvas.getContext('2d', { alpha: false });
        const kCtx = keys.getContext('2d', { alpha: false });
        const hCtx = header.getContext('2d', { alpha: false });
        if (!ctx || !kCtx || !hCtx) return;

        let rafId = 0;

        const render = () => {
            const viewportW = gridDiv.clientWidth;
            const viewportH = gridDiv.clientHeight;
            const dpr = window.devicePixelRatio || 1;

            // Handle Resize
            if (canvas.width !== viewportW * dpr || canvas.height !== viewportH * dpr) {
                canvas.width = viewportW * dpr; canvas.height = viewportH * dpr;
                keys.width = KEY_WIDTH * dpr; keys.height = viewportH * dpr;
                header.width = viewportW * dpr; header.height = HEADER_HEIGHT * dpr;
                ctx.scale(dpr, dpr); kCtx.scale(dpr, dpr); hCtx.scale(dpr, dpr);
            }

            // --- 1. Playhead Calculation ---
            let playheadX = -1;
            
            if (player && player.isPlaying && clockFreq > 0) {
                const cycles = player.getEstimatedCycles() || 0;
                const fps = (clockFreq > 1000000 ? 60 : 50);
                const cyclesPerFrame = clockFreq / fps;
                const totalFrames = cyclesPerFrame > 0 ? cycles / cyclesPerFrame : 0;
                
                const speed = Math.max(1, (project?.frameSpeed || 6));
                const totalRows = totalFrames / speed;
                const patternRowPos = totalRows % 64; 
                playheadX = patternRowPos * colWidth;

                // Auto-Follow Logic
                if (followPlayhead) {
                    const center = viewportW / 2;
                    const targetX = Math.max(0, playheadX - center);
                    // Smooth lerp with check for NaN
                    if (Math.abs(targetX - scrollPos.x) > 1.0) {
                        const newX = scrollPos.x + (targetX - scrollPos.x) * 0.15;
                        if (Number.isFinite(newX)) {
                            setScrollPos(prev => ({ ...prev, x: newX }));
                        }
                    }
                }
            } else if (followPlayhead) {
                // Snap to editor cursor when stopped
                const targetX = Math.max(0, (currentRow * colWidth) - (viewportW / 2));
                if (Math.abs(targetX - scrollPos.x) > 1.0) {
                    const newX = scrollPos.x + (targetX - scrollPos.x) * 0.2;
                    if (Number.isFinite(newX)) {
                        setScrollPos(prev => ({ ...prev, x: newX }));
                    }
                }
            }

            // --- 2. Grid Background ---
            ctx.fillStyle = '#050608';
            ctx.fillRect(0, 0, viewportW, viewportH);

            const startRow = Math.max(0, Math.floor(scrollPos.x / colWidth));
            const endRow = Math.min(numRows, Math.ceil((scrollPos.x + viewportW) / colWidth) + 1);
            
            // Draw Vertical Lines (Time)
            ctx.lineWidth = 1;
            for (let r = startRow; r <= endRow; r++) {
                const x = Math.floor(r * colWidth - scrollPos.x);
                const isBar = r % 16 === 0;
                const isBeat = r % 4 === 0;
                
                if (isBar) {
                    ctx.fillStyle = '#1e293b';
                    ctx.fillRect(x, 0, 2, viewportH);
                } else if (isBeat) {
                    ctx.fillStyle = '#111827';
                    ctx.fillRect(x, 0, 1, viewportH);
                } else {
                    ctx.fillStyle = '#0a0d14';
                    ctx.fillRect(x, 0, 1, viewportH);
                }
            }

            // Draw Horizontal Lines (Pitch)
            for (let i = 0; i < TOTAL_NOTES; i++) {
                const y = contentHeight - ((i + 1) * noteHeight) - scrollPos.y;
                if (y > viewportH || y + noteHeight < 0) continue;

                const isBlack = [1, 3, 6, 8, 10].includes(i % 12);
                if (isBlack) {
                    ctx.fillStyle = '#080a0f'; // Darker strip for black keys
                    ctx.fillRect(0, y, viewportW, noteHeight);
                }
                ctx.fillStyle = '#161b26'; // Horizontal Separator
                ctx.fillRect(0, y + noteHeight - 1, viewportW, 1);
            }

            // --- 3. Draw Notes ---
            if (pattern) {
                // Background Channels first
                [0, 1, 2].forEach(ch => {
                    if (ch === selectedChannel) return;
                    drawChannelNotes(ctx, ch, false, startRow, endRow, viewportH);
                });
                // Selected Channel last (on top)
                drawChannelNotes(ctx, selectedChannel, true, startRow, endRow, viewportH);
            }

            // --- 4. Playhead Overlay ---
            if (playheadX >= 0) {
                const px = playheadX - scrollPos.x;
                if (px >= -2 && px <= viewportW) {
                    ctx.fillStyle = '#ff0055';
                    ctx.fillRect(px, 0, 2, viewportH);
                    
                    // Glow
                    const gradient = ctx.createLinearGradient(px-10, 0, px+10, 0);
                    gradient.addColorStop(0, 'rgba(255,0,85,0)');
                    gradient.addColorStop(0.5, 'rgba(255,0,85,0.3)');
                    gradient.addColorStop(1, 'rgba(255,0,85,0)');
                    ctx.fillStyle = gradient;
                    ctx.fillRect(px-10, 0, 20, viewportH);
                }
            }

            // --- 5. Keys Rendering (Sidebar) ---
            kCtx.fillStyle = '#050608';
            kCtx.fillRect(0, 0, KEY_WIDTH, viewportH);
            
            // Live Key Highlight Logic
            // Calculate active notes from actual register values for 100% accuracy
            const activeKeyIndices = new Set<number>();
            if (player && player.volatileVoiceStates) {
                player.volatileVoiceStates.forEach((v, i) => {
                    // Check gate bit (bit 0 of control reg) or high envelope level
                    const gate = (v.ctrl & 1) !== 0;
                    if (gate || v.level > 0.05) {
                        const midi = SAFE_FREQ_TO_MIDI(v.freq, clockFreq);
                        if (midi >= 0) activeKeyIndices.add(midi);
                    }
                });
            }

            for (let i = 0; i < TOTAL_NOTES; i++) {
                const y = contentHeight - ((i + 1) * noteHeight) - scrollPos.y;
                if (y > viewportH || y + noteHeight < 0) continue;

                const isBlack = [1, 3, 6, 8, 10].includes(i % 12);
                const isC = (i % 12) === 0;
                const isHover = hoverInfo && hoverInfo.note === i;
                const isPlaying = activeKeyIndices.has(i);
                
                let keyColor = isBlack ? '#020202' : '#1e293b';
                
                if (isPlaying) {
                    // Flash color
                    keyColor = isBlack ? '#004444' : '#22d3ee';
                } else if (isHover) {
                    keyColor = isBlack ? '#1a1a20' : '#334155';
                }

                kCtx.fillStyle = keyColor;
                kCtx.fillRect(0, y, KEY_WIDTH, noteHeight - 1);
                
                if (isC) {
                    kCtx.fillStyle = isPlaying ? '#fff' : '#22d3ee';
                    kCtx.font = 'bold 10px "Share Tech Mono"';
                    kCtx.fillText(`C${Math.floor(i/12)}`, 4, y + noteHeight - 4);
                } else if (!isBlack && noteHeight > 12) {
                     kCtx.fillStyle = isPlaying ? '#fff' : '#64748b';
                     kCtx.font = '9px "Share Tech Mono"';
                     kCtx.fillText(getNoteNameFromIdx(i), 20, y + noteHeight - 4);
                }
            }

            // --- 6. Header Rendering (Time) ---
            hCtx.fillStyle = '#050608';
            hCtx.fillRect(0, 0, viewportW, HEADER_HEIGHT);
            hCtx.fillStyle = '#1e293b';
            hCtx.fillRect(0, HEADER_HEIGHT-1, viewportW, 1);

            for (let r = startRow; r <= endRow; r++) {
                const x = r * colWidth - scrollPos.x;
                const isBar = r % 16 === 0;
                
                if (r % 4 === 0) {
                    hCtx.fillStyle = isBar ? '#94a3b8' : '#475569';
                    const h = isBar ? 12 : 6;
                    hCtx.fillRect(x, HEADER_HEIGHT - h, 1, h);
                    
                    if (isBar) {
                        hCtx.font = '10px "Share Tech Mono"';
                        hCtx.fillStyle = '#cbd5e1';
                        hCtx.fillText(r.toString(), x + 4, HEADER_HEIGHT - 6);
                    }
                }
            }
            
            // Editor Cursor in Header
            const cx = currentRow * colWidth - scrollPos.x;
            if (cx >= -colWidth && cx < viewportW) {
                hCtx.fillStyle = '#22d3ee';
                hCtx.beginPath();
                hCtx.moveTo(cx, HEADER_HEIGHT);
                hCtx.lineTo(cx - 4, HEADER_HEIGHT - 4);
                hCtx.lineTo(cx + 4, HEADER_HEIGHT - 4);
                hCtx.fill();
            }

            rafId = requestAnimationFrame(render);
        };

        const drawChannelNotes = (ctx: CanvasRenderingContext2D, ch: number, isSelected: boolean, startRow: number, endRow: number, viewportH: number) => {
            if (!pattern) return;
            const color = CHANNEL_COLORS[ch % CHANNEL_COLORS.length];
            let activeNote: { start: number, note: number } | null = null;

            for (let r = 0; r <= numRows; r++) {
                const row = pattern.rows[r];
                const cell = row ? row[ch] : null;
                const nIdx = cell ? getNoteIdxFromName(cell.note) : -1;
                const isOff = cell?.note === '===';

                // Close previous note logic
                if (activeNote && (nIdx !== -1 || isOff || r === numRows)) {
                    const rStart = activeNote.start;
                    const rEnd = r;
                    const note = activeNote.note;
                    
                    if (rEnd > startRow && rStart < endRow) {
                        const x = rStart * colWidth - scrollPos.x;
                        const w = Math.max(1, (rEnd - rStart) * colWidth - 1);
                        const y = contentHeight - ((note + 1) * noteHeight) - scrollPos.y;
                        
                        if (y < viewportH && y + noteHeight > 0) {
                            // Gradient Fill
                            const grad = ctx.createLinearGradient(x, y, x, y + noteHeight);
                            grad.addColorStop(0, isSelected ? color : `${color}60`);
                            grad.addColorStop(1, isSelected ? '#000' : `${color}20`);
                            
                            ctx.fillStyle = grad;
                            ctx.fillRect(x + 1, y + 1, w, noteHeight - 2);
                            
                            // Highlight
                            ctx.fillStyle = 'rgba(255,255,255,0.4)';
                            ctx.fillRect(x + 1, y + 1, w, Math.max(1, noteHeight * 0.2));

                            // Label
                            if (isSelected && colWidth > 30 && noteHeight > 12) {
                                ctx.fillStyle = '#fff';
                                ctx.font = 'bold 10px "Share Tech Mono"';
                                ctx.fillText(getNoteNameFromIdx(note), x + 4, y + noteHeight - 4);
                            }
                        }
                    }
                    activeNote = null;
                }

                if (nIdx !== -1) {
                    activeNote = { start: r, note: nIdx };
                }
            }
        };

        rafId = requestAnimationFrame(render);
        return () => cancelAnimationFrame(rafId);
    }, [project, pattern, zoomX, zoomY, scrollPos, currentRow, selectedChannel, hoverInfo, player, clockFreq, followPlayhead]);

    // --- Handlers ---
    const handleWheel = (e: React.WheelEvent) => {
        if (e.shiftKey) {
            // Horizontal Scroll
            setScrollPos(prev => ({ ...prev, x: Math.max(0, prev.x + e.deltaY) }));
            setFollowPlayhead(false);
        } else if (e.ctrlKey) {
            // Zooming
            e.preventDefault();
            const delta = -e.deltaY * 0.002;
            setZoomX(z => CLAMP(z + delta, 0.5, 8.0));
            setZoomY(z => CLAMP(z + delta, 0.5, 4.0));
        } else {
            // Vertical Scroll
            const maxScrollY = Math.max(0, contentHeight - (gridRef.current?.clientHeight || 0));
            setScrollPos(prev => ({ ...prev, y: CLAMP(prev.y + e.deltaY, 0, maxScrollY) }));
        }
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button === 1) { // Middle click pan
            setIsDragging(true);
            lastMousePos.current = { x: e.clientX, y: e.clientY };
            e.preventDefault();
            return;
        }

        if (!gridRef.current) return;
        const rect = gridRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left + scrollPos.x;
        const y = e.clientY - rect.top + scrollPos.y;
        
        const row = Math.floor(x / colWidth);
        const note = Math.floor((contentHeight - y) / noteHeight);

        if (row >= 0 && row < numRows && note >= 0 && note < TOTAL_NOTES) {
            const name = getNoteNameFromIdx(note);
            if (e.button === 0) {
                onEdit(row, selectedChannel, name, selectedInstId);
                onSeek(row);
                onPreview?.(name, selectedInstId);
            } else if (e.button === 2) {
                onEdit(row, selectedChannel, '---', 0);
            }
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDragging) {
            const dx = e.clientX - lastMousePos.current.x;
            const dy = e.clientY - lastMousePos.current.y;
            const maxScrollY = Math.max(0, contentHeight - (gridRef.current?.clientHeight || 0));
            
            setScrollPos(prev => ({
                x: Math.max(0, prev.x - dx),
                y: CLAMP(prev.y - dy, 0, maxScrollY)
            }));
            lastMousePos.current = { x: e.clientX, y: e.clientY };
            setFollowPlayhead(false);
            return;
        }

        if (!gridRef.current) return;
        const rect = gridRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left + scrollPos.x;
        const y = e.clientY - rect.top + scrollPos.y;
        
        const row = Math.floor(x / colWidth);
        const note = Math.floor((contentHeight - y) / noteHeight);
        
        if (row >= 0 && row < numRows && note >= 0 && note < TOTAL_NOTES) {
            setHoverInfo({ row, note, noteName: getNoteNameFromIdx(note) });
        } else {
            setHoverInfo(null);
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#050608] select-none border border-white/5 rounded-lg overflow-hidden shadow-2xl relative">
            {/* Toolbar */}
            <div className="h-9 bg-[#0b0d14] border-b border-white/5 flex items-center justify-between px-3 shrink-0 z-20">
                <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black tracking-widest flex items-center gap-2 text-cyan-400">
                        <Music className="w-3 h-3" /> PIANO_ROLL
                    </span>
                    <div className="h-4 w-px bg-white/10"></div>
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-white/5 text-slate-300">
                        CH {selectedChannel + 1}
                    </span>
                    <button 
                        onClick={() => setFollowPlayhead(!followPlayhead)}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold border transition-all ${followPlayhead ? 'bg-cyan-900/50 border-cyan-500 text-cyan-300' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
                        title="Auto-scroll to playhead"
                    >
                        <Lock className="w-3 h-3" /> FOLLOW
                    </button>
                    
                    <div className="flex items-center gap-1 ml-2">
                         <button onClick={() => { setZoomX(CLAMP(zoomX - 0.2, 0.5, 8)); }} className="p-1 hover:bg-white/10 rounded text-slate-400"><ZoomOut className="w-3 h-3"/></button>
                         <button onClick={() => { setZoomX(CLAMP(zoomX + 0.2, 0.5, 8)); }} className="p-1 hover:bg-white/10 rounded text-slate-400"><ZoomIn className="w-3 h-3"/></button>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {hoverInfo && (
                        <span className="text-[9px] font-mono text-cyan-400 bg-cyan-950/50 px-2 py-0.5 rounded border border-cyan-800 flex items-center gap-2">
                            <MousePointer2 className="w-3 h-3"/> {hoverInfo.noteName} (R:{hoverInfo.row})
                        </span>
                    )}
                    <button onClick={() => { setZoomX(1.5); setZoomY(1.4); setScrollPos({x:0, y:500}); }} className="p-1 hover:bg-white/10 rounded" title="Reset View"><Maximize2 className="w-3 h-3 text-slate-400"/></button>
                </div>
            </div>

            {/* Layout Grid */}
            <div className="flex-1 relative overflow-hidden" style={{ display: 'grid', gridTemplateColumns: `${KEY_WIDTH}px 1fr`, gridTemplateRows: `${HEADER_HEIGHT}px 1fr` }}>
                {/* 1. Corner */}
                <div className="bg-[#050608] border-r border-b border-white/5 z-10 flex items-center justify-center">
                    <span className="text-[8px] font-bold text-slate-600">KEY</span>
                </div>

                {/* 2. Header */}
                <div className="bg-[#050608] border-b border-white/5 overflow-hidden relative">
                    <canvas ref={headerRef} className="block w-full h-full" />
                </div>

                {/* 3. Keys */}
                <div className="bg-[#050608] border-r border-white/5 overflow-hidden relative">
                    <canvas ref={keysRef} className="block w-full h-full" />
                </div>

                {/* 4. Main Grid */}
                <div 
                    ref={gridRef}
                    className="bg-[#050608] overflow-hidden cursor-crosshair relative"
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={() => setIsDragging(false)}
                    onMouseLeave={() => setIsDragging(false)}
                    onContextMenu={e => e.preventDefault()}
                >
                    <canvas ref={canvasRef} className="block w-full h-full" />
                    
                    {isDragging && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="bg-black/50 text-white px-3 py-1 rounded-full text-xs font-bold flex items-center gap-2 backdrop-blur-sm border border-white/20">
                                <Move className="w-4 h-4"/> PANNING
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

export default PianoRoll;