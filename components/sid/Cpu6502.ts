
import { SystemLogger } from '../../services/Logger';
import { CpuTraceEntry } from './SidTypes';
import { Disassembler } from './Disassembler';

export interface Bus {
  read(addr: number): number;
  write(addr: number, val: number): void;
  peek(addr: number): number; 
}

export class Cpu6502 {
  public a: number = 0;
  public x: number = 0;
  public y: number = 0;
  public sp: number = 0xff;
  public pc: number = 0;
  public flags: number = 0x34; // Bit 5 is always 1
  public halted: boolean = false;
  private bus: Bus;
  private system: any; 
  public cycles: number = 0;
  private traceBuffer: CpuTraceEntry[] = [];
  private readonly MAX_TRACE = 64;

  constructor(bus: Bus, systemRef: any) {
    this.bus = bus;
    this.system = systemRef;
  }

  public reset() {
    this.a = 0; this.x = 0; this.y = 0; this.sp = 0xff; this.flags = 0x34; 
    this.cycles = 0; this.halted = false; this.traceBuffer = [];
    this.pc = this.read16(0xFFFC);
    SystemLogger.log('CPU', `System Reset. PC: $${this.pc.toString(16).toUpperCase()}`, 'info');
  }

  public getTrace(): CpuTraceEntry[] { return [...this.traceBuffer]; }

  private logStep() {
      const entry: CpuTraceEntry = {
          cycles: this.cycles, 
          pc: this.pc, 
          a: this.a, 
          x: this.x, 
          y: this.y, 
          sp: this.sp, 
          flags: this.flags,
          instruction: Disassembler.disassemble(this.system, this.pc)
      };
      this.traceBuffer.push(entry);
      if (this.traceBuffer.length > this.MAX_TRACE) this.traceBuffer.shift();
  }

  public irq() {
    if ((this.flags & 0x04) === 0) { 
      this.push((this.pc >> 8) & 0xff); 
      this.push(this.pc & 0xff); 
      this.push(this.flags & ~0x10); // Clear B flag
      this.flags |= 0x04; 
      this.pc = this.read16(0xFFFE); 
      this.cycles += 7;
    }
  }

  public nmi() {
    this.push((this.pc >> 8) & 0xff); 
    this.push(this.pc & 0xff); 
    this.push(this.flags & ~0x10); 
    this.flags |= 0x04; 
    this.pc = this.read16(0xFFFA); 
    this.cycles += 7;
  }

  private setZN(val: number) { 
    val &= 0xFF;
    if (val === 0) this.flags |= 0x02; else this.flags &= ~0x02;
    if (val & 0x80) this.flags |= 0x80; else this.flags &= ~0x80;
  }
  private setC(val: boolean) { if (val) this.flags |= 0x01; else this.flags &= ~0x01; }
  private setV(val: boolean) { if (val) this.flags |= 0x40; else this.flags &= ~0x40; }

  public read(addr: number): number { return this.bus.read(addr & 0xFFFF); }
  public write(addr: number, val: number) { this.bus.write(addr & 0xFFFF, val & 0xFF); }
  public push(val: number) { this.write(0x0100 + this.sp, val); this.sp = (this.sp - 1) & 0xff; }
  public pop(): number { this.sp = (this.sp + 1) & 0xff; return this.read(0x0100 + this.sp); }

  private read16(addr: number): number { return this.read(addr) | (this.read(addr + 1) << 8); }
  private read16Bug(addr: number): number { return this.read(addr) | (this.read((addr & 0xFF00) | ((addr + 1) & 0xFF)) << 8); }
  private pageCross(base: number, eff: number): number { return ((base & 0xFF00) !== (eff & 0xFF00)) ? 1 : 0; }

  private adc(val: number) {
    const carry = (this.flags & 0x01);
    if (this.flags & 0x08) { 
        let low = (this.a & 0x0F) + (val & 0x0F) + carry;
        if (low > 9) low += 6;
        let high = (this.a >> 4) + (val >> 4) + (low > 15 ? 1 : 0);
        this.setZN((this.a + val + carry) & 0xFF);
        this.setV((~(this.a ^ val) & (this.a ^ (high << 4)) & 0x80) !== 0);
        if (high > 9) high += 6;
        this.setC(high > 15);
        this.a = ((high << 4) | (low & 0x0F)) & 0xFF;
    } else {
        let res = this.a + val + carry;
        this.setV((~(this.a ^ val) & (this.a ^ res) & 0x80) !== 0);
        this.setC(res > 0xFF);
        this.a = res & 0xFF;
        this.setZN(this.a);
    }
  }

