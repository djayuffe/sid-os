
import React, { useState } from 'react';
import { TrackerProject } from '../types';
import { Hash, Zap, Grid, Activity, Plus, Trash2, Save, Edit2 } from 'lucide-react';
import { updateFrameSpeed, updateFunkTempo, addChord, updateChord, deleteChord, addTempo, updateTempo, deleteTempo, formatChordString, formatTempoString } from '../services/swmTableService';

interface SwmTablesProps {
    project: TrackerProject;
    onUpdate: (p: TrackerProject) => void;
}

const SwmTables: React.FC<SwmTablesProps> = ({ project, onUpdate }) => {
    const [editingChord, setEditingChord] = useState<{idx: number, val: string} | null>(null);
    const [editingTempo, setEditingTempo] = useState<{idx: number, val: string} | null>(null);

    const TableSection = ({ title, icon, children, onAdd }: any) => (
        <div className="bg-slate-900 border border-slate-700 rounded p-3 mb-4">
            <div className="flex justify-between items-center mb-2 border-b border-slate-800 pb-1">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-2">
                    {icon} {title}
                </h4>
                {onAdd && (
                    <button onClick={onAdd} className="text-[9px] bg-slate-800 hover:bg-cyan-900 text-cyan-400 px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors">
                        <Plus className="w-3 h-3" /> ADD
                    </button>
                )}
            </div>
            {children}
        </div>
    );

    const handleChordBlur = () => {
        if (editingChord) {
            onUpdate(updateChord(project, editingChord.idx, editingChord.val));
            setEditingChord(null);
        }
    };

    const handleTempoBlur = () => {
        if (editingTempo) {
            onUpdate(updateTempo(project, editingTempo.idx, editingTempo.val));
            setEditingTempo(null);
        }
    };

    return (
        <div className="font-mono text-xs text-slate-400">
             <div className="grid grid-cols-2 gap-4">
                 <TableSection title="GLOBAL SETTINGS" icon={<Zap className="w-3 h-3"/>}>
                     <div className="flex justify-between items-center mb-1">
                         <span>FRAME SPEED:</span>
                         <input 
                            className="w-10 bg-slate-950 border border-slate-800 text-center text-cyan-400 focus:outline-none focus:border-cyan-500 rounded text-[10px]"
                            value={project.frameSpeed || 1}
                            onChange={(e) => onUpdate(updateFrameSpeed(project, parseInt(e.target.value) || 1))}
                         />
                     </div>
                     <div className="flex justify-between items-center">
                         <span>FUNK TEMPO:</span>
                         <input 
                            className="w-10 bg-slate-950 border border-slate-800 text-center text-cyan-400 focus:outline-none focus:border-cyan-500 rounded text-[10px]"
                            value={(project.subtunes[0].funkTempo || 0).toString(16).toUpperCase()}
                            onChange={(e) => onUpdate(updateFunkTempo(project, parseInt(e.target.value, 16) || 0))}
                         />
                     </div>
                 </TableSection>
                 
                 <TableSection title="STATS" icon={<Activity className="w-3 h-3"/>}>
                     <div className="grid grid-cols-2 gap-2 text-[10px]">
                         <div>CHORDS: {project.chordTable?.length || 0} / 64</div>
                         <div>TEMPOS: {project.tempoTable?.length || 0} / 64</div>
                         <div>INSTS: {project.instruments.length}</div>
                         <div>PATTERNS: {project.patterns.length}</div>
                     </div>
                 </TableSection>
             </div>

             <TableSection title="CHORD TABLE" icon={<Grid className="w-3 h-3"/>} onAdd={() => onUpdate(addChord(project))}>
                 {project.chordTable && project.chordTable.length > 0 ? (
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto custom-scrollbar">
                         {project.chordTable.map((c, i) => (
                             <div key={i} className="bg-slate-950 border border-slate-800 p-1.5 rounded flex items-center gap-2 group">
                                 <span className="text-[9px] text-cyan-600 font-bold w-6">ID {i.toString(16).toUpperCase()}</span>
                                 <div className="flex-1">
                                     {editingChord && editingChord.idx === i ? (
                                         <input 
                                            autoFocus
                                            className="w-full bg-slate-900 text-white text-[10px] px-1 focus:outline-none"
                                            value={editingChord.val}
                                            onChange={(e) => setEditingChord({ idx: i, val: e.target.value })}
                                            onBlur={handleChordBlur}
                                            onKeyDown={(e) => e.key === 'Enter' && handleChordBlur()}
                                         />
                                     ) : (
                                         <div 
                                            className="flex gap-1 cursor-text hover:bg-slate-900/50 p-0.5 rounded"
                                            onClick={() => setEditingChord({ idx: i, val: formatChordString(c) })}
                                         >
                                             {c.steps.map((s, si) => (
                                                 <span key={si} className="text-white bg-slate-800 px-1 rounded text-[10px]">{s >= 0 ? `+${s.toString(16).toUpperCase()}` : s.toString(16).toUpperCase()}</span>
                                             ))}
                                         </div>
                                     )}
                                 </div>
                                 <button onClick={() => onUpdate(deleteChord(project, i))} className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400"><Trash2 className="w-3 h-3"/></button>
                             </div>
                         ))}
                     </div>
                 ) : (
                     <div className="text-slate-600 text-[10px] text-center italic py-2">NO CHORD DATA</div>
                 )}
             </TableSection>

             <TableSection title="TEMPO TABLE" icon={<Activity className="w-3 h-3"/>} onAdd={() => onUpdate(addTempo(project))}>
                 {project.tempoTable && project.tempoTable.length > 0 ? (
                     <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto custom-scrollbar">
                         {project.tempoTable.map((t, i) => (
                             <div key={i} className="bg-slate-950 border border-slate-800 p-1.5 rounded flex items-center gap-2 group">
                                 <span className="text-[9px] text-pink-600 font-bold">ID {i.toString(16).toUpperCase()}</span>
                                 <div className="min-w-[60px]">
                                     {editingTempo && editingTempo.idx === i ? (
                                         <input 
                                            autoFocus
                                            className="w-full bg-slate-900 text-white text-[10px] px-1 focus:outline-none"
                                            value={editingTempo.val}
                                            onChange={(e) => setEditingTempo({ idx: i, val: e.target.value })}
                                            onBlur={handleTempoBlur}
                                            onKeyDown={(e) => e.key === 'Enter' && handleTempoBlur()}
                                         />
                                     ) : (
                                         <div 
                                            className="flex gap-0.5 cursor-text hover:bg-slate-900/50 p-0.5 rounded"
                                            onClick={() => setEditingTempo({ idx: i, val: formatTempoString(t) })}
                                         >
                                             {t.values.map((v, vi) => (
                                                 <span key={vi} className="text-white text-[10px]">{v.toString(16).toUpperCase()}</span>
                                             ))}
                                         </div>
                                     )}
                                 </div>
                                 <button onClick={() => onUpdate(deleteTempo(project, i))} className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400"><Trash2 className="w-3 h-3"/></button>
                             </div>
                         ))}
                     </div>
                 ) : (
                    <div className="text-slate-600 text-[10px] text-center italic py-2">NO TEMPO DATA</div>
                 )}
             </TableSection>
        </div>
    );
};

export default SwmTables;
