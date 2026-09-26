
import React, { useEffect, useState, useRef, memo } from 'react';
import { Shield, Zap, Terminal, Database, Activity, Flame } from 'lucide-react';
import { SidPlayer } from '../services/sidService';

const REG_LABELS: Record<number, string> = {
    0x00: "V1_FL", 0x01: "V1_FH", 0x02: "V1_PL", 0x03: "V1_PH", 0x04: "V1_CR", 0x05: "V1_AD", 0x06: "V1_SR",
    0x07: "V2_FL", 0x08: "V2_FH", 0x09: "V2_PL", 0x0A: "V2_PH", 0x0B: "V2_CR", 0x0C: "V2_AD", 0x0D: "V2_SR",
    0x0E: "V3_FL", 0x0F: "V3_FH", 0x10: "V3_PL", 0x11: "V3_PH", 0x12: "V3_CR", 0x13: "V3_AD", 0x14: "V3_SR",
    0x15: "FC_LO", 0x16: "FC_HI", 0x17: "RE_RT", 0x18: "MO_VO", 0x19: "AD_P1", 0x1A: "AD_P2", 0x1B: "OSC3", 0x1C: "ENV3",
    0x1D: "IO_P1", 0x1E: "IO_P2", 0x1F: "UNUSED"
};

const RegisterCell = memo(({ idx, value, activity, chipTemp }: { idx: number, value: number, activity: number, chipTemp: number }) => {
    const isVoice1 = idx < 7;
    const isVoice2 = idx >= 7 && idx < 14;
    const isVoice3 = idx >= 14 && idx < 21;
    const isFilter = idx >= 21 && idx < 25;
    
    // HEAT SCALING: High chip temp shifts colors towards red
    const heatFactor = Math.min(1.0, Math.max(0.0, (chipTemp - 40) / 60));
    
    let colorClass = "text-slate-700";
    let glowClass = "";
    
    if (activity > 0.05) {
        if (isVoice1) { 
            colorClass = heatFactor > 0.7 ? "text-amber-400" : "text-cyan-400"; 
            glowClass = heatFactor > 0.7 ? "shadow-[0_0_15px_rgba(251,191,36,0.5)]" : "hdr-glow"; 
        }
        else if (isVoice2) { 
            colorClass = heatFactor > 0.5 ? "text-red-400" : "text-pink-400"; 
            glowClass = heatFactor > 0.5 ? "shadow-[0_0_15px_rgba(248,113,113,0.5)]" : "hdr-glow-pink"; 
        }
        else if (isVoice3) { 
            colorClass = "text-amber-500"; 
            glowClass = "shadow-[0_0_15px_rgba(251,191,36,0.6)]"; 
        }
        else if (isFilter) { 
            colorClass = "text-emerald-400"; 
            glowClass = "shadow-[0_0_15px_rgba(16,185,129,0.5)]"; 
        }
        else { 
            colorClass = "text-white"; 
            glowClass = "shadow-[0_0_10px_white]"; 
        }
    }

    return (
        <div className={`flex flex-col p-2 border border-white/5 rounded-lg bg-black/50 transition-all duration-150 ${activity > 0.7 ? 'scale-105 border-white/30 z-10' : ''}`}>
            <div className="flex justify-between items-center mb-1">
                <span className="text-[7px] font-black text-slate-500 tracking-tighter uppercase">{REG_LABELS[idx] || `REG_${idx}`}</span>
                <span className="text-[6px] text-slate-800 font-mono">0x{idx.toString(16).toUpperCase()}</span>
            </div>
            <div className="flex items-baseline justify-between">
                <span className={`text-base font-mono font-black transition-colors ${colorClass} ${glowClass}`}>
                    {value.toString(16).toUpperCase().padStart(2, '0')}
                </span>
                <div className="flex flex-col gap-0.5 w-1.5">
                    {Array.from({length: 4}).map((_, i) => (
                        <div key={i} className={`w-1.5 h-1 rounded-full transition-all duration-300 ${activity > (i/4) ? (isVoice1 ? 'bg-cyan-500' : isVoice2 ? 'bg-pink-500' : 'bg-amber-500') : 'bg-slate-900 opacity-20'}`} 
                             style={{ boxShadow: activity > (i/4) ? '0 0 5px currentColor' : 'none' }}
                        />
                    ))}
                </div>
            </div>
            {activity > 0.9 && (
                <div className="absolute inset-0 bg-white/10 animate-ping rounded-lg pointer-events-none"></div>
            )}
        </div>
    );
});

