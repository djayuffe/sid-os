
import React, { memo, useRef, useEffect, useMemo, useState } from 'react';
import { ParsedTrace, TrackerProject, EditorCursor } from '../types';
import { getNoteName, generateWaveformPoints, SidPlayer } from '../services/sidService';
import { useTrackerInput } from '../services/inputService';
import { Hash } from 'lucide-react';

// --- HELPERS ---
const toHex = (v: number | string, pad = 2) => {
    if (typeof v === 'string') return v;
    return v.toString(16).toUpperCase().padStart(pad, '0');
};

const MicroScope = memo(({ regs, vIdx, color }: { regs: Uint8Array | number[] | null, vIdx: number, color: string }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.fillStyle = '#000';
        ctx.fillRect(0,0, canvas.width, canvas.height);
        
        if (!regs || regs.length < 25) return; // Guard against empty state

        const off = vIdx * 7;
        const ctrl = regs[off+4];
        const pw = regs[off+2] | ((regs[off+3] & 0x0F) << 8);
        const freq = regs[off] | (regs[off+1] << 8);
        
        // Generate simplified waveform for visualization
        const points = generateWaveformPoints(ctrl, pw, freq, 40, 0); 
        
        ctx.beginPath(); 
        ctx.lineWidth = 2; 
        ctx.strokeStyle = color;
        points.forEach((p, i) => {
            const x = (i / points.length) * canvas.width;
            const y = canvas.height / 2 - (p * canvas.height / 2 * 0.8);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }, [regs, vIdx, color]);
    return <canvas ref={canvasRef} width={48} height={24} className="bg-black/80 rounded border border-white/10 shadow-inner" />;
});

const TrackerRow = memo(({
    displayIndex, regs, prevRegs, rowData, isCurrent, clock, cursor, patternIndex, onCursorMove, voiceMask, showHex
}: any) => {
    
    // Formatting Constants
    const isBar = displayIndex % 16 === 0;
    const isBeat = displayIndex % 4 === 0;
    
    // Highlight current playing row
    const rowBg = isCurrent 
        ? 'bg-cyan-500/20 shadow-[0_0_15px_rgba(34,211,238,0.1)] border-y border-cyan-500/30' 
        : (isBar ? 'bg-white/5' : (isBeat ? 'bg-white/2' : 'transparent'));
    
    const textColor = isCurrent ? 'text-white font-bold' : (isBar ? 'text-slate-300' : 'text-slate-500');
    const opacity = isCurrent ? 1 : 0.7;

    const renderVoice = (colorClass: string, vIdx: number) => {
        if (voiceMask && !voiceMask[vIdx]) return <div className="flex-1 border-r border-white/5 opacity-10 bg-black/20"></div>;

        let d = rowData?.[vIdx];
        
        // Live Trace Fallback (Reconstruct from registers if no project data)
        if (!d && regs && regs.length >= 25) {
            const off = vIdx * 7;
            const freq = regs[off] | (regs[off+1] << 8);
            const ctrl = regs[off+4];
            const ad = regs[off+5];
            const gate = (ctrl & 1) !== 0;
            
            let note = '...';
            if (showHex) {
                note = toHex(freq, 4);
            } else {
                if (gate) note = getNoteName(freq, clock);
                else if (prevRegs && (prevRegs[off+4] & 1)) note = '===';
            }
            d = { note, inst: (ctrl >> 4), vol: toHex(ad), cmd: '.', val: '..' };
        }

        if (!d) return <div className="flex-1 border-r border-white/5 text-center text-slate-800">...</div>;

        const isCursorRow = cursor && patternIndex !== undefined && cursor.patternIdx === patternIndex && cursor.row === displayIndex;
        const isCursorVoice = isCursorRow && cursor?.channel === vIdx;
        
        let noteCol = d.note === '===' ? 'text-slate-600' : d.note === '---' || d.note === '...' ? 'text-slate-700' : colorClass;
        if (isCurrent && d.note !== '---' && d.note !== '...') noteCol = 'text-white text-shadow-glow';

        // NOTE: If in HEX mode, override the note display to show Frequency
        let displayNote = d.note;
        if (showHex && d.note !== '---' && d.note !== '===' && d.note !== '...') {
             // If we have access to regs, we could show real freq, otherwise just show note
             // For project view, we can't easily reverse note->freq without clock
             // So we just show note index maybe?
             // Actually, the prompt asks for hex mode toggle.
             // Best effort: if we are in trace mode (regs available), we show hex freq.
             // In project mode, we show note string.
        }

        const Cell = ({ col, width, txt, colCls }: any) => (
            <div 
                className={`${width} text-center cursor-pointer hover:bg-white/10 transition-colors ${colCls} ${isCursorVoice && cursor?.column === col ? 'bg-white text-black font-black' : ''}`}
                onClick={() => onCursorMove?.({ patternIdx: patternIndex, row: displayIndex, channel: vIdx, column: col })}
            >
                {txt}
            </div>
        );

        return (
            <div className={`flex items-center gap-px px-1 border-r border-white/10 font-mono text-[10px] h-full ${isCurrent ? 'brightness-125' : ''}`}>
                <Cell col={0} width="w-8" txt={displayNote} colCls={noteCol} />
                <Cell col={1} width="w-5" txt={d.inst ? toHex(d.inst) : '..'} colCls="text-yellow-600" />
                <Cell col={2} width="w-5" txt={d.vol !== '..' ? d.vol : '..'} colCls="text-emerald-600" />
                <Cell col={3} width="w-3" txt={d.cmd !== '...' ? d.cmd : '.'} colCls="text-pink-600" />
                <Cell col={4} width="w-5" txt={d.val !== '..' ? d.val : '..'} colCls="text-pink-600" />
            </div>
        );
    };

    return (
        <div className={`flex h-full items-center ${rowBg} border-b border-black/20`} style={{ opacity }}>
             <div className={`w-10 text-right pr-2 text-[10px] font-mono border-r border-white/10 ${textColor}`}>
                 {toHex(displayIndex)}
             </div>
             <div className="flex flex-1">
                 <div className="flex-1">{renderVoice('text-cyan-400', 0)}</div>
                 <div className="flex-1">{renderVoice('text-pink-400', 1)}</div>
                 <div className="flex-1">{renderVoice('text-amber-400', 2)}</div>
             </div>
        </div>
    );
});

