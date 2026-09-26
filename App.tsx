
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SidPlayer, parseTraceFile, CLOCK_PAL, CLOCK_NTSC, midiNoteToFreq } from './services/sidService';
import { SidComposerService } from './services/sidComposerService';
import { generateMidiFile } from './services/midiExportService';
import { exportTraceToJson, exportProjectToJson } from './services/jsonExportService';
import { generateSwmFile } from './services/swmExportService';
import { ParsedTrace, MasteringParams, MixerParams, LfoConfig, TrackerProject, EditorCursor } from './types';
import { SidPlayer as C64Emulator } from './components/sid/SidPlayer';
import { parseSidHeader } from './components/sid/SidParser';
import { compileMidiToSidTrace } from './services/midiSidService';
import { traceToTrackerProject } from './services/trackerService';
import { C64Config } from './components/sid/SidTypes';
import { OfflineSidRenderer } from './services/OfflineSidRenderer';
import { updateProjectInstrument, createNewInstrument, deleteProjectInstrument, transposePattern, clearPattern, updatePatternCell, updatePatternCellHex, updateOrderList, insertSequenceStep, deleteSequenceStep, setSequenceLoopPoint } from './services/editorService';
import { SystemLogger } from './services/Logger';
import { renderProjectToTrace, validateProject } from './services/projectLoaderService';

// Icons
import { 
    Grid, Music, Piano, Sparkles, Box, Image as ImageIcon, Sliders, 
    Cpu, Activity, Terminal, Layers, Disc
} from 'lucide-react';

import ProtrackerMenu from './components/ProtrackerMenu';
import Visualizer from './components/Visualizer';
import TrackerView from './components/TrackerView';
import PianoRoll from './components/PianoRoll';
import C64AlbumCover from './components/C64AlbumCover';
import C64LogoVisualizer from './components/C64LogoVisualizer';
import CrtOverlay from './components/CrtOverlay';
import SettingsModal from './components/SettingsModal';
import HelpModal from './components/HelpModal';
import MasteringView from './components/MasteringView';
import MidiExportEditor from './components/MidiExportEditor';
import { SystemLog } from './components/SystemLog';
import WallpaperMesh from './components/WallpaperMesh';
import HyperSidEngine from './components/HyperSidEngine';
import ArpSidBitPerfect from './components/ArpSid_BitPerfect';
import DrSidMachine from './components/DrSidMachine';
import ProtrackerInstEditor from './components/ProtrackerInstEditor';
import PatternToolsModal from './components/PatternToolsModal';
import VWindow from './components/VWindow';
import { DesktopIcon } from './components/DesktopIcon';
import SidChipVisualizer from './components/SidChipVisualizer';
import SwmSequenceEditor from './components/SwmSequenceEditor';
import AuditMonitor from './components/AuditMonitor';
import SwmDetailView from './components/SwmDetailView';
import { FormatDocs } from './components/FormatDocs';
import PhysicalSidVisualizer from './components/PhysicalSidVisualizer';

// Window Manager Types
interface WindowState {
    id: string;
    type: string;
    title: string;
    icon: React.ReactNode;
    zIndex: number;
    minimized: boolean;
    maximized: boolean;
    x: number;
    y: number;
    w: number;
    h: number;
}

