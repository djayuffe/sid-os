
import { ParsedTrace } from '../types';
import { SystemLogger } from './Logger';

const PLAYER_ADDR = 0x1000;
const MAX_SID_DATA_SIZE = 0xC000; // Keep below $D000 (IO area)
const HEADER_SIZE = 0x7C;
const DATA_OFFSET = 0x200; // Offset from Load Address to Data Start

// 6502 Opcodes
const LDA_IMM = 0xA9; const LDA_ABS = 0xAD;
const STA_ABS = 0x8D; const STA_ABSX = 0x9D;
const LDX_IMM = 0xA2; 
const DEX = 0xCA; const INX = 0xE8;
const TAY = 0xA8; const TYA = 0x98; const TAX = 0xAA; const TXA = 0x8A;
const BNE = 0xD0; const BEQ = 0xF0; const BPL = 0x10; const BCS = 0xB0;
const JMP_ABS = 0x4C; const RTS = 0x60; const JSR = 0x20;
const CMP_IMM = 0xC9; const SEC = 0x38; const SBC_IMM = 0xE9; 
const AND_IMM = 0x29; 
const INC_ABS = 0xEE; const DEC_ABS = 0xCE;
const SEI = 0x78; const CLI = 0x58;
const PHA = 0x48; const PLA = 0x68;

// Protocol Constants
const CMD_END = 0x1E;       // End of Stream
const CMD_DELAY_BASE = 0x20; // Start of Delay opcodes ($20 = 1 frame)
const REG_COUNT = 25;       // Standard SID Registers 0-24 ($00-$18)
const CMD_MACRO_BASE = 0x19;

/**
 * Minimal 6502 Assembler Helper
 */
class Asm6502 {
    public bytes: number[] = [];
    private labels = new Map<string, number>();
    private fixups: { type: 'rel' | 'abs' | 'lo' | 'hi', at: number, label: string }[] = [];

    constructor(public origin: number) {}

    // Define a label at current position
    label(name: string) {
        if (this.labels.has(name)) throw new Error(`Duplicate label: ${name}`);
        this.labels.set(name, this.bytes.length);
    }

    get currentPC() { return this.origin + this.bytes.length; }

    getLabelOffset(name: string) {
        return this.labels.get(name);
    }

    emit(...vals: number[]) {
        for (const v of vals) this.bytes.push(v & 0xFF);
    }

    // Branch (Relative)
    br(op: number, label: string) {
        this.emit(op, 0x00);
        this.fixups.push({ type: 'rel', at: this.bytes.length - 1, label });
    }

    // Jump/Call (Absolute)
    jmp(label: string) {
        this.emit(JMP_ABS, 0x00, 0x00);
        this.fixups.push({ type: 'abs', at: this.bytes.length - 2, label });
    }
    
    jsr(label: string) {
        this.emit(JSR, 0x00, 0x00);
        this.fixups.push({ type: 'abs', at: this.bytes.length - 2, label });
    }

    // Load Immediate with Label Address Lo/Hi
    lda_lo(label: string) {
        this.emit(LDA_IMM, 0x00);
        this.fixups.push({ type: 'lo', at: this.bytes.length - 1, label });
    }
    
    lda_hi(label: string) {
        this.emit(LDA_IMM, 0x00);
        this.fixups.push({ type: 'hi', at: this.bytes.length - 1, label });
    }

    // Absolute ops with Label
    op_abs(op: number, label: string) {
        this.emit(op, 0x00, 0x00);
        this.fixups.push({ type: 'abs', at: this.bytes.length - 2, label });
    }
    
    resolve() {
        for (const f of this.fixups) {
            const targetOffset = this.labels.get(f.label);
            if (targetOffset === undefined) throw new Error(`Unknown label: ${f.label}`);
            
            const targetAddr = this.origin + targetOffset;

            if (f.type === 'rel') {
                const nextAddr = this.origin + f.at + 1;
                let rel = targetAddr - nextAddr;
                if (rel < -128 || rel > 127) throw new Error(`Branch out of range: ${f.label}`);
                if (rel < 0) rel = 256 + rel;
                this.bytes[f.at] = rel;
            } else if (f.type === 'abs') {
                this.bytes[f.at] = targetAddr & 0xFF;
                this.bytes[f.at + 1] = (targetAddr >> 8) & 0xFF;
            } else if (f.type === 'lo') {
                this.bytes[f.at] = targetAddr & 0xFF;
            } else if (f.type === 'hi') {
                this.bytes[f.at] = (targetAddr >> 8) & 0xFF;
            }
        }
    }
}

