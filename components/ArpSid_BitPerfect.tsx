import React, { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import { SidPlayer } from '../services/sidService';
import { DrSid, DrSidDrumType } from '../services/drSidService';
import { ArpPatchService, ModuleState, PRESETS, CC_MAP, Connection, ArpStep, ArpeggiatorState, ArpVcoState } from '../services/arpPatchService';
import { Zap, Power, Save, FolderOpen, ChevronDown, Activity, Cable, Play, Pause, Disc, RefreshCw, Mic, ArrowRight, ChevronUp } from 'lucide-react';

interface ArpSidProps {
    player: SidPlayer | null;
    isPlaying: boolean;
    onInit?: () => void;
}

interface MidiState {
    activeNotes: Set<number>;
    lastNote: number;
    gate: boolean;
    pitchBend: number;
    modWheel: number;
    velocity: number;
    aftertouch: number;
    sustain: boolean;
}

const FADER_HEIGHT = 80;
const CRT_GREEN = "#33FF00";  
const CABLE_SLACK_FACTOR = 150; 

// SAFE MATH UTILITIES
const SAFE = (v: any, def: number = 0): number => {
    const n = parseFloat(v);
    return (Number.isFinite(n) && !Number.isNaN(n)) ? n : def;
};
const CLAMP = (v: number, min: number, max: number) => Math.max(min, Math.min(max, SAFE(v)));

const KEY_MAP: Record<string, number> = {
    'z': 48, 's': 49, 'x': 50, 'd': 51, 'c': 52, 'v': 53, 'g': 54, 'b': 55, 'h': 56, 'n': 57, 'j': 58, 'm': 59,
    ',': 60, 'l': 61, '.': 62, ';': 63, '/': 64,
    'q': 60, '2': 61, 'w': 62, '3': 63, 'e': 64, 'r': 65, '5': 66, 't': 67, '6': 68, 'y': 69, '7': 70, 'u': 71, 
    'i': 72, '9': 73, 'o': 74, '0': 75, 'p': 76
};

// --- VISUAL COMPONENTS ---

const VoiceMonitorCRT = memo(({ player, voiceIndex, label, color = CRT_GREEN, height = "h-14" }: { player: SidPlayer | null, voiceIndex: number, label: string, color?: string, height?: string }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { alpha: false }); 
        if (!ctx) return;

        let frameId = 0;

        const render = () => {
            const w = canvas.width;
            const h = canvas.height;
            const cy = h / 2;

            ctx.fillStyle = '#000800'; 
            ctx.fillRect(0, 0, w, h);

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for(let i=0; i<w; i+=20) { ctx.moveTo(i,0); ctx.lineTo(i,h); }
            for(let i=0; i<h; i+=20) { ctx.moveTo(0,i); ctx.lineTo(w,i); }
            ctx.stroke();

            let enabled = false;
            let freq = 0;
            let wave = 0;
            let pw = 0.5;
            let phase = 0;

            // Safe access to volatile properties
            if (player && player.volatileVoiceStates && player.volatileVoiceStates[voiceIndex]) {
                const vs = player.volatileVoiceStates[voiceIndex];
                enabled = ((vs.ctrl & 1) !== 0) || (vs.level > 0);
                freq = vs.freq / 65535; 
                wave = vs.ctrl;
                pw = vs.pw / 4095;
                phase = (vs.phase / 16777216) * Math.PI * 2; 
            }

            if (!enabled) {
                ctx.strokeStyle = 'rgba(50, 100, 50, 0.3)';
                ctx.beginPath(); 
                ctx.moveTo(0, cy); 
                ctx.lineTo(w, cy);
                ctx.stroke();
                frameId = requestAnimationFrame(render);
                return;
            }

            const visualFreq = 2 + (freq * 10); 
            const amp = h * 0.35;
            
            ctx.shadowBlur = 0; 
            let lastX = 0;
            let lastY = cy;

            for (let x = 0; x < w; x+=3) {
                const t = (x / w) * Math.PI * 2 * visualFreq + phase;
                let yVal = 0;

                let active = 0;
                if (wave & 0x10) { yVal += Math.asin(Math.sin(t)); active++; } 
                if (wave & 0x20) { yVal += ((t % (Math.PI*2)) / Math.PI - 1); active++; } 
                if (wave & 0x40) { yVal += (Math.sin(t) > ((pw - 0.5)*2) ? 1 : -1); active++; } 
                if (wave & 0x80) { yVal += (Math.random() * 2 - 1); active++; } 

                if (active > 0) yVal /= active;
                yVal += (Math.random() - 0.5) * 0.02;

                const y = cy + yVal * amp;
                const dist = Math.sqrt(Math.pow(x - lastX, 2) + Math.pow(y - lastY, 2));
                const intensity = Math.min(1.0, 5.0 / (dist + 0.1));

                ctx.beginPath();
                ctx.moveTo(lastX, lastY);
                ctx.lineTo(x, y);
                
                ctx.lineWidth = 1.0 + intensity * 1.5;
                ctx.strokeStyle = color;
                ctx.globalAlpha = 0.3 + intensity * 0.7;
                ctx.stroke();
                
                lastX = x;
                lastY = y;
            }
            ctx.globalAlpha = 1.0;
            frameId = requestAnimationFrame(render);
        };
        render();
        return () => cancelAnimationFrame(frameId);
    }, [player, voiceIndex, color]);

    return (
        <div className={`relative w-full ${height} bg-black rounded-sm border-2 border-[#333] overflow-hidden shadow-[inset_0_0_10px_rgba(0,0,0,1)] group`}>
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none z-20"></div>
            <canvas ref={canvasRef} width={150} height={60} className="w-full h-full block opacity-90" />
            <div className="absolute top-0.5 left-0.5 text-[6px] font-c64 z-20 bg-black/60 px-1 py-0.5 rounded text-white tracking-widest border border-white/10 shadow-lg backdrop-blur-sm">{label}</div>
            <div className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full z-20 transition-colors duration-100 ${(player?.volatileVoiceStates?.[voiceIndex]?.ctrl & 1) ? 'bg-red-500 shadow-[0_0_8px_red]' : 'bg-[#330000]'}`}></div>
        </div>
    );
});

const TouchPad = ({ onUpdate }: { onUpdate: (x: number, y: number) => void }) => {
    const padRef = useRef<HTMLDivElement>(null);
    const [active, setActive] = useState(false);
    const [pos, setPos] = useState({ x: 0.5, y: 0.5 });

    const handleMove = useCallback((clientX: number, clientY: number) => {
        if (!padRef.current) return;
        const rect = padRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, 1 - ((clientY - rect.top) / rect.height))); 
        setPos({ x, y });
        onUpdate(x, y);
    }, [onUpdate]);

    useEffect(() => {
        const mm = (e: MouseEvent) => { if (active) handleMove(e.clientX, e.clientY); };
        const mu = () => setActive(false);
        window.addEventListener('mousemove', mm);
        window.addEventListener('mouseup', mu);
        return () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
    }, [active, handleMove]);

    return (
        <div 
            ref={padRef}
            className="w-full h-16 bg-black border border-[#444] rounded-sm relative overflow-hidden cursor-crosshair shadow-[inset_0_0_15px_black]"
            onMouseDown={(e) => { setActive(true); handleMove(e.clientX, e.clientY); }}
        >
            <div className="absolute inset-0 opacity-20 pointer-events-none" 
                 style={{ backgroundImage: 'linear-gradient(#22d3ee 1px, transparent 1px), linear-gradient(90deg, #22d3ee 1px, transparent 1px)', backgroundSize: '10px 10px' }}></div>
            <div className="absolute w-full h-px bg-cyan-500/50 pointer-events-none" style={{ top: `${(1-pos.y)*100}%` }}></div>
            <div className="absolute h-full w-px bg-cyan-500/50 pointer-events-none" style={{ left: `${pos.x*100}%` }}></div>
            <div className="absolute w-3 h-3 border-2 border-cyan-400 rounded-full -ml-1.5 -mt-1.5 pointer-events-none shadow-[0_0_10px_cyan]" 
                 style={{ left: `${pos.x*100}%`, top: `${(1-pos.y)*100}%` }}></div>
            <div className="absolute bottom-0.5 left-1 text-[6px] text-cyan-700 font-bold">POT X/Y</div>
        </div>
    );
};

const Screw = () => (
    <div className="w-2.5 h-2.5 rounded-full bg-[#222] shadow-[inset_-1px_-1px_2px_rgba(0,0,0,0.8),1px_1px_1px_rgba(255,255,255,0.1)] flex items-center justify-center border border-[#111]">
        <div className="w-full h-px bg-[#111] rotate-45 transform"></div>
    </div>
);

const Knob = React.memo(({ value, onChange, label, min = 0, max = 1, color = "cyan" }: any) => {
    const [dragging, setDragging] = useState(false);
    const startY = useRef(0);
    const startVal = useRef(0);

    const onMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setDragging(true);
        startY.current = e.clientY;
        startVal.current = value;
    };

    useEffect(() => {
        const move = (e: MouseEvent) => {
            if (!dragging) return;
            const delta = (startY.current - e.clientY) / 150; 
            const newVal = Math.max(min, Math.min(max, startVal.current + delta));
            onChange(newVal);
        };
        const up = () => setDragging(false);
        if (dragging) {
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
        }
        return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    }, [dragging, min, max, onChange]);

    const pct = (value - min) / (max - min);
    const rotation = -135 + (pct * 270);
    const colorHex = color === 'cyan' ? '#22d3ee' : color === 'pink' ? '#f472b6' : color === 'amber' ? '#fbbf24' : '#fff';

    return (
        <div className="flex flex-col items-center gap-0.5 select-none font-c64 group">
            <div 
                className={`w-8 h-8 rounded-full bg-[#111] border-2 border-[#444] relative cursor-ns-resize shadow-lg transition-colors ${dragging ? `border-[${colorHex}]` : 'hover:border-[#666]'}`}
                onMouseDown={onMouseDown}
            >
                <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/5 to-transparent pointer-events-none"></div>
                <div 
                    className="absolute top-0 left-1/2 w-full h-full -ml-[50%] pointer-events-none"
                    style={{ transform: `rotate(${rotation}deg)` }}
                >
                    <div 
                        className={`absolute top-0.5 left-1/2 -translate-x-1/2 w-1 h-2.5 rounded-sm shadow-[0_0_5px_currentColor]`}
                        style={{ backgroundColor: colorHex, boxShadow: `0 0 6px ${colorHex}` }}
                    ></div>
                </div>
            </div>
            <div className="flex flex-col items-center leading-none">
                <span className="text-[7px] text-slate-400 tracking-widest group-hover:text-white transition-colors">{label}</span>
                {dragging && <span className="text-[9px] text-white absolute -mt-4 bg-black/90 px-1 py-0.5 border border-slate-700 rounded z-50 font-mono shadow-xl">{value.toFixed(2)}</span>}
            </div>
        </div>
    );
});

