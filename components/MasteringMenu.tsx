
import React, { useEffect, useRef, useState, memo, useCallback, useMemo } from 'react';
import { Sliders, Activity, Power, Terminal, Zap, Thermometer, Gauge, CheckCircle2, Waves, Layers, Headphones, Radio, ShieldCheck, Info, RotateCcw, Volume2, Music, Settings2, Share2, AlertTriangle, ShieldAlert, Disc, Cpu, Monitor, ZapOff, Square, Triangle } from 'lucide-react';
import { MasteringParams, MixerParams, VoiceParams } from '../types';
import { SID_REG } from '../services/sidService';

const toLin = (v: number) => Math.pow(v, 2.0);
const fromLin = (v: number) => Math.pow(v, 0.5);

/**
 * Waveform Status Icon
 */
const WaveIcon = memo(({ type, active }: { type: 'tri'|'saw'|'pul'|'noi', active: boolean }) => {
    const color = active ? (type==='noi'?'text-white':type==='pul'?'text-amber-400':type==='saw'?'text-cyan-400':'text-pink-400') : 'text-slate-800';
    const shadow = active ? `drop-shadow-[0_0_8px_currentColor]` : '';
    
    switch(type) {
        case 'tri': return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" className={`${color} ${shadow}`}><path d="M12 3L22 21H2L12 3Z"/></svg>;
        case 'saw': return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className={`${color} ${shadow}`}><path d="M2 22L22 2V22"/></svg>;
        case 'pul': return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className={`${color} ${shadow}`}><path d="M3 12H9V5H15V19H21"/></svg>;
        case 'noi': return <Zap className={`w-3 h-3 ${color} ${shadow}`} />;
    }
});

/**
 * Envelope Phase Indicator
 */
const EnvStatus = memo(({ state }: { state: number }) => (
    <div className="flex gap-[1px] mt-2 bg-black/40 p-[2px] rounded border border-white/5">
        {['I', 'A', 'D', 'S', 'R'].map((l, i) => {
            const isActive = state === i;
            // State 0 is Idle (usually Release done)
            // 1=Attack, 2=Decay, 3=Sustain, 4=Release
            const activeColor = i === 1 ? 'bg-cyan-500' : i === 2 ? 'bg-blue-500' : i === 3 ? 'bg-indigo-500' : i === 4 ? 'bg-purple-500' : 'bg-slate-700';
            return (
                <div key={l} className={`w-2.5 h-2.5 flex items-center justify-center text-[5px] font-black rounded-[1px] transition-all duration-75 ${
                    isActive 
                    ? `${activeColor} text-white shadow-[0_0_6px_currentColor]` 
                    : 'bg-transparent text-slate-800'
                }`}>
                    {l}
                </div>
            );
        })}
    </div>
));

/**
 * High-Density Logarithmic ZDF Filter Map (Micro-Scale)
 */
const FilterVisualizer = memo(({ regs }: { regs: number[] }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const fc = ((regs[SID_REG.FC_LO] & 0x07) << 8) | regs[SID_REG.FC_HI];
        const res = (regs[SID_REG.RES_FILT] >> 4) / 15.0;
        const mode = regs[SID_REG.MODE_VOL] >> 4;

        const center = (Math.log2(fc + 1) / 11) * w; 
        const resH = res * (h * 0.7);

        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        const drawCurve = (type: string, color: string, glow: string) => {
            ctx.beginPath(); ctx.strokeStyle = color;
            ctx.shadowBlur = 8; ctx.shadowColor = glow;
            for (let x = 0; x < w; x++) {
                const dist = x - center;
                let y = h * 0.85;
                if (type === 'LP') { if (x > center) y += Math.pow(x - center, 1.1) * 1.2; }
                else if (type === 'HP') { if (x < center) y += Math.pow(center - x, 1.1) * 1.2; }
                else if (type === 'BP') { y += Math.abs(dist) * 1.5; }
                
                const q = 80 + res * 1000;
                const peak = resH * Math.exp(-(dist * dist) / q);
                y -= peak;
                y = Math.min(h - 1, y);
                if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke(); ctx.shadowBlur = 0;
        };

        if (mode & 1) drawCurve('LP', '#22d3ee', 'rgba(34, 211, 238, 0.4)');
        if (mode & 2) drawCurve('BP', '#f472b6', 'rgba(244, 114, 182, 0.4)');
        if (mode & 4) drawCurve('HP', '#fbbf24', 'rgba(251, 191, 36, 0.4)');
        
        ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.beginPath(); ctx.moveTo(center, 0); ctx.lineTo(center, h); ctx.stroke();
        ctx.setLineDash([]);
    }, [regs]);

    return (
        <div className="flex flex-col gap-1 p-3 bg-black/80 rounded-2xl border border-white/5 shadow-xl backdrop-blur-xl ring-1 ring-white/5 relative overflow-hidden">
            <div className="flex justify-between items-center px-1 relative z-10">
                <span className="text-[7px] text-slate-500 font-black uppercase tracking-[0.3em] flex items-center gap-1.5"><Monitor className="w-3 h-3 text-cyan-500"/> ZDF_MAP</span>
                <div className="flex items-center gap-2">
                    <span className="text-[6px] text-cyan-600 font-bold tracking-widest uppercase">RT_SVF</span>
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse shadow-[0_0_8px_cyan]"></div>
                </div>
            </div>
            <canvas ref={canvasRef} width={250} height={60} className="w-full h-12 relative z-10 opacity-80" />
            <div className="flex justify-between text-[5px] text-slate-700 font-black uppercase px-2 tracking-[0.2em] border-t border-white/5 pt-1.5 relative z-10">
                <span>20Hz</span>
                <span>LOW_END_STABLE</span>
                <span>20KHz</span>
            </div>
        </div>
    );
});

