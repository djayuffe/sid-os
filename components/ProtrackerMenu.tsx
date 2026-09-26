
import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, Binary, Sliders, Monitor, 
  Grid, Piano, Clock, HelpCircle, 
  Play, Pause, Square, Disc, Settings, Volume2, Eye, Layout, Maximize, AppWindow, Power,
  Database, FileCode, Image as ImageIcon, Box, Sparkles, Music, Activity
} from 'lucide-react';
import { LfoConfig } from '../types';
import { CLOCK_PAL, CLOCK_NTSC } from '../services/sidService';

interface ProtrackerMenuProps {
  onLoad: () => void;
  onExportJson: () => void;
  onExportProject: () => void;
  onExportSwm: () => void;
  onExportWav: () => void;
  onExportMidi: () => void;
  onExportSid?: () => void;
  onHelp: () => void;
  onSettings: () => void;
  onPatternTools: () => void;
  onOpenMixer: () => void; 
  viewMode: string;
  setViewMode: (m: 'TRACKER' | 'INSTRUMENTS' | 'MEM' | 'ALBUM' | 'VISUALIZER' | 'LOGO' | 'MASTERING' | 'HYPER' | 'ARP' | 'PIANO' | 'DRSID') => void;
  vizMode: string;
  setVizMode: (m: 'STANDARD' | 'VECTOR' | 'FLUX') => void;
  crtEnabled: boolean;
  setCrtEnabled: (v: boolean) => void;
  clockFreq: number;
  setClockFreq: (f: number) => void;
  lfoConfig: LfoConfig;
  setLfoConfig: (c: LfoConfig) => void;
  traceLoaded: boolean;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStop: () => void;
  playbackSpeed: number;
  setPlaybackSpeed: (s: number) => void;
  volume: number;
  setVolume: (v: number) => void;
  hqEnabled?: boolean;
  setHqEnabled?: (v: boolean) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  editorStep: number;
  setEditorStep: (s: number) => void;
}

const PtButton: React.FC<{ label: string, active?: boolean, onClick: (e: React.MouseEvent) => void, icon?: React.ReactNode, disabled?: boolean, sub?: string }> = ({ label, active, onClick, icon, disabled, sub }) => (
    <button 
        onClick={onClick} 
        disabled={disabled}
        aria-label={label || 'Stop playback'}
        title={label || 'Stop playback'}
        className={`
            relative h-8 px-2 flex flex-col items-center justify-center border-b transition-all active:border-b-0 active:translate-y-[0.5px] rounded
            ${active 
                ? 'bg-cyan-500 text-black border-cyan-700' 
                : 'bg-slate-900 border-black text-slate-500 hover:bg-slate-800 hover:text-slate-300'
            }
            ${disabled ? 'opacity-20 cursor-not-allowed grayscale' : ''}
        `}
    >
        <div className="flex items-center gap-1.5 font-black text-[7px] tracking-widest uppercase text-nowrap">
            {icon && <span className={active ? 'text-black' : 'text-cyan-600'}>{icon}</span>}
            {label}
        </div>
        {sub && <div className={`text-[6px] font-black mt-0.5 ${active ? 'text-cyan-900' : 'text-slate-600'}`}>{sub}</div>}
    </button>
);

const PtGroup: React.FC<{ label: string, children: React.ReactNode }> = ({ label, children }) => (
    <div className="bg-black/30 border border-white/5 p-0.5 flex gap-1 relative pt-2.5 rounded-md">
        <div className="absolute top-0 left-1.5 px-1 text-[5px] text-slate-600 font-black uppercase tracking-widest">{label}</div>
        {children}
    </div>
);

