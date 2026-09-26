
import React, { useState } from 'react';
import { NoteDuration } from '../services/midiExportService';
import { Settings, Music, Clock, Download, Layers, Sliders } from 'lucide-react';

interface MidiExportEditorProps {
    initialBpm: number;
    initialPpq: number;
    initialDuration: NoteDuration;
    onExport: (bpm: number, ppq: number, duration: NoteDuration, useProject: boolean, channels: [boolean, boolean, boolean]) => void;
    onClose: () => void;
}

const MidiExportEditor: React.FC<MidiExportEditorProps> = ({ initialBpm, initialPpq, initialDuration, onExport, onClose }) => {
    const [bpm, setBpm] = useState(initialBpm);
    const [ppq, setPpq] = useState(initialPpq);
    const [duration, setDuration] = useState<NoteDuration>(initialDuration);
    const [useProject, setUseProject] = useState(true);
    const [channels, setChannels] = useState<[boolean, boolean, boolean]>([true, true, true]);

    const PpqOption = ({ val, label }: { val: number, label: string }) => (
        <button 
            onClick={() => setPpq(val)}
            className={`flex-1 py-2 text-[10px] font-bold border rounded transition-all ${ppq === val ? 'bg-cyan-900/40 border-cyan-500 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.1)]' : 'bg-slate-900 border-slate-700 text-slate-500 hover:bg-slate-800'}`}
        >
            {label}
        </button>
    );

    const DurOption = ({ val, label }: { val: NoteDuration, label: string }) => (
        <button 
            onClick={() => setDuration(val)}
            className={`flex-1 py-2 text-[10px] font-bold border rounded transition-all ${duration === val ? 'bg-amber-900/40 border-amber-500 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.1)]' : 'bg-slate-900 border-slate-700 text-slate-500 hover:bg-slate-800'}`}
        >
            {label}
        </button>
    );

    const toggleChannel = (idx: number) => {
        const next = [...channels] as [boolean, boolean, boolean];
        next[idx] = !next[idx];
        setChannels(next);
    };

    return (
        <div className="flex flex-col gap-6 font-mono select-none">
            <div className="bg-slate-950 p-3 rounded border border-slate-800 shadow-inner flex flex-col gap-2">
                 <div className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-2 mb-1">
                     <Layers className="w-3 h-3" /> SOURCE DATA
                 </div>
                 <div className="flex gap-2">
                     <button 
                         onClick={() => setUseProject(true)}
                         className={`flex-1 py-2 text-xs font-bold border rounded transition-all ${useProject ? 'bg-green-900/30 border-green-500 text-green-300' : 'bg-slate-900 border-slate-700 text-slate-500'}`}
                     >
                         EDITED PROJECT
                     </button>
                     <button 
                         onClick={() => setUseProject(false)}
                         className={`flex-1 py-2 text-xs font-bold border rounded transition-all ${!useProject ? 'bg-green-900/30 border-green-500 text-green-300' : 'bg-slate-900 border-slate-700 text-slate-500'}`}
                     >
                         RAW TRACE
                     </button>
                 </div>
                 <p className="text-[9px] text-slate-500 italic px-1">
                    {useProject ? "Export will reflect all your edits in the Tracker View." : "Export will use the original imported dump data (ignoring edits)."}
                 </p>
            </div>

            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-cyan-500 uppercase tracking-widest border-b border-slate-800 pb-2">
                    <Sliders className="w-3 h-3"/> CHANNEL FILTER
                </div>
                <div className="flex gap-2">
                    {[0,1,2].map(i => (
                        <button 
                            key={i}
                            onClick={() => toggleChannel(i)}
                            className={`flex-1 py-2 text-xs font-bold border rounded flex items-center justify-center gap-2 transition-all ${channels[i] ? 'bg-cyan-900/30 border-cyan-500 text-cyan-300 shadow-sm' : 'bg-slate-900 border-slate-700 text-slate-600 grayscale'}`}
                        >
                            <span className={`w-2 h-2 rounded-full ${channels[i] ? 'bg-cyan-400 shadow-[0_0_5px_currentColor]' : 'bg-slate-600'}`}></span>
                            VOICE {i+1}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-cyan-500 uppercase tracking-widest border-b border-slate-800 pb-2">
                    <Clock className="w-3 h-3"/> TEMPO SETTINGS
                </div>
                <div className="flex items-center gap-4 bg-slate-950 p-4 rounded border border-slate-800 shadow-inner">
                    <div className="flex flex-col gap-1 flex-1">
                        <span className="text-[9px] text-slate-500 font-bold flex justify-between">
                            <span>BPM</span>
                            <span>{bpm}</span>
                        </span>
                        <input 
                            type="range" min="60" max="250" step="1" 
                            value={bpm} onChange={e => setBpm(parseInt(e.target.value))}
                            className="w-full h-1.5 accent-cyan-500 bg-slate-800 rounded appearance-none cursor-pointer"
                        />
                    </div>
                    <input 
                        type="number" 
                        className="w-16 bg-slate-900 border border-slate-700 text-cyan-300 font-bold text-lg text-center rounded focus:outline-none focus:border-cyan-500 shadow-inner"
                        value={bpm} onChange={e => setBpm(Math.max(1, Math.min(999, parseInt(e.target.value)||120)))}
                    />
                </div>
            </div>

            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-cyan-500 uppercase tracking-widest border-b border-slate-800 pb-2">
                    <Settings className="w-3 h-3"/> RESOLUTION (PPQ)
                </div>
                <div className="flex gap-2">
                    <PpqOption val={96} label="96" />
                    <PpqOption val={480} label="480 (STD)" />
                    <PpqOption val={960} label="960 (HQ)" />
                </div>
            </div>

            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-500 uppercase tracking-widest border-b border-slate-800 pb-2">
                    <Music className="w-3 h-3"/> QUANTIZATION GRID
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <DurOption val="smart" label="SMART" />
                    <DurOption val="raw" label="RAW" />
                    <DurOption val="1/4" label="1/4" />
                    <DurOption val="1/8" label="1/8" />
                    <DurOption val="1/16" label="1/16" />
                    <DurOption val="1/32" label="1/32" />
                </div>
            </div>

            <div className="flex gap-4 pt-4 border-t border-slate-800">
                <button onClick={onClose} className="flex-1 py-2 text-xs font-bold bg-slate-800 text-slate-400 rounded hover:bg-slate-700 transition-colors">
                    CANCEL
                </button>
                <button onClick={() => onExport(bpm, ppq, duration, useProject, channels)} className="flex-1 py-2 text-xs font-bold bg-cyan-900 border border-cyan-500 text-cyan-100 rounded hover:bg-cyan-800 shadow-[0_0_15px_rgba(34,211,238,0.2)] flex items-center justify-center gap-2 transition-all active:scale-95">
                    <Download className="w-4 h-4"/> EXPORT MIDI
                </button>
            </div>
        </div>
    );
};

export default MidiExportEditor;
