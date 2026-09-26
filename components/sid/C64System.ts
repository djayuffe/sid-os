
import { Bus, Cpu6502 } from './Cpu6502';
import { SidChip } from './SidChip';
import { C64Config, SidHeader } from './SidTypes';
import { SystemLogger } from '../../services/Logger';

export class Cia6526 {
    private name: string;
    public pra = 0xFF; public prb = 0xFF;
    public ddra = 0; public ddrb = 0;
    public latchA = 1; public latchB = 1;
    public timerA = 0xFFFF; public timerB = 0xFFFF;
    public icr = 0; public icrMask = 0;
    public cra = 0; public crb = 0;
    public irqLine = false;

    constructor(name: string) {
        this.name = name;
    }

    public reset() {
        this.pra = 0xFF; this.prb = 0xFF; this.ddra = 0; this.ddrb = 0;
        this.icr = 0; this.icrMask = 0; this.cra = 0; this.crb = 0;
        this.timerA = 0xFFFF; this.timerB = 0xFFFF;
        this.latchA = 0xFFFF; this.latchB = 0xFFFF;
        this.irqLine = false;
    }

    public step(cycles: number) {
        for (let i = 0; i < cycles; i++) {
            let underflowA = false;
            // Timer A logic
            if (this.cra & 0x01) {
                if (this.timerA === 0) {
                    this.timerA = this.latchA; 
                    this.icr |= 0x01; 
                    underflowA = true;
                    if (this.cra & 0x08) this.cra &= ~0x01; // One-shot
                } else {
                    this.timerA--;
                }
            }

            // Timer B logic
            if (this.crb & 0x01) {
                const mode = (this.crb >> 5) & 0x03;
                // Mode 0: System cycles, Mode 2: Timer A underflows
                let countB = (mode === 0) || (mode === 2 && underflowA);
                if (countB) {
                    if (this.timerB === 0) {
                        this.timerB = this.latchB; 
                        this.icr |= 0x02;
                        if (this.crb & 0x08) this.crb &= ~0x01; // One-shot
                    } else {
                        this.timerB--;
                    }
                }
            }

            // IRQ Line (Wire-OR logic)
            this.irqLine = (this.icr & this.icrMask) !== 0;
        }
    }

    public read(reg: number): number {
        reg &= 0x0F;
        if (reg === 0x0D) {
            // ICR Read CLEAR-ON-READ
            const val = (this.icr & 0x1F) | (this.irqLine ? 0x80 : 0);
            this.icr = 0; 
            this.irqLine = false; 
            return val;
        }
        switch(reg) {
            case 0x00: return this.pra; 
            case 0x01: return this.prb;
            case 0x02: return this.ddra;
            case 0x03: return this.ddrb;
            case 0x04: return this.timerA & 0xFF; 
            case 0x05: return this.timerA >> 8;
            case 0x06: return this.timerB & 0xFF; 
            case 0x07: return this.timerB >> 8;
            case 0x0E: return this.cra; 
            case 0x0F: return this.crb;
            default: return 0xFF;
        }
    }

    public write(reg: number, val: number) {
        reg &= 0x0F;
        switch(reg) {
            case 0x00: this.pra = val; break; 
            case 0x01: this.prb = val; break;
            case 0x02: this.ddra = val; break; 
            case 0x03: this.ddrb = val; break;
            case 0x04: this.latchA = (this.latchA & 0xFF00) | val; break;
            case 0x05: 
                this.latchA = (this.latchA & 0x00FF) | (val << 8); 
                if (!(this.cra & 0x01)) this.timerA = this.latchA; 
                break;
            case 0x06: this.latchB = (this.latchB & 0xFF00) | val; break;
            case 0x07: 
                this.latchB = (this.latchB & 0x00FF) | (val << 8); 
                if (!(this.crb & 0x01)) this.timerB = this.latchB; 
                break;
            case 0x0D: 
                if (val & 0x80) this.icrMask |= (val & 0x1F); 
                else this.icrMask &= ~(val & 0x1F); 
                this.irqLine = (this.icr & this.icrMask) !== 0;
                break;
            case 0x0E: 
                this.cra = val & 0xEF; 
                if (val & 0x10) this.timerA = this.latchA; 
                break;
            case 0x0F: 
                this.crb = val & 0xEF; 
                if (val & 0x10) this.timerB = this.latchB; 
                break;
        }
    }
}

