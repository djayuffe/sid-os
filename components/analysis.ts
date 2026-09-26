
import { SidDump } from './sid/SidTypes';

export interface InstrumentStats {
  waveformUsage: { [key: number]: number }; 
  avgPitch: number;
  pitchRange: [number, number];
  avgAttack: number;
  avgDecay: number;
  avgSustain: number;
  avgRelease: number;
  pulseWidthVariance: number;
  avgPulseWidth: number;
  isArpeggiated: boolean;
  activeFrames: number;
  noiseTypeDistribution: { low: number, mid: number, high: number };
  ringModUsage: number; 
  syncUsage: number;    
}

export interface InstrumentAnalysis {
  voices: InstrumentStats[];
  estimatedBpm: number;
  keySignature: string;
  suggestedInstruments: { program: number; name: string }[];
}

const KS_PROFILE_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_PROFILE_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export class SidAnalyzer {
  
  public static analyze(dump: SidDump): InstrumentAnalysis {
    const voices: InstrumentStats[] = [];
    const chipCount = dump.metadata.sidCount;
    const pitchHistogram = new Array(12).fill(0);

    for(let c=0; c<chipCount; c++) {
        for(let v=0; v<3; v++) {
          const stats: InstrumentStats = {
            waveformUsage: {}, avgPitch: 0, pitchRange: [128, 0],
            avgAttack: 0, avgDecay: 0, avgSustain: 0, avgRelease: 0,
            pulseWidthVariance: 0, avgPulseWidth: 2048,
            isArpeggiated: false, activeFrames: 0,
            noiseTypeDistribution: { low: 0, mid: 0, high: 0 },
            ringModUsage: 0, syncUsage: 0
          };
          
          let totalPitch = 0; let noteCount = 0;
          let pulseWidths: number[] = [];
          let lastNote = -1; let arpIntervals: number[] = [];

          dump.frames.forEach(frame => {
            const state = frame.chips[c].voices[v];
            if (state.envelope > 0.002) { // Lowered threshold for subtle modulation
               stats.activeFrames++;
               const wf = state.waveform;
               stats.waveformUsage[wf] = (stats.waveformUsage[wf] || 0) + 1;
               if (state.ringMod) stats.ringModUsage++;
               if (state.sync) stats.syncUsage++;

               if (state.gate) {
                   stats.avgAttack += state.attack; stats.avgDecay += state.decay;
                   stats.avgSustain += state.sustain; stats.avgRelease += state.release;
               }
               
               if (state.midiNote > 0 && !(state.rawWaveform & 0x80)) {
                   totalPitch += state.midiNote;
                   stats.pitchRange[0] = Math.min(stats.pitchRange[0], state.midiNote);
                   stats.pitchRange[1] = Math.max(stats.pitchRange[1], state.midiNote);
                   noteCount++;
                   const pitchClass = Math.round(state.midiNote) % 12;
                   if (pitchClass >= 0) pitchHistogram[pitchClass]++;
                   if (lastNote !== -1 && Math.abs(state.midiNote - lastNote) > 0.1) arpIntervals.push(Math.abs(state.midiNote - lastNote));
                   lastNote = state.midiNote;
               }
               if (state.waveform & 4) pulseWidths.push(state.pulse);
               if (state.noiseType) {
                   if (state.noiseType === 'low') stats.noiseTypeDistribution.low++;
                   else if (state.noiseType === 'mid') stats.noiseTypeDistribution.mid++;
                   else if (state.noiseType === 'high') stats.noiseTypeDistribution.high++;
               }
            }
          });

          if (stats.activeFrames > 0) {
              if (noteCount > 0) stats.avgPitch = totalPitch / noteCount;
              const gateHighFrames = dump.frames.filter(f => f.chips[c].voices[v].gate && f.chips[c].voices[v].envelope > 0.01).length;
              if (gateHighFrames > 0) {
                  stats.avgAttack /= gateHighFrames; stats.avgDecay /= gateHighFrames;
                  stats.avgSustain /= gateHighFrames; stats.avgRelease /= gateHighFrames;
              }
              stats.ringModUsage /= stats.activeFrames; stats.syncUsage /= stats.activeFrames;
          }
          if (pulseWidths.length > 10) {
              let sum = 0; let count = 0;
              for(let i=0; i<pulseWidths.length; i+=10) { sum+=pulseWidths[i]; count++; }
              const avgPW = sum / count; stats.avgPulseWidth = avgPW;
              let variance = 0;
              for(let i=0; i<pulseWidths.length; i+=10) variance += Math.pow(pulseWidths[i] - avgPW, 2);
              stats.pulseWidthVariance = Math.sqrt(variance / count);
          }
          if (arpIntervals.length > 10) {
              const arpMatches = arpIntervals.filter(i => [3,4,5,7,12].some(x => Math.abs(i-x) < 0.2)).length;
              if (arpMatches / arpIntervals.length > 0.3) stats.isArpeggiated = true;
          }
          voices.push(stats);
      }
    }

    return {
      voices,
      estimatedBpm: 120,
      keySignature: this.detectKey(pitchHistogram),
      suggestedInstruments: voices.map(v => this.mapToGeneralMidi(v))
    };
  }

  private static mapToGeneralMidi(stats: InstrumentStats): { program: number; name: string } {
      if (stats.activeFrames < 5) return { program: 0, name: "Piano (Silent)" };
      let maxCount = 0; let primaryWave = 0;
      for (const [wf, count] of Object.entries(stats.waveformUsage)) { if (count > maxCount) { maxCount = count; primaryWave = parseInt(wf); } }
      const isBass = stats.avgPitch < 48; const isHigh = stats.avgPitch >= 72;
      if ((primaryWave & 8)) return { program: 118, name: "Synth Drum/Noise" };
      if (stats.ringModUsage > 0.4) return { program: 112, name: "Bell" };
      if ((primaryWave & 4)) return { program: 80, name: isBass ? "Synth Bass" : "Square Lead" };
      return { program: 81, name: isHigh ? "Saw Lead" : "Synth String" };
  }

  private static detectKey(histogram: number[]): string {
      if (histogram.reduce((a,b)=>a+b, 0) === 0) return "Unknown";
      let bestKey = "C Major"; let maxCorrelation = -Infinity;
      const sum = histogram.reduce((a, b) => a + b, 0);
      const normHist = histogram.map(v => v / sum);
      for (let i = 0; i < 12; i++) {
          let correlation = 0;
          for (let j = 0; j < 12; j++) correlation += normHist[(i + j) % 12] * KS_PROFILE_MAJOR[j];
          if (correlation > maxCorrelation) { maxCorrelation = correlation; bestKey = `${NOTE_NAMES[i]} Major`; }
      }
      return bestKey;
  }
}
