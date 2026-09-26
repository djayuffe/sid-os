
import React from 'react';
import { SidChipState, SidVoiceStatus } from './sid/SidTypes';
import { Activity, Zap, Waves, Music, Fingerprint } from 'lucide-react';

interface SynthesisStateProps {
  chip: SidChipState;
  frameIndex: number;
}

export const SynthesisState: React.FC<SynthesisStateProps> = ({ chip, frameIndex }) => {
  const renderBitField = (val: number, bits: { label: string; mask: number }[]) => (
    <div className="flex gap-1 mt-1">
      {bits.map((bit, idx) => {
        const active = (val & bit.mask) !== 0;
        return (
          <div 
            key={idx} 
            title={bit.label}
            className={`text-[8px] px-1 rounded font-black border transition-all ${
              active ? 'bg-cyan-500 border-cyan-400 text-white shadow-[0_0_5px_rgba(34,211,238,0.5)]' : 'bg-slate-900 border-slate-800 text-slate-600'
            }`}
          >
            {bit.label[0]}
          </div>
        );
      })}
    </div>
  );

  const getWaveName = (wf: number) => {
    const names = [];
    if (wf & 0x10) names.push('Tri');
    if (wf & 0x20) names.push('Saw');
    if (wf & 0x40) names.push('Pul');
    if (wf & 0x80) names.push('Noi');
    return names.length ? names.join('+') : 'Off';
  };

  return (
    <div className="space-y-4">
      <div className="bg-cyan-500/10 border border-cyan-500/20 p-3 rounded-2xl flex items-center justify-between">
         <div className="flex items-center gap-3">
            <Fingerprint className="w-4 h-4 text-cyan-500" />
            <span className="text-[10px] font-black uppercase text-cyan-400 tracking-widest">reSID 1.0 Bit-Correct Verification Engine Active</span>
         </div>
         <div className="text-[9px] font-mono text-cyan-700">TRACE_POINT: 0x{frameIndex.toString(16).toUpperCase()}</div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {chip.voices.map((v, i) => (
          <div key={i} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-4 hover:border-slate-700 transition-all group">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                 <div className={`w-2 h-2 rounded-full ${v.gate ? 'bg-cyan-500 shadow-[0_0_8px_cyan]' : 'bg-slate-800'}`} />
                 <span className="text-[10px] font-black text-slate-300 uppercase tracking-tighter">Voice 0{i+1}</span>
              </div>
              <span className={`text-[9px] font-mono px-2 py-0.5 rounded border ${
                v.state === 'attack' ? 'bg-green-950 text-green-400 border-green-900' :
                v.state === 'decay' ? 'bg-yellow-950 text-yellow-400 border-yellow-900' :
                v.state === 'sustain' ? 'bg-blue-950 text-blue-400 border-blue-900' :
                'bg-red-950 text-red-400 border-red-900'
              }`}>
                {v.state.toUpperCase()}
              </span>
            </div>

            {/* Osc Section */}
            <div className="space-y-2">
              <div className="flex justify-between items-end">
                <span className="text-[8px] font-black text-slate-500 uppercase">Oscillator [24-bit Phase]</span>
                <span className="text-xs font-mono font-bold text-cyan-400">{v.freqHz.toFixed(1)} Hz</span>
              </div>
              <div className="bg-black/40 p-2 rounded-lg border border-slate-800/50 space-y-1">
                <div className="flex justify-between text-[9px] font-mono">
                  <span className="text-slate-500">Accu:</span>
                  <span className="text-slate-400 text-[8px]">0x{v.oscillator.accumulator.toString(16).toUpperCase().padStart(6,'0')}</span>
                </div>
                <div className="flex justify-between text-[9px] font-mono">
                  <span className="text-slate-500">Wave:</span>
                  <span className="text-slate-200">{getWaveName(v.rawWaveform)}</span>
                </div>
                {renderBitField(v.rawWaveform, [
                  { label: 'Noi', mask: 0x80 }, { label: 'Pul', mask: 0x40 }, 
                  { label: 'Saw', mask: 0x20 }, { label: 'Tri', mask: 0x10 },
                  { label: 'Tst', mask: 0x08 }, { label: 'Rng', mask: 0x04 },
                  { label: 'Syc', mask: 0x02 }, { label: 'Gat', mask: 0x01 }
                ])}
              </div>
            </div>

            {/* Envelope Section */}
            <div className="space-y-2">
              <div className="flex justify-between items-end">
                <span className="text-[8px] font-black text-slate-500 uppercase">Envelope [Bit-Strict]</span>
                <span className="text-xs font-mono font-bold text-white">{Math.round(v.envelope * 100)}%</span>
              </div>
              <div className="h-1.5 w-full bg-black rounded-full overflow-hidden">
                 <div className="h-full bg-cyan-500 transition-all duration-75" style={{ width: `${v.envelope * 100}%` }} />
              </div>
              <div className="grid grid-cols-4 gap-1">
                {['A', 'D', 'S', 'R'].map((label, idx) => {
                  const val = [v.attack, v.decay, v.sustain, v.release][idx];
                  return (
                    <div key={label} className="bg-black/20 p-1 rounded border border-slate-800 text-center">
                      <div className="text-[7px] text-slate-600 font-black">{label}</div>
                      <div className="text-[9px] font-mono text-slate-400">{val.toString(16).toUpperCase()}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* LFSR Section */}
            {(v.waveform & 8) !== 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-[8px] font-black text-slate-500 uppercase">
                  <span>LFSR 23-bit Register</span>
                  <span className="text-[8px] text-cyan-600">6581 Silicon Pattern</span>
                </div>
                <div className="bg-black/40 p-1.5 rounded border border-slate-800 font-mono text-[7px] text-cyan-300 break-all leading-none">
                  {v.oscillator.shiftRegister.toString(2).padStart(23, '0')}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
