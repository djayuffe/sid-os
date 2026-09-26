import React from 'react';
// Added Microscope to imports
import { BookOpen, FileJson, Cpu, Zap, Binary, Activity, ShieldCheck, Box, Microscope } from 'lucide-react';

export const FormatDocs: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto space-y-12 animate-in slide-in-from-bottom-4 duration-700 pb-20">
      <section className="space-y-4">
        <h2 className="text-3xl font-black text-white italic uppercase tracking-tighter flex items-center gap-4">
            <BookOpen className="w-8 h-8 text-cyan-500" /> Technical Specification
        </h2>
        <p className="text-slate-400 font-mono text-sm leading-relaxed">
            The SID PRO JSON Export format is designed for 100% bit-correct hardware reproducibility. 
            It captures not just register values, but the internal "silicon-level" state of the SID 6581/8580 chips 
            at every hardware frame interval.
        </p>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-8 space-y-4">
              <div className="flex items-center gap-3 text-cyan-400">
                  <FileJson className="w-5 h-5" />
                  <h3 className="text-sm font-black uppercase tracking-widest">Global Meta</h3>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                  Contains the original SID header, C64 engine configuration (ROM versions, bus persistence), 
                  and high-level musical analysis (BPM, Key).
              </p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-8 space-y-4">
              <div className="flex items-center gap-3 text-purple-400">
                  <Binary className="w-5 h-5" />
                  <h3 className="text-sm font-black uppercase tracking-widest">Write Log</h3>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                  A chronological array of every hardware register write, timestamped to the exact 
                  C64 CPU cycle. Essential for event-driven synthesis.
              </p>
          </div>
      </div>

      <section className="space-y-6">
        <div className="flex items-center gap-3">
            <Box className="w-6 h-6 text-emerald-500" />
            <h3 className="text-xl font-black text-white uppercase tracking-tighter">The Frame Snapshot</h3>
        </div>
        
        <div className="bg-slate-950 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
            <div className="bg-slate-900 p-4 border-b border-slate-800 flex justify-between items-center px-8">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Frame Object Schema</span>
                <span className="text-[10px] font-mono text-cyan-500">application/json</span>
            </div>
            <pre className="p-8 text-[11px] font-mono leading-relaxed overflow-x-auto text-cyan-100/80">
{`{
  "frame": 0,           // Sequence index
  "time": 0.02,        // Playback timestamp in seconds
  "cycles": 19702,     // Absolute CPU cycles elapsed
  "chips": [
    {
      "voices": [
        {
          "freqHz": 440.0,
          "midiNote": 69.0,
          "oscillator": {
            "accumulator": 1677721, // 24-bit internal phase
            "shiftRegister": 71239, // 23-bit Noise LFSR state
            "waveOutput": 2048      // Pre-DAC bit-sum
          },
          "envelopeGen": {
            "envelopeCounter": 255, // 8-bit ADSR output
            "state": "decay"        // Hardware phase
          }
        }, ...
      ],
      "registers": [ ... ] // Complete 29-byte mirror
    }
  ]
}`}
            </pre>
        </div>
      </section>

      <section className="bg-cyan-500/5 border border-cyan-500/20 rounded-[3rem] p-10 space-y-8">
        <div className="flex items-center gap-4">
            <div className="p-3 bg-cyan-600 rounded-2xl shadow-xl">
                <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <div>
                <h3 className="text-xl font-black text-white uppercase tracking-tighter">Cycle-Exact Playability</h3>
                <p className="text-xs text-cyan-600 font-bold uppercase tracking-widest">Zero-Drift Reconstruction Guide</p>
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            <div className="space-y-4">
                <div className="flex items-center gap-2 text-white">
                    <Zap className="w-4 h-4 text-yellow-400" />
                    <h4 className="text-xs font-black uppercase">Phase Alignment</h4>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                    By providing the <code className="text-cyan-400">accumulator</code> (24-bit), we eliminate the need 
                    to "guess" the starting phase. A playback engine should seed its oscillator with this value at 
                    every frame to prevent harmonic drift over long durations.
                </p>
            </div>

            <div className="space-y-4">
                <div className="flex items-center gap-2 text-white">
                    <Activity className="w-4 h-4 text-purple-400" />
                    <h4 className="text-xs font-black uppercase">Noise Determinism</h4>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                    SID Noise is generated via a 23-bit LFSR. To perfectly replicate specific C64 tracks (especially percussion), 
                    the <code className="text-cyan-400">shiftRegister</code> value must be exact. This allows for the 
                    "identical" noise sequence used by the original hardware.
                </p>
            </div>

            <div className="space-y-4">
                <div className="flex items-center gap-2 text-white">
                    <Cpu className="w-4 h-4 text-red-400" />
                    <h4 className="text-xs font-black uppercase">ADSR Precision</h4>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                    Capturing <code className="text-cyan-400">envelopeCounter</code> handles hardware-specific ADSR 
                    glitches (like the "buggy" 6581 sustain bug or ADSR-delay) that simple register logs often miss.
                </p>
            </div>

            <div className="space-y-4">
                <div className="flex items-center gap-2 text-white">
                    <Microscope className="w-4 h-4 text-blue-400" />
                    <h4 className="text-xs font-black uppercase">Snapshot Synthesis</h4>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                    This format allows for "Random Access" playback. You can seek to any frame and immediately 
                    reconstruct the audio state without running the emulation from frame zero.
                </p>
            </div>
        </div>
      </section>
    </div>
  );
};