export class VicII {
    public rasterLine = 0; public cyclesPerLine = 63; public linesPerFrame = 312;
    public cycleCounter = 0; private reg = new Uint8Array(0x40);
    public irqEnabled = 0; public irqStatus = 0;
    public irqLine = false;

    public reset() { this.reg.fill(0); this.rasterLine = 0; this.cycleCounter = 0; this.reg[0x11] = 0x1B; this.irqLine = false; }
    public setStandard(ntsc: boolean) { this.linesPerFrame = ntsc ? 263 : 312; this.cyclesPerLine = ntsc ? 65 : 63; }
    public read(addr: number): number {
        const r = addr & 0x3F;
        if (r === 0x11) return (this.reg[0x11] & 0x7F) | ((this.rasterLine & 0x100) >> 1);
        if (r === 0x12) return this.rasterLine & 0xFF;
        if (r === 0x19) return this.irqStatus | 0x70;
        return this.reg[r];
    }
    public write(addr: number, val: number) {
        const r = addr & 0x3F;
        if (r === 0x11) this.reg[0x11] = val; else if (r === 0x12) this.reg[0x12] = val;
        else if (r === 0x19) { 
            this.irqStatus &= ~(val & 0x0F); 
            if (!(this.irqStatus & 0x0F)) this.irqStatus &= ~0x80; 
            this.updateIrqLine();
        }
        else if (r === 0x1A) { this.irqEnabled = val; this.updateIrqLine(); }
        else this.reg[r] = val;
    }
    private updateIrqLine() {
        this.irqLine = (this.irqStatus & this.irqEnabled & 0x0F) !== 0;
        if (this.irqLine) this.irqStatus |= 0x80;
    }
    public step(cycles: number) {
        this.cycleCounter += cycles;
        while (this.cycleCounter >= this.cyclesPerLine) {
            this.cycleCounter -= this.cyclesPerLine; this.rasterLine++;
            if (this.rasterLine >= this.linesPerFrame) this.rasterLine = 0;
            const targetLine = this.reg[0x12] | ((this.reg[0x11] & 0x80) << 1);
            if (this.rasterLine === targetLine) {
                this.irqStatus |= 0x01;
                this.updateIrqLine();
            }
        }
    }
}

export class C64System implements Bus {
    public cpu: Cpu6502; public ram = new Uint8Array(65536);
    public cia1 = new Cia6526('CIA1'); public cia2 = new Cia6526('CIA2');
    public vic = new VicII(); public sids: SidChip[] = [];
    public colorRam = new Uint8Array(1024);
    private port = 0x37; private ddr = 0x2F;
    public kernal: Uint8Array | null = null;
    public basic: Uint8Array | null = null;
    public chargen: Uint8Array | null = null;
    public onSidWrite?: (chipIdx: number, reg: number, val: number, cycles: number) => void;
    private sidBaseAddresses: number[] = [0xD400];
    private nmiLine = false;
    private config: C64Config | null = null;

    constructor() { this.cpu = new Cpu6502(this, this); }

    public init(isNtsc: boolean, clockHz: number, config?: C64Config) {
        this.ram.fill(0); this.colorRam.fill(0); this.cia1.reset(); this.cia2.reset(); this.vic.reset();
        this.vic.setStandard(isNtsc); 
        this.ddr = 0x2F; this.port = 0x37; this.ram[0] = 0x2F; this.ram[1] = 0x37;
        this.config = config || null;
        this.kernal = config?.roms.kernal || null; 
        this.basic = config?.roms.basic || null; 
        this.chargen = config?.roms.chargen || null;
        this.cpu.reset(); 
    }

    public step(): number {
        const c = this.cpu.step(); // Execute exactly one instruction
        this.cia1.step(c); this.cia2.step(c); this.vic.step(c);
        
        // IRQ is level-sensitive, sampled at the end of each instruction
        if (this.cia1.irqLine || this.vic.irqLine) {
            this.cpu.irq();
        }
        
        // NMI is edge-triggered (simplified for CIA2)
        if (this.cia2.irqLine) { 
            if (!this.nmiLine) { 
                this.cpu.nmi(); 
                this.nmiLine = true; 
            } 
        } else {
            this.nmiLine = false;
        }
        
        this.sids.forEach(s => s.update(c));
        return c;
    }

