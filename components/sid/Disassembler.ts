
import { C64System } from './C64System';

export class Disassembler {
    private static OPCODES: { [key: number]: { m: string; size: number } } = {
        // Standard Opcodes
        0x00: { m: 'BRK', size: 1 }, 0x01: { m: 'ORA ($nn,X)', size: 2 }, 0x05: { m: 'ORA $nn', size: 2 }, 0x06: { m: 'ASL $nn', size: 2 }, 0x08: { m: 'PHP', size: 1 }, 0x09: { m: 'ORA #$nn', size: 2 }, 0x0A: { m: 'ASL A', size: 1 }, 0x0D: { m: 'ORA $nnnn', size: 3 }, 0x0E: { m: 'ASL $nnnn', size: 3 },
        0x10: { m: 'BPL $nn', size: 2 }, 0x11: { m: 'ORA ($nn),Y', size: 2 }, 0x15: { m: 'ORA $nn,X', size: 2 }, 0x16: { m: 'ASL $nn,X', size: 2 }, 0x18: { m: 'CLC', size: 1 }, 0x19: { m: 'ORA $nnnn,Y', size: 3 }, 0x1D: { m: 'ORA $nnnn,X', size: 3 }, 0x1E: { m: 'ASL $nnnn,X', size: 3 },
        0x20: { m: 'JSR $nnnn', size: 3 }, 0x21: { m: 'AND ($nn,X)', size: 2 }, 0x24: { m: 'BIT $nn', size: 2 }, 0x25: { m: 'AND $nn', size: 2 }, 0x26: { m: 'ROL $nn', size: 2 }, 0x28: { m: 'PLP', size: 1 }, 0x29: { m: 'AND #$nn', size: 2 }, 0x2A: { m: 'ROL A', size: 1 }, 0x2C: { m: 'BIT $nnnn', size: 3 }, 0x2D: { m: 'AND $nnnn', size: 3 }, 0x2E: { m: 'ROL $nnnn', size: 3 },
        0x30: { m: 'BMI $nn', size: 2 }, 0x31: { m: 'AND ($nn),Y', size: 2 }, 0x35: { m: 'AND $nn,X', size: 2 }, 0x36: { m: 'ROL $nn,X', size: 2 }, 0x38: { m: 'SEC', size: 1 }, 0x39: { m: 'AND $nnnn,Y', size: 3 }, 0x3D: { m: 'AND $nnnn,X', size: 3 }, 0x3E: { m: 'ROL $nnnn,X', size: 3 },
        0x40: { m: 'RTI', size: 1 }, 0x41: { m: 'EOR ($nn,X)', size: 2 }, 0x45: { m: 'EOR $nn', size: 2 }, 0x46: { m: 'LSR $nn', size: 2 }, 0x48: { m: 'PHA', size: 1 }, 0x49: { m: 'EOR #$nn', size: 2 }, 0x4A: { m: 'LSR A', size: 1 }, 0x4C: { m: 'JMP $nnnn', size: 3 }, 0x4D: { m: 'EOR $nnnn', size: 3 }, 0x4E: { m: 'LSR $nnnn', size: 3 },
        0x50: { m: 'BVC $nn', size: 2 }, 0x51: { m: 'EOR ($nn),Y', size: 2 }, 0x55: { m: 'EOR $nn,X', size: 2 }, 0x56: { m: 'LSR $nn,X', size: 2 }, 0x58: { m: 'CLI', size: 1 }, 0x59: { m: 'EOR $nnnn,Y', size: 3 }, 0x5D: { m: 'EOR $nnnn,X', size: 3 }, 0x5E: { m: 'LSR $nnnn,X', size: 3 },
        0x60: { m: 'RTS', size: 1 }, 0x61: { m: 'ADC ($nn,X)', size: 2 }, 0x65: { m: 'ADC $nn', size: 2 }, 0x66: { m: 'ROR $nn', size: 2 }, 0x68: { m: 'PLA', size: 1 }, 0x69: { m: 'ADC #$nn', size: 2 }, 0x6A: { m: 'ROR A', size: 1 }, 0x6C: { m: 'JMP ($nnnn)', size: 3 }, 0x6D: { m: 'ADC $nnnn', size: 3 }, 0x6E: { m: 'ROR $nnnn', size: 3 },
        0x70: { m: 'BVS $nn', size: 2 }, 0x71: { m: 'ADC ($nn),Y', size: 2 }, 0x75: { m: 'ADC $nn,X', size: 2 }, 0x76: { m: 'ROR $nn,X', size: 2 }, 0x78: { m: 'SEI', size: 1 }, 0x79: { m: 'ADC $nnnn,Y', size: 3 }, 0x7D: { m: 'ADC $nnnn,X', size: 3 }, 0x7E: { m: 'ROR $nnnn,X', size: 3 },
        0x81: { m: 'STA ($nn,X)', size: 2 }, 0x84: { m: 'STY $nn', size: 2 }, 0x85: { m: 'STA $nn', size: 2 }, 0x86: { m: 'STX $nn', size: 2 }, 0x88: { m: 'DEY', size: 1 }, 0x8A: { m: 'TXA', size: 1 }, 0x8C: { m: 'STY $nnnn', size: 3 }, 0x8D: { m: 'STA $nnnn', size: 3 }, 0x8E: { m: 'STX $nnnn', size: 3 },
        0x90: { m: 'BCC $nn', size: 2 }, 0x91: { m: 'STA ($nn),Y', size: 2 }, 0x94: { m: 'STY $nn,X', size: 2 }, 0x95: { m: 'STA $nn,X', size: 2 }, 0x96: { m: 'STX $nn,Y', size: 2 }, 0x98: { m: 'TYA', size: 1 }, 0x99: { m: 'STA $nnnn,Y', size: 3 }, 0x9A: { m: 'TXS', size: 1 }, 0x9D: { m: 'STA $nnnn,X', size: 3 },
        0xA0: { m: 'LDY #$nn', size: 2 }, 0xA1: { m: 'LDA ($nn,X)', size: 2 }, 0xA2: { m: 'LDX #$nn', size: 2 }, 0xA4: { m: 'LDY $nn', size: 2 }, 0xA5: { m: 'LDA $nn', size: 2 }, 0xA6: { m: 'LDX $nn', size: 2 }, 0xA8: { m: 'TAY', size: 1 }, 0xA9: { m: 'LDA #$nn', size: 2 }, 0xAA: { m: 'TAX', size: 1 }, 0xAC: { m: 'LDY $nnnn', size: 3 }, 0xAD: { m: 'LDA $nnnn', size: 3 }, 0xAE: { m: 'LDX $nnnn', size: 3 },
        0xB0: { m: 'BCS $nn', size: 2 }, 0xB1: { m: 'LDA ($nn),Y', size: 2 }, 0xB4: { m: 'LDY $nn,X', size: 2 }, 0xB5: { m: 'LDA $nn,X', size: 2 }, 0xB6: { m: 'LDX $nn,Y', size: 2 }, 0xB8: { m: 'CLV', size: 1 }, 0xB9: { m: 'LDA $nnnn,Y', size: 3 }, 0xBA: { m: 'TSX', size: 1 }, 0xBC: { m: 'LDY $nnnn,X', size: 3 }, 0xBD: { m: 'LDA $nnnn,X', size: 3 }, 0xBE: { m: 'LDX $nnnn,Y', size: 3 },
        0xC0: { m: 'CPY #$nn', size: 2 }, 0xC1: { m: 'CMP ($nn,X)', size: 2 }, 0xC4: { m: 'CPY $nn', size: 2 }, 0xC5: { m: 'CMP $nn', size: 2 }, 0xC6: { m: 'DEC $nn', size: 2 }, 0xC8: { m: 'INY', size: 1 }, 0xC9: { m: 'CMP #$nn', size: 2 }, 0xCA: { m: 'DEX', size: 1 }, 0xCC: { m: 'CPY $nnnn', size: 3 }, 0xCD: { m: 'CMP $nnnn', size: 3 }, 0xCE: { m: 'DEC $nnnn', size: 3 },
        0xD0: { m: 'BNE $nn', size: 2 }, 0xD1: { m: 'CMP ($nn),Y', size: 2 }, 0xD5: { m: 'CMP $nn,X', size: 2 }, 0xD6: { m: 'DEC $nn,X', size: 2 }, 0xD8: { m: 'CLD', size: 1 }, 0xD9: { m: 'CMP $nnnn,Y', size: 3 }, 0xDD: { m: 'CMP $nnnn,X', size: 3 }, 0xDE: { m: 'DEC $nnnn,X', size: 3 },
        0xE0: { m: 'CPX #$nn', size: 2 }, 0xE1: { m: 'SBC ($nn,X)', size: 2 }, 0xE4: { m: 'CPX $nn', size: 2 }, 0xE5: { m: 'SBC $nn', size: 2 }, 0xE6: { m: 'INC $nn', size: 2 }, 0xE8: { m: 'INX', size: 1 }, 0xE9: { m: 'SBC #$nn', size: 2 }, 0xEA: { m: 'NOP', size: 1 }, 0xEC: { m: 'CPX $nnnn', size: 3 }, 0xED: { m: 'SBC $nnnn', size: 3 }, 0xEE: { m: 'INC $nnnn', size: 3 },
        0xF0: { m: 'BEQ $nn', size: 2 }, 0xF1: { m: 'SBC ($nn),Y', size: 2 }, 0xF5: { m: 'SBC $nn,X', size: 2 }, 0xF6: { m: 'INC $nn,X', size: 2 }, 0xF8: { m: 'SED', size: 1 }, 0xF9: { m: 'SBC $nnnn,Y', size: 3 }, 0xFD: { m: 'SBC $nnnn,X', size: 3 }, 0xFE: { m: 'INC $nnnn,X', size: 3 },

        // Illegal/Undocumented Opcodes
        0xA7: { m: 'LAX $nn', size: 2 }, 0xB7: { m: 'LAX $nn,Y', size: 2 }, 0xAF: { m: 'LAX $nnnn', size: 3 }, 0xBF: { m: 'LAX $nnnn,Y', size: 3 }, 0xA3: { m: 'LAX ($nn,X)', size: 2 }, 0xB3: { m: 'LAX ($nn),Y', size: 2 },
        0x87: { m: 'SAX $nn', size: 2 }, 0x97: { m: 'SAX $nn,Y', size: 2 }, 0x8F: { m: 'SAX $nnnn', size: 3 }, 0x83: { m: 'SAX ($nn,X)', size: 2 },
        0xCB: { m: 'SBX #$nn', size: 2 },
        0xC7: { m: 'DCP $nn', size: 2 }, 0xD7: { m: 'DCP $nn,X', size: 2 }, 0xCF: { m: 'DCP $nnnn', size: 3 }, 0xDF: { m: 'DCP $nnnn,X', size: 3 }, 0xDB: { m: 'DCP $nnnn,Y', size: 3 }, 0xC3: { m: 'DCP ($nn,X)', size: 2 }, 0xD3: { m: 'DCP ($nn),Y', size: 2 },
        0xE7: { m: 'ISC $nn', size: 2 }, 0xF7: { m: 'ISC $nn,X', size: 2 }, 0xEF: { m: 'ISC $nnnn', size: 3 }, 0xFF: { m: 'ISC $nnnn,X', size: 3 }, 0xFB: { m: 'ISC $nnnn,Y', size: 3 }, 0xE3: { m: 'ISC ($nn,X)', size: 2 }, 0xF3: { m: 'ISC ($nn),Y', size: 2 },
        0x07: { m: 'SLO $nn', size: 2 }, 0x17: { m: 'SLO $nn,X', size: 2 }, 0x0F: { m: 'SLO $nnnn', size: 3 }, 0x1F: { m: 'SLO $nnnn,X', size: 3 }, 0x1B: { m: 'SLO $nnnn,Y', size: 3 }, 0x03: { m: 'SLO ($nn,X)', size: 2 }, 0x13: { m: 'SLO ($nn),Y', size: 2 },
        0x27: { m: 'RLA $nn', size: 2 }, 0x37: { m: 'RLA $nn,X', size: 2 }, 0x2F: { m: 'RLA $nnnn', size: 3 }, 0x3F: { m: 'RLA $nnnn,X', size: 3 }, 0x3B: { m: 'RLA $nnnn,Y', size: 3 }, 0x23: { m: 'RLA ($nn,X)', size: 2 }, 0x33: { m: 'RLA ($nn),Y', size: 2 },
        0x47: { m: 'SRE $nn', size: 2 }, 0x57: { m: 'SRE $nn,X', size: 2 }, 0x4F: { m: 'SRE $nnnn', size: 3 }, 0x5F: { m: 'SRE $nnnn,X', size: 3 }, 0x5B: { m: 'SRE $nnnn,Y', size: 3 }, 0x43: { m: 'SRE ($nn,X)', size: 2 }, 0x53: { m: 'SRE ($nn),Y', size: 2 },
        0x67: { m: 'RRA $nn', size: 2 }, 0x77: { m: 'RRA $nn,X', size: 2 }, 0x6F: { m: 'RRA $nnnn', size: 3 }, 0x7F: { m: 'RRA $nnnn,X', size: 3 }, 0x7B: { m: 'RRA $nnnn,Y', size: 3 }, 0x63: { m: 'RRA ($nn,X)', size: 2 }, 0x73: { m: 'RRA ($nn),Y', size: 2 },
        
        // NOPs
        0x80: { m: 'NOP #$nn', size: 2 }, 0x82: { m: 'NOP #$nn', size: 2 }, 0x89: { m: 'NOP #$nn', size: 2 }, 0xC2: { m: 'NOP #$nn', size: 2 }, 0xE2: { m: 'NOP #$nn', size: 2 }, 
        0x04: { m: 'NOP $nn', size: 2 }, 0x14: { m: 'NOP $nn,X', size: 2 }, 0x34: { m: 'NOP $nn,X', size: 2 }, 0x44: { m: 'NOP $nn', size: 2 }, 0x54: { m: 'NOP $nn,X', size: 2 }, 0x64: { m: 'NOP $nn', size: 2 }, 0x74: { m: 'NOP $nn,X', size: 2 }, 0xD4: { m: 'NOP $nn,X', size: 2 }, 0xF4: { m: 'NOP $nn,X', size: 2 },
        0x0C: { m: 'NOP $nnnn', size: 3 }, 0x1C: { m: 'NOP $nnnn,X', size: 3 }, 0x3C: { m: 'NOP $nnnn,X', size: 3 }, 0x5C: { m: 'NOP $nnnn,X', size: 3 }, 0x7C: { m: 'NOP $nnnn,X', size: 3 }, 0xDC: { m: 'NOP $nnnn,X', size: 3 }, 0xFC: { m: 'NOP $nnnn,X', size: 3 },
        0x1A: { m: 'NOP', size: 1 }, 0x3A: { m: 'NOP', size: 1 }, 0x5A: { m: 'NOP', size: 1 }, 0x7A: { m: 'NOP', size: 1 }, 0xDA: { m: 'NOP', size: 1 }, 0xFA: { m: 'NOP', size: 1 },
        0x0B: { m: 'ANC #$nn', size: 2 }, 0x2B: { m: 'ANC #$nn', size: 2 },
        0x4B: { m: 'ALR #$nn', size: 2 }, 0x6B: { m: 'ARR #$nn', size: 2 },
        0x8B: { m: 'ANE #$nn', size: 2 }, 0xAB: { m: 'LXA #$nn', size: 2 },
        0x9B: { m: 'TAS $nnnn,Y', size: 3 }, 0xBB: { m: 'LAS $nnnn,Y', size: 3 },
        0x93: { m: 'SHA ($nn),Y', size: 2 }, 0x9F: { m: 'SHA $nnnn,Y', size: 3 },
        0x9E: { m: 'SHX $nnnn,Y', size: 3 }, 0x9C: { m: 'SHY $nnnn,X', size: 3 },
        0x02: { m: 'JAM', size: 1 }, 0x12: { m: 'JAM', size: 1 }, 0x22: { m: 'JAM', size: 1 }, 0x32: { m: 'JAM', size: 1 }, 0x42: { m: 'JAM', size: 1 }, 0x52: { m: 'JAM', size: 1 }, 
        0x62: { m: 'JAM', size: 1 }, 0x72: { m: 'JAM', size: 1 }, 0x92: { m: 'JAM', size: 1 }, 0xB2: { m: 'JAM', size: 1 }, 0xD2: { m: 'JAM', size: 1 }, 0xF2: { m: 'JAM', size: 1 }
    };

