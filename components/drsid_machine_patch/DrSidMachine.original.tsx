
import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { SidPlayer } from '../services/sidService';
import { DrSid, DrumModifiers, DrSidDrumType, DrumPatch, DrSidService, FACTORY_BANKS, DEMO_PATTERNS } from '../services/drSidService';
import { Disc, Play, Pause, Power, Save, Upload, RefreshCw, Copy, ChevronLeft, ChevronRight, Zap, Activity, Filter, Waves, Download, Music, BarChart3, Volume2, VolumeX, ArrowLeft, ArrowRight } from 'lucide-react';

interface DrSidMachineProps {
    player: SidPlayer | null;
    isOpen: boolean;
    onClose?: () => void;
}

// --- VISUALIZATION COMPONENTS ---

const VoiceScope = memo(({ player, voiceIdx, color, height = 32 }: { player: SidPlayer | null, voiceIdx: number, color: string, height?: number }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        let rafId = 0;
        const draw = () => {
            const w = canvas.width;
            const h = canvas.height;
            
            ctx.fillStyle = '#050708';
            ctx.fillRect(0, 0, w, h);
            
            // Grid lines
            ctx.strokeStyle = '#1a1c23';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, h/2); ctx.lineTo(w, h/2);
            ctx.stroke();

            if (player && player.volatileVoiceStates && player.volatileVoiceStates[voiceIdx]) {
                const state = player.volatileVoiceStates[voiceIdx];
                const level = state.level || 0;
                
                if (level > 0.01) {
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.5;
                    ctx.shadowBlur = 4;
                    ctx.shadowColor = color;
                    ctx.beginPath();
                    
                    const freq = state.freq || 0;
                    const wave = state.ctrl || 0;
                    const pw = state.pw || 2048;
                    
                    // Synthetic waveform rendering based on register state
                    // This creates a stable visualization representing the current sound parameters
                    const period = 20 + (1 - (freq / 65535)) * 100; // Visual period
                    
                    for (let x = 0; x < w; x++) {
                        const t = (x / period) * Math.PI * 2;
                        let y = 0;
                        
                        if (wave & 0x10) y += Math.asin(Math.sin(t)) * 0.6; // Tri
                        if (wave & 0x20) y += ((t % (Math.PI*2)) / Math.PI - 1) * 0.8; // Saw
                        if (wave & 0x40) y += (Math.sin(t) > ((pw/4095)-0.5)*2 ? 0.8 : -0.8); // Pulse
                        if (wave & 0x80) y += (Math.random() * 2 - 1) * 0.8; // Noise
                        
                        const amp = (h/2 - 2) * level;
                        const py = (h/2) + y * amp;
                        
                        if (x === 0) ctx.moveTo(x, py);
                        else ctx.lineTo(x, py);
                    }
                    ctx.stroke();
                    ctx.shadowBlur = 0;
                }
            }
            rafId = requestAnimationFrame(draw);
        };
        draw();
        return () => cancelAnimationFrame(rafId);
    }, [player, voiceIdx, color]);

    return (
        <canvas 
            ref={canvasRef} 
            width={120} 
            height={height} 
            className="w-full h-full rounded bg-[#050708] border border-white/5"
        />
    );
});

