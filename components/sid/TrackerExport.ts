
import { SidDump } from './SidTypes';

export class TrackerExporter {
  public static export(dump: SidDump): string {
    const fps = dump.metadata?.isNtsc ? 60 : 50;
    const lines: string[] = [];
    const chipCount = dump.metadata.sidCount;
    
    // Header
    lines.push(`; SID Tracker Export for "${dump.metadata?.title || 'Unknown'}"`);
    lines.push(`; Author: ${dump.metadata?.author || 'Unknown'}`);
    lines.push(`; Released: ${dump.metadata?.released || 'Unknown'}`);
    lines.push(`; Clock: ${fps}Hz`);
    lines.push(`; Config: ${chipCount}x SID Chips`);
    lines.push('');
    
    // Build Column Header
    let headerLine = '; Format: ROW |';
    for(let c=0; c<chipCount; c++) {
        headerLine += ` SID${c+1} V1  | SID${c+1} V2  | SID${c+1} V3  |`;
    }
    lines.push(headerLine);
    lines.push('; --------------------------------------------------------------------------------------');

    const framesPerRow = 6; 
    const rowCount = Math.floor(dump.frames.length / framesPerRow);

    for (let r = 0; r < rowCount; r++) {
      const frameIdx = r * framesPerRow;
      const frame = dump.frames[frameIdx];
      
      const rowStr = r.toString(16).toUpperCase().padStart(3, '0');
      let line = `${rowStr} |`;

      for(let c=0; c<chipCount; c++) {
          const chip = frame.chips[c];
          for (let v = 0; v < 3; v++) {
            const voice = chip.voices[v];
            
            // Note Detection
            let noteStr = '...';
            if (voice.gate && voice.midiNote > 0) {
                const notes = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"];
                const n = Math.round(voice.midiNote);
                const oct = Math.floor(n / 12) - 1;
                const semi = n % 12;
                const noteName = (semi >= 0 && semi < 12) ? notes[semi] : '??';
                noteStr = `${noteName}${oct}`;
            } else if (!voice.gate) {
                noteStr = '---'; // Key Off
            }

            // Instrument (Waveform Nibble + Flags)
            // Format: W (Wave) + R (Ring) + S (Sync)
            const waveChar = voice.waveform.toString(16).toUpperCase();
            
            // Command (Filter Cutoff Hi-Byte)
            const cmdStr = (chip.filter.cutoff >> 4).toString(16).toUpperCase().padStart(2, '0');

            line += ` ${noteStr.padEnd(3)} ${waveChar} ${cmdStr} |`;
          }
      }
      lines.push(line);
    }

    return lines.join('\n');
  }
}