    public static disassemble(system: C64System, addr: number): string {
        const maskedAddr = addr & 0xFFFF;
        const op = system.peek(maskedAddr);
        const def = this.OPCODES[op];
        
        if (!def) return `$${maskedAddr.toString(16).toUpperCase()}: ??? ($${op.toString(16).toUpperCase()})`;

        let output = def.m;
        let operandStr = '';

        if (def.size === 2) {
            const val = system.peek((maskedAddr + 1) & 0xFFFF) & 0xFF;
            operandStr = `$${val.toString(16).toUpperCase().padStart(2, '0')}`;
            if (def.m.startsWith('B')) {
                let offset = val;
                if (offset & 0x80) offset -= 0x100;
                const dest = (maskedAddr + 2 + offset) & 0xFFFF;
                operandStr = `$${dest.toString(16).toUpperCase()}`;
            }
            output = output.replace('$nn', operandStr);
        } else if (def.size === 3) {
            const lo = system.peek((maskedAddr + 1) & 0xFFFF) & 0xFF;
            const hi = system.peek((maskedAddr + 2) & 0xFFFF) & 0xFF;
            const val = (hi << 8) | lo;
            operandStr = `$${val.toString(16).toUpperCase().padStart(4, '0')}`;
            output = output.replace('$nnnn', operandStr);
        }

        const bytes = [0,1,2].slice(0, def.size).map(i => {
            const b = system.peek((maskedAddr + i) & 0xFFFF);
            return (b !== undefined ? b : 0).toString(16).toUpperCase().padStart(2, '0');
        }).join(' ');

        return `$${maskedAddr.toString(16).toUpperCase().padStart(4, '0')}: ${output.padEnd(15)} [${bytes}]`;
    }
}