const PreciseVuMeter = memo(({ peak, rms, label }: { peak: number, rms: number, label: string }) => {
    const segments = 24;
    const peakHold = useRef(0);
    const lastUpdate = useRef(Date.now());
    const smoothRms = useRef(0);
    smoothRms.current = smoothRms.current * 0.3 + rms * 0.7;
    if (peak > peakHold.current) { peakHold.current = peak; lastUpdate.current = Date.now(); } 
    else if (Date.now() - lastUpdate.current > 1000) { peakHold.current *= 0.96; }

    return (
        <div className="flex flex-col items-center gap-1.5 h-full group/vu">
            <div className="flex flex-col gap-[0.5px] h-full w-2.5 bg-black p-[1.5px] rounded-sm border border-white/10 relative shadow-inner overflow-hidden">
                {Array.from({length: segments}).map((_, i) => {
                    const idx = segments - 1 - i;
                    const thresh = idx / segments;
                    const isActive = smoothRms.current > thresh;
                    const isPeak = peak > thresh;
                    const isHold = Math.abs(peakHold.current - thresh) < (1.2/segments);
                    let color = 'bg-slate-950';
                    if (isActive) {
                        color = idx > segments * 0.85 ? 'bg-red-500 shadow-[0_0_6px_red]' : 
                                (idx > segments * 0.65 ? 'bg-amber-500 shadow-[0_0_5px_orange]' : 'bg-cyan-500 shadow-[0_0_5px_cyan]');
                    } else if (isPeak || isHold) {
                        color = isHold ? 'bg-white/30 shadow-[0_0_4px_white]' : 'bg-slate-900/40';
                    }
                    return <div key={i} className={`flex-1 w-full rounded-[0.5px] transition-all duration-75 ${color}`}></div>;
                })}
            </div>
            <span className="text-[6px] text-slate-700 font-black uppercase tracking-tighter group-hover/vu:text-slate-500">{label}</span>
        </div>
    );
});

const ControlKnob = memo(({ label, value, min, max, onChange, color = 'cyan', unit = '' }: any) => {
    const percent = ((value - min) / (max - min)) * 100;
    return (
        <div className="flex flex-col items-center gap-1.5 group cursor-pointer" 
             onWheel={(e) => {
                 e.preventDefault();
                 const delta = e.deltaY > 0 ? -0.05 : 0.05;
                 onChange(Math.max(min, Math.min(max, value + (max-min) * delta)));
             }}>
            <div className={`w-9 h-9 rounded-full bg-[#05070a] border-2 border-slate-900 relative flex items-center justify-center transition-all group-hover:border-${color}-500/30 shadow-md active:scale-95 ring-1 ring-white/5`}>
                <div className="absolute inset-1 border border-white/5 rounded-full shadow-inner bg-gradient-to-br from-slate-900 via-black to-slate-950"></div>
                <div className={`w-1 h-3 bg-${color}-500 rounded-full absolute -top-0.5 origin-bottom shadow-[0_0_8px_currentColor]`} 
                     style={{ transform: `rotate(${(percent/100)*270 - 135}deg) translateY(-6px)` }}></div>
            </div>
            <div className="flex flex-col items-center leading-none">
                <span className="text-[6px] text-slate-600 font-black uppercase tracking-widest">{label}</span>
                <span className={`text-[8px] text-${color}-400 font-bold tabular-nums`}>{value.toFixed(2)}{unit}</span>
            </div>
        </div>
    );
});

