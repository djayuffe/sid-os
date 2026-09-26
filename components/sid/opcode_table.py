"""
Complete MOS 6510 Opcode Table
All 256 opcodes including illegal/undocumented instructions
"""

from typing import Callable, Tuple
from enum import IntEnum


class OpcodeInfo:
    """Information about a single opcode"""
    def __init__(self, name: str, mode: str, cycles: int, handler: Callable):
        self.name = name  # Mnemonic
        self.mode = mode  # Addressing mode
        self.cycles = cycles  # Base cycle count
        self.handler = handler  # Execution function
        self.illegal = name.startswith('*')  # Undocumented opcode


# Complete opcode table for MOS 6510
# Format: opcode -> (mnemonic, addressing_mode, cycles, handler_function)

OPCODE_TABLE = {
    # ========================================================================
    # LEGAL OPCODES (151 total)
    # ========================================================================
    
    # ADC - Add with Carry
    0x69: ('ADC', 'IMM', 2),  # ADC #$nn
    0x65: ('ADC', 'ZP', 3),   # ADC $nn
    0x75: ('ADC', 'ZPX', 4),  # ADC $nn,X
    0x6D: ('ADC', 'ABS', 4),  # ADC $nnnn
    0x7D: ('ADC', 'ABX', 4),  # ADC $nnnn,X (+1 if page cross)
    0x79: ('ADC', 'ABY', 4),  # ADC $nnnn,Y (+1 if page cross)
    0x61: ('ADC', 'IDX', 6),  # ADC ($nn,X)
    0x71: ('ADC', 'IDY', 5),  # ADC ($nn),Y (+1 if page cross)
    
    # AND - Logical AND
    0x29: ('AND', 'IMM', 2),
    0x25: ('AND', 'ZP', 3),
    0x35: ('AND', 'ZPX', 4),
    0x2D: ('AND', 'ABS', 4),
    0x3D: ('AND', 'ABX', 4),
    0x39: ('AND', 'ABY', 4),
    0x21: ('AND', 'IDX', 6),
    0x31: ('AND', 'IDY', 5),
    
    # ASL - Arithmetic Shift Left
    0x0A: ('ASL', 'ACC', 2),  # ASL A
    0x06: ('ASL', 'ZP', 5),   # ASL $nn
    0x16: ('ASL', 'ZPX', 6),  # ASL $nn,X
    0x0E: ('ASL', 'ABS', 6),  # ASL $nnnn
    0x1E: ('ASL', 'ABX', 7),  # ASL $nnnn,X
    
    # Branch Instructions
    0x90: ('BCC', 'REL', 2),  # Branch if Carry Clear (+1 if taken, +2 if page cross)
    0xB0: ('BCS', 'REL', 2),  # Branch if Carry Set
    0xF0: ('BEQ', 'REL', 2),  # Branch if Equal (Z=1)
    0x30: ('BMI', 'REL', 2),  # Branch if Minus (N=1)
    0xD0: ('BNE', 'REL', 2),  # Branch if Not Equal (Z=0)
    0x10: ('BPL', 'REL', 2),  # Branch if Plus (N=0)
    0x50: ('BVC', 'REL', 2),  # Branch if Overflow Clear
    0x70: ('BVS', 'REL', 2),  # Branch if Overflow Set
    
    # BIT - Bit Test
    0x24: ('BIT', 'ZP', 3),
    0x2C: ('BIT', 'ABS', 4),
    
    # BRK - Force Interrupt
    0x00: ('BRK', 'IMP', 7),
    
    # Clear Flag Instructions
    0x18: ('CLC', 'IMP', 2),  # Clear Carry
    0xD8: ('CLD', 'IMP', 2),  # Clear Decimal
    0x58: ('CLI', 'IMP', 2),  # Clear Interrupt Disable
    0xB8: ('CLV', 'IMP', 2),  # Clear Overflow
    
    # CMP - Compare Accumulator
    0xC9: ('CMP', 'IMM', 2),
    0xC5: ('CMP', 'ZP', 3),
    0xD5: ('CMP', 'ZPX', 4),
    0xCD: ('CMP', 'ABS', 4),
    0xDD: ('CMP', 'ABX', 4),
    0xD9: ('CMP', 'ABY', 4),
    0xC1: ('CMP', 'IDX', 6),
    0xD1: ('CMP', 'IDY', 5),
    
    # CPX - Compare X Register
    0xE0: ('CPX', 'IMM', 2),
    0xE4: ('CPX', 'ZP', 3),
    0xEC: ('CPX', 'ABS', 4),
    
    # CPY - Compare Y Register
    0xC0: ('CPY', 'IMM', 2),
    0xC4: ('CPY', 'ZP', 3),
    0xCC: ('CPY', 'ABS', 4),
    
    # DEC - Decrement Memory
    0xC6: ('DEC', 'ZP', 5),
    0xD6: ('DEC', 'ZPX', 6),
    0xCE: ('DEC', 'ABS', 6),
    0xDE: ('DEC', 'ABX', 7),
    
    # DEX - Decrement X
    0xCA: ('DEX', 'IMP', 2),
    
    # DEY - Decrement Y
    0x88: ('DEY', 'IMP', 2),
    
    # EOR - Exclusive OR
    0x49: ('EOR', 'IMM', 2),
    0x45: ('EOR', 'ZP', 3),
    0x55: ('EOR', 'ZPX', 4),
    0x4D: ('EOR', 'ABS', 4),
    0x5D: ('EOR', 'ABX', 4),
    0x59: ('EOR', 'ABY', 4),
    0x41: ('EOR', 'IDX', 6),
    0x51: ('EOR', 'IDY', 5),
    
    # INC - Increment Memory
    0xE6: ('INC', 'ZP', 5),
    0xF6: ('INC', 'ZPX', 6),
    0xEE: ('INC', 'ABS', 6),
    0xFE: ('INC', 'ABX', 7),
    
    # INX - Increment X
    0xE8: ('INX', 'IMP', 2),
    
    # INY - Increment Y
    0xC8: ('INY', 'IMP', 2),
    
    # JMP - Jump
    0x4C: ('JMP', 'ABS', 3),
    0x6C: ('JMP', 'IND', 5),
    
    # JSR - Jump to Subroutine
    0x20: ('JSR', 'ABS', 6),
    
    # LDA - Load Accumulator
    0xA9: ('LDA', 'IMM', 2),
    0xA5: ('LDA', 'ZP', 3),
    0xB5: ('LDA', 'ZPX', 4),
    0xAD: ('LDA', 'ABS', 4),
    0xBD: ('LDA', 'ABX', 4),
    0xB9: ('LDA', 'ABY', 4),
    0xA1: ('LDA', 'IDX', 6),
    0xB1: ('LDA', 'IDY', 5),
    
    # LDX - Load X Register
    0xA2: ('LDX', 'IMM', 2),
    0xA6: ('LDX', 'ZP', 3),
    0xB6: ('LDX', 'ZPY', 4),
    0xAE: ('LDX', 'ABS', 4),
    0xBE: ('LDX', 'ABY', 4),
    
    # LDY - Load Y Register
    0xA0: ('LDY', 'IMM', 2),
    0xA4: ('LDY', 'ZP', 3),
    0xB4: ('LDY', 'ZPX', 4),
    0xAC: ('LDY', 'ABS', 4),
    0xBC: ('LDY', 'ABX', 4),
    
    # LSR - Logical Shift Right
    0x4A: ('LSR', 'ACC', 2),
    0x46: ('LSR', 'ZP', 5),
    0x56: ('LSR', 'ZPX', 6),
    0x4E: ('LSR', 'ABS', 6),
    0x5E: ('LSR', 'ABX', 7),
    
    # NOP - No Operation
    0xEA: ('NOP', 'IMP', 2),
    
    # ORA - Logical Inclusive OR
    0x09: ('ORA', 'IMM', 2),
    0x05: ('ORA', 'ZP', 3),
    0x15: ('ORA', 'ZPX', 4),
    0x0D: ('ORA', 'ABS', 4),
    0x1D: ('ORA', 'ABX', 4),
    0x19: ('ORA', 'ABY', 4),
    0x01: ('ORA', 'IDX', 6),
    0x11: ('ORA', 'IDY', 5),
    
    # Register Instructions
    0xAA: ('TAX', 'IMP', 2),  # Transfer A to X
    0x8A: ('TXA', 'IMP', 2),  # Transfer X to A
    0xA8: ('TAY', 'IMP', 2),  # Transfer A to Y
    0x98: ('TYA', 'IMP', 2),  # Transfer Y to A
    0xBA: ('TSX', 'IMP', 2),  # Transfer SP to X
    0x9A: ('TXS', 'IMP', 2),  # Transfer X to SP
    
    # Stack Instructions
    0x48: ('PHA', 'IMP', 3),  # Push Accumulator
    0x68: ('PLA', 'IMP', 4),  # Pull Accumulator
    0x08: ('PHP', 'IMP', 3),  # Push Processor Status
    0x28: ('PLP', 'IMP', 4),  # Pull Processor Status
    
    # ROL - Rotate Left
    0x2A: ('ROL', 'ACC', 2),
    0x26: ('ROL', 'ZP', 5),
    0x36: ('ROL', 'ZPX', 6),
    0x2E: ('ROL', 'ABS', 6),
    0x3E: ('ROL', 'ABX', 7),
    
    # ROR - Rotate Right
    0x6A: ('ROR', 'ACC', 2),
    0x66: ('ROR', 'ZP', 5),
    0x76: ('ROR', 'ZPX', 6),
    0x6E: ('ROR', 'ABS', 6),
    0x7E: ('ROR', 'ABX', 7),
    
    # RTI - Return from Interrupt
    0x40: ('RTI', 'IMP', 6),
    
    # RTS - Return from Subroutine
    0x60: ('RTS', 'IMP', 6),
    
    # SBC - Subtract with Carry
    0xE9: ('SBC', 'IMM', 2),
    0xE5: ('SBC', 'ZP', 3),
    0xF5: ('SBC', 'ZPX', 4),
    0xED: ('SBC', 'ABS', 4),
    0xFD: ('SBC', 'ABX', 4),
    0xF9: ('SBC', 'ABY', 4),
    0xE1: ('SBC', 'IDX', 6),
    0xF1: ('SBC', 'IDY', 5),
    
    # Set Flag Instructions
    0x38: ('SEC', 'IMP', 2),  # Set Carry
    0xF8: ('SED', 'IMP', 2),  # Set Decimal
    0x78: ('SEI', 'IMP', 2),  # Set Interrupt Disable
    
    # STA - Store Accumulator
    0x85: ('STA', 'ZP', 3),
    0x95: ('STA', 'ZPX', 4),
    0x8D: ('STA', 'ABS', 4),
    0x9D: ('STA', 'ABX', 5),
    0x99: ('STA', 'ABY', 5),
    0x81: ('STA', 'IDX', 6),
    0x91: ('STA', 'IDY', 6),
    
    # STX - Store X Register
    0x86: ('STX', 'ZP', 3),
    0x96: ('STX', 'ZPY', 4),
    0x8E: ('STX', 'ABS', 4),
    
    # STY - Store Y Register
    0x84: ('STY', 'ZP', 3),
    0x94: ('STY', 'ZPX', 4),
    0x8C: ('STY', 'ABS', 4),
    
    # ========================================================================
    # ILLEGAL/UNDOCUMENTED OPCODES (105 total)
    # ========================================================================
    
    # *SLO - ASL + ORA (Shift Left, OR Accumulator)
    0x07: ('*SLO', 'ZP', 5),
    0x17: ('*SLO', 'ZPX', 6),
    0x0F: ('*SLO', 'ABS', 6),
    0x1F: ('*SLO', 'ABX', 7),
    0x1B: ('*SLO', 'ABY', 7),
    0x03: ('*SLO', 'IDX', 8),
    0x13: ('*SLO', 'IDY', 8),
    
    # *RLA - ROL + AND (Rotate Left, AND Accumulator)
    0x27: ('*RLA', 'ZP', 5),
    0x37: ('*RLA', 'ZPX', 6),
    0x2F: ('*RLA', 'ABS', 6),
    0x3F: ('*RLA', 'ABX', 7),
    0x3B: ('*RLA', 'ABY', 7),
    0x23: ('*RLA', 'IDX', 8),
    0x33: ('*RLA', 'IDY', 8),
    
    # *SRE - LSR + EOR (Shift Right, EOR Accumulator)
    0x47: ('*SRE', 'ZP', 5),
    0x57: ('*SRE', 'ZPX', 6),
    0x4F: ('*SRE', 'ABS', 6),
    0x5F: ('*SRE', 'ABX', 7),
    0x5B: ('*SRE', 'ABY', 7),
    0x43: ('*SRE', 'IDX', 8),
    0x53: ('*SRE', 'IDY', 8),
    
    # *RRA - ROR + ADC (Rotate Right, ADC)
    0x67: ('*RRA', 'ZP', 5),
    0x77: ('*RRA', 'ZPX', 6),
    0x6F: ('*RRA', 'ABS', 6),
    0x7F: ('*RRA', 'ABX', 7),
    0x7B: ('*RRA', 'ABY', 7),
    0x63: ('*RRA', 'IDX', 8),
    0x73: ('*RRA', 'IDY', 8),
    
    # *SAX - Store A AND X
    0x87: ('*SAX', 'ZP', 3),
    0x97: ('*SAX', 'ZPY', 4),
    0x8F: ('*SAX', 'ABS', 4),
    0x83: ('*SAX', 'IDX', 6),
    
    # *LAX - Load A and X
    0xA7: ('*LAX', 'ZP', 3),
    0xB7: ('*LAX', 'ZPY', 4),
    0xAF: ('*LAX', 'ABS', 4),
    0xBF: ('*LAX', 'ABY', 4),
    0xA3: ('*LAX', 'IDX', 6),
    0xB3: ('*LAX', 'IDY', 5),
    
    # *DCP - DEC + CMP (Decrement, Compare)
    0xC7: ('*DCP', 'ZP', 5),
    0xD7: ('*DCP', 'ZPX', 6),
    0xCF: ('*DCP', 'ABS', 6),
    0xDF: ('*DCP', 'ABX', 7),
    0xDB: ('*DCP', 'ABY', 7),
    0xC3: ('*DCP', 'IDX', 8),
    0xD3: ('*DCP', 'IDY', 8),
    
    # *ISC - INC + SBC (Increment, Subtract)
    0xE7: ('*ISC', 'ZP', 5),
    0xF7: ('*ISC', 'ZPX', 6),
    0xEF: ('*ISC', 'ABS', 6),
    0xFF: ('*ISC', 'ABX', 7),
    0xFB: ('*ISC', 'ABY', 7),
    0xE3: ('*ISC', 'IDX', 8),
    0xF3: ('*ISC', 'IDY', 8),
    
    # *ANC - AND + set Carry (like AND but also affects Carry)
    0x0B: ('*ANC', 'IMM', 2),
    0x2B: ('*ANC', 'IMM', 2),
    
    # *ALR - AND + LSR (AND then shift right)
    0x4B: ('*ALR', 'IMM', 2),
    
    # *ARR - AND + ROR (AND then rotate right)
    0x6B: ('*ARR', 'IMM', 2),
    
    # *XAA - Transfer X to A, AND with immediate (unstable)
    0x8B: ('*XAA', 'IMM', 2),
    
    # *AXS - (A AND X) - immediate, store in X
    0xCB: ('*AXS', 'IMM', 2),
    
    # *AHX - Store A AND X AND (high byte of address + 1)
    0x9F: ('*AHX', 'ABY', 5),
    0x93: ('*AHX', 'IDY', 6),
    
    # *SHY - Store Y AND (high byte of address + 1)
    0x9C: ('*SHY', 'ABX', 5),
    
    # *SHX - Store X AND (high byte of address + 1)
    0x9E: ('*SHX', 'ABY', 5),
    
    # *TAS - Transfer A AND X to SP, AND with (high byte + 1)
    0x9B: ('*TAS', 'ABY', 5),
    
    # *LAS - Load A, X, SP with memory AND SP
    0xBB: ('*LAS', 'ABY', 4),
    
    # *NOP variants (various illegal NOPs)
    0x1A: ('*NOP', 'IMP', 2),
    0x3A: ('*NOP', 'IMP', 2),
    0x5A: ('*NOP', 'IMP', 2),
    0x7A: ('*NOP', 'IMP', 2),
    0xDA: ('*NOP', 'IMP', 2),
    0xFA: ('*NOP', 'IMP', 2),
    
    # *NOP with addressing modes
    0x80: ('*NOP', 'IMM', 2),
    0x82: ('*NOP', 'IMM', 2),
    0x89: ('*NOP', 'IMM', 2),
    0xC2: ('*NOP', 'IMM', 2),
    0xE2: ('*NOP', 'IMM', 2),
    
    0x04: ('*NOP', 'ZP', 3),
    0x44: ('*NOP', 'ZP', 3),
    0x64: ('*NOP', 'ZP', 3),
    
    0x14: ('*NOP', 'ZPX', 4),
    0x34: ('*NOP', 'ZPX', 4),
    0x54: ('*NOP', 'ZPX', 4),
    0x74: ('*NOP', 'ZPX', 4),
    0xD4: ('*NOP', 'ZPX', 4),
    0xF4: ('*NOP', 'ZPX', 4),
    
    0x0C: ('*NOP', 'ABS', 4),
    
    0x1C: ('*NOP', 'ABX', 4),
    0x3C: ('*NOP', 'ABX', 4),
    0x5C: ('*NOP', 'ABX', 4),
    0x7C: ('*NOP', 'ABX', 4),
    0xDC: ('*NOP', 'ABX', 4),
    0xFC: ('*NOP', 'ABX', 4),
    
    # *JAM - Halt CPU (lock up, requires reset)
    0x02: ('*JAM', 'IMP', 0),
    0x12: ('*JAM', 'IMP', 0),
    0x22: ('*JAM', 'IMP', 0),
    0x32: ('*JAM', 'IMP', 0),
    0x42: ('*JAM', 'IMP', 0),
    0x52: ('*JAM', 'IMP', 0),
    0x62: ('*JAM', 'IMP', 0),
    0x72: ('*JAM', 'IMP', 0),
    0x92: ('*JAM', 'IMP', 0),
    0xB2: ('*JAM', 'IMP', 0),
    0xD2: ('*JAM', 'IMP', 0),
    0xF2: ('*JAM', 'IMP', 0),
}