export class SidComposerService {

    private static stringToBytes(str: string, length: number): number[] {
        const arr = new Array(length).fill(0);
        // Sanitize to ASCII, replacing unsupported chars
        const clean = (str || "Unknown").replace(/[^a-zA-Z0-9\s\-_.,()!]/g, '').substring(0, length);
        for (let i = 0; i < clean.length; i++) arr[i] = clean.charCodeAt(i);
        return arr;
    }

    private static compressTrace(trace: ParsedTrace): number[] {
        const stream: number[] = [];
        const prevRegs = new Int16Array(REG_COUNT).fill(-1); 
        const frames = trace.frames || [];

        const getReg = (f: any, r: number) => {
            if (!f) return 0;
            if (f.chips && Array.isArray(f.chips) && f.chips[0]) {
                if (f.chips[0].registers) return f.chips[0].registers[r] ?? 0;
                return f.chips[0][r] ?? 0;
            }
            if (f instanceof Uint8Array || Array.isArray(f)) return f[r] ?? 0;
            return 0;
        };

        for (let f = 0; f < frames.length; f++) {
            const frame = frames[f];
            const changes: {r: number, v: number}[] = [];
            
            for (let r = 0; r < REG_COUNT; r++) {
                const val = getReg(frame, r) & 0xFF;
                if (val !== prevRegs[r]) {
                    changes.push({r, v: val});
                    prevRegs[r] = val;
                }
            }

            if (changes.length > 0) {
                // PASS 1: Setup Registers (Freq, PW, ADSR, Filter)
                const setupChanges = changes.filter(c => c.r !== 4 && c.r !== 11 && c.r !== 18);
                // PASS 2: Control Registers (Gate/Waveform)
                const ctrlChanges = changes.filter(c => c.r === 4 || c.r === 11 || c.r === 18);

                const handled = new Set<number>();

                // Frequency Macros
                [[0, 0x19], [7, 0x1A], [14, 0x1B]].forEach(([base, op]) => {
                    const lo = setupChanges.find(c => c.r === base);
                    const hi = setupChanges.find(c => c.r === base + 1);
                    if (lo && hi) {
                        if (lo.v !== 0 || hi.v !== 0) {
                            stream.push(op, lo.v, hi.v);
                            handled.add(base); handled.add(base + 1);
                        }
                    }
                });

                setupChanges.forEach(c => {
                    if (handled.has(c.r)) return;
                    if (c.v === 0) stream.push(0x80 + c.r);
                    else stream.push(c.r, c.v);
                });

                ctrlChanges.forEach(c => {
                    if (c.v === 0) stream.push(0x80 + c.r);
                    else stream.push(c.r, c.v);
                });
            }
            stream.push(0x20); // End frame
        }

        // Pad
        for (let i = 0; i < 50; i++) stream.push(0x20);

        // RLE Delay
        const optimized: number[] = [];
        let pending = 0;
        
        for (let i = 0; i < stream.length; i++) {
            const token = stream[i];
            if (token === 0x20) {
                pending++;
            } else {
                if (pending > 0) {
                    this.flushDelay(optimized, pending);
                    pending = 0;
                }
                optimized.push(token);
            }
        }
        if (pending > 0) this.flushDelay(optimized, pending);

        optimized.push(CMD_END);
        return optimized;
    }

    private static flushDelay(out: number[], count: number) {
        const MAX_PER_BYTE = 96; 
        while (count > 0) {
            const chunk = Math.min(count, MAX_PER_BYTE);
            out.push((chunk - 1) + CMD_DELAY_BASE);
            count -= chunk;
        }
    }