const Knob = ({ label, value, onChange, min = 0, max = 1, color = 'cyan', disabled = false, size = 'md' }: any) => {
    const [dragging, setDragging] = useState(false);
    const startY = useRef(0);
    const startVal = useRef(0);

    const onMouseDown = (e: React.MouseEvent) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(true);
        startY.current = e.clientY;
        startVal.current = value;
    };

    useEffect(() => {
        const move = (e: MouseEvent) => {
            if (!dragging) return;
            const delta = (startY.current - e.clientY) / 150;
            const newVal = Math.min(max, Math.max(min, startVal.current + delta));
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
    const ang = -135 + (pct * 270);
    const szClass = size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';

    return (
        <div className={`flex flex-col items-center gap-1 group select-none ${disabled ? 'opacity-40 grayscale pointer-events-none' : ''}`}>
            <div 
                className={`${szClass} rounded-full bg-gradient-to-b from-[#333] to-[#111] border border-[#222] relative shadow-lg cursor-ns-resize`}
                onMouseDown={onMouseDown}
            >
                <div className="absolute inset-0 rounded-full border border-white/5"></div>
                {/* Tick marks ring */}
                <svg className="absolute inset-[-4px] w-[120%] h-[120%] pointer-events-none opacity-40" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="46" fill="none" stroke="#444" strokeWidth="2" strokeDasharray="2 4" strokeDashoffset="0" transform="rotate(135 50 50)" />
                    <path d="M50 50 L50 4" stroke={`var(--color-${color})`} strokeWidth="2" transform={`rotate(${ang} 50 50)`} strokeLinecap="round" className={dragging ? 'opacity-100' : 'opacity-0'} />
                </svg>
                {/* Indicator */}
                <div 
                    className="absolute top-0 left-[50%] ml-[-1px] w-0.5 h-1/2 origin-bottom transition-transform duration-75"
                    style={{ transform: `rotate(${ang}deg) translateY(0)` }}
                >
                    <div className={`w-full h-3 bg-${color}-500 rounded-full shadow-[0_0_5px_${color}] mt-1`}></div>
                </div>
            </div>
            <div className="flex flex-col items-center leading-none">
                <span className="text-[7px] font-black text-slate-500 tracking-widest">{label}</span>
                {dragging && <span className={`absolute -mt-8 z-50 bg-black/90 text-${color}-400 text-[9px] font-mono px-1 py-0.5 rounded border border-white/10`}>{value.toFixed(2)}</span>}
            </div>
        </div>
    );
};

const LcdScreen = ({ text, subtext, bpm, bank, mode, onPrevKit, onNextKit }: any) => (
    <div className="bg-[#050805] border-2 border-[#333] rounded-md px-2 py-1 shadow-[inset_0_0_20px_rgba(0,0,0,1)] flex flex-col justify-between h-20 w-40 relative overflow-hidden shrink-0 group">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(0,50,0,0.1)_50%,transparent_50%)] bg-[size:100%_2px] pointer-events-none z-10"></div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,50,0,0.2),transparent)] pointer-events-none"></div>
        
        <div className="flex justify-between items-start z-0">
            <span className="text-[7px] font-bold text-emerald-700">MODE: {mode}</span>
            <span className="text-[7px] font-bold text-emerald-700">BANK: {bank}</span>
        </div>
        
        <div className="text-right z-0 flex flex-col justify-end h-full pb-1">
            <div className="text-3xl font-mono font-bold text-emerald-500 tracking-tighter leading-none shadow-emerald-900/50 drop-shadow-md mb-1">{text}</div>
            
            {/* Kit Selector */}
            <div className="flex items-center justify-end gap-1 mt-1 bg-emerald-900/10 rounded px-1 -mr-1">
                <button 
                    onClick={onPrevKit} 
                    className="text-emerald-700 hover:text-emerald-400 transition-colors p-0.5"
                >
                    <ArrowLeft className="w-2.5 h-2.5" />
                </button>
                <div className="text-[9px] font-mono text-emerald-400 uppercase leading-tight tracking-wider truncate max-w-[90px] text-center">
                    {subtext}
                </div>
                <button 
                    onClick={onNextKit} 
                    className="text-emerald-700 hover:text-emerald-400 transition-colors p-0.5"
                >
                    <ArrowRight className="w-2.5 h-2.5" />
                </button>
            </div>
        </div>
    </div>
);

// --- DRUM EDITOR ---

