
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Terminal, Filter, Save, Trash2, ArrowDownCircle, ArrowUpCircle, Search, Pause, Play, Activity, List, Binary, Cpu } from 'lucide-react';
import { SystemLogger, LogEntry, LogLevel } from '../services/Logger';
import { CpuTraceEntry, SidRegisterWrite } from './sid/SidTypes';

interface SystemLogProps {
  crtMode?: boolean;
  className?: string;
  height?: string;
  cpuTrace?: CpuTraceEntry[];
  sidWrites?: SidRegisterWrite[];
}

export const SystemLog: React.FC<SystemLogProps> = ({ crtMode = false, className = '', height = 'h-64', cpuTrace, sidWrites }) => {
  const [activeTab, setActiveTab] = useState<'log' | 'trace' | 'sid'>('log');
  
  // Log State
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logFilter, setLogFilter] = useState<LogLevel>('debug');
  const [searchTerm, setSearchTerm] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [sidViewMode, setSidViewMode] = useState<'tail' | 'head'>('tail');
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Subscribe to logger
  useEffect(() => {
    setLogs(SystemLogger.getHistory());
    let buffer: LogEntry[] = [];
    let frameId: number;

    const flushBuffer = () => {
        if (buffer.length > 0) {
            if (!isPaused) {
                setLogs(prev => {
                    const next = [...prev, ...buffer];
                    return next.length > 2000 ? next.slice(next.length - 2000) : next;
                });
            }
            buffer = [];
        }
        frameId = requestAnimationFrame(flushBuffer);
    };

    const unsub = SystemLogger.subscribe((entry) => {
        buffer.push(entry);
    });

    frameId = requestAnimationFrame(flushBuffer);
    return () => { unsub(); cancelAnimationFrame(frameId); };
  }, [isPaused]);

  // Auto-scroll logic
  useEffect(() => {
      if (activeTab === 'trace' && cpuTrace && cpuTrace.length > 0 && endRef.current) {
          endRef.current.scrollIntoView({ behavior: 'smooth' });
      } else if (activeTab === 'sid' && sidWrites && sidWrites.length > 0 && endRef.current && sidViewMode === 'tail') {
          endRef.current.scrollIntoView({ behavior: 'smooth' });
      } else if (activeTab === 'log' && autoScroll && !isPaused && endRef.current) {
          endRef.current.scrollIntoView({ behavior: 'smooth' });
      }
  }, [logs, autoScroll, isPaused, activeTab, cpuTrace, sidWrites, sidViewMode]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
      if (activeTab === 'log') {
          const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
          const isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 50;
          if (isAtBottom) { if (!autoScroll) setAutoScroll(true); } 
          else { if (autoScroll) setAutoScroll(false); }
      }
  };

  const filteredLogs = useMemo(() => {
      const levelMap: Record<LogLevel, number> = { 'debug': 0, 'info': 1, 'warn': 2, 'error': 3 };
      const minLevel = levelMap[logFilter];
      return logs.filter(l => {
          if (levelMap[l.level] < minLevel) return false;
          if (searchTerm) {
              const term = searchTerm.toLowerCase();
              return l.message.toLowerCase().includes(term) || l.component.toLowerCase().includes(term);
          }
          return true;
      });
  }, [logs, logFilter, searchTerm]);

  const filteredTrace = useMemo(() => {
      if (!cpuTrace) return [];
      if (!searchTerm) return cpuTrace;
      const term = searchTerm.toLowerCase();
      return cpuTrace.filter(t => 
          t.instruction.toLowerCase().includes(term) || 
          t.pc.toString(16).includes(term)
      );
  }, [cpuTrace, searchTerm]);

  // Efficiently render N writes based on view mode
  const displayedWrites = useMemo(() => {
      if (!sidWrites) return [];
      const sliceSize = 2000;
      let data: SidRegisterWrite[] = [];
      
      if (sidWrites.length <= sliceSize) {
          data = sidWrites;
      } else {
          if (sidViewMode === 'head') {
              data = sidWrites.slice(0, sliceSize);
          } else {
              data = sidWrites.slice(-sliceSize);
          }
      }

      if (!searchTerm) return data;
      const term = searchTerm.toLowerCase();
      return data.filter(w => 
          w.reg.toString(16).includes(term) || 
          w.val.toString(16).includes(term) || 
          w.cycles.toString().includes(term)
      );
  }, [sidWrites, searchTerm, sidViewMode]);

  const getFlagStr = (f: number) => {
      return [
        (f & 0x80) ? 'N' : '.',
        (f & 0x40) ? 'V' : '.',
        '-',
        (f & 0x10) ? 'B' : '.',
        (f & 0x08) ? 'D' : '.',
        (f & 0x04) ? 'I' : '.',
        (f & 0x02) ? 'Z' : '.',
        (f & 0x01) ? 'C' : '.'
    ].join('');
  };

  const getRegName = (reg: number) => {
    const names = ['FREQ_L','FREQ_H','PW_L','PW_H','CTRL','AD','SR'];
    const voice = Math.floor(reg / 7) + 1;
    const r = reg % 7;
    if (reg < 21) return `V${voice}_${names[r]}`;
    if (reg === 21) return 'FC_L';
    if (reg === 22) return 'FC_H';
    if (reg === 23) return 'RES_FILT';
    if (reg === 24) return 'MODE_VOL';
    return `REG_$${reg.toString(16).toUpperCase()}`;
  };

  return (
    <div className={`bg-black border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col ${height} relative group transition-colors hover:border-slate-700 ${crtMode ? 'crt-container crt-effect' : ''} ${className}`}>
        
        {/* Toolbar */}
        <div className="bg-slate-900/90 p-2 border-b border-slate-800 flex flex-wrap gap-2 justify-between items-center backdrop-blur-sm z-30">
            <div className="flex items-center gap-3">
                <div className="flex bg-slate-800 rounded-lg p-0.5 border border-slate-700/50">
                    <button 
                        onClick={() => setActiveTab('log')}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded text-[10px] font-bold uppercase transition-all ${activeTab === 'log' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                        <List className="w-3 h-3" /> Logs
                    </button>
                    <button 
                        onClick={() => setActiveTab('trace')}
                        disabled={!cpuTrace || cpuTrace.length === 0}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded text-[10px] font-bold uppercase transition-all ${
                            activeTab === 'trace' ? 'bg-red-900/50 text-red-200 shadow border border-red-800/30' : 
                            (!cpuTrace || cpuTrace.length === 0) ? 'opacity-50 cursor-not-allowed text-slate-600' : 'text-slate-400 hover:text-red-300'
                        }`}
                    >
                        <Cpu className="w-3 h-3" /> CPU
                    </button>
                    <button 
                        onClick={() => setActiveTab('sid')}
                        disabled={!sidWrites || sidWrites.length === 0}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded text-[10px] font-bold uppercase transition-all ${
                            activeTab === 'sid' ? 'bg-cyan-900/50 text-cyan-200 shadow border border-cyan-800/30' : 
                            (!sidWrites || sidWrites.length === 0) ? 'opacity-50 cursor-not-allowed text-slate-600' : 'text-slate-400 hover:text-cyan-300'
                        }`}
                    >
                        <Binary className="w-3 h-3" /> SID Dump
                        {sidWrites && sidWrites.length > 0 && (
                            <span className="bg-cyan-500 text-white text-[9px] rounded-full px-1.5 py-0.5 ml-1">
                                {sidWrites.length > 1000 ? `${(sidWrites.length/1000).toFixed(1)}k` : sidWrites.length}
                            </span>
                        )}
                    </button>
                </div>

                {activeTab === 'log' && (
                    <div className="flex items-center gap-1 bg-slate-800 rounded px-2 py-0.5 border border-slate-700/50">
                        <Filter className="w-3 h-3 text-slate-400" />
                        <select 
                            value={logFilter}
                            onChange={(e) => setLogFilter(e.target.value as LogLevel)}
                            className="bg-transparent text-[10px] font-mono text-slate-300 outline-none uppercase cursor-pointer min-w-[60px]"
                        >
                            <option value="debug">All</option>
                            <option value="info">Info</option>
                            <option value="warn">Warn</option>
                            <option value="error">Error</option>
                        </select>
                    </div>
                )}

                {activeTab === 'sid' && (
                    <div className="flex items-center gap-1 bg-slate-800 rounded p-0.5 border border-slate-700/50">
                        <button
                            onClick={() => setSidViewMode('head')}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${sidViewMode === 'head' ? 'bg-cyan-900 text-cyan-200' : 'text-slate-500 hover:text-slate-300'}`}
                            title="Show First 2000 Lines"
                        >
                            <ArrowUpCircle className="w-3 h-3" /> HEAD
                        </button>
                        <button
                            onClick={() => setSidViewMode('tail')}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${sidViewMode === 'tail' ? 'bg-cyan-900 text-cyan-200' : 'text-slate-500 hover:text-slate-300'}`}
                            title="Show Last 2000 Lines"
                        >
                            <ArrowDownCircle className="w-3 h-3" /> TAIL
                        </button>
                    </div>
                )}
                
                <div className="hidden sm:flex items-center gap-1 bg-slate-800 rounded px-2 py-0.5 border border-slate-700/50 group-focus-within:border-cyan-500/50 transition-colors">
                    <Search className="w-3 h-3 text-slate-400" />
                    <input 
                        type="text" 
                        placeholder="Search current view..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="bg-transparent text-[10px] font-mono text-slate-300 outline-none w-24 focus:w-48 transition-all placeholder:text-slate-600"
                    />
                </div>
            </div>

            <div className="flex items-center gap-2 px-2">
                {activeTab === 'log' && (
                    <>
                        <button 
                            onClick={() => setIsPaused(!isPaused)} 
                            className={`p-1.5 rounded hover:bg-slate-700 transition-colors ${isPaused ? 'text-yellow-400 bg-yellow-400/10' : 'text-slate-400'}`}
                        >
                            {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
                        </button>
                        <button onClick={() => SystemLogger.downloadLogs()} className="text-slate-400 hover:text-white p-1.5 rounded hover:bg-slate-700 transition-colors">
                            <Save className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => { SystemLogger.clear(); setLogs([]); }} className="text-slate-400 hover:text-red-400 p-1.5 rounded hover:bg-slate-700 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </>
                )}
            </div>
        </div>

        {/* Content Area */}
        <div 
            ref={scrollRef}
            onScroll={handleScroll}
            className={`flex-1 overflow-auto p-0 font-mono text-[10px] scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent ${crtMode ? 'crt-glow' : ''}`}
        >
            {activeTab === 'log' ? (
                <div className="p-4 space-y-0.5">
                    {filteredLogs.map((l) => (
                        <div key={l.id} className="flex gap-3 hover:bg-slate-900/50 p-0.5 px-1 rounded transition-colors group/item">
                            <span className="text-slate-600 w-16 shrink-0 opacity-70 tabular-nums">[{new Date(l.timestamp).toLocaleTimeString().split(' ')[0]}]</span>
                            <span className={`font-bold w-20 text-right shrink-0 truncate ${
                                l.level === 'error' ? 'text-red-500' : 
                                l.level === 'warn' ? 'text-yellow-500' : 
                                l.level === 'debug' ? 'text-slate-500' : 'text-cyan-600'
                            }`}>
                                {l.component}
                            </span>
                            <div className="flex-1 min-w-0">
                                <span className={`break-all ${
                                    l.level === 'error' ? 'text-red-400 font-bold' : 
                                    l.level === 'warn' ? 'text-yellow-200' : 
                                    l.level === 'debug' ? 'text-slate-400' : 'text-slate-300'
                                }`}>
                                    {l.message}
                                </span>
                            </div>
                        </div>
                    ))}
                    <div ref={endRef} />
                </div>
            ) : activeTab === 'trace' ? (
                <div className="w-full min-h-full bg-slate-950/30">
                    <div className="grid grid-cols-[80px_1fr_200px] gap-2 bg-slate-900 p-2 border-b border-slate-800 text-slate-500 font-bold sticky top-0 z-10">
                        <div>CYCLES</div>
                        <div>INSTRUCTION</div>
                        <div>REGISTERS</div>
                    </div>
                    {filteredTrace.map((t, idx) => (
                        <div key={idx} className="grid grid-cols-[80px_1fr_200px] gap-2 p-1 px-2 hover:bg-slate-900/50 border-b border-slate-900/30 text-slate-300">
                            <div className="text-slate-500 tabular-nums">{t.cycles}</div>
                            <div className="font-bold text-cyan-300 break-all">{t.instruction}</div>
                            <div className="text-slate-400 flex flex-wrap gap-x-2 text-[9px] items-center">
                                <span>A:<span className="text-white">{t.a.toString(16).toUpperCase().padStart(2,'0')}</span></span>
                                <span>X:<span className="text-white">{t.x.toString(16).toUpperCase().padStart(2,'0')}</span></span>
                                <span>Y:<span className="text-white">{t.y.toString(16).toUpperCase().padStart(2,'0')}</span></span>
                                <span className="text-yellow-600">{getFlagStr(t.flags)}</span>
                            </div>
                        </div>
                    ))}
                    <div ref={endRef} />
                </div>
            ) : (
                <div className="w-full min-h-full bg-slate-950/30">
                    <div className="grid grid-cols-[100px_60px_120px_1fr] gap-2 bg-slate-900 p-2 border-b border-slate-800 text-slate-500 font-bold sticky top-0 z-10">
                        <div>CYCLES</div>
                        <div>CHIP</div>
                        <div>REGISTER</div>
                        <div>VALUE</div>
                    </div>
                    {displayedWrites.map((w, idx) => (
                        <div key={idx} className="grid grid-cols-[100px_60px_120px_1fr] gap-2 p-1 px-2 hover:bg-cyan-950/20 border-b border-slate-900/30 text-slate-300 transition-colors">
                            <div className="text-slate-500 tabular-nums">{w.cycles}</div>
                            <div className="text-cyan-600 font-bold">#{w.chipIdx + 1}</div>
                            <div className="text-cyan-300 font-bold">
                                {getRegName(w.reg)}
                                <span className="text-[8px] text-slate-600 ml-1">(${(w.reg).toString(16).toUpperCase()})</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-white font-black bg-slate-800 px-1.5 rounded">$${w.val.toString(16).toUpperCase().padStart(2, '0')}</span>
                                <span className="text-[8px] text-slate-600">({w.val})</span>
                                <div className="h-1.5 flex-1 bg-slate-900 rounded-full overflow-hidden max-w-[100px]">
                                    <div className="h-full bg-cyan-500/40" style={{ width: `${(w.val/255)*100}%` }} />
                                </div>
                            </div>
                        </div>
                    ))}
                    {sidWrites && sidWrites.length > 2000 && (
                        <div className="p-4 text-center text-slate-500 italic text-[9px] border-t border-slate-900">
                            {sidViewMode === 'tail' 
                                ? `Showing last 2,000 of ${sidWrites.length} events. Switch to HEAD to see start.` 
                                : `Showing first 2,000 of ${sidWrites.length} events. Switch to TAIL to follow playback.`}
                        </div>
                    )}
                    <div ref={endRef} />
                </div>
            )}
        </div>
    </div>
  );
};