    public peek(addr: number): number { return this.read(addr); }
    public read(addr: number): number {
        if (addr === 0) return this.ddr; if (addr === 1) return this.port;
        const l = (this.port & 1), h = (this.port & 2), c = (this.port & 4);
        
        if (addr >= 0xA000 && addr <= 0xBFFF) { 
            if (l && h && this.basic) return this.basic[addr-0xA000]; 
            return this.ram[addr]; 
        }
        if (addr >= 0xE000 && addr <= 0xFFFF) { 
            if (h && this.kernal) return this.kernal[addr-0xE000]; 
            return this.ram[addr]; 
        }
        if (addr >= 0xD000 && addr <= 0xDFFF) {
            if (c && (h || l)) {
                if (addr >= 0xD800 && addr <= 0xDBFF) return this.colorRam[addr-0xD800] | 0xF0;
                if (addr >= 0xD400 && addr <= 0xD7FF) {
                    const sidReg = addr & 0x1F;
                    for(let i=0; i<this.sids.length; i++) {
                        const b = this.sidBaseAddresses[i];
                        if (addr >= b && addr < b+0x20) return this.sids[i].read(sidReg, 0);
                    }
                    return 0xFF;
                }
                if (addr >= 0xDC00 && addr <= 0xDCFF) return this.cia1.read(addr & 0x0F);
                if (addr >= 0xDD00 && addr <= 0xDDFF) return this.cia2.read(addr & 0x0F);
                if (addr >= 0xD000 && addr <= 0xD3FF) return this.vic.read(addr & 0x3F);
                return 0xFF;
            }
            if (!c && (h || l) && this.chargen) return this.chargen[addr-0xD000];
            return this.ram[addr];
        }
        return this.ram[addr];
    }

    public write(addr: number, val: number) {
        val &= 0xFF;
        if (addr === 0) { this.ddr = val; this.ram[0] = val; }
        else if (addr === 1) { this.port = val; this.ram[1] = val; }
        else if (addr >= 0xD000 && addr <= 0xDFFF && (this.port & 4) && ((this.port & 1) || (this.port & 2))) {
            if (addr >= 0xD800 && addr <= 0xDBFF) {
                this.colorRam[addr-0xD800] = val & 0x0F;
            } else {
                if (addr >= 0xD400 && addr <= 0xD7FF) {
                    const sidReg = addr & 0x1F;
                    for(let i=0; i<this.sids.length; i++) {
                        const b = this.sidBaseAddresses[i];
                        if (addr >= b && addr < b+0x20) { 
                            this.sids[i].write(sidReg, val); 
                            if (this.onSidWrite) this.onSidWrite(i, sidReg, val, this.cpu.cycles); 
                        }
                    }
                }
                else if (addr >= 0xDC00 && addr <= 0xDCFF) this.cia1.write(addr & 0x0F, val);
                else if (addr >= 0xDD00 && addr <= 0xDDFF) this.cia2.write(addr & 0x0F, val);
                else if (addr >= 0xD000 && addr <= 0xD3FF) this.vic.write(addr & 0x3F, val);
                else this.ram[addr] = val;
            }
        } else {
            this.ram[addr] = val;
        }
    }

    public configureSids(h: SidHeader) {
        const activeConfig: C64Config = this.config || {
            enableHle: true,
            roms: {},
            busPersistenceCycles: 0x1D00,
            enableAdsrPipeline: true,
            noiseSeed: 0x7FFFFF,
            exportDepth: 'FULL'
        };

        this.sids = h.sidAddresses.map((addr, i) => {
            const s = new SidChip(h.clockFreq, activeConfig); 
            s.setModel(h.sidModels[i]); 
            return s;
        });
        this.sidBaseAddresses = h.sidAddresses;
    }
    public write16(a:number, v:number){ this.write(a, v&0xFF); this.write(a+1, v>>8); }
    public copyRomsToRam() {
        if (this.basic) this.basic.forEach((v, i) => this.ram[0xA000 + i] = v);
        if (this.kernal) this.kernal.forEach((v, i) => this.ram[0xE000 + i] = v);
    }
}