# Addressing mode abbreviations
ADDRESSING_MODES = {
    'IMP': 'Implied',
    'ACC': 'Accumulator',
    'IMM': 'Immediate',
    'ZP': 'Zero Page',
    'ZPX': 'Zero Page,X',
    'ZPY': 'Zero Page,Y',
    'ABS': 'Absolute',
    'ABX': 'Absolute,X',
    'ABY': 'Absolute,Y',
    'IND': 'Indirect',
    'IDX': 'Indexed Indirect',
    'IDY': 'Indirect Indexed',
    'REL': 'Relative',
}


def get_opcode_info(opcode: int) -> Tuple[str, str, int]:
    """
    Get information about an opcode.
    
    Returns:
        (mnemonic, addressing_mode, cycles)
    """
    if opcode in OPCODE_TABLE:
        return OPCODE_TABLE[opcode]
    return ('???', 'IMP', 0)  # Unknown opcode


def is_illegal_opcode(opcode: int) -> bool:
    """Check if opcode is illegal/undocumented"""
    if opcode in OPCODE_TABLE:
        return OPCODE_TABLE[opcode][0].startswith('*')
    return True


def disassemble_instruction(opcode: int, operand1: int = 0, operand2: int = 0) -> str:
    """
    Disassemble an instruction to human-readable form.
    
    Args:
        opcode: Instruction opcode
        operand1: First operand byte (if any)
        operand2: Second operand byte (if any)
    
    Returns:
        Disassembled instruction string
    """
    mnem, mode, _ = get_opcode_info(opcode)
    
    if mode == 'IMP' or mode == 'ACC':
        return f"{mnem}"
    elif mode == 'IMM':
        return f"{mnem} #${operand1:02X}"
    elif mode == 'ZP':
        return f"{mnem} ${operand1:02X}"
    elif mode == 'ZPX':
        return f"{mnem} ${operand1:02X},X"
    elif mode == 'ZPY':
        return f"{mnem} ${operand1:02X},Y"
    elif mode == 'ABS':
        addr = operand1 | (operand2 << 8)
        return f"{mnem} ${addr:04X}"
    elif mode == 'ABX':
        addr = operand1 | (operand2 << 8)
        return f"{mnem} ${addr:04X},X"
    elif mode == 'ABY':
        addr = operand1 | (operand2 << 8)
        return f"{mnem} ${addr:04X},Y"
    elif mode == 'IND':
        addr = operand1 | (operand2 << 8)
        return f"{mnem} (${addr:04X})"
    elif mode == 'IDX':
        return f"{mnem} (${operand1:02X},X)"
    elif mode == 'IDY':
        return f"{mnem} (${operand1:02X}),Y"
    elif mode == 'REL':
        # Sign extend relative offset
        offset = operand1 if operand1 < 128 else operand1 - 256
        return f"{mnem} ${offset:+d}"
    
    return f"{mnem} ???"


# Statistics
LEGAL_OPCODES = sum(1 for _, (name, _, _) in OPCODE_TABLE.items() if not name.startswith('*'))
ILLEGAL_OPCODES = sum(1 for _, (name, _, _) in OPCODE_TABLE.items() if name.startswith('*'))
TOTAL_OPCODES = len(OPCODE_TABLE)

print(f"""
MOS 6510 Opcode Table Statistics:
==================================
Legal Opcodes: {LEGAL_OPCODES}
Illegal Opcodes: {ILLEGAL_OPCODES}
Total Defined: {TOTAL_OPCODES}/256
Coverage: {TOTAL_OPCODES/256*100:.1f}%
""")
