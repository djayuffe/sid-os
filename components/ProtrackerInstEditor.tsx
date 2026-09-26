
import React, { useState, useEffect, useRef } from 'react';
import { TrackerInstrument } from '../types';
import { Beaker, Plus, Settings, Zap, Music, Activity, Waves, Sliders, Trash2, Keyboard as PianoIcon, Monitor, Cpu, Terminal, Radio, Maximize2 } from 'lucide-react';

interface ProtrackerInstEditorProps {
    instruments: TrackerInstrument[];
    selectedId: number;
    onSelect: (id: number) => void;
    onUpdate: (id: number, changes: Partial<TrackerInstrument>) => void;
    onTest: (inst: TrackerInstrument, note?: number) => void;
    onCreate: () => void;
    onDelete: (id: number) => void;
}

const NOTES = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"];

const ProtrackerInstEditor: React.FC<ProtrackerInstEditorProps> = ({ instruments, selectedId, onSelect, onUpdate, onTest, onCreate, onDelete }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const selected = instruments.find(i => i.id === selectedId);
    const [tab, setTab] = useState<'MAIN' | 'SWM'>('MAIN');
    const [activeNote, setActiveNote] = useState<number | null>(null);

    const HexInput = ({ label, val, min, max, digits, onChange, disabled }: any) => {
        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            let v = parseInt(e.target.value, 16);
            if (isNaN(v)) v = 0;
            v = Math.max(min, Math.min(max, v));
            onChange(v);
        };
        const safeVal = val !== undefined ? val : 0;
        return (
            <div className={`flex flex-col items-center gap-2 ${disabled ? 'opacity-20' : ''}`}>
                <span className="text-[12px] text-slate-500 font-black uppercase tracking-[0.3em]">{label}</span>
                <input 
                    type="text" 
                    disabled={disabled}
                    className="w-16 h-12 bg-slate-950 border-2 border-slate-700 text-center text-cyan-400 font-mono text-[18px] font-black focus:border-cyan-500 focus:outline-none rounded-2xl shadow-extreme transition-all"
                    value={safeVal.toString(16).toUpperCase().padStart(digits, '0')}
                    onChange={handleChange}
                />
            </div>
        );
    };

    const BitToggle = ({ label, active, onClick, color = 'cyan' }: any) => (
        <button 
            onClick={onClick}
            className={`
                h-12 px-6 flex items-center justify-center border-2 text-[12px] font-black rounded-2xl uppercase tracking-[0.2em] transition-all min-w-[60px]
                ${active 
                    ? `bg-${color}-900/50 border-${color}-500 text-${color}-400 shadow-[0_0_30px_rgba(0,255,255,0.3)]` 
                    : 'bg-slate-900 border-slate-800 text-slate-600 hover:bg-slate-800 hover:text-slate-400 shadow-inner'
                }
            `}
        >
            {label}
        </button>
    );

    const VirtualKeyboard = () => {
        const playNote = (n: number) => {
            setActiveNote(n);
            if(selected) onTest(selected, n);
            setTimeout(() => setActiveNote(null), 400);
        };

        return (
            <div className="flex gap-2 h-32 bg-slate-950 p-6 rounded-[2.5rem] border-4 border-slate-800 shadow-extreme overflow-x-auto custom-scrollbar relative fullscreen:h-48">
                {Array.from({length: 49}).map((_, i) => {
                    const nIdx = i % 12;
                    const isB = [1, 3, 6, 8, 10].includes(nIdx);
                    const name = NOTES[nIdx] + Math.floor(i / 12 + 2);
                    return (
                        <div 
                            key={i}
                            onMouseDown={() => playNote(i + 24)}
                            className={`
                                min-w-[40px] rounded-b-2xl flex flex-col items-center justify-end pb-4 cursor-pointer transition-all active:translate-y-2 active:shadow-none relative fullscreen:min-w-[60px]
                                ${isB ? 'bg-slate-900 h-18 -mx-5 z-20 text-[10px] border-x border-slate-700 shadow-lg fullscreen:h-24' : 'bg-slate-100 h-24 text-[11px] text-black border-2 border-slate-400 shadow-xl fullscreen:h-36'}
                                ${activeNote === (i + 24) ? 'bg-cyan-400 shadow-[0_0_40px_cyan] text-white border-cyan-300' : ''}
                                hover:scale-[1.02] hover:brightness-125
                            `}
                        >
                            <span className="font-black opacity-60 uppercase tracking-tighter">{name}</span>
                        </div>
                    );
                })}
            </div>
        );
    };

    if (!selected && instruments.length > 0) {
        // Defer state update to avoid render loop
        setTimeout(() => onSelect(instruments[0].id), 0);
        return null;
    }

    return (
        <div ref={containerRef} className="flex h-full bg-[#010204] p-8 gap-8 select-none font-mono group/full fullscreen:rounded-none fullscreen:p-12">
            {/* RACK PANEL */}
            <div className="w-80 flex flex-col gap-6 bg-slate-900 border-4 border-slate-800 rounded-[3rem] p-6 shadow-extreme shrink-0 h-full overflow-hidden fullscreen:w-96">
                <div className="px-6 py-4 bg-slate-800 border-b-2 border-slate-700 rounded-t-[2rem] flex justify-between items-center shrink-0">
                    <span className="text-[14px] font-black text-slate-400 tracking-[0.5em] uppercase flex items-center gap-3"><Terminal className="w-5 h-5"/> MODULE_RACK</span>
                    <button onClick={onCreate} className="bg-cyan-900/60 p-3 rounded-2xl text-cyan-400 border-2 border-cyan-800 hover:text-white hover:bg-cyan-700 hover:border-cyan-400 transition-all shadow-lg"><Plus className="w-6 h-6"/></button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-3 pr-3">
                    {instruments.map(inst => (
                        <div 
                            key={inst.id} 
                            onClick={() => onSelect(inst.id)}
                            className={`px-6 py-4 cursor-pointer flex justify-between items-center rounded-[2rem] border-2 transition-all ${selectedId === inst.id ? 'bg-cyan-950/60 border-cyan-500/80 text-white shadow-extreme animate-in zoom-in-95' : 'bg-slate-900/60 border-transparent text-slate-500 hover:bg-slate-800 hover:text-slate-300'}`}
                        >
                            <div className="flex items-center gap-6">
                                <div className={`w-4 h-4 rounded-full ${selectedId === inst.id ? 'bg-cyan-400 shadow-[0_0_20px_cyan] animate-pulse' : 'bg-slate-800'}`}></div>
                                <span className="font-black text-lg">{inst.id.toString(16).toUpperCase().padStart(2,'0')}</span>
                            </div>
                            <span className="truncate flex-1 ml-6 font-black tracking-tight text-sm uppercase">{inst.name}</span>
                            <button 
                                onClick={(e) => { e.stopPropagation(); onDelete(inst.id); }}
                                className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 transition-all p-2 hover:scale-125"
                            >
                                <Trash2 className="w-5 h-5" />
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* CONSOLE PANEL */}
            {selected ? (
                <div className="flex-1 flex flex-col gap-8 min-w-0 h-full">
                    <div className="flex justify-between items-end border-b-2 border-slate-800 pb-6 shrink-0">
                        <div className="flex flex-col gap-3">
                            <span className="text-[14px] text-slate-600 font-black uppercase tracking-[0.6em]">SYNTH_PROC_ID_MAP</span>
                            <input 
                                className="bg-slate-950 border-4 border-slate-800 text-cyan-400 font-black text-3xl px-8 py-3 w-[500px] focus:border-cyan-500 focus:outline-none rounded-3xl shadow-extreme tracking-tight transition-all fullscreen:w-[800px] fullscreen:text-5xl"
                                value={selected.name}
                                onChange={(e) => onUpdate(selected.id, { name: e.target.value })}
                            />
                        </div>
                        <div className="flex gap-4 items-center">
                            <button onClick={() => setTab('MAIN')} className={`px-10 py-3 text-[14px] font-black rounded-t-3xl border-t-4 border-x-4 transition-all ${tab === 'MAIN' ? 'bg-slate-800 border-slate-600 text-white shadow-extreme' : 'bg-transparent border-transparent text-slate-700 hover:text-slate-500'}`}>VOICE_UNIT</button>
                            <button onClick={() => setTab('SWM')} className={`px-10 py-3 text-[14px] font-black rounded-t-3xl border-t-4 border-x-4 transition-all ${tab === 'SWM' ? 'bg-slate-800 border-slate-600 text-amber-400 shadow-extreme' : 'bg-transparent border-transparent text-slate-700 hover:text-slate-500'}`}>KERNEL_SWM</button>
                            <button onClick={() => containerRef.current?.requestFullscreen()} className="p-3 bg-black/40 border border-white/10 rounded-2xl text-slate-500 hover:text-cyan-400 transition-all opacity-0 group-hover/full:opacity-100"><Maximize2 className="w-6 h-6"/></button>
                        </div>
                    </div>

                    <div className="flex-1 bg-slate-900/80 border-[6px] border-slate-800 rounded-[4rem] p-12 flex flex-col gap-10 relative shadow-extreme overflow-hidden min-h-0 fullscreen:rounded-none">
                        <div className="absolute top-12 right-16 text-[160px] font-black text-slate-800/15 pointer-events-none select-none italic tracking-tighter uppercase fullscreen:text-[300px]">
                            CORE_{selected.id.toString(16).toUpperCase()}
                        </div>

                        <div className="flex-1 flex gap-16 min-h-0 fullscreen:flex-col">
                            {tab === 'MAIN' && (
                                <div className="flex flex-col gap-12 z-10 w-96 shrink-0 fullscreen:w-full fullscreen:flex-row fullscreen:justify-between">
                                    <div className="flex flex-col gap-4">
                                        <div className="flex items-center gap-5 text-[14px] font-black text-cyan-500 border-b-2 border-slate-800 pb-3 uppercase tracking-[0.5em]">
                                            <Activity className="w-6 h-6"/> ADSR_STAGES
                                        </div>
                                        <div className="flex gap-6 bg-slate-950 p-6 rounded-[3rem] border-4 border-slate-800 shadow-extreme justify-between">
                                            <HexInput label="ATT" val={selected.attack} min={0} max={15} digits={1} onChange={(v: number) => onUpdate(selected.id, { attack: v })} />
                                            <HexInput label="DEC" val={selected.decay} min={0} max={15} digits={1} onChange={(v: number) => onUpdate(selected.id, { decay: v })} />
                                            <HexInput label="SUS" val={selected.sustain} min={0} max={15} digits={1} onChange={(v: number) => onUpdate(selected.id, { sustain: v })} />
                                            <HexInput label="REL" val={selected.release} min={0} max={15} digits={1} onChange={(v: number) => onUpdate(selected.id, { release: v })} />
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-4">
                                        <div className="flex items-center gap-5 text-[14px] font-black text-pink-500 border-b-2 border-slate-800 pb-3 uppercase tracking-[0.5em]">
                                            <Radio className="w-6 h-6"/> WAVE_GEN
                                        </div>
                                        <div className="grid grid-cols-4 gap-4 bg-slate-950 p-6 rounded-[3rem] border-4 border-slate-800 shadow-extreme">
                                            <BitToggle label="TRI" active={(selected.waveform & 0x10) !== 0} onClick={() => onUpdate(selected.id, { waveform: selected.waveform ^ 0x10 })} />
                                            <BitToggle label="SAW" active={(selected.waveform & 0x20) !== 0} onClick={() => onUpdate(selected.id, { waveform: selected.waveform ^ 0x20 })} />
                                            <BitToggle label="PUL" active={(selected.waveform & 0x40) !== 0} onClick={() => onUpdate(selected.id, { waveform: selected.waveform ^ 0x40 })} />
                                            <BitToggle label="NOI" active={(selected.waveform & 0x80) !== 0} onClick={() => onUpdate(selected.id, { waveform: selected.waveform ^ 0x80 })} />
                                            <div className="col-span-4 h-1 bg-slate-800 my-2 rounded-full"></div>
                                            <BitToggle label="RNG" active={(selected.waveform & 0x04) !== 0} onClick={() => onUpdate(selected.id, { waveform: selected.waveform ^ 0x04 })} color="pink" />
                                            <BitToggle label="SYN" active={(selected.waveform & 0x02) !== 0} onClick={() => onUpdate(selected.id, { waveform: selected.waveform ^ 0x02 })} color="pink" />
                                            <BitToggle label="GAT" active={(selected.waveform & 0x01) !== 0} onClick={() => onUpdate(selected.id, { waveform: selected.waveform ^ 0x01 })} color="emerald" />
                                            <BitToggle label="TST" active={(selected.waveform & 0x08) !== 0} onClick={() => onUpdate(selected.id, { waveform: selected.waveform ^ 0x08 })} color="red" />
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-4">
                                        <div className="flex items-center gap-5 text-[14px] font-black text-amber-500 border-b-2 border-slate-800 pb-3 uppercase tracking-[0.5em]">
                                            <Sliders className="w-6 h-6"/> PULSE_WIDTH
                                        </div>
                                        <div className="bg-slate-950 p-6 rounded-[3rem] border-4 border-slate-800 w-fit shadow-extreme">
                                            <HexInput label="DUTY_CYCLE" val={selected.pulseWidth} min={0} max={4095} digits={3} onChange={(v: number) => onUpdate(selected.id, { pulseWidth: v })} />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* GLASS ENVELOPE VISUALIZER */}
                            <div className="flex-1 flex flex-col gap-10 min-w-0">
                                <div className="flex-1 bg-black/80 border-[8px] border-slate-800 rounded-[4rem] p-16 flex flex-col relative overflow-hidden group/graph shadow-extreme min-h-[300px]">
                                    <div className="absolute top-10 left-12 text-[14px] text-slate-700 font-black tracking-[0.8em] uppercase">SYSTEM_ENVELOPE_CHRONOS</div>
                                    <div className="absolute inset-0 opacity-[0.08] pointer-events-none" style={{backgroundImage: 'linear-gradient(rgba(255,255,255,1) 3px, transparent 3px), linear-gradient(90deg, rgba(255,255,255,1) 3px, transparent 3px)', backgroundSize: '80px 80px'}}></div>
                                    
                                    <div className="flex-1 relative flex items-center justify-center">
                                        <svg className="w-full h-full drop-shadow-[0_0_100px_rgba(34,211,238,0.6)]" viewBox="0 0 100 100" preserveAspectRatio="none">
                                            <defs>
                                                <linearGradient id="gCHRONOS" x1="0%" y1="0%" x2="0%" y2="100%">
                                                    <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.8" />
                                                    <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.1" />
                                                </linearGradient>
                                                <filter id="fGlow"><feGaussianBlur stdDeviation="2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                                            </defs>
                                            <path 
                                                d={`M0,100 L${(selected.attack+1)*3},0 L${(selected.attack+1)*3 + (selected.decay+1)*3},${100 - (selected.sustain/15)*100} L80,${100 - (selected.sustain/15)*100} L${80 + (selected.release+1)*3},100`}
                                                fill="url(#gCHRONOS)"
                                                stroke="#22d3ee"
                                                strokeWidth="6"
                                                strokeLinejoin="round"
                                                filter="url(#fGlow)"
                                                vectorEffect="non-scaling-stroke"
                                            />
                                        </svg>
                                    </div>
                                    
                                    {/* Real-time Piano Station */}
                                    <div className="mt-16 flex flex-col gap-8">
                                        <div className="flex items-center justify-between text-[13px] text-slate-500 font-black uppercase tracking-[0.7em]">
                                            <div className="flex items-center gap-6 text-cyan-400"><PianoIcon className="w-10 h-10"/> LIVE_STATION_HQ</div>
                                            <div className="flex items-center gap-10">
                                                <span className="flex items-center gap-4 text-emerald-500"><Radio className="w-6 h-6"/> BUS: LOCKED</span>
                                                <div className="h-8 w-1 bg-slate-800"></div>
                                                <span className="text-pink-500">ENGINE: MOS_NATIVE</span>
                                            </div>
                                        </div>
                                        <VirtualKeyboard />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-800 font-black tracking-[2em] text-2xl gap-16">
                    <Activity className="w-48 h-48 opacity-20 animate-pulse" />
                    <span>SIGNAL_CONNECT_WAIT</span>
                </div>
            )}
        </div>
    );
};

export default ProtrackerInstEditor;
