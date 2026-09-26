
import React from 'react';
import { Keyboard, Music, Disc, Layers, Edit } from 'lucide-react';

interface HelpModalProps {
    onClose: () => void;
}

const HelpModal: React.FC<HelpModalProps> = ({ onClose }) => {
    const Section = ({ title, icon, children }: any) => (
        <div className="mb-6">
            <h3 className="text-sm font-bold text-cyan-400 mb-3 flex items-center gap-2 border-b border-slate-800 pb-2">
                {icon} {title}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-400">
                {children}
            </div>
        </div>
    );

    const Shortcut = ({ keys, desc }: { keys: string[], desc: string }) => (
        <div className="flex justify-between items-center bg-slate-900/50 p-2 rounded border border-slate-800">
            <span className="text-slate-300">{desc}</span>
            <div className="flex gap-1">
                {keys.map((k, i) => (
                    <span key={i} className="bg-slate-800 border border-slate-600 px-1.5 py-0.5 rounded text-[10px] font-mono text-cyan-100 min-w-[20px] text-center font-bold">
                        {k}
                    </span>
                ))}
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-slate-950 border-2 border-cyan-500/50 rounded-lg shadow-[0_0_50px_rgba(34,211,238,0.2)] max-w-4xl w-full h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                
                <div className="bg-slate-900 p-4 border-b border-slate-800 flex justify-between items-center shrink-0">
                    <h2 className="text-cyan-400 font-bold tracking-widest flex items-center gap-2 text-lg">
                        <Keyboard className="w-5 h-5"/> SYSTEM MANUAL
                    </h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors text-xs font-bold bg-slate-800 px-3 py-1 rounded border border-slate-700">
                        CLOSE [ESC]
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                    
                    <Section title="GLOBAL TRANSPORT" icon={<Disc className="w-4 h-4" />}>
                        <Shortcut keys={['SPACE']} desc="Play / Pause" />
                        <Shortcut keys={['CTRL', 'L']} desc="Toggle Loop Mode" />
                        <Shortcut keys={['←', '→']} desc="Seek Timeline (Fine)" />
                        <Shortcut keys={['CTRL', '←/→']} desc="Seek Pattern (Coarse)" />
                    </Section>

                    <Section title="TRACKER EDITING" icon={<Edit className="w-4 h-4" />}>
                        <Shortcut keys={['ARROWS']} desc="Move Cursor" />
                        <Shortcut keys={['TAB']} desc="Next Channel" />
                        <Shortcut keys={['SHIFT', 'TAB']} desc="Prev Channel" />
                        <Shortcut keys={['Z', 'S', 'X', '...']} desc="Play/Enter Notes (Piano Layout)" />
                        <Shortcut keys={['1']} desc="Insert Note Off (===)" />
                        <Shortcut keys={['DEL', 'BKSP']} desc="Clear Cell" />
                        <Shortcut keys={['0-9', 'A-F']} desc="Enter Hex Values / Commands" />
                    </Section>

                    <Section title="VISUALIZER & VIEWS" icon={<Layers className="w-4 h-4" />}>
                        <Shortcut keys={['drag', 'drop']} desc="Load .JSON / .JSONL Trace File" />
                        <div className="col-span-2 text-slate-500 text-[11px] italic mt-2">
                            * The Visualizer supports two modes: STANDARD (Oscilloscope + Spectrum) and VECTOR (Lissajous X/Y).
                            <br/>
                            * Enable 'CRT' in System menu for retro effect overlay.
                        </div>
                    </Section>

                    <div className="mt-8 pt-4 border-t border-slate-800 text-center text-slate-600 text-[10px] font-mono">
                        <p className="mb-2">SID TRACE PLAYER PRO v3.1</p>
                        <p>100% Client-Side Audio Synthesis (PolyBLEP + SVF)</p>
                        <p>Strict SID-Wizard 1.1 SWM Export Support</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default HelpModal;
