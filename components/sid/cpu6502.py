"""MOS 6502 CPU Emulator"""
from typing import Protocol
from .logger import system_logger


class Bus(Protocol):
    """Memory bus interface"""
    def read(self, addr: int) -> int: ...
    def write(self, addr: int, val: int) -> None: ...


class Cpu6502:
    """MOS 6502 CPU emulator"""
    
    def __init__(self, bus: Bus):
        # Registers
        self.a = 0  # Accumulator
        self.x = 0  # X register
        self.y = 0  # Y register
        self.sp = 0xFF  # Stack pointer
        self.pc = 0  # Program counter
        self.flags = 0x20  # Processor flags
        
        # System bus
        self.bus = bus
        
        # Cycle counter
        self.cycles = 0
    
    def reset(self):
        """Reset CPU to initial state"""
        self.a = 0
        self.x = 0
        self.y = 0
        self.sp = 0xFF
        self.flags = 0x20
        self.cycles = 0
        # Load reset vector
        self.pc = self._read16(0xFFFC)
        system_logger.log('CPU', f'Reset vector: ${self.pc:04X}', 'info')
    
    def irq(self):
        """Hardware interrupt request"""
        if (self.flags & 0x04) == 0:  # If interrupts not disabled
            system_logger.log('CPU', f'IRQ triggered at PC=${self.pc:04X}', 'debug')
            self._push((self.pc >> 8) & 0xFF)
            self._push(self.pc & 0xFF)
            self._push(self.flags & ~0x10)  # Break flag clear
            self.flags |= 0x04  # Disable interrupts
            self.pc = self._read16(0xFFFE)
            system_logger.log('CPU', f'IRQ vector: ${self.pc:04X}', 'debug')
            self.cycles += 7
        else:
            system_logger.log('CPU', 'IRQ ignored (interrupts disabled)', 'debug')
    
    def nmi(self):
        """Non-maskable interrupt"""
        self._push((self.pc >> 8) & 0xFF)
        self._push(self.pc & 0xFF)
        self._push(self.flags & ~0x10)
        self.flags |= 0x04  # Disable interrupts
        self.pc = self._read16(0xFFFA)
        self.cycles += 7
    
    # Flag helpers
    def _set_z(self, val: int):
        if (val & 0xFF) == 0:
            self.flags |= 0x02
        else:
            self.flags &= ~0x02
    
    def _set_n(self, val: int):
        if val & 0x80:
            self.flags |= 0x80
        else:
            self.flags &= ~0x80
    
    def _set_c(self, val: bool):
        if val:
            self.flags |= 0x01
        else:
            self.flags &= ~0x01
    
    # Memory access via bus
    def _read(self, addr: int) -> int:
        return self.bus.read(addr & 0xFFFF)
    
    def _write(self, addr: int, val: int):
        self.bus.write(addr & 0xFFFF, val & 0xFF)
    
    def _push(self, val: int):
        self._write(0x0100 + self.sp, val)
        self.sp = (self.sp - 1) & 0xFF
    
    def _pop(self) -> int:
        self.sp = (self.sp + 1) & 0xFF
        return self._read(0x0100 + self.sp)
    
    def _read16(self, addr: int) -> int:
        lo = self._read(addr)
        hi = self._read(addr + 1)
        return (hi << 8) | lo
    
    def _read16_bug(self, addr: int) -> int:
        """Read 16-bit with 6502 page boundary bug"""
        lo = self._read(addr)
        hi_addr = addr - 0xFF if (addr & 0xFF) == 0xFF else addr + 1
        hi = self._read(hi_addr)
        return (hi << 8) | lo
    
    def get_flags_string(self) -> str:
        """Get processor flags as readable string"""
        flags_str = ""
        flags_str += "N" if (self.flags & 0x80) else "-"
        flags_str += "V" if (self.flags & 0x40) else "-"
        flags_str += "U" if (self.flags & 0x20) else "-"
        flags_str += "B" if (self.flags & 0x10) else "-"
        flags_str += "D" if (self.flags & 0x08) else "-"
        flags_str += "I" if (self.flags & 0x04) else "-"
        flags_str += "Z" if (self.flags & 0x02) else "-"
        flags_str += "C" if (self.flags & 0x01) else "-"
        return flags_str
    
    def get_state_dump(self) -> str:
        """Get detailed CPU state as string for debugging"""
        return (f"PC=${self.pc:04X} A=${self.a:02X} X=${self.x:02X} Y=${self.y:02X} "
                f"SP=${self.sp:02X} P={self.get_flags_string()} [{self.flags:02X}] "
                f"Cycles={self.cycles}")
    
    def log_state(self, message: str = ""):
        """Log current CPU state"""
        if message:
            system_logger.log('CPU', f'{message}: {self.get_state_dump()}', 'debug')
        else:
            system_logger.log('CPU', self.get_state_dump(), 'debug')
    
    def execute(self, max_cycles: int, trap_address: int = -1) -> int:
        """
        Execute CPU instructions for up to max_cycles or until trap_address is reached.
        Returns number of cycles executed.
        """
        start_cycles = self.cycles
        
        while (self.cycles - start_cycles) < max_cycles:
            if self.pc == trap_address:
                break
            
            opcode = self._read(self.pc)
            self.pc = (self.pc + 1) & 0xFFFF
            
            self.cycles += 2  # Fetch cycles
            self._step_op(opcode)
        
        return self.cycles - start_cycles
    
    def _step_op(self, opcode: int):
        """Execute a single opcode"""
        # Temporary variables
        addr = 0
        val = 0
        temp = 0
        
        # LDA - Load Accumulator
        if opcode == 0xA9:  # Immediate
            self.a = self._read(self.pc); self.pc += 1
            self._set_z(self.a); self._set_n(self.a)
        elif opcode == 0xA5:  # Zero Page
            self.a = self._read(self._read(self.pc)); self.pc += 1
            self._set_z(self.a); self._set_n(self.a); self.cycles += 1
        elif opcode == 0xB5:  # Zero Page,X
            self.a = self._read((self._read(self.pc) + self.x) & 0xFF); self.pc += 1
            self._set_z(self.a); self._set_n(self.a); self.cycles += 2
        elif opcode == 0xAD:  # Absolute
            self.a = self._read(self._read16(self.pc)); self.pc += 2
            self._set_z(self.a); self._set_n(self.a); self.cycles += 2
        elif opcode == 0xBD:  # Absolute,X
            addr = self._read16(self.pc); self.pc += 2
            self.a = self._read(addr + self.x)
            self._set_z(self.a); self._set_n(self.a); self.cycles += 2
        elif opcode == 0xB9:  # Absolute,Y
            addr = self._read16(self.pc); self.pc += 2
            self.a = self._read(addr + self.y)
            self._set_z(self.a); self._set_n(self.a); self.cycles += 2
        elif opcode == 0xA1:  # Indirect,X
            temp = (self._read(self.pc) + self.x) & 0xFF; self.pc += 1
            addr = self._read(temp) | (self._read((temp + 1) & 0xFF) << 8)
            self.a = self._read(addr)
            self._set_z(self.a); self._set_n(self.a); self.cycles += 4
        elif opcode == 0xB1:  # Indirect,Y
            temp = self._read(self.pc); self.pc += 1
            addr = (self._read(temp) | (self._read((temp + 1) & 0xFF) << 8)) + self.y
            self.a = self._read(addr)
            self._set_z(self.a); self._set_n(self.a); self.cycles += 3
        
        # LDX - Load X Register
        elif opcode == 0xA2:  # Immediate
            self.x = self._read(self.pc); self.pc += 1
            self._set_z(self.x); self._set_n(self.x)
        elif opcode == 0xA6:  # Zero Page
            self.x = self._read(self._read(self.pc)); self.pc += 1
            self._set_z(self.x); self._set_n(self.x); self.cycles += 1
        elif opcode == 0xB6:  # Zero Page,Y
            self.x = self._read((self._read(self.pc) + self.y) & 0xFF); self.pc += 1
            self._set_z(self.x); self._set_n(self.x); self.cycles += 2
        elif opcode == 0xAE:  # Absolute
            self.x = self._read(self._read16(self.pc)); self.pc += 2
            self._set_z(self.x); self._set_n(self.x); self.cycles += 2
        elif opcode == 0xBE:  # Absolute,Y
            addr = self._read16(self.pc); self.pc += 2
            self.x = self._read(addr + self.y)
            self._set_z(self.x); self._set_n(self.x); self.cycles += 2
        
        # LDY - Load Y Register
        elif opcode == 0xA0:  # Immediate
            self.y = self._read(self.pc); self.pc += 1
            self._set_z(self.y); self._set_n(self.y)
        elif opcode == 0xA4:  # Zero Page
            self.y = self._read(self._read(self.pc)); self.pc += 1
            self._set_z(self.y); self._set_n(self.y); self.cycles += 1
        elif opcode == 0xB4:  # Zero Page,X
            self.y = self._read((self._read(self.pc) + self.x) & 0xFF); self.pc += 1
            self._set_z(self.y); self._set_n(self.y); self.cycles += 2
        elif opcode == 0xAC:  # Absolute
            self.y = self._read(self._read16(self.pc)); self.pc += 2
            self._set_z(self.y); self._set_n(self.y); self.cycles += 2
        elif opcode == 0xBC:  # Absolute,X
            addr = self._read16(self.pc); self.pc += 2
            self.y = self._read(addr + self.x)
            self._set_z(self.y); self._set_n(self.y); self.cycles += 2
        
        # STA - Store Accumulator
        elif opcode == 0x85:  # Zero Page
            self._write(self._read(self.pc), self.a); self.pc += 1; self.cycles += 1
        elif opcode == 0x95:  # Zero Page,X
            self._write((self._read(self.pc) + self.x) & 0xFF, self.a); self.pc += 1; self.cycles += 2
        elif opcode == 0x8D:  # Absolute
            self._write(self._read16(self.pc), self.a); self.pc += 2; self.cycles += 2
        elif opcode == 0x9D:  # Absolute,X
            self._write(self._read16(self.pc) + self.x, self.a); self.pc += 2; self.cycles += 3
        elif opcode == 0x99:  # Absolute,Y
            self._write(self._read16(self.pc) + self.y, self.a); self.pc += 2; self.cycles += 3
        elif opcode == 0x81:  # Indirect,X
            temp = (self._read(self.pc) + self.x) & 0xFF; self.pc += 1
            addr = self._read(temp) | (self._read((temp + 1) & 0xFF) << 8)
            self._write(addr, self.a); self.cycles += 4
        elif opcode == 0x91:  # Indirect,Y
            temp = self._read(self.pc); self.pc += 1
            addr = (self._read(temp) | (self._read((temp + 1) & 0xFF) << 8)) + self.y
            self._write(addr, self.a); self.cycles += 4
        
        # STX - Store X Register
        elif opcode == 0x86:  # Zero Page
            self._write(self._read(self.pc), self.x); self.pc += 1; self.cycles += 1
        elif opcode == 0x96:  # Zero Page,Y
            self._write((self._read(self.pc) + self.y) & 0xFF, self.x); self.pc += 1; self.cycles += 2
        elif opcode == 0x8E:  # Absolute
            self._write(self._read16(self.pc), self.x); self.pc += 2; self.cycles += 2
        
        # STY - Store Y Register
        elif opcode == 0x84:  # Zero Page
            self._write(self._read(self.pc), self.y); self.pc += 1; self.cycles += 1
        elif opcode == 0x94:  # Zero Page,X
            self._write((self._read(self.pc) + self.x) & 0xFF, self.y); self.pc += 1; self.cycles += 2
        elif opcode == 0x8C:  # Absolute
            self._write(self._read16(self.pc), self.y); self.pc += 2; self.cycles += 2
        
        # Register transfers
        elif opcode == 0xAA:  # TAX
            self.x = self.a; self._set_z(self.x); self._set_n(self.x)
        elif opcode == 0xA8:  # TAY
            self.y = self.a; self._set_z(self.y); self._set_n(self.y)
        elif opcode == 0x8A:  # TXA
            self.a = self.x; self._set_z(self.a); self._set_n(self.a)
        elif opcode == 0x98:  # TYA
            self.a = self.y; self._set_z(self.a); self._set_n(self.a)
        elif opcode == 0xBA:  # TSX
            self.x = self.sp; self._set_z(self.x); self._set_n(self.x)
        elif opcode == 0x9A:  # TXS
            self.sp = self.x
        
        # Stack operations
        elif opcode == 0x48:  # PHA
            self._push(self.a); self.cycles += 1
        elif opcode == 0x08:  # PHP
            self._push(self.flags | 0x10); self.cycles += 1
        elif opcode == 0x68:  # PLA
            self.a = self._pop(); self._set_z(self.a); self._set_n(self.a); self.cycles += 2
        elif opcode == 0x28:  # PLP
            self.flags = self._pop() | 0x20; self.cycles += 2
        
        # SBC - Subtract with Carry
        elif opcode == 0xE9:  # Immediate
            self._sbc(self._read(self.pc)); self.pc += 1
        elif opcode == 0xE5:  # Zero Page
            self._sbc(self._read(self._read(self.pc))); self.pc += 1; self.cycles += 1
        elif opcode == 0xED:  # Absolute
            self._sbc(self._read(self._read16(self.pc))); self.pc += 2; self.cycles += 2
        elif opcode == 0xF9:  # Absolute,Y
            addr = self._read16(self.pc); self.pc += 2
            self._sbc(self._read(addr + self.y)); self.cycles += 2
        elif opcode == 0xFD:  # Absolute,X
            addr = self._read16(self.pc); self.pc += 2
            self._sbc(self._read(addr + self.x)); self.cycles += 2
        elif opcode == 0xE1:  # Indirect,X
            temp = (self._read(self.pc) + self.x) & 0xFF; self.pc += 1
            addr = self._read(temp) | (self._read((temp + 1) & 0xFF) << 8)
            self._sbc(self._read(addr)); self.cycles += 4
        elif opcode == 0xF1:  # Indirect,Y
            temp = self._read(self.pc); self.pc += 1
            addr = (self._read(temp) | (self._read((temp + 1) & 0xFF) << 8)) + self.y
            self._sbc(self._read(addr)); self.cycles += 3
        
        # ADC - Add with Carry
        elif opcode == 0x69:  # Immediate
            self._adc(self._read(self.pc)); self.pc += 1
        elif opcode == 0x65:  # Zero Page
            self._adc(self._read(self._read(self.pc))); self.pc += 1; self.cycles += 1
        elif opcode == 0x6D:  # Absolute
            self._adc(self._read(self._read16(self.pc))); self.pc += 2; self.cycles += 2
        elif opcode == 0x7D:  # Absolute,X
            addr = self._read16(self.pc); self.pc += 2
            self._adc(self._read(addr + self.x)); self.cycles += 2
        elif opcode == 0x79:  # Absolute,Y
            addr = self._read16(self.pc); self.pc += 2
            self._adc(self._read(addr + self.y)); self.cycles += 2
        elif opcode == 0x61:  # Indirect,X
            temp = (self._read(self.pc) + self.x) & 0xFF; self.pc += 1
            addr = self._read(temp) | (self._read((temp + 1) & 0xFF) << 8)
            self._adc(self._read(addr)); self.cycles += 4
        elif opcode == 0x71:  # Indirect,Y
            temp = self._read(self.pc); self.pc += 1
            addr = (self._read(temp) | (self._read((temp + 1) & 0xFF) << 8)) + self.y
            self._adc(self._read(addr)); self.cycles += 3
        
        # CMP - Compare accumulator
        elif opcode == 0xC9:  # Immediate
            self._cmp(self.a, self._read(self.pc)); self.pc += 1
        elif opcode == 0xC5:  # Zero Page
            self._cmp(self.a, self._read(self._read(self.pc))); self.pc += 1; self.cycles += 1
        elif opcode == 0xCD:  # Absolute
            self._cmp(self.a, self._read(self._read16(self.pc))); self.pc += 2; self.cycles += 2
        elif opcode == 0xDD:  # Absolute,X
            addr = self._read16(self.pc); self.pc += 2
            self._cmp(self.a, self._read(addr + self.x)); self.cycles += 2
        elif opcode == 0xD9:  # Absolute,Y
            addr = self._read16(self.pc); self.pc += 2
            self._cmp(self.a, self._read(addr + self.y)); self.cycles += 2
        elif opcode == 0xC1:  # Indirect,X
            temp = (self._read(self.pc) + self.x) & 0xFF; self.pc += 1
            addr = self._read(temp) | (self._read((temp + 1) & 0xFF) << 8)
            self._cmp(self.a, self._read(addr)); self.cycles += 4
        elif opcode == 0xD1:  # Indirect,Y
            temp = self._read(self.pc); self.pc += 1
            addr = (self._read(temp) | (self._read((temp + 1) & 0xFF) << 8)) + self.y
            self._cmp(self.a, self._read(addr)); self.cycles += 3
        
        # CPX - Compare X register
        elif opcode == 0xE0:  # Immediate
            self._cmp(self.x, self._read(self.pc)); self.pc += 1
        elif opcode == 0xE4:  # Zero Page
            self._cmp(self.x, self._read(self._read(self.pc))); self.pc += 1; self.cycles += 1
        elif opcode == 0xEC:  # Absolute
            self._cmp(self.x, self._read(self._read16(self.pc))); self.pc += 2; self.cycles += 2
        
        # CPY - Compare Y register
        elif opcode == 0xC0:  # Immediate
            self._cmp(self.y, self._read(self.pc)); self.pc += 1
        elif opcode == 0xC4:  # Zero Page
            self._cmp(self.y, self._read(self._read(self.pc))); self.pc += 1; self.cycles += 1
        elif opcode == 0xCC:  # Absolute
            self._cmp(self.y, self._read(self._read16(self.pc))); self.pc += 2; self.cycles += 2
        
        # AND - Logical AND
        elif opcode == 0x29:  # Immediate
            self.a &= self._read(self.pc); self.pc += 1
            self._set_z(self.a); self._set_n(self.a)
        elif opcode == 0x25:  # Zero Page
            self.a &= self._read(self._read(self.pc)); self.pc += 1
            self._set_z(self.a); self._set_n(self.a); self.cycles += 1
        elif opcode == 0x2D:  # Absolute
            self.a &= self._read(self._read16(self.pc)); self.pc += 2
            self._set_z(self.a); self._set_n(self.a); self.cycles += 2
        elif opcode == 0x3D:  # Absolute,X
            addr = self._read16(self.pc); self.pc += 2
            self.a &= self._read(addr + self.x)
            self._set_z(self.a); self._set_n(self.a); self.cycles += 2
        elif opcode == 0x39:  # Absolute,Y
            addr = self._read16(self.pc); self.pc += 2
            self.a &= self._read(addr + self.y)
            self._set_z(self.a); self._set_n(self.a); self.cycles += 2
        elif opcode == 0x21:  # Indirect,X
            temp = (self._read(self.pc) + self.x) & 0xFF; self.pc += 1
            addr = self._read(temp) | (self._read((temp + 1) & 0xFF) << 8)
            self.a &= self._read(addr)
            self._set_z(self.a); self._set_n(self.a); self.cycles += 4
        elif opcode == 0x31:  # Indirect,Y
            temp = self._read(self.pc); self.pc += 1
            addr = (self._read(temp) | (self._read((temp + 1) & 0xFF) << 8)) + self.y
            self.a &= self._read(addr)
            self._set_z(self.a); self._set_n(self.a); self.cycles += 3
        
        # ORA - Logical OR
        elif opcode == 0x09:  # Immediate
            self.a |= self._read(self.pc); self.pc += 1
            self._set_z(self.a); self._set_n(self.a)
        elif opcode == 0x05:  # Zero Page
            self.a |= self._read(self._read(self.pc)); self.pc += 1
            self._set_z(self.a); self._set_n(self.a); self.cycles += 1
        elif opcode == 0x0D:  # Absolute
            self.a |= self._read(self._read16(self.pc)); self.pc += 2
            self._set_z(self.a); self._set_n(self.a); self.cycles += 2
        elif opcode == 0x1D:  # Absolute,X
            addr = self._read16(self.pc); self.pc += 2
            self.a |= self._read(addr + self.x)
            self._set_z(self.a); self._set_n(self.a); self.cycles += 2
        elif opcode == 0x19:  # Absolute,Y
            addr = self._read16(self.pc); self.pc += 2
            self.a |= self._read(addr + self.y)
            self._set_z(self.a); self._set_n(self.a); self.cycles += 2
        elif opcode == 0x01:  # Indirect,X
            temp = (self._read(self.pc) + self.x) & 0xFF; self.pc += 1
            addr = self._read(temp) | (self._read((temp + 1) & 0xFF) << 8)
            self.a |= self._read(addr)
            self._set_z(self.a); self._set_n(self.a); self.cycles += 4
        elif opcode == 0x11:  # Indirect,Y
            temp = self._read(self.pc); self.pc += 1
            addr = (self._read(temp) | (self._read((temp + 1) & 0xFF) << 8)) + self.y
            self.a |= self._read(addr)
            self._set_z(self.a); self._set_n(self.a); self.cycles += 3
        
        # EOR - Logical XOR
        elif opcode == 0x49:  # Immediate
            self.a ^= self._read(self.pc); self.pc += 1
            self._set_z(self.a); self._set_n(self.a)
        elif opcode == 0x45:  # Zero Page
            self.a ^= self._read(self._read(self.pc)); self.pc += 1
            self._set_z(self.a); self._set_n(self.a); self.cycles += 1
        elif opcode == 0x4D:  # Absolute
            self.a ^= self._read(self._read16(self.pc)); self.pc += 2
            self._set_z(self.a); self._set_n(self.a); self.cycles += 2
        elif opcode == 0x5D:  # Absolute,X
            addr = self._read16(self.pc); self.pc += 2
            self.a ^= self._read(addr + self.x)
            self._set_z(self.a); self._set_n(self.a); self.cycles += 2
        elif opcode == 0x59:  # Absolute,Y
            addr = self._read16(self.pc); self.pc += 2
            self.a ^= self._read(addr + self.y)
            self._set_z(self.a); self._set_n(self.a); self.cycles += 2
        elif opcode == 0x41:  # Indirect,X
            temp = (self._read(self.pc) + self.x) & 0xFF; self.pc += 1
            addr = self._read(temp) | (self._read((temp + 1) & 0xFF) << 8)
            self.a ^= self._read(addr)
            self._set_z(self.a); self._set_n(self.a); self.cycles += 4
        elif opcode == 0x51:  # Indirect,Y
            temp = self._read(self.pc); self.pc += 1
            addr = (self._read(temp) | (self._read((temp + 1) & 0xFF) << 8)) + self.y
            self.a ^= self._read(addr)
            self._set_z(self.a); self._set_n(self.a); self.cycles += 3
        
        # INC - Increment memory
        elif opcode == 0xE6:  # Zero Page
            addr = self._read(self.pc); self.pc += 1
            val = (self._read(addr) + 1) & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 3
        elif opcode == 0xF6:  # Zero Page,X
            addr = (self._read(self.pc) + self.x) & 0xFF; self.pc += 1
            val = (self._read(addr) + 1) & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 4
        elif opcode == 0xEE:  # Absolute
            addr = self._read16(self.pc); self.pc += 2
            val = (self._read(addr) + 1) & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 4
        elif opcode == 0xFE:  # Absolute,X
            addr = self._read16(self.pc) + self.x; self.pc += 2
            val = (self._read(addr) + 1) & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 5
        
        # DEC - Decrement memory
        elif opcode == 0xC6:  # Zero Page
            addr = self._read(self.pc); self.pc += 1
            val = (self._read(addr) - 1) & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 3
        elif opcode == 0xD6:  # Zero Page,X
            addr = (self._read(self.pc) + self.x) & 0xFF; self.pc += 1
            val = (self._read(addr) - 1) & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 4
        elif opcode == 0xCE:  # Absolute
            addr = self._read16(self.pc); self.pc += 2
            val = (self._read(addr) - 1) & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 4
        elif opcode == 0xDE:  # Absolute,X
            addr = self._read16(self.pc) + self.x; self.pc += 2
            val = (self._read(addr) - 1) & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 5
        
        # INX, INY, DEX, DEY
        elif opcode == 0xE8:  # INX
            self.x = (self.x + 1) & 0xFF; self._set_z(self.x); self._set_n(self.x)
        elif opcode == 0xCA:  # DEX
            self.x = (self.x - 1) & 0xFF; self._set_z(self.x); self._set_n(self.x)
        elif opcode == 0xC8:  # INY
            self.y = (self.y + 1) & 0xFF; self._set_z(self.y); self._set_n(self.y)
        elif opcode == 0x88:  # DEY
            self.y = (self.y - 1) & 0xFF; self._set_z(self.y); self._set_n(self.y)
        
        # ASL - Arithmetic Shift Left
        elif opcode == 0x0A:  # Accumulator
            self._set_c((self.a & 0x80) != 0)
            self.a = (self.a << 1) & 0xFF
            self._set_z(self.a); self._set_n(self.a)
        elif opcode == 0x06:  # Zero Page
            addr = self._read(self.pc); self.pc += 1
            val = self._read(addr)
            self._set_c((val & 0x80) != 0)
            val = (val << 1) & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 3
        elif opcode == 0x16:  # Zero Page,X
            addr = (self._read(self.pc) + self.x) & 0xFF; self.pc += 1
            val = self._read(addr)
            self._set_c((val & 0x80) != 0)
            val = (val << 1) & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 4
        elif opcode == 0x0E:  # Absolute
            addr = self._read16(self.pc); self.pc += 2
            val = self._read(addr)
            self._set_c((val & 0x80) != 0)
            val = (val << 1) & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 4
        elif opcode == 0x1E:  # Absolute,X
            addr = self._read16(self.pc) + self.x; self.pc += 2
            val = self._read(addr)
            self._set_c((val & 0x80) != 0)
            val = (val << 1) & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 5
        
        # LSR - Logical Shift Right
        elif opcode == 0x4A:  # Accumulator
            self._set_c((self.a & 0x01) != 0)
            self.a = (self.a >> 1) & 0xFF
            self._set_z(self.a); self._set_n(self.a)
        elif opcode == 0x46:  # Zero Page
            addr = self._read(self.pc); self.pc += 1
            val = self._read(addr)
            self._set_c((val & 0x01) != 0)
            val = (val >> 1) & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 3
        elif opcode == 0x56:  # Zero Page,X
            addr = (self._read(self.pc) + self.x) & 0xFF; self.pc += 1
            val = self._read(addr)
            self._set_c((val & 0x01) != 0)
            val = (val >> 1) & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 4
        elif opcode == 0x4E:  # Absolute
            addr = self._read16(self.pc); self.pc += 2
            val = self._read(addr)
            self._set_c((val & 0x01) != 0)
            val = (val >> 1) & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 4
        elif opcode == 0x5E:  # Absolute,X
            addr = self._read16(self.pc) + self.x; self.pc += 2
            val = self._read(addr)
            self._set_c((val & 0x01) != 0)
            val = (val >> 1) & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 5
        
        # ROL - Rotate Left
        elif opcode == 0x2A:  # Accumulator
            temp = (self.a << 1) | (self.flags & 0x01)
            self._set_c((temp & 0x100) != 0)
            self.a = temp & 0xFF
            self._set_z(self.a); self._set_n(self.a)
        elif opcode == 0x26:  # Zero Page
            addr = self._read(self.pc); self.pc += 1
            val = self._read(addr)
            temp = (val << 1) | (self.flags & 0x01)
            self._set_c((temp & 0x100) != 0)
            val = temp & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 3
        elif opcode == 0x36:  # Zero Page,X
            addr = (self._read(self.pc) + self.x) & 0xFF; self.pc += 1
            val = self._read(addr)
            temp = (val << 1) | (self.flags & 0x01)
            self._set_c((temp & 0x100) != 0)
            val = temp & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 4
        elif opcode == 0x2E:  # Absolute
            addr = self._read16(self.pc); self.pc += 2
            val = self._read(addr)
            temp = (val << 1) | (self.flags & 0x01)
            self._set_c((temp & 0x100) != 0)
            val = temp & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 4
        elif opcode == 0x3E:  # Absolute,X
            addr = self._read16(self.pc) + self.x; self.pc += 2
            val = self._read(addr)
            temp = (val << 1) | (self.flags & 0x01)
            self._set_c((temp & 0x100) != 0)
            val = temp & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 5
        
        # ROR - Rotate Right
        elif opcode == 0x6A:  # Accumulator
            temp = (self.a >> 1) | ((self.flags & 0x01) << 7)
            self._set_c((self.a & 0x01) != 0)
            self.a = temp & 0xFF
            self._set_z(self.a); self._set_n(self.a)
        elif opcode == 0x66:  # Zero Page
            addr = self._read(self.pc); self.pc += 1
            val = self._read(addr)
            temp = (val >> 1) | ((self.flags & 0x01) << 7)
            self._set_c((val & 0x01) != 0)
            val = temp & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 3
        elif opcode == 0x76:  # Zero Page,X
            addr = (self._read(self.pc) + self.x) & 0xFF; self.pc += 1
            val = self._read(addr)
            temp = (val >> 1) | ((self.flags & 0x01) << 7)
            self._set_c((val & 0x01) != 0)
            val = temp & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 4
        elif opcode == 0x6E:  # Absolute
            addr = self._read16(self.pc); self.pc += 2
            val = self._read(addr)
            temp = (val >> 1) | ((self.flags & 0x01) << 7)
            self._set_c((val & 0x01) != 0)
            val = temp & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 4
        elif opcode == 0x7E:  # Absolute,X
            addr = self._read16(self.pc) + self.x; self.pc += 2
            val = self._read(addr)
            temp = (val >> 1) | ((self.flags & 0x01) << 7)
            self._set_c((val & 0x01) != 0)
            val = temp & 0xFF
            self._write(addr, val)
            self._set_z(val); self._set_n(val); self.cycles += 5
        
        # BIT - Test bits
        elif opcode == 0x24:  # Zero Page
            val = self._read(self._read(self.pc)); self.pc += 1
            self._set_z(self.a & val)
            self._set_n(val)
            if val & 0x40:
                self.flags |= 0x40
            else:
                self.flags &= ~0x40
            self.cycles += 1
        elif opcode == 0x2C:  # Absolute
            val = self._read(self._read16(self.pc)); self.pc += 2
            self._set_z(self.a & val)
            self._set_n(val)
            if val & 0x40:
                self.flags |= 0x40
            else:
                self.flags &= ~0x40
            self.cycles += 2
        
        # JMP - Jump
        elif opcode == 0x4C:  # Absolute
            self.pc = self._read16(self.pc); self.cycles += 1
        elif opcode == 0x6C:  # Indirect
            self.pc = self._read16_bug(self._read16(self.pc)); self.cycles += 3
        
        # JSR/RTS/RTI
        elif opcode == 0x20:  # JSR
            addr = self._read16(self.pc)
            self._push(((self.pc + 1) >> 8) & 0xFF)
            self._push((self.pc + 1) & 0xFF)
            self.pc = addr
            self.cycles += 4
        elif opcode == 0x60:  # RTS
            self.pc = ((self._pop() | (self._pop() << 8)) + 1) & 0xFFFF
            self.cycles += 4
        elif opcode == 0x40:  # RTI
            self.flags = self._pop() | 0x20
            self.pc = self._pop() | (self._pop() << 8)
            self.cycles += 4
        
        # BRK
        elif opcode == 0x00:
            self.pc += 1
            self._push((self.pc >> 8) & 0xFF)
            self._push(self.pc & 0xFF)
            self._push(self.flags | 0x10)
            self.flags |= 0x04
            self.pc = self._read16(0xFFFE)
            self.cycles += 5
        
        # Branch instructions
        elif opcode == 0x10:  # BPL
            self._branch((self.flags & 0x80) == 0)
        elif opcode == 0x30:  # BMI
            self._branch((self.flags & 0x80) != 0)
        elif opcode == 0x50:  # BVC
            self._branch((self.flags & 0x40) == 0)
        elif opcode == 0x70:  # BVS
            self._branch((self.flags & 0x40) != 0)
        elif opcode == 0x90:  # BCC
            self._branch((self.flags & 0x01) == 0)
        elif opcode == 0xB0:  # BCS
            self._branch((self.flags & 0x01) != 0)
        elif opcode == 0xD0:  # BNE
            self._branch((self.flags & 0x02) == 0)
        elif opcode == 0xF0:  # BEQ
            self._branch((self.flags & 0x02) != 0)
        
        # Flag operations
        elif opcode == 0x18:  # CLC
            self.flags &= ~0x01
        elif opcode == 0x38:  # SEC
            self.flags |= 0x01
        elif opcode == 0x58:  # CLI
            self.flags &= ~0x04
        elif opcode == 0x78:  # SEI
            self.flags |= 0x04
        elif opcode == 0xB8:  # CLV
            self.flags &= ~0x40
        elif opcode == 0xD8:  # CLD
            self.flags &= ~0x08
        elif opcode == 0xF8:  # SED
            self.flags |= 0x08
        
        # NOP and illegal opcodes
        elif opcode == 0xEA:  # NOP
            pass
        # Illegal opcodes - NOPs
        elif opcode in (0x1A, 0x3A, 0x5A, 0x7A, 0xDA, 0xFA):
            pass
        # DOP (double NOP) - 2 byte NOPs
        elif opcode in (0x04, 0x14, 0x34, 0x44, 0x54, 0x64, 0x74, 0x80, 0x82, 0x89, 0xC2, 0xD4, 0xE2, 0xF4):
            self.pc += 1
            self.cycles += 1
        # TOP (triple NOP) - 3 byte NOPs
        elif opcode in (0x0C, 0x1C, 0x3C, 0x5C, 0x7C, 0xDC, 0xFC):
            self.pc += 2
            self.cycles += 2
        # Unknown opcode - just continue
        else:
            pass
    
    def _adc(self, val: int):
        """Add with carry"""
        if (self.flags & 0x08) != 0:
            # Decimal mode
            low = (self.a & 0x0F) + (val & 0x0F) + (self.flags & 0x01)
            half_carry = 0
            if low > 9:
                low += 6
                low &= 0x0F
                half_carry = 1
            high = (self.a >> 4) + (val >> 4) + half_carry
            self._set_z((self.a + val + (self.flags & 0x01)) & 0xFF)
            self._set_n((high << 4) | low)
            
            sum_binary = self.a + val + (self.flags & 0x01)
            if not ((self.a ^ val) & 0x80) and ((self.a ^ sum_binary) & 0x80):
                self.flags |= 0x40
            else:
                self.flags &= ~0x40
            
            if high > 9:
                high += 6
            self._set_c(high > 15)
            self.a = ((high << 4) | low) & 0xFF
        else:
            # Binary mode
            sum_val = self.a + val + (self.flags & 0x01)
            if not ((self.a ^ val) & 0x80) and ((self.a ^ sum_val) & 0x80):
                self.flags |= 0x40
            else:
                self.flags &= ~0x40
            
            self._set_c(sum_val > 0xFF)
            self.a = sum_val & 0xFF
            self._set_z(self.a)
            self._set_n(self.a)
    
    def _sbc(self, val: int):
        """Subtract with carry"""
        if (self.flags & 0x08) != 0:
            # Decimal mode
            low = (self.a & 0x0F) - (val & 0x0F) - (0 if (self.flags & 0x01) else 1)
            half_carry = 0
            if low < 0:
                low -= 6
                low &= 0x0F
                half_carry = 1
            high = (self.a >> 4) - (val >> 4) - half_carry
            if high < 0:
                high -= 6
            
            sum_binary = self.a - val - (0 if (self.flags & 0x01) else 1)
            self._set_c(sum_binary >= 0)
            self._set_z(sum_binary & 0xFF)
            self._set_n(sum_binary & 0xFF)
            
            val_inverted = val ^ 0xFF
            if not ((self.a ^ val_inverted) & 0x80) and ((self.a ^ sum_binary) & 0x80):
                self.flags |= 0x40
            else:
                self.flags &= ~0x40
            
            self.a = ((high << 4) | low) & 0xFF
        else:
            # Binary mode - use ADC with inverted operand
            self._adc(val ^ 0xFF)
    
    def _cmp(self, reg: int, val: int):
        """Compare register with value"""
        res = reg - val
        self._set_c(res >= 0)
        self._set_z(res & 0xFF)
        self._set_n(res & 0xFF)
    
    def _branch(self, cond: bool):
        """Branch if condition is true"""
        if cond:
            offset = self._read(self.pc)
            self.pc += 1
            if offset & 0x80:
                offset -= 0x100
            
            old_pc = self.pc
            self.pc = (self.pc + offset) & 0xFFFF
            self.cycles += 1
            
            # Page crossing penalty
            if (self.pc & 0xFF00) != (old_pc & 0xFF00):
                self.cycles += 1
        else:
            self.pc += 1
