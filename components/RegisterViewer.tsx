
import React from 'react';
import { SidChipState } from './sid/SidTypes';

interface RegisterViewerProps {
  chipStates: SidChipState[];
  frameIndex: number;
}

export const RegisterViewer: React.FC<RegisterViewerProps> = ({ chipStates, frameIndex }) => {
  const getRegName = (idx: number) => {
    const names = [
      'V1_FREQL', 'V1_FREQH', 'V1_PWL', 'V1_PWH', 'V1_CTRL', 'V1_ATDC', 'V1_SURE',
      'V2_FREQL', 'V2_FREQH', 'V2_PWL', 'V2_PWH', 'V2_CTRL', 'V2_ATDC', 'V2_SURE',
      'V3_FREQL', 'V3_FREQH', 'V3_PWL', 'V3_PWH', 'V3_CTRL', 'V3_ATDC', 'V3_SURE',
      'FC_L', 'FC_H', 'RES_FILT', 'MODE_VOL', 'POTX', 'POTY', 'OSC3', 'ENV3'
    ];
    return names[idx] || `REG_${idx.toString(16).toUpperCase()}`;
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 shadow-2xl backdrop-blur-md">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-sm font-black text-slate-400 uppercase tracking-[0.2em]">Hardware Register Map</h3>
        <div className="px-4 py-1.5 bg-black/40 rounded-full border border-slate-800 text-[10px] font-mono text-cyan-500">
           SNAPSHOT FRAME: {frameIndex.toString().padStart(5, '0')}
        </div>
      </div>
      
      <div className="space-y-8">
        {chipStates.map((chip, cIdx) => (
          <div key={cIdx} className="space-y-3 animate-in fade-in slide-in-from-left-2 duration-500">
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-800 to-transparent" />
              <div className="text-[10px] font-black text-cyan-400 uppercase tracking-[0.3em] flex items-center gap-2 px-4 py-1 bg-cyan-950/20 rounded-full border border-cyan-500/20">
                SID CHIP {cIdx + 1} ($D{ (0xD4 + (cIdx * 0x01)).toString(16).toUpperCase() }00 Mirror)
              </div>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-800 to-transparent" />
            </div>
            
            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
              {chip.registers.slice(0, 29).map((val, rIdx) => {
                const isCtrl = rIdx % 7 === 4 && rIdx < 21;
                const isEnv = rIdx % 7 >= 5 && rIdx < 21;
                
                return (
                  <div 
                    key={rIdx} 
                    className={`flex flex-col items-center p-2 rounded-xl border transition-all duration-300 group ${
                      val > 0 ? 'bg-slate-800/40 border-slate-700/50 shadow-lg' : 'bg-slate-950/50 border-slate-900/50 opacity-40'
                    } hover:scale-105 hover:border-cyan-500/50 hover:opacity-100 cursor-help relative overflow-hidden`}
                    title={`${getRegName(rIdx)}: ${val} ($${val.toString(16).toUpperCase().padStart(2, '0')})`}
                  >
                    {isCtrl && val > 0 && <div className="absolute top-0 right-0 w-1 h-full bg-cyan-500/50" />}
                    {isEnv && val > 0 && <div className="absolute top-0 right-0 w-1 h-full bg-purple-500/50" />}
                    
                    <span className="text-[7px] text-slate-500 font-bold mb-1 group-hover:text-slate-300 uppercase truncate w-full text-center tracking-tighter">
                      {getRegName(rIdx)}
                    </span>
                    <span className={`text-xs font-mono font-black ${val > 0 ? 'text-white' : 'text-slate-700'}`}>
                      {val.toString(16).toUpperCase().padStart(2, '0')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
