
import React, { useRef } from 'react';
import { TrackerProject } from '../types';
import { Plus, Trash2, Repeat, Maximize2 } from 'lucide-react';

interface SwmSequenceEditorProps {
    project: TrackerProject;
    activeStep: number;
    onUpdateStep: (step: number, patId: number) => void;
    onInsert: (step: number) => void;
    onDelete: (step: number) => void;
    onSeek: (frame: number) => void;
    onSetLoop: (step: number) => void;
}

const SwmSequenceEditor: React.FC<SwmSequenceEditorProps> = ({ project, activeStep, onUpdateStep, onInsert, onDelete, onSeek, onSetLoop }) => {
    const subtune = project.subtunes[0];
    const orderList = subtune.orderList;
    const loopPos = subtune.loopPosition !== undefined ? subtune.loopPosition : -1;
    
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const activeRef = useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (activeRef.current && scrollRef.current) {
            const container = scrollRef.current;
            const element = activeRef.current;
            const top = element.offsetTop - container.offsetTop;
            const center = top - (container.clientHeight / 2) + (element.clientHeight / 2);
            container.scrollTo({ top: center, behavior: 'smooth' });
        }
    }, [activeStep]);

    return (
        <div ref={containerRef} className="flex flex-col h-full bg-slate-950 border border-slate-800 rounded-lg shadow-lg overflow-hidden select-none group/full max-h-screen">
             <div className="px-3 py-2 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-[10px] font-bold text-slate-400 shrink-0">
                <span className="text-cyan-500 tracking-wider">SEQUENCE_ENGINE_V1</span>
                <div className="flex items-center gap-3">
                    <span className="bg-slate-800 px-2 py-0.5 rounded text-slate-500">LEN: {orderList.length}</span>
                    <button onClick={() => containerRef.current?.requestFullscreen()} className="opacity-0 group-hover/full:opacity-100 transition-opacity hover:text-cyan-400"><Maximize2 className="w-3 h-3"/></button>
                </div>
             </div>
             
             <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar bg-black p-2 fullscreen:grid fullscreen:grid-cols-4 fullscreen:gap-4 fullscreen:p-8">
                 {orderList.map((patId, i) => {
                     const isActive = i === activeStep;
                     const isLoop = i === loopPos;
                     return (
                         <div 
                            key={i} 
                            ref={isActive ? activeRef : null}
                            className={`flex items-center gap-2 p-1 rounded mb-1 border border-transparent group transition-all relative ${isActive ? 'bg-cyan-900/30 border-cyan-800/60 shadow-[0_0_20px_rgba(34,211,238,0.1)]' : 'hover:bg-slate-900 border-slate-900'} ${isLoop ? 'pl-3' : ''} fullscreen:p-4 fullscreen:rounded-2xl fullscreen:border-2`}
                         >
                             {isLoop && (
                                 <div className="absolute left-0 top-1/2 -translate-y-1/2 -ml-1 text-pink-500 z-10" title="Loop Start Point">
                                     <Repeat className="w-3 h-3 fullscreen:w-5 fullscreen:h-5"/>
                                 </div>
                             )}
                             
                             <div 
                                className={`w-6 text-[10px] text-right font-mono cursor-pointer hover:text-white transition-colors fullscreen:text-lg ${isActive ? 'text-cyan-400 font-black scale-110' : 'text-slate-600'}`}
                                onClick={() => onSeek(i * 64)}
                             >
                                 {i.toString(16).toUpperCase().padStart(2,'0')}
                             </div>
                             
                             <div className="flex-1 relative">
                                 <input 
                                    className={`w-full bg-slate-950 border border-slate-800 text-center font-mono text-[11px] py-1 rounded focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 transition-all fullscreen:text-2xl fullscreen:py-3 ${isActive ? 'text-white font-bold shadow-[0_0_15px_rgba(34,211,238,0.1)]' : 'text-slate-400'}`}
                                    value={patId.toString(16).toUpperCase().padStart(2,'0')}
                                    onChange={(e) => {
                                        const val = e.target.value.replace(/[^0-9A-Fa-f]/g, '');
                                        const v = parseInt(val, 16);
                                        if (val === '' || (!isNaN(v) && v >= 0 && v < 256)) { 
                                           if (!isNaN(v)) onUpdateStep(i, v);
                                        }
                                    }}
                                    maxLength={2}
                                 />
                                 {isActive && <div className="absolute right-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-cyan-500 rounded-full animate-pulse pointer-events-none"></div>}
                             </div>
                             
                             <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity w-5 ml-1 fullscreen:w-8">
                                 <button onClick={() => onSetLoop(isLoop ? -1 : i)} className={`h-3 flex items-center justify-center hover:bg-slate-700 rounded ${isLoop ? 'text-pink-400' : 'text-slate-500'} fullscreen:h-6`} title="Set Loop"><Repeat className="w-2 h-2 fullscreen:w-4 fullscreen:h-4"/></button>
                                 <button onClick={() => onInsert(i)} className="h-3 flex items-center justify-center hover:bg-slate-700 rounded text-emerald-500 fullscreen:h-6" title="Add After"><Plus className="w-2 h-2 fullscreen:w-4 fullscreen:h-4"/></button>
                                 <button onClick={() => onDelete(i)} className="h-3 flex items-center justify-center hover:bg-slate-700 rounded text-red-500 fullscreen:h-6" title="Remove"><Trash2 className="w-2 h-2 fullscreen:w-4 fullscreen:h-4"/></button>
                             </div>
                         </div>
                     );
                 })}
                 
                 <button 
                    onClick={() => onInsert(orderList.length - 1)}
                    className="w-full mt-3 py-2 bg-slate-900 border border-slate-800 border-dashed text-[10px] text-slate-500 hover:text-cyan-400 hover:border-cyan-800 hover:bg-slate-800 rounded flex justify-center items-center gap-2 transition-all fullscreen:p-8 fullscreen:text-lg fullscreen:rounded-3xl"
                 >
                     <Plus className="w-3 h-3 fullscreen:w-6 fullscreen:h-6"/> NEW_STEP
                 </button>
             </div>
        </div>
    );
};

export default SwmSequenceEditor;
