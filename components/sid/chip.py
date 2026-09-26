"""SID (6581/8580) chip emulator.

This project started as a pragmatic SID register dumper, but for a closer-to-C64
environment we also need the SID to be *trustworthy* as a chip model.

Phase 4 introduces an optional **strict SID** mode:
  * 24-bit integer phase accumulator (like the real oscillator)
  * 23-bit noise LFSR with oscillator-driven clocking (approx.)
  * integer envelope (0..255) with per-rate periods
  * approximate combined waveform behaviour (DAC-style AND mixing)
  * OSC3 / ENV3 readback registers

It is still a pragmatic model (not a full reSID clone), but it is structured so
the filter and waveform tables can be replaced later without tearing up the API.
"""
import math
from typing import Callable, List, Tuple, Optional
from .sidtypes import SidVoiceStatus, SidFilterStatus
from .logger import system_logger


# ADSR rate tables (ms) - Precise MOS 6581 values
# Attack: Time to go from 0x00 to 0xFF
ATTACK_TIMES = [2, 8, 16, 24, 38, 56, 68, 80, 100, 240, 500, 800, 1000, 3000, 5000, 8000]

# Decay/Release: Time to go from 0xFF to 0x00 (Exponential 3*tau)
DECAY_TIMES = [6, 24, 48, 72, 114, 168, 204, 240, 300, 750, 1500, 2400, 3000, 9000, 15000, 24000]

# Simulation granularity
# 32 steps per frame @ 50Hz = 1600Hz update rate (~0.625ms resolution)
STEPS_PER_FRAME = 32


class VoiceInternal:
    """Internal state for a single SID voice"""
    def __init__(self):
        self.freq_lo = 0
        self.freq_hi = 0
        self.freq = 0
        self.pulse_lo = 0
        self.pulse_hi = 0
        self.pulse = 0
        self.control = 0
        self.attack = 0
        self.decay = 0
        self.sustain = 0
        self.release = 0
        self.gate = False
        self.test = False
        self.ring_mod = False
        self.sync = False
        self.waveform = 0  # 4-bit (Tri, Saw, Pulse, Noise)
        self.raw_waveform = 0  # 8-bit full control reg
        self.env_state = 'release'  # attack, decay, sustain, release
        # --- Legacy envelope (float, 0..1) ---
        self.env_level = 0.0
        # --- Strict envelope (int, 0..255) ---
        self.env_level_i = 0
        self.env_counter = 0

        # --- Legacy oscillator (float phase 0..1) ---
        self.phase = 0.0
        # --- Strict oscillator (24-bit accumulator) ---
        self.accum = 0
        self._prev_accum = 0

        # Noise LFSR for noise waveform
        self.noise_lfsr = 0x7FFFFF  # 23-bit LFSR for noise waveform
        
        # ADSR bug tracking (6581-specific)
        self._adsr_bug_release_rate = 0
        self._adsr_delay_counter = 0
        
        # Waveform state
        self._prev_test = False
        self._test_rising_edge = False