interface MixerConsoleProps {
    params: MasteringParams;
    onUpdate: (p: MasteringParams) => void;
    mixerParams: MixerParams;
    onUpdateMixer: (p: MixerParams) => void;
    onClose: () => void;
    player: any | null;
}

const MixerConsole: React.FC<MixerConsoleProps> = ({ params, onUpdate, mixerParams, onUpdateMixer, onClose, player }) => {
    const [stats, setStats] = useState({ peaks: [0, 0, 0], rms: [0, 0, 0], mPeaks: [0, 0] });
    const [physics, setPhysics] = useState({ temp: 28.0, power: 0.85, vSupply: 12.0 });
    const [liveRegs, setLiveRegs] = useState<number[]>(new Array(32).fill(0));
    const [voiceInfo, setVoiceInfo] = useState<{gate: boolean, state: number, ctrl: number}[]>([
        {gate:false, state:0, ctrl:0}, {gate:false, state:0, ctrl:0}, {gate:false, state:0, ctrl:0}
    ]);
    const rafRef = useRef(0);

    useEffect(() => {
        const tick = () => {
            if (player) {
                setStats({ 
                    peaks: [...player.volatileVoicePeaks], 
                    rms: [...player.volatileVoiceRms], 
                    mPeaks: [...player.volatileMasterPeaks] 
                });
                if (player.volatilePhysics) setPhysics({ ...player.volatilePhysics });
                setLiveRegs([...player.volatileRegs]);
                
                const vStates = player.volatileVoiceStates || [];
                setVoiceInfo(vStates.map((s: any) => ({
                    gate: (s.ctrl & 1) === 1,
                    state: s.state,
                    ctrl: s.ctrl
                })));
            }
            rafRef.current = requestAnimationFrame(tick);
        };
        tick();
        return () => cancelAnimationFrame(rafRef.current);
    }, [player]);

    const updateVoice = useCallback((idx: number, changes: Partial<VoiceParams>) => {
        const nextVoices = [...mixerParams.voices] as [VoiceParams, VoiceParams, VoiceParams];
        nextVoices[idx] = { ...nextVoices[idx], ...changes };
        onUpdateMixer({ ...mixerParams, voices: nextVoices });
    }, [mixerParams, onUpdateMixer]);

    const updateMaster = useCallback((section: keyof MasteringParams, key: string, value: any) => {
        const next = JSON.parse(JSON.stringify(params));
        if (!(next as any)[section]) (next as any)[section] = {};
        (next as any)[section][key] = value;
        onUpdate(next);
    }, [params, onUpdate]);

    const MasterSlider = ({ label, value, min, max, step, onChange, color = 'cyan' }: any) => (
        <div className="bg-black/30 p-2 rounded-lg border border-white/5 flex flex-col gap-2 hover:bg-slate-900/20 transition-all group shadow-inner w-full">
            <div className="flex justify-between items-center px-1">
                <span className="text-[7px] font-black uppercase text-slate-600 tracking-widest group-hover:text-slate-400 transition-colors">{label}</span>
                <span className={`text-[9px] font-black text-${color}-400 tabular-nums`}>{value.toFixed(step < 0.1 ? 3 : 2)}</span>
            </div>
            <input type="range" min={min} max={max} step={step} value={value} 
                   onChange={(e) => onChange(parseFloat(e.target.value))} 
                   className={`w-full h-0.5 bg-slate-950 rounded-full appearance-none accent-${color}-600 cursor-crosshair`} />
        </div>
    );

    return (
        <div className="h-full flex flex-col bg-[#010204] font-mono select-none overflow-hidden p-4 gap-4 relative selection:bg-cyan-500/20">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.03)_0%,transparent_60%)] pointer-events-none"></div>
            
            {/* COMPACT CONSOLE HEADER */}
            <div className="flex items-center justify-between border-b border-white/5 pb-2 shrink-0 z-10">
                <div className="flex items-center gap-4">
                    <div className="p-2 bg-cyan-500/5 rounded-xl border border-cyan-500/20 shadow-[0_0_20px_rgba(34,211,238,0.1)]">
                        <Terminal className="w-5 h-5 text-cyan-500/80 animate-pulse" />
                    </div>
                    <div className="flex flex-col">
                        <h2 className="text-sm font-black text-white tracking-[0.2em] uppercase glow-text italic leading-none selection:text-cyan-400">MOS_MASTER_CORE_V26</h2>
                        <div className="flex items-center gap-3 mt-1.5">
                           <span className="text-[6px] text-emerald-600 font-black uppercase tracking-[0.2em] border border-emerald-500/20 px-1.5 py-0.5 rounded flex items-center gap-1 bg-emerald-500/5">
                               <ShieldCheck className="w-2 h-2"/> SYNC_OK
                           </span>
                           <span className="text-[6px] text-cyan-600 font-black uppercase tracking-[0.2em] border border-cyan-500/20 px-1.5 py-0.5 rounded flex items-center gap-1 bg-cyan-500/5">
                               <Activity className="w-2 h-2"/> RT_ACTIVE
                           </span>
                        </div>
                    </div>
                </div>
                
                {/* HUD PHYSICS BAR */}
                <div className="flex gap-4 items-center px-4 py-2 bg-black/60 rounded-xl border border-white/10 shadow-lg backdrop-blur-md">
                    <div className="flex flex-col">
                        <span className="text-[6px] text-slate-600 font-black uppercase tracking-widest flex items-center gap-1"><Gauge className="w-2.5 h-2.5 text-cyan-500"/> SYSTEM</span>
                        <span className="text-[10px] font-black tracking-tighter text-cyan-400 tabular-nums">{physics.vSupply.toFixed(2)}V</span>
                    </div>
                    <div className="w-[0.5px] h-6 bg-white/10"></div>
                    <div className="flex flex-col">
                        <span className="text-[6px] text-slate-600 font-black uppercase tracking-widest flex items-center gap-1"><Zap className="w-2.5 h-2.5 text-emerald-500"/> LOAD</span>
                        <span className="text-[10px] text-emerald-500 font-black tracking-tighter tabular-nums">{physics.power.toFixed(3)}W</span>
                    </div>
                    <div className="w-[0.5px] h-6 bg-white/10"></div>
                    <div className="flex flex-col">
                        <span className="text-[6px] text-slate-600 font-black uppercase tracking-widest flex items-center gap-1"><Thermometer className="w-2.5 h-2.5 text-red-500"/> CORE</span>
                        <span className={`text-[10px] font-black tracking-tighter tabular-nums ${physics.temp > 75 ? 'text-red-500 animate-pulse' : 'text-white'}`}>{physics.temp.toFixed(1)}°C</span>
                    </div>
                </div>

                <button onClick={onClose} className="p-2 bg-red-950/10 border border-red-500/30 text-red-500 rounded-xl hover:bg-red-500/30 transition-all hover:scale-105 active:scale-95 group/off">
                    <Power className="w-4 h-4" />
                </button>
            </div>

            <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
                {/* DISCRETE CHANNEL STRIPS (RE-SCALED) */}
                <div className="flex gap-2 p-2 bg-black/70 border border-white/5 rounded-[2rem] shadow-2xl z-10 relative overflow-hidden backdrop-blur-2xl ring-1 ring-white/5">
                    {[0, 1, 2].map((idx) => {
                        const voice = mixerParams.voices[idx];
                        const peak = stats.peaks[idx];
                        const isClipped = peak > 0.98;
                        const vInfo = voiceInfo[idx] || {gate:false, state:0, ctrl:0};
                        
                        return (
                            <div key={idx} className="flex flex-col items-center gap-2 bg-slate-900/20 p-4 border border-white/5 rounded-[1.5rem] shadow-inner w-28 group/strip transition-all hover:bg-slate-900/40">
                                <div className="flex flex-col items-center gap-1.5 w-full">
                                    <span className={`text-[10px] font-black tracking-[0.2em] uppercase transition-colors ${voice.muted ? 'text-slate-800' : 'text-cyan-500'}`}>ST_0{idx+1}</span>
                                    
                                    {/* WAVEFORM VISUALIZER */}
                                    <div className="flex gap-2 items-center justify-center bg-black/30 p-1.5 rounded-full border border-white/5 w-full">
                                        <WaveIcon type="tri" active={(vInfo.ctrl & 0x10) !== 0} />
                                        <WaveIcon type="saw" active={(vInfo.ctrl & 0x20) !== 0} />
                                        <WaveIcon type="pul" active={(vInfo.ctrl & 0x40) !== 0} />
                                        <WaveIcon type="noi" active={(vInfo.ctrl & 0x80) !== 0} />
                                    </div>

                                    {/* GATE & ENV STATUS */}
                                    <div className="flex items-center gap-2 w-full justify-center">
                                        <div className={`w-2 h-2 rounded-full border border-white/10 transition-all duration-75 ${vInfo.gate ? 'bg-emerald-500 shadow-[0_0_8px_lime]' : 'bg-black'}`} title="GATE"></div>
                                        <EnvStatus state={vInfo.state} />
                                    </div>
                                </div>
                                
                                <div className="flex gap-4 h-40 items-center relative py-2">
                                    <PreciseVuMeter peak={peak} rms={stats.rms[idx]} label="VU" />
                                    <div className="relative h-full w-8">
                                        <div className="absolute inset-0 w-[4px] bg-black left-1/2 -translate-x-1/2 rounded-full border border-white/10 shadow-inner"></div>
                                        <input 
                                            type="range" min="0" max="1.0" step="0.01" 
                                            value={fromLin(voice.volume)} 
                                            onChange={(e) => updateVoice(idx, { volume: toLin(parseFloat(e.target.value)) })} 
                                            className="absolute inset-0 w-8 h-full appearance-none bg-transparent cursor-ns-resize vertical-slider z-30 opacity-0" 
                                            style={{ WebkitAppearance: 'slider-vertical' } as any} 
                                        />
                                        <div className="absolute left-1/2 -translate-x-1/2 w-8 h-5 bg-slate-800 border border-slate-600 rounded-md pointer-events-none z-20 shadow-lg group-hover/strip:border-cyan-500/30 transition-colors" style={{ bottom: `${fromLin(voice.volume) * 100}%` }}>
                                            <div className={`absolute top-1/2 left-0 right-0 h-[2px] ${isClipped ? 'bg-red-500 shadow-[0_0_10px_red]' : 'bg-cyan-500 shadow-[0_0_10px_cyan]'}`}></div>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-3 w-full">
                                    <ControlKnob label="PAN" value={voice.pan} min={-1} max={1} onChange={(v:any)=>updateVoice(idx, { pan: v })} color="cyan" />
                                    <button 
                                        onClick={() => updateVoice(idx, { muted: !voice.muted })}
                                        className={`w-full py-1.5 text-[8px] font-black rounded-lg border transition-all ${voice.muted ? 'bg-red-950/30 border-red-500 text-red-500/80' : 'bg-slate-950 border-slate-800 text-slate-700 hover:text-slate-400'}`}
                                    >
                                        {voice.muted ? 'OFF' : 'MUTE'}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                    
                    {/* VISUAL MONITOR PANEL */}
                    <div className="flex flex-col gap-3 w-48 shrink-0">
                        <FilterVisualizer regs={liveRegs} />
                        <div className="bg-slate-900/60 p-3 rounded-[1.5rem] border border-white/5 flex flex-col gap-3 backdrop-blur-xl shadow-xl ring-1 ring-white/5">
                            <div className="flex items-center gap-2 border-b border-white/10 pb-1.5">
                                <Activity className="w-3 h-3 text-emerald-500" />
                                <span className="text-[8px] font-black text-emerald-600 uppercase tracking-widest">BUS_SYNC</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                {[0,1,2,3].map(i => {
                                    const active = (liveRegs[SID_REG.RES_FILT] >> i) & 1;
                                    return (
                                        <div key={i} className={`px-1 py-1 rounded-md border text-[7px] font-black text-center transition-all ${active ? 'bg-emerald-950/70 border-emerald-500/50 text-white shadow-md' : 'bg-black/60 border-white/5 text-slate-800 grayscale'}`}>
                                            {i < 3 ? `VOICE_0${i+1}` : 'EXT_IN'}
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="mt-1 flex flex-col gap-1.5">
                                <div className="flex justify-between items-center text-[6px] font-black text-slate-600 uppercase tracking-widest">
                                    <span>PEAK_STRESS</span>
                                    <span className="text-pink-600 tabular-nums">{(physics.power * 88).toFixed(1)}%</span>
                                </div>
                                <div className="h-1 bg-black rounded-full overflow-hidden border border-white/10 shadow-inner">
                                    <div className="h-full bg-gradient-to-r from-cyan-500 via-pink-500 to-red-600 transition-all duration-700" style={{ width: `${Math.min(100, physics.power * 105)}%` }}></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* MODULAR EFFECTS RACK (FULL IMPLEMENTATION) */}
                <div className="flex-1 flex flex-col gap-3 overflow-y-auto custom-scrollbar pr-2 z-10 py-1">
                    <div className="grid grid-cols-2 gap-3">
                        {/* TILT EQ */}
                        <div className="bg-slate-900/40 p-4 rounded-[1.5rem] border border-white/5 flex flex-col gap-3 shadow-xl backdrop-blur-xl hover:border-emerald-500/20 transition-all group/eq">
                            <div className="flex items-center justify-between border-b border-white/10 pb-2">
                                <div className="flex items-center gap-2">
                                    <Activity className="w-4 h-4 text-emerald-500/80 group-hover/eq:animate-pulse" />
                                    <span className="text-[9px] font-black text-emerald-500/80 uppercase tracking-widest">TILT_EQ</span>
                                </div>
                                <input type="checkbox" checked={params.eq.enabled} onChange={(e)=>updateMaster('eq', 'enabled', e.target.checked)} className="w-3.5 h-3.5 accent-emerald-500 cursor-pointer shadow-md rounded" />
                            </div>
                            <MasterSlider label="ANALOG_BIAS" value={params.eq.tilt || 0.5} min={0} max={1} step={0.01} color="emerald" onChange={(v:any)=>updateMaster('eq','tilt',v)} />
                        </div>

                        {/* COMPRESSOR */}
                        <div className="bg-slate-900/40 p-4 rounded-[1.5rem] border border-white/5 flex flex-col gap-3 shadow-xl backdrop-blur-xl hover:border-amber-500/20 transition-all group/comp">
                             <div className="flex items-center justify-between border-b border-white/10 pb-2">
                                <div className="flex items-center gap-2">
                                    <Zap className="w-4 h-4 text-amber-500/80 group-hover/comp:animate-pulse" />
                                    <span className="text-[9px] font-black text-amber-500/80 uppercase tracking-widest">COMP_CORE</span>
                                </div>
                                <input type="checkbox" checked={params.comp.enabled} onChange={(e)=>updateMaster('comp', 'enabled', e.target.checked)} className="w-3.5 h-3.5 accent-amber-500 cursor-pointer shadow-md rounded" />
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <ControlKnob label="THRESH" value={params.comp.threshold} min={0} max={1} onChange={(v:any)=>updateMaster('comp','threshold',v)} color="amber" />
                                <ControlKnob label="RATIO" value={params.comp.ratio} min={1} max={20} onChange={(v:any)=>updateMaster('comp','ratio',v)} color="amber" />
                                <ControlKnob label="REL" value={params.comp.release} min={0.01} max={1} onChange={(v:any)=>updateMaster('comp','release',v)} color="amber" />
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        {/* EXCITER */}
                        <div className="bg-slate-900/40 p-4 rounded-[1.5rem] border border-white/5 flex flex-col gap-3 shadow-xl backdrop-blur-xl hover:border-pink-500/20 transition-all group/exc">
                            <div className="flex items-center justify-between border-b border-white/10 pb-2">
                                <div className="flex items-center gap-2">
                                    <ZapOff className="w-4 h-4 text-pink-500/80 group-hover/exc:animate-pulse" />
                                    <span className="text-[9px] font-black text-pink-500/80 uppercase tracking-widest">HARM_EXCITER</span>
                                </div>
                                <input type="checkbox" checked={params.exciter.enabled} onChange={(e)=>updateMaster('exciter', 'enabled', e.target.checked)} className="w-3.5 h-3.5 accent-pink-500 cursor-pointer shadow-md rounded" />
                            </div>
                            <div className="flex flex-col gap-3">
                                <MasterSlider label="AMOUNT" value={params.exciter.amount} min={0} max={0.5} step={0.01} color="pink" onChange={(v:any)=>updateMaster('exciter','amount',v)} />
                                <MasterSlider label="FREQ_HZ" value={params.exciter.freq} min={1000} max={16000} step={100} color="pink" onChange={(v:any)=>updateMaster('exciter','freq',v)} />
                            </div>
                        </div>

                        {/* IMAGER */}
                        <div className="bg-slate-900/40 p-4 rounded-[1.5rem] border border-white/5 flex flex-col gap-3 shadow-xl backdrop-blur-xl hover:border-cyan-500/20 transition-all group/img">
                            <div className="flex items-center justify-between border-b border-white/10 pb-2">
                                <div className="flex items-center gap-2">
                                    <Monitor className="w-4 h-4 text-cyan-500/80 group-hover/img:animate-pulse" />
                                    <span className="text-[9px] font-black text-cyan-500/80 uppercase tracking-widest">STEREO_FIELD</span>
                                </div>
                                <input type="checkbox" checked={params.imager.enabled} onChange={(e)=>updateMaster('imager', 'enabled', e.target.checked)} className="w-3.5 h-3.5 accent-cyan-500 cursor-pointer shadow-md rounded" />
                            </div>
                            <div className="flex items-center justify-center pt-2">
                                 <ControlKnob label="WIDTH" value={params.imager.width} min={0} max={2.5} onChange={(v:any)=>updateMaster('imager','width',v)} color="cyan" />
                            </div>
                        </div>
                    </div>

                    {/* TAPE SATURATION */}
                    <div className="bg-slate-900/40 p-4 rounded-[1.5rem] border border-white/5 flex flex-col gap-4 shadow-xl backdrop-blur-xl hover:border-amber-500/20 transition-all group/tape">
                        <div className="flex items-center justify-between border-b border-white/10 pb-2">
                            <div className="flex items-center gap-3">
                                <Waves className="w-5 h-5 text-amber-500/80 group-hover/tape:animate-spin-slow" />
                                <span className="text-[11px] font-black text-amber-500/80 uppercase tracking-widest">SATURATION_KERN</span>
                            </div>
                            <input type="checkbox" checked={params.tape?.enabled} onChange={(e)=>updateMaster('tape', 'enabled', e.target.checked)} className="w-4 h-4 accent-amber-500 cursor-pointer shadow-md rounded" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                           <MasterSlider label="INPUT_DRIVE" value={params.tape?.drive || 1.15} min={1.0} max={4.0} step={0.01} color="amber" onChange={(v:any)=>updateMaster('tape','drive',v)} />
                           <MasterSlider label="BIAS_OFFSET" value={params.tape?.bias || 0.02} min={0} max={0.2} step={0.001} color="amber" onChange={(v:any)=>updateMaster('tape','bias',v)} />
                        </div>
                    </div>

                    {/* CHORUS */}
                    <div className="bg-slate-900/40 p-4 rounded-[1.5rem] border border-white/5 flex flex-col gap-3 shadow-xl backdrop-blur-xl hover:border-pink-500/20 transition-all group/cho">
                         <div className="flex items-center justify-between border-b border-white/10 pb-2">
                            <div className="flex items-center gap-2">
                                <Layers className="w-4 h-4 text-pink-500/80 group-hover/cho:animate-bounce" />
                                <span className="text-[9px] font-black text-pink-500/80 uppercase tracking-widest">CHORUS</span>
                            </div>
                            <input type="checkbox" checked={params.chorus?.enabled} onChange={(e)=>updateMaster('chorus', 'enabled', e.target.checked)} className="w-3.5 h-3.5 accent-pink-500 cursor-pointer shadow-md rounded" />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <ControlKnob label="DEP" value={params.chorus?.depth || 0.3} min={0} max={1} onChange={(v:any)=>updateMaster('chorus','depth',v)} color="pink" />
                            <ControlKnob label="SPD" value={params.chorus?.rate || 0.5} min={0.1} max={5} onChange={(v:any)=>updateMaster('chorus','rate',v)} color="pink" />
                            <ControlKnob label="MIX" value={params.chorus?.mix || 0.15} min={0} max={1} onChange={(v:any)=>updateMaster('chorus','mix',v)} color="pink" />
                        </div>
                    </div>

                    {/* PLATE REVERB */}
                    <div className="bg-slate-900/40 p-4 rounded-[1.5rem] border border-white/5 flex flex-col gap-3 shadow-xl backdrop-blur-xl hover:border-indigo-500/20 transition-all group/rev">
                        <div className="flex items-center justify-between border-b border-white/10 pb-2">
                            <div className="flex items-center gap-2">
                                <Headphones className="w-4 h-4 text-indigo-500/80 group-hover/rev:scale-110 transition-transform" />
                                <span className="text-[9px] font-black text-indigo-500/80 uppercase tracking-widest">PLATE_SPACE</span>
                            </div>
                            <input type="checkbox" checked={params.reverb.active} onChange={(e)=>updateMaster('reverb', 'active', e.target.checked)} className="w-3.5 h-3.5 accent-indigo-500 cursor-pointer shadow-md rounded" />
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                           <MasterSlider label="DECAY" value={params.reverb.time} min={50} max={2500} step={10} color="indigo" onChange={(v:any)=>updateMaster('reverb','time',v)} />
                           <MasterSlider label="FEED" value={params.reverb.feedback} min={0} max={0.95} step={0.01} color="indigo" onChange={(v:any)=>updateMaster('reverb','feedback',v)} />
                           <MasterSlider label="MIX" value={params.reverb.mix} min={0} max={1} step={0.01} color="indigo" onChange={(v:any)=>updateMaster('reverb','mix',v)} />
                        </div>
                    </div>
                </div>

                {/* FINAL MASTER STRIP */}
                <div className="w-40 bg-[#020306] p-4 rounded-[2.5rem] border border-white/10 shadow-extreme flex flex-col items-center gap-4 z-10 relative ring-1 ring-white/5">
                    <span className="text-xs font-black text-white tracking-widest uppercase glow-text italic">MASTER</span>
                    <div className="flex gap-3 items-center flex-1 h-full py-2 group/mvu">
                        <PreciseVuMeter peak={stats.mPeaks[0]} rms={stats.mPeaks[0]*0.8} label="L" />
                        <PreciseVuMeter peak={stats.mPeaks[1]} rms={stats.mPeaks[1]*0.8} label="R" />
                    </div>
                    
                    <div className="w-full flex flex-col gap-2 bg-slate-900/50 p-2 rounded-xl border border-white/5">
                        <div className="flex justify-between items-center px-1">
                            <span className="text-[6px] font-black text-red-500 uppercase">LIMITER</span>
                            <input type="checkbox" checked={params.limiter.enabled} onChange={(e)=>updateMaster('limiter', 'enabled', e.target.checked)} className="w-3 h-3 accent-red-500 cursor-pointer rounded" />
                        </div>
                        <MasterSlider label="CEIL" value={params.limiter.ceiling} min={0.5} max={1.0} step={0.01} color="red" onChange={(v:any)=>updateMaster('limiter','ceiling',v)} />
                    </div>

                    <div className="h-32 w-10 relative bg-black rounded-full border border-white/5 overflow-hidden shadow-inner">
                        <input 
                            type="range" min="0" max="1.5" step="0.01" 
                            value={fromLin(mixerParams.masterVolume)} 
                            onChange={(e) => onUpdateMixer({ ...mixerParams, masterVolume: toLin(parseFloat(e.target.value)) })} 
                            className="absolute inset-0 w-full h-full appearance-none bg-transparent cursor-ns-resize vertical-slider z-30" 
                            style={{ WebkitAppearance: 'slider-vertical' } as any} 
                        />
                        <div className="absolute left-1/2 -translate-x-1/2 w-10 h-6 bg-slate-900 border border-slate-700 rounded-lg pointer-events-none z-20 shadow-xl transition-all" 
                             style={{ bottom: `${(fromLin(mixerParams.masterVolume) / 1.5) * 100}%` }}>
                             <div className="absolute top-1/2 left-0 right-0 h-[3px] bg-white shadow-[0_0_12px_white]"></div>
                        </div>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                        <span className="text-[8px] font-black text-slate-700 uppercase tracking-widest">GAIN</span>
                        <span className={`text-sm font-black tabular-nums ${mixerParams.masterVolume > 1.0 ? 'text-red-500 animate-pulse' : 'text-white'}`}>{(mixerParams.masterVolume * 100).toFixed(0)}%</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MixerConsole;