  private sbc(val: number) {
    if (this.flags & 0x08) {
        const carry = (this.flags & 0x01) ? 0 : 1;
        let low = (this.a & 0x0F) - (val & 0x0F) - carry;
        if (low < 0) low -= 6;
        let high = (this.a >> 4) - (val >> 4) - (low < 0 ? 1 : 0);
        if (high < 0) high -= 6;
        let res_bcd = ((high << 4) | (low & 0x0F)) & 0xFF;
        const res_raw = (this.a - val - carry) & 0xFFFF;
        this.setC(res_raw < 0x100);
        this.setZN(res_raw & 0xFF);
        this.setV(((this.a ^ val) & (this.a ^ res_raw) & 0x80) !== 0);
        this.a = res_bcd;
    } else {
        this.adc(~val & 0xFF);
    }
  }

  public step(): number {
    if (this.halted) return 1;
    this.logStep();
    const opcode = this.read(this.pc++);
    const startCycles = this.cycles;
    this.cycles += 2; 
    this.executeOp(opcode);
    return this.cycles - startCycles;
  }

  public execute(max: number): number {
      let run = 0;
      while (run < max && !this.halted) run += this.step();
      return run;
  }

  private executeOp(op: number) {
    let addr = 0, val = 0, tmp = 0;
    const imm = () => this.read(this.pc++);
    const zp = () => this.read(this.pc++);
    const zpx = () => (this.read(this.pc++) + this.x) & 0xFF;
    const zpy = () => (this.read(this.pc++) + this.y) & 0xFF;
    const abs = () => { const a = this.read16(this.pc); this.pc += 2; return a; };
    const absx = (w = false) => { const b = abs(); if (w || this.pageCross(b, b+this.x)) this.cycles++; return (b + this.x) & 0xFFFF; };
    const absy = (w = false) => { const b = abs(); if (w || this.pageCross(b, b+this.y)) this.cycles++; return (b + this.y) & 0xFFFF; };
    const indx = () => { const p = (this.read(this.pc++) + this.x) & 0xFF; return this.read(p) | (this.read((p + 1) & 0xFF) << 8); };
    const indy = (w = false) => { const p = this.read(this.pc++); const b = this.read(p) | (this.read((p + 1) & 0xFF) << 8); if (w || this.pageCross(b, b+this.y)) this.cycles++; return (b + this.y) & 0xFFFF; };

    switch (op) {
      case 0x00: this.pc++; this.push((this.pc >> 8) & 0xff); this.push(this.pc & 0xff); this.push(this.flags | 0x10); this.flags |= 0x04; this.pc = this.read16(0xFFFE); this.cycles+=5; break;
      case 0x01: this.a |= this.read(indx()); this.setZN(this.a); this.cycles+=4; break;
      case 0x02: case 0x12: case 0x22: case 0x32: case 0x42: case 0x52: case 0x62: case 0x72: case 0x92: case 0xB2: case 0xD2: case 0xF2: this.halted = true; break;
      case 0x03: addr = indx(); val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xFF; this.write(addr, val); this.a |= val; this.setZN(this.a); this.cycles+=6; break;
      case 0x04: case 0x44: case 0x64: zp(); this.cycles++; break;
      case 0x05: this.a |= this.read(zp()); this.setZN(this.a); this.cycles++; break;
      case 0x06: addr = zp(); val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xFF; this.write(addr, val); this.setZN(val); this.cycles+=3; break;
      case 0x07: addr = zp(); val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xFF; this.write(addr, val); this.a |= val; this.setZN(this.a); this.cycles+=3; break;
      case 0x08: this.push(this.flags | 0x10); this.cycles++; break;
      case 0x09: this.a |= imm(); this.setZN(this.a); break;
      case 0x0A: this.setC((this.a & 0x80) !== 0); this.a = (this.a << 1) & 0xFF; this.setZN(this.a); break;
      case 0x0B: case 0x2B: val = imm(); this.a &= val; this.setC((this.a & 0x80) !== 0); this.setZN(this.a); break;
      case 0x0C: abs(); this.cycles+=2; break;
      case 0x0D: this.a |= this.read(abs()); this.setZN(this.a); this.cycles+=2; break;
      case 0x0E: addr = abs(); val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xFF; this.write(addr, val); this.setZN(val); this.cycles+=4; break;
      case 0x0F: addr = abs(); val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xFF; this.write(addr, val); this.a |= val; this.setZN(this.a); this.cycles+=4; break;

      case 0x10: tmp = imm(); if (tmp & 0x80) tmp -= 256; if (!(this.flags & 0x80)) { this.cycles += 1 + this.pageCross(this.pc, this.pc + tmp); this.pc += tmp; } break;
      case 0x11: this.a |= this.read(indy()); this.setZN(this.a); this.cycles+=3; break;
      case 0x13: addr = indy(true); val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xFF; this.write(addr, val); this.a |= val; this.setZN(this.a); this.cycles+=6; break;
      case 0x14: case 0x34: case 0x54: case 0x74: case 0xD4: case 0xF4: zpx(); this.cycles+=2; break;
      case 0x15: this.a |= this.read(zpx()); this.setZN(this.a); this.cycles+=2; break;
      case 0x16: addr = zpx(); val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xFF; this.write(addr, val); this.setZN(val); this.cycles+=4; break;
      case 0x17: addr = zpx(); val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xFF; this.write(addr, val); this.a |= val; this.setZN(this.a); this.cycles+=4; break;
      case 0x18: this.flags &= ~0x01; break;
      case 0x19: this.a |= this.read(absy()); this.setZN(this.a); this.cycles+=2; break;
      case 0x1A: case 0x3A: case 0x5A: case 0x7A: case 0xDA: case 0xFA: break;
      case 0x1B: addr = absy(true); val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xFF; this.write(addr, val); this.a |= val; this.setZN(this.a); this.cycles+=5; break;
      case 0x1C: case 0x3C: case 0x5C: case 0x7C: case 0xDC: case 0xFC: absx(); this.cycles+=2; break;
      case 0x1D: this.a |= this.read(absx()); this.setZN(this.a); this.cycles+=2; break;
      case 0x1E: addr = absx(true); val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xFF; this.write(addr, val); this.setZN(val); this.cycles+=5; break;
      case 0x1F: addr = absx(true); val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xFF; this.write(addr, val); this.a |= val; this.setZN(this.a); this.cycles+=5; break;

      case 0x20: addr = abs(); this.pc--; this.push((this.pc >> 8) & 0xFF); this.push(this.pc & 0xFF); this.pc = addr; this.cycles+=4; break;
      case 0x21: this.a &= this.read(indx()); this.setZN(this.a); this.cycles+=4; break;
      case 0x23: addr = indx(); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x80) !== 0); val = ((val << 1) | tmp) & 0xFF; this.write(addr, val); this.a &= val; this.setZN(this.a); this.cycles+=6; break;
      case 0x24: val = this.read(zp()); if ((this.a & val) === 0) this.flags |= 0x02; else this.flags &= ~0x02; this.flags = (this.flags & 0x3F) | (val & 0xC0); this.cycles++; break;
      case 0x25: this.a &= this.read(zp()); this.setZN(this.a); this.cycles++; break;
      case 0x26: addr = zp(); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x80) !== 0); val = ((val << 1) | tmp) & 0xFF; this.write(addr, val); this.setZN(val); this.cycles+=3; break;
      case 0x27: addr = zp(); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x80) !== 0); val = ((val << 1) | tmp) & 0xFF; this.write(addr, val); this.a &= val; this.setZN(this.a); this.cycles+=3; break;
      case 0x28: this.flags = (this.pop() | 0x30) & ~0x10; this.cycles+=2; break;
      case 0x29: this.a &= imm(); this.setZN(this.a); break;
      case 0x2A: tmp = (this.flags & 0x01); this.setC((this.a & 0x80) !== 0); this.a = ((this.a << 1) | tmp) & 0xFF; this.setZN(this.a); break;
      case 0x2C: val = this.read(abs()); if ((this.a & val) === 0) this.flags |= 0x02; else this.flags &= ~0x02; this.flags = (this.flags & 0x3F) | (val & 0xC0); this.cycles+=2; break;
      case 0x2D: this.a &= this.read(abs()); this.setZN(this.a); this.cycles+=2; break;
      case 0x2E: addr = abs(); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x80) !== 0); val = ((val << 1) | tmp) & 0xFF; this.write(addr, val); this.setZN(val); this.cycles+=4; break;
      case 0x2F: addr = abs(); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x80) !== 0); val = ((val << 1) | tmp) & 0xFF; this.write(addr, val); this.a &= val; this.setZN(this.a); this.cycles+=4; break;

      case 0x30: tmp = imm(); if (tmp & 0x80) tmp -= 256; if ((this.flags & 0x80)) { this.cycles += 1 + this.pageCross(this.pc, this.pc + tmp); this.pc += tmp; } break;
      case 0x31: this.a &= this.read(indy()); this.setZN(this.a); this.cycles+=3; break;
      case 0x33: addr = indy(true); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x80) !== 0); val = ((val << 1) | tmp) & 0xFF; this.write(addr, val); this.a &= val; this.setZN(this.a); this.cycles+=6; break;
      case 0x35: this.a &= this.read(zpx()); this.setZN(this.a); this.cycles+=2; break;
      case 0x36: addr = zpx(); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x80) !== 0); val = ((val << 1) | tmp) & 0xFF; this.write(addr, val); this.setZN(val); this.cycles+=4; break;
      case 0x37: addr = zpx(); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x80) !== 0); val = ((val << 1) | tmp) & 0xFF; this.write(addr, val); this.a &= val; this.setZN(this.a); this.cycles+=4; break;
      case 0x38: this.flags |= 0x01; break;
      case 0x39: this.a &= this.read(absy()); this.setZN(this.a); this.cycles+=2; break;
      case 0x3B: addr = absy(true); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x80) !== 0); val = ((val << 1) | tmp) & 0xFF; this.write(addr, val); this.a &= val; this.setZN(this.a); this.cycles+=5; break;
      case 0x3D: this.a &= this.read(absx()); this.setZN(this.a); this.cycles+=2; break;
      case 0x3E: addr = absx(true); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x80) !== 0); val = ((val << 1) | tmp) & 0xFF; this.write(addr, val); this.setZN(val); this.cycles+=5; break;
      case 0x3F: addr = absx(true); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x80) !== 0); val = ((val << 1) | tmp) & 0xFF; this.write(addr, val); this.a &= val; this.setZN(this.a); this.cycles+=5; break;

      case 0x40: this.flags = (this.pop() | 0x30) & ~0x10; this.pc = this.pop() | (this.pop() << 8); this.cycles+=4; break;
      case 0x41: this.a ^= this.read(indx()); this.setZN(this.a); this.cycles+=4; break;
      case 0x43: addr = indx(); val = this.read(addr); this.setC((val & 0x01) !== 0); val >>= 1; this.write(addr, val); this.a ^= val; this.setZN(this.a); this.cycles+=6; break;
      case 0x45: this.a ^= this.read(zp()); this.setZN(this.a); this.cycles++; break;
      case 0x46: addr = zp(); val = this.read(addr); this.setC((val & 0x01) !== 0); val >>= 1; this.write(addr, val); this.setZN(val); this.cycles+=3; break;
      case 0x47: addr = zp(); val = this.read(addr); this.setC((val & 0x01) !== 0); val >>= 1; this.write(addr, val); this.a ^= val; this.setZN(this.a); this.cycles+=3; break;
      case 0x48: this.push(this.a); this.cycles++; break;
      case 0x49: this.a ^= imm(); this.setZN(this.a); break;
      case 0x4A: this.setC((this.a & 0x01) !== 0); this.a >>= 1; this.setZN(this.a); break;
      case 0x4B: val = imm(); this.a &= val; this.setC((this.a & 0x01) !== 0); this.a >>= 1; this.setZN(this.a); break;
      case 0x4C: this.pc = abs(); this.cycles++; break;
      case 0x4D: this.a ^= this.read(abs()); this.setZN(this.a); this.cycles+=2; break;
      case 0x4E: addr = abs(); val = this.read(addr); this.setC((val & 0x01) !== 0); val >>= 1; this.write(addr, val); this.setZN(val); this.cycles+=4; break;
      case 0x4F: addr = abs(); val = this.read(addr); this.setC((val & 0x01) !== 0); val >>= 1; this.write(addr, val); this.a ^= val; this.setZN(this.a); this.cycles+=4; break;

      case 0x50: tmp = imm(); if (tmp & 0x80) tmp -= 256; if (!(this.flags & 0x40)) { this.cycles += 1 + this.pageCross(this.pc, this.pc + tmp); this.pc += tmp; } break;
      case 0x51: this.a ^= this.read(indy()); this.setZN(this.a); this.cycles+=3; break;
      case 0x53: addr = indy(true); val = this.read(addr); this.setC((val & 0x01) !== 0); val >>= 1; this.write(addr, val); this.a ^= val; this.setZN(this.a); this.cycles+=6; break;
      case 0x55: this.a ^= this.read(zpx()); this.setZN(this.a); this.cycles+=2; break;
      case 0x56: addr = zpx(); val = this.read(addr); this.setC((val & 0x01) !== 0); val >>= 1; this.write(addr, val); this.setZN(val); this.cycles+=4; break;
      case 0x57: addr = zpx(); val = this.read(addr); this.setC((val & 0x01) !== 0); val >>= 1; this.write(addr, val); this.a ^= val; this.setZN(this.a); this.cycles+=4; break;
      case 0x58: this.flags &= ~0x04; break;
      case 0x59: this.a ^= this.read(absy()); this.setZN(this.a); this.cycles+=2; break;
      case 0x5B: addr = absy(true); val = this.read(addr); this.setC((val & 0x01) !== 0); val >>= 1; this.write(addr, val); this.a ^= val; this.setZN(this.a); this.cycles+=5; break;
      case 0x5D: this.a ^= this.read(absx()); this.setZN(this.a); this.cycles+=2; break;
      case 0x5E: addr = absx(true); val = this.read(addr); this.setC((val & 0x01) !== 0); val >>= 1; this.write(addr, val); this.setZN(val); this.cycles+=5; break;
      case 0x5F: addr = absx(true); val = this.read(addr); this.setC((val & 0x01) !== 0); val >>= 1; this.write(addr, val); this.a ^= val; this.setZN(this.a); this.cycles+=5; break;

      case 0x60: this.pc = (this.pop() | (this.pop() << 8)) + 1; this.cycles+=4; break;
      case 0x61: this.adc(this.read(indx())); this.cycles+=4; break;
      case 0x63: addr = indx(); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x01) !== 0); val = (val >> 1) | (tmp << 7); this.write(addr, val); this.adc(val); this.cycles+=6; break;
      case 0x65: this.adc(this.read(zp())); this.cycles++; break;
      case 0x66: addr = zp(); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x01) !== 0); val = (val >> 1) | (tmp << 7); this.write(addr, val); this.setZN(val); this.cycles+=3; break;
      case 0x67: addr = zp(); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x01) !== 0); val = (val >> 1) | (tmp << 7); this.write(addr, val); this.adc(val); this.cycles+=3; break;
      case 0x68: this.a = this.pop(); this.setZN(this.a); this.cycles+=2; break;
      case 0x69: this.adc(imm()); break;
      case 0x6A: tmp = (this.flags & 0x01); this.setC((this.a & 0x01) !== 0); this.a = (this.a >> 1) | (tmp << 7); this.setZN(this.a); break;
      case 0x6B: val = imm(); this.a &= val; tmp = (this.flags & 0x01); val = (this.a >> 1) | (tmp << 7); this.a = val; this.setZN(this.a); this.setC((this.a & 0x40) !== 0); this.setV(((this.a >> 6) ^ (this.a >> 5)) !== 0); break;
      case 0x6C: this.pc = this.read16Bug(abs()); this.cycles+=3; break;
      case 0x6D: this.adc(this.read(abs())); this.cycles+=2; break;
      case 0x6E: addr = abs(); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x01) !== 0); val = (val >> 1) | (tmp << 7); this.write(addr, val); this.setZN(val); this.cycles+=4; break;
      case 0x6F: addr = abs(); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x01) !== 0); val = (val >> 1) | (tmp << 7); this.write(addr, val); this.adc(val); this.cycles+=4; break;

      case 0x70: tmp = imm(); if (tmp & 0x80) tmp -= 256; if ((this.flags & 0x40)) { this.cycles += 1 + this.pageCross(this.pc, this.pc + tmp); this.pc += tmp; } break;
      case 0x71: this.adc(this.read(indy())); this.cycles+=3; break;
      case 0x73: addr = indy(true); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x01) !== 0); val = (val >> 1) | (tmp << 7); this.write(addr, val); this.adc(val); this.cycles+=6; break;
      case 0x75: this.adc(this.read(zpx())); this.cycles+=2; break;
      case 0x76: addr = zpx(); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x01) !== 0); val = (val >> 1) | (tmp << 7); this.write(addr, val); this.setZN(val); this.cycles+=4; break;
      case 0x77: addr = zpx(); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x01) !== 0); val = (val >> 1) | (tmp << 7); this.write(addr, val); this.adc(val); this.cycles+=4; break;
      case 0x78: this.flags |= 0x04; break;
      case 0x79: this.adc(this.read(absy())); this.cycles+=2; break;
      case 0x7B: addr = absy(true); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x01) !== 0); val = (val >> 1) | (tmp << 7); this.write(addr, val); this.adc(val); this.cycles+=5; break;
      case 0x7D: this.adc(this.read(absx())); this.cycles+=2; break;
      case 0x7E: addr = absx(true); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x01) !== 0); val = (val >> 1) | (tmp << 7); this.write(addr, val); this.setZN(val); this.cycles+=5; break;
      case 0x7F: addr = absx(true); val = this.read(addr); tmp = (this.flags & 0x01); this.setC((val & 0x01) !== 0); val = (val >> 1) | (tmp << 7); this.write(addr, val); this.adc(val); this.cycles+=5; break;

      case 0x80: case 0x82: case 0x89: case 0xC2: case 0xE2: imm(); break;
      case 0x81: this.write(indx(), this.a); this.cycles+=4; break;
      case 0x83: this.write(indx(), this.a & this.x); this.cycles+=4; break;
      case 0x84: this.write(zp(), this.y); this.cycles++; break;
      case 0x85: this.write(zp(), this.a); this.cycles++; break;
      case 0x86: this.write(zp(), this.x); this.cycles++; break;
      case 0x87: this.write(zp(), this.a & this.x); this.cycles++; break;
      case 0x88: this.y = (this.y - 1) & 0xFF; this.setZN(this.y); break;
      case 0x8A: this.a = this.x; this.setZN(this.a); break;
      case 0x8B: val = imm(); this.a = this.x & val; this.setZN(this.a); break;
      case 0x8C: this.write(abs(), this.y); this.cycles+=2; break;
      case 0x8D: this.write(abs(), this.a); this.cycles+=2; break;
      case 0x8E: this.write(abs(), this.x); this.cycles+=2; break;
      case 0x8F: this.write(abs(), this.a & this.x); this.cycles+=2; break;

      case 0x90: tmp = imm(); if (tmp & 0x80) tmp -= 256; if (!(this.flags & 0x01)) { this.cycles += 1 + this.pageCross(this.pc, this.pc + tmp); this.pc += tmp; } break;
      case 0x91: this.write(indy(true), this.a); this.cycles+=4; break;
      case 0x93: addr = indy(); this.write(addr, this.a & this.x & ((addr >> 8) + 1)); this.cycles+=4; break;
      case 0x94: this.write(zpx(), this.y); this.cycles+=2; break;
      case 0x95: this.write(zpx(), this.a); this.cycles+=2; break;
      case 0x96: this.write(zpy(), this.x); this.cycles+=2; break;
      case 0x97: this.write(zpy(), this.a & this.x); this.cycles+=2; break;
      case 0x98: this.a = this.y; this.setZN(this.a); break;
      case 0x99: this.write(absy(true), this.a); this.cycles+=3; break;
      case 0x9A: this.sp = this.x; break;
      case 0x9B: addr = absy(); this.sp = this.a & this.x; this.write(addr, this.sp & ((addr >> 8) + 1)); this.cycles+=3; break;
      case 0x9C: addr = absx(); this.write(addr, this.y & ((addr >> 8) + 1)); this.cycles+=3; break;
      case 0x9D: this.write(absx(true), this.a); this.cycles+=3; break;
      case 0x9E: addr = absy(); this.write(addr, this.x & ((addr >> 8) + 1)); this.cycles+=3; break;
      case 0x9F: addr = absy(); this.write(addr, this.a & this.x & ((addr >> 8) + 1)); this.cycles+=3; break;

      case 0xA0: this.y = imm(); this.setZN(this.y); break;
      case 0xA1: this.a = this.read(indx()); this.setZN(this.a); this.cycles+=4; break;
      case 0xA2: this.x = imm(); this.setZN(this.x); break;
      case 0xA3: this.a = this.x = this.read(indx()); this.setZN(this.a); this.cycles+=4; break;
      case 0xA4: this.y = this.read(zp()); this.setZN(this.y); this.cycles++; break;
      case 0xA5: this.a = this.read(zp()); this.setZN(this.a); this.cycles++; break;
      case 0xA6: this.x = this.read(zp()); this.setZN(this.x); this.cycles++; break;
      case 0xA7: this.a = this.x = this.read(zp()); this.setZN(this.a); this.cycles++; break;
      case 0xA8: this.y = this.a; this.setZN(this.y); break;
      case 0xA9: this.a = imm(); this.setZN(this.a); break;
      case 0xAA: this.x = this.a; this.setZN(this.x); break;
      case 0xAB: val = imm(); this.a = this.x = (this.a | 0xEE) & val; this.setZN(this.a); break;
      case 0xAC: this.y = this.read(abs()); this.setZN(this.y); this.cycles+=2; break;
      case 0xAD: this.a = this.read(abs()); this.setZN(this.a); this.cycles+=2; break;
      case 0xAE: this.x = this.read(abs()); this.setZN(this.x); this.cycles+=2; break;
      case 0xAF: this.a = this.x = this.read(abs()); this.setZN(this.a); this.cycles+=2; break;

      case 0xB0: tmp = imm(); if (tmp & 0x80) tmp -= 256; if ((this.flags & 0x01)) { this.cycles += 1 + this.pageCross(this.pc, this.pc + tmp); this.pc += tmp; } break;
      case 0xB1: this.a = this.read(indy()); this.setZN(this.a); this.cycles+=3; break;
      case 0xB3: this.a = this.x = this.read(indy()); this.setZN(this.a); this.cycles+=3; break;
      case 0xB4: this.y = this.read(zpx()); this.setZN(this.y); this.cycles+=2; break;
      case 0xB5: this.a = this.read(zpx()); this.setZN(this.a); this.cycles+=2; break;
      case 0xB6: this.x = this.read(zpy()); this.setZN(this.x); this.cycles+=2; break;
      case 0xB7: this.a = this.x = this.read(zpy()); this.setZN(this.a); this.cycles+=2; break;
      case 0xB8: this.flags &= ~0x40; break;
      case 0xB9: this.a = this.read(absy()); this.setZN(this.a); this.cycles+=2; break;
      case 0xBA: this.x = this.sp; this.setZN(this.x); break;
      case 0xBB: addr = absy(); val = this.read(addr); this.a = this.x = this.sp = (val & this.sp); this.setZN(this.a); this.cycles+=2; break;
      case 0xBC: this.y = this.read(absx()); this.setZN(this.y); this.cycles+=2; break;
      case 0xBD: this.a = this.read(absx()); this.setZN(this.a); this.cycles+=2; break;
      case 0xBE: this.x = this.read(absy()); this.setZN(this.x); this.cycles+=2; break;
      case 0xBF: this.a = this.x = this.read(absy()); this.setZN(this.a); this.cycles+=2; break;

      case 0xC0: val = imm(); this.setC(this.y >= val); this.setZN(this.y - val); break;
      case 0xC1: val = this.read(indx()); this.setC(this.a >= val); this.setZN(this.a - val); this.cycles+=4; break;
      case 0xC3: addr = indx(); val = (this.read(addr) - 1) & 0xFF; this.write(addr, val); this.setC(this.a >= val); this.setZN(this.a - val); this.cycles+=6; break;
      case 0xC4: val = this.read(zp()); this.setC(this.y >= val); this.setZN(this.y - val); this.cycles++; break;
      case 0xC5: val = this.read(zp()); this.setC(this.a >= val); this.setZN(this.a - val); this.cycles++; break;
      case 0xC6: addr = zp(); val = (this.read(addr) - 1) & 0xFF; this.write(addr, val); this.setZN(val); this.cycles+=3; break;
      case 0xC7: addr = zp(); val = (this.read(addr) - 1) & 0xFF; this.write(addr, val); this.setC(this.a >= val); this.setZN(this.a - val); this.cycles+=3; break;
      case 0xC8: this.y = (this.y + 1) & 0xFF; this.setZN(this.y); break;
      case 0xC9: val = imm(); this.setC(this.a >= val); this.setZN(this.a - val); break;
      case 0xCA: this.x = (this.x - 1) & 0xFF; this.setZN(this.x); break;
      case 0xCB: val = imm(); this.x &= this.a; tmp = (this.x - val) & 0xFF; this.setC(this.x >= val); this.setZN(tmp); this.x = tmp; break;
      case 0xCC: val = this.read(abs()); this.setC(this.y >= val); this.setZN(this.y - val); this.cycles+=2; break;
      case 0xCD: val = this.read(abs()); this.setC(this.a >= val); this.setZN(this.a - val); this.cycles+=2; break;
      case 0xCE: addr = abs(); val = (this.read(addr) - 1) & 0xFF; this.write(addr, val); this.setZN(val); this.cycles+=4; break;
      case 0xCF: addr = abs(); val = (this.read(addr) - 1) & 0xFF; this.write(addr, val); this.setC(this.a >= val); this.setZN(this.a - val); this.cycles+=4; break;

      case 0xD0: tmp = imm(); if (tmp & 0x80) tmp -= 256; if (!(this.flags & 0x02)) { this.cycles += 1 + this.pageCross(this.pc, this.pc + tmp); this.pc += tmp; } break;
      case 0xD1: val = this.read(indy()); this.setC(this.a >= val); this.setZN(this.a - val); this.cycles+=3; break;
      case 0xD3: addr = indy(true); val = (this.read(addr) - 1) & 0xFF; this.write(addr, val); this.setC(this.a >= val); this.setZN(this.a - val); this.cycles+=6; break;
      case 0xD5: val = this.read(zpx()); this.setC(this.a >= val); this.setZN(this.a - val); this.cycles+=2; break;
      case 0xD6: addr = zpx(); val = (this.read(addr) - 1) & 0xFF; this.write(addr, val); this.setZN(val); this.cycles+=4; break;
      case 0xD7: addr = zpx(); val = (this.read(addr) - 1) & 0xFF; this.write(addr, val); this.setC(this.a >= val); this.setZN(this.a - val); this.cycles+=4; break;
      case 0xD8: this.flags &= ~0x08; break;
      case 0xD9: val = this.read(absy()); this.setC(this.a >= val); this.setZN(this.a - val); this.cycles+=2; break;
      case 0xDB: addr = absy(true); val = (this.read(addr) - 1) & 0xFF; this.write(addr, val); this.setC(this.a >= val); this.setZN(this.a - val); this.cycles+=5; break;
      case 0xDD: val = this.read(absx()); this.setC(this.a >= val); this.setZN(this.a - val); this.cycles+=2; break;
      case 0xDE: addr = absx(true); val = (this.read(addr) - 1) & 0xFF; this.write(addr, val); this.setZN(val); this.cycles+=5; break;
      case 0xDF: addr = absx(true); val = (this.read(addr) - 1) & 0xFF; this.write(addr, val); this.setC(this.a >= val); this.setZN(this.a - val); this.cycles+=5; break;

      case 0xE0: val = imm(); this.setC(this.x >= val); this.setZN(this.x - val); break;
      case 0xE1: this.sbc(this.read(indx())); this.cycles+=4; break;
      case 0xE3: addr = indx(); val = (this.read(addr) + 1) & 0xFF; this.write(addr, val); this.sbc(val); this.cycles+=6; break;
      case 0xE4: val = this.read(zp()); this.setC(this.x >= val); this.setZN(this.x - val); this.cycles++; break;
      case 0xE5: this.sbc(this.read(zp())); this.cycles++; break;
      case 0xE6: addr = zp(); val = (this.read(addr) + 1) & 0xFF; this.write(addr, val); this.setZN(val); this.cycles+=3; break;
      case 0xE7: addr = zp(); val = (this.read(addr) + 1) & 0xFF; this.write(addr, val); this.sbc(val); this.cycles+=3; break;
      case 0xE8: this.x = (this.x + 1) & 0xFF; this.setZN(this.x); break;
      case 0xE9: case 0xEB: this.sbc(imm()); break;
      case 0xEA: break;
      case 0xEC: val = this.read(abs()); this.setC(this.x >= val); this.setZN(this.x - val); this.cycles+=2; break;
      case 0xED: this.sbc(this.read(abs())); this.cycles+=2; break;
      case 0xEE: addr = abs(); val = (this.read(addr) + 1) & 0xFF; this.write(addr, val); this.setZN(val); this.cycles+=4; break;
      case 0xEF: addr = abs(); val = (this.read(addr) + 1) & 0xFF; this.write(addr, val); this.sbc(val); this.cycles+=4; break;

      case 0xF0: tmp = imm(); if (tmp & 0x80) tmp -= 256; if ((this.flags & 0x02)) { this.cycles += 1 + this.pageCross(this.pc, this.pc + tmp); this.pc += tmp; } break;
      case 0xF1: this.sbc(this.read(indy())); this.cycles+=3; break;
      case 0xF3: addr = indy(true); val = this.read(addr); this.setC((val & 0x01) !== 0); val >>= 1; this.write(addr, val); this.sbc(val); this.cycles+=6; break;
      case 0xF5: this.sbc(this.read(zpx())); this.cycles+=2; break;
      case 0xF6: addr = zpx(); val = (this.read(addr) + 1) & 0xFF; this.write(addr, val); this.setZN(val); this.cycles+=4; break;
      case 0xF7: addr = zpx(); val = (this.read(addr) + 1) & 0xFF; this.write(addr, val); this.sbc(val); this.cycles+=4; break;
      case 0xF8: this.flags |= 0x08; break;
      case 0xF9: this.sbc(this.read(absy())); this.cycles+=2; break;
      case 0xFB: addr = absy(true); val = (this.read(addr) + 1) & 0xFF; this.write(addr, val); this.sbc(val); this.cycles+=5; break;
      case 0xFD: this.sbc(this.read(absx())); this.cycles+=2; break;
      case 0xFE: addr = absx(true); val = (this.read(addr) + 1) & 0xFF; this.write(addr, val); this.setZN(val); this.cycles+=5; break;
      case 0xFF: addr = absx(true); val = (this.read(addr) + 1) & 0xFF; this.write(addr, val); this.sbc(val); this.cycles+=5; break;

      default:
        SystemLogger.log('CPU', `Unhandled Opcode $${op.toString(16).toUpperCase()} at $${(this.pc-1).toString(16).toUpperCase()}`, 'error');
        this.halted = true;
        break;
    }
  }
}
