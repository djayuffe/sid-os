
import React from 'react';
import { Monitor, Volume2, Cpu, Grid, Settings, Zap, Repeat } from 'lucide-react';
import { CLOCK_PAL, CLOCK_NTSC } from '../services/sidService';
import { C64Config } from './sid/SidTypes';
import { C64Settings } from './C64Settings';
import type { MidiReductionMode } from '../services/midiReductionService';

interface SettingsModalProps {
    onClose: () => void;
    crtEnabled: boolean;
    setCrtEnabled: (v: boolean) => void;
    showHex: boolean;
    setShowHex: (v: boolean) => void;
    clockFreq: number;
    setClockFreq: (f: number) => void;
    fpsOverride: number | null;
    setFpsOverride: (f: number | null) => void;
    luminosity: number;
    setLuminosity: (l: number) => void;
    sidModel: '6581' | '8580';
    setSidModel: (m: '6581' | '8580') => void;
    engineType: 'STD' | 'HIFI';
    setEngineType: (t: 'STD' | 'HIFI') => void;
    midiReduction?: MidiReductionMode;
    setMidiReduction?: (mode: MidiReductionMode) => void;
    midiCoupledEffects?: boolean;
    setMidiCoupledEffects?: (enabled: boolean) => void;
    emulationConfig?: C64Config;
    setEmulationConfig?: (c: C64Config) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ 
    onClose, crtEnabled, setCrtEnabled, showHex, setShowHex, 
    clockFreq, setClockFreq, fpsOverride, setFpsOverride, 
    luminosity, setLuminosity, sidModel, setSidModel,
    engineType, setEngineType, midiReduction, setMidiReduction, midiCoupledEffects, setMidiCoupledEffects,
    emulationConfig, setEmulationConfig
}) => {
    
    const Toggle = ({ label, checked, onChange, icon }: any) => (
        <div className="flex justify-between items-center bg-slate-900 p-3 rounded border border-slate-800">
            <div className="flex items-center gap-2">
                {icon}
                <span className="text-xs font-bold text-slate-300">{label}</span>
            </div>
            <input 
                type="checkbox" 
                checked={checked} 
                onChange={e => onChange(e.target.checked)}
                className="w-4 h-4 accent-cyan-500 cursor-pointer"
            />
        </div>
    );

    return (
        <div className="flex flex-col gap-6 font-mono select-none max-h-[80vh] overflow-y-auto pr-2">
            
            {emulationConfig && setEmulationConfig && (
                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-orange-500 uppercase tracking-widest border-b border-slate-800 pb-2">
                        <Cpu className="w-3 h-3"/> EMULATION CORE
                    </div>
                    <C64Settings config={emulationConfig} onConfigChange={setEmulationConfig} />
                </div>
            )}

            {setMidiReduction && (
                <section className="flex flex-col gap-3 rounded border border-cyan-900 p-3">
                    <h3 className="text-xs font-bold text-cyan-400">MIDI → THREE SID VOICES</h3>
                    <label className="text-xs text-slate-300">
                        Reduction strategy
                        <select aria-label="MIDI reduction strategy" value={midiReduction}
                            onChange={e => setMidiReduction(e.target.value as MidiReductionMode)}
                            className="ml-3 bg-slate-900 border border-slate-700 rounded p-2">
                            <option value="balanced">Balanced bass / melody / harmony</option>
                            <option value="arpeggio">Chord arpeggio (12 steps/sec)</option>
                        </select>
                    </label>
                    <label className="flex gap-2 text-xs text-slate-300">
                        <input type="checkbox" checked={midiCoupledEffects ?? true}
                            onChange={e => setMidiCoupledEffects?.(e.target.checked)} />
                        Use spare oscillators for bell ring-modulation / lead sync
                    </label>
                    <p className="text-[10px] text-slate-400">
                        Applies to the next MIDI import. Drums temporarily use one voice.
                        Arpeggiation changes articulation; mono SID cannot preserve MIDI pan.
                        See Logs after import for omitted and octave-folded notes.
                    </p>
                </section>
            )}

            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-cyan-500 uppercase tracking-widest border-b border-slate-800 pb-2">
                    <Zap className="w-3 h-3"/> AUDIO ENGINE
                </div>
                <div className="flex justify-between items-center bg-slate-900 p-3 rounded border border-slate-800">
                    <span className="text-xs font-bold text-slate-300">SYNTH MODE</span>
                    <div className="flex gap-2">
                        <button 
                            onClick={() => setEngineType('STD')}
                            className={`px-3 py-1 text-[10px] font-bold border rounded transition-all ${engineType === 'STD' ? 'bg-cyan-900 text-white border-cyan-500 shadow-[0_0_10px_cyan]' : 'bg-slate-800 text-slate-500 border-slate-600'}`}
                        >
                            STD_V19
                        </button>
                        <button 
                            onClick={() => setEngineType('HIFI')}
                            className={`px-3 py-1 text-[10px] font-bold border rounded transition-all ${engineType === 'HIFI' ? 'bg-pink-900 text-white border-pink-500 shadow-[0_0_10px_pink]' : 'bg-slate-800 text-slate-500 border-slate-600'}`}
                        >
                            HIFI_PRO
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-cyan-500 uppercase tracking-widest border-b border-slate-800 pb-2">
                    <Monitor className="w-3 h-3"/> VISUALS
                </div>
                <Toggle label="CRT POST-PROCESSING" checked={crtEnabled} onChange={setCrtEnabled} />
                <Toggle label="HEXADECIMAL MODE" checked={showHex} onChange={setShowHex} />
                
                <div className="bg-slate-900 p-3 rounded border border-slate-800 flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-300">LUMINOSITY</span>
                        <span className="text-[10px] font-bold text-cyan-400">{(luminosity * 100).toFixed(0)}%</span>
                    </div>
                    <input 
                        type="range" min="0.1" max="3.0" step="0.1" 
                        value={luminosity} 
                        onChange={e => setLuminosity(parseFloat(e.target.value))}
                        className="w-full h-1.5 accent-cyan-500 bg-slate-800 rounded appearance-none cursor-pointer"
                    />
                </div>
            </div>

            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-cyan-500 uppercase tracking-widest border-b border-slate-800 pb-2">
                    <Cpu className="w-3 h-3"/> SYSTEM
                </div>
                <div className="flex justify-between items-center bg-slate-900 p-3 rounded border border-slate-800">
                    <span className="text-xs font-bold text-slate-300">CHIP MODEL</span>
                    <div className="flex gap-2">
                        <button 
                            onClick={() => setSidModel('6581')}
                            className={`px-3 py-1 text-[10px] font-bold border rounded ${sidModel === '6581' ? 'bg-amber-900 text-white border-amber-500' : 'bg-slate-800 text-slate-500 border-slate-600'}`}
                        >
                            MOS 6581
                        </button>
                        <button 
                            onClick={() => setSidModel('8580')}
                            className={`px-3 py-1 text-[10px] font-bold border rounded ${sidModel === '8580' ? 'bg-cyan-900 text-white border-cyan-500' : 'bg-slate-800 text-slate-500 border-slate-600'}`}
                        >
                            MOS 8580
                        </button>
                    </div>
                </div>
                <div className="flex justify-between items-center bg-slate-900 p-3 rounded border border-slate-800">
                    <span className="text-xs font-bold text-slate-300">SID CLOCK FREQ</span>
                    <div className="flex gap-2">
                        <button 
                            onClick={() => setClockFreq(CLOCK_PAL)}
                            className={`px-3 py-1 text-[10px] font-bold border rounded ${clockFreq === CLOCK_PAL ? 'bg-cyan-900 text-white border-cyan-500' : 'bg-slate-800 text-slate-500 border-slate-600'}`}
                        >
                            PAL (50Hz)
                        </button>
                        <button 
                            onClick={() => setClockFreq(CLOCK_NTSC)}
                            className={`px-3 py-1 text-[10px] font-bold border rounded ${clockFreq === CLOCK_NTSC ? 'bg-cyan-900 text-white border-cyan-500' : 'bg-slate-800 text-slate-500 border-slate-600'}`}
                        >
                            NTSC (60Hz)
                        </button>
                    </div>
                </div>
                <div className="flex justify-between items-center bg-slate-900 p-3 rounded border border-slate-800">
                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-slate-300">MANUAL FRAME RATE</span>
                        <span className="text-[9px] text-slate-600">Override default 50/60Hz. Set to 100/120 for 2x speed traces.</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <input 
                            type="number" 
                            className="w-16 bg-slate-950 border border-slate-700 text-cyan-400 font-bold text-xs text-center rounded focus:outline-none focus:border-cyan-500 p-1"
                            value={fpsOverride || ''}
                            placeholder="AUTO"
                            onChange={e => {
                                const v = parseFloat(e.target.value);
                                setFpsOverride(isNaN(v) || v <= 0 ? null : v);
                            }}
                        />
                        <span className="text-[10px] text-slate-500 font-bold">FPS</span>
                    </div>
                </div>
            </div>

            <div className="pt-4 border-t border-slate-800 mt-2">
                <button onClick={onClose} className="w-full py-2 text-xs font-bold bg-slate-800 text-slate-400 rounded hover:bg-slate-700 transition-colors">
                    CLOSE
                </button>
            </div>
        </div>
    );
};

export default SettingsModal;
