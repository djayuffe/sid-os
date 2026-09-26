
import { SidHeader, SidDump, SidDumpFrame, SidRegisterWrite, C64Config, CpuTraceEntry } from './SidTypes';
import { C64System } from './C64System';
import { SystemLogger } from '../../services/Logger';
import { SidAnalyzer } from '../analysis';

interface RoutineResult {
    cycles: number;
    timedOut: boolean;
    halted: boolean;
    reason: string;
    trace?: CpuTraceEntry[];
}

export class SidPlayer {
    private c64: C64System;
    private static cachedRoms: { kernal: Uint8Array, basic: Uint8Array, chargen: Uint8Array } | null = null;

    constructor() { this.c64 = new C64System(); }

    private async loadRoms(): Promise<boolean> {
        if (SidPlayer.cachedRoms) return true;
        try {
            SystemLogger.log('SidPlayer', 'Fetching hardware ROMs from mirrors...', 'info');
            const fetchRom = async (url: string) => {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return new Uint8Array(await res.arrayBuffer());
            };
            SidPlayer.cachedRoms = {
                kernal: await fetchRom('https://www.zimmers.net/anonftp/pub/cbm/firmware/computers/c64/kernal.901227-03.bin'),
                basic: await fetchRom('https://www.zimmers.net/anonftp/pub/cbm/firmware/computers/c64/basic.901226-01.bin'),
                chargen: await fetchRom('https://www.zimmers.net/anonftp/pub/cbm/firmware/computers/c64/characters.901225-01.bin')
            };
            SystemLogger.log('SidPlayer', 'C64 Hardware ROMs ready.', 'info');
            return true;
        } catch (e: any) { 
            SystemLogger.log('SidPlayer', `ROM Fetch failed: ${e.message}. Falling back to HLE.`, 'warn');
            return false; 
        }
    }

    private async executeRoutine(addr: number, timeout: number, name: string): Promise<RoutineResult> {
        const returnAddr = 0xFFFF;
        // Clean stack for execution
        this.c64.cpu.sp = 0xFF;
        this.c64.cpu.push(0xFF); // Lo
        this.c64.cpu.push(0xFE); // Hi (Return to $FFFF)
        this.c64.cpu.pc = addr;
        
        let used = 0;
        let finished = false;
        let reason = 'finished';

        while (used < timeout) {
            if (this.c64.cpu.halted) { reason = 'jam'; finished = true; break; }
            if (this.c64.cpu.pc === returnAddr) { reason = 'return'; finished = true; break; }
            
            // Vanish-Init detection: JMP to self
            const op = this.c64.peek(this.c64.cpu.pc);
            if (op === 0x4C) { 
                const target = this.c64.peek(this.c64.cpu.pc+1) | (this.c64.peek(this.c64.cpu.pc+2) << 8);
                if (target === this.c64.cpu.pc) { 
                    reason = 'loop'; 
                    finished = true; 
                    SystemLogger.log('SidPlayer', `Vanish-Init: Infinite loop at $${this.c64.cpu.pc.toString(16).toUpperCase()}`, 'debug');
                    break; 
                }
            }

            used += this.c64.step();
            if (used % 1000000 === 0) await new Promise(r => setTimeout(r, 0));
        }

        if (!finished) reason = 'timeout';
        return { cycles: used, timedOut: !finished, halted: this.c64.cpu.halted, reason, trace: this.c64.cpu.getTrace() };
    }