    public static compile(trace: ParsedTrace, model: '6581' | '8580' = '6581'): Blob {
        try {
            SystemLogger.log('SidComposer', 'Compiling Bulletproof 6502 Player...', 'info');

            let dataStream = this.compressTrace(trace);
            const asm = new Asm6502(PLAYER_ADDR);

            // --- VECTORS ---
            asm.jmp('INIT');
            asm.jmp('PLAY');

            // --- INTERNALIZED VARIABLES ---
            asm.label('VAR_DELAY'); asm.emit(0x01); // Delay counter

            // --- GET_BYTE SUBROUTINE (SMC) ---
            asm.label('GET_BYTE');
            asm.emit(LDA_ABS); // Opcode
            asm.label('SMC_PTR_LO'); asm.emit(0x00); // Operand Low
            asm.label('SMC_PTR_HI'); asm.emit(0x00); // Operand High
            
            // Increment 16-bit Pointer in-place
            asm.op_abs(INC_ABS, 'SMC_PTR_LO');
            asm.emit(BNE, 0x03); 
            asm.op_abs(INC_ABS, 'SMC_PTR_HI');
            
            asm.emit(RTS);

            // --- INIT ($1000 + offset) ---
            asm.label('INIT');
            asm.emit(SEI);
            
            // 1. Initialize SMC Pointer to Data Start
            asm.lda_lo('DATA_START'); 
            asm.op_abs(STA_ABS, 'SMC_PTR_LO');
            
            asm.lda_hi('DATA_START'); 
            asm.op_abs(STA_ABS, 'SMC_PTR_HI');
            
            // 2. Reset Delay
            asm.emit(LDA_IMM, 0x01);
            asm.op_abs(STA_ABS, 'VAR_DELAY');
            
            // 3. Clear SID Loop
            asm.emit(LDX_IMM, 0x18); 
            asm.emit(LDA_IMM, 0x00);
            asm.label('CLR_LOOP');
            asm.emit(STA_ABSX, 0x00, 0xD4);
            asm.emit(DEX);
            asm.br(BPL, 'CLR_LOOP');
            
            // 4. Force Max Volume
            asm.emit(LDA_IMM, 0x0F, STA_ABS, 0x18, 0xD4);
            
            asm.emit(CLI);
            asm.emit(RTS);

            // --- PLAY ROUTINE ---
            asm.label('PLAY');
            
            // 1. Context Safety: Save Registers
            asm.emit(PHA, TXA, PHA, TYA, PHA);
            
            // 2. Handle Delay
            asm.op_abs(DEC_ABS, 'VAR_DELAY');
            asm.emit(BNE, 0x03); 
            asm.jmp('PROCESS_FRAME'); 
            
            asm.label('EXIT_FRAME');
            // 3. Context Safety: Restore Registers
            asm.emit(PLA, TAY, PLA, TAX, PLA);
            asm.emit(RTS);

            // --- FRAME PROCESSOR ---
            asm.label('PROCESS_FRAME');
            
            asm.label('FETCH_LOOP');
            asm.jsr('GET_BYTE'); // A = Next Byte
            
            // Check Tokens
            asm.emit(CMP_IMM, CMD_END);
            asm.br(BEQ, 'DO_LOOP_END');
            
            asm.emit(CMP_IMM, CMD_DELAY_BASE);
            asm.br(BCS, 'HANDLE_DELAY'); // >= $20
            
            asm.emit(CMP_IMM, CMD_MACRO_BASE);
            asm.br(BCS, 'HANDLE_MACRO'); // >= $19 (and < $20)
            
            // REGULAR REGISTER WRITE ($00 - $18)
            asm.emit(TAX);          // X = Register
            asm.jsr('GET_BYTE');    // Get Value
            asm.emit(STA_ABSX, 0x00, 0xD4);
            asm.jmp('FETCH_LOOP');

            asm.label('HANDLE_DELAY');
            asm.emit(CMP_IMM, 0x80);
            asm.br(BCS, 'HANDLE_ZERO'); // >= $80 is Zero-Write shortcut
            
            // It is a delay ($20-$7F)
            asm.emit(SEC, SBC_IMM, 0x1F); // Convert $20->1, $21->2
            asm.op_abs(STA_ABS, 'VAR_DELAY');
            asm.jmp('EXIT_FRAME');

            asm.label('HANDLE_ZERO');
            // Zero Write Shortcut ($80+Reg)
            asm.emit(AND_IMM, 0x1F); // Get Reg Index
            asm.emit(TAX);
            asm.emit(LDA_IMM, 0x00);
            asm.emit(STA_ABSX, 0x00, 0xD4);
            asm.jmp('FETCH_LOOP');

            asm.label('HANDLE_MACRO');
            // Macros ($19=V1, $1A=V2, $1B=V3 Freq)
            asm.emit(SEC, SBC_IMM, 0x19, TAY); // Y = 0, 1, 2
            asm.op_abs(0xB9, 'MACRO_TABLE');   // LDA MACRO_TABLE, Y
            asm.emit(TAX);                     // X = Base Reg
            asm.jsr('GET_BYTE'); asm.emit(STA_ABSX, 0x00, 0xD4, INX); // Lo
            asm.jsr('GET_BYTE'); asm.emit(STA_ABSX, 0x00, 0xD4);      // Hi
            asm.jmp('FETCH_LOOP');

            asm.label('DO_LOOP_END');
            // Loop song
            asm.jsr('INIT'); 
            asm.jmp('EXIT_FRAME');

            // Tables
            asm.label('MACRO_TABLE');
            asm.emit(0x00, 0x07, 0x0E); 

            // Padding
            const currentSize = asm.bytes.length;
            if (currentSize > DATA_OFFSET) {
                throw new Error(`Player code too large (${currentSize} bytes > ${DATA_OFFSET}).`);
            }
            const padding = DATA_OFFSET - currentSize;
            for(let i=0; i<padding; i++) asm.emit(0x00);
            
            asm.label('DATA_START');
            
            asm.resolve();
            const codeBytes = asm.bytes;

            const totalSize = DATA_OFFSET + dataStream.length;
            if (totalSize > MAX_SID_DATA_SIZE) {
                SystemLogger.log('SidComposer', `Data too large (${totalSize}). Truncating.`, 'warn');
                const maxData = MAX_SID_DATA_SIZE - DATA_OFFSET;
                dataStream = dataStream.slice(0, maxData);
                dataStream[dataStream.length - 1] = CMD_END;
            }

            const fileData = new Uint8Array(HEADER_SIZE + 2 + DATA_OFFSET + dataStream.length);
            const view = new DataView(fileData.buffer);

            // Header (0x00 - 0x7C)
            const magic = "PSID";
            for (let i = 0; i < 4; i++) view.setUint8(i, magic.charCodeAt(i));
            view.setUint16(4, 2); 
            view.setUint16(6, HEADER_SIZE); // 0x007C
            view.setUint16(8, 0x0000); 
            view.setUint16(10, PLAYER_ADDR); 
            
            const playOffset = asm.getLabelOffset('PLAY');
            if (playOffset === undefined) throw new Error("Could not locate PLAY");
            view.setUint16(12, PLAYER_ADDR + playOffset); 
            
            view.setUint16(14, 1); 
            view.setUint16(16, 1); 
            view.setUint32(18, 0); 

            // Use metadata from trace header for Title/Author/Released
            const setStr = (off: number, s: string) => {
                const b = this.stringToBytes(s, 32);
                for(let i=0; i<32; i++) view.setUint8(off+i, b[i]);
            };
            
            // Prefer original filename if song title is generic or missing
            const songTitle = (trace.header.song && trace.header.song !== 'Unknown') 
                ? trace.header.song 
                : (trace.header.originalFilename ? trace.header.originalFilename.replace(/\.[^/.]+$/, "") : "Export");

            setStr(0x16, songTitle);
            setStr(0x36, trace.header.author || "SID Composer");
            setStr(0x56, trace.header.copyright || "2025");

            // Forced PAL (50Hz) to match trace bucket rate
            const videoBits = 1; // 1 = PAL
            const modelBits = model === '8580' ? 2 : 1;
            const flags = (videoBits << 2) | (modelBits << 4);
            view.setUint16(0x76, flags); // Flags (0x76-0x77)

            // Padding Correction: Explicitly zero offsets 0x78-0x7B (4 bytes)
            view.setUint8(0x78, 0);
            view.setUint8(0x79, 0);
            view.setUint8(0x7A, 0);
            view.setUint8(0x7B, 0);

            let p = HEADER_SIZE; // 0x7C
            
            // Load Address (Little Endian) at start of data stream
            view.setUint8(p++, PLAYER_ADDR & 0xFF);
            view.setUint8(p++, (PLAYER_ADDR >> 8) & 0xFF);

            fileData.set(codeBytes, p);
            fileData.set(dataStream, p + codeBytes.length);

            SystemLogger.log('SidComposer', `Export Success. Size: ${fileData.length}b`, 'info');
            return new Blob([fileData], { type: 'application/octet-stream' });

        } catch (e: any) {
            SystemLogger.log('SidComposer', `Export Error: ${e.message}`, 'error');
            throw e;
        }
    }
}
