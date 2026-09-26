
import React, { useState } from 'react';
import { Database, FileCode, Disc, HardDrive, Upload, Trash2, Zap, Radio, FileText, Music, Box, PlayCircle } from 'lucide-react';
import { VirtualFile } from '../types';

interface SdEmulatorProps {
    files: VirtualFile[];
    onMount: (file: VirtualFile) => void;
    onDelete: (id: string) => void;
    onUpload: (files: FileList) => void;
}

const SdEmulator: React.FC<SdEmulatorProps> = ({ files, onMount, onDelete, onUpload }) => {
    const [dragActive, setDragActive] = useState(false);

    return (
        <div 
            className={`h-full flex flex-col font-mono text-[9px] bg-[#020408] transition-all ${dragActive ? 'ring-2 ring-cyan-500/50 ring-inset' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => { e.preventDefault(); setDragActive(false); e.dataTransfer.files && onUpload(e.dataTransfer.files); }}
        >
            <div className="p-2 bg-slate-900/40 border-b border-white/5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                    <HardDrive className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-emerald-500 font-black tracking-tighter uppercase">SD2IEC_SYS</span>
                </div>
                <label className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-900/20 border border-emerald-500/30 rounded text-emerald-400 font-black hover:bg-emerald-500/20 transition-all cursor-pointer text-[8px]">
                    <Upload className="w-2.5 h-2.5" /> INSERT
                    <input type="file" multiple className="hidden" onChange={(e) => e.target.files && onUpload(e.target.files)} />
                </label>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1 bg-[linear-gradient(rgba(0,0,0,0.3)_1px,transparent_1px)] bg-[size:100%_18px]">
                {files.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-slate-800 opacity-30 grayscale">
                        <Box className="w-8 h-8 mb-2" />
                        <span className="text-[7px] font-black tracking-widest uppercase">FS_EMPTY</span>
                        <p className="text-[6px] mt-1">DROP .JSONL TRACE</p>
                    </div>
                )}
                {files.map(file => (
                    <div 
                        key={file.id}
                        onClick={() => onMount(file)}
                        className="group flex items-center gap-2 p-1.5 bg-slate-900/20 border border-white/5 rounded-md hover:border-cyan-500/30 hover:bg-cyan-500/5 cursor-pointer transition-all active:scale-[0.98]"
                    >
                        {file.type === 'SID' ? <Music className="w-3 h-3 text-cyan-600" /> : <FileCode className="w-3 h-3 text-amber-600" />}
                        <div className="flex-1 min-w-0">
                            <div className="text-slate-400 font-bold uppercase truncate tracking-tighter">{file.name}</div>
                            <div className="flex gap-2 text-[6px] text-slate-600 uppercase">
                                <span>{(file.size / 1024).toFixed(1)} KB</span>
                                <span className="text-slate-700">LINK:OK</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={(e) => { e.stopPropagation(); onDelete(file.id); }} className="p-1 hover:bg-red-500/20 rounded text-slate-600 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                            <PlayCircle className="w-3 h-3 text-cyan-400" />
                        </div>
                    </div>
                ))}
            </div>

            <div className="p-1.5 bg-black/40 border-t border-white/5 flex justify-between items-center shrink-0 text-[7px] text-slate-700 font-black uppercase">
                <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1"><Zap className="w-2 h-2 text-cyan-900" /> PWR:HI</span>
                    <span className="flex items-center gap-1"><Radio className="w-2 h-2 text-pink-900" /> LINK:STABLE</span>
                </div>
                <span>READY.</span>
            </div>
        </div>
    );
};

export default SdEmulator;
