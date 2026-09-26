
import React from 'react';
import { InstrumentAnalysis } from './analysis';
import { Music, Activity, Disc, Zap, Binary } from 'lucide-react';

interface SongSummaryProps {
  analysis: InstrumentAnalysis;
}

export const SongSummary: React.FC<SongSummaryProps> = ({ analysis }) => {
  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 backdrop-blur-sm animate-in fade-in duration-1000">
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Left Stats */}
        <div className="flex flex-wrap gap-4 items-center">
           <div className="bg-[#020617] px-6 py-4 rounded-2xl border border-slate-800 flex items-center gap-4 group hover:border-cyan-500/30 transition-all">
              <Activity className="w-5 h-5 text-cyan-500" />
              <div>
                <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest">Est. BPM</span>
                <span className="text-xl font-black text-white">{Math.round(analysis.estimatedBpm)}</span>
              </div>
           </div>
           <div className="bg-[#020617] px-6 py-4 rounded-2xl border border-slate-800 flex items-center gap-4 group hover:border-purple-500/30 transition-all">
              <Music className="w-5 h-5 text-purple-500" />
              <div>
                <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest">Key Class</span>
                <span className="text-xl font-black text-white">{analysis.keySignature}</span>
              </div>
           </div>
        </div>

        {/* Suggested Instruments */}
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {analysis.suggestedInstruments.slice(0, 3).map((inst, idx) => (
             <div key={idx} className="bg-[#020617]/50 p-3 px-4 rounded-2xl border border-slate-800 flex items-center gap-4">
                <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-[10px] font-black text-slate-400">
                   V{idx+1}
                </div>
                <div>
                   <span className="block text-[7px] font-black text-slate-600 uppercase">Suggested Patch</span>
                   <span className="text-[11px] font-bold text-slate-200 truncate block max-w-[120px]">{inst.name}</span>
                </div>
             </div>
          ))}
        </div>
      </div>
    </div>
  );
};