const DrumEditor = ({ drumType, patch, onUpdate, player, voiceIdx }: { drumType: DrSidDrumType, patch: DrumPatch, onUpdate: (p: Partial<DrumPatch>) => void, player: SidPlayer | null, voiceIdx: number }) => {
    if (!patch) return <div className="flex items-center justify-center h-full text-slate-600 text-xs font-bold uppercase tracking-widest">Select a Track to Edit</div>;

    const toggleWave = (flag: number) => {
        let w = patch.wave;
        if (flag >= 0x10) w = (w & 0x0F) | flag; 
        else w = w ^ flag;
        onUpdate({ wave: w });
    };

    return (
        <div className="flex gap-4 h-full p-3 bg-[#0c0e12] rounded-lg border border-[#222] shadow-inner relative overflow-hidden">
            {/* OSC SECTION */}
            <div className="flex flex-col gap-3 w-48 border-r border-[#222] pr-3">
                <div className="flex justify-between items-center">
                    <span className="text-[8px] font-black text-slate-500 tracking-widest flex items-center gap-1"><Waves className="w-3 h-3 text-cyan-600"/> OSCILLATOR</span>
                    <div className="h-4 w-12 rounded bg-black border border-white/5 overflow-hidden">
                        <VoiceScope player={player} voiceIdx={voiceIdx} color="#22d3ee" height={16} />
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-y-3 gap-x-1">
                    <Knob label="FREQ" value={patch.fStart} min={20} max={2000} onChange={(v:number) => onUpdate({ fStart: v })} color="cyan" size="sm" />
                    <Knob label="END" value={patch.fEnd} min={20} max={2000} onChange={(v:number) => onUpdate({ fEnd: v })} color="cyan" size="sm" />
                    <Knob label="SWEEP" value={patch.sweep} min={0} max={100} onChange={(v:number) => onUpdate({ sweep: v })} color="blue" size="sm" />
                    <Knob label="PULSE" value={patch.pw} min={0} max={4095} onChange={(v:number) => onUpdate({ pw: v })} color="pink" size="sm" />
                    <Knob label="PW.LFO" value={patch.pwSweep || 0} min={0} max={100} onChange={(v:number) => onUpdate({ pwSweep: v })} color="purple" size="sm" />
                </div>
                <div className="flex gap-0.5 mt-auto bg-[#151518] p-1 rounded border border-[#222]">
                    {[{l:'TRI',v:0x10},{l:'SAW',v:0x20},{l:'PUL',v:0x40},{l:'NOI',v:0x80}].map(w => (
                        <button key={w.l} onClick={() => toggleWave(w.v)} className={`flex-1 text-[7px] font-bold py-1 rounded ${patch.wave & w.v ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-600 hover:bg-[#222]'}`}>{w.l}</button>
                    ))}
                </div>
            </div>

            {/* ENVELOPE SECTION */}
            <div className="flex flex-col gap-3 w-40 border-r border-[#222] pr-3">
                <span className="text-[8px] font-black text-slate-500 tracking-widest flex items-center gap-1"><Activity className="w-3 h-3 text-amber-600"/> ENVELOPE</span>
                <div className="flex justify-around">
                    <Knob label="DECAY" value={patch.dur} min={0.01} max={1.0} onChange={(v:number) => onUpdate({ dur: v })} color="amber" size="sm" />
                    <div className="flex flex-col gap-1.5 justify-center">
                        <label className="flex items-center gap-2 text-[8px] text-slate-400 font-bold cursor-pointer hover:text-white">
                            <input type="checkbox" checked={!!patch.ring} onChange={(e) => onUpdate({ ring: e.target.checked })} className="accent-pink-500"/> RING
                        </label>
                        <label className="flex items-center gap-2 text-[8px] text-slate-400 font-bold cursor-pointer hover:text-white">
                            <input type="checkbox" checked={!!patch.sync} onChange={(e) => onUpdate({ sync: e.target.checked })} className="accent-pink-500"/> SYNC
                        </label>
                        <label className="flex items-center gap-2 text-[8px] text-slate-400 font-bold cursor-pointer hover:text-white">
                            <input type="checkbox" checked={!!patch.hardReset} onChange={(e) => onUpdate({ hardReset: e.target.checked })} className="accent-red-500"/> RESET
                        </label>
                    </div>
                </div>
                <div className="bg-[#151518] p-1.5 rounded border border-[#222] mt-auto">
                    <div className="flex justify-between mb-1">
                        <span className="text-[7px] text-slate-600 font-bold">AD</span>
                        <span className="text-[7px] text-amber-500 font-mono">{patch.ad.toString(16).toUpperCase().padStart(2,'0')}</span>
                    </div>
                    <input type="range" min="0" max="255" value={patch.ad} onChange={(e) => onUpdate({ ad: parseInt(e.target.value) })} className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"/>
                    <div className="flex justify-between mt-1 mb-1">
                        <span className="text-[7px] text-slate-600 font-bold">SR</span>
                        <span className="text-[7px] text-amber-500 font-mono">{patch.sr.toString(16).toUpperCase().padStart(2,'0')}</span>
                    </div>
                    <input type="range" min="0" max="255" value={patch.sr} onChange={(e) => onUpdate({ sr: parseInt(e.target.value) })} className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"/>
                </div>
            </div>

            {/* FILTER SECTION */}
            <div className="flex flex-col gap-3 flex-1">
                <div className="flex justify-between items-center">
                    <span className="text-[8px] font-black text-slate-500 tracking-widest flex items-center gap-1"><Filter className="w-3 h-3 text-emerald-600"/> FILTER</span>
                    <input type="checkbox" checked={!!patch.filter?.enabled} onChange={(e) => onUpdate({ filter: { ...patch.filter!, enabled: e.target.checked } })} className="accent-emerald-500"/>
                </div>
                <div className={`grid grid-cols-2 gap-2 ${!patch.filter?.enabled ? 'opacity-30 pointer-events-none' : ''}`}>
                    <Knob label="CUT" value={patch.filter?.cutStart||0} min={0} max={1} onChange={(v:number) => onUpdate({ filter: { ...patch.filter!, cutStart: v } })} color="emerald" size="sm" />
                    <Knob label="RES" value={patch.filter?.res||0} min={0} max={15} onChange={(v:number) => onUpdate({ filter: { ...patch.filter!, res: v } })} color="emerald" size="sm" />
                    <Knob label="SWEEP" value={patch.filter?.sweep||0} min={0} max={50} onChange={(v:number) => onUpdate({ filter: { ...patch.filter!, sweep: v } })} color="emerald" size="sm" />
                    <div className="flex flex-col gap-1 justify-center">
                        {[1,2,4].map(m => (
                            <button 
                                key={m}
                                onClick={() => onUpdate({ filter: { ...patch.filter!, mode: m } })}
                                className={`text-[7px] font-bold py-0.5 px-1 rounded border ${patch.filter?.mode === m ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-[#151518] text-slate-600 border-[#222]'}`}
                            >
                                {m===1?'LP':m===2?'BP':'HP'}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- HELPER ---
const safeLoadPatterns = (input: any): boolean[][][] => {
    if (!Array.isArray(input)) return JSON.parse(JSON.stringify(DEMO_PATTERNS));
    const result: boolean[][][] = [];
    for(let b=0; b<4; b++) {
        const bank = Array.isArray(input[b]) ? input[b] : [];
        const cleanBank: boolean[][] = [];
        for(let t=0; t<4; t++) {
            const track = Array.isArray(bank[t]) ? bank[t] : [];
            const cleanTrack: boolean[] = [];
            for(let s=0; s<16; s++) {
                cleanTrack.push(!!track[s]);
            }
            cleanBank.push(cleanTrack);
        }
        result.push(cleanBank);
    }
    return result;
};

// --- MAIN COMPONENT ---

export const DrSidMachine: React.FC<DrSidMachineProps> = ({ player, isOpen }) => {
    // --- STATE ---
    const [isPowered, setIsPowered] = useState(true);
    const [playing, setPlaying] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    
    const [viewMode, setViewMode] = useState<'SEQ' | 'EDIT'>('SEQ');
    const [selectedTrackIdx, setSelectedTrackIdx] = useState(0); 
    
    const [syncMode, setSyncMode] = useState<'INT' | 'MIDI'>('INT');
    const [midiConnected, setMidiConnected] = useState(false);
    
    const [tempo, setTempo] = useState(140); 
    const [swing, setSwing] = useState(0); 
    const [activeBank, setActiveBank] = useState(0); 
    const [bankName, setBankName] = useState("DUBSTEP_PRO");
    const [percType, setPercType] = useState<DrSidDrumType>('TOM');
    
    const [currentPatch, setCurrentPatch] = useState<DrumPatch | null>(null);
    const [patterns, setPatterns] = useState<boolean[][][]>(JSON.parse(JSON.stringify(DEMO_PATTERNS)));
    const [mutes, setMutes] = useState<boolean[]>([false, false, false, false]);
    const [solos, setSolos] = useState<boolean[]>([false, false, false, false]);

    const [currentStep, setCurrentStep] = useState(0);
    const currentStepRef = useRef(0);
    const [modifiers, setModifiers] = useState<DrumModifiers>({ tune: 1.0, decay: 1.0, tone: 1.0 });
    
    const drSid = useRef(new DrSid());
    const seqTimer = useRef(0);
    const lastTime = useRef(0);
    const rafRef = useRef(0);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- PERSISTENCE & INIT ---
    useEffect(() => {
        try {
            const savedState = localStorage.getItem('drsid_state');
            if (savedState) {
                const data = JSON.parse(savedState);
                if (data.patterns) setPatterns(safeLoadPatterns(data.patterns));
                if (data.customKit) drSid.current.loadUserBanks(data.customKit.map((b:any) => DrSidService.validateBank(b)));
                else drSid.current.loadUserBanks(JSON.parse(JSON.stringify(FACTORY_BANKS)));
                if (data.mutes) setMutes(data.mutes);
                if (data.solos) setSolos(data.solos);
                if (data.tempo) setTempo(data.tempo);
                setBankName(drSid.current.getBankName());
                refreshPatch();
            }
        } catch (e) {
            drSid.current.loadUserBanks(JSON.parse(JSON.stringify(FACTORY_BANKS)));
            setBankName(drSid.current.getBankName());
            refreshPatch();
        }
    }, []);

    useEffect(() => {
        const stateToSave = { patterns, customKit: drSid.current.banks, mutes, solos, tempo };
        localStorage.setItem('drsid_state', JSON.stringify(stateToSave));
    }, [patterns, mutes, solos, tempo, bankName]); 
    
    useEffect(() => {
        drSid.current.setBank(activeBank);
        setBankName(drSid.current.getBankName());
        refreshPatch();
    }, [activeBank]);

    useEffect(() => refreshPatch(), [activeBank, percType, selectedTrackIdx]);

    const refreshPatch = () => {
        let type: DrSidDrumType = 'KICK';
        if (selectedTrackIdx === 0) type = 'KICK';
        else if (selectedTrackIdx === 1) type = 'SNARE';
        else if (selectedTrackIdx === 2) type = 'HAT';
        else if (selectedTrackIdx === 3) type = percType;
        const p = drSid.current.getCurrentPatch(type);
        setCurrentPatch(p ? { ...p } : null);
    };

    const isTrackAudible = useCallback((trackIdx: number) => {
        const hasSolo = solos.some(s => s);
        if (hasSolo) return solos[trackIdx];
        return !mutes[trackIdx];
    }, [mutes, solos]);

    const triggerStep = useCallback((step: number) => {
        const pat = patterns[activeBank];
        const trig = (t: number, type: DrSidDrumType) => {
            if (pat[t][step] && isTrackAudible(t)) drSid.current.trigger(t > 2 ? (type === 'HAT_OPEN' ? 2 : (type === 'CLAP' ? 1 : 0)) : t, type);
        };
        trig(0, 'KICK');
        trig(1, 'SNARE');
        trig(2, 'HAT');
        if (pat[3][step] && isTrackAudible(3)) drSid.current.trigger(percType === 'HAT_OPEN' ? 2 : (percType === 'CLAP' ? 1 : 0), percType);
    }, [patterns, activeBank, percType, isTrackAudible]);

    // --- AUDIO LOOP ---
    useEffect(() => {
        const loop = (time: number) => {
            if (!isPowered) return;
            const dt = (time - lastTime.current) / 1000;
            lastTime.current = time;

            if (playing && syncMode === 'INT') {
                const baseStepTime = 15.0 / tempo; 
                let currentStepDuration = baseStepTime;
                if (swing > 0) {
                    const isEven = currentStep % 2 === 0;
                    const swingFactor = (swing / 100) * 0.5; 
                    if (isEven) currentStepDuration = baseStepTime * (1 + swingFactor);
                    else currentStepDuration = baseStepTime * (1 - swingFactor);
                }
                seqTimer.current += dt;
                if (seqTimer.current >= currentStepDuration) {
                    seqTimer.current -= currentStepDuration;
                    const nextStep = (currentStep + 1) % 16;
                    setCurrentStep(nextStep);
                    currentStepRef.current = nextStep;
                    triggerStep(nextStep);
                }
            }

            if (player) {
                drSid.current.setModifiers(modifiers);
                const processVoice = (vIdx: number, mapIdx: number) => {
                    const v = drSid.current.process(vIdx);
                    if (v) {
                        if (v.retrigger) player.liveWrite(mapIdx + 4, v.ctrl & 0xFE); 
                        const f = Math.round((v.freq * 16777216) / 985248);
                        player.liveWrite(mapIdx + 0, f & 0xFF); 
                        player.liveWrite(mapIdx + 1, (f >> 8) & 0xFF);
                        player.liveWrite(mapIdx + 2, v.pw & 0xFF); 
                        player.liveWrite(mapIdx + 3, (v.pw >> 8) & 0x0F);
                        player.liveWrite(mapIdx + 4, v.ctrl); 
                        player.liveWrite(mapIdx + 5, v.ad); 
                        player.liveWrite(mapIdx + 6, v.sr);
                    }
                };
                processVoice(0, 0); processVoice(1, 7); processVoice(2, 14);
                const filter = drSid.current.getFilterState();
                player.liveWrite(21, filter.cut & 0x07);
                player.liveWrite(22, (filter.cut >> 3) & 0xFF);
                player.liveWrite(23, (filter.res << 4) | (filter.route & 0x0F));
                player.liveWrite(24, (filter.mode << 4) | 0x0F);
            }
            rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(rafRef.current);
    }, [isPowered, playing, syncMode, tempo, modifiers, player, triggerStep, currentStep, swing]);

    // --- ACTIONS ---
    const toggleStep = (trackIdx: number, stepIdx: number) => {
        setPatterns(prev => {
            const next = [...prev];
            next[activeBank][trackIdx][stepIdx] = !next[activeBank][trackIdx][stepIdx];
            return next;
        });
    };

    const toggleMute = (trackIdx: number) => {
        setMutes(prev => {
            const next = [...prev];
            next[trackIdx] = !next[trackIdx];
            return next;
        });
    };

    const toggleSolo = (trackIdx: number) => {
        setSolos(prev => {
            const next = [...prev];
            next[trackIdx] = !next[trackIdx];
            return next;
        });
    };

    const saveKit = () => {
        const state = {
            version: "3.1",
            type: "DRSID_KIT",
            bankName,
            tempo,
            swing,
            patterns,
            customKit: drSid.current.banks,
            mutes,
            solos
        };
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `drsid_kit_${bankName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const loadBank = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const json = JSON.parse(ev.target?.result as string);
                
                // Case 1: Full DrSid Kit State (Native)
                if (json.type === "DRSID_KIT" || json.customKit) {
                    if (json.patterns) setPatterns(safeLoadPatterns(json.patterns));
                    if (json.tempo) setTempo(json.tempo);
                    if (json.swing !== undefined) setSwing(json.swing);
                    if (json.mutes) setMutes(json.mutes);
                    if (json.solos) setSolos(json.solos);
                    if (json.bankName) setBankName(json.bankName);
                    
                    if (json.customKit) {
                        const validBanks = json.customKit.map((b: any) => DrSidService.validateBank(b));
                        drSid.current.loadUserBanks(validBanks);
                        setActiveBank(0);
                        setBankName(drSid.current.getBankName());
                        refreshPatch();
                    }
                } 
                // Case 2: Legacy Bank Array
                else if (Array.isArray(json)) {
                    const validBanks = json.map((b: any) => DrSidService.validateBank(b));
                    drSid.current.loadUserBanks(validBanks);
                    setActiveBank(0);
                    refreshPatch();
                }
                // Case 3: Single Bank Object
                else if (json.patches) {
                    const banks = [DrSidService.validateBank(json)];
                    drSid.current.loadUserBanks(banks);
                    setActiveBank(0);
                    refreshPatch();
                }
                
                // Persist loaded state immediately
                const stateToSave = { patterns, customKit: drSid.current.banks, mutes, solos, tempo };
                localStorage.setItem('drsid_state', JSON.stringify(stateToSave));
                
            } catch(e) {
                console.error("Load failed", e);
                alert("Invalid Kit File");
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const swapKit = (dir: number) => {
        const currentName = drSid.current.getBankName();
        // Find current index in FACTORY_BANKS if possible, or cycle through all
        // We'll iterate the FACTORY_BANKS array to find next one
        const idx = FACTORY_BANKS.findIndex(b => b.name === currentName);
        let nextIdx = 0;
        if (idx !== -1) {
            nextIdx = (idx + dir + FACTORY_BANKS.length) % FACTORY_BANKS.length;
        } else {
            // If custom name not in factory list, default to first or last
            nextIdx = dir > 0 ? 0 : FACTORY_BANKS.length - 1;
        }
        
        const nextKit = FACTORY_BANKS[nextIdx];
        drSid.current.replaceActiveBank(nextKit);
        setBankName(drSid.current.getBankName());
        refreshPatch();
        
        // Auto-persist changes
        const stateToSave = { patterns, customKit: drSid.current.banks, mutes, solos, tempo };
        localStorage.setItem('drsid_state', JSON.stringify(stateToSave));
    };

    const updatePatch = (changes: Partial<DrumPatch>) => {
        if (!currentPatch) return;
        let type: DrSidDrumType = 'KICK';
        if (selectedTrackIdx === 0) type = 'KICK';
        else if (selectedTrackIdx === 1) type = 'SNARE';
        else if (selectedTrackIdx === 2) type = 'HAT';
        else if (selectedTrackIdx === 3) type = percType;
        drSid.current.updatePatch(type, changes);
        refreshPatch();
    };

    // Helper to determine voice index for visualization based on track
    const getVoiceForTrack = (trackIdx: number) => {
        if (trackIdx === 0) return 0;
        if (trackIdx === 1) return 1;
        if (trackIdx === 2) return 2;
        // Perc/Track 3 uses different voices depending on type
        if (percType === 'TOM') return 0;
        if (percType === 'CLAP') return 1;
        return 2;
    };

    if (!isOpen) return null;

    return (
        <div className="w-full h-full bg-[#050505] flex flex-col font-c64 select-none relative overflow-hidden">
            {/* COMPACT HEADER */}
            <div className="h-8 bg-[#111] border-b border-[#222] flex items-center justify-between px-3 shadow-lg z-20 shrink-0">
                <div className="flex items-center gap-2">
                    <div className="w-5 h-5 bg-gradient-to-br from-blue-600 to-blue-900 rounded flex items-center justify-center shadow-[0_0_10px_rgba(37,99,235,0.4)] border border-blue-400/30">
                        <Disc className="text-white w-3 h-3 animate-spin-slow" />
                    </div>
                    <span className="text-sm font-black text-slate-300 tracking-[0.2em]">DR.SID <span className="text-[9px] text-blue-500 font-normal">v3.1</span></span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex bg-[#1a1a1d] rounded p-0.5 border border-[#333]">
                        <button className="px-2 py-0.5 text-[8px] font-bold text-slate-400 hover:text-white hover:bg-[#333] rounded" onClick={saveKit}><Save className="w-2.5 h-2.5 inline mr-1"/>SAVE</button>
                        <div className="w-px h-3 bg-[#333] mx-0.5"></div>
                        <button className="px-2 py-0.5 text-[8px] font-bold text-slate-400 hover:text-white hover:bg-[#333] rounded" onClick={() => fileInputRef.current?.click()}><Upload className="w-2.5 h-2.5 inline mr-1"/>LOAD</button>
                        <input ref={fileInputRef} type="file" className="hidden" onChange={loadBank} accept=".json" />
                    </div>
                    <button onClick={() => setIsPowered(!isPowered)} className={`p-1 rounded-full border transition-all ${isPowered ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-red-900/20 border-red-900 text-red-800'}`}><Power className="w-3 h-3"/></button>
                </div>
            </div>

            {/* MAIN INTERFACE */}
            <div className={`flex-1 bg-[#08080a] p-3 flex flex-col gap-3 overflow-y-auto relative ${!isPowered ? 'grayscale opacity-40 pointer-events-none' : ''}`}>
                
                {/* GLOBAL CONTROLS & LCD */}
                <div className="flex gap-3 h-24 shrink-0">
                    <LcdScreen 
                        text={`${Math.round(tempo)} BPM`} 
                        subtext={bankName} 
                        bank={['A','B','C','D'][activeBank]} 
                        mode={syncMode}
                        onPrevKit={() => swapKit(-1)}
                        onNextKit={() => swapKit(1)}
                    />
                    
                    <div className="flex-1 bg-[#111] rounded-lg border border-[#222] p-2 flex items-center justify-around shadow-inner">
                        <Knob label="TUNE" value={modifiers.tune} min={0.5} max={2.0} onChange={(v:number) => setModifiers(m=>({...m, tune:v}))} color="blue" />
                        <Knob label="DECAY" value={modifiers.decay} min={0.2} max={2.5} onChange={(v:number) => setModifiers(m=>({...m, decay:v}))} color="pink" />
                        <Knob label="SNAP" value={modifiers.tone} min={0.5} max={2.0} onChange={(v:number) => setModifiers(m=>({...m, tone:v}))} color="amber" />
                        <div className="w-px h-10 bg-[#222]"></div>
                        <Knob label="TEMPO" value={tempo} min={60} max={200} onChange={setTempo} color="emerald" />
                        <Knob label="SWING" value={swing} min={0} max={50} onChange={setSwing} color="purple" />
                    </div>

                    <div className="w-24 bg-[#111] rounded-lg border border-[#222] p-2 flex flex-col justify-between items-center shadow-inner">
                        <button 
                            onClick={() => setPlaying(!playing)}
                            className={`w-full h-8 rounded flex items-center justify-center gap-1 text-[9px] font-black border-b-2 active:border-b-0 active:translate-y-[1px] transition-all ${playing ? 'bg-emerald-600 border-emerald-800 text-white shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-[#222] border-black text-slate-400'}`}
                        >
                            {playing ? <Pause className="w-3 h-3"/> : <Play className="w-3 h-3"/>} PLAY
                        </button>
                        <div className="flex gap-1 w-full">
                            <button onClick={() => setPatterns(prev => { const n=[...prev]; n[activeBank] = Array(4).fill(0).map(() => Array(16).fill(false)); return n; })} className="flex-1 h-6 bg-[#1a1a1d] border border-black rounded text-red-500 hover:text-white flex items-center justify-center"><RefreshCw className="w-3 h-3"/></button>
                            <button onClick={() => {}} className="flex-1 h-6 bg-[#1a1a1d] border border-black rounded text-slate-500 hover:text-white flex items-center justify-center"><Copy className="w-3 h-3"/></button>
                        </div>
                    </div>
                </div>

                {/* VISUALIZERS STRIP */}
                <div className="h-12 flex gap-1 bg-[#0c0e12] rounded border border-[#222] p-1 shadow-inner">
                    {[0,1,2].map(vIdx => (
                        <div key={vIdx} className="flex-1 relative border-r border-[#222] last:border-0 bg-black rounded overflow-hidden group">
                            <div className="absolute top-0.5 left-1 text-[7px] font-bold text-slate-600 z-10 group-hover:text-slate-400">VOICE_{vIdx+1}</div>
                            <VoiceScope player={player} voiceIdx={vIdx} color={['#22d3ee', '#f472b6', '#fbbf24'][vIdx]} height={40} />
                        </div>
                    ))}
                </div>

                {/* MODE & TRACK SELECT */}
                <div className="flex justify-between items-end border-b border-[#222] pb-2">
                    <div className="flex gap-1 bg-[#111] p-1 rounded border border-[#222]">
                        {['A','B','C','D'].map((b, i) => (
                            <button key={b} onClick={() => setActiveBank(i)} className={`w-8 h-5 rounded text-[9px] font-bold ${activeBank===i ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-[#222]'}`}>{b}</button>
                        ))}
                    </div>
                    <div className="flex gap-1">
                        <button onClick={() => setViewMode('SEQ')} className={`px-4 py-1 text-[9px] font-bold rounded-t border-t border-x ${viewMode === 'SEQ' ? 'bg-[#151518] border-[#333] text-cyan-400' : 'border-transparent text-slate-600 hover:text-slate-400'}`}>SEQUENCER</button>
                        <button onClick={() => setViewMode('EDIT')} className={`px-4 py-1 text-[9px] font-bold rounded-t border-t border-x ${viewMode === 'EDIT' ? 'bg-[#151518] border-[#333] text-amber-400' : 'border-transparent text-slate-600 hover:text-slate-400'}`}>PATCH EDIT</button>
                    </div>
                </div>

                {/* MAIN CONTENT AREA */}
                <div className="flex-1 bg-[#151518] rounded-lg border border-[#222] p-2 shadow-inner relative overflow-hidden">
                    {viewMode === 'SEQ' ? (
                        <div className="flex flex-col gap-2 h-full">
                            {[
                                { id: 'KICK', label: 'KICK', color: 'cyan', vIdx: 0 },
                                { id: 'SNARE', label: 'SNARE', color: 'pink', vIdx: 1 },
                                { id: 'HAT', label: 'HIHAT', color: 'amber', vIdx: 2 },
                                { id: 'PERC', label: percType, color: 'emerald', configurable: true, vIdx: getVoiceForTrack(3) }
                            ].map((track, trackIdx) => (
                                <div key={trackIdx} className="flex gap-2 h-10 items-center">
                                    {/* Track Header */}
                                    <div className={`w-20 bg-[#0c0e10] rounded border ${selectedTrackIdx === trackIdx ? `border-${track.color}-900` : 'border-[#222]'} flex flex-col justify-center px-2 cursor-pointer relative hover:bg-[#1a1a1d] transition-colors`} onClick={() => setSelectedTrackIdx(trackIdx)}>
                                        <div className="flex justify-between items-center">
                                            <span className={`text-[9px] font-black ${selectedTrackIdx === trackIdx ? `text-${track.color}-400` : 'text-slate-500'}`}>{track.label}</span>
                                            <div className="flex gap-0.5">
                                                <button onClick={(e) => {e.stopPropagation(); toggleMute(trackIdx);}} className={`w-3 h-3 text-[6px] border rounded ${mutes[trackIdx] ? 'bg-red-900 border-red-700 text-white' : 'bg-[#111] border-[#333] text-slate-600'}`}>M</button>
                                                <button onClick={(e) => {e.stopPropagation(); toggleSolo(trackIdx);}} className={`w-3 h-3 text-[6px] border rounded ${solos[trackIdx] ? 'bg-yellow-600 border-yellow-500 text-white' : 'bg-[#111] border-[#333] text-slate-600'}`}>S</button>
                                            </div>
                                        </div>
                                        {track.configurable && (
                                            <button onClick={(e) => { e.stopPropagation(); setPercType(p => p==='TOM'?'CLAP':p==='CLAP'?'HAT_OPEN':'TOM'); }} className="text-[7px] text-slate-600 hover:text-white mt-0.5 text-left">TYPE: {percType}</button>
                                        )}
                                        {/* Activity LED */}
                                        <div className={`absolute right-1 top-1 w-1 h-1 rounded-full ${patterns[activeBank][trackIdx].some((x,i) => x && i === currentStep && playing && isTrackAudible(trackIdx)) ? `bg-${track.color}-400 shadow-[0_0_8px_currentColor]` : 'bg-[#222]'}`}></div>
                                    </div>

                                    {/* Steps */}
                                    <div className="flex-1 flex gap-0.5 h-full">
                                        {patterns[activeBank][trackIdx].map((active, step) => (
                                            <button
                                                key={step}
                                                onMouseDown={() => toggleStep(trackIdx, step)}
                                                onMouseEnter={(e) => { if (e.buttons === 1) toggleStep(trackIdx, step); }}
                                                className={`
                                                    flex-1 rounded-[2px] transition-all relative overflow-hidden
                                                    ${active 
                                                        ? (track.color === 'cyan' ? 'bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.4)]' : track.color === 'pink' ? 'bg-pink-500 shadow-[0_0_8px_rgba(236,72,153,0.4)]' : track.color === 'amber' ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]' : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]')
                                                        : (step % 4 === 0 ? 'bg-[#1a1a1d]' : 'bg-[#0c0e10]')
                                                    }
                                                    ${step === currentStep ? 'brightness-150 z-10 scale-105 border-y border-white/50' : ''}
                                                    hover:brightness-125
                                                `}
                                            />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="h-full flex flex-col gap-2">
                            <div className="flex items-center gap-2 mb-1">
                                {['KICK','SNARE','HAT','PERC'].map((name, i) => (
                                    <button 
                                        key={i} 
                                        onClick={() => setSelectedTrackIdx(i)}
                                        className={`px-3 py-1 text-[9px] font-bold rounded border ${selectedTrackIdx===i ? 'bg-[#222] border-white/20 text-white' : 'border-transparent text-slate-600 hover:bg-[#1a1a1d]'}`}
                                    >
                                        {name === 'PERC' ? percType : name}
                                    </button>
                                ))}
                            </div>
                            <div className="flex-1">
                                <DrumEditor 
                                    drumType={selectedTrackIdx === 3 ? percType : ['KICK','SNARE','HAT'][selectedTrackIdx] as any} 
                                    patch={currentPatch!} 
                                    onUpdate={updatePatch} 
                                    player={player}
                                    voiceIdx={getVoiceForTrack(selectedTrackIdx)}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DrSidMachine;