    public async convert(
        header: SidHeader, 
        sidData: Uint8Array, 
        fullFile: ArrayBuffer, 
        songNr: number = header.startSong,
        duration: number = 60,
        config: C64Config,
        onProgress?: (p: number) => void
    ): Promise<SidDump> {
        const isRsid = header.magic === 'RSID';
        if (isRsid) await this.loadRoms();

        const effectiveConfig: C64Config = { 
            ...config, 
            roms: (isRsid && SidPlayer.cachedRoms) ? SidPlayer.cachedRoms : config.roms || {} 
        };

        this.c64.init(header.isNtsc, header.clockFreq, effectiveConfig);
        this.c64.copyRomsToRam();
        this.c64.configureSids(header);

        // RSID SPEC: Pre-initialize KERNAL vectors for tunes that use standard IRQ hooks
        if (isRsid) {
            // Default KERNAL IRQ vector $0314 -> $EA31
            this.c64.write16(0x0314, 0xEA31);
            this.c64.write16(0x0316, 0xFE66); // NMI vector
            // Standard KERNAL vectors usually initialized by IOINIT/RESTOR
            SystemLogger.log('SidPlayer', 'RSID: KERNAL vectors initialized to default ($EA31).', 'debug');
        }

        // Load data into RAM
        for(let i=0; i<sidData.length; i++) {
            this.c64.ram[header.loadAddress + i] = sidData[i];
        }

        if (isRsid && header.c64BasicFlag) { 
            this.c64.write16(0x2B, 0x0801); 
            this.c64.write16(0x2D, 0x0803); 
        }

        // Routine setup
        this.c64.cpu.a = (songNr - 1); 
        this.c64.cpu.x = 0; 
        this.c64.cpu.y = 0;
        
        const writeLog: SidRegisterWrite[] = [];
        this.c64.onSidWrite = (chipIdx, reg, val, cycles) => writeLog.push({ chipIdx, reg, val, cycles });

        SystemLogger.log('SidPlayer', `Invoking Init at $${header.initAddress.toString(16).toUpperCase()}`, 'info');
        const initRes = await this.executeRoutine(header.initAddress, 5000000, 'Init');
        
        const isInterruptDriven = header.playAddress === 0 || initRes.timedOut || initRes.reason === 'loop';

        // Enable interrupts for playback loop
        if (isRsid || isInterruptDriven) {
            this.c64.cpu.flags &= ~0x04; // CLI
            SystemLogger.log('SidPlayer', 'Interrupts enabled for playback cycle.', 'debug');
        }

        const frames: SidDumpFrame[] = [];
        const fps = header.isNtsc ? 60 : 50;
        const cyclesPerFrame = Math.floor(header.clockFreq / fps);
        const targetFrames = duration * fps;

        for (let f=0; f<targetFrames; f++) {
            if (f % 500 === 0 && onProgress) { 
                onProgress(Math.floor((f / targetFrames) * 100)); 
                await new Promise(r => setTimeout(r, 0)); 
            }

            if (isInterruptDriven) {
                // CIA/VIC-driven tunes: Run system for one frame's duration
                const start = this.c64.cpu.cycles;
                while (this.c64.cpu.cycles - start < cyclesPerFrame) {
                    this.c64.step();
                    if (this.c64.cpu.halted) break;
                }
            } else {
                // Explicit Play routine tunes
                const playRes = await this.executeRoutine(header.playAddress, 2000000, 'Play');
                const rem = cyclesPerFrame - playRes.cycles;
                if (rem > 0) {
                    // Hardware-only steps for remaining cycles
                    for(let i=0; i<rem; i++) {
                        this.c64.cia1.step(1); 
                        this.c64.cia2.step(1); 
                        this.c64.vic.step(1);
                        if (this.c64.cia1.irqLine || this.c64.vic.irqLine) this.c64.cpu.irq();
                        this.c64.sids.forEach(s => s.update(1));
                    }
                    this.c64.cpu.cycles += rem;
                }
            }

            frames.push({ 
                frame: f, 
                time: f/fps, 
                cycles: this.c64.cpu.cycles, 
                chips: this.c64.sids.map(s => s.getSnapshot()) 
            });

            if (this.c64.cpu.halted) {
                SystemLogger.log('SidPlayer', `CPU Halted at frame ${f}. Stopping synthesis.`, 'error');
                break;
            }
        }

        if (onProgress) onProgress(100);
        
        const dump: SidDump = {
            metadata: header,
            originalSource: btoa(String.fromCharCode(...new Uint8Array(fullFile))),
            frames, 
            writeLog, 
            totalDuration: frames.length/fps, 
            frameCount: frames.length,
            detectedRefreshRate: fps, 
            cpuTrace: this.c64.cpu.getTrace(), 
            config: effectiveConfig
        };
        
        dump.analysis = SidAnalyzer.analyze(dump);
        return dump;
    }
}
