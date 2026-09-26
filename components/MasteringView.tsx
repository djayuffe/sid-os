
import React from 'react';
import MixerConsole from './MasteringMenu';
import { MasteringParams, MixerParams } from '../types';
import { Sliders } from 'lucide-react';

interface MasteringViewProps {
    params: MasteringParams;
    onUpdate: (p: MasteringParams) => void;
    mixerParams: MixerParams;
    onUpdateMixer: (p: MixerParams) => void;
    player: any;
}

const MasteringView: React.FC<MasteringViewProps> = (props) => {
    return (
        <div className="w-full h-full flex flex-col bg-[#010204]">
            {/* Header */}
            <div className="h-12 bg-slate-900 border-b border-slate-800 flex items-center px-6 gap-4 shrink-0">
                <div className="p-2 bg-indigo-500/10 rounded-lg border border-indigo-500/30">
                    <Sliders className="w-5 h-5 text-indigo-400" />
                </div>
                <div className="flex flex-col">
                    <h1 className="text-sm font-black text-white uppercase tracking-[0.3em] glow-text">Mastering Console</h1>
                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">Final Stage Processing</span>
                </div>
            </div>
            
            {/* Console Content */}
            <div className="flex-1 overflow-hidden p-6">
                <div className="w-full h-full max-w-7xl mx-auto bg-black rounded-3xl border border-white/10 shadow-2xl overflow-hidden relative">
                    <MixerConsole 
                        params={props.params}
                        onUpdate={props.onUpdate}
                        mixerParams={props.mixerParams}
                        onUpdateMixer={props.onUpdateMixer}
                        onClose={() => {}} // Close button hidden or handled by main menu
                        player={props.player}
                    />
                </div>
            </div>
        </div>
    );
};

export default MasteringView;