const App: React.FC = () => {
  const [traceData, setTraceData] = useState<ParsedTrace | null>(null);
  const [project, setProject] = useState<TrackerProject | null>(null);
  const [player, setPlayer] = useState<SidPlayer | null>(null);
  
  // App State
  const [isPlaying, setIsPlaying] = useState(false);
  const [sidModel, setSidModel] = useState<'6581' | '8580'>('6581');
  const [clockFreq, setClockFreq] = useState(CLOCK_PAL);
  const [isProcessing, setIsProcessing] = useState(false);
  const [engineType, setEngineType] = useState<'STD' | 'HIFI'>('HIFI');
  
  // Tracker State
  const [cursor, setCursor] = useState<EditorCursor>({ patternIdx: 0, row: 0, channel: 0, column: 0 });
  const [voiceMask, setVoiceMask] = useState<[boolean, boolean, boolean]>([true, true, true]);
  const [editorStep, setEditorStep] = useState(1);
  const [selectedInstId, setSelectedInstId] = useState(1);
  
  // Visuals State
  const [vizMode, setVizMode] = useState<'STANDARD' | 'VECTOR' | 'FLUX'>('STANDARD');
  const [crtEnabled, setCrtEnabled] = useState(false);
  const [showHex, setShowHex] = useState(true);
  const [volume, setVolume] = useState(0.4); 
  const [luminosity, setLuminosity] = useState(1.2);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  
  // Album / Wallpaper State
  const [wallpaper, setWallpaper] = useState<string | null>(null);
  const [coverImageSrc, setCoverImageSrc] = useState<string | null>(null);
  const [coverSettings, setCoverSettings] = useState({ scale: 1.0, x: 0, y: 0, dither: 0.2 });

  // Modals (Legacy / System)
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showMidiExport, setShowMidiExport] = useState(false);
  const [showPatternTools, setShowPatternTools] = useState(false);

  // Window Manager State
  const [windows, setWindows] = useState<WindowState[]>([]);
  const [nextZIndex, setNextZIndex] = useState(100);
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);

  // Config State
  const [emulationConfig, setEmulationConfig] = useState<C64Config>({
      enableHle: true,
      roms: {},
      busPersistenceCycles: 0,
      enableAdsrPipeline: true,
      noiseSeed: Date.now(),
      exportDepth: 'FULL'
  });
  const [fpsOverride, setFpsOverride] = useState<number | null>(null);

  const [mixerParams, setMixerParams] = useState<MixerParams>({
      voices: [
          { volume: 1, pan: 0, muted: false, solo: false },
          { volume: 1, pan: 0, muted: false, solo: false },
          { volume: 1, pan: 0, muted: false, solo: false }
      ],
      masterVolume: 0.4
  });
  
  const [masteringParams, setMasteringParams] = useState<MasteringParams>({
      eq: { enabled: true, lowGain: 1, highGain: 1, tilt: 0.5 },
      tape: { enabled: true, drive: 0.8, bias: 0.0 },
      comp: { enabled: true, threshold: 0.8, ratio: 4, release: 0.1 },
      exciter: { enabled: true, amount: 0.15, freq: 8000 },
      reverb: { active: true, mix: 0.08, time: 200, feedback: 0.3 }, 
      imager: { enabled: true, width: 1.2 },
      limiter: { enabled: true, ceiling: 0.95 },
      output: { enabled: true, gain: 1.0 },
      final: { dcBlock: true, dcPole: 0.995, multiband: false, multibandMix: 0 },
      chorus: { enabled: false, depth: 0.3, rate: 0.5, mix: 0.3 }
  });

  const [lfoConfig, setLfoConfig] = useState<LfoConfig>({
      enabled: false, sync: false, rate: 1, depth: 0, waveform: 'sine', target: 'none'
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, []);

  const exportBaseName = useCallback(() => {
      const sourceName = traceData?.header.originalFilename || traceData?.header.song || 'sid_os_export';
      return sourceName.replace(/\.[^/.]+$/, '').replace(/[^a-z0-9-_]/gi, '_').toLowerCase() || 'sid_os_export';
  }, [traceData]);

  // --- Window Manager Functions ---

  const focusWindow = useCallback((id: string) => {
      setWindows(prev => prev.map(w => w.id === id ? { ...w, zIndex: nextZIndex } : w));
      setNextZIndex(z => z + 1);
      setActiveWindowId(id);
  }, [nextZIndex]);

  const openWindow = useCallback((type: string) => {
      setWindows(prev => {
          const existing = prev.find(w => w.type === type);
          if (existing) {
              // Bring to front
              focusWindow(existing.id);
              if (existing.minimized) return prev.map(w => w.id === existing.id ? { ...w, minimized: false, zIndex: nextZIndex + 1 } : w);
              return prev;
          }

          // Define Window Props
          let title = "Application";
          let icon = <Activity className="w-4 h-4"/>;
          let w = 800, h = 600;
          
          switch(type) {
              case 'TRACKER': title = "PROTRACKER_V3"; icon = <Grid className="w-4 h-4"/>; w = 1000; h = 700; break;
              case 'SEQUENCE': title = "SEQUENCE_EDITOR"; icon = <Layers className="w-4 h-4"/>; w = 520; h = 640; break;
              case 'PIANO': title = "PIANO_ROLL"; icon = <Music className="w-4 h-4"/>; w = 900; h = 500; break;
              case 'INSTRUMENTS': title = "INSTRUMENT_LAB"; icon = <Piano className="w-4 h-4"/>; w = 950; h = 650; break;
              case 'ARP': title = "ARP_SYNTHESIZER"; icon = <Activity className="w-4 h-4"/>; w = 1100; h = 700; break;
              case 'DRSID': title = "DR.SID_MACHINE"; icon = <Disc className="w-4 h-4"/>; w = 1000; h = 650; break;
              case 'HYPER': title = "HYPER_SID_ENGINE"; icon = <Sparkles className="w-4 h-4"/>; break;
              case 'LOGO': title = "C64_SYSTEM"; icon = <Box className="w-4 h-4"/>; break;
              case 'ALBUM': title = "ARTWORK_VIEWER"; icon = <ImageIcon className="w-4 h-4"/>; w = 400; h = 400; break;
              case 'MASTERING': title = "MASTERING_CONSOLE"; icon = <Sliders className="w-4 h-4"/>; w = 900; h = 600; break;
              case 'CHIP': title = "SILICON_DIE_VIEW"; icon = <Cpu className="w-4 h-4"/>; break;
              case 'LOG': title = "SYSTEM_LOG"; icon = <Terminal className="w-4 h-4"/>; w = 600; h = 400; break;
              case 'AUDIT': title = "SID_BUS_AUDIT"; icon = <Terminal className="w-4 h-4"/>; w = 920; h = 680; break;
              case 'PROJECT': title = "SWM_PROJECT_DETAIL"; icon = <Layers className="w-4 h-4"/>; w = 980; h = 720; break;
              case 'DOCS': title = "FORMAT_REFERENCE"; icon = <Terminal className="w-4 h-4"/>; w = 920; h = 720; break;
              case 'PHYSICAL': title = "PHYSICAL_SID_SIMULATION"; icon = <Cpu className="w-4 h-4"/>; w = 960; h = 680; break;
          }

          const newWindow: WindowState = {
              id: type,
              type,
              title,
              icon,
              zIndex: nextZIndex + 1,
              minimized: false,
              maximized: false,
              x: 24 + ((prev.length % 6) * 20),
              y: 48 + ((prev.length % 6) * 20),
              w, h
          };
          
          setNextZIndex(z => z + 1);
          setActiveWindowId(type);
          return [...prev, newWindow];
      });
  }, [nextZIndex, focusWindow]);

  const closeWindow = useCallback((id: string) => {
      setWindows(prev => prev.filter(w => w.id !== id));
      if (activeWindowId === id) setActiveWindowId(null);
  }, [activeWindowId]);

  const toggleMinimize = useCallback((id: string) => {
      setWindows(prev => prev.map(w => w.id === id ? { ...w, minimized: !w.minimized } : w));
  }, []);

  const toggleMaximize = useCallback((id: string) => {
      setWindows(prev => prev.map(w => w.id === id ? { ...w, maximized: !w.maximized } : w));
  }, []);


  useEffect(() => {
      if (player) {
          player.setModel(sidModel);
      }
  }, [sidModel, player]);

  useEffect(() => {
      if (player) player.setMasteringParams(masteringParams);
  }, [masteringParams, player]);

  useEffect(() => {
      if (player) player.setMixerParams(mixerParams);
  }, [mixerParams, player]);

  useEffect(() => {
      if (!player) return;
      player.pause();
      player.destroy();
      setPlayer(null);
      setIsPlaying(false);
      SystemLogger.log('Audio', 'Audio engine selection changed; initialize playback again to use the selected engine.', 'info');
  }, [engineType]);

  const initPlayer = async () => {
      // Return existing player if already initialized to prevent duplication
      if (player) return player;
      
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const p = new SidPlayer(ctx);
      
      // CRITICAL: Await initialization to prevent race conditions with AudioWorklet
      try {
          await p.init(engineType);
          p.setModel(sidModel);
          p.setMasteringParams(masteringParams);
          p.setMixerParams(mixerParams);
          setPlayer(p);
          return p;
      } catch (err) {
          SystemLogger.log('Audio', 'Audio engine initialization failed.', 'error', err);
          return null;
      }
  };

  const handleFileLoad = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const maxImportBytes = 16 * 1024 * 1024;
      if (file.size > maxImportBytes) {
          SystemLogger.log('Loader', 'Import rejected: files larger than 16 MiB are not supported.', 'error');
          e.target.value = '';
          return;
      }
      
      const fileName = file.name.toLowerCase();
      const rawName = file.name;
      setIsProcessing(true);

      try {
          let parsed: ParsedTrace | null = null;
          let loadedProject: TrackerProject | null = null;

          if (fileName.endsWith('.json') || fileName.endsWith('.jsonl')) {
              const text = await file.text();
              try {
                  const json = JSON.parse(text);
                  if (Array.isArray(json.patterns) || Array.isArray(json.instruments) || Array.isArray(json.subtunes)) {
                      loadedProject = validateProject(json);
                      parsed = renderProjectToTrace(loadedProject, clockFreq);
                  } else {
                      parsed = parseTraceFile(text);
                  }
              } catch {
                  parsed = parseTraceFile(text);
              }
              if (parsed && parsed.header) {
                  parsed.header.originalFilename = rawName;
              }
          } 
          else if (fileName.endsWith('.sid')) {
              const buffer = await file.arrayBuffer();
              const { header, sidData } = parseSidHeader(buffer);
              if (header.sidCount > 1) {
                  SystemLogger.log('Loader', 'Multi-SID file detected; this importer currently converts the primary SID chip only.', 'warn');
              }
              
              if (header.isNtsc) setClockFreq(CLOCK_NTSC);
              else setClockFreq(CLOCK_PAL);

              const emulator = new C64Emulator();
              const config: C64Config = {
                  ...emulationConfig,
                  enableHle: true
              };
              
              const dump = await emulator.convert(header, sidData, buffer, header.startSong, 180, config);
              
              parsed = {
                  header: {
                      song: dump.metadata.title,
                      author: dump.metadata.author,
                      copyright: dump.metadata.released,
                      clock: dump.metadata.clockFreq,
                      originalFilename: rawName
                  },
                  frames: dump.frames.map(f => f.chips[0].registers),
                  events: dump.writeLog.filter(w => w.chipIdx === 0).map(w => ({
                      cycles: w.cycles,
                      reg: w.reg,
                      val: w.val
                  }))
              };
          }
          else if (fileName.endsWith('.mid') || fileName.endsWith('.midi')) {
              const buffer = await file.arrayBuffer();
              parsed = await compileMidiToSidTrace(buffer, {
                  clock: clockFreq,
                  filename: rawName
              });
          }

          if (parsed) {
              setTraceData(parsed);
              
              if (loadedProject) {
                  setProject(loadedProject);
                  setSelectedInstId(loadedProject.instruments[0]?.id || 1);
              } else {
                  // Auto-generate project structure for editing.
                  try {
                      const proj = await traceToTrackerProject(parsed);
                      setProject(proj);
                      if (proj.instruments.length > 0) setSelectedInstId(proj.instruments[0].id);
                  } catch (err) {
                      SystemLogger.log('Tracker', 'Could not generate a tracker project from the trace.', 'warn', err);
                  }
              }

              // Auto-open relevant window
              if (fileName.endsWith('.mid') || fileName.endsWith('.midi')) {
                  openWindow('TRACKER');
              } else {
                  openWindow('TRACKER');
              }

              let p = player;
              if (!p) {
                  p = await initPlayer();
              }
              if (p) {
                  p.setData(parsed.events, parsed.header.clock || clockFreq);
              }
          } else {
              SystemLogger.log('Loader', 'Import failed: the file did not contain supported trace data.', 'error');
          }
      } catch (err) {
          SystemLogger.log('Loader', 'File loading failed. Open System Log for technical details.', 'error', err);
      } finally {
          setIsProcessing(false);
          e.target.value = '';
      }
  };

  const handleStop = () => {
      if (player) {
          player.pause();
          player.seek(0);
          setIsPlaying(false);
      }
  };
  
  const togglePlay = async () => {
      let p = player;
      if (!p) {
          p = await initPlayer();
          if (!p) return; // initialization failed
          if (traceData) p.setData(traceData.events, traceData.header.clock || clockFreq);
          await p.play();
          setIsPlaying(true);
          return;
      }
      if (isPlaying) {
          p.pause();
          setIsPlaying(false);
      } else {
          await p.play();
          setIsPlaying(true);
      }
  };

  const onExportJsonWithMeta = () => { if(traceData) exportTraceToJson({...traceData, header: {...traceData.header, originalFilename: traceData.header.originalFilename }}); };
  const onExportProject = async () => { if(traceData) exportProjectToJson(project || await traceToTrackerProject(traceData)); };
  const onExportSwm = () => {
      if (!project) return SystemLogger.log('Export', 'SWM export requires a generated tracker project.', 'warn');
      downloadBlob(new Blob([generateSwmFile(project)], { type: 'application/octet-stream' }), `${exportBaseName()}.swm`);
  };
  const onExportWav = async () => {
      if (!traceData) return;
      setIsProcessing(true);
      try {
          downloadBlob(await OfflineSidRenderer.render(traceData, masteringParams, mixerParams, sidModel), `${exportBaseName()}.wav`);
      } catch (err) {
          SystemLogger.log('Export', 'WAV render failed.', 'error', err);
      } finally {
          setIsProcessing(false);
      }
  };
  const onExportSid = () => {
      if (!traceData) return;
      try {
          downloadBlob(SidComposerService.compile(traceData, sidModel), `${exportBaseName()}.sid`);
      } catch (err) {
          SystemLogger.log('Export', 'SID export failed.', 'error', err);
      }
  };
  const onExportMidi = (bpm: number, ppq: number, duration: 'smart' | 'raw' | '1/4' | '1/8' | '1/16' | '1/32', useProject: boolean, channels: [boolean, boolean, boolean]) => {
      if (!traceData) return;
      try {
          const source = useProject && project ? renderProjectToTrace(project, clockFreq) : traceData;
          downloadBlob(new Blob([generateMidiFile(source, { bpm, ppq, duration, channels })], { type: 'audio/midi' }), `${exportBaseName()}.mid`);
          setShowMidiExport(false);
      } catch (err) {
          SystemLogger.log('Export', 'MIDI export failed.', 'error', err);
      }
  };

  const editTrackerCell = useCallback((target: EditorCursor, value: string) => {
      setProject(previous => {
          if (!previous) return previous;
          const patternId = previous.subtunes[0]?.orderList[target.patternIdx];
          if (patternId === undefined) return previous;
          if (value.startsWith('HEX:')) {
              return updatePatternCellHex(previous, patternId, target.row, target.channel, target.column, value.slice(4));
          }
          const changes = target.column === 0 ? { note: value } :
              target.column === 1 ? { inst: Number.parseInt(value, 16) || 0 } :
              target.column === 2 ? { vol: value } :
              target.column === 3 ? { cmd: value } : { val: value };
          return updatePatternCell(previous, patternId, target.row, target.channel, changes);
      });
  }, []);

  const previewInstrument = useCallback(async (instrument: TrackerProject['instruments'][number], note = 60) => {
      const activePlayer = player || await initPlayer();
      if (!activePlayer) return;
      const frequency = midiNoteToFreq(note, clockFreq);
      activePlayer.liveWrite(0, frequency & 0xFF);
      activePlayer.liveWrite(1, (frequency >> 8) & 0xFF);
      activePlayer.liveWrite(2, instrument.pulseWidth & 0xFF);
      activePlayer.liveWrite(3, (instrument.pulseWidth >> 8) & 0x0F);
      activePlayer.liveWrite(5, (instrument.attack << 4) | instrument.decay);
      activePlayer.liveWrite(6, (instrument.sustain << 4) | instrument.release);
      activePlayer.liveWrite(24, 0x0F);
      activePlayer.liveWrite(4, instrument.waveform & 0xFE);
      window.setTimeout(() => activePlayer.liveWrite(4, instrument.waveform | 0x01), 12);
      window.setTimeout(() => activePlayer.liveWrite(4, instrument.waveform & 0xFE), 360);
  }, [player, clockFreq]);

  const previewProjectNote = useCallback((noteName: string, instrumentId: number) => {
      if (!project) return;
      const match = /^([A-G][#-])(\d+)$/.exec(noteName);
      const noteNames = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
      const noteIndex = match ? noteNames.indexOf(match[1]) + (Number(match[2]) * 12) : -1;
      const instrument = project.instruments.find(candidate => candidate.id === instrumentId) || project.instruments[0];
      if (instrument && noteIndex >= 0) void previewInstrument(instrument, noteIndex);
  }, [project, previewInstrument]);

  // Render App Content based on Window Type
  const renderAppContent = (type: string) => {
      switch(type) {
          case 'TRACKER': 
              return traceData ? (
                  <TrackerView 
                      trace={traceData} player={player} clock={clockFreq} project={project || undefined}
                      cursor={cursor} onCursorMove={setCursor} voiceMask={voiceMask} 
                      onToggleVoice={(i) => { const n = [...voiceMask] as [boolean,boolean,boolean]; n[i] = !n[i]; setVoiceMask(n); player?.setVoiceMask(n); }}
                      showHex={showHex}
                      step={editorStep}
                      onEdit={editTrackerCell}
                  />
              ) : <div className="flex h-full items-center justify-center text-slate-500 font-mono">NO DATA LOADED</div>;
          case 'SEQUENCE':
              return project ? <SwmSequenceEditor project={project} activeStep={cursor.patternIdx} onUpdateStep={(step, patternId) => setProject(previous => previous ? updateOrderList(previous, step, patternId) : previous)} onInsert={(step) => setProject(previous => previous ? insertSequenceStep(previous, step) : previous)} onDelete={(step) => setProject(previous => previous ? deleteSequenceStep(previous, step) : previous)} onSetLoop={(step) => setProject(previous => previous ? setSequenceLoopPoint(previous, step) : previous)} onSeek={(frame) => setCursor(current => ({ ...current, patternIdx: Math.floor(frame / 64), row: frame % 64 }))} /> : <div className="flex h-full items-center justify-center text-slate-500 font-mono">NO PROJECT DATA</div>;
          case 'PIANO':
              return project ? (
                  <PianoRoll
                      project={project} activePatternIndex={cursor.patternIdx} currentRow={cursor.row}
                      selectedInstId={selectedInstId} selectedChannel={cursor.channel}
                      onEdit={(row, ch, note, inst) => {
                          const patId = project.subtunes[0].orderList[cursor.patternIdx];
                          setProject(prev => prev ? updatePatternCell(prev, patId, row, ch, { note, inst }) : null);
                      }}
                      onSeek={(row) => setCursor(c => ({ ...c, row }))}
                      onPreview={previewProjectNote}
                      player={player} clockFreq={clockFreq}
                  />
              ) : <div className="flex h-full items-center justify-center text-slate-500 font-mono">NO PROJECT DATA</div>;
          case 'INSTRUMENTS':
              return project ? (
                  <ProtrackerInstEditor 
                      instruments={project.instruments} selectedId={selectedInstId} onSelect={setSelectedInstId}
                      onUpdate={(id, changes) => setProject(prev => prev ? updateProjectInstrument(prev, id, changes) : null)}
                      onTest={previewInstrument} onCreate={() => setProject(prev => prev ? createNewInstrument(prev) : null)}
                      onDelete={(id) => setProject(prev => prev ? deleteProjectInstrument(prev, id) : null)}
                  />
              ) : <div className="flex h-full items-center justify-center text-slate-500 font-mono">NO PROJECT DATA</div>;
          case 'ARP':
              return <ArpSidBitPerfect player={player} isPlaying={isPlaying} onInit={() => { if(!player) togglePlay(); }} />;
          case 'DRSID':
              return <DrSidMachine player={player} isOpen={true} onClose={() => closeWindow('DRSID')} />;
          case 'HYPER':
              return <HyperSidEngine player={player} isPlaying={isPlaying} />;
          case 'LOGO':
              return <C64LogoVisualizer />;
          case 'CHIP':
              return <SidChipVisualizer player={player} isPlaying={isPlaying} model={sidModel} />;
          case 'ALBUM':
              return <C64AlbumCover 
                  header={traceData?.header} isPlaying={isPlaying} imageSrc={coverImageSrc} setImageSrc={setCoverImageSrc}
                  settings={coverSettings} setSettings={setCoverSettings} onSetWallpaper={setWallpaper}
              />;
          case 'MASTERING':
              return <MasteringView 
                  params={masteringParams} onUpdate={setMasteringParams} 
                  mixerParams={mixerParams} onUpdateMixer={setMixerParams} 
                  player={player} 
              />;
          case 'LOG':
              return <SystemLog />;
          case 'AUDIT':
              return <AuditMonitor player={player} isPlaying={isPlaying} />;
          case 'PROJECT':
              return <SwmDetailView project={project || undefined} onUpdateProject={setProject} />;
          case 'DOCS':
              return <div className="h-full overflow-y-auto bg-slate-950 p-6"><FormatDocs /></div>;
          case 'PHYSICAL':
              return <PhysicalSidVisualizer player={player} isPlaying={isPlaying} model={sidModel} trace={traceData} visualLead={0} interpolatedCycles={player?.getEstimatedCycles() || 0} />;
          default: return null;
      }
  };

  return (
      <div className="flex flex-col h-screen w-screen bg-[#010204] text-white font-sans overflow-hidden relative selection:bg-cyan-500/20">
          {crtEnabled && <CrtOverlay />}
          {wallpaper && <div className="absolute inset-0 z-0"><WallpaperMesh player={player} imageSrc={wallpaper} opacity={0.6} /></div>}
          <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileLoad} accept=".json,.jsonl,.sid,.mid,.midi" />

          {/* BACKGROUND VISUALIZER (LAYER 0) */}
          <div className="absolute inset-0 z-0 pointer-events-none opacity-40 grayscale-[0.3]">
              <Visualizer player={player} isPlaying={isPlaying} header={traceData?.header} mode={vizMode} sidModel={sidModel} luminosity={luminosity} />
          </div>

          {/* DESKTOP ICONS (LAYER 1) */}
          <div className="absolute inset-0 z-10 p-4 sm:p-8 pb-40 overflow-y-auto pointer-events-none">
              <div className="pointer-events-auto grid grid-cols-2 xl:grid-cols-1 gap-3 sm:gap-5 w-fit">
                  <DesktopIcon label="Tracker" icon={<Grid className="w-6 h-6"/>} onClick={() => openWindow('TRACKER')} />
                  <DesktopIcon label="Sequence" icon={<Layers className="w-6 h-6"/>} onClick={() => openWindow('SEQUENCE')} />
                  <DesktopIcon label="Piano Roll" icon={<Music className="w-6 h-6"/>} onClick={() => openWindow('PIANO')} />
                  <DesktopIcon label="Instruments" icon={<Piano className="w-6 h-6"/>} onClick={() => openWindow('INSTRUMENTS')} />
                  <DesktopIcon label="Arp Synth" icon={<Activity className="w-6 h-6"/>} onClick={() => openWindow('ARP')} />
                  <DesktopIcon label="Dr.SID" icon={<Disc className="w-6 h-6"/>} onClick={() => openWindow('DRSID')} />
                  <DesktopIcon label="Hyper SID" icon={<Sparkles className="w-6 h-6"/>} onClick={() => openWindow('HYPER')} />
                  <DesktopIcon label="Mastering" icon={<Sliders className="w-6 h-6"/>} onClick={() => openWindow('MASTERING')} />
                  <DesktopIcon label="System" icon={<Box className="w-6 h-6"/>} onClick={() => openWindow('LOGO')} />
                  <DesktopIcon label="Chip Die" icon={<Cpu className="w-6 h-6"/>} onClick={() => openWindow('CHIP')} />
                  <DesktopIcon label="Physical SID" icon={<Cpu className="w-6 h-6"/>} onClick={() => openWindow('PHYSICAL')} />
                  <DesktopIcon label="SID Audit" icon={<Terminal className="w-6 h-6"/>} onClick={() => openWindow('AUDIT')} />
                  <DesktopIcon label="Project" icon={<Layers className="w-6 h-6"/>} onClick={() => openWindow('PROJECT')} />
                  <DesktopIcon label="Format Docs" icon={<Terminal className="w-6 h-6"/>} onClick={() => openWindow('DOCS')} />
                  <DesktopIcon label="Artwork" icon={<ImageIcon className="w-6 h-6"/>} onClick={() => openWindow('ALBUM')} />
                  <DesktopIcon label="Logs" icon={<Terminal className="w-6 h-6"/>} onClick={() => openWindow('LOG')} />
              </div>
          </div>

          {/* WINDOWS LAYER (LAYER 2) */}
          <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
              {windows.map(w => !w.minimized && (
                  <div key={w.id} className="pointer-events-auto">
                      <VWindow
                          id={w.id}
                          title={w.title}
                          icon={w.icon}
                          initialX={w.x}
                          initialY={w.y}
                          initialW={w.w}
                          initialH={w.h}
                          zIndex={w.zIndex}
                          isFocused={activeWindowId === w.id}
                          isMaximized={w.maximized}
                          onClose={closeWindow}
                          onMinimize={toggleMinimize}
                          onMaximize={toggleMaximize}
                          onFocus={focusWindow}
                      >
                          {renderAppContent(w.type)}
                      </VWindow>
                  </div>
              ))}
          </div>

          {/* LOADING OVERLAY */}
          {isProcessing && (
              <div className="absolute inset-0 flex items-center justify-center z-[5000] bg-black/80 backdrop-blur-sm">
                  <div className="flex flex-col items-center gap-4">
                      <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-cyan-400 font-bold tracking-widest animate-pulse">PROCESSING DATA...</span>
                  </div>
              </div>
          )}

          {/* TASKBAR (LAYER 3) */}
          <div className="absolute bottom-0 left-0 right-0 z-[4000]">
            <ProtrackerMenu 
                onLoad={() => fileInputRef.current?.click()}
                onExportJson={onExportJsonWithMeta} onExportProject={onExportProject} onExportSwm={onExportSwm} onExportWav={onExportWav} onExportMidi={() => setShowMidiExport(true)} onExportSid={onExportSid}
                onHelp={() => setShowHelp(true)} onSettings={() => setShowSettings(true)} onPatternTools={() => setShowPatternTools(true)} onOpenMixer={() => openWindow('MASTERING')}
                viewMode={activeWindowId || ''} setViewMode={(m: any) => openWindow(m)}
                vizMode={vizMode} setVizMode={setVizMode}
                crtEnabled={crtEnabled} setCrtEnabled={setCrtEnabled}
                clockFreq={clockFreq} setClockFreq={setClockFreq}
                lfoConfig={lfoConfig} setLfoConfig={setLfoConfig}
                traceLoaded={!!traceData} isPlaying={isPlaying} onTogglePlay={togglePlay} onStop={handleStop}
                playbackSpeed={playbackSpeed} setPlaybackSpeed={setPlaybackSpeed}
                volume={volume} setVolume={(v) => { setVolume(v); setMixerParams(previous => ({ ...previous, masterVolume: v })); }}
                isFullscreen={!!document.fullscreenElement}
                onToggleFullscreen={() => { if (!document.fullscreenElement) document.documentElement.requestFullscreen(); else document.exitFullscreen(); }}
                editorStep={editorStep} setEditorStep={setEditorStep}
            />
          </div>

          {showSettings && <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/80 backdrop-blur-sm"><SettingsModal onClose={() => setShowSettings(false)} crtEnabled={crtEnabled} setCrtEnabled={setCrtEnabled} showHex={showHex} setShowHex={setShowHex} clockFreq={clockFreq} setClockFreq={setClockFreq} fpsOverride={fpsOverride} setFpsOverride={setFpsOverride} luminosity={luminosity} setLuminosity={setLuminosity} sidModel={sidModel} setSidModel={setSidModel} engineType={engineType} setEngineType={setEngineType} emulationConfig={emulationConfig} setEmulationConfig={setEmulationConfig} /></div>}
          {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
          {showPatternTools && project && <div className="fixed inset-0 z-[6000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"><div className="w-full max-w-xl rounded-xl border border-cyan-500/30 bg-[#080b12] p-5 shadow-2xl"><PatternToolsModal channel={cursor.channel} onClose={() => setShowPatternTools(false)} onTranspose={(semitones, wholePattern) => setProject(previous => { if (!previous) return previous; const patternId = previous.subtunes[0]?.orderList[cursor.patternIdx]; return patternId === undefined ? previous : transposePattern(previous, patternId, cursor.channel, semitones, wholePattern); })} onClear={(wholePattern) => setProject(previous => { if (!previous) return previous; const patternId = previous.subtunes[0]?.orderList[cursor.patternIdx]; return patternId === undefined ? previous : clearPattern(previous, patternId, cursor.channel, wholePattern); })} /></div></div>}
          {showMidiExport && traceData && <div className="fixed inset-0 z-[6000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"><div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-cyan-500/30 bg-[#080b12] p-5 shadow-2xl"><MidiExportEditor initialBpm={120} initialPpq={480} initialDuration="smart" onExport={onExportMidi} onClose={() => setShowMidiExport(false)} /></div></div>}
      </div>
  );
};

export default App;
