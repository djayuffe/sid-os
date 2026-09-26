
import React from 'react';
import { Cpu, Upload, AlertTriangle, FileCode, DownloadCloud } from 'lucide-react';
import { C64Config } from './sid/SidTypes';
import { SystemLogger } from '../services/Logger';

interface C64SettingsProps {
  config: C64Config;
  onConfigChange: (newConfig: C64Config) => void;
}

export const C64Settings: React.FC<C64SettingsProps> = ({ config, onConfigChange }) => {
  
  const handleRomUpload = async (type: 'kernal' | 'basic' | 'chargen', file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      onConfigChange({
        ...config,
        roms: {
          ...config.roms,
          [type]: bytes
        }
      });
      SystemLogger.log('Settings', `Loaded ${type.toUpperCase()} ROM (${bytes.length} bytes)`, 'info');
    } catch (e) {
      SystemLogger.log('Settings', "Failed to load ROM", 'error', e);
    }
  };

  const fetchOnlineRoms = async () => {
      const mirrors = [
          {
              name: 'Zimmers.net (Official Stable)',
              urls: [
                  'https://www.zimmers.net/anonftp/pub/cbm/firmware/computers/c64/kernal.901227-03.bin',
                  'https://www.zimmers.net/anonftp/pub/cbm/firmware/computers/c64/basic.901226-01.bin',
                  'https://www.zimmers.net/anonftp/pub/cbm/firmware/computers/c64/characters.901225-01.bin'
              ]
          },
          {
              name: 'Mist64 (GitHub - Main)',
              urls: [
                  'https://raw.githubusercontent.com/mist64/c64roms/master/bin/kernal.901227-03.bin',
                  'https://raw.githubusercontent.com/mist64/c64roms/master/bin/basic.901226-01.bin',
                  'https://raw.githubusercontent.com/mist64/c64roms/master/bin/characters.901225-01.bin'
              ]
          }
      ];

      const loadSet = async (urls: string[]) => {
          const [k, b, c] = await Promise.all(urls.map(async u => {
              const res = await fetch(u);
              if (!res.ok) throw new Error(`${res.status} for ${u}`);
              const buf = await res.arrayBuffer();
              const arr = new Uint8Array(buf);
              if (arr.length > 20) {
                  const start = String.fromCharCode(...arr.slice(0, 15)).toLowerCase();
                  if (start.includes('<!doctype') || start.includes('<html')) {
                      throw new Error(`Fetched content for ${u.split('/').pop()} is HTML/404, not binary.`);
                  }
              }
              return arr;
          }));
          return { kernal: k, basic: b, chargen: c };
      };

      for (const mirror of mirrors) {
          try {
              SystemLogger.log('Settings', `Fetching from ${mirror.name}...`, 'info');
              const roms = await loadSet(mirror.urls);
              
              onConfigChange({ ...config, roms });
              SystemLogger.log('Settings', `Success: ROMs loaded from ${mirror.name}`, 'info');
              return;
          } catch (e: any) {
              SystemLogger.log('Settings', `Mirror failed: ${mirror.name} (${e.message})`, 'warn');
          }
      }
      SystemLogger.log('Settings', 'All auto-fetch attempts failed. Please load ROMs manually.', 'error');
  };

  const getRomStatus = (rom?: Uint8Array) => {
    if (!rom) return <span className="text-slate-500 italic">Not Loaded</span>;
    return <span className="text-green-400 font-mono text-xs">{rom.length} bytes</span>;
  };

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-md transition-all hover:border-slate-700/80">
      <h2 className="text-xl font-bold mb-6 flex items-center gap-3 text-orange-400">
        <div className="p-2 bg-orange-500/10 rounded-lg"><Cpu className="w-5 h-5" /></div>
        <span>System Setup</span>
      </h2>

      <div className="space-y-6">
        <div className="space-y-3">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Video Standard Override</label>
          <div className="grid grid-cols-3 gap-2">
            {(['AUTO', 'PAL', 'NTSC'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => onConfigChange({ ...config, forceStandard: mode })}
                className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                  config.forceStandard === mode 
                    ? 'bg-orange-600 text-white shadow-lg shadow-orange-500/20' 
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800 flex items-start gap-3">
            <input 
              type="checkbox" 
              checked={config.enableHle} 
              onChange={e => onConfigChange({...config, enableHle: e.target.checked})}
              className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900 text-orange-500 focus:ring-orange-500"
            />
            <div className="flex-1">
              <span className="block text-sm font-bold text-slate-300">Enable High Level Emulation (HLE)</span>
              <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                Uses built-in traps for KERNAL/BASIC routines. Recommended for PSID files.
                Disable this and load real ROMs for accuracy with complex RSID files like Das Boot.
              </p>
            </div>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between items-center">
             <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">System ROMs</label>
             <button 
                onClick={fetchOnlineRoms}
                className="flex items-center gap-1.5 text-[10px] font-bold text-cyan-400 bg-cyan-950/30 px-2 py-1 rounded border border-cyan-800 hover:bg-cyan-900/50 hover:border-cyan-500 transition-all"
                title="Fetch standard ROMs from stable mirrors"
             >
                 <DownloadCloud className="w-3 h-3" /> Auto-Fetch ROMs
             </button>
          </div>
          
          {[
            { id: 'kernal', label: 'KERNAL ($E000)' },
            { id: 'basic', label: 'BASIC ($A000)' },
            { id: 'chargen', label: 'CHARGEN ($D000)' }
          ].map(rom => (
            <div key={rom.id} className="flex items-center justify-between bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="flex items-center gap-3">
                <FileCode className="w-4 h-4 text-slate-600" />
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-300">{rom.label}</span>
                  {getRomStatus(config.roms[rom.id as keyof typeof config.roms])}
                </div>
              </div>
              <div className="relative group">
                <input 
                  type="file" 
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onChange={(e) => e.target.files?.[0] && handleRomUpload(rom.id as any, e.target.files[0])} 
                />
                <button className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold rounded flex items-center gap-2 transition-colors">
                  <Upload className="w-3 h-3" /> Load
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