const Fader = React.memo(({ value, onChange, label, color = "white", min = 0, max = 1, showValue = false, rawMax }: any) => {
    const trackRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);

    const handleMove = useCallback((clientY: number) => {
        if (!trackRef.current) return;
        const rect = trackRef.current.getBoundingClientRect();
        const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
        const pct = 1.0 - (y / rect.height);
        onChange(min + pct * (max - min));
    }, [onChange, min, max]);

    useEffect(() => {
        const move = (e: MouseEvent) => { if (dragging) { e.preventDefault(); handleMove(e.clientY); } };
        const up = () => setDragging(false);
        if (dragging) {
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
        }
        return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    }, [dragging, handleMove]);

    const pct = (value - min) / (max - min);
    const rawValDisplay = rawMax ? Math.round(pct * rawMax) : value.toFixed(2);
    const rawHex = rawMax ? `$${Math.round(pct * rawMax).toString(16).toUpperCase()}` : '';
    
    const capStyle = {
        bottom: `${pct * 100}%`,
        transform: 'translate(-50%, 50%)',
        boxShadow: `0 2px 10px rgba(0,0,0,0.8), 0 0 5px ${color === 'white' ? '#aaa' : color}` 
    };

    return (
        <div className="flex flex-col items-center gap-1 group select-none relative z-10 w-10 font-c64">
            <div 
                ref={trackRef}
                className="w-4 bg-[#080808] border border-[#333] relative cursor-ns-resize rounded-full shadow-[inset_0_0_5px_black]"
                style={{ height: FADER_HEIGHT }}
                onMouseDown={(e) => { e.preventDefault(); setDragging(true); handleMove(e.clientY); }}
            >
                <div className="absolute -left-3 top-0 bottom-0 flex flex-col justify-between pointer-events-none opacity-30">
                    {[...Array(6)].map((_,i) => <div key={i} className="w-1.5 h-px bg-white"></div>)}
                </div>
                
                <div 
                    className={`absolute left-1/2 w-8 h-5 bg-[#222] border-t border-b border-[#666] flex items-center justify-center z-20 hover:bg-[#333] transition-colors rounded-[2px]`}
                    style={{ ...capStyle }}
                >
                    <div className="w-full h-0.5 bg-black/50"></div>
                </div>
            </div>
            <span className="text-[10px] text-slate-500 tracking-tight text-center leading-tight group-hover:text-slate-300">{label}</span>
            {showValue && dragging && (
                <div className="absolute -top-8 bg-[#352879] text-white text-[10px] px-2 py-1 border-2 border-[#6C5EB5] z-50 whitespace-nowrap shadow-xl flex flex-col items-center rounded">
                    <span>{rawValDisplay}</span>
                    {rawHex && <span className="text-[8px] text-cyan-300">{rawHex}</span>}
                </div>
            )}
        </div>
    );
});

// Drag and Drop Jack with Signal Visualization
const Jack = ({ id, label, type, active, onStartPatch, onEndPatch, color="slate", signalLevel = 0 }: any) => {
    // signalLevel 0-1, used to animate ring opacity
    const ringOpacity = 0.2 + signalLevel * 0.8;
    const ringGlow = signalLevel > 0.1 ? `0 0 ${5 + signalLevel * 10}px ${color}` : 'none';

    return (
        <div className="flex flex-col items-center gap-1 group relative z-10 font-c64">
            <div 
                className={`w-9 h-9 rounded-full border-4 flex items-center justify-center cursor-crosshair transition-all shadow-md active:scale-95
                ${active 
                    ? 'border-cyan-400 bg-cyan-900 shadow-[0_0_15px_cyan]' 
                    : 'border-[#333] bg-[#111] hover:border-[#6C5EB5] hover:bg-[#222]'}`}
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onStartPatch(id, e.clientX, e.clientY); }}
                onMouseUp={(e) => { e.stopPropagation(); onEndPatch(id); }}
                title={label}
            >
                {/* Inner Signal Ring */}
                <div 
                    className="absolute inset-0.5 rounded-full border-2 border-white pointer-events-none transition-opacity duration-75"
                    style={{ opacity: signalLevel > 0.01 ? ringOpacity : 0, borderColor: color, boxShadow: ringGlow }}
                ></div>
                <div className={`w-3.5 h-3.5 rounded-full bg-black shadow-inner border border-[#222]`}></div>
            </div>
            {label && <span className={`text-[10px] uppercase font-bold tracking-tight ${type === 'in' ? 'text-slate-500 group-hover:text-slate-300' : 'text-white bg-[#6C5EB5] px-1 rounded-sm'}`}>{label}</span>}
        </div>
    );
};

const Module = ({ title, color, width = "min-w-[110px]", children }: { title: string, color: string, width?: string, children?: React.ReactNode }) => {
    return (
        <div className={`bg-[#2a2a35] border-l border-r border-[#1a1a20] flex flex-col relative ${width} group shadow-[inset_0_0_15px_rgba(0,0,0,0.5)] font-c64`}>
            <div className="flex justify-between items-center bg-[#202025] px-1.5 py-0.5 border-b border-[#333]">
                <span className={`text-[9px] font-bold text-slate-400 uppercase tracking-widest group-hover:text-white transition-colors`}>{title}</span>
                <div className="flex gap-0.5">
                    <div className="w-0.5 h-0.5 bg-[#444] rounded-full"></div>
                    <div className="w-0.5 h-0.5 bg-[#444] rounded-full"></div>
                </div>
            </div>
            <div className="p-2 flex flex-col gap-3 relative h-full">
                {children}
            </div>
            <div className="absolute bottom-1 left-1 opacity-50"><Screw/></div>
            <div className="absolute bottom-1 right-1 opacity-50"><Screw/></div>
        </div>
    );
};