const AuditMonitor: React.FC<{ player: SidPlayer | null, isPlaying: boolean }> = ({ player, isPlaying }) => {
    const [regs, setRegs] = useState<number[]>(new Array(32).fill(0));
    const [activity, setActivity] = useState<number[]>(new Array(32).fill(0));
    const [chipTemp, setChipTemp] = useState(25);
    const prevRegs = useRef<number[]>(new Array(32).fill(0));
    const rafRef = useRef(0);

    useEffect(() => {
        const update = () => {
            if (player) {
                const currentRegs = player.volatileRegs;
                const nextActivity = [...activity];
                for(let i=0; i<32; i++) {
                    if (currentRegs[i] !== prevRegs.current[i]) {
                        nextActivity[i] = 1.0;
                    } else {
                        nextActivity[i] *= 0.88;
                    }
                }
                setRegs([...currentRegs]);
                setActivity(nextActivity);
                if (player.volatilePhysics) {
                    setChipTemp(player.volatilePhysics.temp ?? 25);
                }
                prevRegs.current = [...currentRegs];
            }
            rafRef.current = requestAnimationFrame(update);
        };
        rafRef.current = requestAnimationFrame(update);
        return () => cancelAnimationFrame(rafRef.current);
    }, [player, activity]);

    return (
        <div className="h-full flex flex-col bg-[#020408] font-mono p-4 gap-4 overflow-hidden select-none">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-3">
                    <Shield className="w-5 h-5 text-cyan-500" />
                    <span className="text-[12px] font-black text-white tracking-[0.3em] uppercase">SYSTEM_AUDIT_PROJECTION</span>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 px-3 py-1 bg-red-950/20 border border-red-500/30 rounded-full">
                        <Flame className={`w-3 h-3 ${chipTemp > 70 ? 'text-red-500 animate-pulse' : 'text-slate-600'}`} />
                        <span className={`text-[9px] font-bold ${chipTemp > 70 ? 'text-red-400' : 'text-slate-500'}`}>{chipTemp.toFixed(1)}°C</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-emerald-500 animate-pulse shadow-[0_0_10px_emerald]' : 'bg-slate-800'}`}></div>
                        <span className="text-[8px] text-slate-500 font-bold uppercase tracking-widest">{isPlaying ? 'BUS_LOCK' : 'BUS_IDLE'}</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-4 gap-3 flex-1 overflow-y-auto custom-scrollbar pr-2">
                {regs.map((val, i) => (
                    <RegisterCell key={i} idx={i} value={val} activity={activity[i]} chipTemp={chipTemp} />
                ))}
            </div>

            <div className="pt-3 border-t border-white/5 flex justify-between items-center opacity-50 group-hover:opacity-100 transition-opacity">
                <div className="flex gap-6">
                    <div className="flex flex-col">
                        <span className="text-[6px] text-slate-500 font-black">LOGIC_BANDWIDTH</span>
                        <span className="text-[10px] text-cyan-400 font-black">3.2 GB/s</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[6px] text-slate-500 font-black">STRESS_LEVEL</span>
                        <span className={`text-[10px] font-black ${chipTemp > 80 ? 'text-red-500' : 'text-emerald-400'}`}>
                            {chipTemp > 80 ? 'CRITICAL' : 'NOMINAL'}
                        </span>
                    </div>
                </div>
                <Database className="w-4 h-4 text-slate-800" />
            </div>
        </div>
    );
};

export default AuditMonitor;