const ProtrackerMenu: React.FC<ProtrackerMenuProps> = (props) => {
    const [vizMenuOpen, setVizMenuOpen] = useState(false);
    const [volumeMenuOpen, setVolumeMenuOpen] = useState(false);
    const volRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (volRef.current && !volRef.current.contains(event.target as Node)) {
                setVolumeMenuOpen(false);
            }
        };
        if (volumeMenuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [volumeMenuOpen]);

    return (
        <div className="w-full bg-[#0a0c10] border-t border-white/5 select-none flex flex-col shadow-xl relative z-[1000]">
            <div className="h-5 bg-slate-900 flex items-center justify-between px-3 text-[7px] font-mono text-slate-800">
                <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${props.isPlaying ? 'bg-red-500 animate-pulse' : 'bg-slate-900'}`}></div>
                    <span className="font-black tracking-[0.4em] uppercase">SID_OS::<span className="text-cyan-950">AUDIO_LINK</span></span>
                </div>
                <div className="flex items-center gap-4">
                    <span className="tracking-widest opacity-30">WEB_AUDIO</span>
                    <span className={props.isPlaying ? "text-emerald-950 font-black" : "opacity-20"}>{props.isPlaying ? "PLAYBACK_ACTIVE" : "READY"}</span>
                </div>
            </div>

            <div className="p-1 flex flex-wrap gap-1.5 items-center">
                <PtGroup label="DISK">
                    <PtButton label="LOAD" icon={<Upload className="w-2.5 h-2.5"/>} onClick={props.onLoad} />
                    <PtButton label="SAVE" icon={<Binary className="w-2.5 h-2.5"/>} onClick={props.onExportProject} disabled={!props.traceLoaded} />
                    <PtButton label="SWM" icon={<FileCode className="w-2.5 h-2.5"/>} onClick={props.onExportSwm} disabled={!props.traceLoaded} />
                    <PtButton label="DUMP" icon={<Database className="w-2.5 h-2.5"/>} onClick={props.onExportJson} disabled={!props.traceLoaded} />
                    {props.onExportSid && (
                        <PtButton label="SID" icon={<FileCode className="w-2.5 h-2.5"/>} onClick={props.onExportSid} disabled={!props.traceLoaded} />
                    )}
                </PtGroup>

                <PtGroup label="EDIT">
                    <PtButton label="TRACK" icon={<Grid className="w-2.5 h-2.5"/>} active={props.viewMode === 'TRACKER'} onClick={() => props.setViewMode('TRACKER')} />
                    <PtButton label="PIANO" icon={<Music className="w-2.5 h-2.5"/>} active={props.viewMode === 'PIANO'} onClick={() => props.setViewMode('PIANO')} disabled={!props.traceLoaded} />
                    <PtButton label="INST" icon={<Piano className="w-2.5 h-2.5"/>} active={props.viewMode === 'INSTRUMENTS'} onClick={() => props.setViewMode('INSTRUMENTS')} />
                    <PtButton label="TOOLS" icon={<Sliders className="w-2.5 h-2.5"/>} onClick={props.onPatternTools} disabled={props.viewMode !== 'TRACKER'} />
                    <div className="flex flex-col items-center justify-center px-1">
                        <span className="text-[5px] text-slate-500 font-bold">STEP</span>
                        <input 
                            type="number" min="0" max="16" 
                            value={props.editorStep} 
                            onChange={(e) => props.setEditorStep(parseInt(e.target.value)||0)}
                            className="w-6 h-3 bg-slate-900 border border-slate-700 text-[8px] text-center text-cyan-400 rounded focus:border-cyan-500 outline-none"
                        />
                    </div>
                </PtGroup>

                <PtGroup label="KERN">
                    <div className="relative">
                        <PtButton label="VIZ" icon={<Eye className="w-2.5 h-2.5"/>} onClick={() => setVizMenuOpen(!vizMenuOpen)} sub={props.vizMode} />
                        {vizMenuOpen && (
                            <div className="absolute bottom-full left-0 mb-1 w-24 bg-slate-950 border border-white/5 shadow-2xl p-0.5 z-[2000] flex flex-col gap-0.5 rounded animate-in fade-in slide-in-from-bottom-1">
                                {['STANDARD', 'VECTOR', 'FLUX'].map(m => (
                                    <button 
                                        key={m} 
                                        onClick={() => { props.setVizMode(m as any); setVizMenuOpen(false); }}
                                        className={`px-2 py-1 text-[7px] font-black text-left hover:bg-slate-900 transition-all rounded ${props.vizMode === m ? 'text-cyan-500 bg-cyan-500/5' : 'text-slate-700'}`}
                                    >
                                        {m}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <PtButton label="DR.SID" icon={<Disc className="w-2.5 h-2.5"/>} active={props.viewMode === 'DRSID'} onClick={() => props.setViewMode('DRSID')} />
                    <PtButton label="HYPER" icon={<Sparkles className="w-2.5 h-2.5"/>} active={props.viewMode === 'HYPER'} onClick={() => props.setViewMode('HYPER')} />
                    <PtButton label="ARP" icon={<Activity className="w-2.5 h-2.5"/>} active={props.viewMode === 'ARP'} onClick={() => props.setViewMode('ARP')} />
                    <PtButton label="LOGO" icon={<Box className="w-2.5 h-2.5"/>} active={props.viewMode === 'LOGO'} onClick={() => props.setViewMode('LOGO')} />
                    <PtButton label="ART" icon={<ImageIcon className="w-2.5 h-2.5"/>} active={props.viewMode === 'ALBUM'} onClick={() => props.setViewMode('ALBUM')} />
                    <PtButton label="CRT" icon={<Monitor className="w-2.5 h-2.5"/>} active={props.crtEnabled} onClick={() => props.setCrtEnabled(!props.crtEnabled)} />
                    <PtButton label="MIX" icon={<Sliders className="w-2.5 h-2.5"/>} active={props.viewMode === 'MASTERING'} onClick={() => props.setViewMode('MASTERING')} />
                </PtGroup>

                <PtGroup label="LINK">
                    <PtButton label="" icon={<Square className="w-2.5 h-2.5 fill-current"/>} onClick={props.onStop} disabled={!props.traceLoaded} />
                    <PtButton label={props.isPlaying ? "PAUSE" : "PLAY"} active={props.isPlaying} icon={props.isPlaying ? <Pause className="w-2.5 h-2.5 fill-current"/> : <Play className="w-2.5 h-2.5 fill-current"/>} onClick={props.onTogglePlay} disabled={!props.traceLoaded} />
                    <PtButton label="SPD" sub={`${props.playbackSpeed}×`} onClick={() => {
                        const speeds = [0.5, 1, 1.5, 2];
                        const next = speeds[(speeds.indexOf(props.playbackSpeed) + 1) % speeds.length];
                        props.setPlaybackSpeed(next);
                    }} disabled={!props.traceLoaded} />
                    <PtButton label="WAV" icon={<Disc className="w-2.5 h-2.5 text-red-800 fill-current"/>} onClick={props.onExportWav} disabled={!props.traceLoaded} />
                </PtGroup>

                <div className="flex-1"></div>

                <PtGroup label="HOST">
                    <PtButton label={props.clockFreq === CLOCK_PAL ? "PAL" : "NTSC"} onClick={() => props.setClockFreq(props.clockFreq === CLOCK_PAL ? CLOCK_NTSC : CLOCK_PAL)} />
                    <div className="relative" ref={volRef}>
                        <PtButton 
                            label="VOL" 
                            icon={<Volume2 className="w-2.5 h-2.5"/>} 
                            onClick={(e) => { e.stopPropagation(); setVolumeMenuOpen(!volumeMenuOpen); }} 
                            sub={`${Math.round(props.volume * 100)}%`}
                            active={volumeMenuOpen}
                        />
                        {volumeMenuOpen && (
                            <div className="absolute bottom-full right-0 mb-1 w-10 h-32 bg-slate-900 border border-slate-700 shadow-2xl z-[2000] flex flex-col items-center justify-center rounded-lg animate-in fade-in slide-in-from-bottom-2">
                                <div className="h-24 w-full flex items-center justify-center relative">
                                    <input 
                                        type="range" min="0" max="1" step="0.01" value={props.volume} 
                                        onChange={(e) => props.setVolume(parseFloat(e.target.value))}
                                        className="absolute w-24 h-6 -rotate-90 origin-center cursor-pointer opacity-0 z-20"
                                    />
                                    <div className="w-1.5 h-full bg-slate-950 rounded-full border border-slate-800 relative overflow-hidden pointer-events-none">
                                        <div 
                                            className="absolute bottom-0 left-0 w-full bg-cyan-500 transition-all duration-75"
                                            style={{ height: `${props.volume * 100}%` }}
                                        />
                                    </div>
                                    <div 
                                        className="absolute w-3 h-3 bg-white rounded-full shadow-lg pointer-events-none border border-slate-300"
                                        style={{ bottom: `calc(${props.volume * 100}% - 6px)` }}
                                    />
                                </div>
                                <span className="text-[8px] font-black text-cyan-400 mt-2">{Math.round(props.volume * 100)}</span>
                            </div>
                        )}
                    </div>
                    <PtButton label="CFG" icon={<Settings className="w-2.5 h-2.5"/>} onClick={props.onSettings} />
                </PtGroup>
            </div>
        </div>
    );
};

export default ProtrackerMenu;
