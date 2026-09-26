
import React from 'react';
import { TrackerProject } from '../types';
import { Layers, FileText, Music, Table, Edit } from 'lucide-react';
import SwmTables from './SwmTables';

interface SwmDetailViewProps {
    project?: TrackerProject;
    onUpdateProject?: (p: TrackerProject) => void;
}

const SwmDetailView: React.FC<SwmDetailViewProps> = ({ project, onUpdateProject }) => {
    if (!project) return <div className="flex items-center justify-center h-full text-slate-500 font-mono text-xs">NO PROJECT DATA</div>;

    const Section = ({ title, icon, children }: any) => (
        <div className="bg-slate-900/50 border border-slate-800 rounded p-4 mb-4 backdrop-blur-sm">
            <h3 className="text-sm font-bold text-cyan-400 mb-3 flex items-center gap-2 border-b border-slate-800 pb-2">
                {icon} {title}
            </h3>
            {children}
        </div>
    );

    const MetaInput = ({ label, val, field }: { label: string, val: string, field: 'title'|'author'|'released' }) => (
        <div className="flex flex-col gap-1">
            <span className="text-[9px] text-slate-500 font-bold uppercase">{label}</span>
            <div className="relative group">
                <input 
                    className="w-full bg-slate-950 border border-slate-800 text-cyan-100 px-2 py-1 text-[11px] rounded focus:outline-none focus:border-cyan-500 transition-colors"
                    value={val}
                    onChange={(e) => onUpdateProject && onUpdateProject({ ...project, meta: { ...project.meta, [field]: e.target.value } })}
                />
                <Edit className="w-3 h-3 text-slate-600 absolute right-2 top-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            </div>
        </div>
    );

    return (
        <div className="p-4 overflow-y-auto h-full bg-slate-950 font-mono text-xs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Section title="MODULE METADATA" icon={<FileText className="w-4 h-4" />}>
                    <div className="flex flex-col gap-3">
                        <MetaInput label="TITLE" val={project.meta.title} field="title" />
                        <MetaInput label="AUTHOR" val={project.meta.author} field="author" />
                        <MetaInput label="COPYRIGHT / RELEASED" val={project.meta.released} field="released" />
                        <div className="mt-2 pt-2 border-t border-slate-800 flex justify-between items-center text-[9px]">
                             <span className="text-slate-500">FORMAT</span>
                             <span className="text-cyan-500 font-bold bg-cyan-900/20 px-1.5 py-0.5 rounded border border-cyan-900/50">SWM v1.0 (Strict)</span>
                        </div>
                    </div>
                </Section>

                <Section title="SUBTUNES / ORDERLIST" icon={<Layers className="w-4 h-4" />}>
                    <div className="flex gap-2 flex-wrap">
                        {project.subtunes.map((st, i) => (
                            <div key={i} className="bg-slate-800 p-2 rounded border border-slate-700 w-full">
                                <div className="text-[10px] text-slate-500 font-bold mb-1 flex justify-between">
                                    <span>SUBTUNE {i+1}</span>
                                    <span>LEN: {st.orderList.length}</span>
                                </div>
                                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto custom-scrollbar bg-slate-950 p-1 rounded inner-shadow">
                                    {st.orderList.map((pat, idx) => (
                                        <span key={idx} className="bg-cyan-900/40 text-cyan-200 px-1.5 py-0.5 rounded text-[9px] font-mono border border-cyan-900/50">
                                            {pat.toString(16).toUpperCase().padStart(2, '0')}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </Section>
            </div>
            
            <Section title="TABLE STRUCTURES" icon={<Table className="w-4 h-4"/>}>
                 {onUpdateProject ? (
                     <SwmTables project={project} onUpdate={onUpdateProject} />
                 ) : (
                     <div className="text-red-500">Read-only view (Update handler missing)</div>
                 )}
            </Section>

            <Section title="INSTRUMENT DEFINITIONS" icon={<Music className="w-4 h-4" />}>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="text-slate-500 border-b border-slate-800 text-[10px]">
                                <th className="p-2">ID</th>
                                <th className="p-2">NAME</th>
                                <th className="p-2">ADSR</th>
                                <th className="p-2">WAVE</th>
                                <th className="p-2">FLAGS</th>
                                <th className="p-2">VIBRATO</th>
                            </tr>
                        </thead>
                        <tbody className="text-slate-300">
                            {project.instruments.map(inst => (
                                <tr key={inst.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                                    <td className="p-2 font-bold text-cyan-500">{inst.id.toString(16).toUpperCase().padStart(2,'0')}</td>
                                    <td className="p-2">{inst.name}</td>
                                    <td className="p-2 tracking-widest text-[10px]">
                                        {inst.attack.toString(16)}{inst.decay.toString(16)}{inst.sustain.toString(16)}{inst.release.toString(16)}
                                    </td>
                                    <td className="p-2">
                                        {(inst.waveform & 0xF0).toString(16).toUpperCase()}
                                        <span className="text-[9px] text-slate-500 ml-1">
                                            {inst.waveform & 1 ? 'G' : ''}
                                            {inst.waveform & 2 ? 'S' : ''}
                                            {inst.waveform & 4 ? 'R' : ''}
                                        </span>
                                    </td>
                                    <td className="p-2 text-[10px] text-slate-500 font-mono">
                                        HR:{inst.hardRestart ? '1' : '0'} 
                                    </td>
                                    <td className="p-2 text-[10px]">
                                        TYPE:{inst.vibratoType} P:{inst.vibParam} D:{inst.vibDelay}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Section>
        </div>
    );
};

export default SwmDetailView;
