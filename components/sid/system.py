"""Commodore 64 system emulation"""
import os
import zlib
import hashlib
from pathlib import Path
from typing import Optional, List, Tuple, Set
from .cpu6510_complete import Cpu6510
from .chip import SidChip
from .logger import system_logger


class Cia6526:
    """
    MOS 6526 CIA emulator (timers + ICR behavior).

    Phase 2 goals:
      - Correct timer A/B semantics (phi2, CNT, chained underflows for Timer B)
      - One-shot vs continuous behavior
      - ICR latch bits + mask-gated IRQ output
      - Read-to-clear semantics for ICR
      - Timer read latching (TALO latches TAHI, same for B)

    Notes:
      - We keep a CPU-cycle based stepping API: step(cpu_cycles, cnt_pulses=0, flag_edge=False)
      - TOD/alarm/latch are implemented; serial shift + PB6/PB7 underflow outputs are modeled.
      - FLAG edge latch is supported via step(..., flag_edge=True).
    """

    # ICR bits
    ICR_TA   = 0x01
    ICR_TB   = 0x02
    ICR_TOD  = 0x04
    ICR_SDR  = 0x08
    ICR_FLAG = 0x10

    def __init__(self, name: str):
        self.name = name

        # Clock configuration (set by C64System.init)
        # Used to derive TOD pulses from CPU cycles.
        self.clock_hz: int = 985248  # PAL default
        self._tod_50hz_mode: bool = True  # Separate storage for TOD frequency mode

        # Registers (0x00-0x0F)
        self.pra = 0      # 0x00 Port A
        self.prb = 0      # 0x01 Port B
        self.ddra = 0     # 0x02 DDR A
        self.ddrb = 0     # 0x03 DDR B
        self.ta_lo = 0    # 0x04 Timer A latch low
        self.ta_hi = 0    # 0x05 Timer A latch high
        self.tb_lo = 0    # 0x06 Timer B latch low
        self.tb_hi = 0    # 0x07 Timer B latch high
        self.tod10 = 0    # 0x08 TOD 1/10s (BCD)
        self.tod_sec = 0  # 0x09 TOD seconds (BCD)
        self.tod_min = 0  # 0x0A TOD minutes (BCD)
        self.tod_hr = 0   # 0x0B TOD hours (BCD, bit7=PM)
        self.sdr = 0      # 0x0C Serial data register
        self.icr = 0      # 0x0D Interrupt Control Register (latched events)
        self.cra = 0      # 0x0E Control A
        self.crb = 0      # 0x0F Control B

        # Internal timer counters + latches
        self.timer_a = 0xFFFF
        self.timer_b = 0xFFFF
        self.latch_a = 0xFFFF
        self.latch_b = 0xFFFF

        # ICR mask and IRQ line
        self.icr_mask = 0x00
        self.irq_pending = False

        # Timer read latches (reading low latches high)
        self._ta_hi_latch = 0
        self._tb_hi_latch = 0
        self._ta_latched = False
        self._tb_latched = False

        # External lines (minimal)
        self._flag_latched = False  # FLAG edge latch (ICR bit4)

        # --- TOD / Alarm / latch state (Phase 6) ---
        self._tod_alarm10 = 0
        self._tod_alarm_sec = 0
        self._tod_alarm_min = 0
        self._tod_alarm_hr = 0

        self._tod_latched = False
        self._tod_latch10 = 0
        self._tod_latch_sec = 0
        self._tod_latch_min = 0
        self._tod_latch_hr = 0

        # TOD write-strobe semantics: writing TOD10 stops clock until TODHR written.
        self._tod_stopped = False
        self._tod_write_in_progress = False

        # TOD pulse/divider accumulators
        self._tod_cycle_accum = 0  # cycles towards next TOD pulse
        self._tod_pulse_accum = 0  # pulses towards next 1/10s tick (5@50Hz, 6@60Hz)

        # --- Serial port + PB6/PB7 timer outputs (Phase 6 completeness) ---
        # Serial state (simplified but timing-aware)
        self._serial_shift_reg = 0x00
        self._serial_bits_left = 0          # bits remaining to shift out (output mode) or until complete (input mode)
        self._serial_cnt_phase = 0          # output mode: shift every 2 Timer A underflows (baud = TA underflow / 2)
        self._serial_in_count = 0           # input mode: bits received so far (0..8)
        self._sp_out = 1                    # SP output level (idle high)
        self._sp_in = 1                     # SP input level (idle high)
        self._cnt_in = 0                    # CNT input level (optional)

        # PB6/PB7 underflow output levels (for reading PRB and external wiring)
        self._pb6_out = 0
        self._pb7_out = 0
        self._pb6_pulse_rem = 0             # remaining phi2 cycles for PB6 pulse (pulse mode)
        self._pb7_pulse_rem = 0             # remaining phi2 cycles for PB7 pulse (pulse mode)

    def reset(self):
        self.pra = 0; self.prb = 0; self.ddra = 0; self.ddrb = 0
        self.ta_lo = 0; self.ta_hi = 0; self.tb_lo = 0; self.tb_hi = 0
        self.tod10 = 0; self.tod_sec = 0; self.tod_min = 0; self.tod_hr = 0
        self.sdr = 0
        self.icr = 0; self.icr_mask = 0
        self.cra = 0; self.crb = 0
        self.timer_a = 0xFFFF; self.timer_b = 0xFFFF
        self.latch_a = 0xFFFF; self.latch_b = 0xFFFF
        self.irq_pending = False
        self._ta_hi_latch = 0; self._tb_hi_latch = 0
        self._ta_latched = False; self._tb_latched = False
        self._flag_latched = False

        # Serial + PB outputs
        self._serial_shift_reg = 0x00
        self._serial_bits_left = 0
        self._serial_cnt_phase = 0
        self._serial_in_count = 0
        self._sp_out = 1
        self._sp_in = 1
        self._cnt_in = 0

        self._pb6_out = 0
        self._pb7_out = 0
        self._pb6_pulse_rem = 0
        self._pb7_pulse_rem = 0

        # TOD state
        self._tod_alarm10 = 0
        self._tod_alarm_sec = 0
        self._tod_alarm_min = 0
        self._tod_alarm_hr = 0
        self._tod_latched = False
        self._tod_latch10 = 0
        self._tod_latch_sec = 0
        self._tod_latch_min = 0
        self._tod_latch_hr = 0
        self._tod_stopped = False
        self._tod_write_in_progress = False
        self._tod_cycle_accum = 0
        self._tod_pulse_accum = 0
        system_logger.log(self.name, 'Reset complete', 'debug')

    # -----------------------
    # Debug helpers
    # -----------------------
    def get_state_dump(self) -> str:
        return (f"{self.name} TA=${self.timer_a:04X}(lat=${self.latch_a:04X}) "
                f"TB=${self.timer_b:04X}(lat=${self.latch_b:04X}) "
                f"CRA=${self.cra:02X} CRB=${self.crb:02X} "
                f"ICR=${self.icr:02X} MASK=${self.icr_mask:02X} "
                f"IRQ={'PENDING' if self.irq_pending else 'CLEAR'}")

    def log_state(self):
        system_logger.log(self.name, self.get_state_dump(), 'debug')

    # -----------------------
    # Core IRQ/ICR behavior
    # -----------------------
    def _set_icr_event(self, bit: int):
        """Latch an interrupt source bit; raise IRQ if unmasked."""
        self.icr |= (bit & 0x1F)
        if self.icr_mask & bit:
            self.irq_pending = True

    # -----------------------
    # TOD clock (Phase 6)
    # -----------------------
    @staticmethod
    def _bcd_inc_0_59(bcd: int) -> Tuple[int, bool]:
        """Increment BCD value in range 00..59. Returns (new, carry)."""
        lo = bcd & 0x0F
        hi = (bcd >> 4) & 0x0F
        lo += 1
        if lo >= 10:
            lo = 0
            hi += 1
        if hi * 10 + lo >= 60:
            return 0x00, True
        return ((hi << 4) | lo) & 0xFF, False

    @staticmethod
    def _bcd_inc_0_9(bcd: int) -> Tuple[int, bool]:
        lo = (bcd & 0x0F) + 1
        if lo >= 10:
            return 0x00, True
        return lo & 0x0F, False

    def _tod_is_50hz(self) -> bool:
        # CIA6526 CRA bit7 selects 50Hz TOD base when set, else 60Hz.
        return bool(self.cra & 0x80)

    def _tod_pulses_per_tenth(self) -> int:
        # C64 TOD input is 50Hz or 60Hz and CIA internally divides to 10Hz.
        return 5 if self._tod_is_50hz() else 6

    def _tick_tod_one_tenth(self):
        """Advance TOD by 1/10 second in BCD."""
        self.tod10, carry = self._bcd_inc_0_9(self.tod10)
        if not carry:
            return

        self.tod_sec, carry = self._bcd_inc_0_59(self.tod_sec)
        if not carry:
            return

        self.tod_min, carry = self._bcd_inc_0_59(self.tod_min)
        if not carry:
            return

        # Hours: 12-hour BCD with bit7=PM. Range 01..12.
        pm = self.tod_hr & 0x80
        hr = self.tod_hr & 0x7F
        # Normalize illegal 00 to 01
        if hr == 0x00:
            hr = 0x01

        # Convert BCD to int (1..12)
        hr_int = ((hr >> 4) & 0x0F) * 10 + (hr & 0x0F)
        if hr_int < 1 or hr_int > 12:
            hr_int = 1

        hr_int += 1
        if hr_int == 12:
            # Toggle PM when rolling to 12
            pm ^= 0x80
        if hr_int > 12:
            hr_int = 1

        self.tod_hr = pm | (((hr_int // 10) << 4) | (hr_int % 10))

    def _tod_alarm_match(self) -> bool:
        return (
            (self.tod10 & 0x0F) == (self._tod_alarm10 & 0x0F)
            and (self.tod_sec & 0xFF) == (self._tod_alarm_sec & 0xFF)
            and (self.tod_min & 0xFF) == (self._tod_alarm_min & 0xFF)
            and (self.tod_hr & 0xFF) == (self._tod_alarm_hr & 0xFF)
        )

    def _step_tod(self, cycles: int):
        """Derive TOD pulses from CPU cycles and update TOD/ICR."""
        if self._tod_stopped:
            return

        # Derive base TOD pulse rate from CRA bit7.
        tod_hz = 50 if self._tod_is_50hz() else 60
        if tod_hz <= 0:
            return

        # Convert cycles into TOD pulses using cycle accumulator.
        # cycles_per_pulse ~= clock_hz / tod_hz
        cycles_per_pulse = max(1, int(round(self.clock_hz / float(tod_hz))))
        self._tod_cycle_accum += int(cycles)
        while self._tod_cycle_accum >= cycles_per_pulse:
            self._tod_cycle_accum -= cycles_per_pulse
            self._tod_pulse_accum += 1
            if self._tod_pulse_accum >= self._tod_pulses_per_tenth():
                self._tod_pulse_accum = 0
                self._tick_tod_one_tenth()
                if self._tod_alarm_match():
                    self._set_icr_event(self.ICR_TOD)

    # -----------------------
    # Timer stepping
    # -----------------------
    def _timer_running_a(self) -> bool:
        return bool(self.cra & 0x01)

    def _timer_running_b(self) -> bool:
        return bool(self.crb & 0x01)

    def _timer_oneshot_a(self) -> bool:
        return bool(self.cra & 0x08)

    def _timer_oneshot_b(self) -> bool:
        return bool(self.crb & 0x08)

    def _timer_source_a(self) -> str:
        # CRA bit5: 0=phi2, 1=CNT
        return "cnt" if (self.cra & 0x20) else "phi2"

    def _timer_source_b(self) -> str:
        # CRB bits 5-6:
        #   00 = phi2
        #   01 = CNT
        #   10 = Timer A underflow
        #   11 = Timer A underflow while CNT high (treated as underflow gated by CNT pulses)
        mode = (self.crb >> 5) & 0x03
        if mode == 0:
            return "phi2"
        if mode == 1:
            return "cnt"
        if mode == 2:
            return "ta_underflow"
        return "ta_underflow_cnt"


    def _serial_output_mode(self) -> bool:
        # CRA bit6: 1 = serial output, 0 = serial input
        return bool(self.cra & 0x40)

    def set_sp_input(self, level: int):
        """Set SP input level for serial input mode (0/1)."""
        self._sp_in = 1 if (level & 1) else 0

    def set_cnt_input(self, level: int):
        """Set CNT input level (0/1). Used only if you wire external serial clocks."""
        self._cnt_in = 1 if (level & 1) else 0

    def get_sp_out(self) -> int:
        """Return current SP output level (0/1) in serial output mode."""
        return 1 if self._sp_out else 0

    def get_pb6(self) -> int:
        return 1 if self._pb6_out else 0

    def get_pb7(self) -> int:
        return 1 if self._pb7_out else 0

    def _tick_pb_pulses_one_cycle(self):
        # Decrement pulse timers, clearing outputs at expiry (pulse mode only).
        if self._pb6_pulse_rem > 0:
            self._pb6_pulse_rem -= 1
            if self._pb6_pulse_rem <= 0:
                self._pb6_pulse_rem = 0
                self._pb6_out = 0
        if self._pb7_pulse_rem > 0:
            self._pb7_pulse_rem -= 1
            if self._pb7_pulse_rem <= 0:
                self._pb7_pulse_rem = 0
                self._pb7_out = 0

    def _pb6_on_timer_a_underflow(self):
        # CRA bit1: PB6 underflow output enable
        if not (self.cra & 0x02):
            return
        # CRA bit2: 0=toggle, 1=pulse
        if self.cra & 0x04:
            self._pb6_out = 1
            self._pb6_pulse_rem = 1
        else:
            self._pb6_out ^= 1

    def _pb7_on_timer_b_underflow(self):
        # CRB bit1: PB7 underflow output enable
        if not (self.crb & 0x02):
            return
        # CRB bit2: 0=toggle, 1=pulse
        if self.crb & 0x04:
            self._pb7_out = 1
            self._pb7_pulse_rem = 1
        else:
            self._pb7_out ^= 1

    def _serial_on_timer_a_underflow(self):
        """Serial output shifts on Timer A underflow (baud = underflow/2)."""
        if not self._serial_output_mode():
            return

        # If idle, arm shifter from SDR.
        if self._serial_bits_left <= 0:
            self._serial_shift_reg = self.sdr & 0xFF
            self._serial_bits_left = 8
            self._serial_cnt_phase = 0

        # Every other underflow produces a shift (approx /2 baud generator).
        self._serial_cnt_phase ^= 1
        if self._serial_cnt_phase == 0:
            return

        out_bit = 1 if (self._serial_shift_reg & 0x80) else 0
        self._sp_out = out_bit
        self._serial_shift_reg = ((self._serial_shift_reg << 1) & 0xFF)
        self._serial_bits_left -= 1
        if self._serial_bits_left <= 0:
            self._serial_bits_left = 0
            self._set_icr_event(self.ICR_SDR)

    def _serial_on_cnt_pulse_input(self):
        """Serial input mode: shift in SP on CNT pulses; latch SDR + ICR when complete."""
        if self._serial_output_mode():
            return

        if self._serial_in_count == 0:
            self._serial_shift_reg = 0

        self._serial_shift_reg = ((self._serial_shift_reg << 1) | (1 if self._sp_in else 0)) & 0xFF
        self._serial_in_count += 1
        if self._serial_in_count >= 8:
            self._serial_in_count = 0
            self.sdr = self._serial_shift_reg & 0xFF
            self._set_icr_event(self.ICR_SDR)

    def _reload_timer_a(self):
        self.timer_a = self.latch_a if self.latch_a != 0 else 0x10000
        self.timer_a &= 0xFFFF

    def _reload_timer_b(self):
        self.timer_b = self.latch_b if self.latch_b != 0 else 0x10000
        self.timer_b &= 0xFFFF

    def _underflow_a(self) -> bool:
        """Handle Timer A underflow. Returns True if underflow occurred."""
        # PB6 underflow output + serial shift
        self._pb6_on_timer_a_underflow()
        self._serial_on_timer_a_underflow()
        self._set_icr_event(self.ICR_TA)
        self._reload_timer_a()
        if self._timer_oneshot_a():
            # Stop in one-shot mode after underflow
            self.cra &= ~0x01
        return True

    def _underflow_b(self) -> bool:
        # PB7 underflow output
        self._pb7_on_timer_b_underflow()
        self._set_icr_event(self.ICR_TB)
        self._reload_timer_b()
        if self._timer_oneshot_b():
            self.crb &= ~0x01
        return True


    def step(self, cycles: int, cnt_pulses: int = 0, flag_edge: bool = False) -> bool:
        """
        Advance CIA internal state by CPU cycles.

        Arguments:
          cycles: CPU phi2 cycles
          cnt_pulses: number of CNT rising edges during this step (usually 0 in our current system wiring)
          flag_edge: if True, latch FLAG interrupt source (ICR bit4)

        Returns:
          True if CIA is asserting IRQ after stepping.
        """
        cycles = int(cycles)
        if cycles <= 0:
            return bool(self.irq_pending)

        if flag_edge:
            self._flag_latched = True
            self._set_icr_event(self.ICR_FLAG)

        # TOD clock updates (Phase 6)
        self._step_tod(cycles)

        ta_underflows = 0

        # Per-phi2 cycle loop: needed for correct pulse/toggle timing on PB6/PB7 and serial output.
        for _ in range(cycles):
            # 1-cycle pulse decay (pulse mode)
            self._tick_pb_pulses_one_cycle()

            # Timer A (phi2 source)
            if self._timer_running_a() and self._timer_source_a() == "phi2":
                if self.timer_a == 0:
                    ta_underflows += 1
                    self._underflow_a()
                else:
                    self.timer_a = (self.timer_a - 1) & 0xFFFF

            # Timer B (phi2 source)
            if self._timer_running_b() and self._timer_source_b() == "phi2":
                if self.timer_b == 0:
                    self._underflow_b()
                else:
                    self.timer_b = (self.timer_b - 1) & 0xFFFF

        # CNT pulses affect timers and serial input mode (if wired).
        pulses = max(0, int(cnt_pulses))

        # Serial input mode: shift on CNT pulses.
        if pulses and not self._serial_output_mode():
            for _ in range(pulses):
                self._serial_on_cnt_pulse_input()

        # Timer A (CNT source)
        if pulses and self._timer_running_a() and self._timer_source_a() == "cnt":
            for _ in range(pulses):
                if not self._timer_running_a():
                    break
                if self.timer_a == 0:
                    ta_underflows += 1
                    self._underflow_a()
                else:
                    self.timer_a = (self.timer_a - 1) & 0xFFFF

        # Timer B (non-phi2 sources)
        if self._timer_running_b():
            src_b = self._timer_source_b()
            if src_b == "cnt" and pulses:
                for _ in range(pulses):
                    if not self._timer_running_b():
                        break
                    if self.timer_b == 0:
                        self._underflow_b()
                    else:
                        self.timer_b = (self.timer_b - 1) & 0xFFFF
            elif src_b == "ta_underflow":
                for _ in range(ta_underflows):
                    if not self._timer_running_b():
                        break
                    if self.timer_b == 0:
                        self._underflow_b()
                    else:
                        self.timer_b = (self.timer_b - 1) & 0xFFFF
            elif src_b == "ta_underflow_cnt":
                gated = min(ta_underflows, pulses)
                for _ in range(gated):
                    if not self._timer_running_b():
                        break
                    if self.timer_b == 0:
                        self._underflow_b()
                    else:
                        self.timer_b = (self.timer_b - 1) & 0xFFFF

        return bool(self.irq_pending)

    # -----------------------
    # Register interface
    # -----------------------
    def read(self, reg: int) -> int:
        reg &= 0x0F

        if reg == 0x00:
            return self.pra
        if reg == 0x01:
            v = self.prb & 0xFF
            # PB6/PB7 timer outputs override when enabled (CRA/CRB bit1)
            if self.cra & 0x02:
                v = (v & ~0x40) | (0x40 if self._pb6_out else 0x00)
            if self.crb & 0x02:
                v = (v & ~0x80) | (0x80 if self._pb7_out else 0x00)
            return v
        if reg == 0x02:
            return self.ddra
        if reg == 0x03:
            return self.ddrb

        # Timer A reads: low latches high
        if reg == 0x04:
            self._ta_hi_latch = (self.timer_a >> 8) & 0xFF
            self._ta_latched = True
            return self.timer_a & 0xFF
        if reg == 0x05:
            if self._ta_latched:
                self._ta_latched = False
                return self._ta_hi_latch
            return (self.timer_a >> 8) & 0xFF

        # Timer B reads: low latches high
        if reg == 0x06:
            self._tb_hi_latch = (self.timer_b >> 8) & 0xFF
            self._tb_latched = True
            return self.timer_b & 0xFF
        if reg == 0x07:
            if self._tb_latched:
                self._tb_latched = False
                return self._tb_hi_latch
            return (self.timer_b >> 8) & 0xFF

        # TOD reads: reading hours latches TOD; reading tenths releases latch.
        if reg in (0x08, 0x09, 0x0A, 0x0B):
            if reg == 0x0B and not self._tod_latched:
                # Latch current time snapshot
                self._tod_latch10 = self.tod10
                self._tod_latch_sec = self.tod_sec
                self._tod_latch_min = self.tod_min
                self._tod_latch_hr = self.tod_hr
                self._tod_latched = True

            if self._tod_latched:
                if reg == 0x08:
                    v = self._tod_latch10
                    self._tod_latched = False
                    return v
                if reg == 0x09:
                    return self._tod_latch_sec
                if reg == 0x0A:
                    return self._tod_latch_min
                return self._tod_latch_hr

            # Unlatched reads
            if reg == 0x08:
                return self.tod10
            if reg == 0x09:
                return self.tod_sec
            if reg == 0x0A:
                return self.tod_min
            return self.tod_hr
        if reg == 0x0C:
            return self.sdr

        if reg == 0x0D:
            # Read ICR:
            #   - bit7 reflects current IRQ line state (any unmasked latched source)
            #   - bits0-4 are the latched events
            #   - read clears event latch + IRQ
            val = self.icr & 0x1F
            if self.irq_pending:
                val |= 0x80
            self.icr = 0
            self.irq_pending = False
            self._flag_latched = False
            return val

        if reg == 0x0E:
            return self.cra
        if reg == 0x0F:
            return self.crb

        return 0

    def write(self, reg: int, val: int):
        reg &= 0x0F
        val &= 0xFF

        if reg == 0x00:
            self.pra = val
            return
        if reg == 0x01:
            self.prb = val
            return
        if reg == 0x02:
            self.ddra = val
            return
        if reg == 0x03:
            self.ddrb = val
            return

        # Timer A latch
        if reg == 0x04:
            self.latch_a = (self.latch_a & 0xFF00) | val
            self.ta_lo = val
            return
        if reg == 0x05:
            self.latch_a = (self.latch_a & 0x00FF) | (val << 8)
            self.ta_hi = val
            # If stopped, writing high loads counter from latch
            if not self._timer_running_a():
                self.timer_a = self.latch_a
            return

        # Timer B latch
        if reg == 0x06:
            self.latch_b = (self.latch_b & 0xFF00) | val
            self.tb_lo = val
            return
        if reg == 0x07:
            self.latch_b = (self.latch_b & 0x00FF) | (val << 8)
            self.tb_hi = val
            if not self._timer_running_b():
                self.timer_b = self.latch_b
            return

        # TOD / Alarm (Phase 6)
        # CRB bit7 selects writing to alarm registers when set.
        if reg in (0x08, 0x09, 0x0A, 0x0B):
            if self.crb & 0x80:
                # Alarm write
                if reg == 0x08:
                    self._tod_alarm10 = val & 0x0F
                elif reg == 0x09:
                    self._tod_alarm_sec = val
                elif reg == 0x0A:
                    self._tod_alarm_min = val
                else:
                    self._tod_alarm_hr = val
                return

            # Time write: writing TOD10 stops TOD until TODHR is written.
            if reg == 0x08:
                self.tod10 = val & 0x0F
                self._tod_stopped = True
                self._tod_write_in_progress = True
                self._tod_cycle_accum = 0
                self._tod_pulse_accum = 0
                return
            if reg == 0x09:
                self.tod_sec = val
                return
            if reg == 0x0A:
                self.tod_min = val
                return
            # reg == 0x0B
            self.tod_hr = val
            if self._tod_write_in_progress:
                self._tod_write_in_progress = False
                self._tod_stopped = False
            return
        if reg == 0x0C:
            self.sdr = val
            # In serial output mode, writing SDR arms the shifter if idle.
            if self._serial_output_mode() and self._serial_bits_left == 0:
                self._serial_shift_reg = self.sdr & 0xFF
                self._serial_bits_left = 8
                self._serial_cnt_phase = 0
            return

        # ICR mask control
        if reg == 0x0D:
            bits = val & 0x1F
            if val & 0x80:
                self.icr_mask |= bits
            else:
                self.icr_mask &= (~bits) & 0x1F
            # IRQ line is a function of (icr & icr_mask)
            if self.icr & self.icr_mask:
                self.irq_pending = True
            return

        # Control A
        if reg == 0x0E:
            prev = self.cra
            load = bool(val & 0x10)
            # Load bit is a strobe in real hardware (self-clearing)
            self.cra = val & (~0x10) & 0xFF
            if load:
                self._reload_timer_a()
            # If START is newly set and LOAD was requested, hardware behavior is complex;
            # our model reloads above and then counting proceeds on subsequent steps.
            if (prev ^ self.cra) & 0x01:
                system_logger.log(self.name, f"CRA start={'on' if (self.cra & 1) else 'off'}", 'trace')
            return

        # Control B
        if reg == 0x0F:
            prev = self.crb
            load = bool(val & 0x10)
            self.crb = val & (~0x10) & 0xFF
            if load:
                self._reload_timer_b()
            if (prev ^ self.crb) & 0x01:
                system_logger.log(self.name, f"CRB start={'on' if (self.crb & 1) else 'off'}", 'trace')
            return



class VicII:
    """VIC-II (Video Interface Chip) emulator (timing-focused, no graphics).

    Phase 3 upgrade: bus-aware contention model.

    Goals:
      - Keep raster IRQ behavior stable
      - Model *approximate* CPU bus contention (badlines + sprite DMA)
      - Provide per-line trace for later refinement against VICE traces

    Notes:
      - Phase 6 can optionally feed these stolen cycles back into the system's
        time-base (CPU stalls), improving RSID/demo timing.
      - Register coverage is enough to support badline + sprite DMA heuristics.
    """

    def __init__(self):
        # Core timing
        self.is_ntsc = False
        self.raster_line = 0
        self.raster_irq_line = 0
        self.irq_enabled = 0
        self.irq_status = 0
        self.cycles_per_line = 63  # PAL default
        self.lines_per_frame = 312  # PAL default
        self.cycle_counter = 0  # 0..cycles_per_line-1

        # VIC register shadow (0x00-0x3F)
        self.reg = [0] * 0x40

        # Per-line computed state
        self._line_badline = False
        self._line_sprites = 0
        self._line_badline_stolen = 0
        self._line_sprite_stolen = 0
        self._line_sprite_cycles = set()  # per-cycle sprite DMA slots for current line
        self._line_stolen = 0
        self._irq_fired_this_line = False

        # Statistics
        self.total_stolen = 0
        self.total_lines = 0

        # Trace controls
        self.trace_enabled = False
        self.trace_max_lines = None
        self._trace_lines_emitted = 0

    # ---------------- Trace ----------------
    def set_trace(self, enabled: bool, max_lines: Optional[int] = None):
        self.trace_enabled = bool(enabled)
        self.trace_max_lines = max_lines
        self._trace_lines_emitted = 0

    # ---------------- Reset/State ----------------
    def reset(self, is_ntsc: bool):
        self.is_ntsc = bool(is_ntsc)
        self.cycles_per_line = 65 if is_ntsc else 63
        self.lines_per_frame = 263 if is_ntsc else 312
        self.raster_line = 0
        self.cycle_counter = 0
        self.irq_status = 0
        self.irq_enabled = 0
        self.reg = [0] * 0x40

        self._line_badline = False
        self._line_sprites = 0
        self._line_badline_stolen = 0
        self._line_sprite_stolen = 0
        self._line_sprite_cycles = set()
        self._line_stolen = 0
        self._irq_fired_this_line = False

        self.total_stolen = 0
        self.total_lines = 0

        system_logger.log('VIC-II', f'Reset ({"NTSC" if is_ntsc else "PAL"})', 'info')

    def get_state_dump(self) -> str:
        return (
            f"VIC-II Raster={self.raster_line}/{self.lines_per_frame} "
            f"IRQLine={self.raster_irq_line} "
            f"Status=${self.irq_status:02X} "
            f"Enabled=${self.irq_enabled:02X} "
            f"Cycles={self.cycle_counter}/{self.cycles_per_line} "
            f"stolen_total={self.total_stolen}"
        )

    def log_state(self):
        system_logger.log('VIC-II', self.get_state_dump(), 'debug')

    # ---------------- Bus contention model ----------------
    def _visible_badline_range(self) -> Tuple[int, int]:
        # Pragmatic range used by many references: $30..$F7.
        start = 0x30
        end = min(0xF7, self.lines_per_frame - 1)
        return start, end

    def _is_badline(self, line: int) -> bool:
        d011 = self.reg[0x11]
        den = (d011 & 0x10) != 0
        yscroll = d011 & 0x07
        lo, hi = self._visible_badline_range()
        if not den:
            return False
        if line < lo or line > hi:
            return False
        return (line & 0x07) == yscroll

    def _sprite_active_mask(self, line: int) -> int:
        enable = self.reg[0x15]
        yexpand = self.reg[0x17]
        mask = 0
        for i in range(8):
            if not (enable & (1 << i)):
                continue
            y = self.reg[0x01 + 2 * i]  # sprite i Y at $D001, D003, ...
            height = 21 * (2 if (yexpand & (1 << i)) else 1)
            # Simplified: no wrapping, no vertical border rules
            if line >= y and line < (y + height):
                mask |= (1 << i)
        return mask


    def _sprite_dma_slot_table(self) -> dict:
        """Return per-sprite (cycle_idx0, cycle_idx1) DMA slots for this video standard.

        The provided reference (Linus Åkesson 'Nine') shows PAL slot scheduling:
          cycles 1-2: sprites 3..7 (two cycles each)
          cycles 58-63: sprites 0..2 (two cycles each)

        We keep a pragmatic NTSC mapping with the same structure but a 65-cycle line.
        """
        if self.is_ntsc:
            # NTSC: 65 cycles/line (0..64). Keep early slots; move late slots to end.
            return {
                3: (0, 1),
                4: (2, 3),
                5: (4, 5),
                6: (6, 7),
                7: (8, 9),
                0: (59, 60),
                1: (61, 62),
                2: (63, 64),
            }
        # PAL: 63 cycles/line (0..62).
        return {
            3: (0, 1),
            4: (2, 3),
            5: (4, 5),
            6: (6, 7),
            7: (8, 9),
            0: (57, 58),
            1: (59, 60),
            2: (61, 62),
        }

    def _sprite_dma_cycles_for_mask(self, sprite_mask: int) -> set:
        """Compute the set of cycle indices stolen by sprite DMA on the current line."""
        slots = self._sprite_dma_slot_table()
        stolen = set()
        m = int(sprite_mask) & 0xFF
        for spr, (c0, c1) in slots.items():
            if m & (1 << int(spr)):
                if 0 <= c0 < self.cycles_per_line:
                    stolen.add(c0)
                if 0 <= c1 < self.cycles_per_line:
                    stolen.add(c1)
        return stolen

    def _begin_line(self):
        # Compute line state once at start-of-line
        self._line_badline = self._is_badline(self.raster_line)
        self._line_sprites = self._sprite_active_mask(self.raster_line)

        # Pragmatic stolen-cycle budgets (refined later via trace comparison)
        self._line_badline_stolen = 40 if self._line_badline else 0
        self._line_sprite_cycles = self._sprite_dma_cycles_for_mask(self._line_sprites)
        self._line_sprite_stolen = int(len(self._line_sprite_cycles))

        self._line_stolen = 0
        self._irq_fired_this_line = False

        # Raster IRQ: fire once at start-of-line compare
        if (self.irq_enabled & 0x01) and (self.raster_line == self.raster_irq_line):
            self.irq_status |= 0x81  # raster + master
            self._irq_fired_this_line = True

    def _refresh_line_sprite_state(self) -> None:
        """Recompute current-line sprite activity and its stolen-cycle budget.

        This matters if sprite registers (enable/ypos/yexpand) change mid-line.
        We keep already-accounted stolen cycles; only future allocation changes.
        """
        self._line_sprites = self._sprite_active_mask(self.raster_line)
        self._line_sprite_cycles = self._sprite_dma_cycles_for_mask(self._line_sprites)
        self._line_sprite_stolen = int(len(self._line_sprite_cycles))

    def _refresh_line_badline_state(self) -> None:
        """Recompute current-line badline status and recalc budgets.

        Used when $D011 changes mid-line (DEN/yscroll) in tight timing code.
        """
        self._line_badline = self._is_badline(self.raster_line)
        self._line_badline_stolen = 40 if self._line_badline else 0
        self._refresh_line_sprite_state()


    def _is_stolen_cycle(self, cycle_idx: int) -> bool:
        """Return True if the current VIC cycle steals the CPU bus.

        Slot allocation model:
          - Badline steals a contiguous 40-cycle window mid-line (BA low).
          - Sprite DMA steals *specific* two-cycle slots per sprite (8 sprites max).

        This is still a pragmatic model (no full AEC/BA pipeline), but the
        per-sprite slot timing matches the common PAL mapping and is close for NTSC.
        """
        # Badline character fetch window (keep previous start-cycle to preserve prior tests).
        if self._line_badline_stolen:
            bad_start = 14 if self.is_ntsc else 15
            bad_end = bad_start + int(self._line_badline_stolen)
            if bad_start <= cycle_idx < bad_end:
                return True

        # Sprite DMA slots (two cycles per active sprite)
        if self._line_sprite_cycles and (cycle_idx in self._line_sprite_cycles):
            return True

        return False
    def preview_stolen(self, cycles: int) -> int:
        """Estimate stolen cycles over the next `cycles` VIC cycles without mutating state."""
        cycles = int(cycles)
        if cycles <= 0:
            return 0

        raster_line = self.raster_line
        cycle_counter = self.cycle_counter

        def compute_line_state(local_line: int):
            line_badline = self._is_badline(local_line)
            line_badline_stolen = 40 if line_badline else 0
            sprite_mask = self._sprite_active_mask(local_line)
            sprite_cycles = set()
            slots = self._sprite_dma_slot_table()
            m = int(sprite_mask) & 0xFF
            for spr, (c0, c1) in slots.items():
                if m & (1 << int(spr)):
                    if 0 <= c0 < self.cycles_per_line:
                        sprite_cycles.add(c0)
                    if 0 <= c1 < self.cycles_per_line:
                        sprite_cycles.add(c1)
            return line_badline_stolen, sprite_cycles

        line_badline_stolen, sprite_cycles = compute_line_state(raster_line)

        stolen = 0
        for _ in range(cycles):
            if cycle_counter == 0:
                line_badline_stolen, sprite_cycles = compute_line_state(raster_line)

            # Badline window first
            if line_badline_stolen:
                bad_start = 14 if self.is_ntsc else 15
                bad_end = bad_start + int(line_badline_stolen)
                if bad_start <= cycle_counter < bad_end:
                    stolen += 1
                    # advance 1 VIC cycle
                    cycle_counter += 1
                    if cycle_counter >= self.cycles_per_line:
                        cycle_counter = 0
                        raster_line += 1
                        if raster_line >= self.lines_per_frame:
                            raster_line = 0
                    continue

            # Sprite DMA slots
            if sprite_cycles and (cycle_counter in sprite_cycles):
                stolen += 1

            # advance 1 VIC cycle
            cycle_counter += 1
            if cycle_counter >= self.cycles_per_line:
                cycle_counter = 0
                raster_line += 1
                if raster_line >= self.lines_per_frame:
                    raster_line = 0

        return int(stolen)

    def step(self, cpu_cycles: int) -> Tuple[bool, int]:
        """Advance VIC by cpu_cycles.

        Returns:
          (irq, stolen)
            irq: True if raster IRQ asserted during this step
            stolen: number of cycles (within this step) considered VIC-stolen
        """
        irq = False
        stolen = 0

        for _ in range(int(cpu_cycles)):
            # Start-of-line computations
            if self.cycle_counter == 0:
                self._begin_line()
                if self._irq_fired_this_line:
                    irq = True
                    system_logger.log('VIC-II', f'Raster IRQ at line {self.raster_line}', 'debug')

            # Contention accounting
            if self._is_stolen_cycle(self.cycle_counter):
                stolen += 1
                self._line_stolen += 1

            # Advance timing
            self.cycle_counter += 1

            if self.cycle_counter >= self.cycles_per_line:
                # End of line
                self.total_lines += 1
                self.total_stolen += self._line_stolen

                if self.trace_enabled:
                    if self.trace_max_lines is None or self._trace_lines_emitted < int(self.trace_max_lines):
                        system_logger.log(
                            'VIC-II',
                            (
                                f"line={self.raster_line:03d} "
                                f"stolen={self._line_stolen:02d} "
                                f"badline={1 if self._line_badline else 0} "
                                f"sprites=0x{self._line_sprites:02X} "
                                f"irq={1 if self._irq_fired_this_line else 0}"
                            ),
                            'trace'
                        )
                        self._trace_lines_emitted += 1

                self.cycle_counter = 0
                self.raster_line += 1
                if self.raster_line >= self.lines_per_frame:
                    self.raster_line = 0

        return irq, stolen

    # ---------------- Register I/O ----------------
    def read(self, reg: int) -> int:
        reg &= 0x3F
        if reg == 0x11:
            # $D011: bit7 is raster bit8, bits0-6 are stored
            return (self.reg[0x11] & 0x7F) | (((self.raster_line & 0x100) >> 1) & 0x80)
        if reg == 0x12:
            return self.raster_line & 0xFF
        if reg == 0x19:
            # $D019 IRQ status: upper bits read as 1s in many docs; keep prior behavior
            return self.irq_status | 0x70
        if reg == 0x1A:
            return self.irq_enabled | 0xF0
        # Default: return shadow
        return self.reg[reg]

    def write(self, reg: int, val: int):
        reg &= 0x3F
        val &= 0xFF

        # Store shadow first
        self.reg[reg] = val

        # Handle mid-line register changes that affect contention state.
        # Our model computes line-state at cycle 0, but some code pokes VIC registers
        # mid-line in tight loops. We refresh budgets so subsequent cycles reflect it.
        if self.cycle_counter != 0:
            if reg == 0x11:
                self._refresh_line_badline_state()
            elif reg in (0x15, 0x17) or (reg <= 0x0F and (reg & 1) == 1):
                # sprite enable / yexpand / sprite Y positions ($D001,$D003,..,$D00F)
                self._refresh_line_sprite_state()


        if reg == 0x11:
            # Update raster compare high bit (bit7) and store D011 (DEN/yscroll)
            self.raster_irq_line = (self.raster_irq_line & 0xFF) | ((val & 0x80) << 1)
        elif reg == 0x12:
            self.raster_irq_line = (self.raster_irq_line & 0x100) | val
        elif reg == 0x19:
            # Acknowledge interrupts by writing 1s
            self.irq_status &= ~(val & 0x0F)
            if (self.irq_status & 0x0F) == 0:
                self.irq_status &= ~0x80
        elif reg == 0x1A:
            self.irq_enabled = val & 0x0F


class C64System:
    """Complete Commodore 64 system emulation"""
    
    def __init__(self):
        self.ram = bytearray(65536)
        self.color_ram = bytearray(0x400)  # $D800-$DBFF (4-bit)
        self.bus = Bus()
        self.trace = TraceRecorder()
        self.cpu = Cpu6510(self)
        self.sid_strict = False
        self.sid_model = "6581"
        self.sid = SidChip(985248, strict=self.sid_strict, model=self.sid_model)  # Clock set later
        self.cia1 = Cia6526('CIA1')
        self.cia2 = Cia6526('CIA2')
        self.vic = VicII()
        
        # PLA state ($01)
        # ROM images (optional; used for RSID/full system behavior)
        self.basic_rom: Optional[bytes] = None   # 8KB, mapped at $A000-$BFFF
        self.kernal_rom: Optional[bytes] = None  # 8KB, mapped at $E000-$FFFF
        self.chargen_rom: Optional[bytes] = None # 4KB, mapped at $D000-$DFFF when CHAREN=0 and ROM enabled
        self.rom_dir: Optional[str] = None
        self.ddr = 0x2F  # $00 Data Direction
        self.port = 0x37  # $01 Port

        # RSID / boot helpers
        self.rsid_mode: bool = False
        self._last_vic_stolen: int = 0

    def set_rom_dir(self, rom_dir: Optional[str]) -> None:
        """Set an explicit ROM directory (overrides env/default search order)."""
        self.rom_dir = rom_dir
    
    def init(
        self,
        is_ntsc: bool,
        clock_freq: int,
        *,
        sid_strict: bool = False,
        sid_model: str = "6581",
        rsid: bool = False,
    ):
        """Initialize C64 system"""
        self.ram = bytearray(65536)
        self.color_ram = bytearray(0x400)  # $D800-$DBFF (4-bit)
        self.rsid_mode = bool(rsid)
        self.sid_strict = bool(sid_strict)
        self.sid_model = str(sid_model or "6581")
        self.sid = SidChip(clock_freq, strict=self.sid_strict, model=self.sid_model)
        self.cia1.reset()
        self.cia2.reset()
        self.vic.reset(is_ntsc)

        # Clock wiring for CIA TOD derivation (Phase 6)
        self.cia1.clock_hz = int(clock_freq)
        self.cia2.clock_hz = int(clock_freq)

        # Default TOD base selection: PAL=50Hz, NTSC=60Hz.
        # CIA uses CRA bit7 to select 50Hz when set.
        if not is_ntsc:
            self.cia1.cra |= 0x80
            self.cia2.cra |= 0x80

        # Load ROMs (if available) for more complete C64/RSID behavior
        self._load_roms(self.rom_dir)
        
        # Default PLA
        # Typical C64 power-on values: DDR=$2F, PORT=$37 (BASIC+KERNAL+I/O visible)
        self.ddr = 0x2F
        self.port = 0x37

        # Default vectors / IRQ handler:
        # - In PSID mode, we install a stable dummy IRQ vector at $FF48.
        # - In RSID mode, we avoid forcing a PSID-style handler, but we still install
        #   safe RTI stubs for NMI/IRQ when ROMs are missing.
        if not self.rsid_mode:
            self._install_psid_vectors()
        else:
            self._install_rsid_safe_vectors()

        # CPU reset AFTER vectors/mapping are in place (so PC comes from reset vector)
        self.cpu.reset()
        
        system_logger.log('System', self._bank_state_dump(), 'debug')
        system_logger.log('System', self._rom_state_dump(), 'debug')

        system_logger.clear()
        system_logger.log('System', 'C64 Power On Sequence Complete', 'info')

    # ---------------------------
    # Boot helpers (Phase 5)
    # ---------------------------
    def _install_psid_vectors(self) -> None:
        """PSID-friendly default vectors + dummy IRQ at $FF48 (RTI)."""
        self.ram[0xFFFA] = 0x00; self.ram[0xFFFB] = 0xFE  # NMI -> $FE00
        self.ram[0xFFFC] = 0x00; self.ram[0xFFFD] = 0xE0  # RESET -> $E000
        self.ram[0xFFFE] = 0x48; self.ram[0xFFFF] = 0xFF  # IRQ -> $FF48

        # Dummy IRQ handler at $FF48 that acknowledges VIC then RTI.
        # PHA/TXA/PHA/TYA/PHA / ACK VIC / PLA/TAY/PLA/TAX/PLA/RTI
        dummy_irq = [
            0x48, 0x8A, 0x48, 0x98, 0x48,
            0xAD, 0x19, 0xD0, 0x8D, 0x19, 0xD0,
            0x68, 0xA8, 0x68, 0xAA, 0x68,
            0x40
        ]
        for i, b in enumerate(dummy_irq):
            self.ram[0xFF48 + i] = b

        # Minimal NMI stub at $FE00: RTI
        self.ram[0xFE00] = 0x40

    def _install_rsid_safe_vectors(self) -> None:
        """RSID-safe default vectors when ROMs are absent.

        If KERNAL ROM is present and mapped in, these live "under" ROM (writes still go to RAM).
        They mainly act as a fallback so RSID tunes can run without ROMs.
        """
        # Safe NMI/IRQ stubs
        self.ram[0xFE00] = 0x40  # RTI
        self.ram[0xFF00] = 0x40  # RTI

        # Default vectors point to safe stubs (RAM vectors are used if KERNAL is mapped out).
        self.ram[0xFFFA] = 0x00; self.ram[0xFFFB] = 0xFE  # NMI -> $FE00
        self.ram[0xFFFC] = 0x00; self.ram[0xFFFD] = 0x08  # RESET -> $0800 (bootstrap placeholder)
        self.ram[0xFFFE] = 0x00; self.ram[0xFFFF] = 0xFF  # IRQ -> $FF00 (safe RTI)

        # KERNAL RAM vectors (used by the real ROM IRQ handler).
        # For non-ROM RSID fallback, tunes can still install their handler here.
        # Default to RTI stub.
        self.ram[0x0314] = 0x00; self.ram[0x0315] = 0xFF

    def install_rsid_bootstrap(self, init_addr: int, *, song_num: int = 1, entry: int = 0x0800) -> int:
        """Install a tiny 'reset-like' bootstrap at $0800 and point RESET to it.

        The bootstrap sets up stack + $00/$01 banking, then calls init(s)
        and finally jumps to $FFFF (sentinel) so the host can detect completion.

        Returns the bootstrap entry address.
        """
        song = max(1, int(song_num)) - 1
        init_addr &= 0xFFFF
        entry &= 0xFFFF

        code = [
            0x78,             # SEI
            0xA2, 0xFF,       # LDX #$FF
            0x9A,             # TXS
            0xA9, 0x2F,       # LDA #$2F
            0x8D, 0x00, 0x00, # STA $0000
            0xA9, 0x37,       # LDA #$37
            0x8D, 0x01, 0x00, # STA $0001
            0xA9, song & 0xFF,# LDA #song
            0xA2, 0x00,       # LDX #$00
            0xA0, 0x00,       # LDY #$00
            0x20, init_addr & 0xFF, (init_addr >> 8) & 0xFF,  # JSR init
            0x4C, 0xFF, 0xFF, # JMP $FFFF (sentinel)
        ]

        for i, b in enumerate(code):
            self.ram[(entry + i) & 0xFFFF] = b & 0xFF

        # Ensure RESET vector comes from RAM by temporarily mapping out KERNAL during reset fetch.
        # We'll do that by setting PORT=$35 (HIRAM=0). The bootstrap immediately restores $37.
        self.ddr = 0x2F
        self.port = 0x35

        self.ram[0xFFFC] = entry & 0xFF
        self.ram[0xFFFD] = (entry >> 8) & 0xFF

        return entry
    
    # ---------------------------
    # ROM loading / bank mapping
    # ---------------------------
    def _find_rom_file(self, rom_dir: Path, names: List[str]) -> Optional[Path]:
        for name in names:
            p = rom_dir / name
            if p.exists() and p.is_file():
                return p
        return None

    def _read_rom(self, path: Path, expected_size: int) -> bytes:
        data = path.read_bytes()
        if len(data) != expected_size:
            system_logger.log('System', f'ROM size mismatch for {path.name}: {len(data)} bytes (expected {expected_size})', 'warn')
            if len(data) < expected_size:
                data = data + bytes([0xFF]) * (expected_size - len(data))
            else:
                data = data[:expected_size]
        return data

    def _rom_fingerprint(self, data: bytes) -> str:
        crc = zlib.crc32(data) & 0xFFFFFFFF
        sha1 = hashlib.sha1(data).hexdigest()[:12]
        return f'crc32={crc:08X} sha1={sha1}'

    def _load_roms(self, rom_dir: Optional[str] = None) -> None:
        candidates: List[Path] = []
        if rom_dir:
            candidates.append(Path(rom_dir))
        env_dir = os.environ.get("C64_ROM_DIR")
        if env_dir:
            candidates.append(Path(env_dir))

        here = Path(__file__).resolve().parent
        candidates.append(here / "roms")
        candidates.append(Path.cwd() / "roms")
        candidates.append(here.parent / "roms")

        chosen: Optional[Path] = None
        for c in candidates:
            try:
                if c.exists() and c.is_dir():
                    chosen = c
                    break
            except Exception:
                continue

        if chosen is None:
            self.basic_rom = None
            self.kernal_rom = None
            self.chargen_rom = None
            return

        self.rom_dir = str(chosen)

        basic_names = ["basic.rom", "basic.bin", "basic"]
        kernal_names = ["kernal.rom", "kernel.rom", "kernal.bin", "kernel.bin", "kernal"]
        chargen_names = ["chargen.rom", "char.rom", "characters.rom", "chargen.bin", "charrom.bin", "chargen"]

        basic_p = self._find_rom_file(chosen, basic_names)
        kernal_p = self._find_rom_file(chosen, kernal_names)
        chargen_p = self._find_rom_file(chosen, chargen_names)

        if basic_p:
            self.basic_rom = self._read_rom(basic_p, 8192)
            system_logger.log('System', f'Loaded BASIC ROM: {basic_p.name} ({self._rom_fingerprint(self.basic_rom)})', 'info')
        else:
            self.basic_rom = None
            system_logger.log('System', 'BASIC ROM not found (BASIC area will read as $FF when banked in)', 'debug')

        if kernal_p:
            self.kernal_rom = self._read_rom(kernal_p, 8192)
            system_logger.log('System', f'Loaded KERNAL ROM: {kernal_p.name} ({self._rom_fingerprint(self.kernal_rom)})', 'info')
        else:
            self.kernal_rom = None
            system_logger.log('System', 'KERNAL ROM not found (KERNAL area will read as $FF when banked in)', 'debug')

        if chargen_p:
            self.chargen_rom = self._read_rom(chargen_p, 4096)
            system_logger.log('System', f'Loaded CHARGEN ROM: {chargen_p.name} ({self._rom_fingerprint(self.chargen_rom)})', 'info')
        else:
            self.chargen_rom = None
            system_logger.log('System', 'CHARGEN ROM not found (Char ROM area will read as $FF when mapped)', 'debug')

    def _effective_port(self) -> int:
        return (self.port & self.ddr) | (0xFF & (~self.ddr & 0xFF))

    def _bank_state_dump(self) -> str:
        loram = 1 if (self.port & 0x01) else 0
        hiram = 1 if (self.port & 0x02) else 0
        charen = 1 if (self.port & 0x04) else 0
        return f'PLA: DDR=$%02X PORT=$%02X (eff=$%02X)  LORAM={loram} HIRAM={hiram} CHAREN={charen}' % (self.ddr, self.port, self._effective_port())

    def _rom_state_dump(self) -> str:
        parts = []
        parts.append(f'ROMDIR={self.rom_dir or "n/a"}')
        parts.append('BASIC=' + ('YES' if self.basic_rom else 'no'))
        parts.append('KERNAL=' + ('YES' if self.kernal_rom else 'no'))
        parts.append('CHARGEN=' + ('YES' if self.chargen_rom else 'no'))
        return 'ROMs: ' + ' '.join(parts)


    def dump_memory(self, start: int, length: int) -> str:
        """Dump memory region as hex"""
        lines = []
        for addr in range(start, start + length, 16):
            hex_bytes = " ".join(f"{self.ram[addr+i]:02X}" for i in range(min(16, start + length - addr)))
            ascii_chars = "".join(
                chr(self.ram[addr+i]) if 32 <= self.ram[addr+i] <= 126 else "."
                for i in range(min(16, start + length - addr))
            )
            lines.append(f"${addr:04X}: {hex_bytes:48s}  {ascii_chars}")
        return "\n".join(lines)
    
    def get_system_state_dump(self) -> str:
        """Get complete system state summary"""
        lines = [
            "=== C64 SYSTEM STATE ===",
            self.cpu.get_state_dump(),
            self.cia1.get_state_dump(),
            self.cia2.get_state_dump(),
            self.vic.get_state_dump(),
            ""
        ]
        
        # SID voices
        for i in range(3):
            lines.append(self.sid.get_voice_state_dump(i))
        
        lines.append("")
        
        # Important memory locations
        lines.append(f"Vectors: NMI=${self.ram[0xFFFA]:02X}{self.ram[0xFFFB]:02X} "
                    f"RESET=${self.ram[0xFFFC]:02X}{self.ram[0xFFFD]:02X} "
                    f"IRQ=${self.ram[0xFFFE]:02X}{self.ram[0xFFFF]:02X}")
        lines.append(f"PLA: DDR=${self.ddr:02X} Port=${self.port:02X}")
        
        return "\n".join(lines)
    
    def log_system_state(self, label: str = "System State"):
        """Log complete system state"""
        system_logger.log('System', f"\n{label}:\n{self.get_system_state_dump()}", 'debug')
    
    def log_memory_region(self, label: str, start: int, length: int):
        """Log a memory region"""
        system_logger.log('System', f"\n{label}:\n{self.dump_memory(start, length)}", 'debug')
    
    def step(self):
        """Execute one system step (one CPU instruction + peripherals).

        Phase 6: incorporate VIC bus contention as CPU stall cycles.
        """
        base_cycles = self.cpu.step()
        system_cycles = self._inflate_cpu_cycles_with_vic(base_cycles)
        self._tick_peripherals(system_cycles)

    def tick_cycles(self, cycles: int):
        """
        Advance the whole system by a given number of CPU cycles.

        Executes as many CPU instructions as needed to cover the
        requested cycle budget, stepping all peripherals in lockstep.
        """
        # In Phase 6 we interpret `cycles` as system PHI2 cycles (wall-clock).
        # The CPU may be stalled by VIC bus contention, meaning fewer instructions
        # execute within the same system-time budget.
        remaining = int(cycles)
        while remaining > 0:
            base_cycles = self.cpu.step()
            system_cycles = self._inflate_cpu_cycles_with_vic(base_cycles)
            self._tick_peripherals(system_cycles)
            remaining -= system_cycles

    def _inflate_cpu_cycles_with_vic(self, base_cpu_cycles: int) -> int:
        """Inflate instruction cycles by VIC contention.

        We approximate BA/AEC stalls by adding the number of VIC-stolen cycles
        that occur during the instruction's elapsed system-time. Because stalls
        extend elapsed time (and may overlap further stolen slots), we iterate to
        a fixed point.
        """
        base = max(0, int(base_cpu_cycles))
        if base == 0:
            return 0

        # Quick path: no contention configured
        if not hasattr(self.vic, "preview_stolen"):
            return base

        sys_len = base
        # 4 iterations is enough because the contention window within one raster line is bounded.
        for _ in range(4):
            stolen = int(self.vic.preview_stolen(sys_len))
            new_len = base + stolen
            if new_len == sys_len:
                break
            sys_len = new_len
        return int(sys_len)

    def _tick_peripherals(self, cpu_cycles: int):
        """
        Advance CIAs, VIC-II and SID by cpu_cycles, and update IRQ/NMI lines.
        """
        if cpu_cycles <= 0:
            return

        # Step CIA timers and VIC-II
        c1_irq = self.cia1.step(cpu_cycles)
        c2_irq = self.cia2.step(cpu_cycles)
        vic_irq, vic_stolen = self.vic.step(cpu_cycles)

        # Expose contention stats for debugging (Phase 3)
        self._last_vic_stolen = vic_stolen

        # Wire up interrupt lines
        if c1_irq or vic_irq:
            self.cpu.irq(True)
        else:
            self.cpu.irq(False)

        if c2_irq:
            self.cpu.nmi(True)
        else:
            self.cpu.nmi(False)

        # Update SID per-cycle ADSR engine from its register window
        self.sid.update(cpu_cycles, bytes(self.ram[0xD400:0xD419]))

    # Bus interface implementation
    # Bus interface implementation
    def read(self, addr: int) -> int:
        """Read from memory/IO"""
        addr &= 0xFFFF
        
        # Memory banking logic via PLA ($01)
        loram = self.port & 1
        hiram = self.port & 2
        charen = self.port & 4
        
        # BASIC ROM ($A000-$BFFF)
        if 0xA000 <= addr <= 0xBFFF:
            if hiram and loram:
                if getattr(self, 'basic_rom', None) is not None:
                    return self.basic_rom[addr - 0xA000]
                return 0xFF
            return self.ram[addr]
        
        # I/O Area vs Char ROM ($D000-$DFFF)
        if 0xD000 <= addr <= 0xDFFF:
            if hiram or loram:
                if charen:
                    # I/O Active
                    # VIC-II
                    if 0xD000 <= addr <= 0xD02E:
                        return self.vic.read(addr & 0x3F)
                    # SID ($D400-$D7FF) - shadow window
                    if 0xD400 <= addr <= 0xD7FF:
                        # SID is mirrored every 32 bytes.
                        reg = (addr - 0xD400) & 0x1F
                        # Readback regs (POT/OSC3/ENV3)
                        if reg in (0x19, 0x1A, 0x1B, 0x1C):
                            return self.sid.read_reg(reg)
                        return self.ram[0xD400 + reg]

                    # Color RAM ($D800-$DBFF) - 4-bit
                    if 0xD800 <= addr <= 0xDBFF:
                        return (self.color_ram[addr - 0xD800] & 0x0F) | 0xF0
                    # CIA 1
                    if 0xDC00 <= addr <= 0xDCFF:
                        return self.cia1.read(addr)
                    # CIA 2
                    if 0xDD00 <= addr <= 0xDDFF:
                        return self.cia2.read(addr)
                    return 0xFF  # Unmapped I/O
                else:
                    # Char ROM active (mapped into $D000-$DFFF)
                    if getattr(self, 'chargen_rom', None) is not None:
                        return self.chargen_rom[addr - 0xD000]
                    return 0xFF
            return self.ram[addr]
        
        # KERNAL ROM ($E000-$FFFF)
        if 0xE000 <= addr <= 0xFFFF:
            if hiram:
                if getattr(self, 'kernal_rom', None) is not None:
                    return self.kernal_rom[addr - 0xE000]
                return 0xFF
            return self.ram[addr]
        
        # Zero page ports
        if addr == 0x00:
            return self.ddr
        if addr == 0x01:
            return self._effective_port()
        
        return self.ram[addr]
    
    def write(self, addr: int, val: int):
        """Write to memory/IO"""
        addr &= 0xFFFF
        val &= 0xFF
        
        loram = self.port & 1
        hiram = self.port & 2
        charen = self.port & 4
        
        # I/O Area writing
        if 0xD000 <= addr <= 0xDFFF:
            if (hiram or loram) and charen:
                # I/O Mapped
                if 0xD000 <= addr <= 0xD02E:
                    self.vic.write(addr & 0x3F, val)
                    return
                if 0xD400 <= addr <= 0xD7FF:
                    # SID write registers are mirrored every 32 bytes.
                    reg = (addr - 0xD400) & 0x1F
                    self.ram[0xD400 + reg] = val
                    return
                if 0xDC00 <= addr <= 0xDCFF:
                    self.cia1.write(addr, val)
                    return
                if 0xDD00 <= addr <= 0xDDFF:
                    self.cia2.write(addr, val)
                    return
            # If not I/O, fall through to RAM write
        
        # Zero page
        if addr == 0x00:
            self.ddr = val
            return
        if addr == 0x01:
            old_port = self.port
            self.port = (self.port & ~self.ddr) | (val & self.ddr)
            return
        
        self.ram[addr] = val
