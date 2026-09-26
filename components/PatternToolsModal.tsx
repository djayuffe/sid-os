
import React, { useState } from 'react';
import { ArrowUp, ArrowDown, Trash2, Layers, Music } from 'lucide-react';

interface PatternToolsModalProps {
    onTranspose: (semitones: number, wholePattern: boolean) => void;
    onClear: (wholePattern: boolean) => void;
    onClose: () => void;
    channel: number;
}

const PatternToolsModal: React.FC<PatternToolsModalProps> = ({ onTranspose, onClear, onClose, channel }) => {
    const [wholePattern, setWholePattern] = useState(false);

    const TransposeBtn = ({ val, label }: { val: number, label: string }) => (
        <button 
            onClick={() => onTranspose(val, wholePattern)}
            className="flex-1 py-2 bg-slate-900 border border-slate-700 hover:bg-cyan-900/30 hover:border-cyan-500 text-cyan-400 rounded text-xs font-bold transition-all active:scale-95"
        >
            {label}
        </button>
    );

    return (
        <div className="flex flex-col gap-6 font-mono select-none">
            <div className="bg-slate-950 p-3 rounded border border-slate-800 shadow-inner flex flex-col gap-2">
                 <div className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-2 mb-1">
                     <Layers className="w-3 h-3" /> TARGET SCOPE
                 </div>
                 <div className="flex gap-2">
                     <button 
                         onClick={() => setWholePattern(false)}
                         className={`flex-1 py-2 text-xs font-bold border rounded transition-all ${!wholePattern ? 'bg-amber-900/30 border-amber-500 text-amber-300' : 'bg-slate-900 border-slate-700 text-slate-500'}`}
                     >
                         TRACK {channel + 1} ONLY
                     </button>
                     <button 
                         onClick={() => setWholePattern(true)}
                         className={`flex-1 py-2 text-xs font-bold border rounded transition-all ${wholePattern ? 'bg-amber-900/30 border-amber-500 text-amber-300' : 'bg-slate-900 border-slate-700 text-slate-500'}`}
                     >
                         WHOLE PATTERN
                     </button>
                 </div>
            </div>

            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-cyan-500 uppercase tracking-widest border-b border-slate-800 pb-2">
                    <Music className="w-3 h-3"/> TRANSPOSE
                </div>
                <div className="flex gap-2">
                    <TransposeBtn val={-12} label="-1 OCT" />
                    <TransposeBtn val={-1} label="-1 SEMI" />
                    <TransposeBtn val={1} label="+1 SEMI" />
                    <TransposeBtn val={12} label="+1 OCT" />
                </div>
            </div>

            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-red-500 uppercase tracking-widest border-b border-slate-800 pb-2">
                    <Trash2 className="w-3 h-3"/> CLEANUP
                </div>
                <button 
                    onClick={() => onClear(wholePattern)}
                    className="w-full py-3 bg-red-900/20 border border-red-900 hover:bg-red-900/40 hover:border-red-500 text-red-400 rounded font-bold text-xs transition-colors flex items-center justify-center gap-2"
                >
                    <Trash2 className="w-4 h-4" /> ERASE DATA
                </button>
            </div>

            <div className="pt-4 border-t border-slate-800 mt-2">
                <button onClick={onClose} className="w-full py-2 text-xs font-bold bg-slate-800 text-slate-400 rounded hover:bg-slate-700 transition-colors">
                    CLOSE
                </button>
            </div>
        </div>
    );
};

export default PatternToolsModal;