class SidChip:
    """MOS 6581 SID chip emulator"""
    
    def __init__(self, clock_hz: int, *, strict: bool = False, model: str = "6581"):
        self.clock_hz = clock_hz
        self.strict = bool(strict)
        self.model = str(model or "6581")
        self.voices: List[VoiceInternal] = [VoiceInternal() for _ in range(3)]

        # Filter register-level state
        self.filter_cutoff = 0
        self.filter_res = 0
        self.filter_mode_lp = False
        self.filter_mode_bp = False
        self.filter_mode_hp = False
        self.filter_vol = 0
        self.filter_routing = 0  # Bits 0-3 (V1, V2, V3, Ext)

        # POTX/POTY (paddles) readback (defaults to 'no paddles connected' = 0xFF)
        self.potx = 0xFF
        self.poty = 0xFF

        # $D418 bit7: Voice 3 off (audio muted, but OSC3/ENV3 still readable)
        self.voice3_off = False

        # D418 volume 'digi' / DAC approximation state
        self._d418_last_vol = 0
        self._d418_dac = 0.0
        self._d418_dc = 0.0

        # Strict-mode combined-waveform shaping LUT (4096 entries)
        # This is a pragmatic approximation of the SID's non-linear DAC mixing.
        self._comb_lut = self._build_combined_wave_lut(self.model)


        # Precomputed per-cycle ADSR parameters (legacy mode)
        self._attack_step = [0.0] * 16      # linear increment per SID clock
        self._decay_factor = [1.0] * 16     # multiplicative factor per SID clock
        self._recalculate_adsr_tables()

        # 6581 vs 8580 filter curves (different DAC characteristics)
        self._is_6581 = '6581' in self.model.upper()
        
        # Strict-mode per-step periods in SID clocks
        # (period = SID cycles per envelope step)
        self._attack_period = [1] * 16
        self._decay_period = [1] * 16
        self._release_period = [1] * 16
        self._recalculate_strict_env_periods()

        # Readback registers
        self._osc3_12 = 0  # 12-bit
        self._env3_8 = 0   # 8-bit

        # Optional external filter model hook
        # fn(sample: float, sid: SidChip) -> float
        self._filter_model: Optional[Callable[[float, "SidChip"], float]] = None

        # Simple state-variable filter (SVF) state for render_samples()
        self._svf_lp = 0.0
        self._svf_bp = 0.0
        self._svf_hp = 0.0
        self._svf_g = 0.0
        self._svf_R = 1.0
        self._svf_sample_rate = 44100.0
        self._filter_dc_block = 0.0  # DC blocker state

    def _recalculate_adsr_tables(self):
        """Precompute per-cycle ADSR coefficients based on ATTACK_TIMES/DECAY_TIMES."""
        for i in range(16):
            # Attack: linear 0.0->1.0 over ATTACK_TIMES[i] ms
            attack_ms = ATTACK_TIMES[i]
            if attack_ms <= 0:
                self._attack_step[i] = 1.0
            else:
                attack_cycles = (attack_ms / 1000.0) * float(self.clock_hz)
                if attack_cycles <= 1.0:
                    self._attack_step[i] = 1.0
                else:
                    self._attack_step[i] = 1.0 / attack_cycles

            # Decay/Release: exponential, 3*tau = DECAY_TIMES[i]
            decay_ms = DECAY_TIMES[i]
            if decay_ms <= 0:
                self._decay_factor[i] = 0.0
            else:
                tau = (decay_ms / 1000.0) / 3.0
                if tau <= 0:
                    self._decay_factor[i] = 0.0
                else:
                    dt = 1.0 / float(self.clock_hz)
                    self._decay_factor[i] = math.exp(-dt / tau)

    def _recalculate_strict_env_periods(self):
        """Compute simple per-step envelope periods from the published timing tables.

        This is *not* a full exponential envelope counter model (reSID-style), but
        it is deterministic and keeps overall timings closer than the original
        float-only approximation.
        """
        for i in range(16):
            # Attack: 0..255 in ATTACK_TIMES[i] ms
            a_ms = float(ATTACK_TIMES[i])
            a_cycles = max(1.0, (a_ms / 1000.0) * float(self.clock_hz))
            self._attack_period[i] = max(1, int(a_cycles / 255.0))

            # Decay/Release: 255..0 over DECAY_TIMES[i] ms (approx linear steps)
            d_ms = float(DECAY_TIMES[i])
            d_cycles = max(1.0, (d_ms / 1000.0) * float(self.clock_hz))
            per = max(1, int(d_cycles / 255.0))
            self._decay_period[i] = per
            self._release_period[i] = per

    def set_filter_model(self, fn: Optional[Callable[[float, "SidChip"], float]]):
        """Install a custom filter model.

        If set, render_samples() will route the mixed signal through fn().
        """
        self._filter_model = fn

    def set_pots(self, potx: Optional[int] = None, poty: Optional[int] = None) -> None:
        """Set paddle POTX/POTY values (0..255).

        Real C64 paddles charge/discharge RC networks and are sampled by the SID.
        For playback correctness, most software just expects stable readback values.
        Default is 0xFF (no paddles).
        """
        if potx is not None:
            self.potx = int(potx) & 0xFF
        if poty is not None:
            self.poty = int(poty) & 0xFF

    @staticmethod
    def _build_combined_wave_lut(model: str) -> List[int]:
        """Build a 12-bit -> 12-bit shaping LUT for combined waveforms.

        Combined waveforms on real SIDs are not a pure bitwise-AND; the analog
        mixing and DAC non-linearities create a characteristic curvature.

        This LUT is a pragmatic approximation that is *stable* and improves
        realism without pulling in a full reSID implementation.
        """
        m = (model or '6581').strip().upper()
        # 6581 tends to be more non-linear; 8580 closer to linear.
        gamma = 0.72 if '6581' in m else 0.88
        lut = [0] * 4096
        for x in range(4096):
            n = x / 4095.0
            y = int(round((n ** gamma) * 4095.0))
            lut[x] = max(0, min(4095, y))
        return lut

    def _step_cycle(self, advance_oscillator: bool):
        """
        Advance all voices by a single SID clock cycle.
        Per-cycle ADSR + optional oscillator stepping.
        """
        if self.strict:
            self._step_cycle_strict(advance_oscillator)
            return

        for v in self.voices:
            # Test bit: reset and hold
            if v.test:
                v.env_level = 0.0
                v.env_state = 'attack'
                if advance_oscillator:
                    v.phase = 0.0
                    v.noise_lfsr = 0x7FFFFF
                continue

            # Envelope state machine
            if v.env_state == 'attack':
                step = self._attack_step[v.attack]
                v.env_level += step
                if v.env_level >= 1.0:
                    v.env_level = 1.0
                    v.env_state = 'decay'

            elif v.env_state == 'decay':
                sustain_level = (v.sustain & 0x0F) / 15.0
                factor = self._decay_factor[v.decay]
                v.env_level = sustain_level + (v.env_level - sustain_level) * factor
                if abs(v.env_level - sustain_level) < 1e-4:
                    v.env_level = sustain_level
                    v.env_state = 'sustain'

            elif v.env_state == 'sustain':
                # Hold sustain while gate is on; gate off switches to 'release'
                pass

            elif v.env_state == 'release':
                factor = self._decay_factor[v.release]
                v.env_level *= factor
                if v.env_level < 0.0005:
                    v.env_level = 0.0
                    v.env_state = 'release'

            # Oscillator step (simple normalized phase accumulator)
            if advance_oscillator and not v.test:
                delta = v.freq / 16777216.0  # 24-bit accumulator
                v.phase += delta
                if v.phase >= 1.0:
                    v.phase -= int(v.phase)

                # Noise LFSR when noise waveform active
                if v.waveform & 0x08:
                    fb = ((v.noise_lfsr >> 22) ^ (v.noise_lfsr >> 17)) & 0x01
                    v.noise_lfsr = ((v.noise_lfsr << 1) | fb) & 0x7FFFFF

    # -----------------
    # Strict-mode model
    # -----------------
    def _strict_clock_noise(self, v: VoiceInternal, new_accum: int) -> None:
        """Clock the 23-bit noise LFSR on an oscillator-derived edge.

        The real SID clocks the noise shift register based on internal oscillator
        bits; a common approximation is to clock when accumulator bit 19 rises.
        """
        prev = v._prev_accum
        # Rising edge of bit 19 (0x080000)
        if ((prev ^ new_accum) & 0x080000) and (new_accum & 0x080000):
            fb = ((v.noise_lfsr >> 22) ^ (v.noise_lfsr >> 17)) & 0x01
            v.noise_lfsr = ((v.noise_lfsr << 1) | fb) & 0x7FFFFF

    def _step_cycle_strict(self, advance_oscillator: bool) -> None:
        """Advance all voices by one SID clock cycle (strict mode)."""

        # --- Envelope first (independent of oscillator) ---
        for v in self.voices:
            if v.test:
                v.env_level_i = 0
                v.env_state = 'attack'
                v.env_counter = 0
                if advance_oscillator:
                    v.accum = 0
                    v._prev_accum = 0
                    v.noise_lfsr = 0x7FFFFF
                continue

            # Gate transitions are handled in update() when control is written.
            if v.env_state == 'sustain':
                # Hold until gate drops.
                pass
            else:
                if v.env_counter > 0:
                    v.env_counter -= 1
                if v.env_counter == 0:
                    if v.env_state == 'attack':
                        if v.env_level_i < 255:
                            v.env_level_i += 1
                        if v.env_level_i >= 255:
                            v.env_level_i = 255
                            v.env_state = 'decay'
                        v.env_counter = self._attack_period[v.attack]

                    elif v.env_state == 'decay':
                        target = (v.sustain & 0x0F) * 17  # 0..255
                        if v.env_level_i > target:
                            v.env_level_i -= 1
                        if v.env_level_i <= target:
                            v.env_level_i = target
                            v.env_state = 'sustain'
                        v.env_counter = self._decay_period[v.decay]

                    elif v.env_state == 'release':
                        if v.env_level_i > 0:
                            v.env_level_i -= 1
                        if v.env_level_i <= 0:
                            v.env_level_i = 0
                            v.env_state = 'release'
                        v.env_counter = self._release_period[v.release]

        # --- Oscillators ---
        if not advance_oscillator:
            # Still update ENV3 readback.
            self._env3_8 = self.voices[2].env_level_i & 0xFF
            return

        # Capture previous voice MSBs for sync/ring behaviour.
        prev_msbs = [1 if (v.accum & 0x800000) else 0 for v in self.voices]

        for idx, v in enumerate(self.voices):
            v._prev_accum = v.accum
            v.accum = (v.accum + (v.freq & 0xFFFF)) & 0xFFFFFF

            # Sync: reset this oscillator on rising edge of previous voice MSB
            if v.sync and idx > 0:
                pm_old = 1 if (self.voices[idx - 1]._prev_accum & 0x800000) else 0
                pm_new = 1 if (self.voices[idx - 1].accum & 0x800000) else 0
                if pm_old == 0 and pm_new == 1:
                    v.accum = 0

            # Noise clocking
            if v.waveform & 0x08:
                self._strict_clock_noise(v, v.accum)

        # Update readback from voice 3
        self._env3_8 = self.voices[2].env_level_i & 0xFF
        self._osc3_12 = self._strict_waveform_12(self.voices[2], voice_index=2)

    def _strict_waveform_12(self, v: VoiceInternal, *, voice_index: int) -> int:
        """Return a 12-bit waveform sample for a voice (strict mode)."""

        wf = v.waveform & 0x0F
        if wf == 0:
            return 0

        # If noise is selected along with other waveforms, many real chips behave
        # oddly; we choose to prioritise noise if present.
        if wf & 0x08:
            noise8 = (
                ((v.noise_lfsr >> 22) & 1) << 7 |
                ((v.noise_lfsr >> 20) & 1) << 6 |
                ((v.noise_lfsr >> 16) & 1) << 5 |
                ((v.noise_lfsr >> 13) & 1) << 4 |
                ((v.noise_lfsr >> 11) & 1) << 3 |
                ((v.noise_lfsr >> 7) & 1) << 2 |
                ((v.noise_lfsr >> 4) & 1) << 1 |
                ((v.noise_lfsr >> 2) & 1)
            )
            # Expand to 12-bit DAC-ish
            return ((noise8 << 4) | (noise8 >> 4)) & 0xFFF

        # 12-bit phase
        pha12 = (v.accum >> 12) & 0x0FFF
        msb = 1 if (v.accum & 0x800000) else 0

        # Ring mod affects triangle polarity using previous voice MSB
        if v.ring_mod and voice_index > 0:
            mod_msb = 1 if (self.voices[voice_index - 1].accum & 0x800000) else 0
            msb ^= mod_msb

        tri = saw = pul = None

        if wf & 0x01:  # TRI
            t = pha12
            if msb:
                t ^= 0x0FFF
            tri = t

        if wf & 0x02:  # SAW
            saw = pha12

        if wf & 0x04:  # PULSE
            pw = v.pulse & 0x0FFF
            pul = 0x0FFF if pha12 < pw else 0x000

        # Combined waveforms: real chips exhibit non-linear DAC/mixer effects.
        # We approximate by AND-mixing then shaping through a LUT.
        def shape(x: int) -> int:
            return self._comb_lut[x & 0x0FFF] if self._comb_lut else (x & 0x0FFF)

        if tri is not None and saw is not None and pul is not None:
            return shape(tri & saw & pul)
        if tri is not None and saw is not None:
            return shape(tri & saw)
        if tri is not None and pul is not None:
            return shape(tri & pul)
        if saw is not None and pul is not None:
            return shape(saw & pul)
        if tri is not None:
            return tri
        if saw is not None:
            return saw
        if pul is not None:
            return pul
        return 0

    def _voice_output(self, v: "VoiceInternal") -> float:
        """
        Compute raw output for a single voice, combining active waveforms
        and applying the current envelope level.
        """
        if self.strict:
            # Strict: 12-bit waveform -> [-1,1] * envelope
            if v.env_level_i <= 0 or (v.waveform & 0x0F) == 0:
                return 0.0
            idx = self.voices.index(v)
            w12 = self._strict_waveform_12(v, voice_index=idx)
            base = (float(w12) / 2047.5) - 1.0
            env = float(v.env_level_i) / 255.0
            return base * env

        if v.env_level <= 0.0 or v.waveform == 0:
            return 0.0

        tri = saw = pul = noi = 0.0
        active = 0

        # Triangle (bit 0)
        if v.waveform & 0x01:
            tri = 2.0 * abs(2.0 * (v.phase - math.floor(v.phase + 0.5)))
            tri = tri - 1.0
            active += 1

        # Sawtooth (bit 1)
        if v.waveform & 0x02:
            saw = (2.0 * (v.phase % 1.0)) - 1.0
            active += 1

        # Pulse (bit 2)
        if v.waveform & 0x04:
            pw = v.pulse & 0x0FFF
            duty = pw / 4096.0 if pw > 0 else 0.5
            pul = 1.0 if (v.phase % 1.0) < duty else -1.0
            active += 1

        # Noise (bit 3)
        if v.waveform & 0x08:
            noi = ((v.noise_lfsr & 0xFF) / 128.0) - 1.0
            active += 1

        base = 0.0 if active == 0 else (tri + saw + pul + noi) / float(active)
        return base * v.env_level

    def _configure_filter(self, sample_rate: float):
        """
        Configure internal state-variable filter coefficients from current
        cutoff/resonance registers and target sample rate.
        """
        self._svf_sample_rate = float(sample_rate)

        # Map 11-bit cutoff (0..2047) to Hz.
        # Real 6581 vs 8580 differ significantly; this is a pragmatic,
        # model-shaped curve that improves realism without being a full reSID.
        norm = max(0.0, min(1.0, (min(self.filter_cutoff, 2047) / 2047.0)))
        nyq = sample_rate / 2.0

        if '8580' in self.model.upper():
            # 8580: higher top-end, more linear feel
            shaped = norm ** 1.15
            fc = 25.0 + shaped * (nyq - 800.0 - 25.0)
        else:
            # 6581: more non-linear, earlier knee
            shaped = norm ** 1.65
            fc = 30.0 + shaped * (nyq - 1200.0 - 30.0)

        if fc < 20.0:
            fc = 20.0
        if fc >= nyq:
            fc = nyq - 1.0

        # Resonance nibble 0..15 -> damping
        res_norm = self.filter_res / 15.0 if self.filter_res > 0 else 0.0
        self._svf_R = 0.5 + 1.5 * (1.0 - res_norm)

        # TPT SVF g-coefficient
        self._svf_g = math.tan(math.pi * fc / self._svf_sample_rate)

    def _svf_process(self, input_sample: float) -> float:
        """
        State-Variable Filter producing LP/BP/HP outputs based on mode bits.
        """
        if not (self.filter_mode_lp or self.filter_mode_bp or self.filter_mode_hp):
            return input_sample

        g = self._svf_g
        R = self._svf_R

        hp = input_sample - self._svf_lp - R * self._svf_bp
        bp = self._svf_bp + g * hp
        lp = self._svf_lp + g * bp

        self._svf_lp = lp
        self._svf_bp = bp
        self._svf_hp = hp

        out = 0.0
        if self.filter_mode_lp:
            out += lp
        if self.filter_mode_bp:
            out += bp
        if self.filter_mode_hp:
            out += hp

        return out

    def read_reg(self, reg: int) -> int:
        """Read SID register (used for OSC3/ENV3/POT readback)."""
        r = reg & 0x1F
        # POTX/POTY readback ($D419/$D41A)
        if r == 0x19:
            return int(self.potx) & 0xFF
        if r == 0x1A:
            return int(self.poty) & 0xFF
        # OSC3
        if r == 0x1B:
            if self.strict:
                return (self._osc3_12 >> 4) & 0xFF
            # Legacy: derive from voice 3 phase
            v = self.voices[2]
            return int(((v.phase % 1.0) * 255.0)) & 0xFF
        # ENV3
        if r == 0x1C:
            if self.strict:
                return self._env3_8 & 0xFF
            return int(max(0.0, min(1.0, self.voices[2].env_level)) * 255.0) & 0xFF
        return 0xFF

    def render_samples(self, num_samples: int, sample_rate: int) -> List[float]:
        """
        Render PCM audio samples using the internal per-cycle oscillator/ADSR engine.
        """
        if num_samples <= 0 or sample_rate <= 0:
            return []

        self._configure_filter(float(sample_rate))

        cycles_per_sample_exact = float(self.clock_hz) / float(sample_rate)
        error = 0.0
        output: List[float] = []

        for _ in range(num_samples):
            cycles_this_sample = int(cycles_per_sample_exact + error)
            if cycles_this_sample < 1:
                cycles_this_sample = 1
            error += (cycles_per_sample_exact - cycles_this_sample)

            for _ in range(cycles_this_sample):
                self._step_cycle(advance_oscillator=True)

            # Voice outputs (apply voice3_off mute in audio path only)
            vouts = [self._voice_output(self.voices[0]),
                    self._voice_output(self.voices[1]),
                    0.0 if self.voice3_off else self._voice_output(self.voices[2])]

            # Filter routing bits ($D417): bit0..2 route V1..V3 into filter input.
            routed = 0.0
            bypass = 0.0
            for i, o in enumerate(vouts[:3]):
                if (self.filter_routing & (1 << i)) != 0:
                    routed += o
                else:
                    bypass += o

            # Keep amplitude comparable to previous implementation (which averaged 3 voices).
            routed /= 3.0
            bypass /= 3.0

            if self._filter_model is not None:
                filtered = float(self._filter_model(routed, self))
            else:
                filtered = self._svf_process(routed)

            mixed_out = filtered + bypass

            # Volume (0..15) scales the analog output stage.
            vol = (self.filter_vol & 0x0F) / 15.0
            out_sample = mixed_out * vol

            # D418 digi/DAC approximation: model volume-DAC steps (useful for sample playback).
            # We create a small AC-coupled component from the volume level.
            target = ((vol - 0.5) * (0.18 if '6581' in self.model.upper() else 0.10))
            # Fast approach to new target
            self._d418_dac += (target - self._d418_dac) * 0.12
            # Slow DC tracker
            self._d418_dc += (self._d418_dac - self._d418_dc) * 0.001
            digi = (self._d418_dac - self._d418_dc)

            output.append(out_sample + digi)

        return output

    def reset(self):
        """Reset SID chip to initial state"""
        for v in self.voices:
            v.freq = 0
            v.gate = False
            v.env_level = 0.0
            v.env_level_i = 0
            v.env_state = 'release'
            v.env_counter = 0
            v.phase = 0.0
            v.accum = 0
            v._prev_accum = 0
            v.noise_lfsr = 0x7FFFFF

        self.filter_cutoff = 0
        self.filter_res = 0
        self.filter_mode_lp = False
        self.filter_mode_bp = False
        self.filter_mode_hp = False
        self.filter_vol = 0
        self.filter_routing = 0

        self.voice3_off = False
        self._d418_last_vol = 0
        self._d418_dac = 0.0
        self._d418_dc = 0.0

        # POT defaults
        self.potx = 0xFF
        self.poty = 0xFF

        system_logger.log('SID', 'Chip reset complete', 'debug')
    
    def get_register_dump(self, registers: bytes) -> str:
        """Get hex dump of SID registers"""
        hex_str = " ".join(f"{b:02X}" for b in registers[:25])
        return f"SID Regs: {hex_str}"
    
    def get_voice_state_dump(self, voice_idx: int) -> str:
        """Get detailed state of a single voice"""
        v = self.voices[voice_idx]
        waveforms = []
        if v.waveform & 0x01: waveforms.append("TRI")
        if v.waveform & 0x02: waveforms.append("SAW")
        if v.waveform & 0x04: waveforms.append("PUL")
        if v.waveform & 0x08: waveforms.append("NOI")
        wave_str = "+".join(waveforms) if waveforms else "OFF"
        
        env = (float(v.env_level_i) / 255.0) if self.strict else v.env_level
        return (f"V{voice_idx+1}: Freq=${v.freq:04X} Wave={wave_str} "
                f"Gate={'ON' if v.gate else 'OFF'} Env={env:.3f} "
                f"State={v.env_state.upper()} ADSR={v.attack:X}{v.decay:X}{v.sustain:X}{v.release:X}")
    
    def log_all_voices(self):
        """Log state of all three voices"""
        for i in range(3):
            system_logger.log('SID', self.get_voice_state_dump(i), 'debug')
    
    def update(self, total_cycles: int, registers: bytes):
        """
        Update SID state based on register values.
        
        Args:
            total_cycles: Number of CPU cycles elapsed
            registers: 25 bytes of SID registers (0xD400-0xD418)
        """
        # 1. Read Registers
        for i in range(3):
            base = i * 7
            v = self.voices[i]
            
            f_lo = registers[base]
            f_hi = registers[base + 1]
            p_lo = registers[base + 2]
            p_hi = registers[base + 3]
            ctrl = registers[base + 4]
            ad = registers[base + 5]
            sr = registers[base + 6]
            
            v.freq = (f_hi << 8) | f_lo
            v.pulse = ((p_hi & 0x0F) << 8) | p_lo
            
            # Decode ADSR before gate edge logging, so debug messages reflect the
            # *new* nibbles.
            v.attack = (ad >> 4) & 0x0F
            v.decay = ad & 0x0F
            v.sustain = (sr >> 4) & 0x0F
            v.release = sr & 0x0F

            new_gate = (ctrl & 0x01) != 0
            
            # Gate state logic
            if new_gate and not v.gate:
                v.env_state = 'attack'
                if self.strict:
                    v.env_counter = 0
                system_logger.log('SID', f'Voice {i+1}: Gate ON, Attack={v.attack} (freq=${v.freq:04X})', 'debug')
            elif not new_gate and v.gate:
                v.env_state = 'release'
                if self.strict:
                    v.env_counter = 0
                system_logger.log('SID', f'Voice {i+1}: Gate OFF, Release={v.release}', 'debug')
            
            v.gate = new_gate
            v.sync = (ctrl & 0x02) != 0
            v.ring_mod = (ctrl & 0x04) != 0
            v.test = (ctrl & 0x08) != 0
            v.waveform = (ctrl >> 4) & 0x0F
            v.raw_waveform = ctrl
            v.control = ctrl
            
            # ADSR already decoded above.
        
        # Filter
        f_cut_lo = registers[0x15] & 0x07
        f_cut_hi = registers[0x16] & 0xF8
        self.filter_cutoff = (f_cut_hi << 3) | f_cut_lo
        self.filter_res = (registers[0x17] >> 4) & 0x0F
        self.filter_routing = registers[0x17] & 0x0F
        
        mode_vol = registers[0x18]
        self.filter_mode_lp = (mode_vol & 0x10) != 0
        self.filter_mode_bp = (mode_vol & 0x20) != 0
        self.filter_mode_hp = (mode_vol & 0x40) != 0
        self.filter_vol = mode_vol & 0x0F
        self.voice3_off = (mode_vol & 0x80) != 0

        # Track volume changes for D418 digi approximation
        self._d418_last_vol = int(self.filter_vol) & 0x0F
        
        # 2. Per-cycle SID simulation
        total_cycles = max(int(total_cycles), 0)
        for _ in range(total_cycles):
            # Strict mode advances oscillator too (needed for OSC3/RANDOM trustworthiness)
            self._step_cycle(advance_oscillator=self.strict)

    def get_snapshot(self) -> Tuple[List[SidVoiceStatus], SidFilterStatus]:
        """
        Get current SID state snapshot.
        
        Returns:
            Tuple of (voices, filter_status)
        """
        voices_snap = []
        
        for v in self.voices:
            # Calculate frequency in Hz
            hz = (v.freq * self.clock_hz) / 16777216
            midi = 0.0
            pitch_bend = 0.0
            
            if hz > 4:  # Minimum audible Hz
                # Formula: Note = 69 + 12 * log2(Hz/440)
                midi = 69 + 12 * math.log2(hz / 440)
                
                # Calculate pitch bend (deviation from nearest semitone)
                pitch_bend = midi - round(midi)
            
            voices_snap.append(SidVoiceStatus(
                freq_reg=v.freq,
                freq_hz=hz,
                midi_note=midi,
                pitch_bend=pitch_bend,
                envelope=max(0.0, min(1.0, (float(v.env_level_i) / 255.0) if self.strict else v.env_level)),
                gate=v.gate,
                waveform=v.waveform,
                raw_waveform=v.raw_waveform,
                pulse=v.pulse,
                attack=v.attack,
                decay=v.decay,
                sustain=v.sustain,
                release=v.release,
                sync=v.sync,
                ring_mod=v.ring_mod,
                test=v.test,
                state=v.env_state
            ))
        
        # Filter mode
        mode = 0
        if self.filter_mode_lp:
            mode |= 1
        if self.filter_mode_bp:
            mode |= 2
        if self.filter_mode_hp:
            mode |= 4
        
        filter_snap = SidFilterStatus(
            cutoff=self.filter_cutoff,
            resonance=self.filter_res,
            mode=mode,
            vol=self.filter_vol,
            on=mode != 0,
            routing=self.filter_routing
        )
        
        return voices_snap, filter_snap


def write(self, reg, value):
    self.write_queue.append((reg, value))

def sid_tick(self):
    if self.write_queue:
        reg, value = self.write_queue.pop(0)
        self.registers[reg] = value
    self.clock_adsr()


# -------- Phase-5A: SID Analog Model --------
class SIDAnalog:
    def __init__(self, model="6581"):
        self.model = model
        self.dc_bias = 0.06 if model == "6581" else 0.0
        self.filter_nonlinear = model == "6581"

    def apply_filter(self, sample, cutoff):
        if self.filter_nonlinear:
            return sample * (cutoff / 2048.0) ** 1.2 + self.dc_bias
        return sample * (cutoff / 2048.0)

def init_analog(self, model="6581"):
    self.analog = SIDAnalog(model)

def analog_tick(self, raw_sample):
    return self.analog.apply_filter(raw_sample, self.filter_cutoff)


# -------- Phase-7: SID Voice Bleed & Noise --------
import random

def apply_voice_bleed(self, voices):
    bleed = sum(voices) * 0.02
    return [v + bleed for v in voices]

def apply_analog_noise(self, sample):
    return sample + random.uniform(-0.002, 0.002)
