"""MOS 6510 CPU core (C64) — timing-aware emulator.

This implementation is designed for SID playback and “as-close-as-reasonable”
1:1 behavior within this repo's architecture.

Phase 1 focus:
  • Correct instruction-boundary IRQ/NMI sampling (NMI edge latched).
  • Base cycle counts from opcode_table + runtime penalties:
      - branch taken (+1), branch page cross (+1)
      - ABX/ABY/IDY page cross penalty for read-like opcodes (+1)
  • RMW bus pattern (read, *dummy write old*, write new) for IO correctness.
  • Optional CPU trace output (instruction-level) compatible with VICE-style logs.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Protocol, Tuple

from .logger import system_logger
from .opcode_table import OPCODE_TABLE


class Bus(Protocol):
    def read(self, addr: int) -> int: ...
    def write(self, addr: int, val: int) -> None: ...


class Status:
    C = 0x01
    Z = 0x02
    I = 0x04
    D = 0x08
    B = 0x10
    U = 0x20
    V = 0x40
    N = 0x80


@dataclass(frozen=True)
class DecodedOpcode:
    name: str
    mode: str
    base_cycles: int


class CpuJammed(RuntimeError):
    pass


class Cpu6510:
    """MOS 6510 CPU emulator (instruction-level timing + IO-correct RMW)."""

    # Addressing modes that *can* incur page-cross penalties for read-like opcodes.
    _PAGE_PENALTY_MODES = {"ABX", "ABY", "IDY"}

    # Mnemonics that should receive +1 cycle on page-cross for ABX/ABY/IDY.
    # (Stores/RMW already include the extra cycle in base timings.)
    _PAGE_PENALTY_MNEMONICS = {
        # loads
        "LDA", "LDX", "LDY", "LAX", "LAS",
        # ALU read
        "ADC", "SBC", "AND", "ORA", "EOR",
        # compares
        "CMP", "CPX", "CPY", "DCP",
        # shifts that are *not* RMW (none here), and misc reads
        "BIT",
        # some illegal NOPs with operand read behave like reads
        "NOP",
        "ANC", "ALR", "ARR", "AXS", "XAA",
        # illegal read-modify-write combos *do not* need page penalty (base cycles already)
    }

    # Mnemonics that do a memory store (no page-cross penalty)
    _STORE_MNEMONICS = {"STA", "STX", "STY", "SAX", "AHX", "SHX", "SHY", "TAS"}

    # Mnemonics that are RMW on memory and must do dummy write old value.
    _RMW_MNEMONICS = {
        "ASL", "LSR", "ROL", "ROR", "INC", "DEC",
        "SLO", "RLA", "SRE", "RRA", "DCP", "ISC",
    }

    def __init__(self, bus: Bus):
        self.bus = bus

        # Registers
        self.a = 0
        self.x = 0
        self.y = 0
        self.sp = 0xFD
        self.pc = 0x0000
        self.p = Status.U | Status.I

        # Monotonic cycle counter (what the rest of the repo expects)
        self.cycles = 0
        self.stalled = False

        # Interrupt lines
        self._irq_level = False
        self._nmi_level = False
        self._nmi_latched = False
        
        # IRQ latching for priority handling
        self._irq_latched = False
        self._irq_priority_counter = 0

        # Execution state
        self.halted = False

        # Trace config
        self.trace = False
        self.trace_bus = False
        self.trace_count = 0
        self.max_trace_instructions: Optional[int] = None

        # Predecode table for speed
        self._decode = [DecodedOpcode("NOP", "IMP", 2)] * 256
        for op, (mn, mode, cyc) in OPCODE_TABLE.items():
            self._decode[op] = DecodedOpcode(mn, mode, int(cyc))

    # -----------------
    # Public interface
    # -----------------
    def reset(self) -> None:
        self.a = 0
        self.x = 0
        self.y = 0
        self.sp = 0xFD
        self.p = Status.U | Status.I
        self.cycles = 0
        self.stalled = False
        self.halted = False

        lo = self.read(0xFFFC)
        hi = self.read(0xFFFD)
        self.pc = (hi << 8) | lo

        self._irq_level = False
        self._nmi_level = False
        self._nmi_latched = False
        self._irq_latched = False
        self._irq_priority_counter = 0

    def irq(self, active: bool) -> None:
        """IRQ is level-triggered."""
        self._irq_level = bool(active)

    def nmi(self, active: bool) -> None:
        """NMI is edge-triggered; we latch the rising edge of `active`.

        Note: In this repo, the system wires `active=True` when CIA2 requests NMI.
        """
        active = bool(active)
        if active and not self._nmi_level:
            self._nmi_latched = True
        self._nmi_level = active

    def set_trace(self, enabled: bool = True, max_instructions: Optional[int] = None, *, bus: bool = False) -> None:
        self.trace = bool(enabled)
        self.trace_bus = bool(bus)
        self.trace_count = 0
        self.max_trace_instructions = max_instructions

    def get_state_dump(self) -> str:
        return (
            f"PC=${self.pc:04X} A=${self.a:02X} X=${self.x:02X} Y=${self.y:02X} "
            f"SP=${self.sp:02X} P=${self.p:02X} CYC={self.cycles} "
            f"IRQ={'1' if self._irq_level else '0'} NMI={'1' if self._nmi_level else '0'}"
        )

    def step(self) -> int:
        """Execute one instruction. Returns cycles consumed."""
        if self.halted:
            raise CpuJammed("CPU is JAMmed (halted)")

        cyc0 = self.cycles
        pc0 = self.pc

        # ---- Interrupt sampling happens at instruction boundaries ----
        if self._nmi_latched:
            self._nmi_latched = False
            # NMI has priority, but IRQ can remain latched
            if self._irq_level and not (self.p & Status.I):
                self._irq_latched = True
            used = self._service_interrupt(vector=0xFFFA, break_flag=False)
            self._trace_interrupt(cyc0, pc0, "NMI", used)
            return used

        if self._irq_level and not (self.p & Status.I):
            used = self._service_interrupt(vector=0xFFFE, break_flag=False)
            self._trace_interrupt(cyc0, pc0, "IRQ", used)
            return used
        
        # Check latched IRQ
        if self._irq_latched and not (self.p & Status.I):
            self._irq_latched = False
            used = self._service_interrupt(vector=0xFFFE, break_flag=False)
            self._trace_interrupt(cyc0, pc0, "IRQ", used)
            return used

        # ---- Normal instruction ----
        opcode = self.read(self.pc)
        self.pc = (self.pc + 1) & 0xFFFF

        dec = self._decode[opcode]
        mnemonic_raw = dec.name
        illegal = mnemonic_raw.startswith("*")
        mnemonic = mnemonic_raw[1:] if illegal else mnemonic_raw
        mode = dec.mode

        base_cycles = dec.base_cycles
        extra_cycles = 0

        addr: Optional[int] = None
        imm: Optional[int] = None
        page_cross = False
        dummy_addr: Optional[int] = None

        # Decode addressing / fetch operands
        addr, imm, page_cross, dummy_addr = self._resolve_operand(mode)

        # Execute (may modify extra_cycles and/or perform dummy reads/writes)
        extra_cycles += self._execute(mnemonic, mode, addr, imm, page_cross, dummy_addr)

        used = base_cycles + extra_cycles
        self.cycles += used

        # Trace line (post-state, but includes original PC/opcode)
        self._trace_instruction(cyc0, pc0, opcode, mnemonic_raw, mode, addr, imm, used)

        return used

    def execute(self, max_cycles: int, trap_address: int = -1) -> int:
        """Run until max_cycles spent (relative) or PC hits trap_address."""
        start = self.cycles
        while (self.cycles - start) < int(max_cycles):
            if trap_address >= 0 and self.pc == trap_address:
                break
            self.step()
        return self.cycles - start

    # --------------
    # Bus helpers
    # --------------
    def read(self, addr: int) -> int:
        return self.bus.read(addr & 0xFFFF) & 0xFF

    def write(self, addr: int, val: int) -> None:
        self.bus.write(addr & 0xFFFF, val & 0xFF)

    def _push(self, val: int) -> None:
        self.write(0x0100 | self.sp, val)
        self.sp = (self.sp - 1) & 0xFF

    def _pop(self) -> int:
        self.sp = (self.sp + 1) & 0xFF
        return self.read(0x0100 | self.sp)

    def _read16(self, addr: int) -> int:
        lo = self.read(addr)
        hi = self.read((addr + 1) & 0xFFFF)
        return (hi << 8) | lo

    def _read16_bug(self, addr: int) -> int:
        """6502 JMP ($xxFF) page-wrap bug."""
        lo = self.read(addr)
        hi_addr = (addr & 0xFF00) | ((addr + 1) & 0x00FF)
        hi = self.read(hi_addr)
        return (hi << 8) | lo

    # ----------------
    # Flag helpers
    # ----------------
    def _set_flag(self, flag: int, cond: bool) -> None:
        if cond:
            self.p |= flag
        else:
            self.p &= (~flag) & 0xFF
        self.p |= Status.U

    def _set_nz(self, val: int) -> None:
        val &= 0xFF
        self._set_flag(Status.Z, val == 0)
        self._set_flag(Status.N, (val & 0x80) != 0)

    # --------------------------
    # Interrupt service
    # --------------------------
    def _service_interrupt(self, vector: int, *, break_flag: bool) -> int:
        """Common IRQ/NMI/BRK entry. Returns fixed 7 cycles."""
        # Push PC (current)
        self._push((self.pc >> 8) & 0xFF)
        self._push(self.pc & 0xFF)

        # Push status
        p_push = self.p | Status.U
        if break_flag:
            p_push |= Status.B
        else:
            p_push &= (~Status.B) & 0xFF
        self._push(p_push)

        # Set I
        self.p |= Status.I
        self.p |= Status.U

        # Vector
        self.pc = self._read16(vector)
        return 7

    # --------------------------
    # Addressing / operand fetch
    # --------------------------
    def _resolve_operand(self, mode: str) -> Tuple[Optional[int], Optional[int], bool, Optional[int]]:
        """Return (addr, imm, page_cross, dummy_addr)."""
        if mode == "IMP":
            return None, None, False, None
        if mode == "ACC":
            return None, None, False, None
        if mode == "IMM":
            v = self.read(self.pc)
            self.pc = (self.pc + 1) & 0xFFFF
            return None, v, False, None
        if mode == "ZP":
            a = self.read(self.pc)
            self.pc = (self.pc + 1) & 0xFFFF
            return a, None, False, None
        if mode == "ZPX":
            base = self.read(self.pc)
            self.pc = (self.pc + 1) & 0xFFFF
            a = (base + self.x) & 0xFF
            return a, None, False, None
        if mode == "ZPY":
            base = self.read(self.pc)
            self.pc = (self.pc + 1) & 0xFFFF
            a = (base + self.y) & 0xFF
            return a, None, False, None
        if mode == "ABS":
            lo = self.read(self.pc)
            hi = self.read((self.pc + 1) & 0xFFFF)
            self.pc = (self.pc + 2) & 0xFFFF
            return (hi << 8) | lo, None, False, None
        if mode == "ABX":
            lo = self.read(self.pc)
            hi = self.read((self.pc + 1) & 0xFFFF)
            self.pc = (self.pc + 2) & 0xFFFF
            base = (hi << 8) | lo
            a = (base + self.x) & 0xFFFF
            page_cross = (base & 0xFF00) != (a & 0xFF00)
            dummy = (base & 0xFF00) | (a & 0x00FF)
            return a, None, page_cross, dummy
        if mode == "ABY":
            lo = self.read(self.pc)
            hi = self.read((self.pc + 1) & 0xFFFF)
            self.pc = (self.pc + 2) & 0xFFFF
            base = (hi << 8) | lo
            a = (base + self.y) & 0xFFFF
            page_cross = (base & 0xFF00) != (a & 0xFF00)
            dummy = (base & 0xFF00) | (a & 0x00FF)
            return a, None, page_cross, dummy
        if mode == "IND":
            lo = self.read(self.pc)
            hi = self.read((self.pc + 1) & 0xFFFF)
            self.pc = (self.pc + 2) & 0xFFFF
            ptr = (hi << 8) | lo
            return self._read16_bug(ptr), None, False, None
        if mode == "IDX":
            zp = (self.read(self.pc) + self.x) & 0xFF
            self.pc = (self.pc + 1) & 0xFFFF
            lo = self.read(zp)
            hi = self.read((zp + 1) & 0xFF)
            return (hi << 8) | lo, None, False, None
        if mode == "IDY":
            zp = self.read(self.pc)
            self.pc = (self.pc + 1) & 0xFFFF
            lo = self.read(zp)
            hi = self.read((zp + 1) & 0xFF)
            base = (hi << 8) | lo
            a = (base + self.y) & 0xFFFF
            page_cross = (base & 0xFF00) != (a & 0xFF00)
            dummy = (base & 0xFF00) | (a & 0x00FF)
            return a, None, page_cross, dummy
        if mode == "REL":
            off = self.read(self.pc)
            self.pc = (self.pc + 1) & 0xFFFF
            rel = off if off < 0x80 else off - 0x100
            target = (self.pc + rel) & 0xFFFF
            page_cross = (self.pc & 0xFF00) != (target & 0xFF00)
            return target, None, page_cross, None

        # Unknown mode (should not happen)
        return None, None, False, None

    # --------------------------
    # Execution / instruction set
    # --------------------------
    def _page_cross_penalty(self, mnemonic: str, mode: str, page_cross: bool) -> int:
        if not page_cross:
            return 0
        if mode not in self._PAGE_PENALTY_MODES:
            return 0
        if mnemonic in self._STORE_MNEMONICS:
            return 0
        # RMW already accounted
        if mnemonic in self._RMW_MNEMONICS:
            return 0
        # If it's an illegal mnemonic that behaves like NOP, treat it as NOP.
        if mnemonic == "NOP" or mnemonic in self._PAGE_PENALTY_MNEMONICS:
            return 1
        # Conservative: no penalty.
        return 0

    def _dummy_read_for_page_cross(self, dummy_addr: Optional[int]) -> None:
        if dummy_addr is not None:
            _ = self.read(dummy_addr)

    def _rmw(self, addr: int, op: str) -> int:
        """Perform RMW bus pattern and return new value."""
        old = self.read(addr)
        # Dummy write old value (IO correctness)
        self.write(addr, old)
        if op == "ASL":
            self._set_flag(Status.C, (old & 0x80) != 0)
            new = (old << 1) & 0xFF
        elif op == "LSR":
            self._set_flag(Status.C, (old & 0x01) != 0)
            new = (old >> 1) & 0xFF
        elif op == "ROL":
            carry_in = 1 if (self.p & Status.C) else 0
            self._set_flag(Status.C, (old & 0x80) != 0)
            new = ((old << 1) | carry_in) & 0xFF
        elif op == "ROR":
            carry_in = 0x80 if (self.p & Status.C) else 0
            self._set_flag(Status.C, (old & 0x01) != 0)
            new = ((old >> 1) | carry_in) & 0xFF
        elif op == "INC":
            new = (old + 1) & 0xFF
        elif op == "DEC":
            new = (old - 1) & 0xFF
        else:
            new = old
        self.write(addr, new)
        self._set_nz(new)
        return new

    def _adc(self, val: int) -> None:
        a = self.a
        c = 1 if (self.p & Status.C) else 0
        if self.p & Status.D:
            # BCD adjust (NMOS 6502 style)
            s = a + val + c
            v = (~(a ^ val) & (a ^ s) & 0x80) != 0
            lo = (a & 0x0F) + (val & 0x0F) + c
            hi = (a >> 4) + (val >> 4)
            if lo > 9:
                lo += 6
                hi += 1
            if hi > 9:
                hi += 6
            self._set_flag(Status.C, hi > 15)
            res = ((hi << 4) | (lo & 0x0F)) & 0xFF
            self.a = res
            self._set_nz(res)
            self._set_flag(Status.V, v)
        else:
            s = a + val + c
            res = s & 0xFF
            self._set_flag(Status.C, s > 0xFF)
            self._set_flag(Status.V, (~(a ^ val) & (a ^ res) & 0x80) != 0)
            self.a = res
            self._set_nz(res)

    def _sbc(self, val: int) -> None:
        a = self.a
        c = 1 if (self.p & Status.C) else 0
        if self.p & Status.D:
            # BCD subtract
            diff = a - val - (1 - c)
            v = ((a ^ val) & (a ^ diff) & 0x80) != 0
            lo = (a & 0x0F) - (val & 0x0F) - (1 - c)
            hi = (a >> 4) - (val >> 4)
            if lo < 0:
                lo -= 6
                hi -= 1
            if hi < 0:
                hi -= 6
            self._set_flag(Status.C, diff >= 0)
            res = ((hi << 4) | (lo & 0x0F)) & 0xFF
            self.a = res
            self._set_nz(res)
            self._set_flag(Status.V, v)
        else:
            diff = a - val - (1 - c)
            res = diff & 0xFF
            self._set_flag(Status.C, diff >= 0)
            self._set_flag(Status.V, ((a ^ val) & (a ^ res) & 0x80) != 0)
            self.a = res
            self._set_nz(res)

    def _execute(
        self,
        mnemonic: str,
        mode: str,
        addr: Optional[int],
        imm: Optional[int],
        page_cross: bool,
        dummy_addr: Optional[int],
    ) -> int:
        """Execute instruction and return extra cycles beyond base."""

        extra = 0

        # Branches: base 2, +1 if taken, +1 if page cross
        if mnemonic in {"BCC", "BCS", "BEQ", "BMI", "BNE", "BPL", "BVC", "BVS"}:
            assert mode == "REL" and addr is not None
            take = False
            if mnemonic == "BCC":
                take = (self.p & Status.C) == 0
            elif mnemonic == "BCS":
                take = (self.p & Status.C) != 0
            elif mnemonic == "BEQ":
                take = (self.p & Status.Z) != 0
            elif mnemonic == "BMI":
                take = (self.p & Status.N) != 0
            elif mnemonic == "BNE":
                take = (self.p & Status.Z) == 0
            elif mnemonic == "BPL":
                take = (self.p & Status.N) == 0
            elif mnemonic == "BVC":
                take = (self.p & Status.V) == 0
            elif mnemonic == "BVS":
                take = (self.p & Status.V) != 0
            if take:
                extra += 1
                # branch crosses page?
                # `page_cross` computed in REL resolution using current PC (after offset fetch)
                if page_cross:
                    extra += 1
                self.pc = addr
            return extra

        # Page-cross penalty for eligible ops (and do dummy read for IO correctness)
        page_pen = self._page_cross_penalty(mnemonic, mode, page_cross)
        if page_pen:
            self._dummy_read_for_page_cross(dummy_addr)
            extra += page_pen

        # Helpers to fetch operand value
        def opval() -> int:
            if mode == "IMM":
                assert imm is not None
                return imm & 0xFF
            assert addr is not None
            return self.read(addr)

        # Helpers for stores
        def store(v: int) -> None:
            assert addr is not None
            self.write(addr, v)

        # -----------
        # Legal ops
        # -----------
        if mnemonic == "NOP":
            return extra

        if mnemonic == "LDA":
            self.a = opval()
            self._set_nz(self.a)
            return extra
        if mnemonic == "LDX":
            self.x = opval()
            self._set_nz(self.x)
            return extra
        if mnemonic == "LDY":
            self.y = opval()
            self._set_nz(self.y)
            return extra

        if mnemonic == "STA":
            store(self.a)
            return extra
        if mnemonic == "STX":
            store(self.x)
            return extra
        if mnemonic == "STY":
            store(self.y)
            return extra

        if mnemonic == "TAX":
            self.x = self.a
            self._set_nz(self.x)
            return extra
        if mnemonic == "TAY":
            self.y = self.a
            self._set_nz(self.y)
            return extra
        if mnemonic == "TXA":
            self.a = self.x
            self._set_nz(self.a)
            return extra
        if mnemonic == "TYA":
            self.a = self.y
            self._set_nz(self.a)
            return extra
        if mnemonic == "TSX":
            self.x = self.sp
            self._set_nz(self.x)
            return extra
        if mnemonic == "TXS":
            self.sp = self.x
            return extra

        if mnemonic == "PHA":
            self._push(self.a)
            return extra
        if mnemonic == "PHP":
            self._push(self.p | Status.B | Status.U)
            return extra
        if mnemonic == "PLA":
            self.a = self._pop()
            self._set_nz(self.a)
            return extra
        if mnemonic == "PLP":
            self.p = (self._pop() | Status.U) & 0xFF
            return extra

        if mnemonic == "CLC":
            self._set_flag(Status.C, False)
            return extra
        if mnemonic == "SEC":
            self._set_flag(Status.C, True)
            return extra
        if mnemonic == "CLI":
            self._set_flag(Status.I, False)
            return extra
        if mnemonic == "SEI":
            self._set_flag(Status.I, True)
            return extra
        if mnemonic == "CLD":
            self._set_flag(Status.D, False)
            return extra
        if mnemonic == "SED":
            self._set_flag(Status.D, True)
            return extra
        if mnemonic == "CLV":
            self._set_flag(Status.V, False)
            return extra

        if mnemonic == "AND":
            self.a = self.a & opval()
            self._set_nz(self.a)
            return extra
        if mnemonic == "ORA":
            self.a = self.a | opval()
            self._set_nz(self.a)
            return extra
        if mnemonic == "EOR":
            self.a = self.a ^ opval()
            self._set_nz(self.a)
            return extra

        if mnemonic == "ADC":
            self._adc(opval())
            return extra
        if mnemonic == "SBC":
            self._sbc(opval())
            return extra

        if mnemonic == "CMP":
            v = opval()
            t = (self.a - v) & 0x1FF
            self._set_flag(Status.C, self.a >= v)
            self._set_nz(t & 0xFF)
            return extra
        if mnemonic == "CPX":
            v = opval()
            t = (self.x - v) & 0x1FF
            self._set_flag(Status.C, self.x >= v)
            self._set_nz(t & 0xFF)
            return extra
        if mnemonic == "CPY":
            v = opval()
            t = (self.y - v) & 0x1FF
            self._set_flag(Status.C, self.y >= v)
            self._set_nz(t & 0xFF)
            return extra

        if mnemonic == "BIT":
            v = opval()
            self._set_flag(Status.Z, (self.a & v) == 0)
            self._set_flag(Status.N, (v & 0x80) != 0)
            self._set_flag(Status.V, (v & 0x40) != 0)
            return extra

        if mnemonic == "INC":
            assert addr is not None
            _ = self._rmw(addr, "INC")
            return extra
        if mnemonic == "DEC":
            assert addr is not None
            _ = self._rmw(addr, "DEC")
            return extra
        if mnemonic == "INX":
            self.x = (self.x + 1) & 0xFF
            self._set_nz(self.x)
            return extra
        if mnemonic == "INY":
            self.y = (self.y + 1) & 0xFF
            self._set_nz(self.y)
            return extra
        if mnemonic == "DEX":
            self.x = (self.x - 1) & 0xFF
            self._set_nz(self.x)
            return extra
        if mnemonic == "DEY":
            self.y = (self.y - 1) & 0xFF
            self._set_nz(self.y)
            return extra

        if mnemonic == "ASL":
            if mode == "ACC":
                self._set_flag(Status.C, (self.a & 0x80) != 0)
                self.a = (self.a << 1) & 0xFF
                self._set_nz(self.a)
            else:
                assert addr is not None
                _ = self._rmw(addr, "ASL")
            return extra
        if mnemonic == "LSR":
            if mode == "ACC":
                self._set_flag(Status.C, (self.a & 0x01) != 0)
                self.a = (self.a >> 1) & 0xFF
                self._set_nz(self.a)
            else:
                assert addr is not None
                _ = self._rmw(addr, "LSR")
            return extra
        if mnemonic == "ROL":
            if mode == "ACC":
                carry_in = 1 if (self.p & Status.C) else 0
                self._set_flag(Status.C, (self.a & 0x80) != 0)
                self.a = ((self.a << 1) | carry_in) & 0xFF
                self._set_nz(self.a)
            else:
                assert addr is not None
                _ = self._rmw(addr, "ROL")
            return extra
        if mnemonic == "ROR":
            if mode == "ACC":
                carry_in = 0x80 if (self.p & Status.C) else 0
                self._set_flag(Status.C, (self.a & 0x01) != 0)
                self.a = ((self.a >> 1) | carry_in) & 0xFF
                self._set_nz(self.a)
            else:
                assert addr is not None
                _ = self._rmw(addr, "ROR")
            return extra

        if mnemonic == "JMP":
            assert addr is not None
            self.pc = addr
            return extra

        if mnemonic == "JSR":
            # mode is ABS in table; addr is target
            assert addr is not None
            # Push address of last byte of JSR operand
            ret = (self.pc - 1) & 0xFFFF
            self._push((ret >> 8) & 0xFF)
            self._push(ret & 0xFF)
            self.pc = addr
            return extra

        if mnemonic == "RTS":
            lo = self._pop()
            hi = self._pop()
            self.pc = (((hi << 8) | lo) + 1) & 0xFFFF
            return extra

        if mnemonic == "RTI":
            self.p = (self._pop() | Status.U) & 0xFF
            lo = self._pop()
            hi = self._pop()
            self.pc = (hi << 8) | lo
            return extra

        if mnemonic == "BRK":
            # BRK acts like a 2-byte instruction; PC already points to next byte.
            self.pc = (self.pc + 1) & 0xFFFF
            used = self._service_interrupt(vector=0xFFFE, break_flag=True)
            # base cycles already 7; we return adjustment relative to base.
            return extra + (used - 7)

        # -------------
        # Undocumented
        # -------------
        if mnemonic == "JAM":
            self.halted = True
            return extra

        if mnemonic == "LAX":
            v = opval()
            self.a = v
            self.x = v
            self._set_nz(v)
            return extra

        if mnemonic == "SAX":
            store(self.a & self.x)
            return extra

        if mnemonic == "SLO":
            assert addr is not None
            v = self._rmw(addr, "ASL")
            self.a = self.a | v
            self._set_nz(self.a)
            return extra

        if mnemonic == "RLA":
            assert addr is not None
            v = self._rmw(addr, "ROL")
            self.a = self.a & v
            self._set_nz(self.a)
            return extra

        if mnemonic == "SRE":
            assert addr is not None
            v = self._rmw(addr, "LSR")
            self.a = self.a ^ v
            self._set_nz(self.a)
            return extra

        if mnemonic == "RRA":
            assert addr is not None
            v = self._rmw(addr, "ROR")
            self._adc(v)
            return extra

        if mnemonic == "DCP":
            assert addr is not None
            v = self._rmw(addr, "DEC")
            t = (self.a - v) & 0x1FF
            self._set_flag(Status.C, self.a >= v)
            self._set_nz(t & 0xFF)
            return extra

        if mnemonic == "ISC":
            assert addr is not None
            v = self._rmw(addr, "INC")
            self._sbc(v)
            return extra

        if mnemonic == "ANC":
            v = opval()
            self.a = self.a & v
            self._set_nz(self.a)
            self._set_flag(Status.C, (self.a & 0x80) != 0)
            return extra

        if mnemonic == "ALR":
            v = opval()
            self.a = self.a & v
            self._set_flag(Status.C, (self.a & 0x01) != 0)
            self.a = (self.a >> 1) & 0xFF
            self._set_nz(self.a)
            return extra

        if mnemonic == "ARR":
            v = opval()
            self.a = self.a & v
            carry_in = 0x80 if (self.p & Status.C) else 0
            self.a = ((self.a >> 1) | carry_in) & 0xFF
            self._set_nz(self.a)
            self._set_flag(Status.C, (self.a & 0x40) != 0)
            self._set_flag(Status.V, ((self.a >> 6) ^ (self.a >> 5)) & 1)
            return extra

        if mnemonic == "AXS":
            v = opval()
            t = (self.a & self.x) - v
            self._set_flag(Status.C, t >= 0)
            self.x = t & 0xFF
            self._set_nz(self.x)
            return extra

        if mnemonic == "XAA":
            # Unstable on real silicon; we implement common approximation.
            v = opval()
            self.a = self.x & v
            self._set_nz(self.a)
            return extra

        if mnemonic == "LAS":
            assert addr is not None
            v = self.read(addr) & self.sp
            self.a = v
            self.x = v
            self.sp = v
            self._set_nz(v)
            return extra

        if mnemonic in {"AHX", "SHX", "SHY", "TAS"}:
            # These use “high byte + 1” masking.
            assert addr is not None
            high_plus_1 = ((addr >> 8) + 1) & 0xFF
            if mnemonic == "AHX":
                store(self.a & self.x & high_plus_1)
            elif mnemonic == "SHX":
                store(self.x & high_plus_1)
            elif mnemonic == "SHY":
                store(self.y & high_plus_1)
            elif mnemonic == "TAS":
                self.sp = self.a & self.x
                store(self.sp & high_plus_1)
            return extra

        # If we reach here, treat as NOP (safe fallback)
        return extra

    # -----------------
    # Trace
    # -----------------
    def _trace_instruction(
        self,
        cyc0: int,
        pc0: int,
        opcode: int,
        mnemonic_raw: str,
        mode: str,
        addr: Optional[int],
        imm: Optional[int],
        used: int,
    ) -> None:
        if not (self.trace or system_logger.verbosity >= 4):
            return

        ea = "----"
        if mode == "IMM" and imm is not None:
            ea = f"#${imm:02X}"
        elif addr is not None:
            ea = f"${addr:04X}"

        line = (
            f"CYC={cyc0:010d} PC=${pc0:04X} OP=${opcode:02X} "
            f"MN={mnemonic_raw:<4} AM={mode:<3} EA={ea:<6} "
            f"A=${self.a:02X} X=${self.x:02X} Y=${self.y:02X} "
            f"P=${self.p:02X} SP=${self.sp:02X} +{used}"
        )
        system_logger.log("CPU", line, "trace")

        if self.max_trace_instructions is not None:
            self.trace_count += 1
            if self.trace_count >= int(self.max_trace_instructions):
                self.trace = False

    def _trace_interrupt(self, cyc0: int, pc0: int, kind: str, used: int) -> None:
        if not (self.trace or system_logger.verbosity >= 4):
            return
        line = (
            f"CYC={cyc0:010d} PC=${pc0:04X} OP=-- MN={kind:<4} AM=--- EA=---- "
            f"A=${self.a:02X} X=${self.x:02X} Y=${self.y:02X} "
            f"P=${self.p:02X} SP=${self.sp:02X} +{used}"
        )
        system_logger.log("CPU", line, "trace")


# -------- Phase-3: Micro-FSM (cycle-exact) --------
class MicroOp:
    def __init__(self, fn, reads=False, writes=False):
        self.fn = fn
        self.reads = reads
        self.writes = writes

def _u_fetch(self):
    self.ir = self.mem.read(self.pc)
    self.pc = (self.pc + 1) & 0xFFFF

def _u_read(self, addr):
    self.tmp = self.mem.read(addr)

def _u_write(self, addr, val):
    self.mem.write(addr, val)

def build_microcode(self, opcode):
    # minimal but extensible microcode table
    # fetch -> exec -> writeback
    ops = [MicroOp(self._u_fetch)]
    handler = self.opcode_table.get(opcode)
    if handler:
        ops.append(MicroOp(lambda: handler()))
    return ops

def tick(self):
    # override with micro-FSM
    if not hasattr(self, "micro_ops") or not self.micro_ops:
        opcode = self.mem.read(self.pc)
        self.micro_ops = self.build_microcode(opcode)
    if self.micro_ops:
        uop = self.micro_ops.pop(0)
        uop.fn()


def apply_illegal_timing(self, opcode):
    # NMOS 6510 dummy reads / page penalties
    if opcode in self.illegal_opcodes:
        self.cycles += 1  # dummy read penalty