const ArpeggiatorControls = ({ state, onChange }: { state: ArpeggiatorState, onChange: (s: ArpeggiatorState) => void }) => {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
                <span className="text-[8px] text-pink-400 font-bold">MODE</span>
                <div className="flex gap-px">
                    {['OFF', 'UP', 'DN', 'RND'].map(m => (
                        <button
                            key={m}
                            onClick={() => onChange({ ...state, mode: m === 'DN' ? 'DOWN' : m === 'RND' ? 'RANDOM' : m as any })}
                            className={`px-1 py-0.5 text-[6px] font-bold border rounded-sm transition-all ${
                                (state.mode === 'RANDOM' && m === 'RND') || (state.mode === 'DOWN' && m === 'DN') || state.mode === m
                                    ? 'bg-pink-900 border-pink-500 text-pink-200'
                                    : 'bg-slate-800 border-slate-600 text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            {m}
                        </button>
                    ))}
                </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <Knob label="RNG" value={state.range} min={1} max={3} onChange={(v: number) => onChange({ ...state, range: Math.round(v) })} color="pink" />
                <Knob label="SPD" value={state.speed} min={0.05} max={0.5} onChange={(v: number) => onChange({ ...state, speed: v })} color="pink" />
            </div>
        </div>
    );
};

const Sequencer = ({ data, active, speed, arpMode, onUpdate, onSpeedChange, onArpModeChange, activeStep }: { data: ArpStep[], active: boolean, speed: number, arpMode: boolean, onUpdate: (data: ArpStep[]) => void, onSpeedChange: (s:number)=>void, onArpModeChange: (v:boolean)=>void, activeStep: number }) => {
    
    const toggleGate = (i: number) => {
        const next = [...data];
        next[i] = { ...next[i], gate: !next[i].gate };
        onUpdate(next);
    };

    const toggleSlide = (i: number) => {
        const next = [...data];
        next[i] = { ...next[i], slide: !next[i].slide };
        onUpdate(next);
    };

    const toggleAccent = (i: number) => {
        const next = [...data];
        next[i] = { ...next[i], accent: !next[i].accent };
        onUpdate(next);
    };

    const setPitch = (i: number, val: number) => {
        const next = [...data];
        next[i] = { ...next[i], pitch: val };
        onUpdate(next);
    };

    return (
        <div className="flex flex-col gap-1 h-full">
            <div className="flex justify-between items-center">
                <span className="text-[8px] text-cyan-400 font-bold">SEQ</span>
                <div className="flex items-center gap-1">
                    <button 
                        onClick={() => onArpModeChange(!arpMode)}
                        className={`text-[7px] font-bold px-1.5 py-0.5 rounded border ${arpMode ? 'bg-pink-900 border-pink-500 text-pink-300' : 'bg-slate-800 border-slate-600 text-slate-500'}`}
                    >
                        {arpMode ? 'ARP' : 'PIT'}
                    </button>
                    <input 
                        type="range" min="0.05" max="0.5" step="0.01" 
                        value={speed} onChange={e => onSpeedChange(parseFloat(e.target.value))}
                        className="w-12 h-1 bg-slate-700 accent-cyan-500 rounded"
                        title="Sequence Speed"
                    />
                </div>
            </div>
            <div className="flex gap-px h-full items-end p-1 bg-black/40 rounded border border-white/5 shadow-inner overflow-x-auto">
                {data.map((s, i) => (
                    <div key={i} className="flex flex-col items-center gap-0.5 group relative h-full justify-end min-w-[10px] flex-1">
                        <div className={`relative w-full h-16 bg-[#111] rounded-[1px] overflow-hidden border transition-colors ${activeStep === i ? 'border-white shadow-[0_0_5px_white] z-10' : 'border-[#333] opacity-80'}`}>
                            <div 
                                className={`absolute bottom-0 w-full transition-all ${arpMode ? 'bg-pink-600 group-hover:bg-pink-500' : 'bg-cyan-600 group-hover:bg-cyan-500'}`}
                                style={{ height: `${s.pitch * 100}%` }}
                            ></div>
                            <div className="absolute top-0 w-full h-full opacity-0 hover:opacity-100 cursor-ns-resize bg-white/5"></div>
                            <input 
                                type="range" min="0" max="1" step={arpMode ? 0.0416 : 0.05} 
                                value={s.pitch}
                                onChange={(e) => setPitch(i, parseFloat(e.target.value))}
                                className="absolute inset-0 opacity-0 cursor-ns-resize"
                            />
                        </div>
                        <div className="flex w-full gap-px h-2">
                            <button 
                                onClick={() => toggleGate(i)}
                                className={`flex-1 rounded-[1px] border transition-all ${s.gate ? (activeStep === i ? 'bg-white border-white' : 'bg-cyan-500 border-cyan-400') : 'bg-[#222] border-[#444]'}`}
                                title="Gate"
                            ></button>
                        </div>
                        <div className="flex w-full gap-px">
                            <button onClick={() => toggleSlide(i)} className={`w-1/2 h-1.5 rounded-[1px] ${s.slide ? 'bg-yellow-500' : 'bg-[#222]'}`} title="Slide"></button>
                            <button onClick={() => toggleAccent(i)} className={`w-1/2 h-1.5 rounded-[1px] ${s.accent ? 'bg-red-500' : 'bg-[#222]'}`} title="Accent"></button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const BitButton = ({ label, bit, val, onClick, color="slate" }: any) => (
    <button 
        onClick={onClick} 
        className={`w-6 h-6 rounded-sm text-[8px] font-bold border-2 transition-all font-c64 flex items-center justify-center ${
            (val & bit) ? `bg-${color}-500 text-black border-${color}-300 shadow-[0_0_10px_currentColor]` : 'bg-[#111] border-[#333] text-[#666]'
        }`}
    >
        {label}
    </button>
);

const ArpSidBitPerfect: React.FC<ArpSidProps> = ({ player, onInit }) => {
    // --- STATE ---
    const [state, setState] = useState<ModuleState>(ArpPatchService.getInitialState());
    const [presets, setPresets] = useState<Record<string, ModuleState>>(PRESETS);
    const [cables, setCables] = useState<Connection[]>([]);
    
    // Non-Render Logic Refs
    const mouseRef = useRef({ x: 0, y: 0 }); // Mouse position for drag calc
    const [dragStart, setDragStart] = useState<{ id: string, x: number, y: number } | null>(null);
    const [hoveredJack, setHoveredJack] = useState<string | null>(null);
    const patchingSrc = useMemo(() => dragStart ? dragStart.id.replace('jack-', '') : null, [dragStart]);
    
    const [presetsOpen, setPresetsOpen] = useState(false);
    const [octave, setOctave] = useState(0); 
    const containerRef = useRef<HTMLDivElement>(null);
    const cableCanvasRef = useRef<HTMLCanvasElement>(null);
    const jackLocations = useRef<Map<string, {x: number, y: number}>>(new Map());
    
    // Physics for cable animation
    const cablePhysics = useRef<{x:number, y:number, vx:number, vy:number}>({x:0, y:0, vx:0, vy:0});
    
    // External Audio / Mic
    const [micEnabled, setMicEnabled] = useState(false);
    const micStream = useRef<MediaStream | null>(null);
    const micSource = useRef<MediaStreamAudioSourceNode | null>(null);
    const micAnalyser = useRef<AnalyserNode | null>(null);
    const micDataArray = useRef<Uint8Array>(new Uint8Array(128));

    const signalLevels = useRef<Map<string, number>>(new Map());

    const potRef = useRef({ x: 0.5, y: 0.5 });
    
    // MIDI Configuration State
    const [midiAccess, setMidiAccess] = useState<any>(null);
    const [midiInputs, setMidiInputs] = useState<any[]>([]);
    const [selectedMidiId, setSelectedMidiId] = useState<string>("");
    const [midiMenuOpen, setMidiMenuOpen] = useState(false);
    const [midiActivity, setMidiActivity] = useState(false);

    const [hold, setHold] = useState(false);
    const [manualGate, setManualGate] = useState(false);
    
    const [seqStep, setSeqStep] = useState(0);
    const seqStepRef = useRef(0);
    const seqTimer = useRef(0);
    const lastTimeRef = useRef(0);
    const seqPitchSmoothed = useRef(0);
    
    const midiState = useRef<MidiState>({ 
        activeNotes: new Set(), lastNote: -1, gate: false, pitchBend: 0, modWheel: 0, velocity: 0, aftertouch: 0, sustain: false
    });
    const [activeKeys, setActiveKeys] = useState<number[]>([]);
    const [liveMod, setLiveMod] = useState(0);
    const [liveBend, setLiveBend] = useState(0);

    const stateRef = useRef<ModuleState>(state);
    const cablesRef = useRef(cables);
    const octaveRef = useRef(octave);
    const lfoPhase = useRef(0);
    const shVal = useRef(0);
    const shTimer = useRef(0);
    const lagVal = useRef(0); 
    
    const drSid = useRef(new DrSid());
    
    const arpStepIndex = useRef(0);
    const arpTimer = useRef(0);
    const arpNoteRef = useRef<number>(-1);
    
    const voiceAssignments = useRef<[number, number, number]>([-1, -1, -1]);

    // --- DOM GEOMETRY CACHING ---
    const updateJackLocations = useCallback(() => {
        if (!containerRef.current) return;
        const containerRect = containerRef.current.getBoundingClientRect();
        const jacks = containerRef.current.querySelectorAll('[data-jack="true"]');
        jackLocations.current.clear();
        jacks.forEach(jack => {
            const rect = jack.getBoundingClientRect();
            jackLocations.current.set(jack.id, {
                x: rect.left - containerRect.left + rect.width / 2,
                y: rect.top - containerRect.top + rect.height / 2
            });
        });
        
        // Update canvas size
        if (cableCanvasRef.current) {
            cableCanvasRef.current.width = containerRect.width;
            cableCanvasRef.current.height = containerRect.height;
        }
    }, []);

    useEffect(() => {
        window.addEventListener('resize', updateJackLocations);
        // Initial update with delay to allow layout to settle
        setTimeout(updateJackLocations, 100);
        setTimeout(updateJackLocations, 500);
        return () => window.removeEventListener('resize', updateJackLocations);
    }, [updateJackLocations, state]); // Re-measure if state changes layout (unlikely but safe)

    const panic = useCallback(() => {
        if (player) {
            player.node?.port.postMessage({ type: 'LIVE', payload: { reg: 0x18, val: 0x00 } }); 
            setTimeout(() => {
                player.setMixerParams({
                    voices: [{volume:1,pan:0,muted:false,solo:false},{volume:1,pan:0,muted:false,solo:false},{volume:1,pan:0,muted:false,solo:false}],
                    masterVolume: 0.8
                });
            }, 50);
        }
        midiState.current.activeNotes.clear();
        midiState.current.gate = false;
        setActiveKeys([]);
    }, [player]);

    useEffect(() => {
        if (player) {
            if (player.ctx.state === 'suspended') {
                player.ctx.resume();
            }
            if (!player.isPlaying) {
                player.setData([]); 
                player.play();
            }
            player.setMixerParams({
                voices: [
                    { volume: 1, pan: 0, muted: false, solo: false },
                    { volume: 1, pan: 0, muted: false, solo: false },
                    { volume: 1, pan: 0, muted: false, solo: false }
                ],
                masterVolume: 0.8
            });
        }
        lastTimeRef.current = performance.now();
    }, [player]);

    useEffect(() => { stateRef.current = state; }, [state]);
    useEffect(() => { cablesRef.current = cables; }, [cables]);
    useEffect(() => { octaveRef.current = octave; }, [octave]);
    
    useEffect(() => { midiState.current.modWheel = liveMod; }, [liveMod]);
    useEffect(() => { midiState.current.pitchBend = liveBend; }, [liveBend]);
    useEffect(() => { midiState.current.sustain = hold; }, [hold]);

    const toggleMic = async () => {
        if (micEnabled) {
            if (micStream.current) micStream.current.getTracks().forEach(t => t.stop());
            micStream.current = null;
            setMicEnabled(false);
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micStream.current = stream;
            
            if (player?.ctx) {
                const source = player.ctx.createMediaStreamSource(stream);
                const analyser = player.ctx.createAnalyser();
                analyser.fftSize = 256;
                source.connect(analyser);
                micSource.current = source;
                micAnalyser.current = analyser;
            }
            setMicEnabled(true);
        } catch (e) {
            console.error("Mic Error", e);
        }
    };

    const updateVal = useCallback((section: keyof ModuleState, key: string, val: any) => {
        setState(prev => {
            if (key === '' && typeof val === 'object' && val !== null) {
                return { ...prev, [section]: { ...(prev[section] as any), ...val } };
            }
            return { ...prev, [section]: { ...(prev[section] as any), [key]: val } };
        });
    }, []);

    const removeCable = useCallback((id: string) => {
        setCables(prev => prev.filter(c => c.id !== id));
    }, []);

    const startPatch = useCallback((id: string, x: number, y: number) => {
        setDragStart({ id, x, y });
        updateJackLocations(); // Ensure coords are fresh
        if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const rx = x - rect.left;
            const ry = y - rect.top;
            mouseRef.current = { x: rx, y: ry };
            cablePhysics.current = { x: rx, y: ry, vx: 0, vy: 0 };
        }
    }, [updateJackLocations]);

    const endPatch = useCallback((targetId: string) => {
        if (dragStart && dragStart.id !== targetId) {
             const exists = cables.some(c => (c.from === dragStart.id && c.to === targetId) || (c.from === targetId && c.to === dragStart.id));
             if (!exists) {
                 const newId = `c_${Date.now()}`;
                 const from = dragStart.id.replace('jack-', '');
                 const to = targetId.replace('jack-', '');
                 if (from !== to) {
                     setCables(prev => [...prev, {
                        id: newId, 
                        from, 
                        to, 
                        color: `hsl(${Math.random() * 360}, 100%, 60%)` 
                     }]);
                 }
             }
        }
        setDragStart(null);
        setHoveredJack(null);
    }, [dragStart, cables]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (dragStart && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            // Directly update ref for zero-latency
            mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        }
    }, [dragStart]);

    const handleMouseUpGlobal = useCallback(() => {
        if (dragStart) {
            if (hoveredJack) {
                endPatch(hoveredJack);
            } else {
                setDragStart(null);
            }
        }
    }, [dragStart, hoveredJack, endPatch]);
    
    useEffect(() => {
        window.addEventListener('mouseup', handleMouseUpGlobal);
        return () => window.removeEventListener('mouseup', handleMouseUpGlobal);
    }, [handleMouseUpGlobal]);


    const playNote = useCallback((n: number, on: boolean, vel: number = 0.8) => {
        if (!player && onInit) {
            onInit();
            return;
        }
        const ms = midiState.current;
        if (on) { 
            ms.activeNotes.add(n); ms.lastNote = n; ms.gate = true; ms.velocity = vel;
        } else { 
            if (!ms.sustain) { ms.activeNotes.delete(n); if (ms.activeNotes.size === 0) ms.gate = false; }
        }
        
        // Stable Voice Allocation Logic
        const voices = voiceAssignments.current;
        if (on) {
            // Find empty slot or steal oldest (simple round robin for now if full)
            if (!voices.includes(n)) {
                let slot = voices.indexOf(-1);
                if (slot === -1) {
                    // Rotate
                    voices[0] = voices[1];
                    voices[1] = voices[2];
                    slot = 2;
                }
                voices[slot] = n;
            }
        } else {
            // Clear slot with this note
            const idx = voices.indexOf(n);
            if (idx !== -1) voices[idx] = -1;
        }
        
        // Unison handling for single note hold (Fatness)
        const active = Array.from(ms.activeNotes);
        if (active.length === 1) {
            voices[0] = voices[1] = voices[2] = active[0];
        }

        setActiveKeys(Array.from(ms.activeNotes));
    }, [player, onInit]);

    const loadPreset = useCallback((preset: ModuleState) => {
        const newState = JSON.parse(JSON.stringify(preset));
        setState(newState);
        setCables(newState.cables || []);
        seqStepRef.current = 0; setSeqStep(0); arpStepIndex.current = 0;
        voiceAssignments.current = [-1, -1, -1]; lagVal.current = 0; shVal.current = 0; lfoPhase.current = 0;
        if (onInit && !player) onInit();
    }, [onInit, player]);

    const resetToInit = useCallback(() => { loadPreset(ArpPatchService.getInitialState()); }, [loadPreset]);

    const savePatch = useCallback(() => {
        const blob = ArpPatchService.exportPatch({ ...state, cables });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${state.name || "patch"}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    }, [state, cables]);

    const saveBank = useCallback(() => {
        const currentKey = state.name ? state.name.toUpperCase().replace(/[^A-Z0-9]/g, '_') : 'USER_PATCH';
        const updatedPresets = { ...presets, [currentKey]: { ...state, cables } };
        const blob = ArpPatchService.exportBank(updatedPresets);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = "ArpBank.json";
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    }, [presets, state, cables]);

    const handleFileLoad = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const json = JSON.parse(ev.target?.result as string);
                if (json.vco1) {
                    const newState = ArpPatchService.validateAndMigrate(json); loadPreset(newState);
                } else {
                    const newBank: Record<string, ModuleState> = {};
                    Object.entries(json).forEach(([k, v]) => { newBank[k] = ArpPatchService.validateAndMigrate(v); });
                    setPresets(newBank);
                    const firstKey = Object.keys(newBank)[0];
                    if (firstKey) loadPreset(newBank[firstKey]);
                }
            } catch (err) { console.error("Failed to load patch/bank", err); }
        };
        reader.readAsText(file);
    }, [loadPreset]);

    useEffect(() => {
        if (!navigator.requestMIDIAccess) return;
        navigator.requestMIDIAccess().then(access => {
            setMidiAccess(access);
            const updateInputs = () => {
                const inputs = Array.from(access.inputs.values());
                setMidiInputs(inputs);
                setSelectedMidiId(prev => (prev && inputs.some((i: any) => i.id === prev)) ? prev : (inputs.length > 0 ? inputs[0].id : ""));
            };
            updateInputs(); access.onstatechange = updateInputs;
        });
    }, []);

    useEffect(() => {
        if (!midiAccess || !selectedMidiId) return;
        const input = midiAccess.inputs.get(selectedMidiId);
        if (!input) return;
        const handleMidiMessage = (msg: any) => {
            setMidiActivity(true); setTimeout(() => setMidiActivity(false), 100);
            const [status, data1, data2] = msg.data;
            const cmd = status & 0xF0;
            if ((cmd === 0x90 && data2 > 0) && !player && onInit) { onInit(); return; }
            if (cmd === 0x90 && data2 > 0) playNote(data1, true, data2/127);
            else if (cmd === 0x80 || (cmd === 0x90 && data2 === 0)) playNote(data1, false);
            else if (cmd === 0xE0) { const bend = ((data2 << 7) | data1) / 8192 - 1; midiState.current.pitchBend = bend; setLiveBend(bend); }
            else if (cmd === 0xB0) {
                const norm = data2 / 127.0;
                if (data1 === 1) { midiState.current.modWheel = norm; setLiveMod(norm); }
                if (data1 === 64) { const active = data2 >= 64; setHold(active); midiState.current.sustain = active; }
                const mapping = CC_MAP[data1];
                if (mapping) {
                    let mappedVal = mapping.min + norm * (mapping.max - mapping.min);
                    if (mapping.stepped) mappedVal = Math.floor(mappedVal);
                    updateVal(mapping.section, mapping.key, mappedVal);
                }
            } else if (cmd === 0xD0) midiState.current.aftertouch = data1 / 127;
        };
        input.addEventListener('midimessage', handleMidiMessage);
        return () => { input.removeEventListener('midimessage', handleMidiMessage); };
    }, [midiAccess, selectedMidiId, playNote, updateVal, player, onInit]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.repeat || e.ctrlKey || e.metaKey || e.target instanceof HTMLInputElement) return;
            const note = KEY_MAP[e.key.toLowerCase()];
            if (note) {
                e.preventDefault();
                playNote(note, true, 0.8);
            }
            if (e.key === '[') {
                e.preventDefault();
                setOctave(o => Math.max(-2, o - 1));
            }
            if (e.key === ']') {
                e.preventDefault();
                setOctave(o => Math.min(2, o + 1));
            }
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            const note = KEY_MAP[e.key.toLowerCase()];
            if (note) {
                e.preventDefault();
                playNote(note, false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [playNote]);

    const groupedPresets = useMemo(() => ArpPatchService.getGroupedPresets(presets), [presets]);

    const VcoPanel = ({ id, label, data, color, player, voiceIndex }: any) => (
        <div className="bg-[#352879] border-2 border-[#6C5EB5] flex flex-col gap-1 relative min-w-[130px] shadow-[3px_3px_0px_rgba(0,0,0,0.5)]">
            <div className="flex justify-between items-center bg-[#6C5EB5] px-1 py-0.5">
                <span className="text-[9px] font-bold text-[#352879] font-c64 tracking-widest uppercase">{label}</span>
                <div className="flex gap-0.5"><div className="w-1 h-1 bg-[#352879] rounded-full"></div></div>
            </div>
            
            <div className="px-1">
                <VoiceMonitorCRT player={player} voiceIndex={voiceIndex} label={label} color={color === 'blue' ? '#00FFFF' : color} height="h-12" />
            </div>

            <div className="flex flex-col gap-1 p-1 bg-black/20 border-y border-[#6C5EB5]/30">
                <div className="flex justify-between items-center">
                    <span className="text-[8px] text-[#6C5EB5] font-c64">WAVE</span>
                    <button 
                        onClick={() => updateVal(id, 'enabled', !data.enabled)}
                        className={`text-[7px] font-c64 px-1 py-0.5 rounded border ${data.enabled ? 'bg-green-900/50 text-green-400 border-green-600' : 'bg-red-900/20 text-red-500 border-red-900'}`}
                    >
                        {data.enabled ? 'ON' : 'OFF'}
                    </button>
                </div>
                <div className="flex justify-between">
                    <BitButton label="TRI" bit={0x10} val={data.wave} onClick={() => updateVal(id, 'wave', data.wave ^ 0x10)} color="cyan" />
                    <BitButton label="SAW" bit={0x20} val={data.wave} onClick={() => updateVal(id, 'wave', data.wave ^ 0x20)} color="cyan" />
                    <BitButton label="PUL" bit={0x40} val={data.wave} onClick={() => updateVal(id, 'wave', data.wave ^ 0x40)} color="cyan" />
                    <BitButton label="NOI" bit={0x80} val={data.wave} onClick={() => updateVal(id, 'wave', data.wave ^ 0x80)} color="cyan" />
                </div>
                <div className="flex justify-between mt-0.5">
                    <BitButton label="RNG" bit={0x04} val={data.wave} onClick={() => updateVal(id, 'wave', data.wave ^ 0x04)} color="purple" />
                    <BitButton label="SYN" bit={0x02} val={data.wave} onClick={() => updateVal(id, 'wave', data.wave ^ 0x02)} color="purple" />
                    <BitButton label="GAT" bit={0x01} val={data.wave} onClick={() => updateVal(id, 'wave', data.wave ^ 0x01)} color="green" />
                    <BitButton label="TST" bit={0x08} val={data.wave} onClick={() => updateVal(id, 'wave', data.wave ^ 0x08)} color="red" />
                </div>
            </div>

            <div className="flex justify-center gap-1 pb-1">
                <Fader label="FRQ" value={data.freq} onChange={(v: number) => updateVal(id, 'freq', v)} color={color} showValue rawMax={65535} />
                <Fader label="PW" value={data.pw} onChange={(v: number) => updateVal(id, 'pw', v)} color={color} showValue rawMax={4095} />
                <Fader label="FIN" value={data.fine} onChange={(v: number) => updateVal(id, 'fine', v)} color={color} />
            </div>

            <div className="p-1 space-y-1 bg-[#2a2a40] border-t-2 border-[#6C5EB5]">
                <div className="flex justify-between items-center">
                    <span className="text-[7px] text-[#6C5EB5]">FM</span>
                    <Jack id={`jack-${id}_fm`} label="" type="in" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === `${id}_fm`} color="orange" />
                </div>
                <Fader label="FM" value={data.fmDepth} onChange={(v: number) => updateVal(id, 'fmDepth', v)} color="orange" />
                
                <div className="flex justify-between items-center mt-1">
                    <span className="text-[7px] text-[#6C5EB5]">PWM</span>
                    <Jack id={`jack-${id}_pwm`} label="" type="in" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === `${id}_pwm`} color="orange" />
                </div>
                <Fader label="PWM" value={data.pwmDepth} onChange={(v: number) => updateVal(id, 'pwmDepth', v)} color="orange" />
            </div>
        </div>
    );

    // --- MAIN ANIMATION & SYNTH LOOP ---
    useEffect(() => {
        let rafId: number;
        
        const update = () => {
            const now = performance.now();
            const rawDt = (now - lastTimeRef.current) / 1000;
            const dt = Math.min(rawDt, 0.05); 
            lastTimeRef.current = now;

            // 1. UPDATE SYNTH LOGIC
            if (player) {
                const s = stateRef.current;
                const conns = cablesRef.current;
                const ms = midiState.current;
                const currentOctave = octaveRef.current;
                const pot = potRef.current;
                const clockFreq = (player.clk as number) || 985248; 
                
                // Sequencer Timing
                if (s.sequencer.active) {
                    seqTimer.current += dt;
                    const stepDuration = Math.max(0.05, SAFE(s.sequencer.speed, 0.2));
                    if (seqTimer.current >= stepDuration) {
                        seqTimer.current -= stepDuration; 
                        const nextStep = (seqStepRef.current + 1) % s.sequencer.steps.length;
                        seqStepRef.current = nextStep;
                        setSeqStep(nextStep); 
                    }
                }
                
                // Arpeggiator Timing
                const heldNotes = Array.from(ms.activeNotes.values()) as number[];
                heldNotes.sort((a, b) => a - b);
                if (s.arpeggiator.mode !== 'OFF' && heldNotes.length > 0) {
                    arpTimer.current += dt;
                    const arpDuration = Math.max(0.05, SAFE(s.arpeggiator.speed, 0.1));
                    if (arpTimer.current >= arpDuration) {
                        arpTimer.current = 0; 
                        arpStepIndex.current++;
                    }
                    const range = CLAMP(s.arpeggiator.range, 1, 3);
                    let pattern: number[] = [];
                    for (let r = 0; r < range; r++) pattern.push(...heldNotes.map(n => n + r * 12));
                    if (s.arpeggiator.mode === 'DOWN') pattern.reverse();
                    else if (s.arpeggiator.mode === 'UPDOWN') pattern = [...pattern, ...[...pattern].reverse()];
                    else if (s.arpeggiator.mode === 'RANDOM') pattern.sort(() => Math.random() - 0.5);
                    if (pattern.length > 0) arpNoteRef.current = pattern[arpStepIndex.current % pattern.length];
                } else {
                    arpNoteRef.current = -1;
                }

                // Voice Allocation
                if (!voiceAssignments.current) voiceAssignments.current = [-1, -1, -1];
                const voices = voiceAssignments.current;
                if (s.arpeggiator.mode !== 'OFF' && arpNoteRef.current !== -1) {
                    voices[0] = voices[1] = voices[2] = arpNoteRef.current;
                } else {
                    // Stable allocation handled by playNote, but fallback for safety
                    if (voices[0] === -1 && voices[1] === -1 && voices[2] === -1 && heldNotes.length > 0) {
                         // Emergency sync if lost state
                         voices[0] = heldNotes[0] || -1;
                         voices[1] = heldNotes[1] || voices[0];
                         voices[2] = heldNotes[2] || voices[1];
                    }
                }

                // Modulations
                const values = new Map<string, number>();
                const dests: { [key: string]: number } = {};
                lfoPhase.current += (Math.max(0.01, SAFE(s.lfo.speed, 0.1)) * (dt * 10)); 
                // Fix: Properly wrap LFO phase to prevent precision loss over time
                lfoPhase.current %= (Math.PI * 2);
                
                const depth = SAFE(s.lfo.depth, 0);
                const lfoSine = Math.sin(lfoPhase.current) * depth;
                const lfoSquare = (lfoSine > 0 ? 1 : -1) * depth;
                const lfoSaw = ((lfoPhase.current % (Math.PI * 2)) / Math.PI - 1) * depth;
                const lfoTri = (Math.abs((lfoPhase.current % (Math.PI * 2)) / Math.PI - 1) * 2 - 1) * depth;
                
                shTimer.current += dt; 
                const shPeriod = 1.0 / (0.1 + SAFE(s.sh.rate, 0.5) * 20.0); 
                if (shTimer.current > shPeriod) { shTimer.current = 0; shVal.current = (Math.random() * 2 - 1); }

                const currentStep = s.sequencer.steps[seqStepRef.current] || {pitch:0, gate:false, slide:false, accent:false};
                let seqPitchCV = 0;
                const seqGate = s.sequencer.active ? currentStep.gate : false;
                const seqAccent = s.sequencer.active ? (currentStep.accent ? 1.0 : 0.0) : 0.0;

                // Sequencer Slide Logic
                if (s.sequencer.active) {
                    let targetPitch = SAFE(currentStep.pitch);
                    if (s.sequencer.arpMode) {
                        targetPitch = SAFE(currentStep.pitch); 
                    }
                    
                    if (currentStep.slide) {
                        const slideSpeed = 10.0 * dt; 
                        seqPitchSmoothed.current += (targetPitch - seqPitchSmoothed.current) * slideSpeed;
                    } else {
                        seqPitchSmoothed.current = targetPitch;
                    }
                    seqPitchCV = seqPitchSmoothed.current;
                }

                // Mic Input
                let extInVal = 0;
                if (micAnalyser.current) {
                    micAnalyser.current.getByteTimeDomainData(micDataArray.current);
                    let sum = 0;
                    for(let k=0; k<128; k++) sum += Math.abs((micDataArray.current[k] - 128) / 128.0);
                    extInVal = (sum / 128.0) * 10.0;
                }

                // Populate Sources
                values.set('lfo_sin', lfoSine); values.set('lfo_sqr', lfoSquare);
                values.set('lfo_saw', lfoSaw); values.set('lfo_tri', lfoTri);
                values.set('sh_out', shVal.current);
                values.set('env_out', SAFE((Number(player.volatileRegs?.[28]) || 0) / 255.0)); 
                values.set('osc3_out', SAFE((Number(player.volatileRegs?.[27]) || 0) / 255.0)); 
                values.set('noise_out', Math.random() * 2 - 1);
                values.set('ext_in', extInVal); 
                values.set('pot_x', pot.x); values.set('pot_y', pot.y);
                
                // Keyboard CV with Portamento
                let targetKbdCV = (ms.lastNote - 60) / 12;
                if (ms.lastNote === -1) targetKbdCV = lagVal.current; 
                const glide = SAFE(s.global.portamento, 0);
                if (glide > 0.01) lagVal.current += (targetKbdCV - lagVal.current) * (1.0 - glide * 0.99) * (dt * 10);
                else lagVal.current = targetKbdCV;
                values.set('kbd_cv', lagVal.current);
                
                values.set('gate_out', ms.gate ? 1 : 0);
                values.set('seq_pitch', seqPitchCV);
                values.set('seq_gate', seqGate ? 1 : 0);
                values.set('seq_accent', seqAccent);
                
                values.set('velocity', SAFE(ms.velocity));
                values.set('mod_wheel', SAFE(ms.modWheel));
                values.set('pitch_cv', SAFE(ms.pitchBend));
                values.set('aftertouch', SAFE(ms.aftertouch));
                values.set('macro_1', SAFE(s.macros.m1)); values.set('macro_2', SAFE(s.macros.m2));
                values.set('macro_3', SAFE(s.macros.m3)); values.set('macro_4', SAFE(s.macros.m4));

                // Process Patch Cables
                signalLevels.current.clear();
                conns.forEach(c => {
                    const val = SAFE(values.get(c.from) || 0);
                    signalLevels.current.set(c.id, Math.abs(val)); // For visualization
                    const currentDest = dests[c.to] || 0;
                    dests[c.to] = currentDest + val; // Summing bus
                });

                // Apply to Synth Registers
                const write = (r: number, v: number) => player.node?.port.postMessage({ type: 'LIVE', payload: { reg: r, val: v } });

                const cutMod = (SAFE((dests['vcf_cut'] as number) || 0) as number) * 2000 * (SAFE(s.vcf.fmDepth) as number);
                const cutoffVal = SAFE(s.vcf.cutoff) as number;
                const finalCut = CLAMP(Math.floor((cutoffVal * 2047) + cutMod), 0, 2047);
                write(21, Number(finalCut & 0x7)); write(22, Number((finalCut >> 3) & 0xFF));
                
                const resMod = (SAFE((dests['vcf_res'] as number) || 0) as number) * (SAFE(s.vcf.resDepth) as number);
                const finalRes = CLAMP(Math.floor((SAFE(s.vcf.res) + resMod) * 15), 0, 15);
                let route = 0; if (s.vcf.route1) route |= 1; if (s.vcf.route2) route |= 2; if (s.vcf.route3) route |= 4; if (s.vcf.routeExt) route |= 8;
                write(23, (finalRes << 4) | route);
                const volMod = SAFE((dests['master_vol'] as number) || 0);
                const finalVol = CLAMP(Math.floor((SAFE(s.master.vol) + volMod) * 15), 0, 15);
                write(24, ((Number(s.vcf.mode) & 0x0F) << 4) | finalVol);

                [s.vco1, s.vco2, s.vco3].forEach((vco: ArpVcoState, iVal: number) => {
                    const i = Number(iVal);
                    const drState = drSid.current.process(i);
                    if (drState) {
                        const off: number = Number(i * 7);
                        const fReg = Math.round((drState.freq * 16777216) / clockFreq);
                        write(off, fReg & 0xFF); write(off+1, fReg >> 8);
                        write(off+2, (drState.pw || 0x800) & 0xFF); write(off+3, ((drState.pw || 0x800) >> 8) & 0xF);
                        write(off+4, drState.ctrl); write(off+5, drState.ad); write(off+6, drState.sr);
                        return; 
                    }
                    const off: number = i * 7;
                    const note = voices[i];
                    let freqHz = 440;
                    const fmIn = SAFE((dests[`vco${i+1}_fm`] as number) || 0) * SAFE(vco.fmDepth); 
                    let baseNote = note;
                    if (baseNote === -1 && s.sequencer.active && !s.sequencer.arpMode) baseNote = 60;
                    if (baseNote === -1) baseNote = 60;

                    const hasActiveNote = note > -1;
                    if (hasActiveNote || (s.sequencer.active && !s.sequencer.arpMode && vco.kbdTrack > 0.1)) {
                        const bend = ms.pitchBend * 2; 
                        let noteWithBend = baseNote + bend + (currentOctave * 12);
                        if (s.sequencer.active) {
                            if (s.sequencer.arpMode) noteWithBend += seqPitchCV * 24;
                            else noteWithBend += (seqPitchCV - 0.5) * 48; 
                        }
                        const exponent = (noteWithBend - 69) / 12;
                        freqHz = 440 * Math.pow(2, CLAMP(exponent, -10, 10));
                        freqHz *= (0.5 + SAFE(vco.fine, 0.5)); 
                    } else {
                        freqHz = 50 + SAFE(vco.freq) * 4000;
                    }
                    freqHz *= Math.pow(2, CLAMP(fmIn * 2, -5, 5));
                    if (vco.lowFreq) freqHz *= 0.05;

                    const freqReg = CLAMP(Math.round((freqHz * 16777216) / clockFreq), 0, 65535);
                    write(off, freqReg & 0xFF); write(off+1, freqReg >> 8);

                    const pwmMod = SAFE((dests[`vco${i+1}_pwm`] as number) || 0) * SAFE(vco.pwmDepth) * 2000;
                    const pw = CLAMP(Math.floor((SAFE(vco.pw) * 4095) + pwmMod), 0, 4095);
                    write(off+2, pw & 0xFF); write(off+3, (pw >> 8) & 0xF);

                    const extGate = dests[`env_gate`]; 
                    let gateActive = false;
                    if (manualGate) gateActive = true;
                    else if (extGate !== undefined) gateActive = extGate > 0.5;
                    else if (s.arpeggiator.mode !== 'OFF') gateActive = (arpNoteRef.current !== -1); 
                    else if (s.sequencer.active) {
                        if (s.sequencer.arpMode) gateActive = seqGate && ms.gate; 
                        else gateActive = seqGate;
                    }
                    else gateActive = ms.gate; 
                    
                    let ctrl = 0;
                    if (vco.enabled) ctrl = vco.wave & 0xF0; 
                    if (gateActive) ctrl |= 0x01;
                    if (vco.wave & 0x02) ctrl |= 0x02; 
                    if (vco.wave & 0x04) ctrl |= 0x04; 
                    if (vco.wave & 0x08) ctrl |= 0x08; 
                    write(off+4, ctrl);

                    const modA = SAFE((dests['env_a'] as number) || 0) * 15; const modD = SAFE((dests['env_d'] as number) || 0) * 15;
                    const modS = SAFE((dests['env_s'] as number) || 0) * 15; const modR = SAFE((dests['env_r'] as number) || 0) * 15;
                    const a = CLAMP(Math.floor(SAFE(s.adsr.a) * 15 + modA), 0, 15);
                    const d = CLAMP(Math.floor(SAFE(s.adsr.d) * 15 + modD), 0, 15);
                    const sust = CLAMP(Math.floor(SAFE(s.adsr.s) * 15 + modS), 0, 15);
                    const r = CLAMP(Math.floor(SAFE(s.adsr.r) * 15 + modR), 0, 15);
                    write(off+5, (a << 4) | d); write(off+6, (sust << 4) | r);
                });
            }

            // 2. DRAW CABLES (Canvas for speed)
            const ctx = cableCanvasRef.current?.getContext('2d');
            if (ctx && cableCanvasRef.current) {
                const w = cableCanvasRef.current.width;
                const h = cableCanvasRef.current.height;
                ctx.clearRect(0, 0, w, h);
                
                // Draw existing cables
                const conns = cablesRef.current;
                const jacks = jackLocations.current;
                
                // Optimized Draw Loop
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                for (const c of conns) {
                    const p1 = jacks.get(`jack-${c.from}`);
                    const p2 = jacks.get(`jack-${c.to}`);
                    if (!p1 || !p2) continue;

                    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                    const droop = Math.min(CABLE_SLACK_FACTOR, dist * 0.5);
                    
                    const signal = signalLevels.current.get(c.id) || 0;
                    const flowOffset = -(now / (1000 * (0.2 + signal))) % 40;

                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.bezierCurveTo(p1.x, p1.y + droop, p2.x, p2.y + droop, p2.x, p2.y);
                    
                    // Shadow/Glow
                    ctx.strokeStyle = c.color;
                    ctx.shadowColor = c.color;
                    ctx.shadowBlur = 10;
                    ctx.lineWidth = 4;
                    ctx.stroke();
                    ctx.shadowBlur = 0;

                    // Core
                    ctx.strokeStyle = `rgba(255,255,255,0.4)`;
                    ctx.lineWidth = 1.5;
                    ctx.stroke();

                    // Flow Ants
                    ctx.setLineDash([10, 20]);
                    ctx.lineDashOffset = flowOffset;
                    ctx.strokeStyle = `rgba(255,255,255,${0.5 + signal * 0.5})`;
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.setLineDash([]);
                }

                // Draw Dragging Cable
                if (dragStart) {
                    const el = document.getElementById(dragStart.id);
                    if (el) {
                        const rect = el.getBoundingClientRect();
                        const containerRect = containerRef.current!.getBoundingClientRect();
                        const x1 = rect.left - containerRect.left + rect.width/2;
                        const y1 = rect.top - containerRect.top + rect.height/2;
                        
                        let tx = mouseRef.current.x;
                        let ty = mouseRef.current.y;

                        // Snapping
                        if (hoveredJack) {
                            const tPos = jacks.get(hoveredJack);
                            if (tPos) { tx = tPos.x; ty = tPos.y; }
                        }

                        // Physics Whip
                        const damp = 0.85; const stiff = 0.1;
                        cablePhysics.current.vx = (tx - cablePhysics.current.x) * stiff + cablePhysics.current.vx * damp;
                        cablePhysics.current.vy = (ty - cablePhysics.current.y) * stiff + cablePhysics.current.vy * damp;
                        cablePhysics.current.x += cablePhysics.current.vx;
                        cablePhysics.current.y += cablePhysics.current.vy;

                        const midX = (x1 + tx) / 2;
                        const midY = (y1 + ty) / 2;
                        const dist = Math.hypot(tx - x1, ty - y1);
                        const sag = Math.max(50, 200 - dist * 0.2) + Math.abs(cablePhysics.current.vx * 2);
                        
                        const cpX = midX + (cablePhysics.current.x - tx) * 0.5;
                        const cpY = midY + sag + (cablePhysics.current.y - ty) * 0.5;

                        ctx.beginPath();
                        ctx.moveTo(x1, y1);
                        ctx.quadraticCurveTo(cpX, cpY, tx, ty);
                        
                        ctx.strokeStyle = "white";
                        ctx.lineWidth = 4;
                        ctx.setLineDash([10, 5]);
                        ctx.stroke();
                        ctx.setLineDash([]);
                        
                        // Connector Head
                        ctx.beginPath(); ctx.arc(x1, y1, 4, 0, Math.PI*2); ctx.fill();
                        ctx.beginPath(); ctx.arc(tx, ty, 4, 0, Math.PI*2); ctx.fill();
                    }
                }
            }

            rafId = requestAnimationFrame(update);
        };
        rafId = requestAnimationFrame(update);
        return () => cancelAnimationFrame(rafId);
    }, [player, manualGate, dragStart, hoveredJack]);

    return (
        <div ref={containerRef} onMouseMove={handleMouseMove} className="w-full h-full bg-[#1a1a20] flex flex-col font-c64 select-none relative overflow-hidden">
            <style>{`
            @keyframes dash {
              to { stroke-dashoffset: -30; }
            }
            .animate-dash {
              animation: dash 1s linear infinite;
            }
            `}</style>
            
            <div className="h-16 bg-[#2a2a35] border-b-4 border-[#6C5EB5] flex items-center justify-between px-6 shadow-xl shrink-0 relative z-20">
                <div className="flex items-center gap-4">
                    <div className="text-3xl font-black text-[#6C5EB5] tracking-widest drop-shadow-[2px_2px_0px_#000]">COMMODORE <span className="text-white">ARP</span></div>
                    <div className="h-8 w-0.5 bg-[#6C5EB5]/50"></div>
                    
                    <div className="relative">
                        <button onClick={() => setPresetsOpen(!presetsOpen)} className="flex items-center gap-2 bg-[#201550] hover:bg-[#2a1f65] px-4 py-1.5 border-2 border-[#6C5EB5] text-cyan-400 font-bold text-sm uppercase tracking-widest min-w-[200px] justify-between transition-all shadow-[4px_4px_0px_rgba(0,0,0,0.3)] active:translate-y-1 active:shadow-none">
                            {state.name || "USER PATCH"}
                            <ChevronDown className="w-4 h-4" />
                        </button>
                        {presetsOpen && (
                            <div className="absolute top-full left-0 mt-1 w-full bg-[#352879] border-2 border-[#6C5EB5] shadow-xl flex flex-col z-50 max-h-[400px] overflow-y-auto custom-scrollbar">
                                {Object.keys(groupedPresets).map(cat => (
                                    <div key={cat} className="flex flex-col">
                                        <div className="px-3 py-1 text-[9px] bg-[#2a1f65] text-[#6C5EB5] font-black uppercase tracking-widest border-b border-[#6C5EB5]/30 sticky top-0">{cat}</div>
                                        {groupedPresets[cat].map(({key, val}) => (
                                            <button 
                                                key={key} 
                                                onClick={() => { loadPreset(val); setPresetsOpen(false); }}
                                                className="text-[10px] text-[#6C5EB5] hover:bg-[#6C5EB5] hover:text-[#352879] px-3 py-2 text-left uppercase font-bold w-full border-b border-[#6C5EB5]/30 last:border-0 pl-6"
                                            >
                                                {val.name || key}
                                            </button>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="relative">
                        <button onClick={() => setMidiMenuOpen(!midiMenuOpen)} className="flex items-center gap-2 bg-[#201550] hover:bg-[#2a1f65] px-4 py-1.5 border-2 border-[#6C5EB5] text-green-400 font-bold text-sm uppercase tracking-widest min-w-[200px] justify-between transition-all shadow-[4px_4px_0px_rgba(0,0,0,0.3)] active:translate-y-1 active:shadow-none">
                            <span className="flex items-center gap-2"><Cable className="w-3 h-3"/> {midiInputs.find(i => i.id === selectedMidiId)?.name || "NO MIDI DEVICE"}</span>
                            <ChevronDown className="w-3 h-3" />
                        </button>
                        {midiMenuOpen && (
                            <div className="absolute top-full left-0 mt-1 w-full bg-[#352879] border-2 border-[#6C5EB5] shadow-xl flex flex-col z-50 max-h-[200px] overflow-y-auto custom-scrollbar">
                                {midiInputs.length > 0 ? midiInputs.map(input => (
                                    <button 
                                        key={input.id} 
                                        onClick={() => { setSelectedMidiId(input.id); setMidiMenuOpen(false); }}
                                        className={`text-[10px] hover:bg-[#6C5EB5] hover:text-[#352879] px-3 py-2 text-left uppercase font-bold w-full border-b border-[#6C5EB5]/30 last:border-0 ${selectedMidiId === input.id ? 'text-green-400 bg-[#201550]' : 'text-[#6C5EB5]'}`}
                                    >
                                        {input.name}
                                    </button>
                                )) : (
                                    <div className="px-3 py-2 text-[10px] text-[#6C5EB5] font-bold uppercase">Scanning...</div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex gap-2">
                        <button onClick={resetToInit} className="p-2 bg-[#352879] hover:bg-[#40318D] border-2 border-[#6C5EB5] text-[#6C5EB5] active:translate-y-1" title="Init Patch"><RefreshCw className="w-4 h-4" /></button>
                        <button onClick={savePatch} className="p-2 bg-[#352879] hover:bg-[#40318D] border-2 border-[#6C5EB5] text-[#6C5EB5] active:translate-y-1" title="Save Patch"><Save className="w-4 h-4" /></button>
                        <button onClick={saveBank} className="p-2 bg-[#352879] hover:bg-[#40318D] border-2 border-[#6C5EB5] text-[#6C5EB5] active:translate-y-1" title="Save Bank"><Disc className="w-4 h-4" /></button>
                        <label className="p-2 bg-[#352879] hover:bg-[#40318D] border-2 border-[#6C5EB5] text-[#6C5EB5] cursor-pointer active:translate-y-1" title="Load Patch/Bank">
                            <FolderOpen className="w-4 h-4" />
                            <input type="file" className="hidden" accept=".json" onChange={handleFileLoad} />
                        </label>
                        <button onClick={panic} className="p-2 bg-red-900 hover:bg-red-700 border-2 border-red-500 text-white active:translate-y-1 font-bold text-[10px]" title="Panic / Stop All">PANIC</button>
                    </div>
                </div>
                
                <div className="flex items-center gap-6">
                    <div className="flex flex-col items-end">
                        <span className="text-[8px] font-bold text-slate-500">VOICES</span>
                        <div className="flex gap-1">
                            {[0,1,2].map(i => <div key={i} className={`w-2 h-2 rounded-full ${voiceAssignments.current.includes(i) ? 'bg-cyan-500 animate-pulse' : 'bg-black border border-slate-700'}`}></div>)}
                        </div>
                    </div>
                    <div className="w-48 h-12 bg-black border-2 border-[#6C5EB5] rounded relative overflow-hidden shadow-[inset_0_0_20px_black] flex items-center justify-center">
                        {state.sequencer.active ? (
                            <span className="text-[10px] text-cyan-400 font-bold animate-pulse">SEQ:RUNNING</span>
                        ) : state.arpeggiator.mode !== 'OFF' ? (
                            <span className="text-[10px] text-pink-400 font-bold animate-pulse">ARP:ACTIVE</span>
                        ) : (
                            <div className="flex items-center gap-2">
                                <Activity className="w-4 h-4 text-emerald-500" />
                                <span className="text-[10px] text-emerald-500 font-bold">READY</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {!player && (
                <div 
                    onClick={() => onInit && onInit()} 
                    className="absolute inset-0 z-[100] bg-black/80 flex items-center justify-center cursor-pointer backdrop-blur-sm"
                >
                    <div className="bg-[#352879] border-4 border-[#6C5EB5] p-8 rounded-2xl flex flex-col items-center gap-4 shadow-[0_0_50px_rgba(108,94,181,0.5)] animate-bounce">
                        <Power className="w-12 h-12 text-cyan-400" />
                        <span className="text-xl font-black text-white font-c64 tracking-widest uppercase">CLICK TO ACTIVATE AUDIO</span>
                    </div>
                </div>
            )}

            <canvas ref={cableCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-50 mix-blend-screen" style={{ pointerEvents: 'none' }} />
            
            <div className="flex-1 flex overflow-x-auto overflow-y-hidden bg-[#201550] relative pb-4 shadow-inner custom-scrollbar" style={{ backgroundImage: `linear-gradient(rgba(108,94,181,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(108,94,181,0.05) 1px, transparent 1px)`, backgroundSize: '20px 20px' }}>
                
                <div className="w-8 bg-[#352879] border-r-2 border-[#6C5EB5] shadow-2xl z-10 flex flex-col items-center py-4 gap-4">
                    <Screw /><Screw /><div className="flex-1"></div><Screw /><Screw />
                </div>

                <VcoPanel id="vco1" label="VCO 1" data={state.vco1} color="blue" player={player} voiceIndex={0} />
                <VcoPanel id="vco2" label="VCO 2" data={state.vco2} color="blue" player={player} voiceIndex={1} />
                <VcoPanel id="vco3" label="VCO 3 / LFO" data={state.vco3} color="blue" player={player} voiceIndex={2} />

                <Module title="VCF" color="white" width="w-40">
                    <div className="flex gap-2 justify-center py-2">
                        <Fader label="FREQ" value={state.vcf.cutoff} onChange={(v:number)=>updateVal('vcf','cutoff',v)} color="white" showValue rawMax={2047} />
                        <Fader label="RES" value={state.vcf.res} onChange={(v:number)=>updateVal('vcf','res',v)} color="white" showValue rawMax={15} />
                    </div>
                    
                    <div className="flex justify-between gap-0.5 mt-1 bg-black/30 p-1 border-y border-[#6C5EB5]/30">
                        {['LP', 'BP', 'HP'].map((m, i) => {
                            const val = 1 << i; 
                            const isActive = (state.vcf.mode & val) !== 0;
                            return (
                                <button
                                    key={m}
                                    onClick={() => updateVal('vcf', 'mode', state.vcf.mode ^ val)}
                                    className={`px-1 py-0.5 text-[8px] font-bold border-2 transition-all ${isActive ? 'bg-[#6C5EB5] border-white text-[#352879]' : 'bg-[#201550] border-[#444] text-[#666]'}`}
                                >
                                    {m}
                                </button>
                            );
                        })}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-0.5 mt-1 text-[7px] text-[#6C5EB5] font-bold uppercase px-1">
                        {['V1','V2','V3','EXT'].map((l, i) => {
                            const key = i===3?'routeExt':`route${i+1}` as keyof typeof state.vcf;
                            return (
                                <div key={l} className="flex justify-between items-center">
                                    <span>{l}</span>
                                    <input type="checkbox" checked={!!state.vcf[key]} onChange={(e)=>updateVal('vcf', key as any, e.target.checked)} className="accent-[#6C5EB5] w-3 h-3"/>
                                </div>
                            );
                        })}
                    </div>

                    <div className="mt-auto flex flex-col gap-1 w-full items-center border-t-2 border-[#6C5EB5] pt-1 bg-[#2a2a40] p-1">
                        <div className="flex items-center justify-between w-full">
                            <Jack id="jack-vcf_cut" label="CUT" type="in" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'vcf_cut'} />
                            <Knob label="FM" value={state.vcf.fmDepth} onChange={(v:number)=>updateVal('vcf','fmDepth',v)} color="cyan" />
                        </div>
                        <div className="flex items-center justify-between w-full">
                            <Jack id="jack-vcf_res" label="RES" type="in" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'vcf_res'} />
                            <Knob label="MOD" value={state.vcf.resDepth} onChange={(v:number)=>updateVal('vcf','resDepth',v)} color="cyan" />
                        </div>
                    </div>
                </Module>

                <Module title="ENVELOPE" color="pink" width="w-32">
                    <div className="flex gap-1 justify-center py-2">
                        <Fader label="A" value={state.adsr.a} onChange={(v:number)=>updateVal('adsr','a',v)} color="pink" showValue rawMax={15} />
                        <Fader label="D" value={state.adsr.d} onChange={(v:number)=>updateVal('adsr','d',v)} color="pink" showValue rawMax={15} />
                        <Fader label="S" value={state.adsr.s} onChange={(v:number)=>updateVal('adsr','s',v)} color="pink" showValue rawMax={15} />
                        <Fader label="R" value={state.adsr.r} onChange={(v:number)=>updateVal('adsr','r',v)} color="pink" showValue rawMax={15} />
                    </div>
                    <div className="mt-auto grid grid-cols-2 gap-1 w-full border-t-2 border-[#6C5EB5] bg-[#2a2a40] p-1">
                        <Jack id="jack-env_gate" label="GATE" type="in" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'env_gate'} />
                        <Jack id="jack-env_out" label="OUT" type="out" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'env_out'} color="orange" signalLevel={player ? (player.volatileRegs[28] as number)/255 : 0} />
                        <Jack id="jack-env_a" label="CV A" type="in" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'env_a'} />
                        <Jack id="jack-env_d" label="CV D" type="in" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'env_d'} />
                        <Jack id="jack-env_s" label="CV S" type="in" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'env_s'} />
                        <Jack id="jack-env_r" label="CV R" type="in" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'env_r'} />
                    </div>
                </Module>

                <Module title="PROCESSORS" color="orange" width="w-40">
                    <div className="flex flex-col gap-2 w-full px-1 py-1">
                        <div className="flex items-center justify-between border-b border-[#6C5EB5]/30 pb-1">
                            <span className="text-[9px] font-bold text-orange-400">LFO</span>
                            <Fader label="RATE" value={state.lfo.speed} onChange={(v:number)=>updateVal('lfo','speed',v)} color="orange" />
                        </div>
                        
                        <div className="grid grid-cols-4 gap-0.5">
                            <Jack id="jack-lfo_sin" label="SIN" type="out" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'lfo_sin'} />
                            <Jack id="jack-lfo_sqr" label="SQR" type="out" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'lfo_sqr'} />
                            <Jack id="jack-lfo_saw" label="SAW" type="out" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'lfo_saw'} />
                            <Jack id="jack-lfo_tri" label="TRI" type="out" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'lfo_tri'} />
                        </div>

                        <div className="flex items-center justify-between border-t border-[#6C5EB5]/30 pt-1">
                            <span className="text-[9px] font-bold text-pink-400">S&H / NOISE</span>
                            <Fader label="RATE" value={state.sh.rate} onChange={(v:number)=>updateVal('sh','rate',v)} color="pink" />
                        </div>
                        <div className="grid grid-cols-3 gap-0.5">
                            <Jack id="jack-sh_out" label="S&H" type="out" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'sh_out'} />
                            <Jack id="jack-noise_out" label="NOI" type="out" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'noise_out'} />
                            <Jack id="jack-osc3_out" label="OSC3" type="out" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'osc3_out'} color="cyan" />
                        </div>
                    </div>
                    
                    <div className="mt-auto w-full border-t-2 border-[#6C5EB5] pt-1 flex flex-col gap-1 items-center bg-[#2a2a40] pb-1">
                        <span className="text-[7px] font-bold text-[#6C5EB5]">KEYBOARD CV</span>
                        <div className="flex gap-2">
                            <Jack id="jack-kbd_cv" label="CV" type="out" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'kbd_cv'} color="orange" />
                            <Jack id="jack-gate_out" label="GATE" type="out" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'gate_out'} color="red" />
                        </div>
                    </div>
                </Module>

                <Module title="DR. SID / CTRL" color="red" width="w-40">
                    <div className="flex flex-col gap-2 h-full">
                        <TouchPad onUpdate={(x, y) => { potRef.current = {x, y}; }} />
                        <div className="flex justify-between px-1">
                            <Jack id="jack-pot_x" label="POT X" type="out" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'pot_x'} color="cyan" />
                            <Jack id="jack-pot_y" label="POT Y" type="out" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'pot_y'} color="cyan" />
                        </div>
                        
                        <div className="h-px bg-[#444] w-full"></div>
                        
                        <div className="grid grid-cols-3 gap-0.5">
                            {['KICK','SNARE','HAT'].map((d, i) => (
                                <button 
                                    key={d}
                                    onMouseDown={() => drSid.current.trigger(i, d as DrSidDrumType)}
                                    className="bg-red-900/30 border border-red-500/50 rounded text-[7px] font-bold text-red-300 py-1 hover:bg-red-800 hover:text-white active:scale-95 transition-all"
                                >
                                    {d}
                                </button>
                            ))}
                        </div>
                        
                        <div className="flex justify-between items-center bg-black/30 p-1 rounded border border-white/5">
                            <button onClick={toggleMic} className={`p-1 rounded-full border ${micEnabled ? 'bg-red-500 text-white border-red-400' : 'bg-slate-800 text-slate-500 border-slate-700'}`}>
                                <Mic className="w-3 h-3" />
                            </button>
                            <Jack id="jack-ext_in" label="EXT IN" type="out" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'ext_in'} color="purple" />
                        </div>
                    </div>
                </Module>

                <Module title="ARPEGGIATOR" color="pink" width="w-32">
                    <div className="flex flex-col h-full justify-between">
                        <ArpeggiatorControls 
                            state={state.arpeggiator} 
                            onChange={(arpState) => updateVal('arpeggiator', '', arpState)} 
                        />
                        <div className="text-[7px] text-slate-500 mt-1 p-1 border border-slate-700 rounded bg-black/20">
                            Hold keys to activate. Syncs with global tempo.
                        </div>
                    </div>
                </Module>

                <Module title="SEQUENCER" color="cyan" width="w-64">
                    <div className="flex flex-col gap-1 h-full">
                        <div className="flex justify-between items-center bg-black/30 p-0.5 rounded border border-[#6C5EB5]/30">
                            <button onClick={() => updateVal('sequencer', 'active', !state.sequencer.active)} className={`p-0.5 rounded ${state.sequencer.active ? 'text-green-400' : 'text-slate-500'}`}>
                                {state.sequencer.active ? <Pause className="w-3 h-3"/> : <Play className="w-3 h-3"/>}
                            </button>
                            <span className="text-[9px] text-cyan-400 font-bold">STEP: {seqStep + 1}</span>
                        </div>
                        <div className="flex-1 h-full min-h-[100px]">
                             <Sequencer 
                                data={state.sequencer.steps}
                                active={state.sequencer.active}
                                speed={state.sequencer.speed}
                                arpMode={state.sequencer.arpMode ?? false}
                                onUpdate={(steps) => updateVal('sequencer', 'steps', steps)}
                                onSpeedChange={(s) => updateVal('sequencer', 'speed', s)}
                                onArpModeChange={(v) => updateVal('sequencer', 'arpMode', v)}
                                activeStep={state.sequencer.active ? seqStep : -1} 
                             />
                        </div>
                        <div className="flex justify-between p-1 border-t border-[#6C5EB5]/30">
                            <div className="flex flex-col items-center">
                                <Jack id="jack-seq_pitch" label="PITCH" type="out" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'seq_pitch'} />
                            </div>
                            <div className="flex flex-col items-center">
                                <Jack id="jack-seq_gate" label="GATE" type="out" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'seq_gate'} color="red" />
                            </div>
                            <div className="flex flex-col items-center">
                                <Jack id="jack-seq_accent" label="ACC" type="out" onStartPatch={startPatch} onEndPatch={endPatch} onMouseEnter={setHoveredJack} onMouseLeave={() => setHoveredJack(null)} active={patchingSrc === 'seq_accent'} color="purple" />
                            </div>
                        </div>
                    </div>
                </Module>

                <div className="w-8 bg-[#352879] border-l-2 border-[#6C5EB5] shadow-2xl z-10 flex flex-col items-center py-4 gap-4">
                    <Screw /><Screw /><div className="flex-1"></div><Screw /><Screw />
                </div>
            </div>
        </div>
    );
};

export default ArpSidBitPerfect;