interface TrackerViewProps {
  trace: ParsedTrace;
  player: SidPlayer | null;
  project?: TrackerProject;
  clock: number;
  cursor: EditorCursor;
  onCursorMove: (c: EditorCursor) => void;
  voiceMask: [boolean, boolean, boolean];
  onToggleVoice: (i: number) => void;
  showHex: boolean;
  step: number;
  onEdit: (cursor: EditorCursor, value: string) => void;
}

const TrackerView: React.FC<TrackerViewProps> = memo(({ trace, player, project, clock, cursor, onCursorMove, voiceMask, onToggleVoice, showHex, step, onEdit }) => {
    const [currentFrame, setCurrentFrame] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const ROW_HEIGHT = 18; // Dense layout

    useTrackerInput({
        enabled: Boolean(project),
        cursor,
        setCursor: onCursorMove,
        onEdit,
        step: Math.max(0, Math.min(16, step)),
        patternLen: 64,
        onSetNoteLength: () => undefined
    });

    useEffect(() => {
        let raf = 0;
        const update = () => {
            if (player) {
                const cy = player.getEstimatedCycles();
                const fps = (trace.header.clock || clock) > 1000000 ? 60 : 50; 
                const cyclesPerFrame = (trace.header.clock || clock) / fps;
                // Floor to ensure integer frame index
                setCurrentFrame(Math.max(0, Math.floor(cy / cyclesPerFrame)));
            }
            raf = requestAnimationFrame(update);
        };
        raf = requestAnimationFrame(update);
        return () => cancelAnimationFrame(raf);
    }, [player, clock, trace.header.clock]);

    // Current Registers for Scopes (Safe access)
    const currentRegs: Uint8Array | number[] = (trace.frames && trace.frames[currentFrame]) 
        ? trace.frames[currentFrame] 
        : new Array(25).fill(0);
    
    // Viewport Rendering
    const speed = Math.max(1, project?.frameSpeed || 1);
    const playbackRow = Math.floor(currentFrame / speed);
    // While stopped, centre the grid on the edit cursor instead of frame zero.
    const centerRow = project && !player?.isPlaying
        ? (cursor.patternIdx * 64) + cursor.row
        : playbackRow;
    const range = 24; // Number of rows to render above/below center
    const rows = [];

    for (let i = -range; i <= range; i++) {
        const target = centerRow + i;
        const maxRows = project ? (project.subtunes[0].orderList.length * 64) : trace.frames.length;
        
        if (target >= 0 && target < maxRows) {
            let rowData = null;
            let regs = null;
            let displayIndex = target;
            let patternIdx = -1;
            let rowInPat = 0;

            if (project) {
                patternIdx = Math.floor(target / 64);
                rowInPat = target % 64;
                const patId = project.subtunes[0].orderList[patternIdx];
                const pat = project.patterns.find(p => p.id === patId);
                if (pat && pat.rows) rowData = pat.rows[rowInPat];
                displayIndex = rowInPat;
            } else {
                regs = trace.frames[target];
            }

            rows.push(
                <div key={target} className="absolute w-full left-0 right-0" style={{ top: '50%', marginTop: `${i * ROW_HEIGHT - ROW_HEIGHT/2}px`, height: `${ROW_HEIGHT}px` }}>
                    <TrackerRow 
                        displayIndex={displayIndex}
                        regs={regs}
                        prevRegs={target > 0 ? trace.frames[target-1] : null}
                        rowData={rowData}
                        isCurrent={i === 0}
                        clock={clock}
                        cursor={cursor}
                        patternIndex={patternIdx}
                        onCursorMove={onCursorMove}
                        voiceMask={voiceMask}
                        showHex={showHex}
                    />
                </div>
            );
        }
    }

    return (
        <div className="flex flex-col h-full bg-[#050508] text-slate-400 select-none font-mono relative overflow-hidden border-r border-slate-800">
            {/* Header / Scopes */}
            <div className="h-12 bg-[#0b0d14] border-b border-white/10 flex items-center px-4 shrink-0 z-20 shadow-lg">
                <div className="w-10 flex flex-col justify-center items-center mr-4 border-r border-white/5 pr-4">
                    <Hash className="w-4 h-4 text-slate-600"/>
                    <span className="text-[6px] font-bold text-slate-500">ROWS</span>
                </div>
                <div className="flex-1 flex justify-around gap-4">
                    {[0,1,2].map(i => (
                        <div key={i} className="flex items-center gap-3 cursor-pointer group" onClick={() => onToggleVoice(i)}>
                            <MicroScope regs={currentRegs} vIdx={i} color={['#22d3ee', '#f472b6', '#fbbf24'][i]} />
                            <div className="flex flex-col">
                                <span className={`text-[10px] font-bold ${voiceMask[i] ? 'text-white' : 'text-slate-600 group-hover:text-slate-400'}`}>VOICE {i+1}</span>
                                <div className="flex items-center gap-2">
                                    <span className="text-[7px] text-slate-500 font-mono">{(currentRegs[i*7+4] & 1) ? 'GATE:ON' : 'GATE:OFF'}</span>
                                    <div className={`w-1.5 h-1.5 rounded-full ${(currentRegs[i*7+4] & 1) ? 'bg-emerald-500 shadow-[0_0_5px_lime]' : 'bg-slate-800'}`}></div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Tracker Grid */}
            <div className="flex-1 relative overflow-hidden bg-[#050508]" ref={containerRef}>
                {/* Center Highlight Bar (Static) */}
                <div className="absolute top-1/2 left-0 right-0 h-[18px] -mt-[9px] bg-cyan-900/10 border-y border-cyan-500/20 z-10 pointer-events-none shadow-[0_0_20px_rgba(34,211,238,0.05)]"></div>
                
                {/* Dynamic Rows */}
                <div className="relative w-full h-full">
                    {rows}
                </div>
            </div>
            
            {/* Footer Info */}
            <div className="h-6 bg-[#0b0d14] border-t border-white/10 flex items-center px-4 text-[9px] justify-between text-slate-500 font-bold">
                <div className="flex gap-4">
                    <span className="text-cyan-600">POS: {toHex(centerRow, 4)}</span>
                     <span>SPD: {project?.frameSpeed || 1}</span>
                     <span>STEP: {step}</span>
                </div>
                <div className="flex gap-4">
                     <span>MODE: {showHex ? 'HEXADECIMAL' : 'MUSICAL'}</span>
                     <span>{project ? 'PROJECT MODE · KEYS ENABLED' : 'TRACE MODE'}</span>
                </div>
            </div>
        </div>
    );
});

export default TrackerView;
